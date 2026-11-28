**分级:standard**(1 个包、1 个导出函数的行为修复、5 条新测试)

# issue-287:bootstrapRepoClone 引用未定义的 mkdir 与 explainError

## 问题

`packages/dsh-inventory/lib/sync-apply.js` 的 `bootstrapRepoClone`(`git clone --depth 1` 自动底座)里有两处未定义标识符:克隆前用 `await mkdir(repoRoot, { recursive: true })`(本文件导入的是 `mkdirSync`,没有 `mkdir`),失败分支用 `explainError(error)`(全文件从未定义)。首次安装没有底座时,真正的克隆从未执行、错误文案也无法渲染——调用方 `applyItems` 只会把 `ReferenceError: explainError is not defined` 之类的原始异常透出到每一行 repo 结果上(#266 观察到的必抛)。

## 修法

- `await mkdir(repoRoot, { recursive: true })` → `mkdirSync(repoRoot, { recursive: true })`(同步函数,本就已在导入清单里)。
- 失败分支改走 HEAD 里已有定义但从未被调用的 `describeCloneFailure`,并充实其文案:缺 git 二进制 → 「找不到 git 可执行文件,请先安装 Git 或配置 options.gitBin」;超时 → 「克隆超时,请稍后重试或加大 timeoutMs」;stderr 命中鉴权特征(could not read Username / Authentication failed / Permission denied)→ 「鉴权失败,请检查 token 或仓库地址:…」;其余带退出码 + stderr 尾 3 行。任何失败路径返回的都是可读中文文本,不再抛 ReferenceError。

## 验收(test/sync-apply.test.mjs 新增 4 条 + 反向验证)

1. 克隆成功:options.gitBin 注入假 git 脚本,嵌套的全新 repoRoot 上 `{ ok: true, cloned: true }` 且 package.json 落盘。
2. 已有底座不动:repoRoot 已存在时 `{ ok: true, cloned: false }`,目录内容原样。
3. git 二进制缺失:报「克隆插件仓库失败:找不到 git…」,且不得出现 ReferenceError / not defined。
4. 远端不可达(假 git 退出 128):报错含「退出码 128」与 stderr 原文,且失败后 repoRoot 被清干净以便重试。

反向验证:把实现改回 `await mkdir` + `explainError`,后三条立刻变红(ReferenceError: explainError is not defined),改回修复后全绿。

## 全量测试说明

包全量 `node --test packages/dsh-inventory/test/*.test.mjs` 需要 node ≥22.15/23.8(zstd 测试);本机默认 node 是 v18.19.1,用 `/opt/dsh-runtime/node24/bin/node`(v24.15.0)跑。存量失败(与本次改动无关,在干净 HEAD 上同样红):`sync-issues-3-10.test.mjs` 的两条 #10 syncApply 技能安装用例断言 lastPullAt 被记录,实测 lastPullAt 为 0。

## 变更点

- 实现过程中发现 HEAD 已有一个简化版 `describeCloneFailure`(仅缺二进制/超时两分支,无人调用),本改动直接充实它而不是新增函数;首版曾插入第二个同名函数造成重复定义,已移除重复块。
- 开发基线注记:首次全量用系统默认 node v18.19.1 有 7 个文件级失败,均因 node 版本过低(zstd API 缺失),换 node24 后只剩上述 2 条存量红。
