# Deep PTC mode

[中文](README.zh.md) · MIT · **1.7.3**

[1.7.3 实测汇总 / Test summary](TEST_REPORT.md)
**Let plugins cooperate. Keep current official PTC tools as the fallback. Stay interruptible while work runs.**

Deep PTC is a DeepSeek Harness agent preset built for a plugin ecosystem. It first looks for a suitable tool among the available external plugins, then continues with the running host’s dynamically discovered official PTC capability when no enhancement fits or a provider fails. Multiple plugins can contribute different parts of a task, each using its own schemas, discovery and result contracts. Deep PTC adds no task tools of its own.

The same working rules remain: use the model's capability thoroughly, move long commands into managed background jobs, respond to your messages while work runs, plan by task size, clarify intent, and execute in your selected WSL / PowerShell / Zsh / Bash environment.

## A mode for “everything is a plugin”

Compatibility has two directions: follow the installed official PTC composition as it evolves, and cooperate with external tool plugins instead of assuming a fixed tool inventory. This follows DSH's composable, “everything is a plugin” approach: the mode supplies working rules and recovery guidance, while tool providers retain ownership of their capabilities.

| Responsibility | How the plugins cooperate |
| --- | --- |
| External capabilities first | Search the available plugin capabilities for the needed function; use a provider's own discovery/SDK loader when appropriate |
| Multiple providers together | Use different plugins for different operations in the same task; no single enhancement plugin is required |
| Current official fallback | Continue through the installed Harness's official PTC tools if an enhancement is absent or fails |
| Shared task discipline | Preserve interruptible background work, clarification, planning and the selected execution environment |

An extension must publish into the `deep-ptc` scope and support the installed host. Keep official fallbacks visible in the provider's own configuration where supported. This is cooperative task-level selection, not a guarantee that every plugin or replacement executor is interchangeable. OPS is one possible provider, not a bundled dependency or a completed integration claim.

The official fallback retains the 1.6.1 derivation mechanism: the plugin reads the running host’s PTC declaration and checks for changes every five seconds; only changed declarations or this plugin’s settings rebuild the preset and follows its module names and configuration. The bundled snapshot is used only if loading, parsing or derivation fails, with a warning. Reload after an official upgrade and use a new preset revision; existing sessions are not forcibly switched. DSH support starts at `>=0.2.2-rc.1` with no upper bound; future host APIs still require verification.

## 1.7.2: lightweight, on-demand tool orchestration

One tool/skill directory, `deep_ptc_tools`, coordinates discovery. Task operations still belong to external providers and the current official PTC tools.

- **Search summaries, then load definitions.** Local metadata search prefers external tools, then returns official candidates when no extension matches. Pages default to six entries (maximum eight); disclose up to six complete schemas within a 16 KB budget per load. Official tools stay available; up to twelve recent extension selections enter the host-generated PTC SDK on demand.
- **Quarantine what is actually broken.** A tool that is clearly unavailable (a missing module or API, or a declared unavailable state) is quarantined at once; temporary and unexplained failures need three in a row, and a success clears the count. Wrong arguments or paths, denial, cancellation and normal results describing their own subject (such as a failed build) are not tool failures. Official tools are never quarantined, including those in the profile's root composition (such as `lsp` and `terminal_*`). After quarantine, execution is blocked in code and state persists with the session. Agent recreation, conversation restore and provider reload do not lift quarantine. Capture provenance and reset generation before dispatch; late pre-reset results cannot contaminate the new state. Empty results, normal pagination and ordinary nonzero command exits are not failures either.
- **Finish the task; do not diagnose failed providers.** Correct wrong input and retry a temporary failure at most twice. Once a tool is quarantined, move promptly to a working equivalent or official fallback, with no probing, retrying or root-cause investigation. Read back only the task state necessary to avoid duplicate effects after a potentially partial mutation.
- **Brief completion reporting.** The model lists failed tools and declared provider names at completion. The runtime also projects an expandable compatibility notice after a turn ends. Unknown ownership is reported as unknown, never inferred from a tool name.
- **Reload from below the composer.** “Reload all tool states” clears quarantine and on-demand selections for the current conversation without a model call or stopping running jobs. The user slash command `/deep-ptc-reset-tools` provides the same action.
- **Two-stage skill use.** Search the host's resolved, model-invocable skill metadata, then load the exact name with the official `skill` tool and follow its full instructions. Reuse instructions already in context. Discovery never reads skill bodies.

