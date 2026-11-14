# 文档地图

这个目录分两类内容:**现行文档**(跟着代码走,必须与仓库实况一致)与**历史记录**(某个 issue 当时的 spec,保留原文,不改写)。新会话先看根 [README.md](../README.md) 与 [AGENTS.md](../AGENTS.md);发布历史看 [CHANGELOG.md](../CHANGELOG.md)。

## 现行文档

| 文档 | 作用 | 什么时候读 |
| --- | --- | --- |
| [README.md](../README.md) | 插件清单、安装、开发命令、仓库边界 | 第一次接触仓库 / 要装或更新插件 |
| [AGENTS.md](../AGENTS.md) | 不可协商的仓库规则(dev-flow、merge 闸、测试纪律、目录速览) | 每次新会话开工前 |
| [CHANGELOG.md](../CHANGELOG.md) | 每个 bundle 的版本条目与发布纪律 | 改包、升版本、查某版改了什么 |
| [update-scheme.md](update-scheme.md) | 插件可靠更新方案:运行时机制、L1/L2 事务器、回退 | 要更新已装插件 / 排查「改完没生效」 |
| [update-checkout.md](update-checkout.md) | 权威 checkout 统一方案的执行记录 | 排查 profile 到底加载了哪份代码 |
| [prompt-injection-inventory.md](prompt-injection-inventory.md) | 新设备安装后应得到的提示词注入清单;哪些由插件自带、哪些不该依赖全局 AGENTS.md | 换机器部署 / 核对插件是否自带提示词 / 判断某条规则该写在哪里 |
| [specs/.flow/](specs/.flow/) | 任务板状态文件(运行时状态,随分支走;不代表功能仍然存在) | 看 TDD / CI / review 的内部进度 |
| [packages/dev-flow/FLOW.md](../packages/dev-flow/FLOW.md) | 流程规程全文(TDD、双轴 review、状态文件、merge 闸) | 进入 dev-flow 后按需读 |

两份 update 文档都带 `现状校准(YYYY-MM-DD,main @ <sha>)` 块:正文是调查当时的记录,校准块才是今天的操作依据。**改 profile、重启 DSH 前先看校准块与 `AGENTS.md` 的硬规则。**

## 历史记录

- `specs/*.md` 是逐 issue 的历史:结论、边界、验收都按当时写。代码后来变了,**不要把它们当现状读**;现行行为以 README、包内 README、`CHANGELOG.md` 与代码为准。
- 包内的 `VERIFICATION.md`、`TEST_REPORT.md`、`HANDOVER.md`、`doublecheck-report.md` 同样是历史快照;文件顶部会标明适用的版本/日期。
- 任务板状态文件只记流程进度,不代表功能仍然存在。

## 维护规则

- 现行文档的事实由 `test/docs-contract.test.mjs` 钉住:插件数、README 表格覆盖、安装片段的 `link:` 行、CHANGELOG 条目与计数、update 文档校准块、`dsh-deep-ptc-mode` 的中英 README 版本。其他包 README 目前没有版本/安装入口契约。
- 改 `packages/` 下任何文件(含包内 README)→ 升该包版本 + 写 CHANGELOG 条目;只改仓库级文档(根 README、AGENTS、`docs/`)→ 不需要升包版本。
- 历史 spec 不追改正文;需要更正时,在对应 spec 末尾追加「变更点 + 理由」。
