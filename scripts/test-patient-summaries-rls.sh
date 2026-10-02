#!/usr/bin/env bash
# Uses installed PostgreSQL only. No Supabase login, Docker, or API key needed.
# Run: bash scripts/test-patient-summaries-rls.sh
set -euo pipefail

for executable in initdb pg_ctl psql; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Required installed PostgreSQL executable is missing: %s\n' "$executable" >&2
    exit 1
  fi
done

task_repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
task_rls_dir=$(mktemp -d /tmp/medical-notes-rls.XXXXXX)
task_server_started=0

cleanup() {
  task_exit_code=$?
  trap - EXIT
  if (( task_server_started )); then
    if ! pg_ctl -D "$task_rls_dir/data" -m fast -t 10 stop >"$task_rls_dir/stop.log" 2>&1; then
      cat "$task_rls_dir/stop.log" >&2
      printf 'Local test server could not be stopped; files retained at %s\n' "$task_rls_dir" >&2
      exit 1
    fi
  fi
  if (( task_exit_code != 0 )); then
    for task_log in "$task_rls_dir/initdb.log" "$task_rls_dir/postgres.log"; do
      if [[ -f "$task_log" ]]; then cat "$task_log" >&2; fi
    done
  fi
  rm -rf -- "$task_rls_dir"
  exit "$task_exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# All connections use this process's private Unix socket. TCP is disabled.
# Avoid inheriting database connection or authentication settings.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE
unset PGOPTIONS PGPASSWORD PGPASSFILE
mkdir "$task_rls_dir/socket"
chmod 700 "$task_rls_dir/socket"
initdb -D "$task_rls_dir/data" --username=medical_notes_test_admin \
  --auth-local=trust --auth-host=reject --encoding=UTF8 --no-locale \
  --no-instructions >"$task_rls_dir/initdb.log" 2>&1
pg_ctl -D "$task_rls_dir/data" -l "$task_rls_dir/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$task_rls_dir/socket'" \
  -t 10 start
task_server_started=1

psql -X -w -v ON_ERROR_STOP=1 -h "$task_rls_dir/socket" \
  -U medical_notes_test_admin -d postgres \
  -c 'CREATE DATABASE medical_notes_rls_test'
psql -X -w -v ON_ERROR_STOP=1 -h "$task_rls_dir/socket" \
  -U medical_notes_test_admin -d medical_notes_rls_test \
  -f "$task_repo_root/supabase/tests/patient_summaries_rls.sql"
