# #145 测试 scratch 无清理 + 版本门规则3 靠实现弱点

- 分级：`standard`（1 个校验脚本 + 若干测试文件 + 文档；两个独立子项）

## 目标

两件事：

1. 测试 `mkdtempSync` 产生的 scratch 目录从不清理，每跑一次全量就堆一批；
2. `check-bundle-versions.mjs` 的规则3 注释说「相对上次 tag 改了代码必须升版本」，实现只查未提交改动——**已提交的代码改动 + 没升版在正常 PR 流程里 100% 放行**。

## 现状（实测）

### A. scratch 堆积

`grep` 全仓（排除 node_modules/.agents）：**31 个测试文件**有 `mkdtempSync` 且无 `rmSync`，合计 **102 个调用点**。

| 包 | 无清理文件数 |
| --- | --- |
| `packages/dsh-inventory` | 16 |
| `packages/dev-flow` | 10 |
| `packages/dsh-websearch-failover` | 4（本批 #182 已修 3 个，`probe-bundle.mjs` 剩 1） |
| `packages/dsh-deep-ptc-mode` | 2 |
| `test/skill-surface-scripts.test.mjs` | 1 |

实测：`sync-issues-5-8.test.mjs` 单跑一次留 **26 个**目录（profile×6 / repo×6 / vault×6 / skills×3 / bin×2 / badroot×2 / home×1）；`dsh-inventory` 全量跑一次留 **483 个**。

### B. 规则3 的实际行为

代码是两层前置条件（`:133-144`）：

```
if (!tags.includes(name@当前版本))  →  只 push 一条 note，永不失败
else                                →  才查 git status --porcelain（未提交改动）
```

**三种情形实测**（scratch git 仓库）：

| 情形 | 结果 |
| --- | --- |
| 已提交的代码改动 + 没升版 | `bundles ok: 1 checked` / **exit 0** ← 完全放行 |
| 未提交的代码改动 | `FAIL … bump the version` / exit 1 |
| 升版但没打 tag | `note … untagged version` / exit 0 |

也就是说规则3 只拦「忘了提交」这一种情况。而注释里的 "since its last tag" **在代码里没有对应物**——`git tag --list` 是平铺列表，`name@当前版本` 做精确存在性判断，没有 `git describe`、没有版本排序。

### C. 本仓有 3 个错位 tag（决定修法）

| tag | tag 提交里 manifest 声明的版本 |
| --- | --- |
| `dsh-inventory@0.12.2` | **0.12.1** |
| `dsh-websearch-failover@0.2.0` | **0.3.0** |
| `dsh-websearch-failover@0.3.1` | **0.3.0** |

所以「直接用最近的 tag 当基线」会拿错版本比、**产生假绿**。新规则必须校验「该 tag 的提交里 package.json 确实声明了那个版本」。

## 方案

### 1. 加 `--root DIR`（必须先做）

照抄 `scripts/verify-packages.mjs:27-35` 的 `rootFromArgv`。

**没有它规则3 无法用公开行为测**——测试必须造「带 git 历史的假工作区」，否则只能 import 私有函数（违反仓库硬规则「禁测私有函数」）。这是本方案最关键的一步。

### 2. 重写规则3

1. 基线 = `git tag --merged HEAD --list '<name>@*' --sort=-v:refname` 里第一个**其提交的 manifest 确实声明了该版本**的 tag。`--merged HEAD` 排除其它分支的 tag；版本校验过滤错位 tag。
2. 变更集 = `git diff --name-only <baseline> -- <rel>` **+** `git ls-files --others --exclude-standard -- <rel>`（已提交 + 未提交 + 未跟踪）。这一步吞掉原来的 `porcelain` 检查。
3. 含**非测试文件**且 `version <= baseline.version` → 报错。
4. 「当前版本未 tag」保留为 note，**不再是版本门的前提**。

### 3. 测试豁免口径

豁免：`test/`、`tests/`、`__tests__/` 目录下任意文件 + 任意 `*.test.mjs` / `*.spec.mjs` / `test-*.mjs`。

**`test-governor/` 不能整目录豁免**——它在 `packages/dsh-deep-ptc-mode/package.json` 的 `files` 里，`old-keys-baseline.json` 会随包发布。

**docs 不豁免**：本仓 #180 就是改 README 并升版打 tag（`dsh-inventory@0.12.3` 等），惯例是 docs 改动也升版。

### 4. 补 scratch 清理

本 PR 先做 `dsh-inventory` 的 16 个（量最大、issue 点名）。统一形态：`created[]` + `after()`（`workspaces.test.mjs:34` 已有先例），或对单文件用 `process.on('exit')`。

其余 15 个（dev-flow 10 + deep-ptc 2 + websearch 1 + repo test 1）**另开 PR**，避免 diff 到 ~1000 行、review 成本过高。

### 5. 文档

- `check-bundle-versions.mjs:1-25` 的注释按新实现重写；
- `AGENTS.md` 的版本纪律补一句「test-only 豁免」；
- `CHANGELOG.md:8-9` 那句 "A bundle whose directory has changes after its version tag fails the gate" 现在是**事实错误**，必须改。

## 验收

- T1 已提交的代码改动 + 未升版 → exit 1，含 `bump the version`
- T2 只有测试文件改动 + 未升版 → exit 0
- T3 改了 `files` 里发布的测试 fixture（`test-governor/*.json`）→ exit 1
- T4 未提交的代码改动 → exit 1（保证旧行为不退化）
- T5 升版但未 tag → exit 0 + note 含 `untagged version`
- **T6 错位 tag 不作基线**（这是 bug 修复的实证）
- 每条 `try/finally rmSync` 清 scratch——否则本 PR 自己就在制造 issue 描述的堆积

反向验证：`needsBump` 恒 false → T1/T3/T4 红（T2/T5 仍绿）；恒 true → T2 红；去掉基线版本校验 → T6 红。

## 边界

- 不动 `packages/*/lib/**` 任何运行时行为
- 不改 profile、不重启 DSH
- 规则变严**不会**让历史提交因规则3 变红——实测 `9efbf72` 上规则3 失败 **0 条**（错位 tag 让基线退到 0.12.1，而 `manifest.version` 是 0.12.2，`isHigherVersion(0.12.2, 0.12.1)` 为真，条件本就不成立）。
- 但历史提交仍会**因规则4 变红**：`9efbf72` 报 10 条 `has no CHANGELOG entry`，`064284b` 报 6 条——原因是那些 tag 的 CHANGELOG 条目在更晚的提交里。**这与规则3 无关**，从旧提交拉分支时不要把它当成规则3 的假红。

## 与其它 issue 的关系

- **#182（已合并）**：它的新门禁把 3 个 websearch 文件的泄漏从 0 放大到每轮 3 个，本 PR 的 scratch 清理与之同源。
- **其它 8 个 issue 全部已合并或关闭**，本 PR 是这批的最后一个。