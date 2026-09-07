# =============================================================================
# MENU MASTER NG -- Paystack operations, shared by the TEST run and the LIVE
# cutover so the two cannot drift apart.
#
# RULES THIS MODULE KEEPS, EVERYWHERE
#   * A secret is never printed, never written to a file, never put in a
#     command line, and never returned from a function.
#   * A gate that cannot be evaluated is a FAIL, never a PASS. Unparseable
#     output is an unknown state, and an unknown state is not success.
#   * Nothing here writes to git. Not a commit, not a push, not a checkout.
# =============================================================================

Set-StrictMode -Version Latest

# Our four paid plans, and what each is worth in kobo. This is the same
# authority as plans.price_kobo -- if they ever disagree, the run stops.
$script:PaidPlans = @(
    [pscustomobject]@{ PlanId = 'costing';          Kobo = 750000;  Founding = $false; Label = 'Costing' }
    [pscustomobject]@{ PlanId = 'trading';          Kobo = 1500000; Founding = $false; Label = 'Costing + Sales' }
    [pscustomobject]@{ PlanId = 'founding_costing'; Kobo = 350000;  Founding = $true;  Label = 'Founding Costing' }
    [pscustomobject]@{ PlanId = 'founding_trading'; Kobo = 750000;  Founding = $true;  Label = 'Founding Costing + Sales' }
)

function Get-PaidPlanSpec { $script:PaidPlans }

# -----------------------------------------------------------------------------
# Gate results
# -----------------------------------------------------------------------------
function New-GateLog { , @() }

function Add-Gate {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [ValidateSet('PASS', 'FAIL', 'SKIP', 'MANUAL')] [string] $Result,
        [string] $Detail = ''
    )
    $row = [pscustomobject]@{ Gate = $Name; Result = $Result; Detail = $Detail }
    [void]$Log.Add($row)
    $colour = switch ($Result) {
        'PASS'   { 'Green' }
        'FAIL'   { 'Red' }
        'SKIP'   { 'DarkGray' }
        'MANUAL' { 'Yellow' }
    }
    Write-Host ('  {0,-6} {1}' -f $Result, $Name) -ForegroundColor $colour
    if ($Detail) { Write-Host ('         {0}' -f $Detail) -ForegroundColor DarkGray }
    # Deliberately returns nothing. It used to emit the row, which meant any
    # function that both logged a gate and returned a boolean returned BOTH --
    # so "return $false" became @(row, $false), which is truthy. Caught by the
    # tests for Test-PaystackKey.
}

function Test-AnyGateFailed {
    param([Parameter(Mandatory)] [System.Collections.IList] $Log)
    [bool](@($Log | Where-Object { $_.Result -eq 'FAIL' }).Count)
}

# -----------------------------------------------------------------------------
# 1. Repository state
# -----------------------------------------------------------------------------
function Test-RepoState {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [string] $ExpectedBranch,
        [string] $ExpectedCommit,
        [string] $ForbiddenBranch = 'claude/menu-master-ng-migrations-3faerm'
    )

    $branch = (& git rev-parse --abbrev-ref HEAD 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Add-Gate $Log 'repo: this is a git working tree' 'FAIL' $branch; return
    }

    # The production-tracked branch is never the place to run this from: a
    # Vercel production build follows it, and this script has no business
    # being anywhere near that.
    if ($branch -eq $ForbiddenBranch) {
        Add-Gate $Log 'repo: not on the production-tracked branch' 'FAIL' `
            "on $branch. Check out $ExpectedBranch first -- this script must never run from the branch Vercel builds for production."
        return
    }
    Add-Gate $Log 'repo: not on the production-tracked branch' 'PASS' "on $branch"

    if ($branch -eq $ExpectedBranch) {
        Add-Gate $Log 'repo: on the expected branch' 'PASS' $branch
    } else {
        Add-Gate $Log 'repo: on the expected branch' 'FAIL' "on $branch, expected $ExpectedBranch"
    }

    $head = (& git rev-parse HEAD 2>&1 | Out-String).Trim()
    if ($ExpectedCommit) {
        if ($head.StartsWith($ExpectedCommit)) {
            Add-Gate $Log 'repo: at the expected commit' 'PASS' $head.Substring(0, 12)
        } else {
            Add-Gate $Log 'repo: at the expected commit' 'FAIL' `
                "HEAD is $($head.Substring(0,12)), expected $ExpectedCommit. Run: git pull"
        }
    } else {
        Add-Gate $Log 'repo: at the expected commit' 'SKIP' "HEAD $($head.Substring(0,12)); no commit pinned"
    }

    $dirty = (& git status --porcelain 2>&1 | Out-String).Trim()
    if ($dirty) {
        Add-Gate $Log 'repo: working tree is clean' 'FAIL' `
            "uncommitted changes present -- what you deploy would not be what is committed:`n         $($dirty -replace "`n", "`n         ")"
    } else {
        Add-Gate $Log 'repo: working tree is clean' 'PASS'
    }
}

