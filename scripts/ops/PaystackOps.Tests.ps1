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

It 'prefers exact Founding Costing over a historical same-price plan' {
    $withLegacy = $good + @(
        Plan 'MENU MASTER NG FOUNDING' 'PLN_old_history' 350000
    )

    $r = Resolve-PaystackPlanMap -RemotePlans $withLegacy

    Expect $r.Ok $true 'Ok'
    Expect $r.Map['founding_costing'].Code 'PLN_fcost'
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
    ExpectMatch ($r.Problems -join ' ') 'matches more than one plan|no monthly Paystack plan'
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
    $r = Invoke-PaystackApi -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Path '/plan'
    Expect $r.StatusCode 400
    Expect $r.Ok $false
    Expect $r.Message 'Invalid key'
}

It 'a 200 with status:false is NOT treated as success' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 200; Content = '{"status":false,"message":"Plan not found"}' } }
    $r = Invoke-PaystackApi -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Path '/plan'
    Expect $r.Ok $false
    Expect $r.Message 'Plan not found'
}

It 'a non-JSON body does not crash and is reported honestly' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 502; Content = '<html>bad gateway</html>' } }
    $r = Invoke-PaystackApi -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Path '/plan'
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
    [void](Invoke-PaystackApi -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Path '/plan?perPage=100')
    Expect $global:LastUri 'https://api.paystack.co/plan?perPage=100'
}

Write-Host "`nGet-SecretShape  (safe description, never the key)`n"

It 'describes a good test key without revealing it' {
    $sh = Get-SecretShape -Secret (Sec 'sk_test_FIXTURE_short_dddd')
    Expect $sh.Prefix 'sk_test_'
    Expect $sh.Usable $true
    Expect $sh.Padded $false
    if ("$sh" -match '0123456789') { throw 'the key body leaked into the shape' }
}

It 'catches the PUBLIC key being pasted instead of the secret' {
    $sh = Get-SecretShape -Secret (Sec 'pk_test_FIXTURE_public_eeee')
    Expect $sh.Prefix 'pk_test_'
    Expect $sh.Usable $false
}

It 'reports surrounding whitespace and quotes, and cleans them anyway' {
    # length asserted from the fixture, never a hardcoded number: the last one
    # rotted the moment the fixture was renamed to get past secret scanning
    $k = 'sk_test_FIXTURE_not_a_real_key_aaaa'

    $padded = Get-SecretShape -Secret (Sec "  $k  ")
    Expect $padded.Padded $true 'padded reported'
    Expect $padded.Length $k.Length 'and the length is the CLEANED length'
    Expect $padded.Usable $true

    $quoted = Get-SecretShape -Secret (Sec "'$k'")
    Expect $quoted.Quoted $true 'quoted reported'
    Expect $quoted.Length $k.Length 'and the quotes are gone from the value'
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
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_live_FIXTURE_not_a_real_key_bbbb') -Mode 'Test') $false
    ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'LIVE key and this is a TEST run'
}

It 'REFUSES a TEST key during a LIVE run' {
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Mode 'Live') $false
}

It 'reports the provider message when the key is rejected' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 401; Content = '{"status":false,"message":"Invalid key"}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Mode 'Test') $false
    ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'HTTP 401 .* Invalid key'
}

It 'PASSES a good key' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 200; Content = '{"status":true,"data":[]}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -Mode 'Test') $true
    Expect (Test-AnyGateFailed $log) $false
}

Write-Host "`nTest-PaystackInitialize  (the checkout request, replayed locally)`n"

It 'sends the same body shape the edge function sends' {
    Set-FakePaystack 200 '{"status":true,"data":{"authorization_url":"https://checkout.paystack.com/x"}}'
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackInitialize -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -PlanCode 'PLN_x' `
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
    Expect (Test-PaystackInitialize -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -PlanCode 'PLN_wrong' `
              -Kobo 350000 -Email 'a@b.test' -CallbackUrl 'https://x.test/cb') $false
    ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'HTTP 400 .* Plan not found'
}

It 'a 200 with no authorization_url is a FAIL, not a pass' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 200; Content = '{"status":true,"data":{}}' } }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackInitialize -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') -PlanCode 'PLN_x' `
              -Kobo 1 -Email 'a@b.test' -CallbackUrl 'u') $false
}

