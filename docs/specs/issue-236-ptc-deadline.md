# issue-236:单次 run_code 时限与 ralph 分批续跑

**分级:trivial**(一个 bundle:一行 patch 覆盖 + 一段注入规则 + 一段 README + 一条契约测试)

## 目标

deep-PTC 下 `ralph` 被 600s 截断,截断后重新调用从第 1 轮重启。根因不是 ralph,是 `run_code` 单次程序的硬时限:

- 时限来自 `ptc-runtime` 行的配置(`timeoutMs` 默认 120s、`maxTimeoutMs` 上限 600s),该行由 `@deepseek-ai/dsh-base/cordis.patch.yml:407` 声明且**不带 config**,于是 loader 默认值生效。
- 前台阻塞的工具(ralph)整个循环跑在一次程序里,所以 600s 就是它的批长。
- `foregroundSeconds`(5–600)只设 shell executor 行(`lib/model.mjs:281`),与 `run_code` 无关。

## 边界

- **不修改、不包装、不替换** 官方 `dsh-tool-ralph`:那份 loop script 归上游维护,替它维护不可持续。
- 只改本 bundle 的 `cordis.patch.yml`(按行 id 覆盖 `ptc-runtime`)、`lib/rules.mjs`(注入规则)、`README.zh.md`/`README.md`,外加一条契约测试。
- 不改 `foregroundSeconds`、不改 executor 行、不改任何其它 bundle。

## 验收

- 组合后的 profile 里 `ptc-runtime` 行带 `timeoutMs: 600000` / `maxTimeoutMs: 1800000`(`dsh web --dump-config` 实看)。
- `test/ptc-deadline.test.mjs`:①patch 里该行存在、两个键都在、上限 > 600s、默认 ≤ 上限且 ≥ 600s;②注入规则提到 `run_code` 有硬时限、点名 ralph、要求分批与 `round-01.md` 形状,且**不复述**具体秒数。反向验证:把上限改回 600000 → 红(实测 `the ceiling must exceed the host default of 600s, got 600000`)。
- 本包 224/224 绿;仓库级 `test/docs-contract.test.mjs` 31/31;`scripts/verify-packages.mjs` ok。
- 版本 1.17.3 → 1.18.0(行为面:默认程序预算与上限都变,属 minor)。

## 变更点 / 取舍

1. **数字只写在一处**:patch 里给具体毫秒,注入规则与 README 只说「有硬时限、要分批」,避免提示词里的秒数与配置漂移(测试里也钉了「提示词不得复述上限」)。
2. **30 分钟而不是无上限**:实测最慢一轮 577s,30 分钟留了足够余量;但 20 轮 × 最慢仍是数小时,所以「分批 + 编号交接文件」不是装饰而是配合项,README 与注入规则都写了。
3. **未采用「包装 ralph 加 resume」**:那需要我们自己维护一份 loop script 并跟上游语义,与「不维护官方代码」的要求冲突。分批约定 + 放宽时限在不改官方代码的前提下解决了同一个痛点。
