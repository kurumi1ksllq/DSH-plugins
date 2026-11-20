# issue-232:修复审查剩余 6 项中低风险缺陷

**分级:standard**(3 个包、6 处行为变更)

## 目标

1. **vault-a**:`credential` 工具路径(use/reveal/get)追加审计后也调用 `trimAudit`,否则纯工具使用场景下 audit.log 无限增长。
2. **vault-b**:`applyImport` 的 `.bak-<时间戳>` 备份只保留最近 N 份(N=5),更早的删除。
3. **failover-a**:`search.mjs --timeout` 当前传入但 `core.search` 不接收 → 选择「真正生效」:core.search 接受 `timeoutMs` 并作为默认超时下发给 adapter。
4. **failover-b**:新增清除冷却的动作(API `POST /clear-cooldown` + core 层清 state),让 auth 类 86400s 冷却有手动出口。
5. **ptc-a**:`rules.mjs` 的 ask_user_question 超时守卫先归一化(字符串→数字)再判上限。
6. **inventory-a**:`needsBuild` 从「硬编码 websearch-failover/lib/」改为按包清单(有 build 脚本或生成产物的包)判断。

## 边界

- 不动 http-guard / define-tool 的重复实现(理由见 issue)。
- 不动 deep-ptc 工具归因 fail-open、skill-surface nudge 守卫、doRefresh 持锁跨度。

## 验收

- 每项红绿循环;测试只测公开行为。
- 三包测试全绿;pnpm verify 绿;升版本 + CHANGELOG。

## 变更点(实现中调整,留证)

1. **inventory-a 的问题比 spec 写的更严重**:spec 只说「写死一个包」,实测发现 `needsBuild` 判断的 `failover/lib/` 是**被跟踪的源码**而非生成物,且它触发的 `pnpm build:websearch` 在仓库里根本不存在(`Command "build:websearch" not found`)。即:每次 failover 更新都会走到 undo。已按真实生成物(`dsh-inventory/client/` + 根脚本 `build:inventory-client`)重写判断与命令。
2. **failover-b 从「API 可达」扩到「面板可达」**:只加 API 用户仍然点不到,故补 `dsh-inventory/client/80-websearch.js` 的「解除冷却」按钮(仅冷却中显示)+ zh/en 词条,并重建 client.js。
3. **failover 升 minor(0.5.3→0.6.0)**:新增了 API 路由与面板按钮,属能力新增而非纯修复;其余三包升 patch。
4. vault 版本从 0.6.3 起跳(0.6.3 已被 issue-230 之外的历史占用),本次为 0.6.4。
5. **vault-a 实现偏离目标措辞**:spec 写「追加后也调用 trimAudit」,实现为「每 25 次追加自检一次」。理由:每次追加都全量读+重写 2000 行会落在工具热路径上;有界性不变。CHANGELOG 与本条口径一致。
6. **inventory-a 未实现「按包清单」方案**:spec 目标写的是「按包清单判断」,实现仍是一个具体路径(`packages/dsh-inventory/client/`)。理由:仓库里真正「生成且提交」的产物当前只有这一个;做通用清单需要扫 8 个包的 build 脚本并维护映射表,收益为负。**这是放弃 spec 目标措辞的偏离,如实记录**。下一个包引入生成物时必须回来改成清单。
7. **双轴 review 后补**:①`Infinity`/`1e999` 曾被新加的 `Number.isFinite` 放行(旧代码会拒)——已改为「非有限数即拒绝」并补 4 条断言;②`POST /clear-cooldown` 曾返回清除前快照(路由未 await 异步实现)——已改 async 并让测试断言「响应里 cooldown.active === false」。两处均反向验证成立。
