// Student display only. OS readings and history writes belong to the local server.
export const PC_RANGES = [1, 5, 15, 30, 60, 1440];
const DAY = 86400000;
const names = {cpu: 'CPU 사용률', memory: '메모리 사용량', disk: 'C: 디스크 남은 공간'};
const units = {cpu: '%', memory: 'GiB', disk: 'GiB'};
const number = x => typeof x === 'number' && Number.isFinite(x);
const timestamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
export function validPcSample(sample) {
  if (!sample || sample.kind !== 'measured' || !timestamp(sample.measuredAt)) return false;
  return Object.keys(names).every(key => {
    const m = sample[key];
    if (!m || m.unit !== units[key] || !timestamp(m.measuredAt) || typeof m.source !== 'string'
      || !m.source || m.source.length > 180 || typeof m.scope !== 'string' && m.status === 'ok') return false;
    if (m.status === 'unavailable') return m.value === null && typeof m.reason === 'string' && m.reason.length > 0 && m.reason.length <= 200;
    return m.status === 'ok' && number(m.value) && m.value >= 0 && number(m.percent) && m.percent >= 0 && m.percent <= 100
      && (key === 'cpu' ? m.value <= 100 : number(m.totalGiB) && m.totalGiB > 0 && m.value <= m.totalGiB);
  });
}
export function validPcPayload(data, withHistory = false) {
  return data?.schema === 'keshev.pc-status.v1' && data.kind === 'measured'
    && data.intervalMs === 5000 && data.retentionHours === 24 && data.disk === 'C:' && timestamp(data.servedAt)
    && (data.nextSampleAt === undefined || data.nextSampleAt === null || timestamp(data.nextSampleAt))
    && ['ok', 'unavailable'].includes(data.storage?.status) && typeof data.storage.reason === 'string'
    && data.storage.reason.length <= 200
    && (data.latest === null || validPcSample(data.latest))
    && (!withHistory || Array.isArray(data.history) && data.history.length <= 17281 && data.history.every(validPcSample));
}
export function mergePcHistory(history, sample, now = Date.now()) {
  const byTime = new Map();
  for (const row of [...history, ...(sample ? [sample] : [])]) {
    if (!validPcSample(row)) continue;
    const time = Date.parse(row.measuredAt);
    if (time > now - DAY && time <= now + 5000) byTime.set(row.measuredAt, row);
  }
  return [...byTime.values()].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt)).slice(-17281);
}
export function pcDifference(current, previous, key) {
  const a = current?.[key], b = previous?.[key];
  if (a?.status !== 'ok' || b?.status !== 'ok') return '직전 값과 비교 불가 · 두 시점의 실측값이 필요합니다.';
  if (a.scope !== b.scope || a.unit !== b.unit || key !== 'cpu' && a.totalGiB !== b.totalGiB) return '비교 불가 · 측정 범위 또는 전체 용량이 달라졌습니다.';
  const elapsed = Date.parse(current.measuredAt) - Date.parse(previous.measuredAt);
  if (elapsed <= 0) return '비교 불가 · 측정 시각 순서를 확인할 수 없습니다.';
  const delta = a.value - b.value, precision = key === 'cpu' ? 2 : 3;
  const unit = key === 'cpu' ? '%p' : 'GiB';
  const rounded = Math.abs(delta).toFixed(precision);
  const magnitude = Number(rounded) === 0 && delta !== 0 ? '0.' + '0'.repeat(precision - 1) + '1 미만' : rounded;
  const change = delta === 0 ? '변화 없음' : magnitude + ' ' + unit + (delta > 0 ? ' 증가' : ' 감소');
  return change + ' · ' + Math.round(elapsed / 1000) + '초 전 측정과 비교';
}
export function pcSeries(rows, key, rangeMinutes, now = Date.now()) {
  const start = now - rangeMinutes * 60000;
  const inRange = rows.filter(row => Date.parse(row.measuredAt) >= start && Date.parse(row.measuredAt) <= now);
  const segments = []; let segment = [], previousTime = null;
  for (const row of inRange) {
    const m = row[key], time = Date.parse(row.measuredAt);
    if (m.status !== 'ok' || previousTime !== null && time - previousTime > 7500) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (m.status === 'ok') segment.push({at: time, value: m.value});
    previousTime = time;
  }
  if (segment.length) segments.push(segment);
  return segments;
}
const formatTime = value => timestamp(value)
  ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour12: false,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(value))
  : '확인 불가';
