# Copies the data of the local installation (docker compose on this PC) to the Raspberry Pi.
#   .\scripts\migrate-to-pi.ps1
# Run it once, after the first deploy and BEFORE anyone signs in on the Pi: the Pi refuses the
# restore when its database already has accounts. Nothing is deleted locally.
# What travels: accounts, profiles, weigh-ins, food diary, diets, notification settings.
# What does not: the Web Push keys and device subscriptions (they belong to each installation;
# enable notifications again on the new address).
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$dir = Join-Path (Get-Location) 'backups'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
$file = Join-Path $dir ("migrate-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".sql")

# cmd keeps the bytes as they are (Windows PowerShell re-encodes native output)
cmd /c "docker compose exec -T db pg_dump -U diet --data-only --exclude-table=app_settings --exclude-table=push_subscriptions --exclude-table=notifications diet > `"$file`""
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed: is the local installation running? (docker compose up -d)' }
Write-Host ">> local data written to $file"

cmd /c "ssh diet-pi restore < `"$file`""
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Data copied to the Pi.' -ForegroundColor Green
} else {
  Write-Host "Restore FAILED (exit $LASTEXITCODE). The local data is untouched; the dump is in $file" -ForegroundColor Red
}
exit $LASTEXITCODE
