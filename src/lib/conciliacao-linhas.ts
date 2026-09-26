/**
 * Confere que as linhas da conciliação vieram do banco atualizado (migração
 * 0232). Sem a coluna `tem_correspondente`, toda nota apareceria como "sem
 * correspondente" — uma afirmação falsa na tela. Não entendeu = erro explícito.
 */
export const MENSAGEM_BANCO_DESATUALIZADO =
  "A conciliação precisa de uma atualização do banco de dados que ainda não foi aplicada. Nada foi mostrado para não exibir informação errada. Fale com o administrador.";

export function exigirLinhasAtualizadas<T>(linhas: T[]): T[] {
  for (const linha of linhas) {
    if (typeof (linha as { tem_correspondente?: unknown }).tem_correspondente !== "boolean") {
      throw new Error(MENSAGEM_BANCO_DESATUALIZADO);
    }
  }
  return linhas;
}
