# dsh-skill-surface

给"没有 skill 能力"的 agent 补上**发现与加载**通路——但**绝不**碰已经有 skill 工具的 agent。

## 为什么需要它

`dsh-web-app` 在宿主层把 `dsh-skill-filesystem` 与 `dsh-tool-skill` 两行 `disabled: true`，改由每个 agent preset 自带。于是**没挂这两行的 preset 就完全没有技能**：没有目录，也没有加载工具。本部署实测：组合树里 9 个 preset 行，只有 `standard`/`ptc`/`cordis` 挂了 skill 行；`minimal` 与委派路由表点名的全部 5 个（`planner`/`architect`/`code-reviewer`/`security-reviewer`/`build-error-resolver`）都是 persona-only。

## 做了什么

1. **只补发现**：以新 row id + 独立 `providerName`（`skill-surface-filesystem`）把**官方** filesystem provider 挂进 global 层。读取时 global 层与视野链合并、近层同名胜出，所以已有 provider 的 preset 行为不变。
2. **只给没有 loader 的 agent 补加载**：`skill_get` 工具（不带参数 = 列目录，带名字 = 取正文），配一段 `systemPrompt.context` 提示。
   这两样**硬判** `ctx.tools.get('skill', agent) === undefined`——该 agent 已经有官方 `skill` 时，提示与 `skill_get` 都不出现。
3. **领域点名（0.2.0）**：每轮开工时看用户这句话（含委派转来的 relay 消息），命中领域就注入一行，点名 1–3 个**当前目录真实存在**的技能。
   这条**对所有 agent 生效**，包括本来就有 `skill` 的——因为真问题不是看不到，而是不去查。同领域至少一个强信号或两个弱信号才触发，每轮最多一次，本会话已加载过该领域技能则不发。

## 一条硬规则（#159 事故）

**永远不要在宿主平面挂第二个 `tool-skill`。**

官方目录发布器在被近层遮蔽时**不会沉默**，而是发布一条 `{skills: [], complete: true}` 的空目录并宣称"替换掉此前所有清单"（`dsh-tool-skill/lib/index.js:935-941`）。#159 正是这样把 standard/ptc 会话的 270 条目录清空成 0 条。

因此本包：
- 不挂 `tool-skill`；
- 不发布任何 `skill-catalog` 消息（提示走 `systemPrompt.context`，不存在"替换"语义）；
- 加载器名字叫 `skill_get`，不与官方 `skill` 冲突。

`test/bundle.test.mjs` 里有一条回归断言守着这条规则。

## 测试

```bash
node --test test/*.test.mjs
```

## 复核(可复现)

```bash
# 组合树里有多少 preset 行、其中几行挂了 skill 能力
dsh --profile web --dump-config | grep -nE '^ *- id: preset-'
dsh --profile web --dump-config | grep -c 'id: skill-filesystem'
```

注意:profile 的 `cordis.patch.yml` 里只有 5 个 preset 行(委派路由表点名的那 5 个),完整 9 个要
看**组合后的树**,不要只看 profile 文件。

## 上游引用

本文与源码注释里的 `dsh-tool-skill/lib/index.js:935-941` 指**上游 0.2.2-rc.1** 的"被遮蔽即发布空目录"分支。上游升级后行号会漂；`test/bundle.test.mjs` 守的是本包 patch 的形态,不钉上游行号,核对时以函数行为为准。
