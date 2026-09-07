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


# =============================================================================
# REGRESSIONS FROM THE FIRST REAL WINDOWS RUN (commit 4da6882)
#
# Two gates failed on a machine that was correctly configured:
#   * "supabase: project is linked" FAILED although the repo was linked --
#     the LINKED column is drawn with a glyph a Windows console mangles.
#   * Test-SecretNames CRASHED with "The property 'Count' cannot be found on
#     this object" -- Where-Object returned ONE line, not an array, and
#     StrictMode has no .Count on a bare string.
# =============================================================================

Write-Host "`nTest-SecretNamePresent  (regression: the 'Count' crash)`n"

# The real shape: box-drawing separators, CRLF, one row per secret.
$secretsTable = "  NAME                 │ DIGEST`r`n" +
                "  ──────────────────── │ ────────`r`n" +
                "  PAYSTACK_SECRET_KEY  │ a1b2c3`r`n" +
                "  SITE_URL             │ d4e5f6`r`n"

It 'finds a secret in the real CRLF box-drawing table' {
    Expect (Test-SecretNamePresent -Output $secretsTable -Name 'PAYSTACK_SECRET_KEY') $true
    Expect (Test-SecretNamePresent -Output $secretsTable -Name 'SITE_URL') $true
}

It 'REGRESSION: a single matching line does not crash on .Count' {
    # Exactly one line matches, so Where-Object returns a bare string. This is
    # the input that threw on the real machine.
    $one = "  PAYSTACK_SECRET_KEY  | a1b2c3"
    Expect (Test-SecretNamePresent -Output $one -Name 'PAYSTACK_SECRET_KEY') $true
}

It 'REGRESSION: zero matches returns false instead of crashing' {
    Expect (Test-SecretNamePresent -Output $secretsTable -Name 'NOT_SET_ANYWHERE') $false
}

It 'REGRESSION: null and empty output are handled, not thrown on' {
    Expect (Test-SecretNamePresent -Output $null -Name 'PAYSTACK_SECRET_KEY') $false
    Expect (Test-SecretNamePresent -Output '' -Name 'PAYSTACK_SECRET_KEY') $false
    Expect (Test-SecretNamePresent -Output @() -Name 'PAYSTACK_SECRET_KEY') $false
}

It 'accepts output handed back as an array of lines' {
    $arr = @('  NAME | DIGEST', '  PAYSTACK_SECRET_KEY | a1', '  SITE_URL | b2')
    Expect (Test-SecretNamePresent -Output $arr -Name 'SITE_URL') $true
}

It 'survives a console that mangled the separators' {
    $mangled = "  NAME ? DIGEST`r`n  PAYSTACK_SECRET_KEY ? a1b2c3`r`n"
    Expect (Test-SecretNamePresent -Output $mangled -Name 'PAYSTACK_SECRET_KEY') $true
}

It 'does not match a name that is only part of a longer one' {
    $other = "  PAYSTACK_SECRET_KEY_OLD | a1"
    Expect (Test-SecretNamePresent -Output $other -Name 'PAYSTACK_SECRET_KEY') $false
}

Write-Host "`nResolve-LinkState  (regression: linked project reported unlinked)`n"

$ref  = 'mgbrrrjxbufstsjrdoug'
# The real table, with the LINKED marker replaced by the '?' a non-UTF8
# Windows console renders it as. This is what actually reached the parser.
$mangledList = "   LINKED │ ORG ID │ REFERENCE ID         │ NAME`r`n" +
               "  ──────── ┼ ────── ┼ ──────────────────── ┼ ─────`r`n" +
               "     ?    │ abc    │ $ref │ Menu Master NG`r`n"
$goodList    = "   LINKED │ ORG ID │ REFERENCE ID         │ NAME`r`n" +
               "     ●    │ abc    │ $ref │ Menu Master NG`r`n"

It 'REGRESSION: a mangled LINKED glyph still PASSES via the link file' {
    $r = Resolve-LinkState -ProjectsListOutput $mangledList -ProjectRef $ref -LinkedRefOnDisk $ref
    Expect $r.Result 'PASS'
    ExpectMatch $r.Detail 'project-ref'
}

It 'still PASSES from the table marker when there is no link file' {
    $r = Resolve-LinkState -ProjectsListOutput $goodList -ProjectRef $ref -LinkedRefOnDisk $null
    Expect $r.Result 'PASS'
}

It 'FAILS when linked to a DIFFERENT project -- deploying would hit the wrong one' {
    $r = Resolve-LinkState -ProjectsListOutput $goodList -ProjectRef $ref -LinkedRefOnDisk 'someoneelsesref'
    Expect $r.Result 'FAIL'
    ExpectMatch $r.Detail 'linked to someoneelsesref'
}

