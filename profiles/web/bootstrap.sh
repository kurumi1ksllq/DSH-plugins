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
cat <<'DONE'

本次**没有**启动或重启任何进程。要启服务器 dsh 时再说，需要注意：

  DSH_PROFILE=web \
  DSH_PROFILE_DIR=/opt/dsh/DSH-plugins/profiles/web \
  dsh web --port 18238      # 先用别的端口试，别撞现有的

密钥走 /opt/dsh/secrets.env（chmod 600，不进 git）：

  NEWAPI_API_KEY=...
  AAAAA_API_KEY=...

另外 $DSH_HOME/websearch-failover/providers.json 不同步，服务器要单独配。
DONE