```js
// Inside the official run_code tool; discovery itself never executes a found task tool.
const matches = await tools.deep_ptc_tools({ action: 'search', query: 'search files' });
const loaded = await tools.deep_ptc_tools({ action: 'load', names: ['actual_tool_name'] });
const skills = await tools.deep_ptc_tools({ action: 'skills', query: 'build test' });
// Next use each actual tool schema, or the official skill loader for a selected skill.
```

Set `compactToolCatalog: false` under `deep-ptc-settings` to retain the full host SDK while keeping quarantine and reset. `toolCompatibility: false` disables the entire new layer. Optional `toolPreferences` still guide choices between existing tools.

Compaction only changes an untouched SDK section generated by the installed official renderer. Provider-owned/custom SDKs keep their own loaders. Extensions must support the host and publish into `deep-ptc`; this layer does not override hidden tools, authorization or an unloaded whole executor. Actual OPS/online-model end-to-end integration has not been performed.

## Overview

Deep PTC targets six common problems in everyday agent work:

| Problem | What Deep PTC does |
| --- | --- |
| Enhanced tools and presets do not naturally cooperate | Search external plugin capabilities first, combine suitable providers, and recover through the dynamically inherited official PTC baseline |
| The model rations tokens, skipping reads and tests, and quality suffers | The persona states that it works at DeepSeek with an unlimited token budget in this mode: never skip a read, search, command or check to save tokens. Guardrails forbid padding, verbosity and context blow-ups |
| Once work starts, the model sleeps or waits and ignores your messages | Enforced in code: foreground commands move to the background after 30 s, a message from you moves the waiting command to the background at once so the model reads it, and long sleeps are refused; job completion wakes the model (see "Enforced reachability" below) |
| Every task starts the same way regardless of size | Three bands by estimated time: up to 5 minutes, plan internally and act; 5–20 minutes, show the plan and start without approval; over 20 minutes, show the plan and wait for approval |
| It starts before understanding what you meant, then redoes the work | Meaning belongs to you, facts to the tools: unfamiliar names, competing targets or routes, scope and acceptance criteria are asked about (one to three questions with options), never guessed by searching; file locations and current behavior are looked up |
| The command environment is fixed | Choose WSL Bash, PowerShell, Zsh (macOS/Linux) or native Bash in settings; the choice applies to this preset only and leaves the global shell alone |

Three steps: install the plugin → pick an environment under **Settings → Plugins → Deep PTC** → choose **深度PTC模式** in the mode picker for a new task.

## Enforced reachability: no sleeping, always interruptible

From 1.5.0, "don't sleep or wait" is enforced by plugin code, not just requested in the prompt:

| Situation | What the code does |
| --- | --- |
| A foreground command runs long | After **30 s** (configurable, 5–600) it moves to a background job and keeps running; a larger requested `timeoutMs` is capped |
| You send a message while a command runs | The foreground wait ends within about 2 s, the command continues in the background, and the model reads your message; job completion still wakes it |
| `job_output` waits on a job | Capped at 30 s, ends early when you send a message, and waiting again while your message is unread is refused |
| The model writes `sleep 60`, `Start-Sleep 30` or `timeout /t 20` | Foreground pauses over 5 s are refused (`run_in_background` commands are exempt); short readiness loops such as `sleep 1` still work |
| `setTimeout`, `setInterval` or `time.sleep` in a `run_code` program | Known waits over 5 s are refused; unresolved durations pass through; polling one running job more than 3 times in one program is refused |
| `ask_user_question` | Runs in timed mode: 120 s by default, at most 300 s, `-1` refused. An unanswered question becomes pending and your later answer arrives as a message; typing a reply instead of using the card ends the wait at once |

These rules apply only to Deep PTC sessions. They rely on the desktop "busy Enter" setting being **steer**; with **queue**, messages wait for the whole turn to end.

```yaml
- id: deep-ptc-settings
  config:
    foregroundSeconds: 30   # foreground wait cap in seconds, 5-600
```

## Choose an execution environment

Open **Settings → Plugins → Deep PTC**, choose an environment, save, and create a new **深度PTC模式** session.