# -----------------------------------------------------------------------------
# CLI OUTPUT PARSING, kept pure so it can be tested without a CLI
#
# Both of these exist because parsing the Supabase CLI's table on Windows went
# wrong in two different ways on the first real run. Neither is allowed to
# report success from output it did not understand.
# -----------------------------------------------------------------------------

function Split-CliLines {
    param([Parameter(Mandatory)] [AllowNull()] $Output)
    # The CLI may hand back $null, one string, or an array of strings, and on
    # Windows the line ending is CRLF. Out-String normalises all of that;
    # without it, a single-line result is a bare string with no .Count and
    # StrictMode throws "The property 'Count' cannot be found on this object."
    @(($Output | Out-String) -split "\r?\n")
}

function Test-SecretNamePresent {
    param(
        [Parameter(Mandatory)] [AllowNull()] $Output,
        [Parameter(Mandatory)] [string] $Name
    )
    # Bounded by non-word characters rather than by the table's separators: the
    # CLI draws them with box-drawing glyphs that a non-UTF8 Windows console
    # mangles, and a mangled separator must not turn a present secret into an
    # absent one. Underscores are word characters, so PAYSTACK_SECRET_KEY
    # cannot be matched by a longer name containing it.
    $pattern = "(?<![\w-])$([regex]::Escape($Name))(?![\w-])"
    @(Split-CliLines $Output | Where-Object { $_ -match $pattern }).Count -gt 0
}

function Resolve-LinkState {
    param(
        [Parameter(Mandatory)] [AllowNull()] $ProjectsListOutput,
        [Parameter(Mandatory)] [string] $ProjectRef,
        [AllowNull()] [string] $LinkedRefOnDisk
    )
    $lines   = Split-CliLines $ProjectsListOutput
    $refLine = @($lines | Where-Object { $_ -match [regex]::Escape($ProjectRef) })
    $visible = $refLine.Count -gt 0

    if (-not $visible) {
        return [pscustomobject]@{ Result = 'FAIL'
            Detail = "$ProjectRef is not in this login's project list" }
    }

    # supabase/.temp/project-ref is what the CLI itself reads to decide which
    # project a command targets, so it is the authority -- not a bullet in a
    # table. It is also plain ASCII, which the table's LINKED marker is not:
    # that marker is drawn with a glyph a Windows console can mangle, which is
    # exactly how a correctly linked project was reported as unlinked.
    if ($LinkedRefOnDisk) {
        if ($LinkedRefOnDisk -eq $ProjectRef) {
            return [pscustomobject]@{ Result = 'PASS'
                Detail = "$ProjectRef (from supabase/.temp/project-ref)" }
        }
        # Linked to a DIFFERENT project. Deploying here would deploy to
        # somebody else's project, so this is a hard failure, not a fallback.
        return [pscustomobject]@{ Result = 'FAIL'
            Detail = "this repo is linked to $LinkedRefOnDisk, not $ProjectRef. Run: npx supabase link --project-ref $ProjectRef" }
    }

    # No link file. Fall back to the table marker, and accept only a marker we
    # actually recognise -- an unreadable line stays a FAIL.
    if (($refLine -join ' ') -match '●|✔|\bLINKED\b|\*') {
        return [pscustomobject]@{ Result = 'PASS'
            Detail = "$ProjectRef (marked linked in the project list)" }
    }
    [pscustomobject]@{ Result = 'FAIL'
        Detail = "$ProjectRef is visible but no link was found. Run: npx supabase link --project-ref $ProjectRef" }
}

