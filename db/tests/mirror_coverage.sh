#!/usr/bin/env bash
# Teste de espelho: toda função de public no banco precisa aparecer em db/migrations.
# Uso: bash db/tests/mirror_coverage.sh   (requer PGHOST/psql da sessão)
set -uo pipefail
cd "$(dirname "$0")/../.."

FUNCS=$(psql -At -c "select distinct proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1")
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