| Selection | Host | Executor / tool |
| --- | --- | --- |
| Automatic | Windows / macOS / Linux | PowerShell on Windows, Zsh on macOS, Bash on Linux |
| WSL Bash | Windows | Explicit `wsl.exe ... --exec bash -lc`, tool `bash` |
| PowerShell | Windows | Official native PowerShell executor, tool `pwsh` |
| Zsh | macOS / Linux | `/bin/zsh -lc` on macOS; installed `zsh` on Linux; tool `zsh` |
| Native Bash | macOS / Linux | Official Bash executor, tool `bash` |

Unsupported choices are disabled according to the Host, not the browser OS, and rejected by the Host schema. Leave the WSL distribution blank for the Windows default or enter an installed name such as `Ubuntu`. Zsh must be installed when selected on Linux.

The selection changes the real executor, tool contract and environment instructions. Executors live in a preset-local `shell` realm, independent of the global shell and other presets. Settings register a new preset revision for new sessions. Existing sessions and background jobs retain their revision: create a new session to change environment safely.

WSL source uses Linux/POSIX syntax, while file tools and `workdir` use Windows host paths. Distribution, cwd and source are distinct argv entries passed through `wsl.exe --cd`; no surrounding shell string is assembled. Login-shell configuration in the selected distribution controls Linux PATH and proxy setup. Windows environment variables are not all automatically exported into Linux.

### Sandbox behavior

Native PowerShell, Bash and Zsh use Harness sandbox, approval and process management. WSL currently supports only execution already authorized as `danger-full-access`. Confined Windows policies are refused before execution, without fallback or permission changes. The plugin does not authorize escalation.

## Working contract

- Spend the budget on the work: the persona states that the model works at DeepSeek with an unlimited token budget in this mode, so it does not skip reads, searches, commands or checks to save tokens. Guardrails forbid padding, and compaction, pruning and subagents keep each request inside its finite context window.
- Stay reachable while work runs: no sleeps, busy-polls or long foreground calls. Long commands run as background jobs while the model continues short steps and checks progress without blocking; with nothing left to do it states what is running and ends the turn. Job completion wakes it, and user messages are handled immediately.
- Plan by expected size: five minutes or less, plan internally and act; five to twenty minutes, show the plan and start without approval; more than twenty minutes, show the plan and wait for approval. Re-plan when the estimate moves up a band. Explicit plan mode always wins.
- Ask instead of guessing intent: meaning belongs to the user, facts to the tools. Unfamiliar names, competing targets or routes, authoritative sources, expected process, acceptance criteria and scope are asked about rather than guessed or searched for; inspectable facts are looked up. One to three questions with options, recommended first; the user's answer wins.
- Work visibly: one sentence before each `run_code`, longer updates at milestones, never more than two or three silent tool calls.
- Verify changed behavior and stop when criteria are met; delegate only genuinely independent work and collect results through the actual tool's channel.

A prompt changes the model's working tendency, not the real token limit or billing, and compliance is not guaranteed. The setting that actually controls thinking depth is the model's `reasoningEffort`.

## Install or upgrade

Requires Node `>=24` and DSH `>=0.2.2-rc.1`. Windows desktop rc.5 was used for real WSL/PowerShell command checks. macOS/Zsh configuration, argv and tool mounting were checked; native macOS execution has not been verified on this Windows host.

```js
plugin_manager({ action: "install_bundle", target: "dsh-deep-ptc-mode@1.7.3" })
// Or from a local checkout or archive:
plugin_manager({ action: "install_bundle", target: "C:\\path\\to\\dsh-deep-ptc-mode" })
// Or target: "C:\\path\\to\\dsh-deep-ptc-mode-1.7.3.tgz"
```

Repository locator: `github:lishize20040802-rgb/dsh-deep-ptc-mode`. It installs content actually published there; a local upgrade does not publish to GitHub or npm.

Installing the same bundle updates it. Upgrading from the persona-only release requires a Host plugin reload; reopen the app if the settings card has not appeared. Installation does not change the default mode for unrelated new sessions.

Settings persist through the active profile's Cordis patch:

```yaml
- id: deep-ptc-settings
  config:
    environment: auto       # auto | wsl | powershell | zsh | bash
    wslDistribution: ''      # blank uses the Windows default
```

Prefer the UI, which uses revisioned, atomic Host form writes.

## Compatibility and development

