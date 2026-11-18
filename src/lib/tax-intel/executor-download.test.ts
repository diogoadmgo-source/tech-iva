// Download da Receita: o servidor derruba conexões longas. O executor retoma
// do byte em que parou (HTTP Range) e o sha256 final confere com o arquivo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error módulo .mjs sem tipos
import { Origin } from "../../../scripts/tax-intel/executor/run.mjs";

const body = randomBytes(3 * 1024 * 1024);
let server: Server;
let base = "";
const seen: string[] = [];
let mode: "range" | "norange" = "range";

beforeAll(async () => {
  let drops = 0;
  server = createServer((req, res) => {
    const range = mode === "range" ? /bytes=(\d+)-/.exec(req.headers.range ?? "") : null;
    const from = range ? Number(range[1]) : 0;
    seen.push(req.headers.range ?? "inteiro");
    res.writeHead(range ? 206 : 200, { "content-length": String(body.length - from) });
    const part = body.subarray(from);
    // As duas primeiras respostas caem no meio, como o servidor da Receita.
    if (drops < 2) {
      drops++;
      res.write(part.subarray(0, 1024 * 1024));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(part);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => server.close());

describe("download com retomada", () => {
  it("retoma do byte em que parou e confere o sha256", async () => {
    const o = new Origin({ token: "t" });
    const tmp = mkdtempSync(join(tmpdir(), "dl-"));
    const stats = { bytes_downloaded: 0, peak_disk_bytes: 0 };
    const r = await o.fetchFile({ name: "X.zip", url: `${base}/X.zip` }, tmp, stats);
    expect(r.size).toBe(body.length);
    expect(r.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(readFileSync(r.path).equals(body)).toBe(true);
    expect(seen[0]).toBe("inteiro");
    expect(seen.slice(1).every((s) => /^bytes=\d+-$/.test(s) && s !== "bytes=0-")).toBe(true);
  }, 120_000);
});
