# spec: patchLayerOf 识别 insert 嵌套定义，死覆盖条目不再毒化判层 (#89)

> 停点2 产物。用户于 2026-11-06 持续授权「自行判断和解决」，分级 **standard**。

## 1. 目标

`patchLayerOf` 正确识别 home patch 的两类**定义**形态，使 #86/#88 的分层写入对 rea setup
注册的条目真实生效：

1. `- insert:` 顶层块内嵌套的 `- id: X` 条目（rea setup 的标准写入形态）；
2. 顶层 `- id: X` 且带有 `disabled` 以外字段（name/options/config）的完整条目。

裸的 `{id, disabled}`（本模块与 manager 写出的覆盖块）**不算定义**——它们是覆盖标记，
不得参与层归属判定。由此 #88 前 manager 留下的死条目不再把判层钉死在 profile 层。

## 2. 方案（缩进感知扫描，不加依赖）

`lib/global-patch.js` 以 `definedIds(text)` 替换逐行 `definesId`：

- 顶层序列项（行首 `- `）逐块扫描，复用 `setPatchEnabled` 的分块方式；
- 块首 `- id: X`：块内存在 `disabled` 以外字段行 → 记为定义；
- 块首 `- insert:`：取块内**最浅缩进**的序列项为直接子项，仅该缩进上的 `- id: X` 记为定义
  （防止子项 config 里更深的 `- id:` 列表污染）；
- 流式 YAML（flow style）不识别——保守回退为「该层未定义」，不产出新死写入；文档注明限制。

`setPatchEnabled`/`writePatchEnabled` 写语义不变；层归属由路由（`patchTargetFor`）保证，
home 层写入必然发生在定义之后（同文件 insert 在前）。

## 3. 边界

- 不清理历史死条目（插件无删除语义；无害，注释性残留）；升级前手动清理自行处理。
- 不引入 `yaml` 依赖（bundle 零运行时依赖现状保持；流式限制见上）。
- `include:` 树前缀块不在本 spec 范围（patchIdOf 已剥前缀，未见真实用例）。

## 4. 验收

1. `patchLayerOf`：home insert 嵌套定义 + profile 死覆盖残留 → `'home'`（#89 实测场景）。
2. profile 仅有死覆盖条目、home 无定义 → `null`（不再判 `'profile'`）。
3. 顶层完整条目（带 config）识别为定义；裸 `{id, disabled}` 不识别。
4. insert 子项 config 内更深缩进的 `- id:` 列表不误判为定义。
5. 引号 id 匹配保持（`- id: "x"` + 非 disabled 字段）。
6. 既有 setPatchEnabled/writePatchEnabled 测试全绿；toggle/snapshot 测试 fixture 更新为真实
   定义形态后全绿；`verify-clean` 干净树 gate 绿；版本升 patch。
