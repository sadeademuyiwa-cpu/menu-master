<#
.SYNOPSIS
  Run Menu Master NG locally, end to end, against a local database. One command.

.DESCRIPTION
  Starts three processes and stops them all on Ctrl-C:

    PostgREST 12.2.3   :3000    the real API layer, against your local PostgreSQL
    supabase-local     :54321   the Supabase-shaped gateway (web/e2e/supabase-local.mjs):
                                /rest/v1 -> PostgREST, /auth/v1 -> a GoTrue stand-in
                                that writes real auth.users rows and signs real JWTs
    next               :3100    the app, `next dev` (hot reload) or `next start`

  Writes web/.env.local pointing the app at the gateway. Nothing here touches
  Supabase, Vercel or Paystack; the checkout function is unreachable locally by
  design, and the page says so.

  Build the database first:  pwsh -File scripts/setup_db.ps1 -Database mm

.PARAMETER Database   the local database to serve (default mm)
.PARAMETER Mode       dev (default, hot reload) or start (serves the last build)
.PARAMETER Run        a node script to run once everything is up (e.g.
                      web/e2e/journey.mjs); the stack is then stopped and the
                      script's exit code is returned. Implies -Mode start.
.PARAMETER PgPort     PostgreSQL port (default 55433)
.PARAMETER PostgRest  path to postgrest.exe (default: POSTGREST env, then PATH)
.PARAMETER PgBin      PostgreSQL bin directory (default: PGBIN env, then PATH)

.NOTES
  -Mode start and -Run serve the LAST build, and NEXT_PUBLIC_* values are
  inlined at build time. Build once with the local values first:
    pwsh -File scripts/dev_local.ps1 -Build
  (or run this script once in dev mode, then `cd web && npm run build`, which
  picks up the .env.local this script wrote).

.EXAMPLE
  pwsh -File scripts/dev_local.ps1
  pwsh -File scripts/dev_local.ps1 -Database mmp -Mode start
  pwsh -File scripts/dev_local.ps1 -Run web/e2e/journey.mjs
#>
[CmdletBinding()]
param(
    [string] $Database = 'mm',
    [ValidateSet('dev', 'start')] [string] $Mode = 'dev',
    [string] $Run,
    [switch] $Build,
    [int]    $PgPort = 55433,
    [string] $PostgRest = $env:POSTGREST,
    [string] $PgBin = $env:PGBIN
)
if ($Run) { $Mode = 'start' }
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$web  = Join-Path $repo 'web'
$psql = if ($PgBin) { Join-Path $PgBin 'psql.exe' } else { 'psql' }
if (-not $PostgRest) { $PostgRest = 'postgrest' }
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) 'menu-master-dev'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null

# The same secret the gateway signs with. Local only; it is in the repository
# on purpose and protects nothing but a throwaway database.
$SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

# -- the client role PostgREST connects as -----------------------------------
& $psql -h 127.0.0.1 -p $PgPort -U postgres -d $Database -q -c @"
do `$`$ begin
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
  alter role authenticator with login password 'authenticator';
  grant anon, authenticated, service_role to authenticator;
end `$`$;
"@ | Out-Null

