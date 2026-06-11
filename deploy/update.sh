#!/usr/bin/env bash
# 知竹 - 从 GitHub 一键更新并部署（Linux/macOS）
#
# 两种运行形态：
#   A. 仓库内日常更新（推荐）：
#        bash deploy/update.sh                       # git pull 后自动重建并部署
#        npm run deploy:update                        # 等价
#        bash deploy/update.sh -- --domain https://console.example.com
#   B. 独立引导（首次部署；可单独把本文件 curl 到新主机执行）：
#        bash update.sh --dir /opt/zhizhu
#        bash update.sh --dir /opt/zhizhu --repo https://github.com/vtea/zhizhu.git \
#          -- --domain https://console.example.com
#
# 行为：
#   1. 定位仓库：--dir 优先；否则脚本所在 git 工作区；都没有则 ./zhizhu
#   2. 目录无仓库 -> git clone --branch <branch> <repo>
#   3. 有仓库 -> 校验工作区干净（gitignore 文件如 .env 不计），git fetch + pull --ff-only
#   4. 有新提交（或首次 clone、或 --force）-> bash deploy/deploy.sh <透传参数>
#      无新提交 -> deploy.sh --skip-build 仅确保服务在跑
#
# `--` 之后的参数原样透传给 deploy/deploy.sh（如 --domain / --rebuild / --open-register）。
# deploy.sh 未传 --domain 时会沿用 .env 已有 PUBLIC_ORIGIN，日常更新不会重置线上域名。

set -euo pipefail

REPO_DEFAULT="https://github.com/vtea/zhizhu.git"
BRANCH_DEFAULT="main"

REPO_URL=""
BRANCH=""
TARGET_DIR=""
FORCE=0
DEPLOY_ARGS=()

log()  { printf '\033[1;34m[update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[update]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[update]\033[0m %s\n' "$*" 1>&2; }

usage() {
  cat <<'USAGE'
用法：bash deploy/update.sh [选项] [-- deploy.sh 参数...]

  --repo <URL>        Git 仓库地址（默认 https://github.com/vtea/zhizhu.git；仅 clone 时用）
  --branch <NAME>     分支（默认 main）
  --dir <PATH>        仓库目录；目录内无仓库则 clone 到此处。
                      不传时：脚本位于 git 工作区内则用该工作区，否则 ./zhizhu
  --force             工作区有未提交改动时先 git stash 再更新；
                      且即使没有新提交也执行完整 build + 部署
  -h | --help         显示帮助

  -- 之后的参数透传给 deploy/deploy.sh，例如：
    bash deploy/update.sh -- --domain https://console.example.com --rebuild
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --dir) TARGET_DIR="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; DEPLOY_ARGS=("$@"); break ;;
    *) err "未知参数：$1（deploy.sh 参数请放在 -- 之后）"; usage; exit 2 ;;
  esac
done

REPO_URL="${REPO_URL:-${REPO_DEFAULT}}"
BRANCH="${BRANCH:-${BRANCH_DEFAULT}}"

if ! command -v git >/dev/null 2>&1; then
  err "未检测到 git，请先安装。"
  exit 1
fi

# ---- 1. 定位仓库目录 ----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${TARGET_DIR}" ]]; then
  if TOPLEVEL="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null)"; then
    TARGET_DIR="${TOPLEVEL}"
  else
    TARGET_DIR="$(pwd)/zhizhu"
  fi
fi

FIRST_CLONE=0
if [[ ! -d "${TARGET_DIR}/.git" ]]; then
  log "目录 ${TARGET_DIR} 无 git 仓库，clone ${REPO_URL}（分支 ${BRANCH}）"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${TARGET_DIR}"
  FIRST_CLONE=1
fi

cd "${TARGET_DIR}"
log "仓库目录：${TARGET_DIR}"

# ---- 2. 更新代码（git pull --ff-only）----------------------------------------
OLD_HEAD="$(git rev-parse HEAD)"

if [[ "${FIRST_CLONE}" -eq 0 ]]; then
  # gitignore 的文件（.env、node_modules 等）不会出现在 porcelain 输出中
  DIRTY="$(git status --porcelain)"
  if [[ -n "${DIRTY}" ]]; then
    if [[ "${FORCE}" -eq 1 ]]; then
      warn "工作区有未提交改动，--force 已指定，git stash 暂存："
      printf '%s\n' "${DIRTY}"
      git stash push --include-untracked -m "deploy/update.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else
      err "工作区有未提交改动，为避免丢失已中止："
      printf '%s\n' "${DIRTY}" 1>&2
      err "请先 commit / stash，或使用 --force（自动 git stash 后继续）。"
      exit 1
    fi
  fi

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "${CURRENT_BRANCH}" != "${BRANCH}" ]]; then
    log "当前分支 ${CURRENT_BRANCH}，切换到 ${BRANCH}"
    git fetch origin "${BRANCH}"
    git checkout "${BRANCH}"
  fi

  log "git pull --ff-only origin ${BRANCH}"
  if ! git pull --ff-only origin "${BRANCH}"; then
    err "git pull --ff-only 失败：本地存在远端没有的提交（历史分叉）。"
    err "请人工处理（如 git rebase origin/${BRANCH} 或备份后 git reset --hard origin/${BRANCH}），脚本不做破坏性操作。"
    exit 1
  fi
fi

NEW_HEAD="$(git rev-parse HEAD)"

# ---- 3. 部署 ------------------------------------------------------------------
run_deploy() {
  bash "${TARGET_DIR}/deploy/deploy.sh" ${DEPLOY_ARGS[@]+"${DEPLOY_ARGS[@]}"} "$@"
}

if [[ "${FIRST_CLONE}" -eq 1 ]]; then
  log "首次部署（HEAD：$(git rev-parse --short HEAD)）"
  run_deploy
elif [[ "${OLD_HEAD}" != "${NEW_HEAD}" ]]; then
  log "代码已更新，本次包含提交："
  git log --oneline "${OLD_HEAD}..${NEW_HEAD}"
  log "重建镜像并部署（compose build 会因代码变化自动重建相应层）"
  run_deploy
elif [[ "${FORCE}" -eq 1 ]]; then
  log "已是最新（$(git rev-parse --short HEAD)），--force 指定，仍执行完整 build + 部署"
  run_deploy
else
  log "已是最新（$(git rev-parse --short HEAD)），跳过 build，仅确保服务在跑"
  run_deploy --skip-build
fi
