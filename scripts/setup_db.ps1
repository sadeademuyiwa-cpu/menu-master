<#
.SYNOPSIS
  Build a Menu Master NG database from the repository alone, on Windows.

.DESCRIPTION
  Applies the local Supabase shim, the LOCAL-ONLY test fixtures, then every
  migration in order, into a fresh database on a local PostgreSQL server. Each
  file runs under --single-transaction, exactly as production is migrated; 0049
  onward refuses any other executor. Nothing outside this repository is needed:
  the production-specific preflights in 0019c-0030 are skipped under
  mm.fresh_install = on, and every self-check still runs.

  Records the last applied number as the database setting mm.migration_level,
  which run_suites reads to honour tests/MANIFEST.

  This is the Windows twin of scripts/setup_db.sh. Both apply the same files in
  the same order; if they ever disagree, the chain is wrong, not the script.

.PARAMETER Database      database name to (re)create
.PARAMETER UpTo          last migration number to apply, e.g. '0025' (default: all)
.PARAMETER WithProposed  after migrations/, also apply migrations/proposed/*.sql
.PARAMETER Port          PostgreSQL port (default 55433)
.PARAMETER PgBin         directory holding psql.exe (default: PGBIN env, then PATH)

.EXAMPLE
  pwsh -File scripts/setup_db.ps1 -Database mm
  pwsh -File scripts/setup_db.ps1 -Database mm52 -WithProposed
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Database,
    [string] $UpTo = '9999',
    [switch] $WithProposed,
    [int]    $Port = 55433,
    [string] $PgBin = $env:PGBIN
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$psql = if ($PgBin) { Join-Path $PgBin 'psql.exe' } else { 'psql' }
$H = @('-h', '127.0.0.1', '-p', "$Port", '-U', 'postgres')

function Run-Sql {
    param([string] $Db, [string] $File)
    $out = & $psql @H -d $Db -v ON_ERROR_STOP=1 --single-transaction -q -f $File 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $out -cmatch '(?m)^(psql:.*)?ERROR:') {
        Write-Host "FAIL $(Split-Path $File -Leaf)" -ForegroundColor Red
        ($out -split "`r?`n" | Where-Object { $_ -cmatch 'ERROR|DETAIL|HINT' } | Select-Object -First 8) | ForEach-Object { Write-Host "  $_" }
        exit 1
    }
}

& $psql @H -d postgres -q -c "drop database if exists $Database;" -c "create database $Database;" | Out-Null
Run-Sql $Database (Join-Path $repo 'tests\0000_local_supabase_shim.sql')
# local-only fixtures: the auth users the boundary suites resolve by email
foreach ($fx in Get-ChildItem (Join-Path $repo 'tests\fixtures') -File -Filter '*.sql' -ErrorAction SilentlyContinue | Sort-Object Name) {
    Run-Sql $Database $fx.FullName
}
& $psql @H -d $Database -q -c "alter database $Database set mm.fresh_install = 'on';" | Out-Null

$applied = 0; $last = '0000'
$files = @(Get-ChildItem (Join-Path $repo 'migrations') -File -Filter '0*.sql' | Sort-Object Name)
if ($WithProposed) {
    $files += @(Get-ChildItem (Join-Path $repo 'migrations\proposed') -File -Filter '0*.sql' -ErrorAction SilentlyContinue | Sort-Object Name)
}
foreach ($f in $files) {
    $num = ($f.Name -split '_')[0] -replace '[a-z]$', ''
    if ($num -gt $UpTo) { break }
    Run-Sql $Database $f.FullName
    $applied++; $last = $num
}
& $psql @H -d $Database -q -c "alter database $Database set mm.migration_level = '$last';" | Out-Null
Write-Host "OK: $applied migration(s) applied to $Database (fresh install, level $last$(if ($WithProposed) { ', proposed included' }))"
