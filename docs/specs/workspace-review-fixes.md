# spec: 工作区功能 review 修复(#69-#75)

来源:2026-11 对工作区功能的全量 review(4 视角 + 对抗复核,9 findings 全部 confirmed)。

## 目标

修复 review 发现的 1 个 P1、2 个 P2、4 个 P3,不改变任何已验证的正常行为。

## 侦察结论(修复依据)

1. **同名 serverName(dsh-mcp-client/lib/index.js:818-819)**:同一 agent 内
   `names.has(config.serverName)` → `throw new Error("serverName ... is already in use")`。
   即默认无后缀时,全局已启用 + 工作区再声明同名 → gate 挂载抛错(warn 降级),不会共存。
2. **默认工作区(dsh-workspace/lib/index.js:414-437, 686)**:`ensureDefaultWorkspace`
   经 `createCanonical` 写入 registry 持久表;正常安装 registry 一定列出它。
   快照合成逻辑只是 registry 服务不可用时的兜底。

## 分四个 PR 修复

### PR1 文案契约(#69 P1、#70 P2、#73 P3)

- `WORKSPACE_MCP_SECTION`(index.js:105-127)重写:
  - 挂载名 = `<name><gateSuffix>`,gateSuffix 读自 snapshot 的 `gateServerNameSuffix`,
    **默认安装为空串**;与全局同名时 gate 会因 serverName 冲突拒绝挂载,不要重复声明;
  - "全局停用时唯一控制"按能力拆开:MCP 成立;技能只有 vault 技能可用工作区链接启用;
  - 补单文件 vault 技能形态 `<name>.md`(链接为 `<projectRoot>/.dsh/skills/<name>.md`)。
- `client.js`:「重复挂载」徽章按 `gateServerNameSuffix` 分流——非空=重复挂载(工具翻倍),
  空=同名冲突(工作区副本不会挂载);locale 两套同步。
- `README.md:212/214/222` 同步为条件表述。
- prompt 契约测试(workspaces.test.mjs)补锚点:断言不含裸 `-ws` 断言、含
  `gateServerNameSuffix`、含单文件形态、按能力拆分的开关表述。

### PR2 默认工作区写路径(#72 P3)

- `findWorkspace`(index.js:647-663):registry 未命中时回落 `readDefaultWorkspace()`
  (仅当其 id 不在 registry 列表中),使快照合成的默认工作区卡片可完成 add/remove。
- `relinkWorkspaces`(index.js:961-975):同样纳入默认工作区。
- 路由级测试:registry 为空 + storage 有默认 → POST add 成功。

### PR3 空声明状态(#74 P3)

- `lib/workspace-gate.js` `planMount`:0 条合法声明时返回值增加 `empty: true` 标记。
- `lib/workspaces.js` `readWorkspaceMcp`:文件存在 + 结构合法 + empty → `{status:'ok', servers:[]}`;
  仅真正解析失败保持 invalid。测试覆盖三种状态。

### PR4 测试补强(#71 P2、#75 P3)

- gate 接线:`mcpClientEntry` stub + `ctx.plugin` 捕获,断言 `serverNameSuffix: '-ws'`
  透传到挂载名 `officecli-ws`;host-route 断言 snapshot.gateServerNameSuffix 读回。
- cleanup 用例补监听删除断言;`allowServerNames` 纯函数用例;
  relink 循环(assign→remove→再 assign,消费方 planMount 重新可见)。

## 边界

- 不改 gate 默认配置(不设出厂 `-ws`,保持 README:19-32 的部署方自选语义)
- 不动包名/行 id/cordis.patch.yml 的 `- id:`
- 每个 PR 升 dsh-inventory 版本号(版本纪律)

## 验收

- [ ] 四个 PR 各自:全量测试 + `pnpm verify` 绿
- [ ] prompt/README/面板三处挂载名表述一致,默认安装下不再断言 `-ws`
- [ ] `{"servers":{}}` 面板显示正常空态
- [ ] 快照列出的每个工作区(含合成的默认工作区)可完成 add/remove 闭环
- [ ] #71/#75 所列缺口各有新测试,改坏对应实现会变红
