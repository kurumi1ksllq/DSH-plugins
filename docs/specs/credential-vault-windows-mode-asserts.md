# spec: credential-vault 文件 mode 断言的平台隔离 (#66)

> 停点2 产物。用户于 2026-11-06 预授权「自行判断和解决」，分级 **standard**（4 处断言跨 3 个测试文件）。

## 1. 目标

credential-vault 的测试在 Windows 上不再必挂：4 处 `mode & 0o777 === 0o600`（384）断言
依赖 POSIX permission bits，而 Windows 上 `fs.chmodSync` 对这些位是 no-op，新文件报
`0o666`（438），断言恒失败。实现本身没有缺陷，是测试缺平台隔离。

## 2. 边界

- **只改测试**，不动 `index.js` / `lib/` 任何实现代码；文件创建时的 0600 语义保持现状。
- 平台判断用 `process.platform === 'win32'`，不做其它 OS 特判。
- POSIX 语义不放宽：POSIX 上仍断言精确 `0o600`，不因引入 helper 而放过真实回归。
- 不新建测试文件；helper 放在最小可达范围内（见 §3 T1）。

## 3. 验收

1. `node scripts/verify-clean.mjs`（install --frozen-lockfile + verify + test）干净树全绿。
2. 反向验证：把断言目标改坏（临时把 helper 的期望从 0600 改成 0666）时测试变红，改回后恢复绿。
3. Windows 语义以代码审查确认：`win32` 分支只跳过 mode 精确断言，其余断言照跑
   （未在 win32 实机验证，标注「未验证」）。
4. `dsh-credential-vault` 版本号升 patch（纯测试改动，按 #79 先例）。
