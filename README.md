# dsh-prompt-inject

DeepSeek Harness（DSH）插件开发工作区，同时归档独立复核报告。

> 仓库与本地目录已从 `dsh-reverse-plugin` 重命名为 `dsh-prompt-inject`。旧路径 `E:\Project-hub\dsh-reverse-plugin` 目前是一个隐藏 junction，用于兼容已安装 profile 的 `link:` 路径和正在运行的会话；插件按新路径重装后即可删除。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| [`prompt-inject/`](prompt-inject/README.md) | 插件 `@local/dsh-prompt-inject`：向每个 Agent 的系统提示词追加可编辑段落，并提供侧边栏编辑器（Host 路由 + Client UI + 契约测试） |
| [`reports/`](reports/) | 项目级独立复核报告：[侧边栏编辑器](reports/review-prompt-editor.md)、[首版注入 bundle](reports/review-prompt-inject.md) |
| [`.gitattributes`](.gitattributes) | 全仓库 `* text=auto eol=lf` |

本仓库根目录即工作区根目录，`prompt-inject/` 是唯一的插件包目录，不是独立仓库。

## 历史布局说明

- `ee1aa58` 及更早的提交里，仓库根目录直接是插件内容（`index.js`、`package.json` 等）。
- 自 `chore: promote repo root to workspace dir` 起，插件内容移入 `prompt-inject/` 子目录，复核报告从工作区兄弟目录纳入版本管理。
- 迁移沿用同一分支历史，文件内容未变（`git log --follow prompt-inject/index.js` 可追溯到迁移前提交）。

## 插件使用

```bash
# 契约测试（纯 Node，无第三方依赖）
node --test prompt-inject/test/plugin.test.mjs

# 安装到 DSH profile：plugin_manager → install_bundle，target 传 prompt-inject/ 的绝对路径
```

细节、HTTP 契约、持久化与配置覆盖见 [`prompt-inject/README.md`](prompt-inject/README.md)；运行时验证证据见 [`prompt-inject/VERIFICATION.md`](prompt-inject/VERIFICATION.md)。

## 免责与边界

插件只读写本机 profile 下的注入状态文件，不联网、不注册其他路由；修改注入文本等同修改系统提示词，属本机 profile 管理者的操作。不要把 DSH 端口暴露到不受信任网络。

## License

MIT（见 `prompt-inject/package.json`）。