function Get-LinkedProjectRefOnDisk {
    param([Parameter(Mandatory)] [string] $RepoRoot)
    $path = Join-Path $RepoRoot 'supabase' | Join-Path -ChildPath '.temp' | Join-Path -ChildPath 'project-ref'
    if (Test-Path -LiteralPath $path) {
        $v = (Get-Content -Raw -LiteralPath $path -ErrorAction SilentlyContinue)
        if ($v) { return $v.Trim() }
    }
    $null
}

# -----------------------------------------------------------------------------
# 2. Supabase link
# -----------------------------------------------------------------------------
# The CLI call is injectable so the gates around it can be tested against real
# recorded output. Without this the parsing was only ever exercised through a
# live CLI, which is why two Windows-specific shapes reached the operator
# instead of a test.
$script:SupabaseInvoker = {
    param([string[]] $CliArgs)
    $out = & npx --yes supabase @CliArgs 2>&1 | Out-String
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
}

function Set-SupabaseInvoker {
    param([Parameter(Mandatory)] [scriptblock] $Invoker)
    $script:SupabaseInvoker = $Invoker
}

function Invoke-Supabase {
    param([Parameter(Mandatory)] [string[]] $CliArgs)
    & $script:SupabaseInvoker $CliArgs
}

function Test-SupabaseLink {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [string] $ProjectRef,
        [Parameter(Mandatory)] [string] $RepoRoot
    )
    $r = Invoke-Supabase @('projects', 'list')
    if ($r.ExitCode -ne 0) {
        Add-Gate $Log 'supabase: CLI is authenticated' 'FAIL' `
            "supabase projects list failed. Run: npx supabase login`n         $($r.Output.Trim())"
        return
    }
    Add-Gate $Log 'supabase: CLI is authenticated' 'PASS'

    $onDisk = Get-LinkedProjectRefOnDisk -RepoRoot $RepoRoot
    $state  = Resolve-LinkState -ProjectsListOutput $r.Output -ProjectRef $ProjectRef -LinkedRefOnDisk $onDisk
    Add-Gate $Log 'supabase: project is linked' $state.Result $state.Detail
}

# -----------------------------------------------------------------------------
# 3. Secret NAMES -- never values
# -----------------------------------------------------------------------------
function Test-SecretNames {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [string[]] $Required
    )
    $r = Invoke-Supabase @('secrets', 'list')
    if ($r.ExitCode -ne 0) {
        Add-Gate $Log 'secrets: readable' 'FAIL' $r.Output.Trim(); return
    }
    # supabase secrets list prints NAME and a DIGEST. We match on the name only
    # and never echo the line, so a digest cannot reach a log or a screenshot.
    foreach ($name in $Required) {
        if (Test-SecretNamePresent -Output $r.Output -Name $name) {
            Add-Gate $Log "secrets: $name is set" 'PASS' 'name present; value not read'
        } else {
            Add-Gate $Log "secrets: $name is set" 'FAIL' `
                "not found. Set it yourself -- this script never handles it:`n         npx supabase secrets set $name=<value>"
        }
    }
}

