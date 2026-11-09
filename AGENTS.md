# 本仓库的开发约定

这个文件告诉每一个新会话：在本仓库改东西要按什么规矩来。
完整规则在 `packages/dev-flow/SKILL.md`，这里是入口与不可协商的部分。

## 改代码必须先走 dev-flow（强制）

**任何会导致仓库文件内容变化的请求**（包括“只改一行”“改个错别字”“格式微调”），
先调用 `dev-flow` skill，再谈实现。改动大小不影响是否进流程，只影响分级。

流程：`issue → 分支 → TDD → PR → CI → 双轴 review → merge`。
只有 **3 个实质停点**要等用户点头，其余自动推进：

| 停点 | 内容 |
| --- | --- |
| 停点1 | 一句话说清意图 + 分级（trivial / standard） |
| 停点2 | spec + tickets 落盘 `docs/specs/<topic>.md`，用户确认后自动建 issue 与分支 |
| 停点3 | push 前声明 → 开 PR → 查 CI 一次 → 双轴 review → **等具体 merge 口令** |

### merge 闸

merge 必须用户说出 **`merge` 或点名 PR 号**（如 `merge #33`）。
“嗯 / 好 / 继续 / 行 / 通过”都不算授权。

## 禁止直接改 main

任何代码改动都在 `issue-<n>-<描述>` 分支上，经 PR 进入 main。

## 任务板与状态文件

侧栏 Git 面板是一个 **dev-flow 任务板**：一列 = 一个流程节点，一张卡 = 一个 issue。
它靠读 `docs/specs/.flow/<issue>.json` 才能显示 TDD 内部进度（Git 和 GitHub 不知道这些）。

**每过一个流程节点写一次该文件**，字段与枚举见 `SKILL.md` 的「任务状态文件」章节。
格式错、缺失、枚举越界都会被面板当作「没有记录」降级处理——**不会报错，只会停在旧列**，
所以漏写不会造成事故，只会让任务板不准。

## 完工验收四件套

每个 ticket 完成需全绿（仓库里没有的项跳过）：

```bash
pnpm test      # 全部包的 node --test
pnpm verify    # 打包元数据：bundle 清单 / artifact 副本 / profile 链接 / 版本纪律
```

多会话共用同一个 checkout 时，上面两条可能被**别人的未提交改动**或**宿主 git 全局配置**（如镜像 `insteadOf`）带偏而假红。
这时用干净验证路径——它把 HEAD 检出到临时 worktree、隔离 `HOME`/`GIT_CONFIG_GLOBAL` 后跑同样的四件套，结束自动清理，不写宿主工作树：

```bash
node scripts/verify-clean.mjs                 # install --frozen-lockfile + verify + test
node scripts/verify-clean.mjs -- <command…>   # 或只跑自定义命令（同样隔离）
```

### 版本纪律

改动了某个包就必须升它的版本号（`check-bundle-versions` 会拦），
合并后在 main 上打 `<包名>@<版本>` 的 tag。

## 提交与回复

- commit 只在流程节点执行（停点3 声明后、CI 自修重推时），其余时候等用户明确要求
- 提交后的回复末行加状态行：`branch / PR / CI 状态`

## 其它硬规则

- **禁测私有函数**：不 import 内部私有符号、不断言调用次数与内部调用顺序，只测公开行为与输出
- 枚举常量（如 `.flow` 文件格式的 `STAGES`）属于对外协议，可以断言其内容与顺序
- 新测试必须能反向验证：改坏实现时它要变红

## 目录速览

| 路径 | 内容 |
| --- | --- |
| `packages/*` | 五个可独立 `link:` 的 bundle，各自有 `package.json` / `cordis.patch.yml` / 版本号 / 测试 |
| `packages/dev-flow` | 开发流程 skill（规则源）+ dev-flow 任务板面板（读 `.flow` 状态） |
| `packages/dsh-inventory` | 工具管理页（凭据 / 搜索提供方 / 提示词三个分段） |
| `packages/dsh-credential-vault` | 凭据保险库（AES-256-GCM 存储 + `credential` 工具 + 管理 API） |
| `packages/dsh-websearch-failover` | `web_search` 有序多提供方失败转移 |
| `packages/dsh-deep-ptc-mode` | 深度 PTC 会话模式 + 失速治理双引擎（含 Git Bash 替换） |
| `docs/specs/` | 每个 issue 的 spec（停点2 产物） |
| `docs/specs/.flow/` | 任务板状态文件（运行时状态，随分支走） |
| `scripts/` | 打包校验脚本，`pnpm verify` 调它们 |
| `test/` | 仓库级文档契约测试 |

## 纪律文本谱系(防误归因,#144)

会话里注入的「⓪ 命令执行纪律(order=20000 固定段)」的本体在本仓库:

- **真源**:`packages/dsh-deep-ptc-mode/lib/governor-copy.mjs`(discipline0..9 双语字典,单源)+ `lib/governor-anchor.mjs`(拼装与导出,EXEC_DISCIPLINE_TEXT 为 zh 派生值)。zh/en 同构由 `test/discipline-copy.test.mjs` 契约守护。
- **谱系**:上游 dsh-cot-anchor v0.4.2(JiewiW,411cb74/005bb91,/tmp 调研克隆已删)→ #96 b2474a6 首次引入⑨宿主条款 → #115 吸收进 dsh-deep-ptc-mode → #120 拆模块 → #138 locale 字典化 → #144 单源化。
- **安装位**:link: 装入 `~/.dsh/profiles/web/node_modules/dsh-deep-ptc-mode`(符号链接指向本仓库,改代码需 DSH 侧重载生效)。
- 详见 `docs/specs/issue-144-discipline-single-source.md`。

## 注意

- 根 `package.json` 不声明 `dsh.bundle`，否则它会变成第六个 bundle
- 各包的包名、行 id、`cordis.patch.yml` 里的 `- id:` 一律不动，DSH 靠这些识别插件
- **未经用户明确批准，严禁重启 DSH 进程**（详见全局 `~/.dsh/AGENTS.md`）