It 'FAILS when the project is not in the list at all' {
    $r = Resolve-LinkState -ProjectsListOutput "   LINKED │ REFERENCE ID`r`n  ● │ otherref`r`n" `
            -ProjectRef $ref -LinkedRefOnDisk $null
    Expect $r.Result 'FAIL'
    ExpectMatch $r.Detail 'not in this login'
}

It 'FAILS -- does NOT pass -- on output it cannot understand' {
    # visible but no marker and no link file: unknown state, and unknown is
    # not success. This is the gate that must never be weakened.
    $r = Resolve-LinkState -ProjectsListOutput $mangledList -ProjectRef $ref -LinkedRefOnDisk $null
    Expect $r.Result 'FAIL'
    ExpectMatch $r.Detail 'npx supabase link'
}

It 'handles null and empty projects-list output without crashing' {
    Expect (Resolve-LinkState -ProjectsListOutput $null -ProjectRef $ref -LinkedRefOnDisk $ref).Result 'FAIL'
    Expect (Resolve-LinkState -ProjectsListOutput '' -ProjectRef $ref -LinkedRefOnDisk $ref).Result 'FAIL'
}

It 'an empty link file is treated as no link file, not as a match' {
    $r = Resolve-LinkState -ProjectsListOutput $goodList -ProjectRef $ref -LinkedRefOnDisk ''
    Expect $r.Result 'PASS'   # falls through to the table marker, which is present
    $r2 = Resolve-LinkState -ProjectsListOutput $mangledList -ProjectRef $ref -LinkedRefOnDisk ''
    Expect $r2.Result 'FAIL'  # and with no marker either, it stays a FAIL
}


Write-Host "`nEnd-to-end replay of the first real Windows run`n"

It 'REGRESSION: both gates PASS against the exact output that failed' {
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("repo" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path (Join-Path $tmp 'supabase' | Join-Path -ChildPath '.temp') -Force | Out-Null
    Set-Content -NoNewline -LiteralPath (Join-Path $tmp 'supabase' | Join-Path -ChildPath '.temp' | Join-Path -ChildPath 'project-ref') `
        -Value 'mgbrrrjxbufstsjrdoug'
    try {
        Set-SupabaseInvoker {
            param([string[]] $CliArgs)
            if ($CliArgs[0] -eq 'projects') {
                [pscustomobject]@{ ExitCode = 0; Output =
                    "   LINKED | ORG ID | REFERENCE ID         | NAME`r`n     ?    | abc    | mgbrrrjxbufstsjrdoug | Menu Master NG`r`n" }
            } else {
                [pscustomobject]@{ ExitCode = 0; Output =
                    "  NAME                 | DIGEST`r`n  PAYSTACK_SECRET_KEY  | a1b2c3`r`n  SITE_URL             | d4e5f6`r`n" }
            }
        }
        $log = [System.Collections.ArrayList]::new()
        Test-SupabaseLink -Log $log -ProjectRef 'mgbrrrjxbufstsjrdoug' -RepoRoot $tmp
        Test-SecretNames  -Log $log -Required @('PAYSTACK_SECRET_KEY', 'SITE_URL')
        Expect (Test-AnyGateFailed $log) $false 'any gate failed'
        Expect $log.Count 4 'gate count'
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

It 'and a CLI that is not logged in still FAILS closed' {
    Set-SupabaseInvoker {
        param([string[]] $CliArgs)
        [pscustomobject]@{ ExitCode = 1; Output = 'LegacyPlatformAuthRequiredError: Access token not provided.' }
    }
    $log = [System.Collections.ArrayList]::new()
    Test-SupabaseLink -Log $log -ProjectRef 'mgbrrrjxbufstsjrdoug' -RepoRoot (Get-Location).Path
    Expect (Test-AnyGateFailed $log) $true 'should have failed'
}


# =============================================================================
# REGRESSION: the 400 that told us nothing
#
# Invoke-RestMethod -ErrorAction Stop threw
#   "Response status code does not indicate success: 400 (Bad Request)."
# and discarded the response body, which is where Paystack puts the reason.
# Every call now surfaces status AND message.
# =============================================================================

function Set-FakePaystack {
    param([int] $Status, [string] $Json)
    Set-PaystackInvoker {
        param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$Body)
        # the header must be exactly "Bearer <key>" with nothing else attached
        $global:LastAuth = $Headers.Authorization
        $global:LastUri  = $Uri
        $global:LastBody = $Body
        [pscustomobject]@{ StatusCode = $Status; Content = $Json }
    }.GetNewClosure()
}
function Sec { param([string]$s) ConvertTo-SecureString $s -AsPlainText -Force }

Write-Host "`nInvoke-PaystackApi  (regression: the opaque 400)`n"

It 'REGRESSION: a 400 surfaces Paystack own message instead of throwing' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 400; Content = '{"status":false,"message":"Invalid key"}' } }
    $r = Invoke-PaystackApi -Secret (Sec 'sk_test_abc') -Path '/plan'
    Expect $r.StatusCode 400
    Expect $r.Ok $false
    Expect $r.Message 'Invalid key'
}

It 'a 200 with status:false is NOT treated as success' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 200; Content = '{"status":false,"message":"Plan not found"}' } }
    $r = Invoke-PaystackApi -Secret (Sec 'sk_test_abc') -Path '/plan'
    Expect $r.Ok $false
    Expect $r.Message 'Plan not found'
}

