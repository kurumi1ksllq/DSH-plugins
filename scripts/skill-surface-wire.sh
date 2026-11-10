#!/usr/bin/env bash
# Wire the dsh-skill-surface bundle into a DSH profile.
#
# Does NOT restart DSH unless --restart is passed: the global ~/.dsh/AGENTS.md
# requires explicit user approval for every restart, and an agent must never
# restart the host on its own.
usage() {
  cat <<'USAGE'
Usage: scripts/skill-surface-wire.sh [options]

  --profile DIR       DSH profile directory (default: $DSH_PROFILE_DIR, else
                      ${DSH_HOME:-$HOME/.dsh}/profiles/${DSH_PROFILE_NAME:-web})
  --baseline FILE     baseline snapshot path (default: <profile>/package.json.no-skill-surface.bak)
  --accept-current-as-baseline
                      snapshot the CURRENT manifest even though it is already wired
  --force             allow running from a linked git worktree
  --dry-run           print the plan; change nothing
  --restart           run "systemctl restart <unit>" at the end (user decision only)
  --service UNIT      systemd unit name (default: $DSH_SERVICE, else dsh)
  -h, --help          this text

Exit codes: 0 planned/done, 1 precondition failed, 2 bad usage.
USAGE
}
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/dsh-profile.sh
. "$here/lib/dsh-profile.sh"
repo_root=$(cd "$here/.." && pwd)

profile_arg="" baseline="" service="" force=0 restart=0 dry_run=0 accept_current=0
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile_arg=${2:?--profile needs a directory}; shift 2 ;;
    --baseline) baseline=${2:?--baseline needs a file}; shift 2 ;;
    --service) service=${2:?--service needs a unit}; shift 2 ;;
    --accept-current-as-baseline) accept_current=1; shift ;;
    --force) force=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --restart) restart=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

profile_dir=$(dsh_profile_dir "$profile_arg") || { echo "cannot resolve a DSH profile; pass --profile DIR or set DSH_HOME" >&2; exit 1; }
manifest="$profile_dir/package.json"
baseline=${baseline:-$profile_dir/package.json.no-skill-surface.bak}
pkg="$repo_root/packages/dsh-skill-surface"

[ -d "$pkg" ] || { echo "missing package: $pkg" >&2; exit 1; }
[ -f "$manifest" ] || { echo "missing profile manifest: $manifest" >&2; exit 1; }

if dsh_is_worktree "$repo_root"; then
  if [ "$force" != 1 ] && [ "$dry_run" != 1 ]; then
    echo "refusing: this checkout is a linked git worktree ($repo_root)." >&2
    echo "          the profile link would break when the worktree is removed." >&2
    echo "          run from the canonical checkout, or pass --force." >&2
    exit 1
  fi
  echo "warning: linked git worktree; the link would point at $pkg" >&2
fi

state=$(dsh_wiring_state "$manifest")
case "$state" in
  dep=1\ bundle=1) already=1 ;;
  *) already=0 ;;
esac

if [ "$already" = 1 ] && [ ! -f "$baseline" ] && [ "$accept_current" != 1 ]; then
  echo "refusing: the profile is ALREADY wired but $baseline is missing." >&2
  echo "          snapshotting now would capture a wired state as the rollback baseline." >&2
  echo "          if that is really what you want, pass --accept-current-as-baseline." >&2
  exit 1
fi

echo "[1/3] baseline: $baseline"
if [ -f "$baseline" ]; then
  echo "      exists; left untouched"
elif [ "$dry_run" = 1 ]; then
  echo "      would snapshot the current manifest here"
else
  cp "$manifest" "$baseline"
  echo "      snapshot created"
fi

echo "[2/3] wiring"
if [ "$already" = 1 ]; then
  echo "      already wired (dependency + bundles entry present); nothing to add"
else
  echo "      would add dependency dsh-skill-surface -> link:$pkg"
  echo "      would append dsh-skill-surface to dsh.profile.bundles"
  if [ "$dry_run" != 1 ]; then
    node -e '
const fs = require("node:fs");
const [manifest, linkTarget] = process.argv.slice(1);
const doc = JSON.parse(fs.readFileSync(manifest, "utf8"));
doc.dependencies ??= {};
doc.dependencies["dsh-skill-surface"] = "link:" + linkTarget;
doc.dsh ??= {};
doc.dsh.profile ??= {};
doc.dsh.profile.bundles ??= [];
if (!doc.dsh.profile.bundles.includes("dsh-skill-surface")) doc.dsh.profile.bundles.push("dsh-skill-surface");
fs.writeFileSync(manifest, JSON.stringify(doc, null, 2) + "\n");
' "$manifest" "$pkg"
    ( cd "$profile_dir" && pnpm install --prefer-offline >/dev/null )
    echo "      written; dependencies linked"
  fi
fi

unit=$(dsh_service)
echo "[3/3] restart is NOT automatic; run it yourself:"
echo "      systemctl restart $unit"
if [ "$restart" = 1 ]; then
  if [ "$dry_run" = 1 ]; then echo "      --restart ignored under --dry-run"; exit 0; fi
  echo "      --restart given: restarting $unit"
  dsh_restart_and_verify "$unit"
fi
