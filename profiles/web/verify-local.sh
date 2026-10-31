#!/usr/bin/env bash
# 隔离验证 —— 在**另一个端口**上起一个临时的 dsh web，确认 profiles/web/ 里的插件
# 都能加载，然后干净地杀掉。全程不碰现有的 18237。
#
# 为什么必须隔离：18237 是 desktop profile（DSH_HOME=~/.dsh，走默认 desktop），
# 它根本不读 profiles/web/。这个脚本只做「起进程 + 探活 + kill」，不改任何文件。
#
# 用法：
#   bash profiles/web/verify-local.sh            # 默认端口 18238
#   PORT=18241 bash profiles/web/verify-local.sh
#   DSH_CMD=... bash profiles/web/verify-local.sh   # 指定 dsh 启动器
#
# 退出码：0 = 起得来且探活通过；非 0 = 有问题，看输出。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_DIR="${REPO_ROOT}/profiles/web"
PORT="${PORT:-18238}"
LOG="${TMPDIR:-/tmp}/dsh-web-profile-verify-${PORT}.log"
PROTECTED_PORT=18237

if [ "${PORT}" = "${PROTECTED_PORT}" ]; then
  echo "FAIL: ${PROTECTED_PORT} 是现有实例，换一个 PORT" >&2
  exit 1
fi

# ---------------------------------------------------------------- 0. 找 dsh
# 桌面包不自带 PATH 里的 dsh，启动器在安装目录里。
if [ -z "${DSH_CMD:-}" ]; then
  if command -v dsh >/dev/null 2>&1; then
    DSH_CMD="$(command -v dsh)"
  elif [ -f "/e/DeepSeekHarness/resources/runtime/cli/bin/dsh.cmd" ]; then
    DSH_CMD="/e/DeepSeekHarness/resources/runtime/cli/bin/dsh.cmd"
  fi
fi
if [ -z "${DSH_CMD:-}" ]; then
  echo "FAIL: 找不到 dsh 启动器，用 DSH_CMD=... 指定" >&2
  exit 1
fi
echo "==> dsh:     ${DSH_CMD}"

# ---------------------------------------------------------------- 1. 端口占用
if (netstat -an 2>/dev/null || ss -an 2>/dev/null) | grep -qE "[:.]${PORT}[[:space:]].*LISTEN"; then
  echo "FAIL: 端口 ${PORT} 已被占用，换一个 PORT" >&2
  exit 1
fi

echo "==> profile: ${PROFILE_DIR}"
echo "==> port:    ${PORT}   (现有 ${PROTECTED_PORT} 不受影响)"
echo "==> log:     ${LOG}"

# 含空格的 .cmd 路径必须走 cmd.exe
case "${DSH_CMD}" in
  *.cmd|*.bat) LAUNCH=(cmd //c "${DSH_CMD} web --no-open --port ${PORT}") ;;
  *)           LAUNCH=("${DSH_CMD}" web --no-open --port "${PORT}") ;;
esac

# ---------------------------------------------------------- 2. 起临时进程
# DSH_HOME 必须指到**仓库根**：dsh 只认 $DSH_HOME/profiles/<name>，
# 传 DSH_PROFILE_DIR 会被静默忽略，并在 $DSH_HOME/profiles/web 建一个空 profile。
# 把 DSH_HOME 设成 REPO_ROOT 后，$DSH_HOME/profiles/web 正好等于本仓库的 profiles/web。
# DSH_HOME 单独给一个子目录没意义（会污染仓库外的状态），所以这里直接复用仓库根。
DSH_HOME="${REPO_ROOT}" \
"${LAUNCH[@]}" >"${LOG}" 2>&1 &
DSH_PID=$!

# 无论成功失败都要收尸，否则会留一个占端口的孤儿进程
cleanup() {
  if kill -0 "${DSH_PID}" 2>/dev/null; then
    echo "==> 停止临时进程 ${DSH_PID}"
    kill "${DSH_PID}" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "${DSH_PID}" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "${DSH_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------- 3. 等它监听
echo "==> 等待监听（最多 30s）"
READY=0
for _ in $(seq 1 60); do
  if ! kill -0 "${DSH_PID}" 2>/dev/null; then
    echo "FAIL: 进程在监听前就退出了，日志：" >&2
    tail -40 "${LOG}" >&2
    exit 1
  fi
  if (netstat -an 2>/dev/null || ss -an 2>/dev/null) | grep -qE "[:.]${PORT}[[:space:]].*LISTEN"; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "${READY}" -ne 1 ]; then
  echo "FAIL: 30s 内没有监听 ${PORT}，日志：" >&2
  tail -40 "${LOG}" >&2
  exit 1
fi

# ---------------------------------------------------------- 4. 探活
echo "==> 探活 http://127.0.0.1:${PORT}/"
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || echo 000)"
echo "    GET / -> ${HTTP_CODE}"

echo "==> 扫描日志里的加载错误"
if grep -nEi "MODULE_NOT_FOUND|cannot find module|ERR_MODULE_NOT_FOUND|failed to load bundle|bundle .* not found" "${LOG}"; then
  echo "FAIL: 日志里有模块加载错误（上面几行）" >&2
  exit 1
fi

echo "==> 本地插件行是否出现在日志里"
for name in dsh-inventory dsh-ctx-guard websearch failover prompt-inject ctx-guard; do
  if grep -qi "${name}" "${LOG}"; then
    echo "    OK   ${name}"
  else
    echo "    -    ${name}   (日志里没提到，可能只是没打日志)"
  fi
done

echo "==> 日志尾部 20 行"
tail -20 "${LOG}"

if [ "${HTTP_CODE}" = "000" ]; then
  echo "FAIL: 端口开了但 HTTP 探活失败" >&2
  exit 1
fi

echo "==> 通过。临时进程会在退出时被清理，${PROTECTED_PORT} 全程未动。"
