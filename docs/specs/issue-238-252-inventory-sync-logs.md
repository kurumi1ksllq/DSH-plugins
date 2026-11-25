# issue #238 #251 #252 — 同步远端判定与 gate 挂载日志三修

分支 `issue-238-252-inventory-sync-logs`(基于 main),包 `dsh-inventory` 0.14.3 → 0.14.4(代码 + 测试 + 包内文档,不碰其它包)。

## 目标

- **#238 `missingFile` 被后续 404 覆盖**:`lib/sync-remote.js` 的 `missingFile` 是单个共享标志,每个传输都给它赋值 —— raw 非 404 置 `false`,随后 contents API 的 404 又置 `true`。注释承诺「每个传输都 404 才算没发布」,实现是「最后一个说话的赢」。改为每个传输各记各的(`notFoundRaw` / `notFoundApi`),两者都是 404 才判 `notFound`;5xx / 403 / 传输崩溃 / git 的鉴权与 ref 失败一律不算。
- **#251 两传输都 404 时丢弃真实失败原因**:missing 分支不再把 `attempts` 拼进 error,于是「凭据为空或过期」「ref 写错」「path 写错」「真的没发布」共用同一个 404 结论;上层 `fetchFleet` 折成空舰队(rows 0、counts 0),面板显示「尚未发布」,`syncApply` 安静地「无需安装」。改为 missing 分支保留 `attempts` 与真实报错,并让 git 的失败性质参与判定:clone 报鉴权错(且本次读取没带 token)时以「鉴权失败」报错,clone 报分支不存在时回到 ref 建议;服务层透传 `emptyReason`,`syncApply` 无清单时直接报原因。
- **#252 挂载超时仍写成功日志**:`gate.js` 的 `withTimeout` 超时后 `resolve(undefined)`,调用方随后照旧写 `mount agent=…` 成功行 —— 日志里既没有失败状态,又谎报一次成功。改为超时分支写 `status=timeout` 并抑制成功行,正常分支的成功行补 `status=ok`。

## 边界

- 只改 `packages/dsh-inventory`:`lib/sync-remote.js`、`lib/sync-service.js`、`gate.js`、`package.json`,测试 `test/sync-issues-238-251.test.mjs`(新增)与 `test/gate.test.mjs`;根 `CHANGELOG.md`、本 spec、`.flow/238.json`。
- `lib/workspace-gate.js:114/127`(`failOnStartupError: false`)是每个挂载共用的 config 归一化,**本轮不改**:超时的修法落在 `gate.js` 的超时分支,挂载策略(坏 server 不阻塞会话)不变。
- http 直连传输(`fetchHttpText` 的 404 = 空舰队)行为不变:它没有「多传输」问题,也不在 #251 的四因共用里。
- 「每个传输各判」只覆盖 raw / contents API 两个网络传输。git clone 不作为第三个「404 票」:它成功时读不到文件等价于文件不存在,已由网络传输覆盖;失败时只贡献否决(鉴权 / ref)。
- 带 token 时 clone 的鉴权失败**不**否决 404:git 从不带 token,若据此否决,私有仓库的新机器第一次发布(远端确实还没有清单)会读不到远端,反而挡住发布。
- 面板不新增渲染:鉴权失败走既有的 `lastFetchError` 横幅;`emptyReason` 只是 status payload 字段,本轮不画到 UI(已知遗留)。
- 不 push、不开 PR、不合并、不动宿主进程、不碰其它包。

## 验收

反向验证:去掉修复即红。新增/改写的断言:

