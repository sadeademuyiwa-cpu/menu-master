<#
.SYNOPSIS
  Menu Master NG -- one command for the whole Paystack deployment check.

.DESCRIPTION
  Runs every gate in deploy/runbook/PAYSTACK_TEST_MODE_SETUP.md in order,
  reports PASS/FAIL per gate, and stops before any browser payment.

  -Mode Test   (default) verifies, deploys, and runs the eleven scenarios.
  -Mode Live   the cutover. Requires live plan codes, a live secret already
               set, and a typed confirmation. See deploy/runbook/LIVE_CUTOVER.md.

  WHAT IT NEVER DOES
    * print, store, log or transmit a secret
    * write to git -- no commit, no push, no checkout
    * run from the production-tracked branch
    * switch Paystack to live mode (only YOU do that, in the dashboard)
    * make a payment

.EXAMPLE
  pwsh -File scripts/ops/Deploy-Paystack.ps1 -TestAccountId <uuid>

.EXAMPLE
  pwsh -File scripts/ops/Deploy-Paystack.ps1 -Mode Live -Confirm
#>
# Windows ships PowerShell 5.1 as `powershell`. This script uses 7-only syntax
# (three-argument Join-Path among others), so it declares the requirement
# rather than failing later with a confusing binding error.
#Requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateSet('Test', 'Live')] [string] $Mode = 'Test',

    # A uuid from your accounts table, used only by the eleven-scenario harness.
    [string] $TestAccountId,

    [string] $ProjectRef     = 'mgbrrrjxbufstsjrdoug',
    [string] $ExpectedBranch = 'claude/0049-artifacts',
    [string] $ExpectedCommit,

    # Verify and report, deploy nothing.
    [switch] $VerifyOnly,

    # Skip the harness (it needs deno and your test key).
    [switch] $SkipScenarios,

    # Re-read the four plan codes from Paystack and write a mapping file.
    [switch] $SyncPlanCodes,

    # LIVE only. Without it, -Mode Live refuses.
    [switch] $Confirm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Import-Module (Join-Path $PSScriptRoot 'PaystackOps.psm1') -Force
