# CHANGELOG

One repository, eight independently versioned bundles. Every entry names the
bundle it belongs to; the tag on each release is `<package-name>@<version>`
(for example `dsh-inventory@0.2.0`).

Version discipline (enforced by `node scripts/check-bundle-versions.mjs`, wired
into `pnpm verify`): **changing a bundle's code requires bumping its version**.
A bundle whose directory has changes after its version tag fails the gate.

---

## Unreleased

### Workspace / tooling

- **Build-freshness gate (D2).** New `scripts/check-artifacts.mjs` verifies the
  `plugin/lib/` of every copy of a bundle that a DSH profile actually loads — not
  just the copy in the current checkout. It resolves `link:` targets out of
  `$DSH_HOME/profiles/*/node_modules`, so a bundle rotting in a *different*
  checkout can no longer pass while the running copy is stale.
- **Tests no longer repair the artifact they test.** `test-host-plugin.mjs` and
  `test-integration.mjs` used to copy `lib/*.mjs` into `plugin/lib/` before
  booting the bundle, which silently healed a stale build and made it
  undetectable. They now assemble a probe bundle in a temp directory
  (`test/probe-bundle.mjs`) and import that; the checkout is never written to.
- **Profile wiring check (P1-5).** New `scripts/check-profile.mjs` — read-only.
  Resolves every linked bundle, records the checkout and commit behind it, and
  reports bundles served from another checkout as warnings (today: 4 of 6 —
  see D1). Dangling links and missing entry points are hard failures.
- **Packaging discipline (P1-7/P1-8/P1-9).** New
  `scripts/check-bundle-versions.mjs` requires `engines.dsh` and a `test` script
  on every bundle, and rejects code changes that did not bump the version.
  Added `engines.dsh: ^0.2.0` to all 8 bundles; `dsh-git-bash-tool` gained its
  first tests (6) and a `test` script, so `pnpm -r --if-present` can no longer
  skip it in silence.
- `pnpm verify` now runs four gates (packages, artifacts, profile, versions);
  `pnpm gate` = `verify` + `test`.

### dsh-inventory — 0.2.1 (unreleased)

- **Fleet manifest (v2).** Several machines can publish into one document;
  each publisher owns its own section (`{ fleetVersion: 2, machines: { id: … } }`)
  and readers flatten the sections back into the v1 view, so the diff/apply
  pipeline is unchanged. A legacy v1 file reads as a one-machine fleet.
- **Stable machine identity.** `machineId` is minted once on first read and
  persisted in the sync state, so a machine keeps its section across restarts.
- **Concurrent publish converges instead of clobbering.** Git writes that lose a
  race return `conflict`; HTTP writes send `If-Match` and report 412/409 as a
  conflict, so the caller re-reads the winner's document, re-merges its own
  section and retries.
- **"Not published yet" is no longer an error.** When every transport answers
  404 the manifest is reported as `notFound`, and the panel shows an empty
  fleet instead of a read failure — the normal first-run state. A transport
  crash is still an error: only an explicit 404 from every transport may claim
  the file is missing.
- **The status path is read-only again.** `syncStatus` no longer mints a
  `machineId` (i.e. writes the state file) just to render the panel.

---

## History

Releases before this file existed were not tagged; this section records what
each bundle's current version contains so the running instance is at least
described.

### dsh-inventory 0.2.0

- Gitee and self-hosted HTTP sync transports; `repoUrl` bootstrap.

### dsh-inventory 0.1.0

- Capability inventory, capability manifest, diff/apply, panel.

### dsh-websearch-failover (bundle 0.2.0 / repo root 0.3.0)

- Multi-provider web search with failover, balance-aware routing, and a live
  HTTP integration test. The bundle directory (`plugin/`) and the repo root
  (`websearch-dsh-plugin`) currently carry two different version numbers; the
  bundle version is the one the host loads. Reconciling them is tracked under
  P1-7.

### dsh-ctx-guard 0.1.1

- Context-usage guard rails; follow-up fixes over 0.1.0.

### dsh-credential-vault 0.1.0

- Encrypted credential vault with a single-row bundle patch and no config.

### dsh-git-bash-tool 0.1.0

- Windows-only: routes the bash tool through Git Bash so commands stop landing
  in PowerShell. Untested until the packaging gate added its first tests.

### dsh-git-status 0.1.0

- Repository status panel (issues #18–#22, plus two rounds of review fixes).

### @local/dsh-prompt-inject 0.1.0

- Injects a system prompt section; declares `systemPrompt` in `inject`.

### dev-flow-skill 0.1.0

- Development flow skill bundle.
