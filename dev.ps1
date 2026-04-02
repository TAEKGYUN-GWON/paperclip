#Requires -Version 5.1
<#
.SYNOPSIS
    Paperclip 개발 서버 퀵스타트
    PostgreSQL 좀비 프로세스 / 공유 메모리 / 포트 점유를 모두 정리한 뒤 pnpm dev를 실행합니다.
#>

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Paperclip Dev"

$DB_DIR  = "$env:USERPROFILE\.paperclip\instances\default\db"
$PG_CTL  = "$PSScriptRoot\node_modules\.pnpm\@embedded-postgres+windows-x64@18.1.0-beta.16\node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe"
$PORTS   = @(54329, 54330)

function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)       { Write-Host "    > $msg" -ForegroundColor Green }
function Write-Warn($msg)     { Write-Host "    > $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== Paperclip Dev Launcher ===" -ForegroundColor Magenta
Write-Host ""

# ──────────────────────────────────────────────────────────
# 1. pg_ctl stop (정상 종료 — shared memory까지 정리됨)
# ──────────────────────────────────────────────────────────
Write-Step "1/4" "pg_ctl stop (graceful shutdown)..."

if ((Test-Path "$DB_DIR\postmaster.pid") -and (Test-Path $PG_CTL)) {
    Write-Warn "postmaster.pid 발견 — pg_ctl stop 실행 중..."
    & $PG_CTL stop -D $DB_DIR -m fast 2>&1 | ForEach-Object { Write-Host "    $_" }
    Start-Sleep -Seconds 3
    Write-Ok "완료"
} else {
    Write-Ok "postmaster.pid 없음 — 건너뜀"
}

# ──────────────────────────────────────────────────────────
# 2. postgres.exe 강제 종료
# ──────────────────────────────────────────────────────────
Write-Step "2/4" "postgres.exe 프로세스 종료..."

$pgProcs = Get-Process -Name "postgres" -ErrorAction SilentlyContinue
if ($pgProcs) {
    $pgProcs | ForEach-Object {
        Write-Warn "postgres.exe (PID $($_.Id)) 종료..."
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Write-Ok "완료"
} else {
    Write-Ok "실행 중인 postgres.exe 없음"
}

# ──────────────────────────────────────────────────────────
# 3. 포트 점유 프로세스 종료 (54329, 54330)
# ──────────────────────────────────────────────────────────
Write-Step "3/4" "포트 $($PORTS -join ', ') 해제..."

foreach ($port in $PORTS) {
    $conn = netstat -ano 2>$null |
        Select-String ":$port\s" |
        ForEach-Object { ($_ -split '\s+')[-1] } |
        Where-Object { $_ -match '^\d+$' } |
        Select-Object -Unique

    foreach ($pid in $conn) {
        if ($pid -and $pid -ne "0") {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Warn "포트 $port 점유: $($proc.Name) (PID $pid) 종료..."
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
Write-Ok "완료"

# ──────────────────────────────────────────────────────────
# 4. postmaster.pid 정리
# ──────────────────────────────────────────────────────────
Write-Step "4/4" "postmaster.pid 정리..."

if (Test-Path "$DB_DIR\postmaster.pid") {
    Remove-Item "$DB_DIR\postmaster.pid" -Force
    Write-Ok "삭제 완료"
} else {
    Write-Ok "없음 — 건너뜀"
}

# ──────────────────────────────────────────────────────────
# pnpm dev 실행
# ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host " pnpm dev 시작" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host ""

Set-Location $PSScriptRoot

try {
    pnpm dev
} catch {
    Write-Host "`n[오류] pnpm dev 실패: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "pnpm dev가 종료됐습니다." -ForegroundColor Yellow
Read-Host "Enter를 누르면 창이 닫힙니다"
