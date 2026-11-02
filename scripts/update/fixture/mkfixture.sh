#!/usr/bin/env bash
# Throwaway profile + repo that mimics the live wiring, so the update tool can
# be exercised end-to-end without touching the real profile.
#
#   bash scripts/update/fixture/mkfixture.sh /tmp/upd-fixture
#
# main carries fixture-bundle@0.1.0, next carries fixture-bundle@0.2.0, so
# "an update" is main -> next.
set -euo pipefail

ROOT=${1:?usage: mkfixture.sh <dir>}
rm -rf "$ROOT"
mkdir -p "$ROOT/profile/node_modules" "$ROOT/state"

REPO="$ROOT/checkout/DSH-plugins"
mkdir -p "$REPO/packages/fixture-bundle/lib"
cd "$REPO"
git init -q -b main
git config user.email fixture@example.invalid
git config user.name fixture

cat > package.json <<'JSON'
{ "name": "fixture-workspace", "private": true, "version": "0.0.0", "type": "module" }
JSON

cat > packages/fixture-bundle/package.json <<'JSON'
{
  "name": "fixture-bundle",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" } }
}
JSON
echo 'name: fixture-bundle' > packages/fixture-bundle/cordis.patch.yml
echo 'export const version = "0.1.0"' > packages/fixture-bundle/index.js
git add -A
git commit -qm "feat: fixture 0.1.0"
git tag -a "fixture-bundle@0.1.0" -m "fixture-bundle@0.1.0"

# A second generation on its own branch: this is what an update targets.
git checkout -q -b next
echo 'export const version = "0.2.0"' > packages/fixture-bundle/index.js
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('packages/fixture-bundle/package.json')
data = json.loads(p.read_text())
data['version'] = '0.2.0'
p.write_text(json.dumps(data, indent=2) + "\n")
PY
git commit -qam "feat: fixture 0.2.0"
git tag -a "fixture-bundle@0.2.0" -m "fixture-bundle@0.2.0"
git checkout -q main

# A real bare remote, so fetch and @{u} behave like the live checkout.
git clone -q --bare "$REPO" "$ROOT/upstream.git"
git remote add origin "$ROOT/upstream.git"
git push -q origin main next 2>/dev/null
git fetch -q origin
git branch -q --set-upstream-to=origin/main main
git branch -q -D next 2>/dev/null || true

# The profile links the OLD generation, like the live profile does.
ln -s "$REPO/packages/fixture-bundle" "$ROOT/profile/node_modules/fixture-bundle"
python3 - "$ROOT" <<'PY'
import json, pathlib, sys
root = sys.argv[1]
profile = {
    "name": "fixture-profile",
    "private": True,
    "dependencies": {"fixture-bundle": f"link:{root}/checkout/DSH-plugins/packages/fixture-bundle"},
    "dsh": {"profile": {"bundles": ["fixture-bundle"]}},
}
pathlib.Path(f"{root}/profile/package.json").write_text(json.dumps(profile, indent=2) + "\n")
PY
echo 'packages:' > "$ROOT/profile/pnpm-workspace.yaml"
echo 'regenerate me' > "$ROOT/profile/cordis.patch.yml"

echo "fixture ready: $ROOT"
