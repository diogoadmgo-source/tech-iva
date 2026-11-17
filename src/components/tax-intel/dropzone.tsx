import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/** Área de arrastar e soltar, acessível por teclado (Enter/Espaço abre o seletor). */
export function Dropzone({
  onFile,
  disabled,
  busy,
  accept = ".xlsx,.csv,.txt",
}: {
  onFile: (file: File) => void;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  accept?: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => !disabled && inputRef.current?.click();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Escolher arquivo XLSX ou CSV"
      onClick={open}
      onKeyDown={onKey}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onFile(f);
      }}
      className={cn(
        "focus-glow group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-dashed px-6 py-10 text-center transition-all duration-300",
        over
          ? "scale-[1.01] border-primary bg-primary/10 shadow-[0_0_0_4px_oklch(0.55_0.22_264_/_12%)]"
          : "border-border bg-surface-1/60 hover:border-primary/50 hover:bg-surface-2/60",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span
        className={cn(
          "grid size-12 place-items-center rounded-2xl border border-border/70 bg-surface-2 text-primary transition-transform duration-300",
          over ? "-translate-y-1 scale-110" : "group-hover:-translate-y-0.5",
          busy && "animate-pulse",
        )}
      >
        {over ? (
          <FileSpreadsheet className="size-5" aria-hidden />
        ) : (
          <UploadCloud className="size-5" aria-hidden />
        )}
      </span>
      <div>
        <p className="text-sm font-medium">
          {busy ? "Lendo o arquivo…" : over ? "Solte para validar" : "Arraste a planilha aqui"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          ou{" "}
          <span className="font-medium text-primary underline-offset-2 group-hover:underline">
            escolha no computador
          </span>{" "}
          · XLSX ou CSV · até 100 mil linhas · 30 MB
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
