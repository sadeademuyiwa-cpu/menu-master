# =============================================================================
# Tests for the pure logic in PaystackOps.psm1. No network, no CLI, no secret.
#   pwsh -NoProfile -File scripts/ops/PaystackOps.Tests.ps1
#
# The plan matcher is what these mostly exercise, because the two N7,500 plans
# were transposed by hand twice and a wrong map sells the wrong product at the
# right price -- which nothing downstream can detect.
# =============================================================================
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'PaystackOps.psm1') -Force

$script:pass = 0; $script:fail = 0
function It {
    param([string]$Name, [scriptblock]$Body)
    try {
        & $Body
        $script:pass++; Write-Host ('  PASS  ' + $Name) -ForegroundColor Green
    } catch {
        $script:fail++; Write-Host ('  FAIL  ' + $Name) -ForegroundColor Red
        Write-Host ('        ' + $_.Exception.Message) -ForegroundColor DarkGray
    }
}
function Expect { param($Actual, $Expected, $What = 'value')
    if ("$Actual" -ne "$Expected") { throw "$What was '$Actual', expected '$Expected'" } }
function ExpectMatch { param([string]$Actual, [string]$Pattern)
    if ($Actual -notmatch $Pattern) { throw "'$Actual' did not match /$Pattern/" } }

function Plan { param($n, $c, $a, $i = 'monthly')
    [pscustomobject]@{ name = $n; plan_code = $c; amount = $a; interval = $i } }

$good = @(
    Plan 'Costing'                  'PLN_costing'  750000
    Plan 'Costing + Sales'          'PLN_trading'  1500000
    Plan 'Founding Costing'         'PLN_fcost'    350000
    Plan 'Founding Costing + Sales' 'PLN_ftrade'   750000
)

Write-Host "`nResolve-PaystackPlanMap`n"

It 'maps all four when Paystack is set up correctly' {
    $r = Resolve-PaystackPlanMap -RemotePlans $good
    Expect $r.Ok $true 'Ok'
    Expect $r.Map['costing'].Code          'PLN_costing'
    Expect $r.Map['trading'].Code          'PLN_trading'
    Expect $r.Map['founding_costing'].Code 'PLN_fcost'
    Expect $r.Map['founding_trading'].Code 'PLN_ftrade'
}

It 'separates the two N7,500 plans by name, not by order' {
    # reversed order must give the identical answer
    $r = Resolve-PaystackPlanMap -RemotePlans ($good[3], $good[0], $good[2], $good[1])
    Expect $r.Ok $true 'Ok'
    Expect $r.Map['costing'].Code          'PLN_costing'
    Expect $r.Map['founding_trading'].Code 'PLN_ftrade'
}

It 'REFUSES when both N7,500 plans say Founding' {
    $bad = @(
        Plan 'Founding Costing'         'PLN_a' 750000
        Plan 'Founding Costing + Sales' 'PLN_b' 750000
        Plan 'Costing + Sales'          'PLN_trading' 1500000
        Plan 'Founding Costing'         'PLN_fcost'   350000
    )
    $r = Resolve-PaystackPlanMap -RemotePlans $bad
    Expect $r.Ok $false 'Ok'
    ExpectMatch ($r.Problems -join ' ') 'matches more than one plan|no monthly Paystack plan'
}

It 'REFUSES when neither N7,500 plan says Founding' {
    $bad = @(
        Plan 'Costing'         'PLN_a' 750000
        Plan 'Costing Plus'    'PLN_b' 750000
        Plan 'Costing + Sales' 'PLN_trading' 1500000
        Plan 'Founding Costing' 'PLN_fcost'  350000
    )
    $r = Resolve-PaystackPlanMap -RemotePlans $bad
    Expect $r.Ok $false 'Ok'
    ExpectMatch ($r.Problems -join ' ') 'matches more than one plan'
}

It 'REFUSES a missing plan rather than leaving it unmapped' {
    $r = Resolve-PaystackPlanMap -RemotePlans ($good[0], $good[1], $good[2])
    Expect $r.Ok $false 'Ok'
    ExpectMatch ($r.Problems -join ' ') "no monthly Paystack plan at N7500 for 'founding_trading'"
}

