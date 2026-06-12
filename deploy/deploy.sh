#!/usr/bin/env bash
# 知竹 - 线上一键部署脚本（Docker Compose）
#
# 适用：刚 `git clone` 完毕、装有 Docker Engine 24+ 与 Compose V2 的 Linux/macOS 主机。
# 行为：
#   1. 检查 docker / docker compose 可用性
#   2. 若仓库根缺 `.env`，自动生成；已有则只补缺失键（不覆盖已配置值）
#   3. 强随机生成 JWT_SECRET / DEVICE_TOKEN_SECRET（仅在缺失时）
#   4. 按 --domain 设置 PUBLIC_ORIGIN / CORS_ORIGIN / CONSOLE_WEB_PUBLIC_URL；
#      未传 --domain 时沿用 .env 已有 PUBLIC_ORIGIN（都没有才用 http://localhost:8080）
#   5. `docker compose build && docker compose up -d`
#   6. 等待 /health 通过，打印访问地址与初始账号
#
# 用法：
#   bash deploy/deploy.sh                                    # 本机试用，PUBLIC_ORIGIN=http://localhost:8080
#   bash deploy/deploy.sh --domain https://console.example.com
#   bash deploy/deploy.sh --domain http://1.2.3.4:8080 --port 8080
#   bash deploy/deploy.sh --rebuild                          # 强制重新构建 web/api 镜像
#   bash deploy/deploy.sh --open-register                    # 开放自助注册（默认关闭）
#
# 也可直接运行：`npm run deploy:prod` （等价于 `bash deploy/deploy.sh "$@"`）
# 从 GitHub 拉取最新代码后更新部署：`bash deploy/update.sh`（内部复用本脚本）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

PUBLIC_ORIGIN_DEFAULT="http://localhost:8080"
WEB_HOST_PORT_DEFAULT="8080"

PUBLIC_ORIGIN=""
WEB_HOST_PORT=""
REBUILD=0
OPEN_REGISTER=0
SKIP_BUILD=0

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" 1>&2; }

usage() {
  cat <<'USAGE'
用法：bash deploy/deploy.sh [选项]

  --domain <URL>      浏览器访问控制台的根地址，例如 https://console.example.com
                      （决定 VITE_API_BASE_URL / CORS_ORIGIN / CONSOLE_WEB_PUBLIC_URL；
                      不传时沿用 .env 已有 PUBLIC_ORIGIN，再缺省为 http://localhost:8080）
  --port <PORT>       Web 宿主机端口（不传时沿用 .env 已有 WEB_HOST_PORT，再缺省 8080）
  --rebuild           强制重新 build 镜像（修改 PUBLIC_ORIGIN 后通常需要）
  --open-register     开放自助注册（CONSOLE_ALLOW_PUBLIC_REGISTER=true）
  --skip-build        仅 up -d，不执行 build（适合二次启动）
  -h | --help         显示帮助
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) PUBLIC_ORIGIN="${2:-}"; shift 2 ;;
    --port) WEB_HOST_PORT="${2:-}"; shift 2 ;;
    --rebuild) REBUILD=1; shift ;;
    --open-register) OPEN_REGISTER=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知参数：$1"; usage; exit 2 ;;
  esac
done

# ---- 1. 检查依赖 -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "未检测到 docker。请先安装 Docker Engine 24+：https://docs.docker.com/engine/install/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "未检测到 docker compose（V2）。请安装或升级到 Compose V2。"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  err "docker daemon 不可访问。请确认服务已启动，且当前用户在 docker 组中。"
  exit 1
fi
log "docker / compose 检测通过"

# ---- 2. 准备 .env ------------------------------------------------------------
ENV_FILE="${ROOT_DIR}/.env"

rand_hex() {
  # 64 位 hex（32 字节随机），用作 *_SECRET
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
  fi
}

# 读取已有键值（保留首次出现的值；不解析引号）
get_env() {
  local key="$1"
  if [[ -f "${ENV_FILE}" ]]; then
    grep -E "^${key}=" "${ENV_FILE}" | head -n1 | sed -E "s/^${key}=//"
  fi
}

