# issue-290 关键配置原子写(cordis.patch.yml / plugin-sync.json)

分级:standard(1 个新模块 + 2 处写点改调用 + 1 个新测试文件,接口不变)

## 问题(来源 #270)
两处关键配置直接 `writeFileSync` 覆盖目标文件:
- `writePatchEnabled` 写 `cordis.patch.yml`:中断会截断启动配置,下次宿主起不来。
- `writeState` 写 `plugin-sync.json`:非原子写本身制造损坏,且 `{ mode: 0o600 }` 只在创建时生效,已存在文件的权限不会被收紧。

## 修法
新增 `packages/dsh-inventory/lib/atomic-write.js`:
`atomicWrite(path, data, { mode, fs })` —— 同目录临时文件 → `fchmod` → `rename` 覆盖;失败时删临时文件再抛原错。`fs` 可注入,便于测试证明「写失败时目标不变」。

两处写点改为调用它:
- `sync-state.js` 的 `writeState`(mode 0o600,已存在文件也会被纠正)。
- `global-patch.js` 的 `writePatchEnabled`。

其余非原子写点不在本 issue 范围(属于 #278 汇总)。

## 验收
- `test/issue-290-atomic-write.test.mjs`:①注入只让 write 失败的 fs,目标文件保持原内容且不留临时文件;②已存在 0644 文件写入 0600 后权限被纠正;③`writeState` 部分更新不丢已有字段且权限收紧;④`writePatchEnabled` 写入后不留临时文件。
- 反向验证:把两处 `atomicWrite` 换回 `writeFileSync` 时对应断言变红。
- 目标测试 28/28 通过(sync-state + global-patch + 新测试)。

## 变更点
`writePatchEnabled` 的临时文件与目标同目录,因此目录必须可写(原本也必须,写目标本身就需要)。无接口变更。