It 'REFUSES two of our plans resolving to ONE Paystack code' {
    # the exact shape that was pasted by hand twice
    $bad = @(
        Plan 'Costing'                  'PLN_same'   750000
        Plan 'Founding Costing + Sales' 'PLN_same'   750000
        Plan 'Costing + Sales'          'PLN_trading' 1500000
        Plan 'Founding Costing'         'PLN_fcost'   350000
    )
    $r = Resolve-PaystackPlanMap -RemotePlans $bad
    Expect $r.Ok $false 'Ok'
    ExpectMatch ($r.Problems -join ' ') 'cannot sell two entitlements|matches more than one'
}

It 'ignores annual plans entirely -- V1 is monthly only' {
    $withAnnual = $good + @(Plan 'Costing Annual' 'PLN_year' 750000 'annually')
    $r = Resolve-PaystackPlanMap -RemotePlans $withAnnual
    Expect $r.Ok $true 'Ok'
    Expect $r.Map['costing'].Code 'PLN_costing'
}

It 'ignores a plan with no code' {
    $r = Resolve-PaystackPlanMap -RemotePlans ($good + @(Plan 'Draft' $null 750000))
    Expect $r.Ok $true 'Ok'
}

It 'REFUSES an empty plan list rather than returning an empty map' {
    $r = Resolve-PaystackPlanMap -RemotePlans @()
    Expect $r.Ok $false 'Ok'
    Expect $r.Problems.Count 4 'problem count'
}

It 'never invents a code for a price Paystack does not have' {
    $r = Resolve-PaystackPlanMap -RemotePlans @(Plan 'Costing' 'PLN_costing' 750000)
    Expect $r.Ok $false 'Ok'
    if ($r.Map.Keys -contains 'trading') { throw 'trading should not be in the map' }
}

Write-Host "`nGate log`n"

It 'a FAIL anywhere makes the whole run a failure' {
    $log = [System.Collections.ArrayList]::new()
    [void](Add-Gate $log 'a' 'PASS')
    [void](Add-Gate $log 'b' 'FAIL' 'because')
    Expect (Test-AnyGateFailed $log) $true 'failed?'
}

It 'a run of passes and a MANUAL is not a failure' {
    $log = [System.Collections.ArrayList]::new()
    [void](Add-Gate $log 'a' 'PASS')
    [void](Add-Gate $log 'b' 'MANUAL' 'you do this bit')
    Expect (Test-AnyGateFailed $log) $false 'failed?'
}

Write-Host "`nWrite-PlanCodeMapSql`n"

It 'rewrites the whole _codes block, leaving no stale code behind' {
    $tmpl = Join-Path ([System.IO.Path]::GetTempPath()) 'tmpl.sql'
    $out  = Join-Path ([System.IO.Path]::GetTempPath()) 'out.sql'
    @'
-- header
insert into _codes values
  ('costing',          'PLN_STALE_a',  7500),
  ('trading',          'PLN_STALE_b', 15000),
  ('founding_costing', 'PLN_STALE_c',  3500),
  ('founding_trading', 'PLN_STALE_d',  7500);
-- an old trailing comment
-- another one
do $$ begin end $$;
'@ | Set-Content -LiteralPath $tmpl
    $r = Resolve-PaystackPlanMap -RemotePlans $good
    [void](Write-PlanCodeMapSql -Map $r.Map -TemplatePath $tmpl -OutPath $out -Mode 'TEST')
    $sql = Get-Content -Raw -LiteralPath $out
    if ($sql -match 'PLN_STALE') { throw 'a stale code survived the rewrite' }
    ExpectMatch $sql "'costing',\s*'PLN_costing'"
    ExpectMatch $sql "'founding_trading',\s*'PLN_ftrade'"
    ExpectMatch $sql 'do \$\$ begin end \$\$;'
    ExpectMatch $sql 'Generated from the Paystack TEST API'
    Remove-Item $tmpl, $out -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail) `
    -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
exit $script:fail
