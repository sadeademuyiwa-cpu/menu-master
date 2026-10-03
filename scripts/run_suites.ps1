<#
.SYNOPSIS
  Run every SQL suite in tests/ the way tests/MANIFEST says it must be run.

.DESCRIPTION
  Windows twin of scripts/run_suites.sh. Per suite:
    default        a virgin copy of the head database
    era=NNNN       a database built only up to NNNN, cached as <head>_era_NNNN
    requires=NNNN  skipped with a reason if the head database is below NNNN
    seq=NAME       members share ONE copy, in file order
    rows           FAIL rows count even without a summary row
    skip=REASON    never run
  Fails if any suite reports a failure.

.EXAMPLE
  pwsh -File scripts/setup_db.ps1 -Database mm
  pwsh -File scripts/run_suites.ps1 -Template mm
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Template,   # the head database
    [int]    $Port  = 55433,
    [string] $PgBin = $env:PGBIN,
    [string] $Only                                # optional substring filter
)
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$psql = if ($PgBin) { Join-Path $PgBin 'psql.exe' } else { 'psql' }
$H = @('-h', '127.0.0.1', '-p', "$Port", '-U', 'postgres')

$level = (& $psql @H -d $Template -tAc "select current_setting('mm.migration_level', true)" 2>&1 | Out-String).Trim()
if (-not $level) { Write-Host "the head database records no mm.migration_level; build it with setup_db.ps1" -ForegroundColor Red; exit 2 }

# ---- manifest -------------------------------------------------------------
$manifest = @{}
foreach ($line in Get-Content (Join-Path $repo 'tests\MANIFEST')) {
    if ($line -match '^\s*(#|$)') { continue }
    $parts = $line -split '\s+', 2
    $entry = @{}
    if ($parts.Count -gt 1) {
        foreach ($tok in ($parts[1] -split '\s+(?=\w+=|rows\b)')) {
            if ($tok -match '^(\w+)=(.*)$') { $entry[$Matches[1]] = $Matches[2] }
            elseif ($tok -eq 'rows') { $entry['rows'] = $true }
        }
    }
    $manifest[$parts[0]] = $entry
}

function Fresh-Copy([string]$name, [string]$tpl) {
    & $psql @H -d postgres -q -c "drop database if exists $name;" -c "create database $name template $tpl;" | Out-Null
    # ALTER DATABASE ... SET is not copied by CREATE DATABASE ... TEMPLATE
    & $psql @H -d postgres -q -c "alter database $name set mm.fresh_install = 'on';" | Out-Null
}
# The last number in migrations/. An era beyond it can only be built through
# migrations/proposed/, which is exactly the case for the acceptance suite of
# a migration that has not shipped yet (requires=NNNN keeps it out of the
# head-only run; era=NNNN runs it at its own moment in the proposed run).
$lastApplied = ((Get-ChildItem (Join-Path $repo 'migrations') -File -Filter '0*.sql' | Sort-Object Name | Select-Object -Last 1).Name -split '_')[0] -replace '[a-z]$', ''
function Era-Db([string]$era) {
    $name = "${Template}_era_$era"
    $exists = (& $psql @H -d postgres -tAc "select 1 from pg_database where datname='$name'" | Out-String).Trim()
    if ($exists -ne '1') {
        $extra = @(); if ($era -gt $lastApplied) { $extra = @('-WithProposed') }
        & pwsh -NoProfile -File (Join-Path $repo 'scripts\setup_db.ps1') -Database $name -UpTo $era -Port $Port -PgBin $PgBin @extra | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "could not build era database $name" -ForegroundColor Red; exit 2 }
    }
    $name
}
function Run-One([string]$suite, [string]$db, [bool]$rows) {
    $out = & $psql @H -d $db -f (Join-Path $repo "tests\$suite") 2>&1 | Out-String
    $m = @($out -split "`r?`n" | Where-Object { $_ -match '^ +\d+ \| +\d+( \| +\d+)? *$' })
    if ($m.Count) {
        $p = ($m[-1] -split '\|') | ForEach-Object { $_.Trim() }
        return @([int]$p[0], [int]$p[1])
    }
    if ($rows) {
        $ok = @($out -split "`r?`n" | Where-Object { $_ -match '\|\s*(PASS|OK)\s*(\||$)' }).Count
        $ko = @($out -split "`r?`n" | Where-Object { $_ -match '\|\s*(FAIL|WRONG)\s*(\||$)' }).Count
        return @($ok, $ko)
    }
    return $null
}

$table = @(); $pass = 0; $fail = 0; $noresult = 0; $skipped = 0; $seqDb = @{}
foreach ($f in Get-ChildItem (Join-Path $repo 'tests') -File -Filter '0*.sql' | Sort-Object Name) {
    $s = $f.Name
    if ($s -eq '0000_local_supabase_shim.sql') { continue }
    if ($Only -and $s -notlike "*$Only*") { continue }
    $e = if ($manifest.ContainsKey($s)) { $manifest[$s] } else { @{} }

    if ($e.ContainsKey('skip')) { $table += [pscustomobject]@{ Suite=$s; Db='-'; Pass=''; Fail=''; Note="SKIP  $($e.skip)" }; $skipped++; continue }
    if ($e.ContainsKey('requires') -and $level -lt $e.requires) {
        $table += [pscustomobject]@{ Suite=$s; Db='-'; Pass=''; Fail=''; Note="SKIP  requires $($e.requires), head is $level" }; $skipped++; continue }

    $tpl = $Template; $label = 'head'
    if ($e.ContainsKey('era')) { $tpl = Era-Db $e.era; $label = "era $($e.era)" }
    if ($e.ContainsKey('seq')) {
        $db = "suite_seq_$($e.seq)"
        if (-not $seqDb.ContainsKey($e.seq)) { Fresh-Copy $db $tpl; $seqDb[$e.seq] = $true }
    } else { $db = 'suite_run'; Fresh-Copy $db $tpl }

    $r = Run-One $s $db ([bool]$e.ContainsKey('rows'))
    if ($null -eq $r) { $table += [pscustomobject]@{ Suite=$s; Db=$label; Pass=''; Fail=''; Note='NO RESULT' }; $noresult++; continue }
    $pass += $r[0]; $fail += $r[1]
    $table += [pscustomobject]@{ Suite=$s; Db=$label; Pass=$r[0]; Fail=$r[1]; Note=$(if ($r[1]) { 'FAIL' } else { '' }) }
}
$table | Format-Table -AutoSize | Out-String -Width 140 | Write-Host
$suites = $table.Count - $noresult - $skipped
Write-Host ("head level {0}  suites={1}  pass={2}  fail={3}  no-result={4}  skipped={5}" -f $level, $suites, $pass, $fail, $noresult, $skipped) `
    -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit ([int]($fail -gt 0))
