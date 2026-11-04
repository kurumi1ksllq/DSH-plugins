# issue-43-clean-verify:收口 #43 第 3 项「干净验证路径」(并关闭 #39)

- 分级:`standard`
- 关联 issue:#43(本 spec)、#39(收尾关闭)
- 基准:main @ d26145a,2026-11-05

## 现状盘点(2026-11-05 实测)

| 条目 | 状态 | 证据 |
| --- | --- | --- |
| #39-1 lockfile importers 漂移 | ✅ 已修 | PR #42;CI `git diff --exit-code -- pnpm-lock.yaml`;`grep '^  packages' pnpm-lock.yaml` 7 个 importer 与 packages/ 一致 |
| #39-2 profile dsh-ctx-guard 死链 | ✅ 已清 | `/root/.dsh/profiles/web/node_modules` 无 dsh-ctx-guard;`check-profile.mjs` 0 告警;孤儿/死链由 PR #44 兜底 |
| #39-4 dsh-git-status 假红 | ✅ 已修 | PR #42 `remotesOf`;`review-p1.test.mjs:95` 有 insteadOf 免疫用例 |
| #39-5 `.flow/37.json` | ✅ 已补 | `stage: done / merge.authorized: true` |
| #39-6 SKILL.md review 模板 | ✅ 已补 | PR #40,`固定模板(原文照抄…)` 在 SKILL.md:72 |
| #39-7.1~7.8 补审八条 | ✅ 已落 | PR #40:`docs-contract.test.mjs` 钉 P1-6/校准块 sha/全角冒号/安装片段并集/P1-10 证据 |
| #43-1 check-profile 认 realpath 那棵树 | ✅ 已落 | PR #44 重写;`test/check-profile.test.mjs`:异 checkout 记 warn 绝不报 ok、同 checkout 错包 FAIL、死链 FAIL |
| #43-2 死链清理 | ✅ 已清 | 同 #39-2 |
| **#43-3 干净验证路径** | ❌ **未做** | 无 `verify-clean` 类脚本;`AGENTS.md` 无对应章节 |

## 目标

提供一条可复现的「干净验证」路径:多会话共用同一 checkout 时,`pnpm test` / `pnpm verify` 不再因**别人未提交的改动**或**宿主 git 全局配置**假红。用法写进 `AGENTS.md` 的「完工验收四件套」下,并用契约测试钉住(反向可红)。

## 边界

**做**

- 新增 `scripts/verify-clean.mjs`:
  - `git worktree add`(临时目录,基于 HEAD)→ 在 worktree 里以隔离环境跑 gate;
  - 隔离:`HOME=<tmp>/home`、`GIT_CONFIG_GLOBAL=<tmp>/gitconfig`(空文件)、`GIT_CONFIG_NOSYSTEM=1`;
  - gate 默认 = `pnpm install --frozen-lockfile`(worktree 无 node_modules,顺带复验 lockfile)→ `pnpm verify` → `pnpm test`;
  - `-- <command...>` 透传自定义 gate(测试用快命令冒烟,不跑全量);
  - 结束后清理 worktree 与临时 HOME;worktree 注册失败/中途退出都不得留下脏注册。
- `AGENTS.md`「完工验收四件套」下补「多会话共用 checkout 时:用 `node scripts/verify-clean.mjs`」用法段。
- `test/docs-contract.test.mjs` 增契约:AGENTS.md 必须出现 verify-clean 用法(删段即红)。
- 关闭 #39:附总结评论(逐条指向落地 PR);#43 在本 PR merge 后关闭。

**不做**

- 不动 `/root/dsh-workspace/DSH-plugins`(旧 checkout 退役另议)。
- 不改 `check-profile.mjs` / `build-plugin.mjs` 行为(#43-1 已由 PR #44 落地)。
- 不做任何 profile 目录操作(#43-2 已完成)。

## 验收

1. `node scripts/verify-clean.mjs` 在本机(宿主有 `insteadOf`、工作树有未提交改动)跑通且退出 0;
2. 透传冒烟证明隔离生效:worktree 内 `HOME` 指向临时目录、`git config --global --get-regexp insteadof` 为空、宿主未提交改动不影响结果;
3. `AGENTS.md` 含 verify-clean 用法;契约测试在删除该段时变红(反向验证);
4. 全量 `pnpm test` + `pnpm verify` 全绿。

## tickets

1. **红**:契约测试(AGENTS.md 缺 verify-clean 用法)+ `verify-clean.mjs` 冒烟用例(隔离生效/清理干净)→ 确认红对原因。
2. **绿**:实现 `scripts/verify-clean.mjs`;补 AGENTS.md 用法段 → 契约转绿。
3. 全量 gate(`pnpm test` + `pnpm verify`)→ 声明 push → PR(`Closes #43`,正文带 #39 收尾说明)→ CI → 双轴 review → 等 merge 口令;merge 后关闭 #39、#43。
