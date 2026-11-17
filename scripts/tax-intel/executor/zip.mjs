// Leitura de ZIP em fluxo, sem dependência: lê o diretório central (com ZIP64),
// localiza o membro e entrega um stream já descompactado (deflate ou store).
// Os arquivos da Receita têm um único CSV por ZIP, mas lemos todos os membros.
import { open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";

const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

/** Lista os membros: [{ name, method, compressedSize, size, localOffset, dataOffset }]. */
export async function listZip(path) {
  const fh = await open(path, "r");
  try {
    const { size: fileSize } = await fh.stat();
    const tailLen = Math.min(fileSize, 65557);
    const tail = await readAt(fh, fileSize - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("ZIP inválido: fim do diretório central não encontrado");
    let entries = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== SIG_Z64_LOCATOR) throw new Error("ZIP64 sem localizador");
      const z64Pos = Number(tail.readBigUInt64LE(loc + 8));
      const z64 = await readAt(fh, z64Pos, 56);
      if (z64.readUInt32LE(0) !== SIG_Z64_EOCD) throw new Error("ZIP64 inválido");
      entries = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    const cd = await readAt(fh, cdOffset, cdSize);
    const out = [];
    let p = 0;
    for (let n = 0; n < entries; n++) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) throw new Error("diretório central corrompido");
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString("latin1");
      // Campo extra ZIP64 (0x0001): só traz os valores que estão em 0xFFFFFFFF, nesta ordem.
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        e += 4 + len;
      }
      const lh = await readAt(fh, localOffset, 30);
      if (lh.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`cabeçalho local inválido em ${name}`);
      const dataOffset = localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      out.push({ name, method, compressedSize, size, localOffset, dataOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Stream descompactado de um membro. */
export function openMember(path, entry) {
  if (entry.compressedSize === 0) return Readable.from([]);
  const raw = createReadStream(path, { start: entry.dataOffset, end: entry.dataOffset + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`método de compressão ${entry.method} não suportado (${entry.name})`);
  const inflate = createInflateRaw();
  raw.on("error", (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}
