# issue #238 #251 #252 — 同步远端判定与 gate 挂载日志三修

分支 `issue-238-252-inventory-sync-logs`(基于 main),包 `dsh-inventory` 0.14.3 → 0.14.4(代码 + 测试,不碰其它包)。PR #259。

## 目标

- **#238 `missingFile` 被后续 404 覆盖**:`lib/sync-remote.js` 的 `missingFile` 是单个共享标志,每个传输都给它赋值 —— raw 非 404 置 `false`,随后 contents API 的 404 又置 `true`。注释承诺「每个传输都 404 才算没发布」,实现是「最后一个说话的赢」。改为每个传输各记各的(`notFoundRaw` / `notFoundApi`),两者都是 404 才判 `notFound`;5xx / 403 / 传输崩溃 / git 的鉴权与 ref 失败一律不算。
- **#251 两传输都 404 时丢弃真实失败原因**:missing 分支不再把 `attempts` 拼进 error,于是「凭据为空或过期」「ref 写错」「path 写错」「真的没发布」共用同一个 404 结论;上层 `fetchFleet` 折成空舰队(rows 0、counts 0),面板显示「尚未发布」,`syncApply` 安静地「无需安装」。改为 missing 分支保留 `attempts` 与真实报错,并让 git 的失败性质参与判定:clone 报鉴权错(且本次读取没带 token)时以「鉴权失败」报错,clone 报分支不存在时回到 ref 建议;服务层透传 `emptyReason`,`syncApply` 无清单时直接报原因。
- **#252 挂载超时仍写成功日志**:`gate.js` 的 `withTimeout` 超时后 `resolve(undefined)`,调用方随后照旧写 `mount agent=…` 成功行 —— 日志里既没有失败状态,又谎报一次成功。改为超时分支写 `status=timeout` 并抑制成功行,正常分支的成功行补 `status=ok`。

## 边界

- 只改 `packages/dsh-inventory`:`lib/sync-remote.js`、`lib/sync-service.js`、`gate.js`、`package.json`,测试 `test/sync-issues-238-251.test.mjs`(新增)与 `test/gate.test.mjs`;根 `CHANGELOG.md`、本 spec、`.flow/238.json`。
- `lib/workspace-gate.js:114/127`(`failOnStartupError: false`)是每个挂载共用的 config 归一化,**本轮不改**:超时的修法落在 `gate.js` 的超时分支,挂载策略(坏 server 不阻塞会话)不变。
- http 直连传输(`fetchHttpText` 的 404 = 空舰队)行为不变:它没有「多传输」问题,也不在 #251 的四因共用里。
- 「每个传输各判」只覆盖 raw / contents API 两个网络传输。git clone 不作为第三个「404 票」:它成功时读不到文件等价于文件不存在,已由网络传输覆盖;失败时只贡献否决(鉴权 / ref)。
- **带 token 时 clone 的鉴权失败是否否决 404,由「用同一个 token 探仓库」的结论决定**(`repoAccess`):探得到(`ok`)才把双 404 当「没发布」,探不到(`denied`)则报鉴权失败。上一版只按「本次有没有 token」判,过期 token 因此仍会被说成「尚未发布」——review 指出的正是这条。
- 面板不新增渲染:鉴权失败走既有的 `lastFetchError` 横幅;`emptyReason` 只是 status payload 字段,本轮不画到 UI(已知遗留)。
- 不合并、不动宿主进程、不碰其它包。

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

## 双轴 review 裁决(两轴共回报 11 条,全部处理)

**必修(均已修)**

1. **token 非空但过期/无权限仍判「尚未发布」**(轴2 #1、轴1 #1,高,含数据安全面):`authenticated === false` 只挡住「没带 token」。GitHub 对私有仓 + 过期 token 在 raw 与 contents API 上都回 404,于是双 404 → 空底座 → 发布只写本机分节。→ 用**同一函数里已有的仓库探测**(`repoApiUrl`,`learnDefaultBranch`)做三态 `repoAccess`(ok/denied/unknown):`denied` 时按鉴权失败报;`ok` 才允许双 404 当「没发布」。
2. **发布路径没有空底座确认**(两轴都提,`#238`/`#251` 原文的修复建议也写了):`syncPublish` 现在要求 `repoAccess === 'ok'` 才把空远端当首次发布,否则拒绝写入并说明原因——这是「挡住以空底座覆盖他人分节」的那道闸,不再依赖 GitHub PUT 缺 sha 回 422 的协议巧合。
3. **`cloneVetoReason` 把本地 `EACCES` 当凭据错**(两轴都提):正则里删掉 `Permission denied` / `access denied`,并先排除 `EACCES|EPERM|ENOENT`——临时目录建不出来时不该让用户去翻 token。
4. **`#252` 的第三、第四种结局没闭合**(轴2 #4、轴1 #3):`fiber === undefined` 写 `status=nofiber`(不再写 `status=ok`),`mount failed` 补 `status=error`。
5. **空舰队结论不清旧横幅**(轴1 #2):`syncStatus` 的 empty 分支与成功分支一样 `writeState({ lastFetchError: '' })`,否则「鉴权失败 → 修好 token → 确实还没发布」会一边说没内容一边挂红字。

**测试/留证**

6. `raw 404 + api 403` 那条在旧实现上本来就是绿的(不构成回归护栏)→ 改成 `raw 404 + api 500`,并新增 4 条:过期 token + 双 404 + clone 鉴权错 → 鉴权失败;默认分支重试 500 → 不算 missing;`EACCES` 不算鉴权失败;发布被空底座确认挡住。
7. 新测试全部补 `timeoutMs: 100`(默认 15s 让这个文件每条用例多挂 15 秒)。
8. `.flow` 三张卡按实况推进:`238.json` 只留本 issue 的 ticket(原来混进了 #251/#252 的),并补 `251.json` / `252.json`;`ci.status` 按实况写 `green`。
9. 本 spec 的边界与变更点已按实况重写(此前写着「不 push、不开 PR」,且漏列 `.flow/251.json`、`.flow/252.json`)。

**记录为已知遗留/裁剪**

10. 面板仍不渲染 `emptyReason`(只进 status payload);鉴权失败走既有的 `lastFetchError` 横幅。
11. gitee 模式下 token 在 URL 里,`attempts` 会进 `emptyReason` 与持久化的 `lastFetchError`;Node undici 的 rejection message 不含 URL,其它运行环境未验证(review 提出,本轮不改)。
