# Issue #153:dsh-auto-delegation 更名 dsh-task-dispatcher

## 背景与意图

#151 交付的两个包中,自动拆分+路由任务的插件现名 `dsh-auto-delegation`;用户裁决改名为 **`dsh-task-dispatcher`**——"调度器"直指行为(AI 拆解任务、按内容把每个子任务派给匹配的 subagent preset)。收纳包 `ecc-agent-presets` 不动。

改动面 = 纯重命名 + 版本纪律 + 部署侧重装,**运行时行为零变化**。

## 改动清单(仓库内)

1. `packages/dsh-auto-delegation/` → `packages/dsh-task-dispatcher/`(目录)
2. package.json:`name: dsh-task-dispatcher`,`version: 0.1.0 → 0.2.0`(包内容变,版本必须升;语义上仍是同一插件,升 minor)
3. `cordis.patch.yml`:行 id `auto-delegation` → `task-dispatcher`(**行 id 变更**:DSH 靠 id 识别行,旧行将随 remove_bundle 移除,新行是新挂载;patch 注释里的 CONTEXT_NAME 不变,注入段名 `dsh:auto-delegation-discipline` 是模型面文本,不属于包名——**保持不变**,避免破坏已发会话的延续性)
4. `index.js`:`export const name = 'dsh-task-dispatcher'`
5. 测试:bundle.test 断言同步(name/id);apply.test 不变(断言段名/order,与包名无关)
6. 仓库文档接线:README(计数不变,link 行/bundles 行/描述)、AGENTS.md 目录速览、CHANGELOG(Unreleased 增 `### dsh-task-dispatcher 0.2.0` 条目,注明更名自 dsh-auto-delegation 0.1.0,tag 纪律说明)、update-scheme.md 包集合列表、verify-packages EXPECTED、check-profile SHIPPED、locale-contract(无 client 字典,不涉及)
7. pnpm-lock.yaml:importer 路径随目录变更(pnpm install 刷新)

## 改动清单(部署侧,用户已批准流程,执行前再逐项确认)

1. `plugin_manager` remove_bundle `dsh-auto-delegation`(移除旧行与 link)
2. `plugin_manager` install_bundle `/root/DSH-plugins/packages/dsh-task-dispatcher`(新行 `task-dispatcher` 挂载;toggle 触发重组合)
3. 验证:`dump-config` 含 `task-dispatcher` 行、不含 `auto-delegation` 行;注入段(`dsh:auto-delegation-discipline`)在新 runtime-context 中仍出现(本会话经重组合即可观察)
4. **不重启 DSH**(此次是行替换,幂等行变更走 HMR;若插件管理器回报 restart-required 且行为可容忍,记录后顺延到下次自然重启)

## 边界

- 不改注入文本内容、CONTEXT_NAME、order、路由表、白名单(零行为变化)
- 不动 ecc-agent-presets;dsh-deep-ptc-mode **不改其行为,仅允许镜像契约接线**(delegation-whitelist 测试与 model.mjs 注释里的跨包路径随更名同步)+ 版本号 + CHANGELOG 条目 —— 2026-11-10 双轴 review 后经用户批准修订(原「不动 dsh-deep-ptc-mode」漏列了目录更名导致的必要路径接线,见 review 轴1 问题1)
- 旧 tag `dsh-auto-delegation@0.1.0` 保留(指向 merge 前的 0.1.0 历史,git tag 不改写);新 tag merge 后打 `dsh-task-dispatcher@0.2.0`

## 验收

1. **活代码/活文档零残留**(2026-11-10 用户批准收窄口径):README/AGENTS/scripts/lockfile/包名/目录/行 id 层面 grep 零命中;豁免:CHANGELOG 历史与溯源条目、注入段名 `dsh:auto-delegation-discipline` 及其测试字面量(行为面,保留是正确的)、历史 spec(#151)与本 spec 自身。
2. `pnpm test` 全绿;`pnpm verify` 7 包全绿(check-bundle-versions 接受 0.2.0)
3. 部署后:profile 组合含 `task-dispatcher` 行、不含 `auto-delegation`;runtime-context 注入段实测仍到达(本会话或新子会话)
4. dev-flow:issue/分支/TDD/PR/CI/双轴 review/merge 口令;tag 于 merge 后打

## Tickets

| # | Ticket | 依赖 |
|---|---|---|
| 1 | 目录/包名/行 id/index.js name/测试断言 更名 + 版本 0.2.0 | - |
| 2 | 仓库文档接线(README/AGENTS/CHANGELOG/update-scheme/EXPECTED/SHIPPED/lockfile)+ 全仓 grep 零残留 | 1 |
| 3 | 部署侧 remove→install→验证(不重启);PR/CI/review | 2 |
