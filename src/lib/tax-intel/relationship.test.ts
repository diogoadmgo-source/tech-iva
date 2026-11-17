import { describe, expect, it } from "vitest";

import { parseRelationship } from "./relationship";

describe("tipo de relacionamento", () => {
  it("vazio devolve null (vale o padrão da importação)", () => {
    expect(parseRelationship("")).toBeNull();
    expect(parseRelationship("   ")).toBeNull();
    expect(parseRelationship(null)).toBeNull();
  });

  it("reconhece variações com caixa, acento e espaços", () => {
    expect(parseRelationship(" CLIENTE ")).toEqual(["cliente"]);
    expect(parseRelationship("Fornecedores")).toEqual(["fornecedor"]);
    expect(parseRelationship("F")).toEqual(["fornecedor"]);
    expect(parseRelationship("Cliente  e  Fornecedor")).toEqual(["cliente", "fornecedor"]);
    expect(parseRelationship("Ambos")).toEqual(["cliente", "fornecedor"]);
    expect(parseRelationship("c/f")).toEqual(["cliente", "fornecedor"]);
  });

  it("texto desconhecido devolve lista vazia (relacionamento inválido)", () => {
    expect(parseRelationship("parceiro")).toEqual([]);
    expect(parseRelationship("transportadora")).toEqual([]);
  });
});
