# dev-flow

DeepSeek Harness 的工程流程 bundle：**意图 → issue → 分支 → TDD → PR → CI → 双轴 review → merge**。

流程规则**常驻**——插件启动时把一段短契约注入系统上下文（`systemPrompt.context`，order 21050，`required: true`），
每次对话都在,不注册为技能、不依赖模型"想起来加载"。详细规程随包发布（`FLOW.md`），契约里给出它的绝对路径,进流程时读一次。

```
常驻契约（每轮都在）
  ├─ 触发：任何会写仓库文件的请求
  ├─ 两次交互：① 意图确认（大白话）  ② 是否合并
  ├─ 自决：分级 / 裁剪 / 无 CI / CI 红 / review 裁决 / spec 变更
  └─ 硬规则：禁改 main、禁测私有函数、每个节点写 .flow 状态

FLOW.md（进流程时读）
  └─ 前置自检、TDD 红绿、双轴 review 固定模板、状态文件格式与枚举、分支保护命令
```

设计定稿见 issue #154（前史 #47 把 skill 塞进 bundle、#144 停点改 `ask_user_question`）。

## 组成

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主入口：向 `systemPrompt` 注册 1 个常驻 context（`dev-flow:flow-contract`） |
| `lib/contract.mjs` | 契约文本（`renderFlowContract`）：只留会改变行为的句子，约 25 行 |
| `lib/lint.mjs` | 双契约 linter：`lintFlowDoc`（章节 + 禁用措辞）、`lintContract`（常驻硬句 + 长度） |
| `FLOW.md` | 规程全文：两次交互、自决边界、TDD、双轴 review 模板、任务状态文件、merge 闸 |
| `lib-git-status/` | 只读任务板/快照（读 `docs/specs/.flow/<issue>.json`，见 `README-git-status.md`） |

## 为什么文档也要测试

规程是纯文档,最脆的失败模式是"改一句文案把闸门改没了"。两个 linter 把契约固化成可断言的结构：
「两次交互」被删、把「用户点头」写回（规程和常驻契约两处都禁）、常驻契约丢了 `禁止直接改 main`、或契约超过 1600 字符，`pnpm test` 都会直接红。
规则细节只留在 `lib/lint.mjs`，这里不复述阈值。

反向验证（改坏实现必须变红）：

| 变异 | 结果 |
| --- | --- |
| 删掉 `systemPrompt.context` 注册 | `test/contract.test.mjs` 红 |
| 契约里删掉「两次」 | `lintContract` 红 |
| FLOW.md 写回「用户点头」 | `lintFlowDoc` 红 |
| 「两次交互」章节重复出现 | `lintFlowDoc` 红（#154 顺带修了 count 少 `g` 标志的漏检） |

## 测试

```bash
node --test packages/dev-flow/test/*.test.mjs
# 或 pnpm --filter dev-flow test
```

## 安装

只有一条路线：在 profile 里声明 bundle。

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

这一行让插件的 `apply` 跑起来,把契约挂进系统上下文。**需要一次 profile 重新组合才生效**（重载 DSH;重启宿主进程必须先获得用户批准）。

> 早先的"软链到 `<DSH_HOME>/skills/dev-flow` 免重启"路线在 #154 取消:那条路把流程降级成 270 个技能里的一个候选,实测会话里根本没出现。