# -----------------------------------------------------------------------------
# 4. Deploy. The two flags differ on purpose and the difference is the security
#    boundary: the webhook authenticates by HMAC alone and would be locked out
#    by JWT verification; checkout is authenticated by the platform and would
#    be open to anonymous callers without it.
# -----------------------------------------------------------------------------
function Deploy-EdgeFunctions {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [switch] $WhatIfOnly
    )
    $plan = @(
        [pscustomobject]@{ Name = 'paystack-webhook';  ExtraArgs = @('--no-verify-jwt') }
        [pscustomobject]@{ Name = 'paystack-checkout'; ExtraArgs = @() }
    )
    foreach ($fn in $plan) {
        $desc = if ($fn.ExtraArgs.Count) { "$($fn.Name) $($fn.ExtraArgs -join ' ')" } else { $fn.Name }
        if ($WhatIfOnly) { Add-Gate $Log "deploy: $desc" 'SKIP' 'dry run'; continue }

        Write-Host "  ... deploying $desc" -ForegroundColor DarkGray
        $r = Invoke-Supabase (@('functions', 'deploy', $fn.Name) + $fn.ExtraArgs)
        if ($r.ExitCode -eq 0) {
            Add-Gate $Log "deploy: $desc" 'PASS'
        } else {
            Add-Gate $Log "deploy: $desc" 'FAIL' $r.Output.Trim()
        }
    }
}

function Test-FunctionsActive {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [string[]] $Names = @('paystack-webhook', 'paystack-checkout')
    )
    $r = Invoke-Supabase @('functions', 'list')
    if ($r.ExitCode -ne 0) {
        Add-Gate $Log 'functions: listable' 'FAIL' $r.Output.Trim(); return
    }
    foreach ($n in $Names) {
        $line = ($r.Output -split "`n" | Where-Object { $_ -match [regex]::Escape($n) }) -join ' '
        if (-not $line) {
            Add-Gate $Log "functions: $n exists" 'FAIL' 'not listed'
        } elseif ($line -match 'ACTIVE') {
            Add-Gate $Log "functions: $n is ACTIVE" 'PASS'
        } else {
            # Present but not ACTIVE, or a table shape we do not recognise.
            # Either way this is not a pass.
            Add-Gate $Log "functions: $n is ACTIVE" 'FAIL' "status not ACTIVE: $($line.Trim())"
        }
    }
}

# -----------------------------------------------------------------------------
# 5. Plan codes, read from Paystack instead of retyped
#
# The two N7,500 plans were transposed twice by hand. Reading them from the
# provider removes the transcription entirely: amount identifies three of the
# four, and the founding/standard pair at N7,500 is separated by name. Anything
# it cannot resolve unambiguously is refused, never guessed.
# -----------------------------------------------------------------------------
function Resolve-PaystackPlanMap {
    param(
        [Parameter(Mandatory)] [AllowNull()] $RemotePlans,   # objects with name, plan_code, amount, interval
        $Spec = $script:PaidPlans
    )
    $problems = [System.Collections.Generic.List[string]]::new()
    $map = [ordered]@{}

    $monthly = @(@($RemotePlans) | Where-Object {
        $null -ne $_ -and $_.interval -eq 'monthly' -and $_.plan_code
    })

    foreach ($want in $Spec) {
        $sameAmount = @($monthly | Where-Object { [int]$_.amount -eq $want.Kobo })

        # The name test is applied ALWAYS, not only when the amount is
        # ambiguous. Applying it only to ties meant that when the Founding
        # N7,500 plan was missing, the standard Costing plan was the sole
        # N7,500 candidate and was accepted for founding_trading -- the wrong
        # product at the right price, which is the one failure nothing
        # downstream can detect. Caught by PaystackOps.Tests.ps1.
        $match = @($sameAmount | Where-Object {
            ($_.name -match '(?i)founding') -eq $want.Founding
        })

        if ($match.Count -eq 1) {
            $map[$want.PlanId] = [pscustomobject]@{
                PlanId = $want.PlanId; Code = $match[0].plan_code
                Kobo = [int]$match[0].amount; RemoteName = $match[0].name
            }
        } elseif ($match.Count -eq 0) {
            $problems.Add("no monthly Paystack plan at N$($want.Kobo / 100) for '$($want.PlanId)' (expected a plan named like '$($want.Label)')")
        } else {
            $names = ($match | ForEach-Object { "$($_.name) [$($_.plan_code)]" }) -join ', '
            $problems.Add("'$($want.PlanId)' at N$($want.Kobo / 100) matches more than one plan: $names -- rename them in Paystack so exactly one contains 'Founding'")
        }
    }

    # Two of our plans resolving to one Paystack code would sell two different
    # entitlements under one code. That is the failure this whole path exists
    # to prevent, so it is checked even when every lookup "succeeded".
    $codes = @($map.Values | ForEach-Object { $_.Code })
    $dupes = @($codes | Group-Object | Where-Object { $_.Count -gt 1 })
    foreach ($d in $dupes) {
        $who = @($map.Values | Where-Object { $_.Code -eq $d.Name } | ForEach-Object { $_.PlanId }) -join ' and '
        $problems.Add("$who both resolve to $($d.Name) -- one Paystack plan cannot sell two entitlements")
    }

    [pscustomobject]@{
        Ok       = ($problems.Count -eq 0)
        Map      = $map
        Problems = $problems.ToArray()
    }
}

