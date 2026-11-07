# dev-flow

DeepSeek Harness 的工程流程 skill：**issue → branch → TDD → PR → CI → review → merge**。

```
前置自检（gh / git remote）
停点1  意图 + 路径分级（trivial / standard；grill 并入）
停点2  spec + tickets 落盘确认 → 自动：gh issue create → git switch -c issue-<n>-<desc>
       TDD 红绿循环（红→确认红对原因→绿→最小实现）→ 完工四件套
停点3  声明 push → 开 PR → 查 CI 一次（无 CI / 绿 / 红≤2轮自修）
       双轴 code review（子代理固定模板，输入含 spec 原文 + diff，只报告不改码）
       merge 闸（具体 merge 口令，"嗯/好/继续"不算）
```

设计定稿见 [issue #1](https://github.com/kurumi1ksllq/DSH-plugins/issues/1)。

## 组成

| 文件 | 作用 |
| --- | --- |
| `SKILL.md` | skill 本体：3 个停点、trivial 硬标准、裁剪声明三步、CI 三态、merge 闸、分支保护命令 |
| `lib/lint.mjs` | skill 契约 linter：frontmatter / 触发词 / 必需章节 / 禁用措辞（如「双保险」）逐条校验 |
| `test/skill.test.mjs` | TDD 契约测试：`SKILL.md` 必须过 linter，破坏闸门的编辑会红 |

## 为什么 skill 也要测试

skill 是纯文档，最脆的失败模式是"改一句文案把闸门改没了"。`lintSkill` 把契约固化成可断言的结构：路由触发词丢了、merge 闸措辞被稀释、停点章节被删，`pnpm test` 都会直接红。

## 测试

```bash
node --test packages/dev-flow/test/*.test.mjs
# 或 pnpm --filter dev-flow test
```

## 安装

两条路线**选一即可**，都指向同一个 `SKILL.md`：

| 路线 | 做法 | 生效方式 |
| --- | --- | --- |
| profile 声明 | `link:` 依赖 + `dsh.profile.bundles` 里加包名 | 需要一次 profile 重组合（重启 DSH） |
| 文件系统 | 软链到 `<DSH_HOME>/skills/dev-flow` | `skill-filesystem` 的监视器自动发现，**免重启** |

两条都装上时，runtime 注册（本包的 `apply`）优先级高于 user 根（rank 400），冲突由 catalog 收集阶段按 rank 合并并记一条 `ignored` 警告——不是 `register` 自己打的。

### 路线 1：profile 声明（`dsh.profile.bundles` 必须同时有）

```json
"dependencies": {
  "dev-flow": "link:/path/to/DSH-plugins/packages/dev-flow"
},
"dsh": {
  "profile": {
    "bundles": ["dev-flow"]
  }
}
```

这一行让插件的 `apply` 跑起来：它把 `dev-flow` 注册进 `ctx.skills`，正文读包内的 `SKILL.md`。**需要一次 profile 重新组合才生效**（重启 DSH 或等宿主重载）。

### 路线 2：文件系统（免重启）

`@deepseek-ai/dsh-skill-filesystem` 默认扫描 `<DSH_HOME>/skills`（rank 400），且 `watch: true`、`watchFollowSymlinks: true`。把包目录软链过去即可，**不需要重启**：

```bash
mkdir -p ~/.dsh/skills
ln -sfn /path/to/DSH-plugins/packages/dev-flow ~/.dsh/skills/dev-flow
```

这个软链不需要改 profile，也不需要重启：监视器在根目录尚不存在时会先盯着最近的祖先目录（`~/.dsh`），目录一出现就重新解析并刷新目录。

项目 AGENTS.md 建议加一行保证路由：

> 任何改代码的请求，先调用 dev-flow skill，再谈实现。
