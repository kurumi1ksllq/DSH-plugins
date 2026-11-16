# issue-216: 子 agent 工具探测假阴性(globalThis.tools)

- **分级**: standard(实测 diff ≥4 个既有文件、+83/-2,超出 FLOW「≤1 文件且 ≤30 行」的 trivial 门槛,#217 轴2 发现初判 trivial 未留证,改判)
- **issue**: https://github.com/kurumi1ksllq/DSH-plugins/issues/216
- **分支**: issue-216-tool-probe-false-negative

## 目标
让所有 agent(含 delegate_role 子 agent)的常驻注入纪律里明确:PTC run_code 中探测工具存在性必须用作用域内 `tools` 绑定; `globalThis.tools` 恒为 undefined,不得作为「工具不存在」的证据。

## 背景(证据)
session-e46310c1 的审查子 agent 04c76b79 在 seq=91/96 用 `globalThis.tools` 探测,得 `typeof send_message === 'undefined'`,据此在审查报告里断言「本会话无 skill 工具/send_message 不存在」。本会话(同款运行时)实测:`typeof tools.skill === 'function'` 而 `globalThis.tools === undefined` —— 假阴性确凿。

## 变更清单
| 文件 | 变更 |
| --- | --- |
| packages/dsh-task-dispatcher/lib/delegation-text.mjs | zh/en lanes 各加一条「工具探测」纪律 |
| packages/dsh-task-dispatcher/test/owned-clauses.test.mjs | OWNED_CLAUSES 加条款(zh 精确短语; en 正则) |
| packages/dsh-task-dispatcher/package.json | 0.8.0 → 0.9.0(改动包必须升版) |

## 裁剪
依据分级 trivial:免双轴 review?**不裁**——条款是给模型的行为指令,文案措辞质量值得第二视角,保留双轴 review。免新增实现测试?不适用:本变更本身就是文案+契约测试。

## 验收
1. zh 文案含「globalThis.tools」与「作用域内」;en 文案含对应表达(`globalThis.tools` / `in-scope`)
2. 契约测试可反向验证:从 delegation-text.mjs 删掉该条款 → owned-clauses 测试红
3. pnpm test / pnpm verify 全绿(多会话共用 checkout,按需走 verify-clean)

## 变更点
- CHANGELOG.md 与 docs/specs/.flow/216.json 两处虽不在变更清单内,分别由版本纪律(check-bundle-versions)与 dev-flow「每节点写状态文件」强制,属流程必有产物,非遗漏。
- 双轴 review 裁决落地:契约测试钉紧(zh 加「作用域内」断言、en 加 /in-scope/i);CHANGELOG 计数注记按 git tag 实测改为 56 有 tag/缺 2 条;分级改判 standard(留证见首行)。
