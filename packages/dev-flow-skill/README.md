# dev-flow-skill

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
node --test packages/dev-flow-skill/test/*.test.mjs
# 或 pnpm --filter dev-flow-skill test
```

## 安装

profile 的 `package.json` 加一行 link，重启 DSH；SKILL.md 期望位于 DSH 的 skill 目录（`~/.dsh/skills/dev-flow/SKILL.md`，以实际目录为准）：

```json
"dev-flow-skill": "link:../../packages/dev-flow-skill"
```

项目 AGENTS.md 建议加一行保证路由：

> 任何改代码的请求，先调用 dev-flow skill，再谈实现。
