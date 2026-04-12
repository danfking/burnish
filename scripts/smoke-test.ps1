# scripts/smoke-test.ps1
#
# Windows PowerShell equivalent of scripts/smoke-test.sh.
#
# Clean-machine smoke test for the PUBLISHED `burnish` npm package.
# This is a PRE-RELEASE verification gate (see #386) — not a per-PR check.
#
# Run manually:
#   pwsh -File scripts/smoke-test.ps1
#
# Requires: Node >= 20, npm, curl (built into Windows 10+).

$ErrorActionPreference = 'Continue'

$Pkg   = if ($env:BURNISH_SMOKE_PKG) { $env:BURNISH_SMOKE_PKG } else { 'burnish@latest' }
$Port  = if ($env:BURNISH_SMOKE_PORT) { $env:BURNISH_SMOKE_PORT } else { '34567' }
$Url   = "http://localhost:$Port"

$env:BURNISH_TELEMETRY = '0'
$env:CI = '1'
$env:BURNISH_SKIP_OPEN = '1'

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("burnish-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $TmpDir | Out-Null
$LogHelp = Join-Path $TmpDir 'help.log'
$LogRun  = Join-Path $TmpDir 'run.log'
$BodyFile = Join-Path $TmpDir 'body.html'

$Failed = 0
function Pass($msg) { Write-Host "  PASS: $msg" }
function Fail($msg) { Write-Host "  FAIL: $msg"; $script:Failed = 1 }

Write-Host "=============================================="
Write-Host "Burnish clean-machine smoke test"
Write-Host "  package: $Pkg"
Write-Host "  tmpdir:  $TmpDir"
Write-Host "  port:    $Port"
Write-Host "=============================================="

Push-Location $TmpDir
$burnishProc = $null
try {
    # Step 1: --help
    Write-Host "`nStep 1: npx $Pkg --help"
    $helpProc = Start-Process -FilePath 'npx' -ArgumentList @('-y', $Pkg, '--help') `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $LogHelp -RedirectStandardError "$LogHelp.err"
    Get-Content "$LogHelp.err" -ErrorAction SilentlyContinue | Add-Content $LogHelp
    if ($helpProc.ExitCode -eq 0) {
        $helpContent = Get-Content $LogHelp -Raw
        if ($helpContent -match '(?i)burnish' -and $helpContent -match '(?i)usage') {
            Pass '--help exited 0 and printed a help banner'
        } else {
            Fail '--help exited 0 but output did not look like a help banner'
            Get-Content $LogHelp | ForEach-Object { "    | $_" } | Write-Host
        }
    } else {
        Fail "--help exited $($helpProc.ExitCode)"
        Get-Content $LogHelp | ForEach-Object { "    | $_" } | Write-Host
    }

    # Step 2: boot and curl
    Write-Host "`nStep 2: npx $Pkg --no-open --port $Port -- npx -y @modelcontextprotocol/server-everything"
    $burnishProc = Start-Process -FilePath 'npx' `
        -ArgumentList @('-y', $Pkg, '--no-open', '--port', $Port, '--',
                        'npx', '-y', '@modelcontextprotocol/server-everything') `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $LogRun -RedirectStandardError "$LogRun.err"

    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        if ($burnishProc.HasExited) { break }
        $combined = ''
        if (Test-Path $LogRun)      { $combined += (Get-Content $LogRun -Raw -ErrorAction SilentlyContinue) }
        if (Test-Path "$LogRun.err"){ $combined += (Get-Content "$LogRun.err" -Raw -ErrorAction SilentlyContinue) }
        if ($combined -and $combined.Contains("http://localhost:$Port")) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }

    if ($ready) {
        Pass "CLI advertised $Url on stdout"
        Start-Sleep -Seconds 2
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
            if ($response.StatusCode -eq 200) {
                Pass "GET $Url returned 200"
                $body = $response.Content
                $body | Out-File $BodyFile
                if ($body -match '(?i)burnish' -or $body -match '<script') {
                    Pass 'response body contains expected HTML substring'
                } else {
                    Fail "response body did not contain 'burnish' or '<script'"
                }
            } else {
                Fail "GET $Url returned HTTP $($response.StatusCode)"
            }
        } catch {
            Fail "GET $Url failed: $($_.Exception.Message)"
        }
    } else {
        Fail "CLI did not advertise $Url within 90s"
        if (Test-Path $LogRun)       { Get-Content $LogRun       | ForEach-Object { "    | $_" } | Write-Host }
        if (Test-Path "$LogRun.err") { Get-Content "$LogRun.err" | ForEach-Object { "    | $_" } | Write-Host }
    }
}
finally {
    if ($burnishProc -and -not $burnishProc.HasExited) {
        Stop-Process -Id $burnishProc.Id -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}

Write-Host "`n=============================================="
if ($Failed -eq 0) {
    Write-Host 'Smoke test: PASS'
    exit 0
} else {
    Write-Host 'Smoke test: FAIL'
    exit 1
}
