import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { fetchCnpj } from "@/lib/cnpj.functions";
import { isValidCnpj } from "@/lib/onboarding";
import type { RegimeKind } from "@/components/techiva/badges";

export type CnpjRecord = {
  found: boolean;
  stale: boolean;
  cnpj: string;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  situacao?: string | null;
  abertura?: string | null;
  porte?: string | null;
  natureza_juridica?: string | null;
  cnae_principal?: string | null;
  cnae_principal_desc?: string | null;
  uf?: string | null;
  municipio?: string | null;
  bairro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  cep?: string | null;
  email?: string | null;
  telefone?: string | null;
  matriz?: boolean | null;
  simples_optante?: boolean | null;
  mei_optante?: boolean | null;
  regime?: RegimeKind | null;
  credit_transfer_pct?: number | null;
  fetched_at?: string | null;
};

/** Aviso obrigatório de interface: o cadastro público não distingue Presumido de Real. */
export const PRESUMIDO_DISCLAIMER =
  "Quem não é optante pelo Simples é registrado como Lucro Presumido por padrão: o cadastro público da Receita não distingue Presumido de Real. Ajuste manualmente se souber o regime — isso não move o piso de preço (o crédito é integral nos dois), mas muda a leitura da carteira.";

export const SITUACAO_ATIVA = "ATIVA";

export function isSituacaoAtiva(situacao?: string | null): boolean {
  return (situacao ?? "").trim().toUpperCase() === SITUACAO_ATIVA;
}

/** Consulta apenas o cache (RPC cnpj_lookup). Não dispara busca externa. */
export async function lookupCnpj(cnpj: string): Promise<CnpjRecord> {
  const { data, error } = await supabase.rpc("cnpj_lookup", { p_cnpj: cnpj });
  if (error) throw new Error(error.message);
  return data as unknown as CnpjRecord;
}

/** Consulta do cache por CNPJ, cacheada no TanStack Query. */
export function useCnpjRecord(cnpj: string | null | undefined) {
  const digits = (cnpj ?? "").replace(/\D/g, "");
  const valid = digits.length === 14 && isValidCnpj(digits);
  return useQuery({
    queryKey: ["cnpj", digits],
    enabled: valid,
    staleTime: 10 * 60_000,
    queryFn: () => lookupCnpj(digits),
  });
}

export type CnpjResolveState = "idle" | "loading" | "found" | "not_found" | "error";

/**
 * Resolve um CNPJ: consulta o cache; se não existe ou está velho (>30d), chama
 * a função de servidor cnpj-fetch e reconsulta. Uma chamada por CNPJ.
 */
export function useResolveCnpj() {
  const enrich = useServerFn(fetchCnpj);
  const queryClient = useQueryClient();
  const [state, setState] = useState<CnpjResolveState>("idle");
  const [record, setRecord] = useState<CnpjRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function resolve(cnpj: string): Promise<CnpjRecord | null> {
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14 || !isValidCnpj(digits)) return null;

    setState("loading");
    setMessage(null);
    try {
      let found = await lookupCnpj(digits);
      if (!found.found || found.stale) {
        const result = await enrich({ data: { cnpj: digits } });
        const first = result.results[0];
        if (first?.status === "ok") {
          found = await lookupCnpj(digits);
          queryClient.setQueryData(["cnpj", digits], found);
        } else if (!found.found) {
          setRecord(null);
          setState("not_found");
          setMessage(first?.message ?? "CNPJ não encontrado na base pública da Receita.");
          return null;
        }
      }
      setRecord(found);
      setState(found.found ? "found" : "not_found");
      return found.found ? found : null;
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Falha ao consultar o CNPJ.");
      return null;
    }
  }

  function reset() {
    setState("idle");
    setRecord(null);
    setMessage(null);
  }

  return { resolve, reset, state, record, message, loading: state === "loading" };
}

export type ClassifyProgress = {
  phase: "idle" | "listing" | "fetching" | "applying" | "done";
  total: number;
  fetched: number;
  ok: number;
  notFound: number;
  errors: number;
  updated: number;
  regimeChanged: number;
  provider?: string | undefined;
};

const EMPTY_PROGRESS: ClassifyProgress = {
  phase: "idle",
  total: 0,
  fetched: 0,
  ok: 0,
  notFound: 0,
  errors: 0,
  updated: 0,
  regimeChanged: 0,
};

const CHUNK = 10;

/**
 * "Classificar contrapartes": lista os CNPJs sem cache (ou vencidos), manda em lotes
 * para cnpj-fetch e aplica o cache na carteira com apply_registry_to_counterparties.
 */
export function useClassifyCounterparties(tenantId: string) {
  const enrich = useServerFn(fetchCnpj);
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ClassifyProgress>(EMPTY_PROGRESS);

  const mutation = useMutation({
    mutationFn: async () => {
      setProgress({ ...EMPTY_PROGRESS, phase: "listing" });

      const { data: missing, error: missingError } = await supabase.rpc(
        "counterparties_missing_registry",
        { p_tenant: tenantId },
      );
      if (missingError) throw new Error(missingError.message);

      const cnpjs = (missing ?? []).map((row) => row.cnpj).filter(Boolean);
      setProgress((p) => ({ ...p, phase: "fetching", total: cnpjs.length }));

      let ok = 0;
      let notFound = 0;
      let errors = 0;
      let provider: string | undefined;

      for (let i = 0; i < cnpjs.length; i += CHUNK) {
        const slice = cnpjs.slice(i, i + CHUNK);
        const result = await enrich({ data: { cnpjs: slice } });
        provider = result.provider;
        ok += result.ok;
        notFound += result.notFound;
        errors += result.errors;
        setProgress((p) => ({
          ...p,
          fetched: Math.min(i + slice.length, cnpjs.length),
          ok,
          notFound,
          errors,
          provider,
        }));
      }

      setProgress((p) => ({ ...p, phase: "applying" }));
      const { data: applied, error: applyError } = await supabase.rpc(
        "apply_registry_to_counterparties",
        { p_tenant: tenantId },
      );
      if (applyError) throw new Error(applyError.message);

      const summary = (applied ?? {}) as { updated?: number; regime_changed?: number };
      setProgress((p) => ({
        ...p,
        phase: "done",
        updated: Number(summary.updated ?? 0),
        regimeChanged: Number(summary.regime_changed ?? 0),
      }));

      return {
        total: cnpjs.length,
        ok,
        notFound,
        errors,
        updated: Number(summary.updated ?? 0),
        regimeChanged: Number(summary.regime_changed ?? 0),
        provider,
      };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chain-map", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["counterparty-detail", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] }),
      ]);
    },
  });

  return { ...mutation, progress, reset: () => setProgress(EMPTY_PROGRESS) };
}
