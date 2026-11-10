# dsh-skill-surface

给"没有 skill 能力"的 agent 补上技能清单与加载器,并让派活时能点名技能。

## 为什么需要它

`dsh-web-app` 在宿主层把 `dsh-skill-filesystem` 与 `dsh-tool-skill` 两行 `disabled: true`,改由每个 agent preset 自带。于是**没有挂这两行的 preset 就完全没有技能**:没有目录,也没有 `skill` 工具。

本部署实测(2026-11-10):组合后的树里有 9 个 preset 行,其中只有 3 个(`standard`/`ptc`/`cordis`)的 `plugins` 列表里含 `skill-filesystem` 与 `tool-skill`;`minimal` 与委派路由表点名的全部 5 个(`planner`/`architect`/`code-reviewer`/`security-reviewer`/`build-error-resolver`)都是 persona-only。复核命令:`dsh --profile web --dump-config`(看 `- id: preset-*` 与其内层 `plugins`,不是看 profile 的 `cordis.patch.yml`,那里只有 5 个 preset 行)。

## 做了什么

1. **补器官**(零代码):以新的 row id 把**官方** `dsh-skill-filesystem` 与 `dsh-tool-skill` 挂进 global 层。读取时 global 层与视野链合并、近层同名胜出,所以已有 skill 行的 preset 行为不变,没挂的 preset 得到兜底。
2. **派活点名**:主 agent 在任务首行写 `skills: a, b`,接收方在 `agent/pre-step` 得到对应的官方 `<skill_content>` 注入。

不做:不改上游 SKILL.md;不 fork 官方加载器;不实现自己的 provider;不做检索层(实测 BM25 排序会给出错误答案)。

## 配置

`tool-skill-global` 的 `catalogDescriptionMaxLength` 默认取 200(本部署实测:269 条在 500/200/120 下分别渲染 83,257 / 59,745 / 40,976 字符)。改这行即可调整每个 agent 开工时携带的清单体积。

## 测试

```bash
node --test test/*.test.mjs
```
