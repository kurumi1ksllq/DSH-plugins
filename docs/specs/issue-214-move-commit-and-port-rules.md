# issue 214 — 补回瘦身全局文件时误删的两条规则

grade: standard

## 问题(自查发现)

#211 把提示词搬进插件后,我按「只删重复、保留本机专属」瘦身了 `~/.dsh/AGENTS.md`(4921 → 1579 字节)。

瘦身后逐条 grep 自查,发现**两条被误删**:它们原本只存在于全局文件,任何插件都没覆盖。

| 原全局条款 | 删前覆盖 |
|---|---|
| 禁止 `git push --no-verify`;禁止跳过任何 git hook | **无任何插件** |
| 启动 dev-server 前先确认端口未被占用;长驻进程须后台化并落盘 PID | **无任何插件** |

实测确认:dispatcher 注入文本、仓库 `AGENTS.md`、deep-ptc 纪律段 **三者都没有**这两条。

即:这恰好是 #211 要消灭的缺陷类型(规则只活在全局 → 换台机器就没了),只是这次是我自己制造的。
**教训**:瘦身全局文件时,不能只看「插件里有没有相似段落」,必须逐条 grep 具体条款。

## 目标

1. 两条搬进 `dsh-task-dispatcher` 注入段(zh/en 同构),由插件自带。
2. 加进 `test/owned-clauses.test.mjs`,删掉即红。
3. 全局文件保持精简。

## 边界

- 只动 dispatcher 注入文本与契约测试;不改 133 行 preset、不改运行时。
- 「规则库 bootstrap」不搬进插件(本机约定)。

## 验收

| # | 判据 | 证据 |
|---|---|---|
| A1 | 注入文本含 `no-verify` 与 `dev-server`(zh/en) | `test/owned-clauses.test.mjs` |
| A2 | 删掉这两条 → 契约红 | 反向验证 |
| A3 | 隔离 HOME 全绿 | `env HOME=/tmp/fh node --test test/*.test.mjs` |

## 实测

- 改前:两条在三处均 MISS。
- 改后:zh/en 均含;dispatcher 89 条测试全绿;隔离 HOME 下 89/89。
- 反向验证:删掉这两条 bullet → 契约 2 条红;还原后全绿。

## 变更

无。
