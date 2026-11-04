# 更新路由的测试不再改真实仓库与 $DSH_HOME

- 分级:`standard`
- 关联:issue #60

## 1. 问题(实测)

`packages/dsh-inventory/test/host-route.test.mjs` 里的 route 测试**真的执行生产逻辑**:

- 调真实 apply handler → 对 `/root/DSH-plugins` 跑 `git fetch`;
- 走门禁并写**真实** `/root/.dsh/plugin-update/last.json`(实测 mtime 被改);
- 若 checkout 干净且落后,还会**真的 `git merge --ff-only`** 推进用户仓库。

后果:用户点完更新后,插件页的"上次结果"会被一次测试运行覆盖成假结论。本次排查中那条
`ahead-of-target` 就是这样来的,曾被误读为产品 bug。

## 2. 目标

测试不触碰真实 checkout 与真实 `$DSH_HOME`;apply 的核心可注入,能用临时 git 仓库验证
"拒绝不移动 HEAD""成功写对 last.json""probe 失败不移动"。

## 3. 边界

- 改:`packages/dsh-inventory/{index.js,lib/plugin-update.js,test/*,package.json}`、`CHANGELOG.md`
- 不改:宿主包、profile、其它 bundle
- 新增两个**生产可用**的覆盖点:`DSH_INVENTORY_UPDATE_REPO`(指定仓库)与已有的
  `DSH_HOME`(状态目录),都写进 README

## 4. 验收

1. 跑完 `packages/dsh-inventory` 全部测试后,真实 `$DSH_HOME/plugin-update/last.json`
   的 mtime **不变**(已实测:435 项测试,文件未动);
2. 新测试在临时仓库上断言:拒绝 → HEAD 不动 + last.json 记原因;成功 → HEAD 前移 +
   `changed` 正确 + `restart:{application}`;probe 失败 → HEAD 不动;
3. 反向验证:去掉仓库覆盖 → 测试红(实测 3 条红);
4. `pnpm verify` 全绿。

## 5. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | `performUpdate({repo, stateDir, respond, reconcile})` 抽出 apply 全流程 | 临时仓库上 5 个用例绿 |
| T2 | route handler 收薄成"命名真实仓库/状态目录/响应" | handler 内不再有 fetch/gate/probe 逻辑 |
| T3 | 删掉会真跑生产的 route 测试,换成方法守卫 + 端到端注入用例 | POST 路径仍有覆盖,且只作用于临时树 |
| T4 | `needsInstall` 只认依赖变化(不再对 version bump 跑 pnpm) | 版本 bump 的更新不再触发 install |
| T5 | 版本 0.7.0 → 0.7.1、CHANGELOG、README | `pnpm verify` 绿 |

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 覆盖点是新的生产入口,可能被滥用 | 只接受绝对路径,且仍校验 `packages/dsh-inventory/package.json` 的 name |
| 测试放宽后漏掉真实接线错误 | 保留一条端到端用例(setter 注入临时仓库 + 临时 DSH_HOME),断言 POST 真的推进了 checkout |
