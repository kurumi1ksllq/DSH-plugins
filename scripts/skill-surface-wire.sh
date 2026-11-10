#!/usr/bin/env bash
# Wire the dsh-skill-surface bundle into a DSH profile.
#
# Deliberately does NOT restart DSH by itself: the global ~/.dsh/AGENTS.md
# requires explicit user approval for every restart, and an agent must never
# restart the host on its own. Pass --restart only when YOU decided to.
#
# Usage:
#   scripts/skill-surface-wire.sh [--profile DIR] [--restart] [--dry-run]
#
# Defaults: --profile "$DSH_PROFILE_DIR", or ~/.dsh/profiles/web
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case "$repo_root" in
  *"/.agents/worktrees/"*)
    echo "warning: this checkout is a session worktree." >&2
    echo "         the profile link would point at that worktree and break when it is removed." >&2
    echo "         run this script from the canonical checkout instead." >&2
    ;;
esac
profile_dir=${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}
restart=0
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile_dir=${2:?--profile needs a directory}; shift 2 ;;
    --restart) restart=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) sed -n "2,14p" "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

pkg="$repo_root/packages/dsh-skill-surface"
manifest="$profile_dir/package.json"
[ -d "$pkg" ] || { echo "missing package: $pkg" >&2; exit 1; }
[ -f "$manifest" ] || { echo "missing profile manifest: $manifest" >&2; exit 1; }

baseline="$profile_dir/package.json.no-skill-surface.bak"
if [ ! -f "$baseline" ]; then
  if [ "$dry_run" = 1 ]; then
    echo "[dry-run] would snapshot $manifest -> $baseline"
  else
    cp "$manifest" "$baseline"
    echo "[1/3] baseline snapshot: $baseline"
  fi
else
  echo "[1/3] baseline already exists: $baseline"
fi

if [ "$dry_run" = 1 ]; then
  echo "[dry-run] would add dependency dsh-skill-surface -> link:$pkg"
  echo "[dry-run] would append dsh-skill-surface to dsh.profile.bundles"
  echo "[dry-run] would run: pnpm install (in $profile_dir)"
else
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
console.log("[2/3] wired; bundles=" + doc.dsh.profile.bundles.length);
' "$manifest" "$pkg"
  ( cd "$profile_dir" && pnpm install --prefer-offline >/dev/null )
  echo "[2/3] dependencies linked"
fi

echo "[3/3] restart is NOT automatic."
echo "      verify first:  dsh --profile $(basename "$profile_dir") --dump-config | grep -E \"skill-filesystem-global|skill-surface\""
echo "      then, yourself: systemctl restart dsh"
if [ "$restart" = 1 ]; then
  echo "      --restart given: restarting now"
  systemctl restart dsh
  sleep 2
  systemctl --no-pager --lines=5 status dsh || true
fi
