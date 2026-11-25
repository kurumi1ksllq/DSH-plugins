# issue-248:技能提醒先筛目录再切上限

**分级:trivial**(一行顺序问题 + 一条测试)

## 目标

`packages/dsh-skill-surface/lib/domains.mjs` 的 `shortlist()` 先按 curated 顺序 `slice(0, MAX_NAMES)`,`index.js:315` 才用目录里真实存在的名字过滤。ui 域 curated 第 4 个 `accessibility` 因此永远进不了候选:若这台机器只装了它,过滤后为空,这一轮连提醒都不出现(无日志、无降级)。

## 边界

- 只改 `lib/domains.mjs` 的 `shortlist` 签名(新增可选第三参 `available`)与 `index.js` 的调用点,外加测试。
- 不改域表内容、不改 `MAX_NAMES`、不改提醒文案与回声守卫。

## 验收

- 目录只有 `accessibility` 时仍产出提醒并点名它(改回「先切后筛」即红)。
- 目录齐全时一条提醒仍不超过 3 个名字(上限没被弄丢)。
- 本包 `node --test test/*.test.mjs` 115 过 / 1 跳过(既有跳过);`dev-flow` 等其它包不受影响。
- 版本 0.4.5 → 0.4.6。
