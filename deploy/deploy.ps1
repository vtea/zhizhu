<#
.SYNOPSIS
  知竹 - 线上一键部署脚本（Windows PowerShell；Docker Compose）。

.DESCRIPTION
  与 deploy/deploy.sh 等价的 PowerShell 版本，适合在 Windows 主机（Docker Desktop）测试或部署。
  行为：
    1. 检查 docker / docker compose 可用性
    2. 若仓库根缺 .env，自动生成；已有则只补缺失键（不覆盖已配置值）
    3. 强随机生成 JWT_SECRET / DEVICE_TOKEN_SECRET（仅在缺失时）
    4. 按 -Domain 设置 PUBLIC_ORIGIN / CORS_ORIGIN / CONSOLE_WEB_PUBLIC_URL；
       未传 -Domain 时沿用 .env 已有 PUBLIC_ORIGIN（都没有才用 http://localhost:8080）
    5. docker compose build && docker compose up -d
    6. 等待 /health 通过，打印访问地址与初始账号

.PARAMETER Domain
  浏览器访问控制台的根地址，例如 https://console.example.com。
  不传时沿用 .env 已有 PUBLIC_ORIGIN，再缺省为 http://localhost:8080。

.PARAMETER Port
  Web 容器映射到宿主机的端口。不传时沿用 .env 已有 WEB_HOST_PORT，再缺省 8080。

.PARAMETER Rebuild
  强制重新 build 镜像（修改 PUBLIC_ORIGIN 后通常需要）。

.PARAMETER OpenRegister
  开放自助注册（CONSOLE_ALLOW_PUBLIC_REGISTER=true）。

.PARAMETER SkipBuild
  仅 up -d，不执行 build（适合二次启动）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1
  powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1 -Domain https://console.example.com -Rebuild
#>

[CmdletBinding()]
param(
  # 不传时沿用 .env 已有 PUBLIC_ORIGIN / WEB_HOST_PORT，再缺省 http://localhost:8080 / 8080
  [string]$Domain = "",
  [string]$Port = "",
  [switch]$Rebuild,
  [switch]$OpenRegister,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param([string]$Message)
  Write-Host "[deploy] $Message" -ForegroundColor Cyan
}
function Write-Warn {
  param([string]$Message)
  Write-Host "[deploy] $Message" -ForegroundColor Yellow
}
function Write-Err {
  param([string]$Message)
  Write-Host "[deploy] $Message" -ForegroundColor Red
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir
$EnvFile = Join-Path $RootDir ".env"

# ---- 1. 依赖检查 -------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Err "未检测到 docker。请先安装 Docker Desktop / Engine 24+。"
  exit 1
}
# 外部命令失败不会触发 catch，须检查 $LASTEXITCODE
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Err "未检测到 docker compose（V2）。"
  exit 1
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Err "docker daemon 不可访问。请确认 Docker Desktop 已启动。"
  exit 1
}
Write-Log "docker / compose 检测通过"

# ---- 2. 准备 .env ------------------------------------------------------------
function Get-EnvValue {
  param([string]$Key)
  if (-not (Test-Path $EnvFile)) { return "" }
  $line = Select-String -Path $EnvFile -Pattern "^$([Regex]::Escape($Key))=" |
    Select-Object -First 1
  if ($null -eq $line) { return "" }
  return $line.Line.Substring($Key.Length + 1)
}

function Set-EnvIfMissing {
  param([string]$Key, [string]$Value)
  $existing = Get-EnvValue -Key $Key
  if ([string]::IsNullOrEmpty($existing)) {
    Add-Content -Path $EnvFile -Value ("{0}={1}" -f $Key, $Value)
    Write-Log "  + $Key=（已写入）"
  }
}

function Set-EnvForce {
  param([string]$Key, [string]$Value)
  if (Test-Path $EnvFile) {
    $content = Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue
    if ($null -eq $content) { $content = "" }
    $pattern = "(?m)^$([Regex]::Escape($Key))=.*$"
    if ([Regex]::IsMatch($content, $pattern)) {
      $newContent = [Regex]::Replace($content, $pattern, ("{0}={1}" -f $Key, $Value))
      Set-Content -Path $EnvFile -Value $newContent -NoNewline
    } else {
      if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
        Add-Content -Path $EnvFile -Value ""
      }
      Add-Content -Path $EnvFile -Value ("{0}={1}" -f $Key, $Value)
    }
  } else {
    Set-Content -Path $EnvFile -Value ("{0}={1}" -f $Key, $Value)
  }
  Write-Log "  * $Key=$Value"
}

