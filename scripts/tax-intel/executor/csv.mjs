// CSV da Receita: separador ";", campos entre aspas, ISO-8859-1, sem cabeçalho.
// Para varrer dezenas de milhões de linhas, só a 1ª coluna é extraída de cada
// linha (para checar se pertence à carteira); a linha inteira só é decodificada
// quando casa.

/** Divide uma linha CSV em campos (aspas duplicadas = aspas literais). */
export function parseLine(line, sep = ";") {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let v = "";
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q < 0) { v += line.slice(i); i = n; break; }
        v += line.slice(i, q);
        if (line[q + 1] === '"') { v += '"'; i = q + 2; continue; }
        i = q + 1;
        break;
      }
      out.push(v);
      const s = line.indexOf(sep, i);
      if (s < 0) break;
      i = s + 1;
    } else {
      const s = line.indexOf(sep, i);
      if (s < 0) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, s));
      i = s + 1;
      if (i === n) { out.push(""); break; }
    }
  }
  return out;
}

/** 1ª coluna, sem aspas, sem decodificar o resto da linha. */
export function firstField(line, sep = ";") {
  if (line.charCodeAt(0) === 34) {
    const q = line.indexOf('"', 1);
    return q < 0 ? line.slice(1) : line.slice(1, q);
  }
  const s = line.indexOf(sep);
  return s < 0 ? line : line.slice(0, s);
}

/**
 * Lotes de linhas de um stream de bytes em ISO-8859-1 (um lote por pedaço lido,
 * para não pagar um await por linha). Linhas vazias são descartadas.
 */
export async function* lineBatches(stream, encoding = "latin1") {
  let rest = "";
  for await (const chunk of stream) {
    const text = rest + chunk.toString(encoding);
    const parts = text.split("\n");
    rest = parts.pop();
    const batch = [];
    for (const p of parts) {
      const l = p.charCodeAt(p.length - 1) === 13 ? p.slice(0, -1) : p;
      if (l.length) batch.push(l);
    }
    if (batch.length) yield batch;
  }
  const l = rest.endsWith("\r") ? rest.slice(0, -1) : rest;
  if (l.length) yield [l];
}
