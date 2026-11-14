# 新设备安装后应得到的提示词注入(核对清单)

本文回答一个问题:**把本仓库的插件装到一台全新机器上,agent 会收到哪些提示词?**
凡是只写在 `~/.dsh/AGENTS.md`(全局用户文件)里的规则,**不会**随插件迁移,清单里也不该出现它们。

判定口径:一条规则若不在下表,就不该被当作"插件行为"依赖。

## 一、由插件注入(随 bundle 走,换机器自动生效)

| 来源插件 | 段名 / 通道 | order | 内容 |
|---|---|---|---|
| `dsh-deep-ptc-mode` | `⓪ 命令执行纪律`(systemPrompt.context) | 20000 | 命令执行九条:不盲等、增长型标量、僵死判定、PID 落盘、核验退出码、重试上限、宿主进程不重启 |
| `dsh-deep-ptc-mode` | `deep-ptc:reachability` | 10195 | 可达性说明 |
| `dsh-deep-ptc-mode` | `deep-ptc:tool-compatibility` | 10194 | 工具兼容与恢复 |
| `dsh-deep-ptc-mode` | `deep-ptc:environment` | — | 执行环境(WSL / PowerShell / zsh / bash) |
| `dsh-task-dispatcher` | `dsh:auto-delegation-discipline` | 21000 | 见下「二」 |
| `dsh-skill-surface` | 技能发现段 | — | 技能目录与加载协议 |
| `dev-flow` | 工程流程契约 | — | issue → 分支 → TDD → PR → CI → 双轴 review → 合并 |

## 二、`dsh-task-dispatcher` 注入段包含什么(#211 补齐后)

全部条款都必须出现在 `renderDelegationText('zh' | 'en')` 的输出里,
由 `test/owned-clauses.test.mjs` 逐条钉住(删任一条即红)。

| 类别 | 条款 |
|---|---|
| 开工 | 三问必须落到载体(`todo_write` 或首条回复) |
| 分档 | 单线程 / 委派一次 / 扇出 / 组队 / 对抗验证;命中任一**可数条件**必须拆 |
| 硬触发 | ≥3 文件、≥2 包、≥2 独立验证 → 必须拆;>8 次调用无产出 → 停手重拆 |
| 反逃生口 | 「先读一遍看看」不构成跳过拆解的理由;但**要改/审的文件必须自己读全** |
| 角色化委派 | `role_search` 找 id → `delegate_role` 派出;不要用 `subagent` 换角色 |
| **质量红线** | 子任务自包含(目标/输入/验收);汇总核对**冲突、重复、遗漏**;无法验证标**未验证**;委派失败**兜底补做** |
| **检索纪律** | **零命中 ≠ 不存在**(符号链接不下钻);出处**双源交叉**;易失证据**先落盘** |
| **效率细则** | **先读后写**;**独立调用并发**;长输出按需展开 |
| 安全 | 破坏性操作(`rm -rf` / drop / truncate / force-push / 重启宿主)必须先问用户 |
| 等待 | 轮询上限 2 次、间隔 ≤5 秒;有 `job_output` 用后台 job |
| 角色表 | 8 个示例角色(3 实现 + 3 评审 + 2 规划),id 全部实测存在于运行时名册 |

## 三、**不应**依赖全局文件的部分(本次核实结论)

`~/.dsh/AGENTS.md` 目前仍含以下段,它们**与插件重复或只存在于全局**:

| 全局段 | 状态 | 建议 |
|---|---|---|
| 进程管理(禁止重启宿主) | 已被 deep-ptc 的 ⓪⑨ 覆盖 | 可从全局删除 |
| 工作方式:速度与质量优先 | 与 dispatcher 注入**重复**;缺失的子项已在 #211 补进插件 | 可从全局删除 |
| 检索纪律 | #211 前**只存在于全局**,现已进插件 | 可从全局删除 |
| 迁移规则附加层 · 危险操作 | 已进插件(「扇出不改变授权」) | 可从全局删除 |
| 迁移规则附加层 · 规则库 bootstrap | 部署本地约定(`~/.agents/rules-library/`) | **保留在全局** |
| Agent 路由表 | 已进插件(角色表) | 可从全局删除 |

> 删减全局文件是**用户文件的改动**,需用户确认后执行,不在插件 PR 里自动做。

## 四、在干净机器上核对

```bash
# 1. 插件是否真的自带注入文本(不依赖任何全局文件)
cd packages/dsh-task-dispatcher
node --input-type=module -e "import {renderDelegationText} from './lib/delegation-text.mjs'; console.log(renderDelegationText('zh'))"

# 2. 每条应自带的条款是否都在
node --test test/owned-clauses.test.mjs

# 3. 注入段不引用任何机器本地路径
node --input-type=module -e "
import {renderDelegationText} from './lib/delegation-text.mjs';
for (const l of ['zh','en']) {
  const t = renderDelegationText(l);
  if (/AGENTS\\.md|~\\/\\.dsh/.test(t)) { console.error(l, 'points at an external file'); process.exit(1) }
}
console.log('ok')"
```