# -----------------------------------------------------------------------------
# PAYSTACK HTTP
#
# Invoke-RestMethod -ErrorAction Stop throws a generic
# "Response status code does not indicate success" and discards the response
# BODY -- which is where Paystack puts the only useful thing, its own message.
# That turned a one-line diagnosis into a guessing game, so every call now goes
# through here and the status and message are always available.
#
# Paystack's message field never contains the key; it is safe to print.
# -----------------------------------------------------------------------------

$script:PaystackInvoker = {
    param([string] $Method, [string] $Uri, [hashtable] $Headers, [string] $Body)
    $p = @{ Method = $Method; Uri = $Uri; Headers = $Headers
            SkipHttpErrorCheck = $true; ErrorAction = 'Stop' }
    if ($Body) { $p.Body = $Body; $p.ContentType = 'application/json' }
    $r = Invoke-WebRequest @p
    [pscustomobject]@{ StatusCode = [int]$r.StatusCode; Content = $r.Content }
}

function Set-PaystackInvoker {
    param([Parameter(Mandatory)] [scriptblock] $Invoker)
    $script:PaystackInvoker = $Invoker
}

<#
.SYNOPSIS
  Refuse to prompt when nothing can answer.
.DESCRIPTION
  Read-Host against a redirected or closed stdin does not return -- PowerShell
  ends the script there, with exit code 0. A wrapper reading that exit code
  would call a silent abort a success. Checked before every prompt so the
  failure is loud instead.
#>
function Test-CanPrompt {
    param([Parameter(Mandatory)] [System.Collections.IList] $Log)
    if ([Console]::IsInputRedirected) {
        Add-Gate $Log 'terminal: can prompt for the secret' 'FAIL' `
            'stdin is redirected, so the secret prompt cannot be answered. Run this in an interactive terminal.'
        return $false
    }
    $true
}

<#
.SYNOPSIS
  A safe description of a secret: enough to diagnose, never enough to use.
.DESCRIPTION
  Reports the key's PREFIX (sk_test_ / sk_live_ / pk_test_ ...), its length,
  and whether it arrived with whitespace or quotes around it. Those four facts
  identify every mistake we have actually hit -- pasting the public key,
  pasting the live key, and a shell wrapping the value in quotes -- without
  revealing a single character of the key body.
#>
function Get-SecretShape {
    param([Parameter(Mandatory)] [AllowNull()] [securestring] $Secret)
    if (-not $Secret -or $Secret.Length -eq 0) {
        return [pscustomobject]@{ Prefix = '(empty)'; Length = 0; Padded = $false
                                  Quoted = $false; NonAscii = $false; Usable = $false }
    }
    $raw = [System.Net.NetworkCredential]::new('', $Secret).Password
    try {
        $trim   = $raw.Trim()
        $prefix = if ($trim -match '^(sk|pk)_(test|live)_') { $Matches[0] } else { '(unrecognised)' }
        [pscustomobject]@{
            Prefix   = $prefix
            Length   = $trim.Length
            Padded   = ($raw -ne $trim)
            Quoted   = ($trim -match "^['`"].*['`"]$")
            NonAscii = ($trim -match '[^\x20-\x7E]')
            Usable   = ($prefix -like 'sk_*')
        }
    } finally { $raw = $null }
}

