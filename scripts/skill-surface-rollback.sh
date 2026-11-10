#!/usr/bin/env bash
# Restore a DSH profile from the pre-dsh-skill-surface baseline snapshot.
#
# This is a WHOLE-FILE restore: every profile change made after the snapshot
# is rolled back with it, not just the dsh-skill-surface rows. It does not
# restart DSH unless --restart is passed.
#
# Usage:
#   scripts/skill-surface-rollback.sh [--profile DIR] [--baseline FILE] [--restart] [--dry-run]
set -euo pipefail

profile_dir=${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}
restart=0
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile_dir=${2:?--profile needs a directory}; shift 2 ;;
    --baseline) baseline=${2:?--baseline needs a file}; shift 2 ;;
    --restart) restart=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) sed -n "2,12p" "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

baseline=${baseline:-$profile_dir/package.json.no-skill-surface.bak}
[ -f "$baseline" ] || { echo "missing baseline: $baseline (refusing to guess)" >&2; exit 1; }

node -e '
const fs = require("node:fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const bundles = doc?.dsh?.profile?.bundles ?? [];
console.log("baseline bundles=" + bundles.length + ", contains dsh-skill-surface=" + bundles.includes("dsh-skill-surface"));
' "$baseline"

if [ "$dry_run" = 1 ]; then
  echo "[dry-run] would copy $baseline -> $profile_dir/package.json and run pnpm install"
  exit 0
fi

cp "$baseline" "$profile_dir/package.json"
echo "[1/3] profile restored from baseline"
( cd "$profile_dir" && pnpm install --prefer-offline >/dev/null )
echo "[2/3] dependencies relinked"
echo "[3/3] restart is NOT automatic; run it yourself: systemctl restart dsh"
if [ "$restart" = 1 ]; then
  systemctl restart dsh
  sleep 2
  systemctl --no-pager --lines=5 status dsh || true
fi
