# 文档漂移校正(README + 两份 update 运维文档)

- 分级:`standard`
- 状态:已完成(#38 → main `496aa2c`)
- 调查基准:`main @ 54b61c0`,2026-11-04,运行时 DSH `0.2.1-rc.5`
- 不做(拆成独立 chore issue #39):`pnpm-lock.yaml` 的 importer 漂移、`profile/node_modules/dsh-ctx-guard` 死链残留

## 1. 问题:三处文档与仓库实况已经不一致

本轮实测到的现状(每条都有命令可复核):

| 事实 | 证据 |
| --- | --- |
| `packages/` 下有 **7** 个 bundle | `ls packages` = dev-flow-skill / dsh-credential-vault / dsh-git-bash-tool / dsh-git-status / dsh-inventory / dsh-prompt-inject / dsh-websearch-failover |
| `dsh-ctx-guard` 已不在仓库 | `packages/` 无此目录;仅 lockfile importer 与 profile 死链残留 |
| profile 的 5 条 link 全部指向 `/root/DSH-plugins` | `node scripts/update.mjs plan` → `local=5 manager=4 updatable=0`,5 行全为 `/root/DSH-plugins @ 54b61c0` |
| profile 接线零告警 | `node scripts/check-profile.mjs` → `profile ok: 5 linked bundle(s)` |
| tag 齐全 | `git tag` 有 `dsh-inventory@0.5.0`、`dsh-credential-vault@0.2.1`、`dsh-websearch-failover@0.3.0` 等 |
| 有 CI | `.github/workflows/ci.yml` 存在,`push(main)` + `pull_request` |
| 每个 bundle 都有 test 与 `engines.dsh` | 7/7 有 `scripts.test`;7/7 有 `engines.dsh: ^0.2.0` |

### 1.1 `README.md`

- 插件表格只有 6 行,缺 `packages/dev-flow-skill`(它 `dsh.bundle` 为真)。
- 「装上」片段只列 4 条依赖:漏 `dsh-credential-vault`、`dsh-git-status`;`dsh-git-bash-tool` 列为常装项但它是 Windows 专属。
- **完全没提 `dsh.profile.bundles`**:照抄片段会 `pnpm install` 成功、DSH 却不加载。

### 1.2 `docs/update-scheme.md`(状态行写「L1 已落地;L2 已落地(实验性);L0/D1 未做」)

- 通篇以 **8 个 bundle**、**两个 checkout(A/B)各装一半**、**运行 commit 不在任何 tag / main 上**、**无 CI** 描述现状;这些结论现在全部失效(见上表),照读会把读者引向一个不存在的故障。
- P1-5(`check-profile.mjs` 缺失)、P1-8(`dsh-git-bash-tool` 无 test)、P1-9(无 `engines.dsh`)、P1-10(无 CI)均已修复,文档仍列为未修。
- P1-6(lockfile importers)仍未修 —— **本 issue 不动**,但要标注为「仍未修,另开工单」,不能跟着一起被标成已修。

### 1.3 `docs/update-checkout.md`(D1)

- 状态写「**待批准**。执行前不动任何 profile 配置。」,但阶段 1-2 实际已经做完(profile 5 条 link 全指 `/root/DSH-plugins`,`check-profile` 0 告警)。
- 通篇按「A/B 两个 checkout」叙述,包含已不存在的 `dsh-ctx-guard`。
- 应改成「已执行完成(2026-11-04 复核)」+ 保留原始方案作为历史记录,而不是删掉。

## 2. 目标

让「新会话读 README 就知道怎么装、怎么更新」「读两份 update 文档不会得到已失效的结论」这两件事,由**测试**钉住而不是靠人记得。

## 3. 边界

- 只改 `README.md`、`docs/update-scheme.md`、`docs/update-checkout.md`、`test/docs-contract.test.mjs`。
- `docs/update-scheme.md` / `update-checkout.md` **不删正文**:保留方案与调查记录,在校准块里声明哪些结论已失效及证据。
- 不动任何 `packages/` 代码,因此**不升版本号**(`check-bundle-versions` 只看包目录)。
- 不动 profile、不动 lockfile、不重启 DSH。

## 4. 验收

1. `pnpm test` 全绿,其中新增契约能**反向验证**:把 README 的 `dsh.profile.bundles` 说明删掉、或把某条 link 从片段里删掉,对应测试必须变红。
2. `pnpm verify` 全绿。
3. 按 README「装上」一节从头照做,能在一台干净机器上装出与当前 profile 等价的结果(5 条 link + bundles 清单 + 重启 + `check-profile.mjs` 0 告警);文中的路径写法必须与实际 profile 一致。
4. `docs/update-scheme.md` 不再出现「8 个 bundle」;两份文档都带一个带日期与 commit 的现状校准块。

## 5. Tickets

| # | 标题 | 依赖 | 验收 |
| --- | --- | --- | --- |
| T1 | 在 `test/docs-contract.test.mjs` 写三组契约(先红) | — | ① 安装片段的 `link:` 行覆盖 `packages/` 下每个 bundle 包名;② README 必须出现 `dsh.profile.bundles` 并说明「加了依赖不加这一行不会加载」;③ 两份 update 文档不得含「八个/8 个 bundle」旧计数,且必须含形如 `现状校准(YYYY-MM-DD,main @ <7 位 sha>)` 的块。当前三组全红。 |
| T2 | 按契约改 `README.md`:表格补 `dev-flow-skill`,安装片段补全 5 条 link + `git-bash-tool` 标注 Windows 专属,补 `dsh.profile.bundles` 说明与全新机器完整步骤 | T1 | T1 的 ①② 转绿;步骤可直接照抄执行 |
| T3 | 两份 update 文档加现状校准块,把失效结论与已修复的 P 项标注掉,`update-checkout.md` 状态改为已执行 | T1 | T1 的 ③ 转绿;P1-6 明确标注「仍未修,另开工单」 |
| T4 | 全量 gate + 自身一致性复核 | T2,T3 | `pnpm test`、`pnpm verify` 全绿;`node scripts/update.mjs plan` 与文档描述一致 |

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 校准块写成「历史」就没人读了 | 校准块放文档最前面,一句结论 + 一句证据命令 |
| 把 P1-6 一起标成已修(假绿) | T3 验收里点名要求它保持「仍未修」 |
| README 片段与真实 profile 再次漂移 | T1 的 ① 以 `packages/` 目录为唯一事实源,bundle 增删会直接让 CI 变红 |
