# #47 让 dev-flow skill 真的能被加载

- 分级:`standard`
- 关联:#47(本轮新建);与 #43 的 `check-profile` 结论直接相关
- 本阶段**会**动:`packages/dev-flow-skill/{index.js,package.json,cordis.patch.yml,README.md,test/loader.test.mjs}`、`README.md`(安装片段)、`docs/update-scheme.md`(「未安装」那句)
- 仓库外动作(需你点头):装进 profile 并在 `~/.dsh/skills/` 放符号链接;**不重启 DSH**

## 1. 实测现状(每条都有命令)

| 事实 | 命令 / 证据 |
| --- | --- |
| bundle 的 row 会被 cordis 拒绝 | `cordis.patch.yml` 的 row 解析到 `main: lib/lint.mjs`;实测导出只有 `LINT_RULES, REQUIRED_TRIGGERS, lintSkill`,无 `apply`/无 default function |
| 拒绝是抛错而非降级 | `cordis/lib/index.js:1621`:`throw new Error("invalid plugin, expect function or object with an \"apply\" method, ...")` |
| patch 里的 `skillName`/`skillPath` 无人消费 | 在 `dsh/lib/*.js`、`dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill` 内 grep `skillName`/`skillPath` → 0 命中 |
| 包也没有 `Config` schema | `node -e "…'Config' in m"` → `false`;给无 schema 的 row 塞 config 不合法 |
| 真正生效的机制是目录扫描 | `@deepseek-ai/dsh-base` 已挂 `skill` / `skill-filesystem` / `tool-skill`;`skill-filesystem` 默认根含 `user-dsh` = `<DSH_HOME>/skills`(rank 400),`watch: true`、`watchFollowSymlinks: true` |
| 本会话确实没有这个 skill | 会话 `available_skills` 只有 `tool-slimmer-setup`,无 `dev-flow` |

结论:照 README 装进 profile,**DSH 启动时会抛 `invalid plugin`**,而不是「装上 skill」。

## 2. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 红:新增 `test/loader.test.mjs` —— 断言包导出 `name`/`inject`/`apply`,`apply` 调 `ctx.skills.register` 且注册名是 `dev-flow`、description 含 lint 要求的触发词、content 是 SKILL.md 全文 | 先跑见红(现状无 `apply`);红线指向「没有 apply」,不是语法错 |
| T2 | 绿:新增 `index.js`(`name`/`inject:['skills']`/`apply(ctx)`),正文运行时读 `SKILL.md`(不内联副本,避免双份漂移);`package.json` 的 `main`/`exports` 指向它并保留 `./lint` 子路径导出 | T1 全绿;`lintSkill` 仍可被 `import 'dev-flow-skill/lint'` 取用 |
| T3 | `cordis.patch.yml` 去掉自造的 `skillName`/`skillPath`,只插真 row;`README.md` 安装段改写为「link + 重启或用 `~/.dsh/skills` 链接」 | `pnpm verify` 绿;`grep -r skillName packages/dev-flow-skill` → 0 |
| T4 | 文档:根 `README.md` 安装片段补 `dev-flow-skill` 一行;`docs/update-scheme.md:70` 的「未安装」改为已装 | `docs-contract` 绿 |
| T5 | 版本纪律:`dev-flow-skill` 0.2.1 → 0.2.2 | `pnpm verify` 版本纪律绿;合并后打 `dev-flow-skill@0.2.2` |
| T6 | 现场(仓库外,需点头):profile 加 `link:` + `bundles`;`~/.dsh/skills/dev-flow` 符号链接到包目录 | 会话 `available_skills` 出现 `dev-flow`;`check-profile` 从 5 变 6 |

## 3. 边界

- 不改 SKILL.md 正文(流程规则本身不动),只改**加载方式**。
- 不内联 SKILL.md 副本:运行时读文件,避免「包里一份、注册里一份」两处漂移。
- 不动 `dsh-skill` / `dsh-skill-filesystem` 等宿主包。
- 不重启 DSH;需要重载时停下来问。

## 4. 风险

| 风险 | 缓解 |
| --- | --- |
| 运行时 `ctx.skills` 不可用 → `apply` 崩 | `apply` 里先检查 `typeof ctx.skills?.register`,不可用则 `ctx.logger.warn` 并返回,不抛 |
| SKILL.md 读不到(打包后路径变) | 用 `fileURLToPath(import.meta.url)` 定位包根,`files` 里保留 `SKILL.md`;测试覆盖「文件缺失 → 明确报错」 |
| `main` 改到 `index.js` 破坏 `import 'dev-flow-skill'` 的既有用法 | `exports` 保留 `./lint` 子路径;仓库内引用改为显式 `dev-flow-skill/lint` |
| 与 `~/.dsh/skills` 的链接重名 | `register` 对同名 runtime skill 有 first-wins + warn,不崩;两者内容同源 |

## 5. 验收

- `node --test packages/dev-flow-skill/test/*.test.mjs` 全绿(含新 `loader.test.mjs`)。
- `pnpm verify` 绿(版本纪律 + patch 存在)。
- 反向验证:把 `apply` 里的 `ctx.skills.register` 删掉,新测试必须变红。
- 现场:`check-profile` 报 6 个 bundle;会话 skill 目录出现 `dev-flow`。
