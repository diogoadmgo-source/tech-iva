import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Scale, Tags } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** [código CST (3 dígitos), descrição oficial]. */
export type CstRow = [string, string];
/**
 * [código cClassTrib (6 dígitos), CST, nome, descrição, tipo de alíquota,
 * pRedIBS, pRedCBS, início de vigência, fim de vigência].
 */
export type ClassTribRow = [string, string, string, string, string, number, number, string, string];

type Tabela = { cst: CstRow[]; cclasstrib: ClassTribRow[] };

/**
 * Tabela oficial CST × cClassTrib (versão pública 03/10/2025): 19 CST e 142
 * classificações (~50 KB). Servida como arquivo estático e pré-carregada
 * quando o campo aparece, para a lista abrir já pronta.
 */
let cache: Tabela | null = null;
let loading: Promise<Tabela> | null = null;

function loadTabela(): Promise<Tabela> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetch("/data/cst-cclasstrib.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Tabela) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

/** Busca sem acento — "isencao" acha "isenção". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function useTabela() {
  const [tabela, setTabela] = useState<Tabela | null>(cache);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => void (mounted.current = false), []);

  useEffect(() => {
    if (tabela) return;
    setBusy(true);
    void loadTabela()
      .then((data) => {
        if (!mounted.current) return;
        setTabela(data);
        setBusy(false);
      })
      .catch(() => {
        if (!mounted.current) return;
        setBusy(false);
        setErro(true);
      });
  }, [tabela]);

  return { tabela, busy, erro };
}

/** Descrição oficial do CST, quando a tabela já está em memória. */
export function cstDescricao(codigo: string): string | null {
  return cache?.cst.find((r) => r[0] === codigo)?.[1] ?? null;
}

/** Máximo de itens renderizados por busca, para o popover não travar. */
const MAX_ITEMS = 60;

export function CstCombobox({
  value,
  onChange,
  id,
  className,
}: {
  /** CST selecionado com 3 dígitos (ex.: "000"). */
  value: string;
  onChange: (row: CstRow | null) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const { tabela, busy, erro } = useTabela();

  const selected = useMemo(
    () => (tabela && value ? (tabela.cst.find((r) => r[0] === value) ?? null) : null),
    [tabela, value],
  );

  const results = useMemo(() => {
    if (!tabela) return [] as CstRow[];
    const q = fold(term);
    const digits = term.replace(/\D/g, "");
    if (!q) return tabela.cst;
    return tabela.cst.filter(
      (r) => (digits.length > 0 && r[0].includes(digits)) || fold(r[1]).includes(q),
    );
  }, [tabela, term]);

  const label = selected ? `${selected[0]} — ${selected[1]}` : value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span
            className={cn("flex min-w-0 items-center gap-2", !value && "text-muted-foreground")}
          >
            <Tags className="size-4 shrink-0 opacity-60" aria-hidden />
            <span className="truncate">{label || "Pesquisar CST..."}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(34rem,92vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Código ou descrição do CST" value={term} onValueChange={setTerm} />
          <CommandList>
            {busy ? (
              <Carregando texto="Carregando tabela de CST..." />
            ) : erro ? (
              <Falha />
            ) : results.length === 0 ? (
              <CommandEmpty>Nenhum CST encontrado.</CommandEmpty>
            ) : (
              <CommandGroup heading="CST IBS/CBS">
                {results.map(([codigo, descricao]) => (
                  <CommandItem
                    key={codigo}
                    value={codigo}
                    onSelect={() => {
                      onChange([codigo, descricao]);
                      setOpen(false);
                      setTerm("");
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        value === codigo ? "text-primary opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                    <span className="shrink-0 font-mono text-xs text-primary">{codigo}</span>
                    <span className="min-w-0 flex-1 truncate">{descricao}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ClassTribCombobox({
  value,
  cst,
  onChange,
  id,
  className,
}: {
  /** cClassTrib selecionado com 6 dígitos (ex.: "000001"). */
  value: string;
  /** CST atual: a lista mostra primeiro as classificações compatíveis. */
  cst?: string;
  onChange: (row: ClassTribRow | null) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const { tabela, busy, erro } = useTabela();

  const selected = useMemo(
    () => (tabela && value ? (tabela.cclasstrib.find((r) => r[0] === value) ?? null) : null),
    [tabela, value],
  );

  const { compativeis, outros } = useMemo(() => {
    if (!tabela) return { compativeis: [] as ClassTribRow[], outros: [] as ClassTribRow[] };
    const q = fold(term);
    const digits = term.replace(/\D/g, "");
    const matched = tabela.cclasstrib.filter((r) => {
      if (!q) return true;
      if (digits.length >= 2 && r[0].includes(digits)) return true;
      return fold(r[2]).includes(q) || fold(r[3]).includes(q);
    });
    const alvo = (cst ?? "").padStart(3, "0");
    return {
      compativeis: matched.filter((r) => !cst || r[1] === alvo).slice(0, MAX_ITEMS),
      outros: cst ? matched.filter((r) => r[1] !== alvo).slice(0, MAX_ITEMS) : [],
    };
  }, [tabela, term, cst]);

  const label = selected ? `${selected[0]} — ${selected[2]}` : value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span
            className={cn("flex min-w-0 items-center gap-2", !value && "text-muted-foreground")}
          >
            <Scale className="size-4 shrink-0 opacity-60" aria-hidden />
            <span className="truncate">{label || "Pesquisar cClassTrib..."}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(42rem,94vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Código, nome ou descrição da classificação"
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            {busy ? (
              <Carregando texto="Carregando tabela de cClassTrib..." />
            ) : erro ? (
              <Falha />
            ) : compativeis.length === 0 && outros.length === 0 ? (
              <CommandEmpty>Nenhuma classificação encontrada.</CommandEmpty>
            ) : (
              <>
                {compativeis.length > 0 && (
                  <CommandGroup heading={cst ? `Compatíveis com o CST ${cst}` : "Classificações"}>
                    {compativeis.map((row) => (
                      <Item
                        key={row[0]}
                        row={row}
                        value={value}
                        onPick={() => {
                          onChange(row);
                          setOpen(false);
                          setTerm("");
                        }}
                      />
                    ))}
                  </CommandGroup>
                )}
                {outros.length > 0 && (
                  <CommandGroup heading="Outros CST (gera divergência na validação)">
                    {outros.map((row) => (
                      <Item
                        key={row[0]}
                        row={row}
                        value={value}
                        showCst
                        onPick={() => {
                          onChange(row);
                          setOpen(false);
                          setTerm("");
                        }}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Item({
  row,
  value,
  onPick,
  showCst,
}: {
  row: ClassTribRow;
  value: string;
  onPick: () => void;
  showCst?: boolean;
}) {
  const [codigo, cstRow, nome, , tipo, pRedIBS, pRedCBS] = row;
  const reducao = Math.max(pRedIBS, pRedCBS);
  return (
    <CommandItem value={codigo} onSelect={onPick} className="items-start">
      <Check
        className={cn(
          "mt-0.5 size-4 shrink-0",
          value === codigo ? "text-primary opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <span className="mt-0.5 shrink-0 font-mono text-xs text-primary">{codigo}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{nome}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {showCst ? `CST ${cstRow} · ` : ""}
          {tipo || "Padrão"}
          {reducao > 0 ? ` · redução ${reducao}%` : ""}
        </span>
      </span>
    </CommandItem>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

function Falha() {
  return (
    <div className="px-3 py-6 text-sm text-muted-foreground">
      Não foi possível carregar a tabela CST × cClassTrib. Recarregue a página.
    </div>
  );
}