Push-Location $RepoRoot
try {
    $log = [System.Collections.ArrayList]::new()
    $isLive = $Mode -eq 'Live'
    $webhookUrl = "https://$ProjectRef.supabase.co/functions/v1/paystack-webhook"

    Write-Host ''
    Write-Host "MENU MASTER NG -- Paystack deployment, $($Mode.ToUpper()) mode" -ForegroundColor Cyan
    Write-Host "project $ProjectRef   repo $RepoRoot" -ForegroundColor DarkGray
    Write-Host ''

    # -- LIVE gate 0: this is the irreversible one, so it is first ------------
    if ($isLive) {
        Write-Host 'LIVE MODE' -ForegroundColor Yellow
        Write-Host 'This maps LIVE Paystack plan codes into the production database.' -ForegroundColor Yellow
        Write-Host 'After it, real customers can be charged real money.' -ForegroundColor Yellow
        Write-Host ''
        if (-not $Confirm) {
            Add-Gate $log 'live: -Confirm supplied' 'FAIL' 're-run with -Confirm once you have read deploy/runbook/LIVE_CUTOVER.md'
            [void](Write-GateSummary $log 'LIVE CUTOVER -- REFUSED')
            exit 1
        }
        $typed = Read-Host 'Type OPEN PAYMENTS to continue (anything else aborts)'
        if ($typed -cne 'OPEN PAYMENTS') {
            Add-Gate $log 'live: confirmation typed' 'FAIL' 'aborted at the confirmation prompt; nothing was changed'
            [void](Write-GateSummary $log 'LIVE CUTOVER -- ABORTED')
            exit 1
        }
        Add-Gate $log 'live: confirmation typed' 'PASS'
    }

    # -- 1. repository -------------------------------------------------------
    Write-Host 'REPOSITORY' -ForegroundColor Cyan
    Test-RepoState -Log $log -ExpectedBranch $ExpectedBranch -ExpectedCommit $ExpectedCommit

    # -- 2. supabase link ----------------------------------------------------
    Write-Host ''; Write-Host 'SUPABASE' -ForegroundColor Cyan
    Test-SupabaseLink -Log $log -ProjectRef $ProjectRef -RepoRoot $RepoRoot

    # -- 3. secret NAMES -----------------------------------------------------
    Test-SecretNames -Log $log -Required @('PAYSTACK_SECRET_KEY', 'SITE_URL')

    if (Test-AnyGateFailed $log) {
        [void](Write-GateSummary $log 'PREFLIGHT FAILED -- nothing deployed')
        exit 1
    }

    # -- 4. plan codes, read from Paystack rather than retyped ---------------
    $mapFile = $null
    if ($SyncPlanCodes -or $isLive) {
        Write-Host ''; Write-Host 'PLAN CODES' -ForegroundColor Cyan
        Write-Host "  reading your $($Mode.ToUpper())-mode plans from the Paystack API" -ForegroundColor DarkGray
        $secret = Read-Host "Paystack $($Mode.ToUpper()) secret key (not echoed, not stored)" -AsSecureString
        try {
            $remote = Get-PaystackPlans -Secret $secret
            $r = Resolve-PaystackPlanMap -RemotePlans $remote
            if ($r.Ok) {
                $detail = (@($r.Map.Values | ForEach-Object { "$($_.PlanId)=$($_.Code)" }) -join ', ')
                Add-Gate $log 'plans: all four resolved unambiguously' 'PASS' $detail
                $mapFile = Join-Path $RepoRoot ("deploy/runbook/MAP_PLAN_CODES_{0}.generated.sql" -f $Mode.ToUpper())
                [void](Write-PlanCodeMapSql -Map $r.Map `
                        -TemplatePath (Join-Path $RepoRoot 'deploy/runbook/MAP_PLAN_CODES.sql') `
                        -OutPath $mapFile -Mode $Mode.ToUpper())
                Add-Gate $log 'plans: mapping file written' 'PASS' $mapFile
                Add-Gate $log 'plans: mapping applied to the database' 'MANUAL' `
                    "you run this -- it needs the database password, which this script never handles:`n         psql `"<session-pooler>`" --single-transaction -v ON_ERROR_STOP=1 -f `"$mapFile`""
            } else {
                Add-Gate $log 'plans: all four resolved unambiguously' 'FAIL' ($r.Problems -join "`n         ")
            }
        } finally {
            $secret = $null
        }
    }

    if (Test-AnyGateFailed $log) {
        [void](Write-GateSummary $log 'PLAN MAPPING FAILED -- nothing deployed')
        exit 1
    }

    # -- 5. deploy -----------------------------------------------------------
    Write-Host ''; Write-Host 'EDGE FUNCTIONS' -ForegroundColor Cyan
    Deploy-EdgeFunctions -Log $log -WhatIfOnly:$VerifyOnly
    Test-FunctionsActive -Log $log

    if (Test-AnyGateFailed $log) {
        [void](Write-GateSummary $log 'DEPLOY FAILED')
        exit 1
    }

    # -- 6. the eleven scenarios --------------------------------------------
    Write-Host ''; Write-Host 'WEBHOOK BEHAVIOUR' -ForegroundColor Cyan
    if ($SkipScenarios) {
        Add-Gate $log 'eleven scenarios' 'SKIP' '-SkipScenarios'
    } elseif ($isLive) {
        # Signed payloads against a live webhook would write live billing rows.
        Add-Gate $log 'eleven scenarios' 'SKIP' 'not run against live: it would write real billing events'
    } elseif (-not $TestAccountId) {
        Add-Gate $log 'eleven scenarios' 'FAIL' 'pass -TestAccountId <uuid from your accounts table>'
    } else {
        $secret = Read-Host 'Paystack TEST secret key, to sign the payloads (not echoed, not stored)' -AsSecureString
        try {
            Invoke-ElevenScenarios -Log $log -Secret $secret -WebhookUrl $webhookUrl `
                -TestAccountId $TestAccountId -RepoRoot $RepoRoot
        } finally { $secret = $null }
    }

    # -- 7. what remains, and it is not automatable --------------------------
    Write-Host ''; Write-Host 'REMAINING' -ForegroundColor Cyan
    if ($isLive) {
        Add-Gate $log 'live: final verification' 'MANUAL' `
            'run POST_VERIFY_0050.sql -- expect 12/12 with row 12 showing the LIVE plan codes'
        Add-Gate $log 'live: switch the dashboard to Live and set the live webhook URL' 'MANUAL' $webhookUrl
    } else {
        Add-Gate $log 'browser: one test-card payment' 'MANUAL' `
            'card 4084 0840 8408 4081, any future expiry, CVV 408, OTP 123456 -- then verify in the DATABASE, not on screen'
    }

    $ok = Write-GateSummary $log "$($Mode.ToUpper()) MODE -- GATE REPORT"

    if ($ok) {
        Write-Host ''
        Write-Host 'STOPPING HERE. No payment has been made and nothing else runs automatically.' -ForegroundColor Cyan
        if ($mapFile) { Write-Host "Mapping file waiting to be applied: $mapFile" -ForegroundColor Cyan }
    }
    exit ([int](-not $ok))
} finally {
    Pop-Location
}
