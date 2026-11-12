#!/usr/bin/env bash
set -euo pipefail

export PGPASSWORD="${TEST_RUNTIME_PASSWORD:?TEST_RUNTIME_PASSWORD is required}"
psql_args=(-X -v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U paypilot_staging_runtime -d "${PGDATABASE:-paypilot_test}")

# Two independent connections update the same tenant row concurrently.
psql "${psql_args[@]}" -q -c "BEGIN; SELECT set_config('app.tenant_id','rls-test-tenant-a',true); UPDATE public.paypilot_tenant_state SET version=version+1,updated_at=now() WHERE tenant_id='rls-test-tenant-a'; SELECT pg_sleep(1); COMMIT;" &
pid_a=$!
psql "${psql_args[@]}" -q -c "BEGIN; SELECT set_config('app.tenant_id','rls-test-tenant-a',true); UPDATE public.paypilot_tenant_state SET version=version+1,updated_at=now() WHERE tenant_id='rls-test-tenant-a'; COMMIT;" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

# Read from a fresh connection to prove committed state survives connection/process turnover.
actual=$(psql "${psql_args[@]}" -qAt -c "BEGIN; SELECT set_config('app.tenant_id','rls-test-tenant-a',true); SELECT version FROM public.paypilot_tenant_state WHERE tenant_id='rls-test-tenant-a'; COMMIT;" | tail -n 1)
if [[ "$actual" != "2" ]]; then
  echo "Expected persisted version 2 after two concurrent commits; got: $actual" >&2
  exit 1
fi
echo "PASS: both concurrent writes committed; fresh connection observed version $actual"
