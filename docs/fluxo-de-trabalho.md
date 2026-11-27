# Fluxo de trabalho

## Como o código vai para produção

Desde a saída do Lovable (novembro de 2026), o app roda na **Vercel**, ligada a
este repositório no GitHub:

- Todo merge na `main` publica sozinho em produção (`techiva.com.br`).
- Todo pull request ganha um deploy de **preview** com URL própria. Teste nele
  antes de fazer o merge.
- Para voltar uma versão, use *Instant Rollback* no painel da Vercel.

Não existe mais o botão "Publicar" nem o editor do Lovable escrevendo na `main`.
O script `pronto-para-publicar.sh` foi removido: o deploy sai do GitHub, então
uma alteração que ficou só numa máquina simplesmente não é publicada.

## Banco de dados

- Migração nova: `supabase/migrations/AAAAMMDDHHMMSS_NNNN_descricao.sql`.
- `db/migrations/` **não** é a fonte da verdade (ver o LEIA-ME de lá).
- A migração só existe em produção depois de aplicada com o Supabase CLI
  (`supabase db push --dry-run`, conferir a lista, depois `supabase db push`).
  Gravar o arquivo no projeto não aplica nada. O passo a passo e as regras estão
  em `supabase/migrations/README.md`. Desde 17/11/2026, não se cola mais migração
  no SQL Editor nem se aplica pelo MCP: os dois deixam o histórico diferente do
  repositório.

## Ordem: publicar o código antes de aplicar mudanças do banco

Regra: **sempre publique o código mais recente (merge na `main`) ANTES de aplicar uma migração**,
a menos que o cabeçalho da migração diga o contrário (a 0235, por exemplo, exige
o banco antes do código). Migração nova costuma mudar o que o banco devolve (por exemplo,
passar a devolver "sem valor" onde antes devolvia zero), e só o código novo
sabe mostrar isso direito.

### Histórico: rodada da Fase 0 (já concluída, não repetir)

Registro do que foi feito antes de 17/11/2026, mantido só como histórico. **Não é
instrução vigente.** As migrações 0231 a 0234 já estão aplicadas no fluxa-dev:
foram coladas no SQL Editor naquela época e depois registradas no histórico com
`supabase migration repair`. Hoje, qualquer migração nova segue apenas o
procedimento com o Supabase CLI descrito em `supabase/migrations/README.md`.

O que foi feito, na ordem:

1. Publicada a versão com a Tarefa 6 (commit `ae1b6eb` ou posterior), depois de
   `bash scripts/pronto-para-publicar.sh` dizer **PRONTO PARA PUBLICAR**.
2. Aplicadas as migrações 0231, 0232, 0233 e 0234 pelo SQL Editor (os arquivos
   estão em `supabase/migrations/`).
3. Feita a consulta do experimento (plano da Fase 0, Tarefa 4, Passo 9).

O motivo da ordem: a versão publicada antes da Tarefa 6 mostraria "Seu cálculo
bate com a apuração da Receita" sem ter comparado nada, assim que a primeira
apuração chegasse.

## Verificação automática

Todo envio para a `main` roda tipos e testes no GitHub
(`.github/workflows/verificacao.yml`).
Se ficar vermelho, **não faça o merge** até entender por quê.
