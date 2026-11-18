#!/usr/bin/env bash
# Suíte SQL da Inteligência Tributária num Postgres DESCARTÁVEL.
#
# Cria um banco novo, aplica o ambiente mínimo do Supabase (stubs), as
# migrations 0240+ do módulo e roda cada arquivo db/tests/tax_intel/[1-9]*.sql.
# Nunca aponte para o Supabase: o script recusa host *.supabase.co.
#
# Variáveis: PGHOST, PGPORT, PGUSER, PGPASSWORD (superusuário do Postgres de teste),
#            TAX_TEST_DB (padrão tax_intel_test), TAX_LOAD_ROWS (padrão 70000).
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${TAX_TEST_DB:-tax_intel_test}"
if [[ "${PGHOST:-}" == *supabase* ]]; then echo "Recusado: isto não roda contra o Supabase." >&2; exit 2; fi

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -v load_rows="${TAX_LOAD_ROWS:-70000}" -d "$DB")
dropdb --if-exists "$DB" >/dev/null
createdb "$DB"
# Como no Supabase: o search_path padrão inclui o schema extensions.
psql -X -q -d "$DB" -c "alter database \"$DB\" set search_path = \"\$user\", public, extensions"

"${PSQL[@]}" -f db/tests/tax_intel/00_supabase_stubs.sql
# Privilégios padrão como no fluxa-dev (pg_default_acl do papel postgres no schema public,
# lido em 17/11/2026): tabelas, sequências e funções novas já nascem com acesso para
# authenticated. As migrations do módulo precisam revogar isso explicitamente.
"${PSQL[@]}" -c "alter default privileges for role postgres in schema public grant all on tables to authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on sequences to authenticated, service_role;
  alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;"
for m in supabase/migrations/*_02[45][0-9]_inteligencia_tributaria_*.sql; do
  echo "== migration $(basename "$m")"
  "${PSQL[@]}" -f "$m"
done
"${PSQL[@]}" -f db/tests/tax_intel/05_helpers_fixtures.sql

# Casos de CNPJ gerados pela implementação TypeScript.
CASES="$(mktemp)"
node --experimental-strip-types --no-warnings scripts/tax-intel/gen-cnpj-cases.ts > "$CASES"
"${PSQL[@]}" -c "create table t.ts_cases (cnpj text, valid boolean); grant select on t.ts_cases to authenticated;"
"${PSQL[@]}" -c "\\copy t.ts_cases from '$CASES' with (format csv, header true)"
rm -f "$CASES"

for f in db/tests/tax_intel/[1-9]*.sql; do
  echo "== $(basename "$f")"
  "${PSQL[@]}" -f "$f" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p'
done

echo
"${PSQL[@]}" -A -t -c "select format('%s testes · %s PASS · %s FAIL', count(*), count(*) filter (where ok), count(*) filter (where not ok)) from t.results"
FAILS=$("${PSQL[@]}" -A -t -c "select count(*) from t.results where not ok")
if [[ "$FAILS" != "0" ]]; then
  "${PSQL[@]}" -A -t -c "select suite || ' :: ' || name || ' :: ' || coalesce(detail,'') from t.results where not ok"
  exit 1
fi
