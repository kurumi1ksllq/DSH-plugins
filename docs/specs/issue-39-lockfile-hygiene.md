# #39 第二部分:lockfile / 死链 / 加载树 / 假红

- 分级:`standard`
- 关联:issue #39(第一部分已在 #40 合并,`6ec6c14`)
- 本阶段**会**动:`pnpm-lock.yaml`、`.github/workflows/ci.yml`、`packages/dsh-git-status/*`、`scripts/check-profile.mjs`、`docs/update-scheme.md`
- 需要你点头的唯一一件仓库外操作:删 profile 里 `dsh-ctx-guard` 的死链(`/root/.dsh/profiles/web/node_modules/`,不重启 DSH)

## 1. 实测现状(每条都有命令)

| 事实 | 命令 / 证据 |
| --- | --- |
| 已提交的 lockfile importers = 6:含已删除的 `packages/dsh-ctx-guard`,缺 `dsh-credential-vault`、`dsh-git-status` | `git show HEAD:pnpm-lock.yaml \| grep '^  packages'` |
| `pnpm install --frozen-lockfile` **exit 0 但仍改写 lockfile**(CI 用的就是这条) | CI 日志 + 增量审查实测 |
| profile 里 `dsh-ctx-guard` 是死链(指向已删除目录) | `ls -la /root/.dsh/profiles/web/node_modules/dsh-ctx-guard` |
| `check:websearch` 的根是**脚本所在的 checkout**(`path.resolve(HERE,'..')`),不是 profile 实际加载的那棵树 | `packages/dsh-websearch-failover/scripts/build-plugin.mjs:22` |
| `remotesOf` 走 `git remote -v`,会读到 **insteadOf 改写后的 URL**:本机 `https://github.com/x` 显示成 `https://ghfast.top/https://github.com/x` | `/tmp` 复现:`git remote -v` 改写 vs `git config --get remote.origin.url` 原样 |

最后一条不只是测试问题:面板要靠 URL 解析 `owner/repo` 生成 GitHub 链接,被镜像前缀一改就解析不出来。

## 2. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 修 `pnpm-lock.yaml`:重生成 importers 与 `packages/` 一一对应(补两个真包、去掉 ctx-guard) | `node scripts/check-bundle-versions.mjs` 与契约绿;`pnpm install --frozen-lockfile` 不再改写 lockfile |
| T2 | CI 加 lockfile 守卫 | `pnpm install --frozen-lockfile` 之后 `git diff --exit-code pnpm-lock.yaml` 必须为 0(把「exit 0 却偷偷改写」变成红灯) |
| T3 | `remotesOf` 改读 `git config --get-regexp '^remote\..*\.url$'`(原样 URL,不吃 insteadOf) | 现有测试在**有**全局 insteadOf 的机器上也能绿;新增一条:即使 `url.*.insteadof` 存在,面板拿到的仍是原始 URL,且能解析出 `owner/repo` |
| T4 | `check-profile.mjs` 对**实际加载的** bundle 校验生成物新鲜度(把 `build-plugin --check` 的根换成 realpath),并报告 profile 里不在 `dependencies` 的死链 | 造「工作树新鲜 / 另一棵树陈旧」两个临时目录,断言只认 realpath 那棵;死链测试用临时 profile 目录 |
| T5 | 文档:lockfile 修好后 P1-6 三处必须改「已修」(契约强制),并把 T2 的守卫写进 update-scheme | `docs-contract` 绿(漂移解除后它会反过来要求「已修」) |
| T6 | 版本纪律:`dsh-git-status` 0.2.1 → 0.2.2 | `pnpm verify` 绿;合并后打 `dsh-git-status@0.2.2` |

## 3. 边界

- 不动 `packages/` 以外以外的插件代码,只改 `dsh-git-status` 的 remote 解析与其测试。
- 不重启 DSH;不改 profile 的 `package.json` / `bundles`(只删死链,若你批准)。
- `scripts/verify-clean.mjs` 暂不做:先把「干净验证」写成 `AGENTS.md` 的一行(多会话共用 checkout 时用临时 worktree + `HOME` 隔离),真做脚本等它被用第二次再说。

## 4. 风险

| 风险 | 缓解 |
| --- | --- |
| `pnpm install` 大改 lockfile | 先只 `--lockfile-only` 看 diff,确认只动 importers 再落 |
| 删 profile 死链被别的会话当成「插件丢失」 | 只在 `dependencies`/`bundles` 都不含它时删;删前后各跑一次 `check-profile.mjs` |
| `git config` 读法丢失 pushurl 信息 | 面板只需要 fetch URL;若将来要 pushurl 再加,不预先发明 |
