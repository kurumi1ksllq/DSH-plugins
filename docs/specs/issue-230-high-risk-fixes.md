# issue-230:修复审查发现的 3 个高危缺陷

**分级:standard**(3 个包、3 处行为变更、均有测试)

## 目标

1. **A(MCP gate 供应链面)**:`packages/dsh-inventory/lib/workspace-gate.js`
   - `findDeclaration` 的 `searchParentLimit` 默认从 `Infinity` 收紧为 **16**(任何实际工作区都在仓库根之下,16 层足以覆盖;再往上是家目录,克隆进来的恶意声明不该从那里命中)。
   - gate 挂载的**首次可观测性**:gate.js 已有文件日志,补齐「命中声明文件时在日志里写明 root 与 server 名」(已有 emit,确认覆盖即可,不新增确认通道——确认通道需要 UI 面,超出本 issue)。
   - **取舍声明**:默认收紧是行为变更;既有部署若依赖 >16 层的父目录声明,可通过 config `searchParentLimit` 显式调回。写进 README。

2. **B(插件更新阻塞宿主)**:`packages/dsh-inventory/lib/plugin-update.js`
   - `gitIn` 与 `runIn` 从 `execFileSync` 改为异步 spawn(带 timeout/maxBuffer,语义不变:failure-as-value)。
   - `performUpdate` / `moveCheckout` / `localBundles` / `remoteVersionsAt` / `changedFiles` / `needsInstall` / `probeTargetEntries` 等调用链随之异步化。
   - `checkUpdatable`、`readCheckoutState` 保持纯函数/同步不动(无 IO 或仅值传递)。`readCheckoutState` 内部有 git 调用 → 也异步化。
   - index.js 的 `handlePluginUpdate` / `handlePluginUpdateApply` 与 `pluginCheckoutRoot` 适配 async。
   - **验收**:更新期间事件循环不被阻塞;并发两次 apply 仍被 hmr.runExclusive 串行(现有行为不变)。

3. **C(failover stats 竞态)**:`packages/dsh-websearch-failover/index.js`
   - search 路径的 runtime read-modify-write 串行化:复用 `createMutex`,与 refresh/resetStats 同一把锁。
   - **验收**:并发测试证明 search 与 refresh 交错不丢数据。

## 边界

- 不新增 MCP 挂载的用户确认通道(UI 面,另行 issue)。
- 不动 http-guard 重复拷贝问题(另行 issue)。
- 不动 failover CLI 的 --timeout(另行 issue)。

## 验收

- 每个 ticket 红绿循环;测试只测公开行为。
- `pnpm test` / `pnpm verify` 全绿。
- 升版本:dsh-inventory、dsh-websearch-failover(patch)。
- CHANGELOG 补条目。

## 裁剪

- 无。双轴 review 按 standard 执行。
