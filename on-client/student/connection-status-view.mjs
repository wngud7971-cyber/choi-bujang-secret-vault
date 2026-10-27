// Display only: never invokes Windows commands or changes settings.
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 400 && !/[\x00-\x1f\x7f]/.test(x);
const time = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const list = (x, check, max = 64) => Array.isArray(x) && x.length <= max && x.every(check);
const unavailable = x => record(x) && x.status === 'unavailable' && text(x.reason) && text(x.code);
const observation = x => record(x) && x.kind === 'measured' && time(x.checkedAt) && text(x.source) && (x.status === 'ok' || unavailable(x));
const count = x => Number.isSafeInteger(x) && x >= 0;
export function validConnectionPayload(data) {
  if (!record(data) || data.schema !== 'keshev.connection-status.v1' || data.kind !== 'measured' || data.readOnly !== true || !time(data.checkedAt)
    || !record(data.window) || data.window.hours !== 24 || !time(data.window.from) || !time(data.window.to)
    || Date.parse(data.window.to) - Date.parse(data.window.from) !== 86400000
    || !['network','firewall','events'].every(key => observation(data[key]))) return false;
  if (data.network.status === 'ok' && !list(data.network.interfaces, row => record(row) && text(row.name) && text(row.link)
    && ['ethernet','wifi','other'].includes(row.type) && typeof row.virtual === 'boolean'
    && (unavailable(row.configuration) || record(row.configuration) && row.configuration.status === 'ok'
      && list(row.configuration.addresses, x => record(x) && text(x.address) && Number.isInteger(x.prefix) && x.prefix >= 0 && x.prefix <= 32)
      && list(row.configuration.gateways, text) && list(row.configuration.dns, text)))) return false;
  const profiles = ['Domain','Private','Public'];
  if (data.firewall.status === 'ok' && (!(unavailable(data.firewall.active) || data.firewall.active?.status === 'ok' && list(data.firewall.active.names, x => profiles.includes(x), 3))
    || !list(data.firewall.profiles, x => record(x) && profiles.includes(x.name) && (unavailable(x) && x.enabled === null || x.status === 'ok' && typeof x.enabled === 'boolean'), 3)
    || new Set(data.firewall.profiles.map(x => x.name)).size !== 3)) return false;
  if (data.events.status === 'ok' && (!list(data.events.logs, x => record(x) && ['System','Application'].includes(x.name)
    && (unavailable(x) && x.warnings === null && x.errors === null || x.status === 'ok' && count(x.warnings) && count(x.errors)), 2)
    || new Set(data.events.logs.map(x => x.name)).size !== 2)) return false;
  return record(data.sdp) && ['connected','disconnected','unavailable'].includes(data.sdp.status)
    && time(data.sdp.checkedAt) && text(data.sdp.source) && (data.sdp.status === 'connected' || text(data.sdp.reason));
}
const at = value => time(value) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour12: false,
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(value)) + ' KST' : '확인 불가';
export function renderWindowsEventSummary({status = 'idle', data, error} = {}, {embedded = false} = {}) {
  const el = (tag, value, cls) => {const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (cls) node.className = cls; return node;};
  const root = el(embedded ? 'div' : 'section', undefined, embedded ? 'windows-summary' : 'card windows-event-summary');
  if (!embedded) root.appendChild(el('h3', 'Windows 경고·오류'));
  root.appendChild(el('p', '최근 24시간 · 침해 판정 아님', 'pc-metric-foot'));
  if (!validConnectionPayload(data)) {
    root.appendChild(el('p', status === 'loading' ? 'Windows 기록을 읽는 중…' : '확인 불가 · 아직 검증된 Windows 조회 자료가 없습니다.', 'state state-empty'));
    if (error?.message) root.appendChild(el('p', error.message, 'feedback-next'));
    root.appendChild(el('p', '다음 할 일: 위의 다시 조회 또는 연결과 기록 메뉴에서 조회하세요. 보안 설정은 변경하지 않습니다.', 'feedback-next'));
    return root;
  }
  const old = status !== 'ok' || Date.now() - Date.parse(data.checkedAt) > 60000;
  if (old) root.appendChild(el('p', '이전 조회 기록 · 현재 결과로 해석하지 마세요.' + (error?.message ? ' ' + error.message : ''), 'feedback-next'));
  if (data.events.status !== 'ok') {
    root.appendChild(el('p', '확인 불가 · ' + data.events.reason, 'state state-error'));
    root.appendChild(el('p', '다음 할 일: 실패 이유를 확인한 뒤 다시 조회하세요. 관리자 실행이나 로그 설정 변경은 하지 마세요.', 'feedback-next'));
  } else {
    const values = data.events.logs.filter(log => log.status === 'ok').flatMap(log => [log.warnings, log.errors]);
    const max = Math.max(1, Math.ceil(Math.max(0, ...values) / 5) * 5);
    const legend = el('div', undefined, 'event-legend');
    legend.appendChild(el('span', '경고', 'event-key event-warning')); legend.appendChild(el('span', '오류', 'event-key event-error')); root.appendChild(legend);
    for (const log of data.events.logs) {
      const group = el('section', undefined, 'event-bar-group'); group.appendChild(el('h4', log.name));
      if (log.status !== 'ok') {
        group.appendChild(el('p', '확인 불가 · ' + log.reason, 'feedback-next'));
        group.appendChild(el('p', '다음 할 일: 일반 권한으로 읽을 수 있는지 확인한 뒤 다시 조회하세요.', 'pc-metric-foot'));
      } else for (const [key, label, cls] of [['warnings','경고','event-warning'], ['errors','오류','event-error']]) {
        const row = el('div', undefined, 'event-bar-row'); row.appendChild(el('span', label));
        if (typeof document.createElementNS === 'function') {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          for (const [attribute, value] of Object.entries({viewBox: '0 0 100 8', preserveAspectRatio: 'none', role: 'img', 'aria-label': log.name + ' ' + label + ' ' + log[key] + '건', class: 'event-bar ' + cls})) svg.setAttribute(attribute, String(value));
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const [attribute, value] of Object.entries({x: 0, y: 0, width: log[key] / max * 100, height: 8, rx: 1})) rect.setAttribute(attribute, String(value));
          svg.appendChild(rect); row.appendChild(svg);
        } else row.appendChild(el('span', '그래프 표시 미지원', 'pc-metric-foot'));
        row.appendChild(el('span', log[key].toLocaleString('ko-KR') + '건', 'event-count')); group.appendChild(row);
      }
      root.appendChild(group);
    }
    root.appendChild(el('p', values.length ? '막대 눈금: 0 ~ ' + max.toLocaleString('ko-KR') + '건 · 확인 불가 로그는 막대를 만들지 않습니다.' : '로그 건수 확인 불가 · 표시할 수 있는 막대가 없습니다.', 'pc-metric-foot'));
  }
  if (!embedded) {
    root.appendChild(el('p', '집계: ' + at(data.window.from) + ' ~ ' + at(data.window.to), 'pc-metric-foot'));
    root.appendChild(el('p', '출처: ' + data.events.source, 'pc-metric-foot'));
    root.appendChild(el('p', '조회 시각: ' + at(data.events.checkedAt), 'pc-metric-foot'));
  }
  return root;
}
export function renderConnectionStatusView({status = 'idle', data, error} = {}) {
  const el = (tag, value, cls) => {const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (cls) node.className = cls; return node;};
  const root = el('div', undefined, 'connection-dashboard');
  const failure = (title, reason) => {
    const box = el('section', undefined, 'feedback-error'); box.setAttribute('role', 'alert');
    box.appendChild(el('h3', title + ' 확인 불가')); box.appendChild(el('p', reason));
    box.appendChild(el('p', '다음 할 일: 표시된 이유와 앱 서버 실행 상태를 확인한 뒤 위의 다시 조회를 누르세요. 권한이 없으면 관리자 실행이나 보안 설정 변경을 하지 마세요.', 'feedback-next'));
    return box;
  };
  root.appendChild(el('p', '실제 PC 조회 · 읽기 전용 · 예제값으로 대체하지 않습니다.', 'connection-readonly'));
  root.appendChild(el('p', 'Windows 경고·오류 건수는 침해나 공격 탐지 결과가 아닙니다. 0건도 PC가 안전하다는 뜻은 아닙니다.', 'connection-disclaimer'));
  if (status === 'loading') root.appendChild(el('p', '네트워크·방화벽·최근 Windows 기록을 읽는 중입니다. 설정은 변경하지 않습니다.', 'state state-loading'));
  if (status === 'error') root.appendChild(failure('네트워크·방화벽·Windows 기록 조회',
    (error?.message || '조회 요청을 완료하지 못했습니다.') + ' · 이전 자료를 현재 결과로 표시하지 않습니다.'));
  if (!validConnectionPayload(data)) {
    root.appendChild(el('p', '아직 검증된 조회 결과가 없습니다. 화면 위의 다시 조회를 누르세요.', 'state state-empty'));
    return root;
  }
  const old = status !== 'ok' || Date.now() - Date.parse(data.checkedAt) > 60000;
  root.appendChild(el('p', (old ? '이전 조회 기록 · 현재 상태는 다시 조회해 확인하세요. ' : '마지막 실제 조회: ') + at(data.checkedAt)
    + ' · 화면 진입 시 1회 / 수동 갱신', 'muted'));
  const content = el('div', undefined, 'connection-panels');
  const panel = (title, item) => {
    const node = el('section', undefined, 'card connection-panel'); node.appendChild(el('h2', title));
    if (item.status === 'unavailable') node.appendChild(failure(title, item.reason));
    return node;
  };
  const source = (node, item) => {
    node.appendChild(el('p', '출처: ' + item.source, 'connection-source'));
    node.appendChild(el('p', '조회 시각: ' + at(item.checkedAt), 'connection-source'));
  };
  const table = (node, labels, rows, caption) => {
    const wrap = el('div', undefined, 'connection-table-wrap'), t = el('table'), head = el('thead'), tr = el('tr'), body = el('tbody');
    t.appendChild(el('caption', caption, 'sr-only'));
    for (const label of labels) {const th = el('th', label); th.setAttribute('scope', 'col'); tr.appendChild(th);}
    head.appendChild(tr); t.appendChild(head);
    for (const cells of rows) {const row = el('tr'); cells.forEach((value, i) => {const cell = el(i === 0 ? 'th' : 'td', value); if (i === 0) cell.setAttribute('scope', 'row'); row.appendChild(cell);}); body.appendChild(row);}
    t.appendChild(body); wrap.appendChild(t); node.appendChild(wrap);
  };
  const network = panel('네트워크 구성', data.network);
  if (data.network.status === 'ok') {
    const rows = data.network.interfaces;
    const failed = rows.filter(row => row.configuration.status !== 'ok');
    if (failed.length) network.appendChild(failure('네트워크 IP 구성', failed.length + '개 어댑터의 IP 구성을 읽지 못했습니다. 항목별 이유는 아래 표를 확인하세요.'));
    network.appendChild(el('p', '연결 상태는 어댑터 기준이며 인터넷 접속 성공 판정이 아닙니다.', 'muted'));
    if (!rows.length) network.appendChild(el('p', '조회된 네트워크 어댑터가 없습니다.', 'state state-empty'));
    else table(network, ['어댑터 · 종류', '연결 상태', 'IPv4 / 접두사', '게이트웨이', 'DNS'], rows.map(row => {
      const config = row.configuration, link = {Up: '연결됨', Disconnected: '연결 끊김', Disabled: '비활성', NotPresent: '장치 없음', Dormant: '대기 중', Testing: '점검 중', LowerLayerDown: '하위 연결 끊김'}[row.link] || '확인 불가 (Windows 상태: ' + row.link + ')';
      const missing = config.status !== 'ok' ? '확인 불가 · ' + config.reason : null;
      return [row.name + ' · ' + ({ethernet: '유선', wifi: '무선', other: '기타'}[row.type]) + (row.virtual ? ' · 가상' : ''), link,
        missing || config.addresses.map(x => x.address + '/' + x.prefix).join(', ') || 'IPv4 설정 없음',
        missing || config.gateways.join(', ') || '설정 없음', missing || config.dns.join(', ') || '설정 없음'];
    }), '네트워크 어댑터별 현재 연결과 IP 구성');
  }
  source(network, data.network); content.appendChild(network);
  const firewall = panel('방화벽 설정 · 읽기만 함', data.firewall);
  if (data.firewall.status === 'ok') {
    const active = data.firewall.active;
    if (active.status !== 'ok') firewall.appendChild(failure('현재 적용 방화벽 프로필', active.reason));
    if (data.firewall.profiles.some(row => row.status !== 'ok')) firewall.appendChild(failure('방화벽 프로필 설정', '일부 프로필 설정을 읽지 못했습니다. 아래 표의 프로필별 이유를 확인하세요.'));
    firewall.appendChild(el('p', active.status === 'ok' ? '현재 네트워크 프로필: ' + (active.names.join(', ') || '조회된 활성 프로필 없음')
      : '현재 적용 프로필 확인 불가 · ' + active.reason, 'muted'));
    table(firewall, ['프로필', '방화벽 설정', '현재 적용 여부'], data.firewall.profiles.map(row => [
      {Domain:'도메인',Private:'개인',Public:'공용'}[row.name], row.status === 'ok' ? row.enabled ? '켜짐' : '꺼짐' : '확인 불가 · ' + row.reason,
      active.status !== 'ok' ? '확인 불가' : active.names.includes(row.name) ? '현재 네트워크에 적용' : '현재 적용 프로필 아님',
    ]), '프로필별 Windows 방화벽의 현재 유효 설정');
  }
  source(firewall, data.firewall); content.appendChild(firewall);
  const events = panel('Windows 경고·오류 · 침해 판정 아님', data.events);
  events.appendChild(renderWindowsEventSummary({status, data, error}, {embedded: true}));
  events.appendChild(el('p', '집계 기간: ' + at(data.window.from) + ' ~ ' + at(data.window.to) + ' · 최근 24시간', 'muted'));
  events.appendChild(el('p', '현재 PC에 보관되어 읽을 수 있는 System·Application의 경고와 오류만 집계합니다.', 'muted'));
  if (data.events.status === 'ok') table(events, ['Windows 로그', '경고', '오류', '조회 결과'], data.events.logs.map(row => [row.name,
    row.status === 'ok' ? row.warnings.toLocaleString('ko-KR') + '건' : '확인 불가',
    row.status === 'ok' ? row.errors.toLocaleString('ko-KR') + '건' : '확인 불가', row.status === 'ok' ? '실제 조회 · 침해 판정 아님' : row.reason,
  ]), 'Windows 로그별 최근 24시간 경고 및 오류 건수');
  if (data.events.status === 'ok') for (const log of data.events.logs) if (log.status !== 'ok') events.appendChild(failure('Windows ' + log.name + ' 집계', log.reason));
  source(events, data.events);
  const sdp = panel('SDP 서버 · PC 조회와 별도', data.sdp);
  sdp.appendChild(el('p', (old ? '이전 조회: ' : '') + (data.sdp.status === 'connected' ? 'SDP 연결 확인됨' : data.sdp.status === 'disconnected' ? 'SDP 미연결' : 'SDP 연결 확인 불가'), 'connection-sdp-state'));
  if (data.sdp.status === 'disconnected') sdp.appendChild(el('p', data.sdp.reason, 'muted'));
  if (data.sdp.status === 'disconnected') sdp.appendChild(el('p', '다음 할 일: 실제 SDP 연결이 필요하면 담당자의 연결 안내를 확인하세요. 다시 조회만으로 연결이 설정되지는 않습니다.', 'feedback-next'));
  sdp.appendChild(el('p', 'PC 조회 성공이나 네트워크 어댑터 연결을 SDP 연결 성공으로 취급하지 않습니다.', 'muted'));
  source(sdp, data.sdp); content.appendChild(sdp);
  content.appendChild(events);
  root.appendChild(content);
  return root;
}