It 'a non-JSON body does not crash and is reported honestly' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 502; Content = '<html>bad gateway</html>' } }
    $r = Invoke-PaystackApi -Secret (Sec 'sk_test_abc') -Path '/plan'
    Expect $r.Ok $false
    Expect $r.StatusCode 502
    ExpectMatch $r.Message 'no message field'
}

It 'the Authorization header is exactly Bearer + key, and the key is trimmed' {
    Set-FakePaystack 200 '{"status":true,"data":[]}'
    [void](Invoke-PaystackApi -Secret (Sec "  sk_test_padded`n") -Path '/plan')
    Expect $global:LastAuth 'Bearer sk_test_padded' 'Authorization header'
}

It 'the URI is built against api.paystack.co' {
    Set-FakePaystack 200 '{"status":true,"data":[]}'
    [void](Invoke-PaystackApi -Secret (Sec 'sk_test_abc') -Path '/plan?perPage=100')
    Expect $global:LastUri 'https://api.paystack.co/plan?perPage=100'
}

Write-Host "`nGet-SecretShape  (safe description, never the key)`n"

It 'describes a good test key without revealing it' {
    $sh = Get-SecretShape -Secret (Sec 'sk_test_0123456789abcdef')
    Expect $sh.Prefix 'sk_test_'
    Expect $sh.Usable $true
    Expect $sh.Padded $false
    if ("$sh" -match '0123456789') { throw 'the key body leaked into the shape' }
}

It 'catches the PUBLIC key being pasted instead of the secret' {
    $sh = Get-SecretShape -Secret (Sec 'pk_test_0123456789')
    Expect $sh.Prefix 'pk_test_'
    Expect $sh.Usable $false
}

It 'catches surrounding whitespace and quotes -- the shell-paste mistakes' {
    Expect (Get-SecretShape -Secret (Sec "  sk_test_abc  ")).Padded $true
    Expect (Get-SecretShape -Secret (Sec "'sk_test_abc'")).Quoted $true
}

It 'reports an unrecognised key shape rather than assuming it is fine' {
    $sh = Get-SecretShape -Secret (Sec 'not-a-key-at-all')
    Expect $sh.Prefix '(unrecognised)'
    Expect $sh.Usable $false
}

Write-Host "`nTest-PaystackKey  (refusals)`n"

It 'REFUSES a public key before any request is made' {
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'pk_test_abc') -Mode 'Test') $false
    Expect (Test-AnyGateFailed $log) $true
}

It 'REFUSES a LIVE key during a TEST run' {
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_live_abc') -Mode 'Test') $false
    ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'LIVE key and this is a TEST run'
}

It 'REFUSES a TEST key during a LIVE run' {
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_test_abc') -Mode 'Live') $false
}

It 'reports the provider message when the key is rejected' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 401; Content = '{"status":false,"message":"Invalid key"}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_test_abc') -Mode 'Test') $false
    ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'HTTP 401 .* Invalid key'
}

It 'PASSES a good key' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 200; Content = '{"status":true,"data":[]}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_test_abc') -Mode 'Test') $true
    Expect (Test-AnyGateFailed $log) $false
}

Write-Host "`nTest-PaystackInitialize  (the checkout request, replayed locally)`n"

It 'sends the same body shape the edge function sends' {
    Set-FakePaystack 200 '{"status":true,"data":{"authorization_url":"https://checkout.paystack.com/x"}}'
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackInitialize -Log $log -Secret (Sec 'sk_test_abc') -PlanCode 'PLN_x' `
              -Kobo 350000 -Email 'a@b.test' -CallbackUrl 'https://x.test/cb') $true
    $sent = $global:LastBody | ConvertFrom-Json
    Expect $sent.amount '350000'
    Expect $sent.plan 'PLN_x'
    Expect $sent.currency 'NGN'
    Expect $sent.metadata.plan_id 'diagnostic'
}

It 'REGRESSION: a bad plan code reports Plan not found, not a bare 400' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 400; Content = '{"status":false,"message":"Plan not found"}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackInitialize -Log $log -Secret (Sec 'sk_test_abc') -PlanCode 'PLN_wrong' `
              -Kobo 350000 -Email 'a@b.test' -CallbackUrl 'https://x.test/cb') $false
    ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'HTTP 400 .* Plan not found'
}

It 'a 200 with no authorization_url is a FAIL, not a pass' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 200; Content = '{"status":true,"data":{}}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackInitialize -Log $log -Secret (Sec 'sk_test_abc') -PlanCode 'PLN_x' `
              -Kobo 1 -Email 'a@b.test' -CallbackUrl 'u') $false
}

Write-Host "`nGet-PaystackPlans  (legible failure)`n"

It 'REGRESSION: throws a message naming the status and reason' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 400; Content = '{"status":false,"message":"Invalid key"}' } }
    $threw = $false
    try { [void](Get-PaystackPlans -Secret (Sec 'sk_test_abc')) }
    catch { $threw = $true; ExpectMatch $_.Exception.Message 'HTTP 400.*Invalid key' }
    Expect $threw $true 'should have thrown'
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail) `
    -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
exit $script:fail
