# #43 profile 死链:让 check-profile 自己兜住

- 分级:`standard`
- 关联:issue #43(由 #39 的 T4 移交而来,见 `docs/specs/issue-39-lockfile-hygiene.md`)
- 本阶段**会**动:`scripts/check-profile.mjs`、新增 `test/check-profile.test.mjs`、`docs/update-scheme.md`(P1-4/P1-5 复核段一行)
- 本阶段**不做**:realpath 生成物新鲜度校验、`scripts/verify-clean.mjs` 干净验证路径(原 T4 的后半)—— 仍留在 #43;PR 用 `Part of #43`,**不关 issue**
- 仓库外动作(需你点头):删 profile 里的 `dsh-ctx-guard` 死链、重算 profile 的 `pnpm-lock.yaml`;**不重启 DSH**

## 1. 实测现状(每条都有命令)

| 事实 | 命令 / 证据 |
| --- | --- |
| profile 里有一条孤儿死链 | `ls -ld /root/.dsh/profiles/web/node_modules/dsh-ctx-guard` → 符号链接指向 `../../../../DSH-plugins/packages/dsh-ctx-guard`,该目标不存在(`test -e` 失败) |
| profile 的 manifest 已不认它 | `grep -c dsh-ctx-guard /root/.dsh/profiles/web/package.json` → `0` |
| profile 的 lockfile 还认它 | `grep -c dsh-ctx-guard /root/.dsh/profiles/web/pnpm-lock.yaml` → `3`(下次 `--frozen-lockfile` 会炸) |
| 而检查脚本报全绿 | `node scripts/check-profile.mjs --profile web` → `profile ok: 5 linked bundle(s)`,exit 0 |
| 根因 | `scripts/check-profile.mjs:163-165`:只遍历 `SHIPPED` 里的名字,`deps[name]` 不是字符串就 `continue`;`node_modules` 里没有对应声明的条目**从不被看见** |

结论:P1-4/P1-5 想防的「接线腐化只有 boot 时才暴露」,对**孤儿条目**这一类仍然不设防。

## 2. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 红:新增 `test/check-profile.test.mjs`,在**临时 profile 目录**里造三条接线 —— ①悬空 link ②目标存在但未声明的 stray link ③干净 profile | 先跑见红(现状对 ① 也 exit 0);红线指向"未声明条目没被检查",不是语法错 |
| T2 | 绿:`nodeModulesLinks()` 扫 profile 的 `node_modules` 顶层非点开头项与 `@scope/*` 的符号链接 —— 悬空 → `fail`(计入 exit 1);存在但未声明 → `warn` | T1 三条断言全绿;`--json` 输出里能按名字定位到问题条目 |
| T3 | 清现场(仓库外,需点头):删 `/root/.dsh/profiles/web/node_modules/dsh-ctx-guard`;重算 profile `pnpm-lock.yaml` 去掉 3 处残留 | `node scripts/check-profile.mjs --profile web` exit 0 且输出不再出现 `dsh-ctx-guard`;profile `grep -c dsh-ctx-guard pnpm-lock.yaml` → `0` |
| T4 | 文档:`docs/update-scheme.md` 的 P1-4/P1-5 复核段补一句「孤儿/死链由 `check-profile` 兜住」 | `docs-contract` 绿;断言句可被 T2 的行为验证 |
| T5 | 收尾:`pnpm test` + `pnpm verify` 全绿;不碰 `packages/`,故无版本号变更 | `pnpm gate` 绿 |

## 3. 边界

- 只改仓库根级的 `scripts/` 与 `test/`,**不动 `packages/`**。
- `check-profile.mjs` 保持**只读**,仍不写盘;新逻辑只增加输出与退出码。
- 扫 `node_modules` 时跳过点开头的条目(`.bin`、`.pnpm`、`.modules.yaml`),不递归进 `@scope` 以外的目录。
- registry 插件的正常链接(非符号链接)不参与判定,避免把 pnpm 自己的布局当问题。
- 不重启 DSH;profile 的 `package.json` / `bundles` **本阶段不动**(装 `dev-flow-skill` 是下一个 issue 的事)。

## 4. 风险

| 风险 | 缓解 |
| --- | --- |
| 死链检测把别人的问题报成自己的红 | 输出点名完整路径与目标,`--json` 给结构化条目;真需要豁免时按名字写进脚本内的显式白名单,不靠正则猜 |
| 重算 profile 的 lockfile 需要联网 | 先试 `pnpm install --lockfile-only`;失败/超时则**停下来报告**,不手改 lockfile |
| 删死链被误伤成删真目录 | 删除前 `test -L` 且 `test ! -e` 双确认,只 `rm` 链接本身,不加 `-r` |

## 5. 验收

- `node scripts/check-profile.mjs --profile web` → exit 0,输出无 `dsh-ctx-guard`。
- `pnpm test`(含新 `test/check-profile.test.mjs`)与 `pnpm verify` 全绿。
- 反向验证:把 T2 的实现退回"只查声明依赖",新测试必须变红。

## 6. 双轴 review 的裁决(2026-11-04,用户批 A:全修)

review 报 6 条,全部采纳,均在同分支追加修复(未另开票):

| # | review 发现 | 处理 |
| --- | --- | --- |
| P1 | 点目录守卫是死代码(`readDirNames` 走 `ls -1`,默认不列点条目),对应测试无法反向验证 | 扫描器改用 `readdirSync`,守卫成为真代码;新增 2 条点条目用例。变异测试:删守卫 → 3 条红 |
| P2 | 汇总行口径改为只数 `ok`,而提交信息称「含义不变」不实 | 保留新口径(跨 checkout 的 bundle 不算「我们装的」),补一条钉住它的用例:`profile ok: 0` + `1 warning(s)` |
| P3 | stray warn 复用了「loads from another checkout」结语 | warn 行加 `reason`(`cross-checkout` / `stray` / `inventory-sections`),结语只统计 `cross-checkout`;补用例 |
| P4 | 声明了但不在 `SHIPPED` 的活链接静默消失 | 改为输出一行 `ok`(`declared, live link`);补用例 |
| P5 | spec 里的函数名与行号与实现不符 | 本文件已按实现校正为 `nodeModulesLinks()` / `:163-165` |
| P6 | `.flow/43.json` 与 CI 实况脱节 | 已按节点更新,随修复一并提交 |

**用户裁决(2026-11-04)**:profile 里与本仓库无关的**悬空**链接也一律 `fail`,**不设白名单**——悬空就是坏接线,不该靠仓库白名单豁免。