const clockLabel = ms => new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour12: false,
  hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(ms));

const plotDrawers = new WeakMap();
// Called by the host after mounting; one observer per rendered slot, disconnected before its next redraw.
export function activatePcCharts(root) {
  const plots = [...root.querySelectorAll('[data-pc-plot]')];
  for (const plot of plots) plotDrawers.get(plot)?.();
  if (typeof ResizeObserver !== 'function') return () => {};
  const observer = new ResizeObserver(entries => {for (const entry of entries) plotDrawers.get(entry.target)?.();});
  for (const plot of plots) observer.observe(plot);
  return () => observer.disconnect();
}
function addTrend(plot, history, key, rangeMinutes, now) {
  plot.setAttribute('data-pc-plot', key);
  const draw = () => {
    const make = (tag, attrs = {}, text) => {const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); if (text !== undefined) node.textContent = text; return node;};
    const width = Math.max(150, Math.floor(plot.getBoundingClientRect?.().width || 360)), height = 190;
    const left = width < 220 ? 41 : 53, right = width - 16, top = 20, bottom = 143;
    const segments = pcSeries(history, key, rangeMinutes, now);
    const limit = key === 'cpu' ? 100 : Math.max(1, ...history.map(row => row[key].status === 'ok' ? row[key].totalGiB : 0));
    const start = now - rangeMinutes * 60000, x = at => left + 8 + (at - start) / (now - start) * (right - left - 16), y = value => bottom - value / limit * (bottom - top);
    const svg = make('svg', {viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': names[key] + ' 실측 추이 · KST · ' + units[key]});
    svg.appendChild(make('title', {}, names[key] + ' 실측 기록 · 미측정/실패 구간은 공백'));
    svg.appendChild(make('text', {x: 6, y: 12, class: 'pc-axis'}, units[key]));
    for (const portion of [0, .5, 1]) {
      const yy = y(limit * portion); svg.appendChild(make('line', {x1: left, y1: yy, x2: right, y2: yy, class: 'pc-grid'}));
      svg.appendChild(make('text', {x: left - 7, y: yy + 4, 'text-anchor': 'end', class: 'pc-axis'}, (limit * portion).toFixed(key === 'cpu' ? 0 : 1)));
    }
    for (const portion of width < 350 ? [0, 1] : [0, .5, 1]) {
      const at = start + portion * (now - start);
      const label = rangeMinutes >= 1440 ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', ...(width >= 290 ? {hour: '2-digit', minute: '2-digit', hour12: false} : {})}).format(new Date(at)) : clockLabel(at).slice(0, 5);
      svg.appendChild(make('text', {x: left + portion * (right - left), y: 163, 'text-anchor': portion === 0 ? 'start' : portion === 1 ? 'end' : 'middle', class: 'pc-axis'}, label));
    }
    svg.appendChild(make('text', {x: (left + right) / 2, y: 185, 'text-anchor': 'middle', class: 'pc-axis'}, '시각 (KST)'));
    for (const segment of segments) {
      // Preserve observed extrema and gaps when 24h contains more points than the plot can show.
      const points = []; const step = segment.length > width * 2 ? Math.ceil(segment.length / Math.max(1, Math.floor(width / 3))) : 1;
      for (let i = 0; i < segment.length; i += step) {
        const bucket = segment.slice(i, i + step), selected = [bucket[0], bucket.at(-1), bucket.reduce((a, b) => a.value < b.value ? a : b), bucket.reduce((a, b) => a.value > b.value ? a : b)];
        points.push(...[...new Set(selected)].sort((a, b) => a.at - b.at));
      }
      const path = points.map((p, i) => (i ? 'L' : 'M') + x(p.at).toFixed(2) + ',' + y(p.value).toFixed(2)).join(' ');
      if (points.length > 1) svg.appendChild(make('path', {d: path + ' L' + x(points.at(-1).at).toFixed(2) + ',' + bottom + ' L' + x(points[0].at).toFixed(2) + ',' + bottom + ' Z', class: 'pc-area'}));
      svg.appendChild(make('path', {d: path, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke'}));
      if (points.length === 1) svg.appendChild(make('circle', {cx: x(points[0].at), cy: y(points[0].value), r: 3, fill: 'currentColor'}));
    }
    if (!segments.length) svg.appendChild(make('text', {x: (left + right) / 2, y: 87, 'text-anchor': 'middle', class: 'pc-axis'}, '선택 범위의 실측값 없음'));
    if (typeof plot.replaceChildren === 'function') plot.replaceChildren(svg); else plot.appendChild(svg);
  };
  plotDrawers.set(plot, draw); draw();
}

export function renderPcStatusView({status = 'idle', data, error, rangeMinutes = 5, recording = false, paused = false, compact = false, sidePanel} = {}) {
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = element('div', undefined, 'pc-dashboard' + (compact ? ' pc-compact' : ''));
  const failure = (title, reason, next) => {
    const box = element('section', undefined, 'feedback-error'); box.setAttribute('role', 'alert');
    box.appendChild(element('h3', title)); box.appendChild(element('p', '확인 불가 · ' + reason));
    box.appendChild(element('p', '다음 할 일: ' + next, 'feedback-next')); return box;
  };
  // Controls have a stable host mount so five-second redraws do not replace a focused select.
  const runState = element('p', recording ? '실측 자동 갱신 중 · 5초 간격'
    : paused ? '요청 실패로 자동 갱신 중지 · 다시 조회로 다시 시작하세요.' : '자동 측정 대기 · 이 화면을 보고 있을 때만 수집합니다.', 'pc-run-state');
  root.appendChild(runState);
  const provenance = element('p', '직접 추가한 PC 실측 기능 · 보안 엔진 연결 상태와 별개입니다. 예제값을 사용하지 않습니다.', 'pc-provenance-note');
  if (!compact) root.appendChild(provenance);
  if (error) root.appendChild(failure((error.stage === 'history' ? 'PC 기록 복원' : error.stage === 'sample' ? 'CPU·메모리·C: 실측 조회' : 'PC 상태 조회') + ' 실패',
    (error.message || 'PC 상태 요청을 완료하지 못했습니다.') + ' · 이전 기록을 새 측정으로 표시하지 않습니다.',
    '실행 중인 앱 서버와 오류 이유를 확인한 뒤 위의 다시 조회를 누르세요. 기록 파일은 삭제하지 마세요.'));
  if (!validPcPayload(data, true)) {
    root.appendChild(element('p', status === 'loading' ? '실제 PC 상태를 읽는 중입니다.' : '확인 불가 · 아직 검증된 PC 측정 자료가 없습니다.', 'state'));
    if (sidePanel) root.appendChild(sidePanel);
    return root;
  }
  const now = Date.now();
  const history = mergePcHistory(data.history, null, now);
  const latest = data.latest && Date.parse(data.latest.measuredAt) > now - DAY ? data.latest : history.at(-1);
  if (data.storage.status !== 'ok') root.appendChild(failure('PC 기록 보관 실패', data.storage.reason,
    '저장 위치와 일반 사용자 권한을 확인한 뒤 다시 조회하세요. 기존 기록을 지우거나 관리자 권한으로 실행하지 마세요.'));
  const recordInfo = element('p', '최근 24시간 로컬 기록 ' + history.length + '건 · KST · 1 GiB = 1,073,741,824 bytes. 보호 현황·내 PC 상태를 모두 떠난 시간과 조회 실패 구간은 채우지 않습니다.', 'muted');
  if (!compact) root.appendChild(recordInfo);
  if (!latest) {
    root.appendChild(element('p', '보관된 실측 기록이 없습니다. 첫 측정을 기다리거나 다시 조회를 누르세요.', 'state'));
    if (sidePanel) root.appendChild(sidePanel);
    return root;
  }
  const age = Math.max(0, Math.floor((now - Date.parse(latest.measuredAt)) / 1000));
  const historical = age > 15 || status === 'error';
  const showLastInfo = !compact || historical || status === 'loading';
  const lastInfo = element('p', '마지막 실제 측정: ' + formatTime(latest.measuredAt) + ' KST · ' + age + '초 전'
    + (historical ? ' · 과거 기록, 현재 상태로 단정할 수 없습니다.'
      : status === 'loading' ? ' · 새 측정 조회 중 · 마지막 실측값 표시' : ''), 'muted');
  if (showLastInfo) root.appendChild(lastInfo);
  const previous = history.filter(row => Date.parse(row.measuredAt) < Date.parse(latest.measuredAt)).at(-1);
  const cards = element('div', undefined, 'pc-metrics');
  for (const key of Object.keys(names)) {
    const metric = latest[key], card = element('section', undefined, 'card pc-metric');
    card.appendChild(element('h3', names[key]));
    const value = element('p', undefined, 'pc-value');
    value.appendChild(element('span', metric.status === 'ok' ? metric.value.toFixed(key === 'cpu' ? 1 : 2) : '확인 불가'));
    if (metric.status === 'ok') value.appendChild(element('span', ' ' + metric.unit, 'pc-unit'));
    card.appendChild(value);
    if (metric.status === 'ok' && key !== 'cpu') card.appendChild(element('p',
      (key === 'disk' ? '남음 ' : '사용 ') + metric.percent.toFixed(1) + '% · 전체 ' + metric.totalGiB.toFixed(2) + ' GiB', 'muted'));
    if (metric.status !== 'ok') card.appendChild(failure(names[key] + ' 읽기 실패', metric.reason,
      '표시된 읽기 실패 이유와 측정 방법을 확인한 뒤 위의 다시 조회를 누르세요. 일반 권한으로 읽지 못하면 확인 불가로 남깁니다.'));
    card.appendChild(element('p', pcDifference(latest, previous, key), 'pc-difference'));
    if (previous && !compact) card.appendChild(element('p', '비교 기준: ' + formatTime(previous[key].measuredAt) + ' KST', 'pc-metric-foot'));
    card.appendChild(element('p', '잰 시각: ' + formatTime(metric.measuredAt) + ' KST', 'pc-metric-foot'));
    if (key === 'cpu' || key === 'memory') {
      const plot = element('div', undefined, 'pc-chart-plot'); addTrend(plot, history, key, rangeMinutes, now); card.appendChild(plot);
    } else {
      if (metric.status === 'ok') {
        const meter = element('div', undefined, 'pc-space-meter');
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', 'C: 디스크 남은 공간 비율'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', metric.percent.toFixed(1));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 10'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({x: 0, y: 0, width: metric.percent, height: 10, class: 'pc-space-fill'})) rect.setAttribute(key, String(value));
        svg.appendChild(rect); meter.appendChild(svg); card.appendChild(meter);
        card.appendChild(element('p', '보라색: 가용 공간 · 회색: 사용·예약 등 나머지 공간', 'pc-metric-foot'));
      }
      if (!compact) {
        const trend = element('details', undefined, 'pc-help pc-disk-trend'); trend.setAttribute('data-preserve-key', 'disk-trend');
        const summary = element('summary', '디스크 공간 추이 보기'); summary.setAttribute('data-focus-key', 'disk-trend'); trend.appendChild(summary);
        const plot = element('div', undefined, 'pc-chart-plot'); addTrend(plot, history, key, rangeMinutes, now); trend.appendChild(plot); card.appendChild(trend);
      }
    }
    cards.appendChild(card);
  }
  if (sidePanel) cards.appendChild(sidePanel);
  root.appendChild(cards);
  const evidence = element('details', undefined, 'card pc-evidence');
  evidence.setAttribute('data-preserve-key', 'pc-evidence');
  const evidenceSummary = element('summary', '측정 근거·출처·시각 보기'); evidenceSummary.setAttribute('data-focus-key', 'pc-evidence'); evidence.appendChild(evidenceSummary);
  if (compact) {evidence.appendChild(provenance); evidence.appendChild(recordInfo); if (!showLastInfo) evidence.appendChild(lastInfo);}
  evidence.appendChild(element('h3', '측정 근거 · 직접 추가'));
  const tableWrap = element('div', undefined, 'pc-table-wrap'), table = element('table');
  table.appendChild(element('caption', '항목별 실제 조회 출처·측정 범위·단위·잰 시각', 'sr-only'));
  const head = element('thead'), headings = element('tr');
  for (const label of ['항목', '출처 · 측정 범위', '단위', '잰 시각 (KST)', '직전 비교 기준 (KST)']) {
    const th = element('th', label); th.setAttribute('scope', 'col'); headings.appendChild(th);
  }
  head.appendChild(headings); table.appendChild(head);
  const body = element('tbody');
  for (const key of Object.keys(names)) {
    const metric = latest[key], row = element('tr'), label = element('th', names[key]);
    label.setAttribute('scope', 'row'); row.appendChild(label);
    const source = element('td');
    source.appendChild(element('span', metric.source));
    source.appendChild(element('small', metric.scope || '측정 범위 확인 불가', 'pc-source-scope'));
    if (metric.status !== 'ok') source.appendChild(element('small', '확인 불가 · ' + metric.reason, 'pc-source-scope'));
    row.appendChild(source); row.appendChild(element('td', metric.unit));
    row.appendChild(element('td', formatTime(metric.measuredAt), 'pc-evidence-time'));
    row.appendChild(element('td', previous ? formatTime(previous[key].measuredAt) : '비교 자료 없음', 'pc-evidence-time'));
    body.appendChild(row);
  }
  table.appendChild(body); tableWrap.appendChild(table); evidence.appendChild(tableWrap); root.appendChild(evidence);
  const details = element('details', undefined, 'pc-help'), summary = element('summary', '측정 방법과 작업 관리자 비교 안내');
  details.setAttribute('data-preserve-key', 'pc-help'); summary.setAttribute('data-focus-key', 'pc-help');
  details.appendChild(summary);
  details.appendChild(element('p', 'CPU는 약 1초 동안 전체 논리 CPU 시간의 차이로 계산한 사용 비율입니다. 작업 관리자의 갱신 시각·주파수 보정·집계 방식과 다를 수 있습니다. %p는 퍼센트포인트입니다.'));
  details.appendChild(element('p', '메모리는 전체 물리 메모리에서 OS가 보고한 가용량을 뺀 값입니다. C:는 일반 사용자가 이용 가능한 남은 공간입니다. 디스크 활동률(%)과 남은 공간은 다른 지표이므로 파일 탐색기의 C: 속성으로 공간을 비교하세요.'));
  details.appendChild(element('p', 'Ctrl+Shift+Esc → 성능에서 가까운 시각의 CPU·메모리를 같은 단위로 비교하세요. 숫자 차이가 있으면 먼저 측정 시점과 집계 범위를 확인하세요. 이번 화면은 위험 탐지나 안전 판정이 아닙니다.'));
  root.appendChild(details);
  return root;
}
