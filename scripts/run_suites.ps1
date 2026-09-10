<#
.SYNOPSIS
  Run every SQL suite in tests/ against a virgin copy of a built database.

.DESCRIPTION
  Windows twin of scripts/run_suites.sh. Each suite gets its own copy of the
  template database so no suite can contaminate the next. Fails if any suite
  that prints a pass|fail summary reports a failure. Suites that print no
  summary (003, 006-010, 012 -- console fixtures or era-specific) are shown as
  NO RESULT and do not fail the run.

.EXAMPLE
  pwsh -File scripts/setup_db.ps1 -Db mm
  pwsh -File scripts/run_suites.ps1 -Template mm
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Template,
    [int]    $Port  = 55433,
    [string] $PgBin = $env:PGBIN,
    [string] $Only            # optional substring filter, e.g. '03'
)
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$psql = if ($PgBin) { Join-Path $PgBin 'psql.exe' } else { 'psql' }
$H = @('-h', '127.0.0.1', '-p', "$Port", '-U', 'postgres')

$rows = @(); $pass = 0; $fail = 0; $noresult = 0
foreach ($f in Get-ChildItem (Join-Path $repo 'tests') -File -Filter '0*.sql' | Sort-Object Name) {
    if ($f.Name -eq '0000_local_supabase_shim.sql') { continue }
    if ($Only -and $f.Name -notlike "*$Only*") { continue }
    & $psql @H -d postgres -q -c "drop database if exists suite_run;" -c "create database suite_run template $Template;" | Out-Null
    # ALTER DATABASE ... SET is not copied by CREATE DATABASE ... TEMPLATE, so every copy must re-assert the fresh-install flag
    & $psql @H -d postgres -q -c "alter database suite_run set mm.fresh_install = 'on';" | Out-Null
    $out = & $psql @H -d suite_run -f $f.FullName 2>&1 | Out-String
    # Under StrictMode, indexing an EMPTY array with [-1] throws, and the failed
    # assignment left $line holding the PREVIOUS suite's summary -- so a suite
    # that printed nothing was reported with its predecessor's numbers. Count first.
    $matches_ = @($out -split "`r?`n" | Where-Object { $_ -match '^ +\d+ \| +\d+( \| +\d+)? *$' })
    $line = if ($matches_.Count) { $matches_[-1] } else { $null }
    if (-not $line) { $rows += [pscustomobject]@{ Suite = $f.Name; Pass = ''; Fail = ''; Note = 'NO RESULT' }; $noresult++; continue }
    $parts = ($line -split '\|') | ForEach-Object { $_.Trim() }
    $p = [int]$parts[0]; $fl = [int]$parts[1]
    $pass += $p; $fail += $fl
    $rows += [pscustomobject]@{ Suite = $f.Name; Pass = $p; Fail = $fl; Note = $(if ($fl) { 'FAIL' } else { '' }) }
}
$rows | Format-Table -AutoSize | Out-String -Width 120 | Write-Host
Write-Host ("suites={0}  pass={1}  fail={2}  no-result={3}" -f ($rows.Count - $noresult), $pass, $fail, $noresult) `
    -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit ([int]($fail -gt 0))
