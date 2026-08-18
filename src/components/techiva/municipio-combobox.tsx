import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, MapPin, X } from "lucide-react";

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

/** [código IBGE completo (7 dígitos), nome, UF] — DTB/IBGE 2024. */
type Row = [string, string, string];

export type Municipio = { codigo: string; nome: string; uf: string };

/**
 * A tabela do IBGE tem 5.571 linhas (~175 KB). Ela é carregada sob demanda, na
 * primeira vez que o combobox abre, para não pesar no bundle inicial da tela.
 */
let cache: Row[] | null = null;
let loading: Promise<Row[]> | null = null;

function loadMunicipios(): Promise<Row[]> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = import("@/data/municipios-ibge-2024.json").then((mod) => {
      cache = (mod.default ?? mod) as unknown as Row[];
      return cache;
    });
  }
  return loading;
}

/** Busca sem acento e sem pontuação — "sao paulo" acha "São Paulo". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function formatMunicipio(m: Municipio): string {
  return `${m.nome} (${m.uf})`;
}

/** Máximo de itens renderizados por busca: a lista completa travaria o popover. */
const MAX_ITEMS = 60;

export function MunicipioCombobox({
  value,
  onChange,
  uf,
  id,
  className,
}: {
  /** Nome do município selecionado (o que vai para o motor de cálculo). */
  value: string;
  onChange: (municipio: Municipio | null) => void;
  /** Quando informada, prioriza (e pré-filtra) os municípios da UF de destino. */
  uf?: string;
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
    void loadMunicipios().then((data) => {
      if (!mounted.current) return;
      setRows(data);
      setBusy(false);
    });
  }, [open, rows]);

  const results = useMemo(() => {
    if (!rows) return [] as Row[];
    const q = fold(term);
    const digits = term.replace(/\D/g, "");
    const inUf = uf ? rows.filter((r) => r[2] === uf) : rows;
    const base = uf && inUf.length > 0 ? inUf : rows;

    const matched = base.filter((r) => {
      if (digits.length >= 2 && r[0].startsWith(digits)) return true;
      if (!q) return true;
      return fold(r[1]).includes(q);
    });

    // Quem começa com o termo aparece primeiro.
    if (q) {
      matched.sort((a, b) => {
        const aStarts = fold(a[1]).startsWith(q) ? 0 : 1;
        const bStarts = fold(b[1]).startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a[1].localeCompare(b[1], "pt-BR");
      });
    }
    return matched.slice(0, MAX_ITEMS);
  }, [rows, term, uf]);

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
            <span className={cn("flex min-w-0 items-center gap-2", !value && "text-muted-foreground")}>
              <MapPin className="size-4 shrink-0 opacity-60" aria-hidden />
              <span className="truncate">{value || "Pesquisar município..."}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
          {/* shouldFilter=false: o filtro é nosso (sem acento, por código e limitado). */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Nome ou código IBGE"
              value={term}
              onValueChange={setTerm}
            />
            <CommandList>
              {busy ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Carregando tabela do IBGE...
                </div>
              ) : results.length === 0 ? (
                <CommandEmpty>Nenhum município encontrado.</CommandEmpty>
              ) : (
                <CommandGroup
                  heading={
                    uf
                      ? `Municípios de ${uf} (tabela IBGE 2024)`
                      : "Municípios do Brasil (tabela IBGE 2024)"
                  }
                >
                  {results.map(([codigo, nome, sigla]) => (
                    <CommandItem
                      key={codigo}
                      value={codigo}
                      onSelect={() => {
                        onChange({ codigo, nome, uf: sigla });
                        setOpen(false);
                        setTerm("");
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          value === nome ? "opacity-100 text-primary" : "opacity-0",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{nome}</span>
                      <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                        {sigla} · {codigo}
                      </span>
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
          aria-label="Limpar município"
          onClick={() => onChange(null)}
        >
          <X className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