function Invoke-PaystackApi {
    param(
        [Parameter(Mandatory)] [securestring] $Secret,
        [Parameter(Mandatory)] [string] $Path,
        [string] $Method = 'GET',
        [string] $JsonBody
    )
    # Trimmed deliberately: a trailing newline from a paste or a shell here-doc
    # produces a header Paystack rejects, and the operator cannot see it.
    $key = ([System.Net.NetworkCredential]::new('', $Secret).Password).Trim()
    try {
        $r = & $script:PaystackInvoker $Method "https://api.paystack.co$Path" `
                @{ Authorization = "Bearer $key" } $JsonBody
    } finally { $key = $null }

    $parsed = $null
    try { $parsed = $r.Content | ConvertFrom-Json -ErrorAction Stop } catch { }

    # Property lookup by indexer, never by .Properties.Name -contains: under
    # StrictMode the latter throws on an empty object, which turned a clean
    # "no authorization_url" failure into an unrelated crash.
    $prop = { param($o, $n) if ($o) { $o.PSObject.Properties[$n] } else { $null } }
    $statusProp = & $prop $parsed 'status'
    $msgProp    = & $prop $parsed 'message'
    $dataProp   = & $prop $parsed 'data'

    [pscustomobject]@{
        StatusCode = $r.StatusCode
        Ok         = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300 -and
                      $statusProp -and [bool]$statusProp.Value)
        Message    = if ($msgProp) { [string]$msgProp.Value } else { '(no message field in the response body)' }
        Data       = if ($dataProp) { $dataProp.Value } else { $null }
    }
}

<#
.SYNOPSIS
  Is this key usable, and what does Paystack say about it?
#>
function Test-PaystackKey {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [securestring] $Secret,
        [Parameter(Mandatory)] [ValidateSet('Test', 'Live')] [string] $Mode
    )
    $shape = Get-SecretShape -Secret $Secret
    $desc  = "prefix $($shape.Prefix), $($shape.Length) chars" +
             $(if ($shape.Padded)   { ', HAS SURROUNDING WHITESPACE' }) +
             $(if ($shape.Quoted)   { ', HAS SURROUNDING QUOTES' }) +
             $(if ($shape.NonAscii) { ', CONTAINS NON-ASCII' })

    if (-not $shape.Usable) {
        Add-Gate $Log 'paystack: the key is a SECRET key' 'FAIL' `
            "$desc -- a secret key starts sk_. A pk_ key is the PUBLIC key and cannot call this API."
        return $false
    }
    if ($Mode -eq 'Test' -and $shape.Prefix -eq 'sk_live_') {
        Add-Gate $Log 'paystack: the key matches the mode' 'FAIL' `
            "$desc -- that is a LIVE key and this is a TEST run. Refusing."
        return $false
    }
    if ($Mode -eq 'Live' -and $shape.Prefix -eq 'sk_test_') {
        Add-Gate $Log 'paystack: the key matches the mode' 'FAIL' "$desc -- that is a TEST key and this is a LIVE run."
        return $false
    }
    Add-Gate $Log 'paystack: the key is a SECRET key for this mode' 'PASS' $desc

    $r = Invoke-PaystackApi -Secret $Secret -Path '/plan?perPage=1'
    if ($r.Ok) {
        Add-Gate $Log 'paystack: the API accepts the key' 'PASS' "HTTP $($r.StatusCode)"
        return $true
    }
    Add-Gate $Log 'paystack: the API accepts the key' 'FAIL' `
        "HTTP $($r.StatusCode) -- Paystack says: $($r.Message)"
    $false
}

function Get-PaystackPlans {
    param([Parameter(Mandatory)] [securestring] $Secret)
    $r = Invoke-PaystackApi -Secret $Secret -Path '/plan?perPage=100'
    if (-not $r.Ok) {
        throw "Paystack returned HTTP $($r.StatusCode): $($r.Message)"
    }
    $r.Data
}

function Write-PlanCodeMapSql {
    param(
        [Parameter(Mandatory)] $Map,
        [Parameter(Mandatory)] [string] $TemplatePath,
        [Parameter(Mandatory)] [string] $OutPath,
        [Parameter(Mandatory)] [ValidateSet('TEST', 'LIVE')] [string] $Mode
    )
    $sql = Get-Content -Raw -LiteralPath $TemplatePath

    # Replace the values block wholesale rather than patching four lines, so a
    # stale code cannot survive a partial substitution.
    $rows = @($script:PaidPlans | ForEach-Object {
        $m = $Map[$_.PlanId]
        "  ('{0}', '{1}', {2})" -f $_.PlanId, $m.Code, ($_.Kobo / 100)
    }) -join ",`n"

    $block = "insert into _codes values`n$rows;`n" +
             "-- Generated from the Paystack $Mode API on $(Get-Date -Format 'yyyy-MM-dd HH:mm') by`n" +
             "-- scripts/ops/Deploy-Paystack.ps1. Not retyped by hand: the two N7,500 plans`n" +
             "-- were transposed twice when they were."

    $pattern = '(?s)insert into _codes values.*?;(\r?\n--[^\r\n]*)*'
    if ($sql -notmatch $pattern) { throw "could not find the _codes block in $TemplatePath" }
    $sql = [regex]::Replace($sql, $pattern, { $block }, 1)

    Set-Content -LiteralPath $OutPath -Value $sql -NoNewline:$false
    $OutPath
}

<#
.SYNOPSIS
  Reproduce the checkout initialization locally and print what Paystack says.
.DESCRIPTION
  The edge function's failure is only visible in its logs, and the CLI has no
  `functions logs` subcommand. This sends the SAME request body the function
  sends, from here, so the provider's own status and message are on screen.

  It creates a pending transaction and charges nothing -- no card is entered,
  and an uninitialised transaction expires on its own. TEST mode only.
#>
function Test-PaystackInitialize {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [securestring] $Secret,
        [Parameter(Mandatory)] [string] $PlanCode,
        [Parameter(Mandatory)] [int] $Kobo,
        [Parameter(Mandatory)] [string] $Email,
        [Parameter(Mandatory)] [string] $CallbackUrl,
        [string] $Label = 'initialize'
    )
    # Byte-identical in shape to supabase/functions/paystack-checkout/lib.ts
    # initializeBody(). If this succeeds and the function does not, the
    # difference is the function's environment, not the request.
    $body = @{
        email        = $Email
        amount       = "$Kobo"
        currency     = 'NGN'
        callback_url = $CallbackUrl
        plan         = $PlanCode
        metadata     = @{ account_id = '00000000-0000-0000-0000-000000000000'
                          plan_id    = 'diagnostic' }
    } | ConvertTo-Json -Depth 5

    $r = Invoke-PaystackApi -Secret $Secret -Path '/transaction/initialize' -Method 'POST' -JsonBody $body
    $urlProp = if ($r.Data) { $r.Data.PSObject.Properties['authorization_url'] } else { $null }
    $url = if ($urlProp) { [string]$urlProp.Value } else { $null }
    if ($r.Ok -and $url) {
        Add-Gate $Log "paystack: $Label ($PlanCode)" 'PASS' "HTTP $($r.StatusCode), authorization_url returned"
        return $true
    }
    Add-Gate $Log "paystack: $Label ($PlanCode)" 'FAIL' `
        "HTTP $($r.StatusCode) -- Paystack says: $($r.Message)"
    $false
}

# -----------------------------------------------------------------------------
# 6. The eleven scenarios
# -----------------------------------------------------------------------------
function Invoke-ElevenScenarios {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [securestring] $Secret,
        [Parameter(Mandatory)] [string] $WebhookUrl,
        [Parameter(Mandatory)] [string] $TestAccountId,
        [Parameter(Mandatory)] [string] $RepoRoot
    )
    $script = Join-Path $RepoRoot 'deploy/billing/run_eleven_scenarios.ts'
    if (-not (Test-Path -LiteralPath $script)) {
        Add-Gate $Log 'eleven scenarios' 'FAIL' "harness not found at $script"; return
    }
    if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
        Add-Gate $Log 'eleven scenarios' 'FAIL' 'deno is not on PATH. Install it (winget install DenoLand.Deno), open a new terminal, and run again.'
        return
    }

    # The key is placed in the child's environment and removed in finally. It is
    # never written to a file and never appears in a command line.
    $prev = $env:PAYSTACK_SECRET_KEY
    try {
        $env:PAYSTACK_SECRET_KEY = [System.Net.NetworkCredential]::new('', $Secret).Password
        $env:WEBHOOK_URL = $WebhookUrl
        $env:TEST_ACCOUNT_ID = $TestAccountId

        Write-Host '  ... running the eleven scenarios' -ForegroundColor DarkGray
        $out = & deno run --allow-env --allow-net $script 2>&1 | Out-String
        $code = $LASTEXITCODE
        Write-Host $out

        if ($code -eq 0) {
            Add-Gate $Log 'eleven scenarios' 'PASS' 'harness exited 0'
        } else {
            Add-Gate $Log 'eleven scenarios' 'FAIL' "harness exited $code"
        }
    } finally {
        $env:PAYSTACK_SECRET_KEY = $prev
        Remove-Item Env:WEBHOOK_URL -ErrorAction SilentlyContinue
        Remove-Item Env:TEST_ACCOUNT_ID -ErrorAction SilentlyContinue
    }
}

# -----------------------------------------------------------------------------
# 7. Reporting
# -----------------------------------------------------------------------------
function Write-GateSummary {
    param(
        [Parameter(Mandatory)] [System.Collections.IList] $Log,
        [Parameter(Mandatory)] [string] $Title
    )
    Write-Host ''
    Write-Host ('=' * 74)
    Write-Host $Title
    Write-Host ('=' * 74)
    # Rendered through Out-String and Write-Host rather than piped to Out-Host:
    # the pipeline form produced nothing at all when the function was called in
    # a void subexpression, which silently emptied the report.
    $table = $Log |
        Select-Object Gate, Result, @{ n = 'Detail'; e = { ($_.Detail -split "`n")[0] } } |
        Format-Table -AutoSize -Wrap |
        Out-String -Width 200
    Write-Host $table.TrimEnd()

    $fail   = @($Log | Where-Object Result -eq 'FAIL').Count
    $pass   = @($Log | Where-Object Result -eq 'PASS').Count
    $manual = @($Log | Where-Object Result -eq 'MANUAL').Count

    if ($fail) {
        Write-Host "RESULT: FAIL -- $fail gate(s) failed, $pass passed." -ForegroundColor Red
        Write-Host 'Nothing further has been attempted. Fix the failures above and run again.' -ForegroundColor Red
    } else {
        Write-Host "RESULT: PASS -- $pass gate(s) passed$(if ($manual) { ", $manual awaiting you" })." -ForegroundColor Green
    }
    -not [bool]$fail
}

Export-ModuleMember -Function *-* , Get-PaidPlanSpec, New-GateLog