Write-Host "`nGet-PaystackPlans  (legible failure)`n"

It 'REGRESSION: throws a message naming the status and reason' {
    Set-PaystackInvoker { param($m,$u,$h,$b)
        [pscustomobject]@{ StatusCode = 400; Content = '{"status":false,"message":"Invalid key"}' } }
    $threw = $false
    try { [void](Get-PaystackPlans -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa')) }
    catch { $threw = $true; ExpectMatch $_.Exception.Message 'HTTP 400.*Invalid key' }
    Expect $threw $true 'should have thrown'
}


# =============================================================================
# REGRESSION: the Windows prompt returned ONE non-ASCII character
#
# Entering a correct key twice produced:
#   "prefix (unrecognised), 1 chars, CONTAINS NON-ASCII"
# That is bracketed paste: the terminal sends ESC [ 200 ~ ahead of the text,
# Read-Host -AsSecureString takes the ESC as the whole input, and the rest is
# swallowed as a control sequence.
# =============================================================================

$ESC = [char]27
$REALKEY = 'sk_test_FIXTURE_not_a_real_key_cccc'   # fixture. Underscores on purpose: an all-alphanumeric tail matches
# GitHub's Stripe/Paystack secret detector and blocks the push.

Write-Host "`nConvertTo-CleanSecretText  (regression: the one-character read)`n"

It 'REGRESSION: a bare ESC -- the exact failing input -- cleans to nothing' {
    Expect (ConvertTo-CleanSecretText "$ESC") '' 'bare ESC'
    Expect (ConvertTo-CleanSecretText "$ESC[200~") '' 'a bracketed-paste opener alone'
}

It 'REGRESSION: a bracketed-paste WRAPPED key comes back whole' {
    $wrapped = "$ESC[200~$REALKEY$ESC[201~"
    Expect (ConvertTo-CleanSecretText $wrapped) $REALKEY 'unwrapped key'
    Expect (ConvertTo-CleanSecretText $wrapped).Length $REALKEY.Length 'full length, not 1'
}

It 'strips stray control characters anywhere in the value' {
    Expect (ConvertTo-CleanSecretText "`r`n$REALKEY`t`0") $REALKEY
    Expect (ConvertTo-CleanSecretText ($REALKEY -replace '^sk_', "sk`b_")) $REALKEY
}

It 'strips surrounding quotes a shell kept, but not quotes inside' {
    Expect (ConvertTo-CleanSecretText "'$REALKEY'") $REALKEY
    Expect (ConvertTo-CleanSecretText "`"$REALKEY`"") $REALKEY
    Expect (ConvertTo-CleanSecretText "sk_test_a'b") "sk_test_a'b" 'an inner quote is part of the value'
}

It 'trims whitespace from a paste' {
    Expect (ConvertTo-CleanSecretText "   $REALKEY   ") $REALKEY
}

It 'leaves an already-clean key exactly as it is' {
    Expect (ConvertTo-CleanSecretText $REALKEY) $REALKEY
}

It 'handles null and empty without throwing' {
    Expect (ConvertTo-CleanSecretText '') ''
    Expect (ConvertTo-CleanSecretText $null) ''
}

Write-Host "`nGet-SecretShape after cleaning`n"

It 'REGRESSION: the wrapped key now reports the right prefix and length' {
    $sh = Get-SecretShape -Secret (Sec "$ESC[200~$REALKEY$ESC[201~")
    Expect $sh.Prefix 'sk_test_'
    Expect $sh.Length $REALKEY.Length
    # NonAscii stays TRUE on purpose: it is reported from the RAW paste, so the
    # operator is told their terminal wrapped the key in control characters --
    # while the cleaned value is used and is perfectly good.
    Expect $sh.NonAscii $true 'the control characters in the paste are reported'
    Expect $sh.Usable $true
}

It 'REGRESSION: a bare ESC is reported as empty, not as a one-character key' {
    $sh = Get-SecretShape -Secret (Sec "$ESC")
    Expect $sh.Usable $false
    Expect $sh.Length 0 'length after cleaning'
}

Write-Host "`nTest-PaystackKey refuses a truncated read before calling Paystack`n"

It 'REGRESSION: a one-character read is named as a bad READ, not a bad key' {
    Set-PaystackInvoker { param($m,$u,$h,$b) throw 'Paystack must not be called for a truncated key' }
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec "${ESC}x") -Mode 'Test') $false
    $d = ($log | ForEach-Object Detail) -join ' '
    ExpectMatch $d 'did not read your paste'
    ExpectMatch $d '-SecretFrom Clipboard'
}

It 'a full, valid key is accepted and reaches Paystack' {
    Set-FakePaystack 200 '{"status":true,"data":[]}'
    $log = [System.Collections.ArrayList]::new()
    Expect (Test-PaystackKey -Log $log -Secret (Sec $REALKEY) -Mode 'Test') $true
    Expect $global:LastAuth "Bearer $REALKEY" 'the whole key reaches the header'
}

It 'REGRESSION: a wrapped key still produces a clean Authorization header' {
    Set-FakePaystack 200 '{"status":true,"data":[]}'
    [void](Invoke-PaystackApi -Secret (Sec "$ESC[200~$REALKEY$ESC[201~") -Path '/plan')
    Expect $global:LastAuth "Bearer $REALKEY" 'header carries the unwrapped key'
}

Write-Host "`nRead-PaystackSecret -From Env`n"

It 'reads and cleans a key from an environment variable' {
    $env:MM_TEST_KEY = "$ESC[200~$REALKEY$ESC[201~"
    try {
        $sec = Read-PaystackSecret -Prompt 'x' -From 'Env' -EnvVarName 'MM_TEST_KEY'
        Expect (Get-SecretShape -Secret $sec).Length $REALKEY.Length
        Expect (Get-SecretShape -Secret $sec).Prefix 'sk_test_'
    } finally { Remove-Item Env:MM_TEST_KEY -ErrorAction SilentlyContinue }
}

It 'says so plainly when the environment variable is not set' {
    Remove-Item Env:MM_TEST_KEY_MISSING -ErrorAction SilentlyContinue
    $threw = $false
    try { [void](Read-PaystackSecret -Prompt 'x' -From 'Env' -EnvVarName 'MM_TEST_KEY_MISSING') }
    catch { $threw = $true; ExpectMatch $_.Exception.Message 'is not set in this session' }
    Expect $threw $true 'should have thrown'
}

It 'refuses an environment variable holding only a control character' {
    $env:MM_TEST_KEY = "$ESC"
    try {
        $threw = $false
        try { [void](Read-PaystackSecret -Prompt 'x' -From 'Env' -EnvVarName 'MM_TEST_KEY') }
        catch { $threw = $true; ExpectMatch $_.Exception.Message 'nothing usable' }
        Expect $threw $true 'should have thrown'
    } finally { Remove-Item Env:MM_TEST_KEY -ErrorAction SilentlyContinue }
}


# =============================================================================
# SETTING THE SECRET
#
# The site said provider_unavailable while the very same key passed 5/5 gates
# from the operator's terminal. The stored secret was set with the reader that
# returned one character, so what Supabase holds is not what Paystack accepts.
# These cover the replacement path.
# =============================================================================

Write-Host "`nGet-SecretDigest`n"

$digestTable = "  NAME                 | DIGEST`r`n" +
               "  PAYSTACK_SECRET_KEY  | 4a1b2c3d4e5f60718293a4b5c6d7e8f9`r`n" +
               "  SITE_URL             | 00112233445566778899aabbccddeeff`r`n"

It 'reads the digest for the right name' {
    Expect (Get-SecretDigest -SecretsListOutput $digestTable -Name 'PAYSTACK_SECRET_KEY') `
        '4a1b2c3d4e5f60718293a4b5c6d7e8f9'
    Expect (Get-SecretDigest -SecretsListOutput $digestTable -Name 'SITE_URL') `
        '00112233445566778899aabbccddeeff'
}

It 'returns nothing for a name that is not there, rather than a wrong digest' {
    Expect (Get-SecretDigest -SecretsListOutput $digestTable -Name 'NOT_PRESENT') $null
}

It 'survives null, empty and mangled output' {
    Expect (Get-SecretDigest -SecretsListOutput $null -Name 'PAYSTACK_SECRET_KEY') $null
    Expect (Get-SecretDigest -SecretsListOutput '' -Name 'PAYSTACK_SECRET_KEY') $null
    Expect (Get-SecretDigest -SecretsListOutput "  PAYSTACK_SECRET_KEY  ? no-digest-here" `
              -Name 'PAYSTACK_SECRET_KEY') $null
}

Write-Host "`nGet-Sha256Hex`n"

It 'hashes the CLEANED key, so a wrapped paste and a clean one agree' {
    $k = 'sk_test_FIXTURE_not_a_real_key_aaaa'
    $clean   = Get-Sha256Hex -Secret (Sec $k)
    $wrapped = Get-Sha256Hex -Secret (Sec "$ESC[200~$k$ESC[201~")
    Expect $wrapped $clean 'a wrapped paste hashes to the same value'
    Expect $clean.Length 64 'sha256 hex length'
    if ($clean -match 'FIXTURE') { throw 'the key leaked into its own digest' }
}

It 'different keys hash differently' {
    $a = Get-Sha256Hex -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa')
    $b = Get-Sha256Hex -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_bbbb')
    if ($a -eq $b) { throw 'two different keys produced the same digest' }
}

Write-Host "`nSet-PaystackSecretInSupabase`n"

It 'writes the key to an env file, then leaves NOTHING behind' {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("mmsec" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    try {
        $seen = $null
        Set-SupabaseInvoker {
            param([string[]] $CliArgs)
            # capture what the CLI would have been handed
            $global:LastCliArgs = $CliArgs
            $i = [array]::IndexOf($CliArgs, '--env-file')
            if ($i -ge 0) { $global:LastEnvFileBody = Get-Content -Raw -LiteralPath $CliArgs[$i + 1] }
            [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }
        $log = [System.Collections.ArrayList]::new()
        Expect (Set-PaystackSecretInSupabase -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') `
                  -ScratchDir $dir) $true

        ExpectMatch $global:LastEnvFileBody 'PAYSTACK_SECRET_KEY=sk_test_FIXTURE_not_a_real_key_aaaa'
        # the key must never appear in the arguments
        if (($global:LastCliArgs -join ' ') -match 'sk_test_FIXTURE') {
            throw 'the key reached the command line'
        }
        # and the file must be gone
        Expect (@(Get-ChildItem -Path $dir -File).Count) 0 'files left in the scratch directory'
    } finally { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}

It 'shreds the env file even when the CLI fails' {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("mmsec" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    try {
        Set-SupabaseInvoker { param($a) [pscustomobject]@{ ExitCode = 1; Output = 'nope' } }
        $log = [System.Collections.ArrayList]::new()
        Expect (Set-PaystackSecretInSupabase -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') `
                  -ScratchDir $dir) $false
        Expect (@(Get-ChildItem -Path $dir -File).Count) 0 'files left behind after a failure'
        Expect (Test-AnyGateFailed $log) $true
    } finally { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}

It 'falls back to the inline form on a CLI without --env-file, and says so' {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("mmsec" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    try {
        $global:Calls = 0
        Set-SupabaseInvoker {
            param([string[]] $CliArgs)
            $global:Calls++
            if ($CliArgs -contains '--env-file') {
                return [pscustomobject]@{ ExitCode = 1; Output = 'unknown flag: --env-file' }
            }
            [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }
        $log = [System.Collections.ArrayList]::new()
        Expect (Set-PaystackSecretInSupabase -Log $log -Secret (Sec 'sk_test_FIXTURE_not_a_real_key_aaaa') `
                  -ScratchDir $dir) $true
        Expect $global:Calls 2 'it retried'
        ExpectMatch (($log | ForEach-Object Detail) -join ' ') 'process arguments'
        Expect (@(Get-ChildItem -Path $dir -File).Count) 0 'files left behind'
    } finally { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail) `
    -ForegroundColor $(if ($script:fail) { 'Red' } else { 'Green' })
exit $script:fail
