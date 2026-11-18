# issue-224:凭据保险库「先查库再问人」——指针未生效 + 纪律链反向指引

**分级**:standard(2 个 ticket,2 个包,提示层行为契约)
**日期**:2026-11-18

## 背景(goal 指令 + 本会话实测取证)

用户目标:AI 在工作中要**自己去凭据保险库找凭据**,而不是向用户要 gh 登录。本会话实证的完整因果链:

1. **激活缺口(主因,非代码缺陷)**:#220(a9c7ef0,11-17 23:34 UTC)给保险库加了三行指针
   (`dsh-credential-vault:pointer`,"任何密钥先查库再问人"),但宿主进程 11-17 06:28 UTC 启动,
   **从未重启**——本会话持久化的 runtime-context 快照里 dispatcher/dev-flow 的 context 都在,
   唯独没有指针(时间线实锤)。指针要生效必须由用户重启 DSH(agent 无权操作宿主进程)。
2. **纪律链反向指引(仓库 bug,本 issue 修)**:dev-flow `FLOW.md` 前置自检明文
   "gh 未认证 → 输出命令让用户自己在终端执行"——整条纪律链(常驻契约/FLOW.md/委派纪律)零提及
   保险库。本会话的 lead 正是照这条把 gh auth login 交给用户的,而库里有 github token。
3. **可发现性(次要,本 issue 顺手加固)**:指针是 optional context;`minimal` 系 preset
   (includeRuntimeContext:false)下连指针都没有;deep-ptc compact SDK 下 `credential`
   (external)不在 SDK 段。指针未点名 CLI 交互式登录(gh/docker/ssh)这个高频场景。

保险库机制本身(list/search/use/env 注入)经本会话全程实测无 bug(PR #225 即经库内
github-rope-token + GH_TOKEN 注入开出);0.6.2 的 use/get note 精准化也被实测复证
(run_code 进程无注入变量、shell 工具调用的确注入)。

## 目标

- **Ticket A(dsh-credential-vault 0.6.3)**:指针 context 注册加 `required: true`
  (子代理/minimal 系组合也能看到);指针文案点名交互式 CLI 登录(gh auth login、docker login、
  ssh-add)——先查库,库里没有才把登录命令交给用户。
- **Ticket B(dev-flow 0.8.1)**:`FLOW.md` 前置自检的 gh 条款改为 vault-first:
  未认证先 `credential` search/use(给 GH_TOKEN 例子),库里没有才交给用户。
- 两处措辞用契约测试锁死(删即红)。

## 验收

- vault:新增契约测试断言指针文本含 gh auth login 场景与 DSH_CRED_ 用法、index.js 注册含
  required: true(源码级,删即红);既有 hint 测试全绿
- dev-flow:FLOW.md 前置自检含 vault-first 条款(契约测试,删即红);lintFlowDoc 仍通过
  (不引入禁用措辞)
- `pnpm test` + `pnpm verify` 全绿;CHANGELOG 两条目 + 计数注更新

## 变更点

1. **激活前提修正(实测)**:初版 spec 假设指针要用户重启 DSH 才生效。本会话实测推翻:
   本会话 runtime-context 快照在 hint.js 改完后即携带新指针文案(宿主对插件源码热加载,
   本会话指针在改代码后即时进入真实装配)。此前缺席的真实原因=宿主进程 11-17 06:28 UTC
   启动时加载的是 #220 之前的旧模块,并非注册机制失效。PR 措辞据此调整(指针随源码变更
   即时生效,无需重启)。
2. FLOW.md 条款的生效路径不变:模型按 dev-flow 流程读 FLOW.md 时看到 vault-first 条款。
4. **常驻契约同批修复(goal round 8 取证)**:dev-flow 的每轮常驻契约(lib/contract.mjs)硬规则段同样写着「环境前置(gh 认证)不满足时写明用户要执行的那一条命令」——本会话 lead 照办的直接触发源就是它,影响面比 FLOW.md 更大(每轮注入 vs 进流程才读)。一并改为 vault-first,lintContract 新增「凭据保险库」marker 锁死(删即红)。
3. **三通道统一(实现期补强)**:验收标准里还核对了同一套指引的另外两个载体——system prompt section 规则 1 与 `credential` 工具描述。二者原先只写「向用户要密钥先查库」,未点名交互式 CLI 登录;一并补齐,使指针/section/工具描述三通道口径一致,防止模型在任一通道上漏掉 CLI 场景。契约测试 6 条覆盖。
