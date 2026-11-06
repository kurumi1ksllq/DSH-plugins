# Changelog

## 1.7.3 — 2026-11-05

- 优先读取运行宿主的官方预设注册表并自动检测更新；修复官方工具误隔离、暂停误判和桌面重载按钮的依赖/返回值处理。保留后台运行与插话。

- Protect official tools from stale quarantine across guard, search, SDK, loading and reporting. Keep unattributed tools available; only positively attributed external providers can be quarantined.
- Prefer the running host’s public PTC registry and detect PTC/base declaration changes automatically without a pinned inventory. Invalidate changed module-source caches; avoid rebuilding on unrelated settings events.
- Integrate 125 pause adversarial cases, align language-aware expectations, defer oversized schemas to the full host SDK, tolerate missing optional output metadata, distinguish missing executables, and dispose partially mounted adapters before official fallback.
- Fix the composer reset action: inject the remote namespace explicitly and unwrap the gateway `{ ok, value }` response before checking the command result. Verified by clicking the actual desktop button.


- Keep every official row exactly as declared. Only the persona, shell, job and question rows differ; the `official-tools` wrapper is gone. The host's compatibility preflight, composition diagnostics and plugin inventory again see the official modules.
- Attribute tools from the installed source of the composed rows, without running it: official tools are recognised wherever they are composed, and a failed third-party tool is reported under its own plugin.
- Fail open: a failure in the quarantine, catalog, recovery-context or reachability hooks leaves tool calls and prompts as the host would have them. Previously a throwing guard failed every tool.
- If a wrapped official plugin fails with Deep PTC behaviour or rejects Deep PTC's options, run it as declared. If the preset still cannot mount, fall back to safe mode: the official composition with the Deep PTC persona. A malformed `toolPreferences` is ignored with a warning.
- Add `scripts/check-parity.mjs`: official PTC and Deep PTC on a real host composition, compared tool by tool, with third-party plugins that know nothing about Deep PTC.
- Read tool error codes from `error.info.code`, where the host reports them. Every code-based decision was silently skipped before, so one invalid-arguments call quarantined a working tool.
- Quarantine only a capability that is clearly unavailable, or that fails three times in a row with temporary or unexplained errors; a success clears the count. Wrong input, a failed build reported in a normal result, and names no plugin provides no longer quarantine anything. The persona allows correcting input and retrying temporary failures twice.
- Recognise official tools outside the PTC preset (the profile root composition, such as `lsp`, `terminal_*` and `session_*`) by reading the names their installed packages declare, without running them. Those tools stay in the SDK and are never quarantined. Shell rows kept by the environment fallback are official too.
- Run tool discovery and quarantine in a child fiber: a missing session module, service or API turns that layer off with a log line instead of rejecting the preset mount.

## 1.7.2 — 2026-11-05

- Add local tool/skill discovery and complete-schema loading with bounded pages, byte budgets and recent selections. Reuse the installed official PTC SDK renderer, reducing only its untouched generated section. Skill discovery reads metadata and invocation controls; the official loader owns skill bodies.
- Quarantine failed external tools in durable conversation state. Block subsequent calls until the user resets; no automatic probing, retries or root-cause analysis. Capture provenance/reset generation before dispatch; keep cancellation, permission decisions and normal pagination intact.
- Add a bilingual Reload all tool states button below the composer and a user-only host command. Preserve running jobs. Project failed tool/provider lists at turn completion and request concise final-task reporting.
- Identify baseline registrations from the inherited composition rather than package naming patterns; support class-style official plugins while retaining their metadata.
- Preserve the original execution, reachability, question, planning and shell policies. Add regression coverage for quarantine persistence, reset races, SDK disclosure, skill metadata and UI actions.

## 1.7.1 — 2026-11-05