- `#238` raw=500 + api=404 → `notFound` 不为真,error 含 `raw: HTTP 500`;raw=404 + api=403 → 同上,error 含 `api: HTTP 403`;raw=404 + api=404 → `notFound === true` 且 error 同时含 `raw: HTTP 404` / `api: HTTP 404`。
- `#251` token 空 + 全 404 + clone 报 `could not read Username` → `notFound` 不为真、error 含「鉴权」、不含「尚未发布」;`syncStatus` 同场景 `manifest === null`、无 `empty`、`fetchError` 含「鉴权」。
- `#251` clone 报 `Remote branch main not found` → 不判 `notFound`,error 含 `ref`。
- `#251` 真的没发布 → `status.empty === true`、`fetchError === undefined`、`emptyReason` 含「尚未发布」;`syncApply` 返回 `ok: false`、`results: []`、error 含「尚未发布」。
- `#252` 超时:`agent=gate-late` 的日志只有一行 `status=timeout`,没有 `status=ok`;正常挂载:`agent=gate-fast` 只有一行 `status=ok`,没有 `status=timeout`。

红(改实现前跑出来的关键行):

- `node --test test/sync-issues-238-251.test.mjs` → 7/8 失败:
  - `#238 raw 500 + contents 404 不算「没发布」`: `AssertionError: raw 的 5xx 不能被后来的 404 覆盖成「没发布」`(actual `true`)。
  - `#238 只有每个传输都 404 …`: `The input did not match /raw: HTTP 404/. Input: '清单尚未发布（文件不存在）'`。
  - `#251 凭据为空 + 全 404 + clone 报鉴权错`: `AssertionError: clone 说读不到凭据,就不能断定文件不存在`。
  - `#251 真的没发布时仍是空舰队`: actual `undefined`,expected `/尚未发布|文件不存在/`(`status.emptyReason`)。
  - `#251 token 为空 + 全 404 + clone 鉴权错`: `manifest` 是 `{ generatedAt: null, counts: { plugins: 0 … } }` 而不是 `null`。
  - `#251 syncApply 在远端没有清单时…`: `results` 里是 `状态是 local-only，不需要安装（本机有，清单没有）`。
- `node --test test/gate.test.mjs` → 2 失败:`the timeout must be reported once, with status=timeout`(0 !== 1)与 `a fast mount writes one success line`。

绿:

- `node --test test/sync-issues-238-251.test.mjs` 8/8;`node --test test/gate.test.mjs` 13/13。
- 包内全量 `cd packages/dsh-inventory && node --test test/*.test.mjs`:只剩两条预存红(`#10 syncApply` 的 `lastPullAt`,干净 main 上同样红,与本次改动无关)。
- 仓库根 `node --test test/docs-contract.test.mjs` 31/31。

## 变更点

| 文件 | 改动 |
| --- | --- |
| `lib/sync-remote.js` `fetchManifestText` | `missingFile` 拆成 `notFoundRaw` / `notFoundApi`(默认分支重试各记各的);新增 `authenticated`(本次读取是否带 token) |
| `lib/sync-remote.js` git 段 | 新增 `cloneVetoReason`(auth / ref / null):鉴权错(未带 token 时)以「鉴权失败」报错,ref 错不再判 missing |
| `lib/sync-remote.js` missing 分支 | error 改为 `清单尚未发布（文件不存在）：<attempts>`,保留每一次传输的状态码与真实报错 |
| `lib/sync-service.js` `fetchManifest` / `fetchFleet` | `gitBin` / `clone` 两个 seam 真正透传(以前传了不生效);`fetchFleet` 收 `options` 原样转给 `fetchManifest`;404 分支带回 `reason` |
| `lib/sync-service.js` `syncStatus` | 空舰队 payload 增加 `emptyReason` |
| `lib/sync-service.js` `syncApply` | `fetched.manifest === null` 时直接返回 `{ ok: false, error: reason, results: [] }`,不再逐项「清单里没有这一项」 |
| `gate.js` 挂载循环 | 超时分支置 `timedOut`、写 `status=timeout` 并跳过成功行;成功行补 `status=ok` |
| `test/sync-issues-238-251.test.mjs` | 新增 8 条公开行为用例(见「验收」) |
| `test/gate.test.mjs` | 超时用例补「只有 timeout 行」,正常用例补「只有成功行」 |
| `package.json`、根 `CHANGELOG.md` | 0.14.3 → 0.14.4;Unreleased 段顶新增一条;条目计数 87 → 88(84 已打 tag + 2 待打 + 2 仓库级) |
