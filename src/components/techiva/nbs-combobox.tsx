import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Wrench, X } from "lucide-react";

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

/** [código NBS completo (subitem, 9 dígitos formatados), descrição oficial]. */
type Row = [string, string];

export type NbsItem = { codigo: string; descricao: string };

/**
 * Anexo I da NBS 2.0 (Portaria Conjunta RFB/SCS, com alterações de 06/12/2018):
 * 920 subitens (~100 KB). Carregado sob demanda na primeira abertura do combobox
 * para não pesar no bundle inicial do simulador.
 */
let cache: Row[] | null = null;
let loading: Promise<Row[]> | null = null;

function loadNbs(): Promise<Row[]> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = import("@/data/nbs-2.0.json").then((mod) => {
      cache = (mod.default ?? mod) as unknown as Row[];
      return cache;
    });
  }
  return loading;
}

/** Busca sem acento — "informacao" acha "informação". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Capítulo = 2º e 3º dígitos do código (1.15xx.xx.xx -> capítulo 15). */
const CAPITULOS: Record<string, string> = {
  "01": "Serviços de construção",
  "02": "Intermediação na distribuição de mercadorias; despacho aduaneiro; comércio",
  "03": "Alimentação, bebidas e hospedagem",
  "04": "Transporte de passageiros",
  "05": "Transporte de cargas",
  "06": "Apoio aos transportes",
  "07": "Serviços postais, remessas e entregas",
  "08": "Transmissão e distribuição de eletricidade, gás e água",
  "09": "Serviços financeiros e relacionados",
  "10": "Serviços imobiliários",
  "11": "Arrendamento operacional, propriedade intelectual e franquias",
  "12": "Pesquisa e desenvolvimento",
  "13": "Serviços jurídicos e contábeis",
  "14": "Serviços profissionais, técnicos e empresariais",
  "15": "Serviços de tecnologia da informação",
  "17": "Telecomunicações, difusão e fornecimento de informações",
  "18": "Apoio às atividades empresariais",
  "19": "Apoio à agricultura, pecuária, extração e utilidades",
  "20": "Manutenção, reparação e instalação (exceto construção)",
  "21": "Publicação, impressão e reprodução",
  "22": "Serviços educacionais",
  "23": "Saúde humana e assistência social",
  "24": "Esgoto, resíduos e serviços ambientais",
  "25": "Serviços recreativos, culturais e desportivos",
  "26": "Serviços pessoais",
};

/** Rótulos dos níveis do código, conforme a formação da NBS. */
export function nbsNiveis(codigo: string): { nivel: string; valor: string }[] {
  const d = codigo.replace(/\D/g, "");
  if (d.length !== 9) return [];
  return [
    { nivel: "Capítulo", valor: `${d[0]}.${d.slice(1, 3)}` },
    { nivel: "Posição", valor: `${d[0]}.${d.slice(1, 5)}` },
    { nivel: "Subposição", valor: `${d[0]}.${d.slice(1, 5)}.${d[5]}` },
    { nivel: "Item", valor: `${d[0]}.${d.slice(1, 5)}.${d.slice(5, 7)}` },
    { nivel: "Subitem", valor: codigo },
  ];
}

export function nbsCapitulo(codigo: string): string | null {
  const d = codigo.replace(/\D/g, "");
  return d.length >= 3 ? (CAPITULOS[d.slice(1, 3)] ?? null) : null;
}

/** Máximo de itens renderizados por busca: a lista completa travaria o popover. */
const MAX_ITEMS = 60;

export function NbsCombobox({
  value,
  onChange,
  id,
  className,
}: {
  /** Código NBS selecionado (formato 1.1502.10.00) — é o que vai para o motor. */
  value: string;
  onChange: (item: NbsItem | null) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Row[] | null>(cache);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => void (mounted.current = false), []);

  useEffect(() => {
    if (!open || rows) return;
    setBusy(true);
    void loadNbs().then((data) => {
      if (!mounted.current) return;
      setRows(data);
      setBusy(false);
    });
  }, [open, rows]);

  const selected = useMemo(
    () => (rows && value ? (rows.find((r) => r[0] === value) ?? null) : null),
    [rows, value],
  );

  const results = useMemo(() => {
    if (!rows) return [] as Row[];
    const q = fold(term);
    const digits = term.replace(/\D/g, "");

    const matched = rows.filter((r) => {
      if (digits.length >= 2 && r[0].replace(/\D/g, "").startsWith(digits)) return true;
      if (!q) return true;
      return fold(r[1]).includes(q);
    });

    if (q && digits.length < 2) {
      matched.sort((a, b) => {
        const aStarts = fold(a[1]).startsWith(q) ? 0 : 1;
        const bStarts = fold(b[1]).startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a[0].localeCompare(b[0]);
      });
    }
    return matched.slice(0, MAX_ITEMS);
  }, [rows, term]);

  const label = selected ? `${selected[0]} — ${selected[1]}` : value;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span
              className={cn("flex min-w-0 items-center gap-2", !value && "text-muted-foreground")}
            >
              <Wrench className="size-4 shrink-0 opacity-60" aria-hidden />
              <span className="truncate">{label || "Pesquisar serviço (NBS)..."}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(38rem,92vw)] p-0" align="start">
          {/* shouldFilter=false: o filtro é nosso (sem acento, por código e limitado). */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Descrição do serviço ou código NBS"
              value={term}
              onValueChange={setTerm}
            />
            <CommandList>
              {busy ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Carregando tabela NBS 2.0...
                </div>
              ) : results.length === 0 ? (
                <CommandEmpty>Nenhum serviço encontrado na NBS 2.0.</CommandEmpty>
              ) : (
                <CommandGroup heading="Subitens da NBS 2.0 (Anexo I)">
                  {results.map(([codigo, descricao]) => (
                    <CommandItem
                      key={codigo}
                      value={codigo}
                      onSelect={() => {
                        onChange({ codigo, descricao });
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

      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Limpar NBS"
          onClick={() => onChange(null)}
        >
          <X className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
