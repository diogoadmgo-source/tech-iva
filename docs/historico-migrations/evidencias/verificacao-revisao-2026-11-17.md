# Verificação após os ajustes da revisão — 17/11/2026

Instalação limpa: `bun install --frozen-lockfile` (pg 8.16.3 em devDependencies).

```
## 1) só o repositório
139 arquivos em supabase/migrations/

OK: nenhum problema encontrado.
saída: 0

## 2) contra as 138 versões do fluxa-dev lidas em 17/11/2026 (arquivo, sem conexão)
139 arquivos em supabase/migrations/
138 versões lidas de docs/historico-migrations/evidencias/versoes-fluxa-dev-2026-11-17.txt
última versão registrada: 20260923200000
seriam aplicadas (1):
  20260926030000_0235_retorno_da_receita_registrado_e_24h.sql

OK: nenhum problema encontrado.
saída: 0

## 3) via DATABASE_URL (usa o pacote pg), contra o Supabase LOCAL de testes, não o fluxa-dev
## (o banco local tem 0240/0241 e 2 fixtures locais, que não existem nesta branch: os problemas abaixo são esperados e provam a detecção)
139 arquivos em supabase/migrations/
143 versões registradas no banco
última versão registrada: 20261117200100
seriam aplicadas (0):

PROBLEMAS (4):
  - registrada no banco sem arquivo no repositório: 20260817192809
  - registrada no banco sem arquivo no repositório: 20260817211331
  - registrada no banco sem arquivo no repositório: 20261117200000
  - registrada no banco sem arquivo no repositório: 20261117200100
saída: 1

## 4) sem o pacote instalado (node_modules removido)
139 arquivos em supabase/migrations/
Pacote `pg` não encontrado. Rode `bun install` (ele está em devDependencies).
saída: 2
```
