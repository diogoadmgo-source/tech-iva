# Implantação no fluxa-dev — roteiro de execução (17/11/2026)

Nada abaixo foi executado no fluxa-dev. Este roteiro aguarda autorização.

## Estado lido do fluxa-dev (somente leitura, 20:58 UTC)

* 138 versões no histórico. A última é `20260923200000`. A lista é idêntica à lida às 20h.
* As funções que a 0235 troca estão como em 26/09, e a definição completa foi guardada em `rollback-0235.sql`.
* Não existe nenhuma tabela ou bucket do módulo: a instalação da 0240/0241 parte do zero.
* Plano Supabase Pro, que inclui backup diário. A existência de PITR precisa ser conferida no painel.

## Conta do dry-run (repositório PR #2 + PR #1 contra as 138 versões)

`evidencias/dryrun-equivalente-2026-11-17.txt`:

```
seriam aplicadas (3):
  20260926030000_0235_retorno_da_receita_registrado_e_24h.sql
  20261117200000_0240_inteligencia_tributaria_fundacao.sql
  20261117200100_0241_inteligencia_tributaria_importacao.sql
OK: nenhum problema encontrado.
```

Essa é a mesma conta que o `supabase db push --dry-run` faz. O dry-run oficial do CLI ainda
precisa rodar numa máquina com acesso ao banco, porque esta sandbox não alcança `*.supabase.co`.

## Ordem

1. Confirmar que o "Deploy to production" está desligado e que existe backup recente.
2. `supabase db push --dry-run`: a lista tem que ser exatamente 0235, 0240 e 0241.
3. `supabase db push`, que aplica os três arquivos em ordem de versão:
   * 0235: só aumenta capacidade; o código atual da `main` já chama `p_meta`;
   * 0240: fundação do módulo;
   * 0241: importação.
4. Conferir: histórico (141 versões), as 16 tabelas, as funções `tax_*`, RLS, permissões e os 2 buckets.
5. Merge do PR #2 e depois do PR #1, com o lock de dependências resolvido. Por fim, publicar o app.

## PR #3 (0250, outra frente)

A versão dele é `20261117210000`, posterior à 0241. Ele só pode ser aplicado **depois** da
0240/0241. Se fosse aplicado antes, a 0240/0241 ficariam fora de ordem e só entrariam com
`--include-all`, que é proibido. O merge dele também depende do PR #2, porque a `main` ainda tem
as duplicatas.

## Reversão

* 0240/0241: `rollback-0240-0241.sql`, testado em ciclo no banco local.
* 0235: `rollback-0235.sql`. Ele volta as funções de 26/09, mas aí o retorno da Receita volta a falhar com o código da `main`.
* Banco inteiro: restauração do backup diário ou PITR, pelo painel do Supabase.
