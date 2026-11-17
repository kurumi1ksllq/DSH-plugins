# issue-221 技能目录收窄（模型可见 catalog 从 269 → 16）

## 背景（实测，2026-11-17/18）

- `~/.agents/skills` 下 269 个 ECC 技能，作为 `user-agents` root 被 `@deepseek-ai/dsh-skill-filesystem` 全量挂进每个会话；preset（`standard`/`ptc`/`cordis`）自己也挂了一层 provider，配置层面没有关闭默认 root 的口子可打。
- 抽查 418 个注入过 catalog 的会话：只有 31 个（7.4%）加载过至少一个 skill；`deepseek-v4.1-flash` 为 5/137。
- 会话 `session-b2d5841c`：8 轮、162 次工具调用、0 次 `skill`；宿主 skill-nudge 8 轮只响 1 次，模型看到后仍写明 "skip loading skills"；用户第 3 轮明说"加载skill"后仍为 0。
- 上游（`deepseek-ai/deepseek-harness` `docs/subsystems/skills.md`）确认：catalog 只在首个 pre-step 注入一次，正文只能由模型主动调 `skill`；不存在自动加载。同类方案（NousResearch/hermes-agent PR #23963）走的是"确定性命中→注入正文"，仍需先解决"catalog 本身过载"。
- 结论：软提醒（v0.4.3 的 nudge）边际收益≈0，问题在 catalog 规模，不在提醒力度。

## 决策

用上游支持的**逐技能开关**收窄模型可见面，不搬目录、不删内容：

- `disable-model-invocation: true`（`dsh-skill-filesystem` 读取为 `modelInvocable: false, userInvocable: true`）：技能从模型 catalog 消失，用户仍可 `/name` 手动调用。
- 本机没有 config 级 deny list（`skill-toggle.js` 早已记下这一点），也验证过 `ctx.fs` 路径下符号链接不被当作目录（`dsh-fs-local` 把 symlink 报成 `symlink`，而 `discoverRoot` 只收 `directory`），所以"软链收窄"在本机不成立，逐文件写 frontmatter 是唯一可靠途径。

保留集合（16，来自 269 个技能的技术族盘点，覆盖两个真实工作区 `/root/DSH-plugins`（Node/ESM/pnpm）与 `/root/plugin-lab`（C++/CMake + Python/uv））：

`tdd-workflow, typescript-patterns, python-testing, python-patterns, cpp-coding-standards, cpp-testing, git-workflow, github-ops, conventional-commit-review, change-impact, error-handling, codebase-onboarding, terminal-ops, architecture-decision-records, module-regression, living-docs-governance`

不收的大族及理由：cmd-* 25（斜杠命令包装，按名字调用）、前端/移动 36、后端框架 28、agent 工程 39、内容营销 20、网络/homelab 10、视频 9、科研 12、垂直行业 9 —— 与两个工作区技术栈无交集。已知缺口：没有任何技能覆盖 cordis/DSH bundle 打包与 profile 校验，这部分继续由 AGENTS.md + dev-flow 常驻注入承担。

## 实现

- `packages/dsh-inventory/lib/skill-selection.js`：纯计划 `planSelection` + 落盘 `applySelection`（复用 `skill-toggle.js` 的 `setSkillEnabled`，编辑只动 frontmatter 一行；dry-run、逐文件失败收集、幂等）。
- `packages/dsh-inventory/bin/skill-catalog.mjs`：`--root / --keep / --keep-file / --restore / --dry-run / --json`；退出码 0 成功、1 用法或 root 缺失、2 有未命中名字或写失败。
- 根脚本 `pnpm skill:catalog` 指向该 bin；`dsh-inventory` 0.12.5 → 0.13.0，`files` 增加 `bin`。

## 验证

- 单测：`packages/dsh-inventory/test/skill-selection.test.mjs`（7）、`test/skill-catalog-cli.test.mjs`（5）。
- 真机：`pnpm skill:catalog -- --dry-run` 先看计划，再落地，随后核对"被标记数 + 保留数 = 269"且保留目录的 SKILL.md 字节未变。
- 生效面：provider 每次会话重新扫盘，新会话即见收窄后的 catalog；不需要重启宿主。回滚：`pnpm skill:catalog -- --restore`。

## 变更点记录

- 2026-11-18：初版方案是"改 profile 配置 / 搬目录"，调查后发现 preset 自带 provider 绕不过、符号链接在 `ctx.fs` 路径被跳过，改为逐技能 frontmatter 开关（上游语义、可单点回滚），保留集合不变。