function New-RandomHex {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

if (-not (Test-Path $EnvFile)) {
  Write-Log "未发现根目录 .env，将基于 .env.example 创建"
  $header = "# 由 deploy/deploy.ps1 生成于 {0}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
  Set-Content -Path $EnvFile -Value $header
}

# 未显式传 -Domain / -Port 时沿用 .env 已有配置（避免日常更新重置线上域名）
if ([string]::IsNullOrEmpty($Domain)) {
  $Domain = Get-EnvValue -Key "PUBLIC_ORIGIN"
  if (-not [string]::IsNullOrEmpty($Domain)) {
    Write-Log "未传 -Domain，沿用 .env 中 PUBLIC_ORIGIN=$Domain"
  }
}
if ([string]::IsNullOrEmpty($Domain)) { $Domain = "http://localhost:8080" }
if ([string]::IsNullOrEmpty($Port)) { $Port = Get-EnvValue -Key "WEB_HOST_PORT" }
if ([string]::IsNullOrEmpty($Port)) { $Port = "8080" }

$pgHost = Get-EnvValue -Key "PGHOST"
$dbUrl = Get-EnvValue -Key "DATABASE_URL"
if ([string]::IsNullOrEmpty($pgHost) -and [string]::IsNullOrEmpty($dbUrl)) {
  Set-EnvIfMissing -Key "DATABASE_URL" -Value "postgresql://zhizhu:zhizhu@postgres:5432/zhizhu"
}

$jwt = Get-EnvValue -Key "JWT_SECRET"
if ([string]::IsNullOrEmpty($jwt)) {
  Add-Content -Path $EnvFile -Value ("JWT_SECRET={0}" -f (New-RandomHex))
  Write-Log "  + JWT_SECRET=（已生成强随机）"
}
$dev = Get-EnvValue -Key "DEVICE_TOKEN_SECRET"
if ([string]::IsNullOrEmpty($dev)) {
  Add-Content -Path $EnvFile -Value ("DEVICE_TOKEN_SECRET={0}" -f (New-RandomHex))
  Write-Log "  + DEVICE_TOKEN_SECRET=（已生成强随机）"
}

Set-EnvForce -Key "PUBLIC_ORIGIN" -Value $Domain
Set-EnvForce -Key "WEB_HOST_PORT" -Value $Port
Set-EnvForce -Key "CORS_STRICT" -Value "1"
Set-EnvForce -Key "CORS_ORIGIN" -Value $Domain
Set-EnvForce -Key "CONSOLE_WEB_PUBLIC_URL" -Value $Domain

# 自助注册：-OpenRegister 时开放；未传参时沿用 .env 已有值（首次默认关闭）
if ($OpenRegister.IsPresent) {
  $RegisterValue = "true"
} else {
  $RegisterValue = Get-EnvValue -Key "CONSOLE_ALLOW_PUBLIC_REGISTER"
  if ($RegisterValue -ne "true") { $RegisterValue = "false" }
}
Set-EnvForce -Key "CONSOLE_ALLOW_PUBLIC_REGISTER" -Value $RegisterValue
Set-EnvForce -Key "VITE_CONSOLE_PUBLIC_REGISTER" -Value $RegisterValue

Write-Log "已写入 .env（敏感值不在终端回显）"

# ---- 3. 构建并启动 -----------------------------------------------------------
if (-not $SkipBuild.IsPresent) {
  if ($Rebuild.IsPresent) {
    Write-Log "重新构建镜像（-Rebuild）"
    & docker compose build --no-cache
    if ($LASTEXITCODE -ne 0) { throw "docker compose build 失败" }
  } else {
    Write-Log "构建镜像（如已有缓存会快速复用）"
    & docker compose build
    if ($LASTEXITCODE -ne 0) { throw "docker compose build 失败" }
  }
}

# 是否使用 compose 内置 Postgres：重新读取 .env（上面可能刚写入默认连接串），
# 看连接串是否指向内置服务主机名 postgres；不能用「写入前的 $dbUrl 是否为空」判定，
# 否则首次写入后或二次运行时会漏加 --profile bundled-db，内置库不会启动。
$pgHostNow = Get-EnvValue -Key "PGHOST"
$dbUrlNow = Get-EnvValue -Key "DATABASE_URL"
$useBundledDb = ($pgHostNow -eq "postgres") -or ($dbUrlNow -match "@postgres[:/]")
$composeArgs = @("compose", "up", "-d")
if ($useBundledDb) {
  $composeArgs = @("compose", "--profile", "bundled-db", "up", "-d")
}
Write-Log "启动服务（docker $($composeArgs -join ' ')）"
& docker @composeArgs
if ($LASTEXITCODE -ne 0) { throw "docker compose up -d 失败" }

# ---- 4. 等待 /health ---------------------------------------------------------
$HealthUrl = "http://127.0.0.1:${Port}/health"
Write-Log "等待健康检查通过：$HealthUrl"

$Attempts = 60
$SleepSec = 2
$ok = $false
for ($i = 1; $i -le $Attempts; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($resp.StatusCode -eq 200) { $ok = $true; break }
  } catch {
    # 等待中
  }
  if (($i % 5) -eq 0) {
    Write-Log "  ...仍在等待（$i/$Attempts）"
  }
  Start-Sleep -Seconds $SleepSec
}

Write-Host ""
if ($ok) {
  Write-Log "部署完成"
} else {
  Write-Warn ("在 {0}s 内未观察到 /health 200；服务可能仍在拉起或迁移中。" -f ($Attempts * $SleepSec))
  Write-Warn "可通过 docker compose logs -f api 查看日志，或 docker compose ps 查看状态。"
}

$registerNote = if ($RegisterValue -eq "true") { "已开放" } else { "已关闭（仅平台/租户管理员可创建）" }

@"

================ 知竹 · 部署摘要 ================
  控制台访问：       $Domain
  健康检查：         $($Domain.TrimEnd('/'))/health  （宿主机本地：$HealthUrl）
  Web 容器宿主端口： $Port
  自助注册：         $registerNote

  初始账号（首次启动迁移种子写入）：
    租户：demo         用户名：admin           密码：A123456
    平台管理员：zhizhuplatform / platform-admin / A123456

  常用命令：
    查看状态：   docker compose ps
    查看日志：   docker compose logs -f api
    停止服务：   docker compose stop
    彻底清理：   docker compose down -v   （注意：会清空内置 Postgres 数据卷）

  改外网域名后须重新构建 web 镜像（VITE_* 为构建期变量）：
    powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1 -Domain https://your.domain -Rebuild

  详细见 docs/部署指南.md
=================================================
"@ | Write-Host
