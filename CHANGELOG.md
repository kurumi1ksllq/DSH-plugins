# CHANGELOG

One repository, eight independently versioned bundles. Every entry names the
bundle it belongs to; the tag on each release is `<package-name>@<version>`
(for example `dsh-inventory@0.2.0`).

Version discipline (enforced by `node scripts/check-bundle-versions.mjs`, wired
into `pnpm verify`): **changing a bundle's code requires bumping its version**.
A bundle whose directory has changes after its version tag fails the gate.

---

## Unreleased

### dev-flow-skill 0.2.1 — the dual-axis review prompt now actually ships

- **停点3 的双轴 review 有了可复制的模板。** 原文只写「用下面的**固定 prompt 模板**」,
  下面却是空的,于是每次 review 都由执行者临场重建,两条轴的内容随会话漂移。现在模板
  以代码块形式落在 `SKILL.md` 里(轴1 对 spec、轴2 对规范),并明确「只报告不修改任何
  文件」「至少 3 个问题,确实找不到就写未发现问题」。
- 契约 `test/review-template.test.mjs`:模板块必须同时含两条轴、必须要求「只报告」
  与「spec + 完整 diff」输入;把模板删掉即红。


### dsh-credential-vault 0.2.1 / dsh-inventory 0.5.0 — vault joins the Tools page

- **"Leave empty to keep the stored secret" now actually works.** The editor always
  sent an empty secret when only metadata changed, and the host rejected it with
  400. `/set` now keeps the sealed value for an existing entry, and still refuses
  to create one without a secret.
- **Cancelling a delete or rotation is a no-op again.** The confirmation ran inside
  the busy wrapper, so cancelling still reloaded the panel and cleared the error
  message the user was reading.
- **Error responses never forward `error.message`.** A future throw that
  interpolated secret material would have gone straight onto the wire.
- The three bundle client halves are now dictionary-only: the migrated sidebar
  panels (Icon/Page/styles, ~860 lines total) are deleted rather than left behind
  as a second, unowned copy of the same UI.

- The credential manager moved into `dsh-inventory`'s 工具管理 panel, right next
  to the `credential` tool it backs: a 「凭据保险库」 segmented tab plus a
  collapsible overview section (masked list, detail card, add/edit form with
  "leave empty to keep the stored secret", delete, master-key rotation, reveal
  audit log). Same routes, same guarantees — no route returns plaintext, and the
  panel only ever renders the masked `preview`.
- `dsh-credential-vault`'s client half now registers **only its locale
  dictionary** (`inject: ['locale']`); the host half (vault store, `credential`
  tool, audit log, API) is untouched. With web-search providers and the prompt
  editor, all three former sidebar panels now live on one page.

### dsh-inventory 0.4.0 / dsh-websearch-failover 0.3.0 / @local/dsh-prompt-inject 0.2.0 — UI consolidation

- **The web-search provider manager moved into the Tools page.** Sidebar entries
  `websearch-failover` and `prompt-inject` are gone; both sections now render
  inside `dsh-inventory`'s 工具管理 panel, each with its own segmented tab
  (「Web 搜索提供方」/「提示词注入」) and, on the overview, a collapsible section at
  the top. "Tools" is the page that answers what the agent can reach, so the
  order and balance of the providers that answer `web_search` — and the text
  injected into every system prompt — are edited next to the tool list they
  control instead of in two more sidebar rows.
- The provider section was rewritten in the panel's own visual language
  (grouped inset rows, iOS switches replaced by the shared chips/row controls,
  hairline detail card). Behaviour is unchanged: priority order by drag or
  arrows with optimistic update + rollback, balance bars per billing unit,
  cooldown countdown, per-provider enable/disable, `/refresh` only on an
  explicit click (balances are billed per call), and the prompt editor keeps its
  local empty-text guard.
- The two bundle client halves now register **only their locale dictionaries**
  (`inject: ['locale']`, no `sidebar.panellist` / `main` registration), so a
  profile can no longer end up with three sidebar rows for one settings area.
  Their host halves are untouched.
- Tests: `dsh-inventory` gained two browser-half tests that drive the provider
  section (balance units, detail reset rule, arrow reorder POST, refresh-all) and
  the prompt section (load, save, empty-body rejection) against the real routes;
  the two bundles' client tests were rewritten for the new
  dictionary-only contract.

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
- **Transactional updater (L2).** New `scripts/update.mjs` (+ `scripts/update/`)
  implements the plan → fetch/stage → verify → swap → observe → rollback
  pipeline from `docs/update-scheme.md` §4.2. Deliberately **not** wired into
  `pnpm gate`: it mutates a live profile, so it is an operator tool, not a check.
  Highlights:
  - planning is per **link target**, not per repository — a profile can mix two
    checkouts of one monorepo (the live one does), so "the repo" is not a
    well-defined update unit;
  - verification runs entirely against the **staged** tree (bundle contract,
    generated-artifact freshness, entry importability, dependency additions,
    `dsh --dump-config` with empty stderr); nothing touches live code;
  - the swap is a single `renameat2(RENAME_EXCHANGE)` syscall, so no reader ever
    sees a missing package and the previous generation lands at the staging
    path as a free rollback copy;
  - `swap`/`rollback` are dry runs without `--confirm`, and a `restart required:`
    verdict is reported to the operator — the tool never restarts DSH;
  - `rollback` only exchanges a tree the journal proves holds the previous
    generation, and refuses once that exchange has already been undone.

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
