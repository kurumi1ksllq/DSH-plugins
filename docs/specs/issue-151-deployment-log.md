# Issue #151 部署与续接记录(2026-11-10,重启前落盘)

## 重启原因(用户已批准)
1. 重组合后 `dsh-stall-governor` 行 activation failed:webserver 路由 `/plugins/stall-governor/settings` 被旧注册泄漏占用,行级 toggle 清不掉 → ⓪ 命令执行纪律段暂时下线。
2. deep-ptc-mode 白名单(`DELEGATION_PRESET_WHITELIST` → `agent_preset` 参数)运行时 preset 定义未换新(DSH 回报 `unmanaged-plugin`,行级 toggle 无效)。

## 重启前已生效(无需再动)
- `dsh-auto-delegation` 已安装且 active:纪律 + 路由表注入已到达所有会话成员(本会话与子 agent 实测)。
- profile patch 已移除 133 个非常用 preset(备份:/tmp/cordis.patch.yml.backup-20261110),组合层仅剩 9 个 preset(4 内置 + 5 白名单)。
- `ecc-agent-presets` bundle 已安装但 **disabled**(启用实测 142 全量回归 OK,停用回到 9)。需要全量名册时:`plugin_manager set_bundle ecc-agent-presets enabled:true`。

## 重启后待办(续接检查单)
1. `systemctl status dsh` 确认 active;Web GUI 可打开。
2. 验证 governor 恢复:`plugin_manager list_plugins`(offset 150)看 `include:dsh-stall-governor` fiberPhase 应为 active;新会话 runtime-context 应重新出现 ⓪ 纪律段。
3. 验证白名单:spawn 一个 fresh subagent,让它 `cordis_inspect_query(host/Tool/listTools)` 查 `subagent` 工具 schema 是否含 `agent_preset`(enum 应为 planner/architect/code-reviewer/security-reviewer/build-error-resolver);再实测一次 `agent_preset: 'planner'` 的极小委派。
4. 完成验收:`pnpm test`(唯一预期红=P1-6 lockfile 提交闸,commit 后转绿)+ `pnpm verify` 全绿。
5. 继续停点3:声明 push → commit(含 lockfile)→ `gh pr create`(Closes #151)→ 查 CI 一次 → 双轴 review → 等 merge 口令。

## 关键文件
- spec:docs/specs/issue-151-auto-delegation-preset-slim.md
- 分支:issue-151-auto-delegation-preset-slim(issue #151)
- 新包:packages/dsh-auto-delegation(纪律+路由表注入)、packages/ecc-agent-presets(133 preset 收纳,disabled)
- 改动包:packages/dsh-deep-ptc-mode(v1.12.0:model.mjs 白名单 derive + check 门扩展)

## 重启后验证结果(2026-11-10 14:3x)
- DSH active(14:13:17 起);`include:dsh-stall-governor` fiberPhase **active**(路由泄漏随重启清除),⓪ 纪律段恢复。
- 注入段(⓪ + 自动委派编排)在新 runtime-context 中并存 ✓。
- 组合层 preset = 9(4 内置 + 5 白名单)✓;ecc-agent-presets 停用中,启用实测回归 142 ✓。
- **白名单 `agent_preset` 参数**:代码/测试/本地 derive 复现(linux/auto,真实 settings)全部正确;重启后注册表持有新定义。子会话仍看不到参数的原因 = **继承语义**(dsh-subagent `composeFrom`:子 agent 绑定 parent 持有的精确 revision,本会话是重启前组合的 cordis 系会话)→ **新定义只影响新根会话**;请在 Web UI 新建任务(deep-ptc 默认)实测 `agent_preset`。

## 验收 C 实测步骤(merge 暂缓,等本项闭合;2026-11-10 用户裁决)
在 Web UI(http://103.236.71.248:10100/)**新建一个任务**(默认 preset=deep-ptc,即重启后的新根会话,继承语义不适用),对 agent 说:
> 用 cordis_inspect_query 查你自己的 subagent 工具 schema,报告是否含 agent_preset 参数及其 enum;若有,用 agent_preset="planner" 委派一个只回复"收到"的子 agent。

预期:①参数存在且 enum = planner/architect/code-reviewer/security-reviewer/build-error-resolver;②委派成功。通过后:本文件打勾 → `.flow/151.json` ticket5 → green → 回 PR #152 执行 merge(口令 merge 或点选「merge 本 PR」)。
