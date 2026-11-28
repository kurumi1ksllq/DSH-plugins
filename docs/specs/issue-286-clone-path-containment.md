# issue-286 分级:standard

## 问题

`packages/dsh-inventory/lib/sync-remote.js` 的 `fetchViaClone` 用 `readFileSync(join(dir, path))` 读清单。
`path` 来自用户配置(同步设置的 path、仓库地址的 `/tree/<ref>/<path>` 后缀),从未约束在克隆根内:

- `../../etc/passwd`、`/etc/passwd` 这类相对/绝对路径直接读到克隆目录之外的文件;
- 克隆内容里指向外部的符号链接同理 —— 字面看是普通相对路径,解析后才越界。

原始 issue #265,本轮跟踪为 #286。

## 修法

`lib/sync-remote.js` 新增 `clonePath(dir, rel)`,读文件前用它把 path 解析成真实路径:

1. `realpathSync(dir)` 拿克隆根的真实路径;
2. `resolve(root, rel)` 判**字面**是否越界(相对上跳、绝对路径都靠这一步挡);
3. `realpathSync(abs)` 判**软链解析后**的真实路径是否仍在根内(根内软链指向根外靠这一步挡);
4. 越界抛带 `unsafePath = true` 的错误,两种原因分别写明「越出克隆根」「经符号链接指向克隆根之外」。

`fetchViaClone` 把 `unsafePath` 透传进返回值;`fetchManifestText` 在 `git` 这一跳之后**立刻**返回
`{ error: '无法读取清单：…' }` —— 不重试别的 ref、不降级到别的传输,也不让这个错误被
`notFoundRaw && notFoundApi` 分支说成「清单尚未发布」。

文件不存在仍是原来的 ENOENT 路径(交给 `readFileSync` 报错),行为不变。

## 验收

`packages/dsh-inventory/test/sync-issue-286.test.mjs`,全部通过公开入口 `fetchManifestText` + 注入的
`clone` seam(假 clone 按真 clone 的约定从参数末位拿目录,在里面造文件/软链):

| 用例 | 断言 |
| --- | --- |
| `../x` | 拒绝,error 含「越出克隆根」且点名 `../x` |
| `../../etc/passwd` | 拒绝,error 含「越出克隆根」 |
| `/etc/passwd` | 拒绝,error 含「越出克隆根」 |
| 克隆内指向根外的软链 | 拒绝,error 含「符号链接」「克隆根之外」 |
| `dsh-manifest.json` | `via: 'git'`,内容原样可读 |
| `sub/dsh-manifest.json` | 同上(只挡越界,不挡子路径) |

四条拒绝用例同时断言 `text === undefined` 且 `notFound !== true`。

红→绿证据:实现前 4 红 2 绿(实际读出了 `/etc/passwd` 与软链指向的 `SECRET`),实现后 6/6 绿。

## 变更点

- `packages/dsh-inventory/lib/sync-remote.js`:新增 `clonePath` / `unsafePathError`;读清单改走 `clonePath`;
  `fetchViaClone` 返回值加 `unsafePath`;`fetchManifestText` 对越界立刻报错返回。
- `packages/dsh-inventory/test/sync-issue-286.test.mjs`:新增(6 条)。
- `packages/dsh-inventory/package.json`:0.14.4 → 0.14.5。
- `CHANGELOG.md`:补 0.14.5 条目。

## 已知无关红

`test/sync-issues-3-10.test.mjs` 的 2 条 `#10 syncApply` 用例在本机失败(宿主已有
`/root/.agents/skills/ui-design` 非目录,技能链接失败)。用 `git checkout` 还原 `sync-remote.js` 到 main
基线后同样 2 红,与本改动无关;全量 558 条中 556 绿、2 红即这两条。
