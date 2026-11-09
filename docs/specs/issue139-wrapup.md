# #132 双轴 review 收尾(#139)

来源:PR #138 双轴 review 收尾项。分级:standard。

## 复核结论(2026-11-09 实测)

1. **P1 apply 侧 en 联动断言缺失**——成立。copy.test 只对导出的 renderRepeatAnchor/renderChurnEscalation 直传 "en";governor-apply 13 处调用点的实参传递无测试钉住(接线静默退化 zh 的回归不被发现)。
2. **P2 en 分支英文括注取舍**——成立但低危:render* 的 en 分支丢弃既有英文括注行(冗余信号降一级);en.softStopTail 丢「中文总结」约定(软停指令要求模型用中文总结——en 下应保留该约定语义)。
3. **中-2 静态注入**——**不成立**(实测复现失败):applyRuntimeSettings 是 settings 的唯一发布点,白名单(407-408)覆盖 persisted 文件路径,喂 "French" 回退 zh;与 transitionTextMode 的差异不构成缺口。已在 issue 评论澄清。

## 方案

| # | 内容 |
|---|---|
| 1 | copy.test 增「settings→en 产出」联动断言:applyRuntimeSettings({copyLocale:'en'}) 后断言 settings.copyLocale==='en' 且 copy('en') 产物与 render*(…, settings.copyLocale) 一致性——即用 settings 值(非字面量 "en")调用导出的 render*,钉住「调用点实参真传」 |
| 2 | en.softStopTail 补「中文总结」语义(en 保留 "summarize in Chinese" 要求);CHANGELOG 1.11.0 条目不追改(细节) |
| 3 | 中-2 澄清记录进本 spec + issue 评论(已做) |

## 边界

- 只改 packages/dsh-deep-ptc-mode/test-governor/copy.test.mjs + lib/governor-copy.mjs(一处 en 文案)+ spec;版本纪律:改动了包(client 文案)→ 升 patch(1.11.0 → 1.11.1),tag 合并后打。

## 验收

1. 新断言绿且反向有效:删任一调用点实参 → 断言红。
2. softStopTail en 含中文总结要求。
3. pnpm test(deep-ptc 24)全绿 + CI 绿。
