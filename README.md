# dsh-ctx-guard

A hard context-budget gate for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), plus a
`/handoff` command. It replaces "ask the model nicely to be brief" with an engine-side deny: oversized tool payloads
are rejected at `tools/pre-execute`, and past a token watermark the expanding tools are frozen while the delivering
tools stay open.

一个给 DeepSeek Harness 的上下文预算硬闸 + `/handoff` 交接命令。不靠提示词劝模型，靠引擎直接拒绝。

## 为什么

把预算约束写进 `AGENTS.md` 只是往 system prompt 里塞文字，它和 100k 历史抢注意力；同一段提醒重复十几遍，行为
不变。引擎侧的拒绝是物理的：`tools/pre-execute` 返回 `deny` 时，工具体根本不执行，工具结果直接变成
`Error: <reason>`，模型只能换做法。

另一个事实是压缩线。默认 `thresholdRatio: 0.8` 在 512k 窗口上意味着 400k 才压缩，等于关闭。真正需要的是
"单次别写太大 + 快满时停止扩张 + 交接走人"这三件事，压缩阈值只是其中一环。

## 规则

| 规则 | 条件 | 动作 |
|---|---|---|
| R1 | `write.content` > `maxWriteChars` | deny，要求改 `edit` 或拆文件 |
| R2 | `edit.new_string` > `maxEditChars` | deny，要求分次 |
| R3 | `bash` / `pwsh` 的 `command` > `maxCommandChars` | deny，要求写成脚本文件 |
| R4 | 上下文 ≥ `warnTokens` | 只写日志（每 10k 一次） |
| R5 | 上下文 > `freezeTokens` | deny `write`(新文件)、`skill`、`web_fetch`、`bsk_inspect` |
| R6 | R5 且上下文 ≥ `compactTokens` | 先试一次压缩，成功则复测；复测不过才 deny |

R5 是**黑名单**而不是白名单。`present`、`ask_user_question`、`todo_write`、team 工具在冻结后仍然可用——
冻结的语义是「停止扩张、开始交付」，不是「什么都干不了」。覆盖已存在文件的 `write` 也放行（那是 edit 的尾巴）。

`reason` 必须给出替代做法，否则模型会原地重试同一次调用。这是实现里唯一不能省的字。

## 配置

默认值在 `lib/index.js` 的 `DEFAULTS`；`cordis.patch.yml` 故意不带 `config`，所以 profile 侧写**部分键**即可覆盖
（浅合并），不会被整体替换清零：

```yaml
- id: ctx-guard
  config:
    freezeTokens: 160000
    maxWriteChars: 12000
```

| 键 | 默认 | 含义 |
|---|---:|---|
| `maxWriteChars` | 8000 | 单次 write 正文上限（字符） |
| `maxEditChars` | 4000 | 单次 edit 新串上限 |
| `maxCommandChars` | 2000 | 单条 shell 命令上限 |
| `warnTokens` | 120000 | 告警线 |
| `freezeTokens` | 140000 | 冻结线 |
| `compactTokens` | 153600 | R6 触发线（= 0.3 × 512000 的压缩线） |

阈值改过之后记得同步 `compactTokens`。

## /handoff

```
/handoff            → <cwd>/.dsh/handoff/HANDOFF-<ISO>.md + 一条可粘贴的续跑指令
/handoff <标题>     → 同上，标题覆盖 session title
```

只读会话日志（`session.snapshotEvents()`），不调模型、不开新会话。文档四段：目标 / 最近进展 / 改动文件 / 未完成。
改动文件来自 `write`/`edit` 的 `file_path` 去重，未完成来自最后一次 `todo_write`。

## 安装

```bash
# 1. 放进 profile
cd ~/.dsh/profiles/<profile>
#   package.json → dependencies: { "dsh-ctx-guard": "link:E:/Project-hub/dsh-ctx-guard" }
#   package.json → dsh.profile.bundles 追加 "dsh-ctx-guard"
pnpm install          # 或手工建 node_modules/dsh-ctx-guard 链接
```

2. 重启 profile。本机实测：改完 profile `package.json` 后热加载即生效，无需重启。

插件无运行时依赖（只用 `node:fs` / `node:fs/promises` / `node:path`），也不需要 `@deepseek-ai/*` 的 import：
`CommandDefinitionId()` 在运行时是恒等函数，所以 `definitionId` 直接写普通字符串即可，省掉对 asar 内包路径的解析依赖。

## 自检

```bash
node test/self-check.mjs
```

用假 ctx 驱动 R1–R5 的判定、允许路径必须回调 `next()`、`/handoff` 四段输出与文件去重。不启动 harness。

真机验收：
1. 发一条 >2000 字符的命令 → 工具结果应是 `Error: 命令 ... 字符 > 2000`。
2. `/handoff` → 检查 `.dsh/handoff/HANDOFF-*.md` 四段齐全。
3. 上下文过 140k 后：写新文件被拒、写已有文件通过、`present` 通过。

## 卸载

profile `bundles` 与 `dependencies` 里删掉 `dsh-ctx-guard`，重启。

## License

MIT
