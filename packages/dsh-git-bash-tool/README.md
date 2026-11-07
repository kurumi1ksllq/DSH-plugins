# dsh-git-bash-tool

Windows 上把 DSH 的 `pwsh` 工具换成内置的 `bash` 工具，底层用 **Git Bash 绝对路径**，不是 `C:\Windows\System32\bash.exe`（WSL 桩）。

## 它解决什么

DSH 的 base 组合包在 Windows 上主动关掉了 bash 工具：

| 行 | 位置 | 内容 |
|---|---|---|
| `bash-sandbox` | `@deepseek-ai/dsh-base/cordis.patch.yml:249` | `disabled: process.platform === 'win32'` |
| `pwsh-sandbox` | 同上 `:255` | `disabled: process.platform !== 'win32'` |
| `tool-bash` | 同上 `:281` | `disabled: process.platform === 'win32'` |
| `tool-pwsh` | 同上 `:285` | `disabled: process.platform !== 'win32'` |

原因不是"bash 不支持 Windows"，是 `@deepseek-ai/dsh-bash-local/lib/index.js:142-147` 把子进程 argv 写死成 `['bash', '-c', command]`，没有 bashPath 配置；而 Windows PATH 里的裸 `bash` 是 WSL 桩：

```
PS> bash -c "uname -s"
适用于 Linux 的 Windows 子系统没有已安装的分发版。
```

所以模型只能拿到 `pwsh`，于是"必须用 Git Bash 包一层"只能靠 AGENTS.md 的软约定，会漏（实测 6064 次 `pwsh` 调用里 1858 次是裸 PowerShell）。

## 它怎么做

- `index.js`：拿到已挂载的 `ctx.shell` 实例，只在 `spawnSpec`（`dsh-bash-local/lib/index.js:107`，沙箱分支与直连分支都汇到这一个方法）把 argv 里的 `bash` 换成 `C:\Program Files\Git\bin\bash.exe`。
  - 不 import 任何 `@deepseek-ai/*`：不复制 host 的类，版本变化不会炸。
  - 沙箱、超时、输出截断、后台 job 全部沿用官方执行器，一行没改。
  - 万一将来的执行器没有 `spawnSpec`，退化为给 DSH 进程的 PATH 前置 `C:\Program Files\Git\usr\bin`（只影响本进程，不动系统 PATH）。
  - **confined（沙箱）分支同样生效**：沙箱把真实 argv 包在第一个 `--` 分隔符之后
    （`[runner, ..., --, bash, -c, cmd]`），重写按位处理该分隔符后的裸 `bash`（#105）。
  - **Git Bash 缺失时降级**：挂载时探测二进制存在性，缺失则告警并走 PATH 前置回退，
    不再改写 argv 指向不存在的路径（#105）。
  - **已知边界**：`C:\Program Files\Git\bin\bash.exe` 是硬编码默认值，非 default
    安装路径的 Git 依赖 PATH 回退生效。
- `cordis.patch.yml`：开 `bash-sandbox` / `tool-bash`，关 `pwsh-sandbox` / `tool-pwsh`，并插入本插件行。

结果：模型可见工具里只有 `bash`，没有 `pwsh`。PowerShell 泄漏不是遵守问题，是没有入口。

## 安装

```powershell
pwsh -File install.ps1          # 干跑，只打印计划
pwsh -File install.ps1 -Yes     # 执行：备份 package.json → 建 junction → 写依赖与 bundle 注册
```

然后**重启 DeepSeek Harness**（profile 变更对下个会话生效）。

安装做的事：
1. `$env:DSH_HOME\profiles\desktop\package.json` 备份到 `$env:DSH_HOME\backup\`；
2. `profiles\desktop\node_modules\dsh-git-bash-tool` 建 junction 指向本目录（`link:` 依赖，和 `dsh-inventory`、`dsh-lsp-actions` 同一种装法）；
3. `dependencies` 加 `"dsh-git-bash-tool": "link:E:/Project-hub/DSH-plugins/packages/dsh-git-bash-tool"`；
4. `dsh.profile.bundles` 追加 `dsh-git-bash-tool`。

## 验证

新会话里：

1. 工具列表有 `bash`、没有 `pwsh`；
2. `bash -c 'uname -s'` → `MINGW64_NT-10.0-...`（不是"没有已安装的分发版"）；
3. `bash -c 'echo $BASH_VERSION'` → `5.2.x`；
4. 之前必须靠 `& 'C:\Program Files\Git\bin\bash.exe' -c '...'` 的命令，现在直接写 bash 语法。

## 回滚

```powershell
pwsh -File install.ps1 -Uninstall -Yes
```

或从 `$env:DSH_HOME\backup\profile-desktop-package-<时间戳>.json` 还原，重启即可。

## 装完要顺手改 AGENTS.md

`~/.dsh/AGENTS.md` 第 1 节的规则（"默认所有命令走 Git Bash：`& 'C:\Program Files\Git\bin\bash.exe' -c '...'; exit $LASTEXITCODE`"、"裸 bash 是 WSL 桩"）在这个插件生效后**已过期**：`bash` 工具本身就是 Git Bash，命令里再包一层会变成 `bash -c "bash -c '...'"`。

建议替换为：

```markdown
## 1. Shell

- DSH 在 Windows 注册的是 `bash` 工具（dsh-git-bash-tool 把执行器指向 Git Bash 绝对路径）。
- 命令直接写 bash 语法，不要再手工包 `bash.exe -c`，也不要再用 PowerShell 语法。
- 需要注册表 / 服务 / 计划任务 / COM / WMI / GUI 安装器 / `-Verb RunAs` 时，用 `bash -c` 调
  `powershell.exe -NoProfile -Command '<命令>'`，并在 description 里写一句为什么。
- MSYS 会改写传给原生 exe 的参数（`/F`→`F:/`、`/tmp/x`→`%TEMP%\x`）：先 `cygpath -w <路径>`，或 `MSYS_NO_PATHCONV=1`。
- cwd 默认等于会话工作区；换目录显式 `cd`。
```

## 已知边界

- 只影响 shell 工具。`terminal_*` 走自己的后端，不受影响。
- `bash-sandbox` 的 `timeoutMs` 在本 bundle 的 patch 里重述为 60000（patch 会整体替换被命中行的 config，不重述会退回默认 120000）。
- 执行器若被 HMR 重载，`ctx.inject` 回调会重新打补丁；插件卸载时恢复原方法。
- 只对 Windows 有意义；其它平台 base 本来就挂 bash 工具，本 bundle 的 patch 在那边是空操作（那两行本来就 `disabled: false`）。
