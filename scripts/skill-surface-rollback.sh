#!/usr/bin/env bash
# Restore a DSH profile from the pre-dsh-skill-surface baseline snapshot.
#
# This is a WHOLE-FILE restore: every profile change made after the snapshot is
# rolled back with it. It does not restart DSH unless --restart is passed.
usage() {
  cat <<'USAGE'
Usage: scripts/skill-surface-rollback.sh [options]

  --profile DIR    DSH profile directory (default: $DSH_PROFILE_DIR, else
                   ${DSH_HOME:-$HOME/.dsh}/profiles/${DSH_PROFILE_NAME:-web})
  --baseline FILE  snapshot to restore (default: <profile>/package.json.no-skill-surface.bak)
  --yes            actually restore; without it, only the plan is printed
  --dry-run        same as omitting --yes
  --restart        run "systemctl restart <unit>" after restoring (user decision only)
  --service UNIT   systemd unit name (default: $DSH_SERVICE, else dsh)
  -h, --help       this text
USAGE
}
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/dsh-profile.sh
. "$here/lib/dsh-profile.sh"

profile_arg="" baseline="" service="" restart=0 dry_run=0 yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile_arg=${2:?--profile needs a directory}; shift 2 ;;
    --baseline) baseline=${2:?--baseline needs a file}; shift 2 ;;
    --service) service=${2:?--service needs a unit}; shift 2 ;;
    --yes) yes=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --restart) restart=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

profile_dir=$(dsh_profile_dir "$profile_arg") || { echo "cannot resolve a DSH profile; pass --profile DIR or set DSH_HOME" >&2; exit 1; }
manifest="$profile_dir/package.json"
baseline=${baseline:-$profile_dir/package.json.no-skill-surface.bak}
[ -f "$baseline" ] || { echo "missing baseline: $baseline (refusing to guess)" >&2; exit 1; }
[ -f "$manifest" ] || { echo "missing profile manifest: $manifest" >&2; exit 1; }
dsh_assert_manifest "$baseline" || { echo "refusing: --baseline is not a DSH profile manifest" >&2; exit 1; }
dsh_assert_manifest "$manifest" || { echo "refusing: --profile does not point at a DSH profile manifest" >&2; exit 1; }

state=$(dsh_wiring_state "$baseline")
case "$state" in
  dep=1\ bundle=1)
    echo "refusing: $baseline already CONTAINS dsh-skill-surface." >&2
    echo "          restoring it would not remove the plugin; the baseline is not a pre-install snapshot." >&2
    exit 1 ;;
esac

echo "baseline : $baseline  ($state)"
echo "current  : $manifest  ($(dsh_wiring_state "$manifest"))"
echo
echo "changes that will be LOST if you restore (whole-file):"
node -e '
const fs = require("node:fs");
const [baselineFile, currentFile] = process.argv.slice(1);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const before = read(baselineFile);
const now = read(currentFile);
const depsBefore = before?.dependencies ?? {};
const depsNow = now?.dependencies ?? {};
const added = Object.keys(depsNow).filter((k) => !(k in depsBefore));
const changed = Object.keys(depsNow).filter((k) => k in depsBefore && depsBefore[k] !== depsNow[k]);
const removed = Object.keys(depsBefore).filter((k) => !(k in depsNow));
const bundlesBefore = new Set(before?.dsh?.profile?.bundles ?? []);
const bundlesNow = now?.dsh?.profile?.bundles ?? [];
const bundleDelta = bundlesNow.filter((b) => !bundlesBefore.has(b));
console.log("  dependencies added since baseline: " + (added.join(", ") || "-"));
console.log("  dependencies changed/spec:         " + (changed.join(", ") || "-"));
console.log("  dependencies absent now:           " + (removed.join(", ") || "-"));
console.log("  bundles added since baseline:      " + (bundleDelta.join(", ") || "-"));
' "$baseline" "$manifest"
echo

unit=$(dsh_service)
if [ "$dry_run" = 1 ] || [ "$yes" != 1 ]; then
  echo "nothing changed. re-run with --yes to restore, or --dry-run to see this plan again."
  echo "after restoring, restart yourself: systemctl restart $unit"
  exit 0
fi

# Never destroy the current state without leaving a recoverable copy of it.
safety="$manifest.pre-rollback.$(date -u +%Y%m%dT%H%M%SZ)"
cp "$manifest" "$safety"
echo "      current profile saved to: $safety"
cp "$baseline" "$manifest"
echo "[1/3] profile restored from baseline"
( cd "$profile_dir" && pnpm install --prefer-offline >/dev/null )
echo "[2/3] dependencies relinked"
echo "[3/3] restart is NOT automatic; run it yourself: systemctl restart $unit"
if [ "$restart" = 1 ]; then
  echo "      --restart given: restarting $unit"
  dsh_restart_and_verify "$unit"
fi
