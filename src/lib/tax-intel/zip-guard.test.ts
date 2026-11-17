import { describe, expect, it } from "vitest";

import { FileRejected, inspectZip } from "./zip-guard";

/** ZIP sintético só com o diretório central (é o que inspectZip lê). */
function fakeZip(entries: Array<{ csize: number; usize: number }>, opts: { zip64?: boolean } = {}) {
  const name = new TextEncoder().encode("x.xml");
  const cenLen = 46 + name.length;
  const local = 30; // espaço reservado para "PK\3\4"
  const total = local + cenLen * entries.length + 22;
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x04034b50, true);
  let p = local;
  for (const e of entries) {
    v.setUint32(p, 0x02014b50, true);
    v.setUint32(p + 20, e.csize, true);
    v.setUint32(p + 24, e.usize, true);
    v.setUint16(p + 28, name.length, true);
    buf.set(name, p + 46);
    p += cenLen;
  }
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, opts.zip64 ? 0xffff : entries.length, true);
  v.setUint32(p + 12, cenLen * entries.length, true);
  v.setUint32(p + 16, local, true);
  return buf;
}

describe("proteção contra zip-bomb", () => {
  it("aceita uma planilha comum", () => {
    const stats = inspectZip(fakeZip([{ csize: 400_000, usize: 4_000_000 }]));
    expect(stats.entries).toBe(1);
    expect(stats.maxRatio).toBe(10);
  });

  it("recusa taxa de compressão absurda numa entrada grande", () => {
    expect(() => inspectZip(fakeZip([{ csize: 10_000, usize: 100_000_000 }]))).toThrow(/zip-bomb/);
  });

  it("recusa conteúdo descompactado acima de 300 MB", () => {
    const parts = Array.from({ length: 4 }, () => ({ csize: 10_000_000, usize: 100_000_000 }));
    expect(() => inspectZip(fakeZip(parts))).toThrow(/300 MB/);
  });

  it("recusa ZIP64 e arquivo que não é ZIP", () => {
    expect(() => inspectZip(fakeZip([{ csize: 1, usize: 1 }], { zip64: true }))).toThrow(/ZIP64/);
    expect(() => inspectZip(new TextEncoder().encode("cnpj;razao\n1;2\n".repeat(3)))).toThrow(
      FileRejected,
    );
  });
});
