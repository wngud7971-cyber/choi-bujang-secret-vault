# Student launcher for the existing, separate local engine. No credential files.
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$Port = 5198,
  [string]$NodePath,
  [switch]$CheckOnly
)
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

function Stop-Launch([string]$Message) { throw $Message }

$appRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $appRoot
$serverPath = Join-Path $appRoot 'src\server.mjs'
$configPath = Join-Path $projectRoot 'aleph.config.json'
foreach ($required in @($serverPath, $configPath, (Join-Path $projectRoot 'src\security-engine.mjs'))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { Stop-Launch '자체 엔진 파일을 찾지 못했습니다. 기존 프로젝트와 사본의 위치를 확인하세요.' }
}

# The public issuer selects the existing project; no user-supplied endpoint.
try {
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $issuer = [Uri]$config.identityProvider.issuer
  if (-not $issuer.IsAbsoluteUri -or $issuer.Scheme -ne 'https' -or $issuer.UserInfo -or
      $issuer.AbsolutePath -cne '/auth/v1' -or $issuer.Query -or $issuer.Fragment) { throw 'INVALID_ISSUER' }
  $supabaseUrl = $issuer.GetLeftPart([UriPartial]::Authority)
} catch { Stop-Launch '기존 인증 발급자 설정을 확인하지 못했습니다. 설정을 임의로 바꾸지 마세요.' }

if (-not $NodePath) {
  $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($nodeCommand) { $NodePath = $nodeCommand.Source }
  else {
    $cachedNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $cachedNode -PathType Leaf) { $NodePath = $cachedNode }
  }
}
if (-not $NodePath -or -not [IO.Path]::IsPathRooted($NodePath) -or
    -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { Stop-Launch 'Node.js를 찾지 못했습니다. 설치된 실행 파일을 -NodePath의 전체 경로로 지정하세요.' }
$NodePath = (Resolve-Path -LiteralPath $NodePath).ProviderPath
if ([IO.Path]::GetFileName($NodePath) -ine 'node.exe') { Stop-Launch 'NodePath에는 실제 node.exe 경로를 지정하세요.' }

function New-EngineProcess([string]$Arguments) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $NodePath
  $start.WorkingDirectory = $projectRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.Arguments = $Arguments
  # Keep unrelated credentials, engine selectors and Node preload hooks out.
  foreach ($name in @($start.EnvironmentVariables.Keys)) {
    if ($name -match '(?i)(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|^ON_|^OPENAI|^ANTHROPIC|^SUPABASE|^NODE_OPTIONS$|^NODE_PATH$)') {
      $start.EnvironmentVariables.Remove($name)
    }
  }
  return $start
}

$versionProcess = New-EngineProcess '--version'
$versionProcess.RedirectStandardOutput = $true
$versionProcess.RedirectStandardError = $true
$probeProcess = [Diagnostics.Process]::Start($versionProcess)
try {
  $version = $probeProcess.StandardOutput.ReadToEnd().Trim()
  $null = $probeProcess.StandardError.ReadToEnd()
  $probeProcess.WaitForExit()
  if ($probeProcess.ExitCode -ne 0 -or $version -notmatch '^v(22|23|24)\.\d+\.\d+$') { Stop-Launch '사용 가능한 Node.js 22~24 버전을 확인하지 못했습니다.' }
} finally { $probeProcess.Dispose() }

$dependencyProcess = New-EngineProcess '--input-type=module --eval "await Promise.all([import(''./src/security-engine.mjs''),import(''./on-client/src/server.mjs'')]);"'
$dependencyProcess.RedirectStandardOutput = $true
$dependencyProcess.RedirectStandardError = $true
$probeProcess = [Diagnostics.Process]::Start($dependencyProcess)
try {
  $null = $probeProcess.StandardOutput.ReadToEnd()
  $null = $probeProcess.StandardError.ReadToEnd()
  $probeProcess.WaitForExit()
  if ($probeProcess.ExitCode -ne 0) { Stop-Launch '자체 엔진 모듈을 읽지 못했습니다. 프로젝트 최상위의 기존 의존성과 파일을 확인하세요. 자동 설치는 하지 않았습니다.' }
} finally { $probeProcess.Dispose() }

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() }
catch { Stop-Launch "포트 $Port 를 사용할 수 없습니다. 다른 서버는 그대로 두고 -Port로 다른 번호를 지정하세요." }
finally { $listener.Stop() }

Write-Host "자체 엔진 준비 확인: Node.js $version / http://localhost:$Port/"
Write-Host "기존 인증 프로젝트: $supabaseUrl"
if ($CheckOnly) {
  Write-Host 'LOCAL_ENGINE_LAUNCH_READY: 파일·의존성·포트 확인만 완료했습니다. 키 입력·서버 실행·실제 인증·DB 조회는 하지 않았습니다.'
  exit 0
}

Write-Host '기존 Supabase 프로젝트의 서버 전용 키를 아래 비밀 입력란에 직접 입력하세요. 채팅에 보내지 마세요.'
Write-Host '입력값은 표시하거나 파일에 저장하지 않고 이번 서버 프로세스에만 전달합니다. 취소하려면 Ctrl+C를 누르세요.'
$secureKey = $null
$keyPointer = [IntPtr]::Zero
$child = $null
$start = $null
try {
  $secureKey = Read-Host '서버 전용 키 (화면에 표시하지 않음)' -AsSecureString
  if ($secureKey.Length -eq 0) { Stop-Launch '키를 입력하지 않아 실행을 중단했습니다. 저장한 값은 없습니다.' }
  $start = New-EngineProcess ('"' + $serverPath + '" --local-engine')
  $start.EnvironmentVariables['ON_PORT'] = [string]$Port
  $start.EnvironmentVariables['SUPABASE_URL'] = $supabaseUrl
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $start.EnvironmentVariables['SUPABASE_SECRET_KEY'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    $child = [Diagnostics.Process]::Start($start)
  } finally {
    $start.EnvironmentVariables.Remove('SUPABASE_SECRET_KEY')
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $keyPointer = [IntPtr]::Zero
    $secureKey.Dispose()
    $secureKey = $null
  }
  Write-Host "브라우저에서 http://localhost:$Port/ 를 여세요. 실제 로그인·기기 확인 전에는 연결 성공이 아닙니다."
  Write-Host '이 창에서 Ctrl+C로 종료하세요. 재실행할 때는 키 입력과 로그인을 다시 진행합니다.'
  while (-not $child.WaitForExit(250)) { }
  if ($child.ExitCode -ne 0) { Stop-Launch '자체 엔진 서버가 종료됐습니다. 화면의 오류 코드와 실행 위치를 확인하세요. 키는 공유하지 마세요.' }
} finally {
  if ($null -ne $start) { $start.EnvironmentVariables.Remove('SUPABASE_SECRET_KEY') }
  if ($keyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
  if ($null -ne $secureKey) { $secureKey.Dispose() }
  if ($null -ne $child) {
    try { if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() } }
    finally { $child.Dispose() }
  }
}
