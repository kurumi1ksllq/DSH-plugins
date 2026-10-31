#!/usr/bin/env bash
# 服务器引导脚本 —— /opt/dsh/DSH-plugins 上跑一次即可（可重复执行）。
#
# 当前状态：**待命资产**。服务器 dsh 暂不需要运作（见 HANDOFF 文档头部的范围重定），
# 这个脚本落地的目的是哪天要启时直接抄，不用重新推一遍顺序。
#
# 唯一不能改的顺序：build-plugin 必须在 pnpm install 之前。
# packages/dsh-websearch-failover/plugin/lib/ 是 .gitignore 掉的生成物，
# link: 在 install 那一刻就指向它，缺文件 = 加载该 bundle 直接 MODULE_NOT_FOUND。
#
# 不依赖 systemd、不依赖网络（除 pnpm 拉依赖），不关任何服务。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${REPO_ROOT}/profiles/web"

echo "==> repo:    ${REPO_ROOT}"
echo "==> profile: ${PROFILE_DIR}"

# ---------------------------------------------------------------- 0. 前置检查
command -v node >/dev/null 2>&1 || { echo "FAIL: node 未安装" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "FAIL: pnpm 未安装（corepack enable 后再跑）" >&2; exit 1; }
echo "    node $(node -v) / pnpm $(pnpm -v)"

# Node 必须 >= 24.2：dsh/lib/bin.js 末行是 `if (import.meta.main) await runCli()`，
# 而 import.meta.main 是 Node 24.2+ 才有的属性。低于此版本 dsh CLI 会
# **静默 exit 0、零输出**，极难排查。实测在 Node 22 上就踩过。
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "${NODE_MAJOR}" -lt 24 ] || { [ "${NODE_MAJOR}" -eq 24 ] && [ "${NODE_MINOR}" -lt 2 ]; }; then
  echo "FAIL: dsh 需要 Node >= 24.2（当前 $(node -v)），否则 CLI 静默退出" >&2
  exit 1
fi
echo "    node version OK (>= 24.2)"

# ------------------------------------------- 1. 生成 websearch 的 plugin/lib/
# 必须是第一步。plugin/lib/ 不在 git 里，clone 下来是空的。
echo "==> [1/4] build dsh-websearch-failover plugin/lib"
node "${REPO_ROOT}/packages/dsh-websearch-failover/scripts/build-plugin.mjs"
node "${REPO_ROOT}/packages/dsh-websearch-failover/scripts/build-plugin.mjs" --check

# -------------------------------------------------------- 2. install（走 lockfile）
# --frozen-lockfile：lockfile 与 package.json 不一致就报错，不偷偷改版本。
echo "==> [2/4] pnpm install (frozen lockfile)"
cd "${PROFILE_DIR}"
pnpm install --frozen-lockfile

# ---------------------------------------------------------------- 3. 静态校验
# 校验 link 目标、包名、patch 文件、plugin/lib 非空、没混进 dsh-git-bash-tool。
echo "==> [3/4] verify profile"
node "${REPO_ROOT}/scripts/verify-web-profile.mjs"

# ---------------------------------------------------------------- 4. 收尾提示
echo "==> [4/4] done"
cat <<DONE

本次**没有**启动或重启任何进程。要启服务器 dsh 时再说，注意两点：

1) DSH_HOME 必须指向**仓库根**，让 \$DSH_HOME/profiles/web 自然等于本仓库的
   profiles/web，link:../../packages/... 的相对路径才成立。
   不要用 DSH_PROFILE_DIR —— dsh 会静默忽略它，反手在 \$DSH_HOME/profiles/web
   建一个空 profile（只有 base + web-app），结果所有本地插件都不加载。

   export DSH_HOME=${REPO_ROOT}
   dsh web --no-open --port 18238     # 换端口，别撞现有实例

   --no-open 必加，否则 dsh 抢前台弹浏览器。

2) 密钥走 ${REPO_ROOT%/DSH-plugins}/secrets.env 或系统 EnvironmentFile（chmod 600，不进 git）：

   NEWAPI_API_KEY=...
   AAAAA_API_KEY=...

另外 \$DSH_HOME/websearch-failover/providers.json 不同步，服务器要单独配。
DONE
