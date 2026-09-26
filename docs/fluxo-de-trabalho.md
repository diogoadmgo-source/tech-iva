# Fluxo de trabalho

## Antes de clicar em Publicar

    bash scripts/pronto-para-publicar.sh

Só publique se a última linha for **PRONTO PARA PUBLICAR**.

O motivo: em 16/09/2026 seis correções estavam gravadas só numa máquina.
A publicação subiu a versão antiga e duas consultas da Receita foram gastas
rodando um defeito que já estava corrigido.

## Quem mexe no código

Duas fontes escrevem na mesma branch `main`:

- **O Lovable**, quando você pede algo no editor dele — envia sozinho.
- **Edição local** (Claude Code ou manual) — só chega ao Lovable depois de `git push`.

Por isso: **antes de começar a mexer localmente, traga o que o Lovable fez**
(`git pull --no-rebase origin main`). E não peça ao Lovable para mexer num
arquivo que está sendo mexido localmente ao mesmo tempo — em 16/09 as duas
fontes corrigiram o mesmo defeito no mesmo arquivo, de jeitos diferentes.

## Banco de dados

- Migração nova: `supabase/migrations/AAAAMMDDHHMMSS_NNNN_descricao.sql`.
- `db/migrations/` **não** é a fonte da verdade (ver o LEIA-ME de lá).
- A migração só existe em produção depois de rodada no SQL Editor do Supabase.
  Gravar o arquivo no projeto não aplica nada.
- Arquivos prontos para colar no SQL Editor ficam em `docs/colar-no-supabase/`
  (fora do controle de versão; a migração em si é que fica versionada em
  `supabase/migrations/`).

## Ordem: publicar o código antes de colar mudanças do banco

Regra: **sempre publique o código mais recente ANTES de colar uma migração**
no SQL Editor. Migração nova costuma mudar o que o banco devolve (por exemplo,
passar a devolver "sem valor" onde antes devolvia zero), e só o código novo
sabe mostrar isso direito.

A ordem desta rodada (Fase 0), passo a passo:

1. Publicar a versão com a Tarefa 6 (commit `ae1b6eb` ou posterior), depois de
   `bash scripts/pronto-para-publicar.sh` dizer **PRONTO PARA PUBLICAR**.
2. Colar no SQL Editor as migrações 0231, 0232, 0233 e 0234 (arquivos em
   `docs/colar-no-supabase/`). Entre si, a ordem não importa.
3. Só então fazer a consulta do experimento (plano da Fase 0, Tarefa 4, Passo 9).

Por quê: a versão publicada antes da Tarefa 6 mostraria "Seu cálculo bate com
a apuração da Receita" sem ter comparado nada, assim que a primeira apuração
chegasse.

## Verificação automática

Todo envio para a `main` roda tipos e testes no GitHub
(`.github/workflows/verificacao.yml`), inclusive os envios do Lovable.
Se ficar vermelho, **não publique** até entender por quê.
