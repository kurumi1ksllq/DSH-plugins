# issue #199 — Git 面板查不到 GitHub 数据(缺 --repo)+ 已合并窗口过小

- 分级:**standard**(改动 3 个源文件 + 新增测试 + 文档/版本,跨 gh/snapshot 两个模块)
- 分支:`issue-199-git-panel-gh-repo`
- issue:https://github.com/kurumi1ksllq/DSH-plugins/issues/199

## 目标

右侧栏 Git 任务板在**镜像配置的机器**上必须显示真实的云端状态:已合并的 issue 进 `done` 列,真正在开的才留在前面几列;不得因为查不到 forge 数据而拿本地残留分支冒充"开发中"。

## 复现(已实测,main @ ce26b63)

本机 `~/.gitconfig`:

```
url.https://ghfast.top/https://github.com/.insteadOf https://github.com/
```

```
$ gh pr list --state open
none of the git remotes configured for this repository point to a known GitHub host.
$ gh pr list -R kurumi1ksllq/DSH-plugins --state open --json number
[{"number":198}]                       # 指名仓库就正常
```

`getSnapshot()` 的结果:`issues: null`、`mergedPrs: null`、dev 列 23 张卡(全部来自本地 `issue-*` 分支)、pr 列 1 张、done 列 0 张。

## 根因

1. **gh 靠读 remote 认仓库,remote 被镜像改写**。`lib-git-status/gh.js` 的 `openIssues` / `openPullRequests` / `recentlyMergedPullRequests` / `prChecks` 都没带 `--repo`。而 `remotesOf()` 读的是 `git config --local`(不被 `insteadOf` 改写),所以 `repoSlug` 一直解析正确 —— 只是没被用于指定查询目标。
2. **已合并 PR 只查最近 20 条**。本仓库有 86 条已合并 PR;`issue-145-*` 的合并(PR #193)落在窗口外,拿不到合并证据。

## 变更点

### 1 `packages/dev-flow/lib-git-status/gh.js`

- 新增导出 `repoArgs(slug)`:slug 有效时返回 `['--repo', slug]`,否则空数组(保持"没有 remote 的仓库照常降级"的既有行为)。
- `openPullRequests` / `recentlyMergedPullRequests` / `openIssues` / `prChecks` 各加一个 `slug` 形参并把它拼进 argv。
- 新增导出常量 `MERGED_PR_LIMIT = 200`,替换写死的 `'20'`,附理由注释。

### 2 `packages/dev-flow/lib-git-status/snapshot.js`

- `repoSlug` 的计算从 forge 查询**之后**提前到之前,并把 slug 透传给三个查询与 `checksOf`。

### 3 `packages/dev-flow/test/gh-repo-arg.test.mjs`(新增)

假 `gh` 桩:缺 `--repo me/repo` 时输出真 gh 的那句报错并 `exit 4`,`--version` / `auth status` 无条件成功(它们是宿主事实,不是仓库查询)。

五个用例:
1. `openIssues` 带 slug 能拿到数据;
2. `openIssues` 不带 slug 被桩拒绝(证明这条测试会红);
3. `openPullRequests` + `prChecks` 也带 slug;
4. `recentlyMergedPullRequests` 传的是 `MERGED_PR_LIMIT` 且 > 20(读桩记录的 argv 断言);
5. `getSnapshot` 端到端把 slug 透传到每个查询,issue 能走到任务板。

### 4 文档与版本

- `packages/dev-flow/README-git-status.md`:补一条"查询显式指名仓库"的说明。
- `packages/dev-flow/CHANGELOG.md` + 仓库 `CHANGELOG.md`:记录本次修复。
- `packages/dev-flow/package.json`:0.7.0 → 0.7.1。

## 验收

- [ ] 新测试在**未修改**的实现上全红(反向验证)
- [ ] 改完后 dev-flow 全量测试通过
- [ ] `pnpm verify` 通过
- [ ] 真实仓库实测:`issues` 非 null、`mergedPrs` 86 条、dev 列不再出现已合并任务、done 列收录它们

## 裁剪

无。trivial 条件(≤1 文件 / ≤30 行)不满足,不裁剪任何阶段。

## 变更记录

### 变更 1(轴 A review 后,2026-11-13)

轴 A 报 3 条 P1,全部复现属实,已全部修复并补测试:

1. **P1 端口被当成 owner**:`slugFromRemoteUrl('https://github.com:443/me/repo.git')` 返回 `443/me/repo`。修复前这只会弄坏一条深链,但 slug 现在要指名每个 gh 查询的目标,错误 slug 会让 gh 去查一个不存在的仓库并失败——比不传 slug 更糟。已让两处正则接受并消费 `(?::\d+)?`,并给 `repoArgs` 加最后一道闸:只放行恰好 `owner/repo` 形状。
2. **P1 门禁与 slug 用两套 remote 选择规则**:`forgeHintFor` 接受**任意** remote 命中 GitHub,而 `repoSlug` 只读 `origin ?? remotes[0]`。origin 是 GitLab、upstream 是 GitHub 的仓库会「门禁放行 + slug 为 null」,等于没修。已抽出唯一出口 `forgeRemoteOf(remotes)`,门禁与 slug 都由它派生。
3. **P1 强制用 origin 会覆盖 gh 自己的选择**:实测 gh 2.62.0 在存在名为 `upstream` 的 remote 时优先选它(fork clone 的惯例——PR/issue 在上游)。强制 origin 会把 fork clone 的查询指向自己那个空 fork,重现「已完成显示成在做」的症状。`forgeRemoteOf` 现按 `upstream → origin → 任意可解析` 排序。

同时采纳两条 P2:

- 修正 `MERGED_PR_LIMIT` 注释:`gh pr list` 按 **createdAt** 倒序,不是 mergedAt(已实测),所以窗口漏掉的是「创建得早」的 PR;抬数字只是收窄窗口,不是关闭缺陷。
- 测试从断言 `--limit > 20` 改为断言等于导出的 `MERGED_PR_LIMIT`,否则把窗口悄悄改成 25 仍会全绿。

**未采纳(记录理由)**:轴 A 建议对未匹配到合并证据的分支做有界补查(`--state merged --head <branch> --limit 1`)。方向正确且实测可行,但它把「一次查询」变成「每分支一次」,属于独立的行为改动(涉及并发池与超时预算),不在本次修复范围内。已在本 spec 的「后续」记录。

## 后续(不在本 PR 范围)

- 对「仍缺合并证据的本地 `issue-*` 分支」做有界补查,替代抬高 `MERGED_PR_LIMIT` 这种做法——后者在合并数超过窗口的仓库会原样复发。
- 更根本的方向:在 `runCommand` 层一次注入 `GH_REPO` 环境变量(已实测 gh 支持),让将来新增的查询自动继承,而不是每处记得拼 `--repo`。需要给 `run.js` 加可选 `env` 透传。
