// Local read-only Windows observations. No settings, files, credentials or event messages are written.
import {execFile} from 'node:child_process';
import {isIP} from 'node:net';

export const CONNECTION_SCHEMA = 'keshev.connection-status.v1';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const DAY = 86400000;
const SOURCES = {
  network: 'Windows Get-NetAdapter · Get-NetIPConfiguration',
  firewall: 'Windows Get-NetFirewallProfile -PolicyStore ActiveStore · Get-NetConnectionProfile',
  events: 'Windows Get-WinEvent · System/Application · Level 2/3',
};
const REASONS = {
  ACCESS_DENIED: '일반 사용자 권한으로 읽을 수 없습니다. 관리자 권한 요청이나 설정 변경을 하지 않습니다.',
  COMMAND_UNAVAILABLE: '이 PC에서 필요한 Windows 조회 명령을 사용할 수 없습니다.',
  QUERY_TIMEOUT: '조회 제한 시간을 초과했습니다. 불완전한 결과를 정상값으로 표시하지 않습니다.',
  QUERY_CANCELLED: '조회가 취소됐습니다. 현재 상태를 확인할 수 없습니다.',
  QUERY_FAILED: 'Windows 조회를 완료하지 못했습니다.',
  INVALID_RESULT: '조회 결과의 형식이나 범위를 확인할 수 없습니다.',
  LOG_DISABLED: '해당 Windows 로그가 비활성 상태여서 집계할 수 없습니다.',
  UNSUPPORTED_PLATFORM: '이 조회는 Windows에서만 지원합니다.',
};
const codeOf = code => Object.hasOwn(REASONS, code) ? code : 'QUERY_FAILED';
const unavailable = code => ({status: 'unavailable', code: codeOf(code), reason: REASONS[codeOf(code)]});
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const smallText = x => typeof x === 'string' && x.length > 0 && x.length <= 180 && !/[\x00-\x1f\x7f]/.test(x);
const strings = (x, check, limit = 64) => Array.isArray(x) && x.length <= limit && x.every(check);
const address = x => typeof x === 'string' && x.length <= 64 && isIP(x.split('%')[0]) !== 0;
const count = x => Number.isSafeInteger(x) && x >= 0;

// These scripts are fixed by the application. Browser input never becomes a command or log selector.
const PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function FailureCode($e) {
  if ($e.Exception -is [System.UnauthorizedAccessException] -or $e.Exception.HResult -eq -2147024891 -or [string]$e.CategoryInfo.Category -eq 'PermissionDenied' -or $e.FullyQualifiedErrorId -match 'AccessDenied|UnauthorizedAccess|PermissionDenied') { return 'ACCESS_DENIED' }
  if ($e.Exception -is [System.Management.Automation.CommandNotFoundException]) { return 'COMMAND_UNAVAILABLE' }
  return 'QUERY_FAILED'
}
`;
export function windowsReadScript(kind, from, to) {
  if (kind === 'network') return PRELUDE + String.raw`
try {
  Import-Module -Name "$PSHOME\Modules\NetAdapter\NetAdapter.psd1" -ErrorAction Stop
  Import-Module -Name "$PSHOME\Modules\NetTCPIP\NetTCPIP.psd1" -ErrorAction Stop
  $adapters = @(Get-NetAdapter -ErrorAction Stop)
  $configCode = $null
  try { $configs = @(Get-NetIPConfiguration -All -ErrorAction Stop) } catch { $configs = @(); $configCode = FailureCode $_ }
  $rows = @($adapters | ForEach-Object {
    $adapter = $_
    $config = $configs | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex } | Select-Object -First 1
    $type = switch ([int]$adapter.NdisPhysicalMedium) { 14 {'ethernet'} 9 {'wifi'} 1 {'wifi'} default {'other'} }
    [ordered]@{
      name = [string]$adapter.Name; index = [int]$adapter.ifIndex; type = $type
      link = [string]$adapter.Status; virtual = [bool]$adapter.Virtual
      configurationCode = $(if ($configCode) {$configCode} elseif ($null -eq $config) {'QUERY_FAILED'} else {$null})
      addresses = @($config.IPv4Address | Where-Object { $null -ne $_ } | ForEach-Object { [ordered]@{address=[string]$_.IPAddress; prefix=[int]$_.PrefixLength} })
      gateways = @($config.IPv4DefaultGateway | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_.NextHop })
      dns = @($config.DNSServer | Where-Object { $null -ne $_ } | ForEach-Object { $_.ServerAddresses } | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })
    }
  })
  [ordered]@{status='ok'; interfaces=$rows} | ConvertTo-Json -Depth 8 -Compress
} catch { [ordered]@{status='unavailable'; code=(FailureCode $_)} | ConvertTo-Json -Compress }
`;
  if (kind === 'firewall') return PRELUDE + String.raw`