- Publish the plugin-cooperation release with bilingual README introductions and package/repository descriptions: external capabilities first, multiple providers working together, and the current official PTC composition as fallback, following the “everything is a plugin” composition model. Preserve the original interruptible background-work behavior and document integration boundaries.
- Set the DSH engine and DSH peer-package minimum to `>=0.2.2-rc.1`, matching the currently installed runtime, with no upper bound. Synchronize the lockfile and install documentation.
- Clarify that official fallback capabilities still derive from the installed PTC declaration at load/rebuild time, following the 1.6.1 mechanism; snapshots remain a logged fallback. No tool-selection, reachability, execution or planning code changes.

## 1.7.0 — 2026-11-05

- Add two-layer task-level tool cooperation: search and prefer an available extension capability for the function, then use an admitted inherited official PTC capability if no enhancement fits or a provider fails. No new capability, alias, argument translation, result conversion or silent replay is registered.
- Observe final host results and publish bounded, agent-local recovery context. Preserve denials, cancellation, code-less pre-dispatch guard failures, partial effects and active background jobs; retain original tool schemas, output contracts, conditions and execution ownership. Successful calls and provider replacement clear stale failure evidence.
- Tag official capability registrations by provenance while loading their actual upstream modules/config. Keep activation options (`when`) and exact registration disposers when adapting the tool registry. Official web search/fetch remain official and retain provider-readiness gating.
- Add optional `toolCompatibility` (default true) and `toolPreferences` settings. Explicit preferences describe choices between existing tools, not a dispatch mapping. Hidden/removed fallbacks and a replaced/unloaded whole executor are not bypassed.
- Keep persona, task planning, WSL/PowerShell/Zsh/Bash selection, foreground cap, steering, managed jobs, completion wakeups and timed questions unchanged. Add offline unit coverage and an actual-host compatibility harness; run the existing reachability integration with the compatibility observer enabled.

## 1.6.1 — 2026-11-04

- Follow the official modules instead of naming them. The shell, job and question wrappers no longer import `@deepseek-ai/dsh-tool-bash`, `dsh-tool-pwsh`, `dsh-tool-jobs` or `dsh-tool-ask-user`: each derived row carries the module name and options of the official row it replaces (`upstream`, `options`), and the wrapper loads that module through the installed runtime's module graph with the official plugin's own `inject` and `Config`. A renamed or replaced official tool is followed rather than breaking the mount.
- Read the shell executors from the base deployment declaration (`@deepseek-ai/dsh-base/cordis.patch.yml`, rows `bash-sandbox` and `pwsh-sandbox`), including their official options; only the foreground cap is added. The WSL/Zsh executor extends the official bash executor class named there instead of importing `dsh-bash-local`/`dsh-bash-sandbox`.
- Fall back to the official shell rows when the chosen environment cannot be mapped: no official shell tool row, no declared executor, or an official bash executor whose API WSL/Zsh can no longer extend (probed before the preset is published). The reachability guard still applies; the preset never publishes rows that cannot mount.
- Keep `lib/base-snapshot.json` as the executor fallback beside `lib/preset.json`; `npm run sync:snapshot` regenerates both. Drop the official tool and executor packages from `peerDependencies` and add `@deepseek-ai/dsh-base`.
- `scripts/check-preset.cjs` also resolves the official modules the wrappers name. The runtime checks (`check-reachability.mjs`, `check-host.cjs`) now also run on `0.2.2-rc.1`, whose tool batches go through a selected executor and whose preset registry requires the agent registry.

## 1.6.0 — 2026-11-04

