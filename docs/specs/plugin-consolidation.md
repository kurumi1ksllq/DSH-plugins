# spec:插件体系归并重构(9 包 → 5 包)

状态:停点2 待确认 · 分级 standard · 日期 2026-11-07
审计依据:.tmp/audits/{deep-ptc,inventory,credential-vault,websearch-failover,dev-flow}.md(五线独立审计,主代理交叉核对)+ 全仓 0 侵入基线核查(本会话)

## 1 目标
1. 包数 9→5:deep-ptc-mode 吸收 stall-governor+git-bash-tool;inventory 吸收 prompt-inject;dev-flow-skill 吸收 git-status 并改名 dev-flow;vault、websearch 独立保留。
2. 包内模块化:拆解三大单体(inventory client.js 4910 行、stall-governor lib/index.js 5008 行、git-status client.js 1221 行)。
3. 全程 0 侵入 DSH 源码:不写 /opt/dsh-runtime 与任何 @deepseek-ai/* 包内;宿主引用全部声明化。
4. 修复审计缺陷:全部 P1,择期 P2/P3(票内标注)。
5. 补齐 AI 工具可发现性与 locale 单一事实源。

## 2 边界(不做)
- 不改宿主;不建第 10 共享包;不重写引擎逻辑(拆分=等价搬移+测试不变绿变红)。
- 对外契约原样保留(合并线验收逐项核对):
  - 行 id:bash-sandbox/pwsh-sandbox/tool-bash/tool-pwsh/deep-ptc-settings/dsh-stall-governor/git-bash-tool/prompt-inject/git-status/inventory/inventory-gate/credential-vault/websearch-failover
  - 路由:/credential-vault/api(8条)、/websearch-failover/api(4条)、/prompt-inject/state、/git-status/snapshot|diff、/inventory(10条)、/plugins/stall-governor/settings
  - payload/状态文件:各线审计"契约面"节全表;envVar 派生 DSH_CRED_<SLUG>、BLOCK_CODES 五枚举、.flow 五组枚举、验证令牌 DSH-INJECT-7F3A-2026、install.mjs 标记块
  - 提示词段 order:10190/10194/10195/122/20000/3500/150(无撞号,已对照内核 SECTION_ORDERS)
- 吸收行 name 指向合并包时必须配 exports 子路径(./governor、./git-bash、./prompt-inject),禁止三行同指主入口造成多重加载。
- 部署侧(owner 手动):Windows 机 profile bundles 清单更新、~/.dsh/skills 软链重建、每次合并线合并后的人工重启 DSH。
- 版本:dev-flow@0.3.0 起步;deep-ptc-mode、inventory 各 minor+1;engines 统一 >=0.2.2-rc.1 <0.3.0-0;被删包版本随包消失。

## 3 验收(全局)
A. pnpm test + pnpm verify 全绿;合并前用 node scripts/verify-clean.mjs 干净路径复核。
B. 0 侵入基线复查:重跑四项核查(A 写路径/B 私有 import/C 覆写/D patch 通道),零新增违规;B 项做到"无未声明宿主引用"(静态测试钉住,防动态字符串绕过)。
C. 每条合并线 PR 附契约核对表(逐项打勾)。
D. test/docs-contract.test.mjs 动态护栏全绿(计数九→五、link 双向一致)。
E. 死 locale 清零:每包有消费方或删除,契约测试锁定键集。
F. 每个修复票先有"会变红"的测试。

## 4 票务(五阶段;每票一个 issue,独立分支,TDD)

### Phase 0 基线(零行为,可先行,单 PR 可并票)
- T0.1 宿主引用声明化:vault 补 dsh-tools peer;deep-ptc 补 dsh-session/dsh-skill optional peer;inventory gate 补 dsh-mcp-client peer+删 app.asar 硬拼兜底(gate.js:70-85,改 config.mcpClientEntry+宿主 resolver);加静态扫描测试。
- T0.2 CHANGELOG 补 dev-flow-skill 0.2.2/0.2.3;check-bundle-versions 增 CHANGELOG 一致性检查。
- T0.3 基线红灯处置(基线见 .tmp/plan/test-baseline.md):①prompt-inject 3 断言失败**诊断已闭环**(测试缺状态隔离读宿主真实 state,产品无缺陷;实证隔离后 23/23)→ 修复=三测试补 env 隔离,零产品改动;②inventory 5 处失败**全部定性为 node18 环境缺 zlib.zstdDecompressSync**(含 http-guard 的 403 用例,同为 zstd 动态导入),不改码,CI 复核记录在案;③本地验证口径:node≥22(zstd)才可本地全量,否则 inventory 套件 CI-only。

### Phase 1 P1 修复(四线并行,各自 issue/分支)
- T1.vault(P1×3+实况):store 并发写(串行队列+乐观校验)、audit 原子写(tmp+rename+0600)、grant 会话清理挂 dispose、线上 audit.log fchmod 修复;捆 D6 注释锚定。
- T1.web:refresh 串行化(index.js:222-241)+并发红线测试。
- T1.inv:gate 快速挂载竞态(timedOut 标志)+「窗口内挂载必须存活」测试。
- T1.gb:git-bash confined 改写(处理 runner 后置的裸 bash)+Git Bash 存在性探测降级+README 披露。

### Phase 2 合并线(每线原子 PR;线间无依赖可并行)
- T2.devflow(改名+吸收,原子):20 处引用清单(见审计 dev-flow.md)+两启动失败点(client.js:17 模块 id、patch name 锁步)+client 镜像砍除+.flow 加 v:1+specPath+FLOW_DIR/STAGES 导出共享+flow-state 测试归位;版本 0.3.0;部署侧三步随 PR 说明。
- T2.inv(吸收 prompt-inject):12 条契约原样;行 id prompt-inject 保留,name=dsh-inventory/prompt-inject(exports 子路径);verify-packages/check-profile/INVENTORY_SECTIONS 同步;捆 prompt-inject .bak、413 销毁 socket、空白校验、乐观并发 ifUpdatedAt。
- T2.ptc(吸收 governor+git-bash):patch 七行 id 合并+exports 子路径;纪律⑤口径统一(≤10s 轮询 vs deep-ptc 5s——以全局纪律为准改 governor 文案);设置双面共存(slot order 不撞);governor 自管 JSON/env 迁移统一;事件前缀/BLOCK_CODES/黄金键 baseline 原样;compatibility.json snapshotSha256 链 bump。

### Phase 3 包内拆分(合并后做,等价搬移)
- T3.gov:stall-governor lib/index.js 5008 行 → lib/governor/{soft-cut,breaker,notify,settings,probe}.mjs(先整搬为 governor.js,再拆,测试逐票跟随)。
- T3.inv:inventory client.js 按五挂载缝+共享层拆 sections/*;host 测试已对应,client 测试按缝拆文件。
- T3.web:websearch 平铺标准化(plugin/→根布局,build-plugin 退役,9 处引用+gitignore+README+2 测试路径;根 package.json name 不对称显式处理)。
- T3.df:git-status client 拆 board/render/issues/pr(若未随 T2.devflow 完成)。

### Phase 4 缺失功能与可发现性(P2 为主,按线开票)
- T4.ptc:environment 枚举+git-bash(枚举/文案/UI 白名单)、auto 感知 tool-bash 行、execution-environment 段接管 git-bash 说明、notifyChannels 砍或实现、governor locale 化、5s 轮询事件驱动化。
- T4.web:providers.example 补 4 家、SearXNG 鉴权变体、ABORTED 计数、冷却过期清理、resetStats、ALL_FAILED 消息加 agent 引导。
- T4.vault:凭据 TTL 元数据、reveal 审计防裁剪、export 审计字段、hint 补 envVar 规则说明。
- T4.inv:gate 生命周期清理+cwd 语义、searchParents 边界+撞名守卫、sync 失败记忆、远端 TTL。
- T4.df:review pending-decision 进"需要你出手"、死 locale 键清理、触发词"只读查询不进流程"、面板↔skill 互相指引。
- T4.H3:locale 单一事实源横切收口(删三处死配置+契约测试)。

### Phase 5 收口
- T5:根 README/AGENTS/CHANGELOG 计数九→五、目录速览更新、verify-clean 全量、五包打 tag。

## 5 环境约束
- 本机 node v18.19.1(无 nvm/fnm),deep-ptc-mode engines ≥24(import attributes 语法)→ 该包测试只能在 CI(node 24)或升级本机 node 后跑;verify-clean 同受影响。deep-ptc 线的本地验证以 CI 为准,不伪造本地绿。
- 宿主 cordis 语义已源码级钉死:fiber.dispose() 对 PENDING/ACTIVE fiber 均立即卸载(cordis src/fiber.ts:271-303)。

## 6 风险与回滚
- 改名线失败模式=could not load "<id>":client id/patch name/package name 三点锁步,PR 模板加核对项。
- 每线独立 PR,失败可单独 revert,不阻塞其它线。
- 部署侧变更仅在各线 merge 后进行,由 owner 执行并人工重启。
