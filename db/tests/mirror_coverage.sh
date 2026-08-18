#!/usr/bin/env bash
# Teste de espelho: toda função de public no banco precisa aparecer em db/migrations.
#
# Uso:
#   DATABASE_URL=postgres://... bash db/tests/mirror_coverage.sh
#   bash db/tests/mirror_coverage.sh lista.txt   # lista de nomes (um por linha/espaço)
#
# Sem conexão E sem lista o teste FALHA em vez de dizer "100%": um verde obtido
# comparando zero função contra zero arquivo é pior do que nenhum teste.
set -uo pipefail
cd "$(dirname "$0")/../.."

SQL="select distinct proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1"
if [ "${1:-}" != "" ] && [ -f "$1" ]; then
  FUNCS=$(tr -s ' \t\n' '\n' < "$1" | grep -v '^$')
elif [ -n "${DATABASE_URL:-}" ]; then
  FUNCS=$(psql "$DATABASE_URL" -At -c "$SQL")
else
  FUNCS=$(psql -At -c "$SQL")
fi

if [ -z "${FUNCS// /}" ]; then
  echo "FALHOU: não obtive a lista de funções do banco (defina DATABASE_URL ou passe um arquivo)." >&2
  exit 2
fi

total=0; ok=0; missing=()
for f in $FUNCS; do
  total=$((total+1))
  if grep -rqE "function[[:space:]]+(public\.)?${f}[[:space:]]*\(" db/migrations; then
    ok=$((ok+1))
  else
    missing+=("$f")
  fi
done
echo "funções em public: $total"
echo "espelhadas em db/migrations: $ok"
if [ ${#missing[@]} -gt 0 ]; then
  echo "SEM ESPELHO (${#missing[@]}):"; printf ' - %s\n' "${missing[@]}"; exit 1
fi
echo "OK — cobertura de espelho 100%"
