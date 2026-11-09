# Phase 5 收口(#135)

spec: docs/specs/plugin-consolidation.md §4 Phase 5 / T5。分级:standard。

## 审计现状(实测)

1. **根 README 计数**:初判「措辞一致」有误(轴1 复核)——49 行「本仓库的 9 个」与 74 行「7 条必装」为九包时代残留;目录表格亦缺 dsh-deep-ptc-mode 行。均已修复。
2. **AGENTS.md**:目录速览表格缺 dsh-deep-ptc-mode / dsh-credential-vault / dsh-websearch-failover 三行(仅列 dev-flow/inventory);「五个」计数一致。
3. **CHANGELOG**:Unreleased 段(13–144 行)共 14 个条目(初判「6 个」系只数了前段),全部已 merge 且 tag 在——实为「已发布未归档」;无冲突标记残留;历史格式为两个 Unreleased 段 + History 段。
4. **tag 清单**:五包版本一一对应 tag(dev-flow@0.4.0 / dsh-credential-vault@0.6.0 / dsh-deep-ptc-mode@1.11.0 / dsh-inventory@0.12.0 / dsh-websearch-failover@0.5.0);吸收包(dsh-stall-governor@0.1.x 等)为历史 tag,保留。
5. **包 README 数字漂移**:grep 三处命中均为合法内容(进度点图示/测试计数/测试文件数),非 bundle 计数漂移。
6. **吸收包残留引用**:dev-flow 的 README-git-status.md、inventory 的 README-prompt-inject.md、deep-ptc-mode 的 README-governor/gitbash 为吸收历史文档(记录性),不计漂移。

## 方案

| # | 内容 |
|---|---|
| 1 | 根 README 目录表格补 dsh-deep-ptc-mode 行(与正文引用一致) |
| 2 | AGENTS.md 目录速览补三行(dsh-deep-ptc-mode / dsh-credential-vault / dsh-websearch-failover) |
| 3 | CHANGELOG Unreleased 标题下加一行说明(当前 6 条目均已打 tag 发布,待统一归档),避免大规模移动产生冲突风险 |
| 4 | verify-clean 全量(隔离 DSH_HOME) |
| 5 | docs/specs/plugin-consolidation.md §4 Phase 5 勾选收尾 |

## 边界

- 只动 README.md / AGENTS.md / CHANGELOG.md(加说明行)/ docs/specs 两文件;不动包内容、不动 tag。
- 吸收历史 README(README-governor 等)保留,不属漂移。

## 验收

1. README 表格 5 行、AGENTS 速览含五包;计数措辞无矛盾。
2. verify-clean(隔离 DSH_HOME)全绿;repo 级 docs-contract 测试全绿。
3. tag 清单核对记录在案(五包一一对应)。