try {
  Import-Module -Name "$PSHOME\Modules\NetSecurity\NetSecurity.psd1" -ErrorAction Stop
  Import-Module -Name "$PSHOME\Modules\NetConnection\NetConnection.psd1" -ErrorAction Stop
  $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
  $activeCode = $null
  try { $active = @(Get-NetConnectionProfile -ErrorAction Stop | ForEach-Object { if ([string]$_.NetworkCategory -eq 'DomainAuthenticated') {'Domain'} else {[string]$_.NetworkCategory} } | Select-Object -Unique) }
  catch { $active = @(); $activeCode = FailureCode $_ }
  $rows = @($profiles | ForEach-Object { [ordered]@{name=[string]$_.Name; enabled=[string]$_.Enabled} })
  [ordered]@{status='ok'; profiles=$rows; active=$active; activeCode=$activeCode} | ConvertTo-Json -Depth 6 -Compress
} catch { [ordered]@{status='unavailable'; code=(FailureCode $_)} | ConvertTo-Json -Compress }
`;
  if (kind !== 'events' || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))
    || new Date(from).toISOString() !== from || new Date(to).toISOString() !== to || Date.parse(to) - Date.parse(from) !== DAY) throw Error('INVALID_READ_SCRIPT');
  return PRELUDE + `\n$begin = [DateTime]::Parse('${from}').ToUniversalTime()\n$end = [DateTime]::Parse('${to}').ToUniversalTime()\n` + String.raw`
