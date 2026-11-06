# spec: MCP 全局开关写入正确的 patch 层 (#82)

> 停点2 产物。用户于 2026-11-06 预授权「自行判断和解决」，分级 **standard**。

## 1. 目标

总览页 MCP 全局开关对定义在 **home patch**（`$DSH_HOME/cordis.patch.yml`）的条目（如
`rea setup` 注册的 rea-mcp）生效。根因：开关固定写 profile patch，而 DSH 核心合成顺序
（`dsh-app-boot` `readProfilePatches`）为 bundle → profile patch → **home patch** → overlays，
home patch 的 insert 在 profile patch 的 disable 覆盖之后应用，覆盖对未 insert 的 id
静默跳过（`cordis-plugin-include` `applyPatches`），该行永远 enabled。

## 2. 方案

1. **判定层**（`lib/global-patch.js` 新增纯函数）：给定 id 与 profile/home 两个 patch 的
   文本，返回 id 的定义层：home patch 中出现该 id → `home`；否则 profile patch 中出现 →
   `profile`；都未出现 → `null`（bundle 或不存在）。home 优先：它在合成顺序中最后应用，
   同 id 多层定义时最终状态由它决定。
2. **写入路由**（`index.js` `toggleGlobalMcp` patch 回退路径）：按判定结果写入对应文件；
   `null` 维持现状写 profile patch。payload 的 `path` 报告实际写入文件。pluginManager
   在线路径不变。
3. **来源标注**：snapshot 的每条 MCP 行新增 `source` 字段：`home-patch` / `profile-patch` /
   `bundle`（按 2.1 的判定，未命中两个 patch 文件即 bundle）；总览页渲染该标签。
4. **工作区分配语义**：本 spec 审视后**不变更**——「仅注册/工作区分配」逻辑不感知定义层，
   维持现状；如后续需要单独开 issue。

## 3. 边界

- 不改 DSH 核心（dsh-app-boot / cordis-plugin-include 是外部包）。
- pluginManager 可用时的 live 切换路径完全不动。
- `setPatchEnabled` 的文本编辑语义（保留注释、不重写带 config 的块）不变。

## 4. 验收

1. 反向测试：home patch 定义 rea-mcp 形态（`- id: rea-mcp` + config）时，点击开关写入
   **home patch**；profile patch 不被污染；再点恢复 enabled 时 home patch 内 disabled: false。
2. profile patch 定义的条目行为与现状逐字节兼容（既有 global-patch / host-route 测试全绿）。
3. id 在两个 patch 都出现时写入 home patch（最后应用层）。
4. snapshot 行带 `source`，UI 渲染标签。
5. `node scripts/verify-clean.mjs` 干净树全绿；dsh-inventory 版本号升 patch。