# 仅当键不存在或值为空时追加（不覆盖）
upsert_env_if_missing() {
  local key="$1"
  local value="$2"
  local current
  current="$(get_env "${key}" || true)"
  if [[ -z "${current}" ]]; then
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
    log "  + ${key}=（已写入）"
  fi
}

# 覆盖式写入（用于本次部署确定语义的键，例如 PUBLIC_ORIGIN / CORS_ORIGIN）
upsert_env_force() {
  local key="$1"
  local value="$2"
  if [[ -f "${ENV_FILE}" ]] && grep -qE "^${key}=" "${ENV_FILE}"; then
    # 使用临时文件以保持跨平台兼容（sed -i 在 BSD/GNU 行为不同）
    awk -v k="${key}" -v v="${value}" '
      BEGIN { found = 0 }
      {
        if (!found && match($0, "^" k "=")) {
          print k "=" v
          found = 1
        } else {
          print
        }
      }
    ' "${ENV_FILE}" >"${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
  fi
  log "  * ${key}=${value}"
}

if [[ ! -f "${ENV_FILE}" ]]; then
  log "未发现根目录 .env，将基于 .env.example 创建"
  printf '# 由 deploy/deploy.sh 生成于 %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${ENV_FILE}"
fi

# 未显式传 --domain / --port 时沿用 .env 已有配置（避免日常更新重置线上域名），
# .env 也没有时才落到默认值。
if [[ -z "${PUBLIC_ORIGIN}" ]]; then
  PUBLIC_ORIGIN="$(get_env PUBLIC_ORIGIN || true)"
  if [[ -n "${PUBLIC_ORIGIN}" ]]; then
    log "未传 --domain，沿用 .env 中 PUBLIC_ORIGIN=${PUBLIC_ORIGIN}"
  fi
fi
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-${PUBLIC_ORIGIN_DEFAULT}}"
if [[ -z "${WEB_HOST_PORT}" ]]; then
  WEB_HOST_PORT="$(get_env WEB_HOST_PORT || true)"
fi
WEB_HOST_PORT="${WEB_HOST_PORT:-${WEB_HOST_PORT_DEFAULT}}"

# 内置 Postgres：仅当未配外置库（无 PGHOST 且无 DATABASE_URL）时补默认连接串
if [[ -z "$(get_env PGHOST || true)" ]] && [[ -z "$(get_env DATABASE_URL || true)" ]]; then
  upsert_env_if_missing "DATABASE_URL" "postgresql://zhizhu:zhizhu@postgres:5432/zhizhu"
fi

# 是否使用 compose 内置 Postgres：看连接串是否指向内置服务主机名 postgres
# （不能用「DATABASE_URL 是否为空」判定——上面刚写入了默认连接串，重复执行时也已存在）
uses_bundled_db() {
  local pghost dburl
  pghost="$(get_env PGHOST || true)"
  dburl="$(get_env DATABASE_URL || true)"
  [[ "${pghost}" == "postgres" ]] && return 0
  [[ "${dburl}" == *"@postgres:"* || "${dburl}" == *"@postgres/"* ]] && return 0
  return 1
}

# 强随机密钥
JWT_SECRET_VALUE="$(get_env JWT_SECRET || true)"
if [[ -z "${JWT_SECRET_VALUE}" ]]; then
  JWT_SECRET_VALUE="$(rand_hex)"
  printf 'JWT_SECRET=%s\n' "${JWT_SECRET_VALUE}" >>"${ENV_FILE}"
  log "  + JWT_SECRET=（已生成强随机）"
fi
DEVICE_TOKEN_VALUE="$(get_env DEVICE_TOKEN_SECRET || true)"
if [[ -z "${DEVICE_TOKEN_VALUE}" ]]; then
  DEVICE_TOKEN_VALUE="$(rand_hex)"
  printf 'DEVICE_TOKEN_SECRET=%s\n' "${DEVICE_TOKEN_VALUE}" >>"${ENV_FILE}"
  log "  + DEVICE_TOKEN_SECRET=（已生成强随机）"
fi