Deep PTC is composed at load time from the PTC preset the installed Harness declares (`@deepseek-ai/dsh-web-app/presets/ptc.patch.yml`). Every official row is inherited as-is; Deep PTC replaces only its persona text, swaps the two platform-switched shell tools for one isolated execution group, adds the reachability guard, and wraps the official job and question tools. The wrappers and the execution group never name an official module themselves: they load the module the official row names (and the shell executors the base deployment declares in `@deepseek-ai/dsh-base/cordis.patch.yml`), with the official options. An official PTC change therefore reaches this mode without a plugin release, and a removed or renamed upstream module cannot leave a stale row behind. When the chosen execution environment cannot be mapped onto the official rows, those rows are kept and the change is logged. If the declaration cannot be resolved, read or parsed, the bundled `lib/preset.json` snapshot is used as a fallback and the fallback is logged.

Because the declarations are resolved through the host runtime, every host package the plugin imports statically is declared in `peerDependencies` — including `@deepseek-ai/dsh-web-app`. The host routes those names to the installation for a linked plugin; `npm run check` fails if one is missing, which is what keeps a `link:` installation on the live declaration instead of silently using the fallback snapshot. `compatibility.json` records the upstream release the checked fixture was taken from and its hash; `npm run check` verifies that the bundled fallback still derives the same preset as that fixture and that the inheritance invariants hold. The engines range is an installation floor, not proof that every future release was tested, so run `npm run check:upstream -- <path>` against a new release before trusting it.

```sh
npm ci
npm run check
npm test
npm run check:upstream -- /path/to/the/new/upstream/ptc.patch.yml
npm run sync:snapshot                      # refresh lib/preset.json and lib/base-snapshot.json from the installed declarations
PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-preset.cjs  # loader-level row resolution on a real runtime
PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-reachability.mjs  # interruptible waits on a real runtime
npm pack
```

The checker parses `!!js` as data and asserts the derivation invariants: every official row survives unchanged except the persona, the shell rows and the two wrapped tools (including when the official preset nests them in a group); row ids stay unique; derivation is deterministic across nine platform/environment pairs. Tests cover future compositions as well (unknown rows, reordered rows, removed shell or wrapped rows), plus platforms, argv boundaries, confined WSL refusal, atomic settings writes and stale revisions. Real-task evaluations should measure successful completion, unnecessary questions, scope expansion, background-work collection and latency.

Main files: `cordis.patch.yml` is the settings entry; `lib/index.mjs` manages revisions; `lib/model.mjs` builds isolated execution configurations; `lib/executor.mjs` extends the official bash executor for WSL/Zsh; `lib/terminal.mjs` runs the official shell tool the declaration names, with interruptible waits and the Zsh dialect; `lib/jobs-tool.mjs` and `lib/ask-user.mjs` run the official job and question tools the declaration names; `lib/host.mjs` resolves those official modules through the installed runtime; `lib/guard.mjs`, `lib/rules.mjs`, `lib/sleep-lint.mjs` and `lib/reachable.mjs` implement the pause/polling guard and interruptible waits; `lib/client.js` owns the bilingual settings card; `lib/upstream.mjs` locates and parses the installed PTC declaration; `lib/preset.json` holds the persona and the fallback snapshot used only when that declaration is unavailable.

Uninstall with `plugin_manager` action `remove_bundle`, target `dsh-deep-ptc-mode`. Local link installations depend on their source directory: uninstall before deleting it.

## Author

Deep PTC mode is written and maintained by [lishize20040802-rgb](https://github.com/lishize20040802-rgb).

- Issues and feature requests: [GitHub issues](https://github.com/lishize20040802-rgb/dsh-deep-ptc-mode/issues)
- Email: lishize20040802@gmail.com

Bugs in DeepSeek Harness itself belong upstream, at [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).


Runtime boundaries: pause checks distinguish executable waits from strings, comments and ordinary timer callbacks. Known constants/products are checked; unresolved durations pass through. `wsl -- sleep 20` really pauses and remains refused. Static checks are not a complete language interpreter. Arbitrary run_code, synchronous subprocesses and long workflow waits cannot currently guarantee early steering; use managed jobs for long work. Official tools are never quarantined, including by stale records. Unattributed tools remain available; quarantine requires positive external attribution.

Version 1.7.3 first reads the running host’s public PTC registry, then discovers installed declarations if that API is unavailable, and uses a warned snapshot only as the final fallback. Registry/declaration or plugin-setting changes automatically refresh new preset generations; changed module sources invalidate attribution caches. No pinned DSH version selects the tool inventory, and leased sessions are not forcibly switched.
