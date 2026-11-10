#!/usr/bin/env bash
# Shared resolution for the skill-surface ops scripts.
# Sourced, never executed. Keeps one definition of "which profile / which unit".

# Resolve the DSH profile directory:
#   --profile DIR  >  $DSH_PROFILE_DIR  >  ${DSH_HOME:-$HOME/.dsh}/profiles/${DSH_PROFILE_NAME:-web}
# Fails loudly instead of guessing when no home is available.
dsh_profile_dir() {
  if [ -n "${1:-}" ]; then printf "%s" "$1"; return 0; fi
  if [ -n "${DSH_PROFILE_DIR:-}" ]; then printf "%s" "$DSH_PROFILE_DIR"; return 0; fi
  local base=${DSH_HOME:-}
  if [ -z "$base" ]; then
    if [ -z "${HOME:-}" ]; then return 1; fi
    base="$HOME/.dsh"
  fi
  printf "%s/profiles/%s" "$base" "${DSH_PROFILE_NAME:-web}"
}

# systemd unit name, overridable for hosts that do not use dsh.service.
dsh_service() { printf "%s" "${DSH_SERVICE:-dsh}"; }

# Whether this checkout is a linked git worktree (its git dir differs from the common dir).
dsh_is_worktree() {
  local repo=$1 gitdir commondir
  gitdir=$(git -C "$repo" rev-parse --git-dir 2>/dev/null) || return 1
  commondir=$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null) || return 1
  gitdir=$(cd "$repo" && cd "$gitdir" 2>/dev/null && pwd -P) || return 1
  commondir=$(cd "$repo" && cd "$commondir" 2>/dev/null && pwd -P) || return 1
  [ "$gitdir" != "$commondir" ]
}

# Print the profile state this plugin cares about, as `dep=<0|1> bundle=<0|1>`
dsh_wiring_state() {
  node -e '
const fs = require("node:fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const dep = Boolean(doc?.dependencies?.["dsh-skill-surface"]);
const bundle = (doc?.dsh?.profile?.bundles ?? []).includes("dsh-skill-surface");
console.log("dep=" + Number(dep) + " bundle=" + Number(bundle));
' "$1"
}

# Assert that a file looks like a DSH profile manifest (has a non-empty bundles list).
# Guards --baseline/--profile against silently pointing at unrelated JSON.
dsh_assert_manifest() {
  node -e '
const fs = require("node:fs");
const file = process.argv[1];
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const bundles = doc?.dsh?.profile?.bundles;
if (!Array.isArray(bundles) || bundles.length === 0) {
  console.error("not a DSH profile manifest (dsh.profile.bundles missing or empty): " + file);
  process.exit(1);
}
' "$1"
}

# Restart a unit and PROVE it came back; never swallow the only success signal.
dsh_restart_and_verify() {
  local unit=$1 tries=0
  systemctl restart "$unit" || { echo "restart failed: $unit" >&2; return 1; }
  while [ "$tries" -lt 10 ]; do
    if systemctl is-active --quiet "$unit"; then
      echo "      $unit is active"
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  echo "restart unverified: $unit is not active after 10s" >&2
  echo "inspect: journalctl -u $unit -n 30 --no-pager" >&2
  return 1
}
