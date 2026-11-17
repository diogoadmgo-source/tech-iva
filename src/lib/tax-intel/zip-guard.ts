/**
 * Proteção contra zip-bomb ANTES de entregar o XLSX à biblioteca.
 *
 * Um XLSX é um ZIP. Lemos só o diretório central (fim do arquivo), sem
 * descompactar nada, e recusamos o arquivo se o total descompactado declarado,
 * o número de entradas ou a taxa de compressão passarem dos limites.
 * Isto não é um leitor de planilha: a leitura das células é do exceljs.
 */

export const LIMITS = {
  maxFileBytes: 30 * 1024 * 1024,
  maxUncompressedBytes: 300 * 1024 * 1024,
  maxEntries: 5_000,
  /** Taxa máxima descompactado/compactado por entrada (XML de planilha real fica bem abaixo). */
  maxEntryRatio: 200,
  maxRows: 100_000,
} as const;

export class FileRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRejected";
  }
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export type ZipStats = {
  entries: number;
  compressed: number;
  uncompressed: number;
  maxRatio: number;
};

export function inspectZip(bytes: Uint8Array): ZipStats {
  if (bytes.length > LIMITS.maxFileBytes) {
    throw new FileRejected("Arquivo acima de 30 MB.");
  }
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new FileRejected("O arquivo não é um XLSX válido.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // EOCD fica nos últimos 22 bytes + comentário (até 65.535).
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 65_535);
  for (let i = bytes.length - 22; i >= stop; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FileRejected("O arquivo não é um XLSX válido (ZIP sem diretório).");

  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new FileRejected("XLSX em formato ZIP64 não é aceito.");
  }
  if (entries > LIMITS.maxEntries) throw new FileRejected("XLSX com entradas demais.");
  if (cdOffset + cdSize > bytes.length) throw new FileRejected("XLSX corrompido.");

  let p = cdOffset;
  let compressed = 0;
  let uncompressed = 0;
  let maxRatio = 0;
  for (let n = 0; n < entries; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CEN_SIG) {
      throw new FileRejected("XLSX corrompido.");
    }
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    if (csize === 0xffffffff || usize === 0xffffffff) {
      throw new FileRejected("XLSX em formato ZIP64 não é aceito.");
    }
    compressed += csize;
    uncompressed += usize;
    const ratio = csize > 0 ? usize / csize : usize > 0 ? Number.POSITIVE_INFINITY : 0;
    if (usize > 1024 * 1024) maxRatio = Math.max(maxRatio, ratio);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (uncompressed > LIMITS.maxUncompressedBytes) {
    throw new FileRejected("O conteúdo descompactado do XLSX passa de 300 MB.");
  }
  if (maxRatio > LIMITS.maxEntryRatio) {
    throw new FileRejected("Taxa de compressão suspeita (possível zip-bomb).");
  }
  return { entries, compressed, uncompressed, maxRatio };
}