$rows = @('System','Application' | ForEach-Object {
  $log = $_
  try {
    Import-Module -Name "$PSHOME\Modules\Microsoft.PowerShell.Diagnostics\Microsoft.PowerShell.Diagnostics.psd1" -ErrorAction Stop
    $info = Get-WinEvent -ListLog $log -ErrorAction Stop
    if (-not $info.IsEnabled) { [ordered]@{name=$log; status='unavailable'; code='LOG_DISABLED'} }
    else {
      $warnings = 0L; $errors = 0L
      try {
        Get-WinEvent -FilterHashtable @{LogName=$log; Level=2,3; StartTime=$begin; EndTime=$end} -ErrorAction Stop | ForEach-Object {
          if ($_.Level -eq 2) { $errors++ } elseif ($_.Level -eq 3) { $warnings++ }
        }
      } catch {
        if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound,*') { throw }
      }
      [ordered]@{name=$log; status='ok'; warnings=$warnings; errors=$errors}
    }
  } catch { [ordered]@{name=$log; status='unavailable'; code=(FailureCode $_)} }
})
[ordered]@{status='ok'; logs=$rows} | ConvertTo-Json -Depth 6 -Compress
`;
}

export function runWindowsRead(script, {signal} = {}) {
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {windowsHide: true, shell: false, encoding: 'utf8', timeout: 20000, maxBuffer: 512 * 1024, signal}, (error, stdout) => {
        if (error) {
          const code = error.name === 'AbortError' ? 'QUERY_CANCELLED' : error.code === 'ENOENT' ? 'COMMAND_UNAVAILABLE'
            : error.killed || error.code === 'ETIMEDOUT' ? 'QUERY_TIMEOUT' : 'QUERY_FAILED';
          reject(Object.assign(Error(code), {code})); return;
        }
        try {resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/, '')));} catch {reject(Object.assign(Error('INVALID_RESULT'), {code: 'INVALID_RESULT'}));}
      });
  });
}

function projectNetwork(raw) {
  if (!strings(raw.interfaces, plain)) throw Error('INVALID_RESULT');
  const indices = new Set();
  const interfaces = raw.interfaces.map(row => {
    if (!smallText(row.name) || !Number.isSafeInteger(row.index) || row.index < 0 || indices.has(row.index)
      || !['ethernet','wifi','other'].includes(row.type) || !smallText(row.link) || typeof row.virtual !== 'boolean') throw Error('INVALID_RESULT');
    indices.add(row.index);
    const base = {name: row.name, index: row.index, type: row.type, link: row.link, virtual: row.virtual};
    if (row.configurationCode != null) return {...base, configuration: unavailable(row.configurationCode)};
    if (!strings(row.addresses, x => plain(x) && isIP(x.address) === 4 && Number.isInteger(x.prefix) && x.prefix >= 0 && x.prefix <= 32)
      || !strings(row.gateways, address) || !strings(row.dns, address)) throw Error('INVALID_RESULT');
    return {...base, configuration: {status: 'ok', addresses: row.addresses.map(x => ({address: x.address, prefix: x.prefix})), gateways: row.gateways, dns: row.dns}};
  });
  return {status: 'ok', interfaces};
}
function projectFirewall(raw) {
  const names = ['Domain','Private','Public'];
  if (!strings(raw.profiles, row => plain(row) && names.includes(row.name) && typeof row.enabled === 'string', 3)
    || new Set(raw.profiles.map(row => row.name)).size !== raw.profiles.length) throw Error('INVALID_RESULT');
  const active = raw.activeCode != null ? unavailable(raw.activeCode)
    : strings(raw.active, name => names.includes(name), 3) ? {status: 'ok', names: [...new Set(raw.active)]} : unavailable('INVALID_RESULT');
  return {status: 'ok', active, profiles: names.map(name => {
    const row = raw.profiles.find(row => row.name === name);
    return {name, ...(!row || !['True','False'].includes(row.enabled) ? {...unavailable('INVALID_RESULT'), enabled: null}
      : {status: 'ok', enabled: row.enabled === 'True'})};
  })};
}
function projectEvents(raw) {
  if (!strings(raw.logs, row => plain(row) && ['System','Application'].includes(row.name), 2)
    || new Set(raw.logs.map(row => row.name)).size !== raw.logs.length) throw Error('INVALID_RESULT');
  return {status: 'ok', logs: ['System','Application'].map(name => {
    const row = raw.logs.find(row => row.name === name);
    return {name, ...(!row ? {...unavailable('INVALID_RESULT'), warnings: null, errors: null}
      : row.status !== 'ok' ? {...unavailable(row.code), warnings: null, errors: null}
      : count(row.warnings) && count(row.errors) ? {status: 'ok', warnings: row.warnings, errors: row.errors}
      : {...unavailable('INVALID_RESULT'), warnings: null, errors: null})};
  })};
}

export async function readConnectionStatus({runner = runWindowsRead, clock = () => new Date(), platform = process.platform, signal} = {}) {
  const to = clock().toISOString(), from = new Date(Date.parse(to) - DAY).toISOString();
  const project = {network: projectNetwork, firewall: projectFirewall, events: projectEvents};
  const entries = await Promise.all(Object.keys(project).map(async kind => {
    let result;
    if (platform !== 'win32') result = unavailable('UNSUPPORTED_PLATFORM');
    else try {
      const raw = await runner(windowsReadScript(kind, from, to), {signal});
      result = plain(raw) && raw.status === 'ok' ? project[kind](raw) : unavailable(raw?.code || 'INVALID_RESULT');
    } catch (error) {result = unavailable(error.code || (error.message === 'INVALID_RESULT' ? 'INVALID_RESULT' : 'QUERY_FAILED'));}
    return [kind, {...result, kind: 'measured', source: SOURCES[kind], checkedAt: clock().toISOString()}];
  }));
  return {schema: CONNECTION_SCHEMA, kind: 'measured', readOnly: true, checkedAt: clock().toISOString(),
    window: {from, to, hours: 24}, ...Object.fromEntries(entries)};
}
