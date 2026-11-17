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
- 仓库内保留清单 `packages/dsh-inventory/skill-catalog.keep.txt`（可执行、可评审），用法 `--keep-file`；技能改名会以 exit 2 暴露。
- CLI 吞掉包管理器透传的裸 `--`（`pnpm skill:catalog -- --dry-run` 可用）；空名单一律 exit 1，拒绝「把全部技能藏掉还返回成功」。

## 验证

- 单测 13 个：`packages/dsh-inventory/test/skill-selection.test.mjs`（8，含无 frontmatter 的坏文件不中断其余）、`test/skill-catalog-cli.test.mjs`（5）。
- 真机：`pnpm skill:catalog -- --dry-run` 先看计划，再落地。实测口径：root 下 269 个目录、其中 `ui-design` 无 SKILL.md，扫描到 268 个唯一技能名（`cmd-*` 包装层与本体同名，按 rank 去重）→ 保留 16、标记 252；保留的 16 个 SKILL.md sha256 前后一致。生效后的会话 catalog 为 18 条 = 16 个保留 + 2 个运行时注册（`browser-skill`、`official-plugins`）。
- 生效面：provider 每次会话重新扫盘，新会话即见收窄后的 catalog；不需要重启宿主（本会话当场收到了替换 catalog）。回滚：`pnpm skill:catalog -- --restore`。
- 回滚边界（已知）：`--restore` 会重新启用该 root 下**所有**带该标记的技能，包括不是本工具标记的（例如以后为 office-* 占位桩手工加的标记）。本机落地时该 root 下原有标记为 0，所以此刻等价于"恢复到收窄前"。

## review 裁决（双轴，独立视角）

- **已改**：`visibleAfter` 用「扫描总数」算出 268（应为 16）→ 改为按「运行前可见数」推算，并补「先收窄再重跑」用例；空 keep 名单曾会把全部技能标掉且 exit 0 → 改 exit 1；`pnpm skill:catalog -- --dry-run` 因裸 `--` 报 unknown argument → parseArgs 容忍；写失败收集零覆盖 → 补注入抛错用例；`assert.match(beforeBeta)` 恒真 → 改为读 apply 之后；scan 跳过的 2 个（`ui-design` 无 SKILL.md、`issue-review` 被 `cmd-issue-review` 同名遮蔽）曾静默消失 → 输出 `skipped`。
- **不改（留档）**：`--restore` 是「整根恢复」而非「还原到运行前」（已在 spec 与 CLI 头部写明）；252 次写入非原子（`skill-toggle` 既有行为，幂等重跑可修复）；CRLF/BOM 端到端仅由既有 `skill-toggle` 测试覆盖；人读输出未断言（JSON 契约已覆盖）。`provider 每次会话重扫、不需重启` 已由本会话收到替换 catalog 实测，非推测。

## 变更点记录

- 2026-11-18：初版方案是"改 profile 配置 / 搬目录"，调查后发现 preset 自带 provider 绕不过、符号链接在 `ctx.fs` 路径被跳过，改为逐技能 frontmatter 开关（上游语义、可单点回滚），保留集合不变。