- Derive the preset from the PTC preset the installed Harness declares (`@deepseek-ai/dsh-web-app/presets/ptc.patch.yml`) instead of freezing a copy. Official rows, settings and additions are inherited; Deep PTC still replaces only its persona, execution environment, reachability guard, and the official job/question wrappers.
- Fix the failure after the DSH `0.2.2-rc.1` update: the frozen 1.5.0 snapshot still named the `@deepseek-ai/dsh-tool-subagent-control/list-agents` subpath, which `0.2.2-rc.1` removed, so the preset could not mount and existing Deep PTC sessions were reported as unusable. Sessions were never migrated or rewritten; they open again once the preset mounts.
- Keep `lib/preset.json` only as a fallback snapshot and refresh it to `0.2.2-rc.1`; `npm run sync:snapshot` regenerates it from the installed declaration.
- Declare every imported host package in `peerDependencies`, including `@deepseek-ai/dsh-web-app`: the host only routes a linked plugin's bare specifier to the installation when the name is peer-declared, so without it a `link:` install silently fell back to the snapshot. `npm run check` now fails if a peer is missing.
- Match official rows recursively (persona, shell/executor rows, job and question rows may move into a group) and accept only a declaration whose id is `ptc`. Tests cover nested groups, a non-PTC declaration, and the peer-declaration guard.
- `compatibility.json` now records the checked upstream release plus fixture hash; `scripts/check.mjs` verifies inheritance invariants and fallback/dedaration parity instead of exact-snapshot equality.
- Add derivation tests for future compositions (unknown rows, reordering, missing shell or wrapped rows) and `scripts/check-preset.cjs`, a live-runtime check that every derived row resolves through the installed module graph.

## 1.5.0 — 2026-10-31

- Enforce reachability in code. Foreground shell commands move to background jobs after `foregroundSeconds` (default 30, configurable 5–600); a larger requested timeout is capped. Commands still run; only the wait ends.
- A user message steered into the turn ends the current foreground wait within about 2 s: shell commands move to the background, `job_output` returns, and a timed question becomes pending. Waiting again with job_output while the message is unread is refused.
- Refuse foreground pauses over 5 s (`sleep`, `Start-Sleep`, `timeout /t`), `run_code` programs that wait on long or non-literal timers, `setInterval` and `Atomics.wait`, and more than 3 polls of one running job inside a program.
- Run `ask_user_question` in timed mode (120 s default, 300 s cap, `-1` refused) and fix the persona, which named a non-existent `timeoutMs` parameter.
- Wrap the official bash, pwsh, job and question tools instead of replacing them; the upstream check verifies exactly which rows are wrapped.
- Add `scripts/check-reachability.mjs`, an integration check on a real DSH runtime, and extend the Windows host check to activate the guard.

## 1.4.0 — 2026-10-31

- Restore the 1.2.0 intent in the persona while keeping 1.3.0's execution environments: the DeepSeek identity and unlimited-budget contract with anti-padding guardrails; size-based planning (internal up to five minutes, shown without approval up to twenty, approved beyond); asking about meaning instead of searching for it.
- Make waiting reachable: background jobs, non-blocking progress checks, ending the turn when idle, and handling mid-task user messages first, based on the runtime's step-boundary steering and job wakeups.
- Restore one-sentence progress before each run_code and a stated "not doing" list in plans.

## 1.3.0 — 2026-10-30

- Add bilingual settings for Automatic, WSL Bash, Windows PowerShell, native Zsh and native Bash. WSL distribution is optional. Unsupported choices are disabled according to the host platform.
- Isolate executors inside the preset. Settings apply to new sessions; existing sessions and jobs retain their revision. Global shell configuration stays independent.
- Launch WSL explicitly with separate argv entries. Reuse official process, terminal and approval implementations. Refuse confined WSL execution before spawning.
- Allow focused fact lookup before semantic questions, preserve authorization when work takes longer, and distinguish finite jobs from servers and unregistered external tasks.
- Add verification stopping conditions and collect delegated results through the actual tool's channel.
- Remove unsupported unlimited-budget and DeepSeek-employment claims. Reduce the persona from about 2,203 to 1,091 English words.
- Add upstream composition checks, platform/argv tests, revision lifecycle tests and rendered settings-form tests.
- Raise the minimum DSH version to `0.2.1-rc.5`, the runtime used for integration verification.

## 1.2.0

Previous persona-only PTC preset with semantic questions, duration-based planning, progress updates and delegation instructions.
