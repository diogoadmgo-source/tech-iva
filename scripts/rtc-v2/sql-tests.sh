#!/usr/bin/env bash
# Suíte SQL da 0260 (apuração CBS v2: cota por API, aviso do webhook,
# ingestão v2 e DARF) num Postgres DESCARTÁVEL. Nunca aponte para o Supabase.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${RTC_TEST_DB:-rtc_v2_test}"
if [[ "${PGHOST:-}" == *supabase* ]]; then echo "Recusado: isto não roda contra o Supabase." >&2; exit 2; fi
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null
createdb "$DB"
psql -X -q -d "$DB" -c "alter database \"$DB\" set search_path = \"\$user\", public, extensions"
"${PSQL[@]}" -f db/tests/tax_intel/00_supabase_stubs.sql
"${PSQL[@]}" -c "alter default privileges for role postgres in schema public grant all on tables to authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on sequences to authenticated, service_role;
  alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;"
"${PSQL[@]}" -f db/tests/rtc_v2/01_rtc_stubs.sql
"${PSQL[@]}" -f supabase/migrations/20261119020000_0260_cbs_v2_darf_recolhimentos.sql
# aplicar duas vezes: a migration precisa ser reexecutável
"${PSQL[@]}" -f supabase/migrations/20261119020000_0260_cbs_v2_darf_recolhimentos.sql
for f in db/tests/rtc_v2/[1-9]*.sql; do echo "== $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
dropdb "$DB"
echo "Suíte SQL rtc v2: OK"