# -- an anon JWT the browser can carry (supabase-js sends it when signed out) --
function Jwt([hashtable] $claims) {
    $b64 = { param($bytes) [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
    $h = & $b64 ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $p = & $b64 ([Text.Encoding]::UTF8.GetBytes(($claims | ConvertTo-Json -Compress)))
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($SECRET))
    $s = & $b64 ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$h.$p")))
    "$h.$p.$s"
}
$anonKey = Jwt @{ role = 'anon'; iss = 'supabase-local'; iat = [int][double]::Parse((Get-Date -UFormat %s)); exp = 4102444800 }

# -- PostgREST ----------------------------------------------------------------
$conf = Join-Path $scratch 'postgrest.conf'
@"
db-uri = "postgres://authenticator:authenticator@127.0.0.1:$PgPort/$Database"
db-schemas = "public"
db-anon-role = "anon"
db-pre-request = "public.local_pre_request"
jwt-secret = "$SECRET"
jwt-role-claim-key = ".role"
server-port = 3000
server-host = "127.0.0.1"
db-pool = 4
"@ | Set-Content -LiteralPath $conf

# -- the app's environment ----------------------------------------------------
@"
# written by scripts/dev_local.ps1 -- local gateway, no real keys
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anonKey
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100
"@ | Set-Content -LiteralPath (Join-Path $web '.env.local')

if ($Build) {
    Set-Location $web
    & node node_modules/next/dist/bin/next build
    if ($LASTEXITCODE -ne 0) { throw "next build failed ($LASTEXITCODE)" }
    Set-Location $repo
}

$procs = @()
$exitCode = 0
try {
    # The PostgREST Windows build does not bundle libpq.dll; it must be on PATH
    # or the process dies at once with STATUS_DLL_NOT_FOUND (0xC0000135) and
    # writes nothing. PostgreSQL's bin directory carries it and its dependencies.
    if ($PgBin) { $env:PATH = "$PgBin;" + $env:PATH }
    $procs += Start-Process $PostgRest -ArgumentList "`"$conf`"" -PassThru -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $scratch 'postgrest.log') -RedirectStandardError (Join-Path $scratch 'postgrest.err')
    $env:DATABASE_URL = "postgres://postgres@127.0.0.1:$PgPort/$Database"
    $env:PGRST_URL = 'http://127.0.0.1:3000'
    $env:GATEWAY_PORT = '54321'
    $procs += Start-Process node -ArgumentList 'e2e/supabase-local.mjs' -WorkingDirectory $web -PassThru -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $scratch 'gateway.log') -RedirectStandardError (Join-Path $scratch 'gateway.err')

    # PostgREST answers 503 while its schema cache loads (a few seconds on this
    # schema) and 200 after; the gateway answers as soon as its pool is open.
    function Probe([string] $Uri, [hashtable] $Headers = @{}) {
        try { (Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck -Headers $Headers).StatusCode -eq 200 }
        catch { $false }
    }
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $pg = Probe 'http://127.0.0.1:3000/'
        $gw = Probe 'http://127.0.0.1:54321/rest/v1/' @{ Authorization = "Bearer $anonKey" }
        if (-not ($pg -and $gw)) { Start-Sleep -Seconds 1 }
    } until (($pg -and $gw) -or (Get-Date) -gt $deadline)
    if (-not ($pg -and $gw)) {
        Write-Host "PostgREST up: $pg   gateway up: $gw" -ForegroundColor Red
        Get-Content (Join-Path $scratch 'postgrest.err') -Tail 5 -ErrorAction SilentlyContinue
        Get-Content (Join-Path $scratch 'gateway.err') -Tail 5 -ErrorAction SilentlyContinue
        throw 'the local API did not come up'
    }
    Write-Host "PostgREST :3000  gateway :54321  database $Database" -ForegroundColor Green
    Set-Location $web
    if (-not $Run) {
        Write-Host "app: http://127.0.0.1:3100   ($Mode)   Ctrl-C stops everything" -ForegroundColor Green
        if ($Mode -eq 'dev') { & node node_modules/next/dist/bin/next dev -p 3100 }
        else                 { & node node_modules/next/dist/bin/next start -p 3100 }
        return
    }

    # -Run: serve the last build in the background, wait for it, run the
    # script, and let finally stop the stack.
    $procs += Start-Process node -ArgumentList 'node_modules/next/dist/bin/next', 'start', '-p', '3100' -WorkingDirectory $web -PassThru -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $scratch 'next.log') -RedirectStandardError (Join-Path $scratch 'next.err')
    $deadline = (Get-Date).AddSeconds(60)
    do { $app = Probe 'http://127.0.0.1:3100/login'; if (-not $app) { Start-Sleep -Seconds 1 } }
    until ($app -or (Get-Date) -gt $deadline)
    if (-not $app) {
        Get-Content (Join-Path $scratch 'next.err') -Tail 10 -ErrorAction SilentlyContinue
        throw 'the app did not come up on :3100 (built with the local .env.local? see .NOTES)'
    }
    $script = if ([System.IO.Path]::IsPathRooted($Run)) { $Run } else { Join-Path $repo $Run }
    Write-Host "app :3100 -- running $script" -ForegroundColor Green
    & node $script
    $exitCode = $LASTEXITCODE
    Write-Host "$Run exited $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { 'Green' } else { 'Red' })
} finally {
    foreach ($p in $procs) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
exit $exitCode