# 本次部署明确写入的键
upsert_env_force "PUBLIC_ORIGIN" "${PUBLIC_ORIGIN}"
upsert_env_force "WEB_HOST_PORT" "${WEB_HOST_PORT}"
upsert_env_force "CORS_STRICT" "1"
upsert_env_force "CORS_ORIGIN" "${PUBLIC_ORIGIN}"
upsert_env_force "CONSOLE_WEB_PUBLIC_URL" "${PUBLIC_ORIGIN}"

# 自助注册（首次默认关闭；--open-register 时开放；未传参时沿用 .env 已有值，前后端一致）
if [[ "${OPEN_REGISTER}" -eq 1 ]]; then
  REGISTER_VALUE="true"
else
  REGISTER_VALUE="$(get_env CONSOLE_ALLOW_PUBLIC_REGISTER || true)"
  if [[ "${REGISTER_VALUE}" != "true" ]]; then
    REGISTER_VALUE="false"
  fi
fi
upsert_env_force "CONSOLE_ALLOW_PUBLIC_REGISTER" "${REGISTER_VALUE}"
upsert_env_force "VITE_CONSOLE_PUBLIC_REGISTER" "${REGISTER_VALUE}"

log "已写入 .env（敏感值不在终端回显）"

# ---- 3. 构建并启动 -----------------------------------------------------------
COMPOSE=(docker compose)

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  if [[ "${REBUILD}" -eq 1 ]]; then
    log "重新构建镜像（--rebuild）"
    "${COMPOSE[@]}" build --no-cache
  else
    log "构建镜像（如已有缓存会快速复用）"
    "${COMPOSE[@]}" build
  fi
fi

if uses_bundled_db; then
  log "启动服务（docker compose --profile bundled-db up -d，使用内置 Postgres）"
  "${COMPOSE[@]}" --profile bundled-db up -d
else
  log "启动服务（docker compose up -d，使用 .env 中的外置数据库）"
  "${COMPOSE[@]}" up -d
fi

# ---- 4. 等待 /health 通过 ----------------------------------------------------
HEALTH_URL="http://127.0.0.1:${WEB_HOST_PORT}/health"
log "等待健康检查通过：${HEALTH_URL}"

ATTEMPTS=60
SLEEP_S=2
ok=0
for i in $(seq 1 "${ATTEMPTS}"); do
  if curl -fsS --max-time 3 "${HEALTH_URL}" >/dev/null 2>&1; then
    ok=1
    break
  fi
  if [[ $((i % 5)) -eq 0 ]]; then
    log "  ...仍在等待（${i}/${ATTEMPTS}）"
  fi
  sleep "${SLEEP_S}"
done

echo
if [[ "${ok}" -eq 1 ]]; then
  log "部署完成"
else
  warn "在 $((ATTEMPTS * SLEEP_S))s 内未观察到 /health 200；服务可能仍在拉起或迁移中。"
  warn "可通过：docker compose logs -f api  查看日志，或：docker compose ps  查看状态。"
fi

cat <<INFO

================ 知竹 · 部署摘要 ================
  控制台访问：       ${PUBLIC_ORIGIN}
  健康检查：         ${PUBLIC_ORIGIN%/}/health  （宿主机本地：${HEALTH_URL}）
  Web 容器宿主端口： ${WEB_HOST_PORT}
  自助注册：         $([[ "${REGISTER_VALUE}" == "true" ]] && echo "已开放" || echo "已关闭（仅平台/租户管理员可创建）")

  初始账号（首次启动迁移种子写入）：
    租户：demo         用户名：admin           密码：A123456
    平台管理员：vtea / vtea / A123456

  常用命令：
    查看状态：   docker compose ps
    查看日志：   docker compose logs -f api
    停止服务：   docker compose stop
    彻底清理：   docker compose down -v   （注意：会清空内置 Postgres 数据卷）

  从 GitHub 拉取最新代码并更新部署：
    bash deploy/update.sh

  改外网域名后须重新构建 web 镜像（VITE_* 为构建期变量）：
    bash deploy/deploy.sh --domain https://your.domain --rebuild

  详细见 docs/部署指南.md
=================================================
INFO
