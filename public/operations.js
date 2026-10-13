import { summarize } from './operations-model.js';
const byId = id => document.getElementById(id);
const time = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '—';
const result = row => row.status !== 'observed' ? '미실행' : `HTTP ${row.httpStatus} · ${row.matchesExpected ? '기대 일치' : '기대 불일치'}`;
const counts = rows => { const n = summarize(rows); return `실측 ${n.observed} / ${n.total} · 기대 일치 ${n.matched} · 불일치 ${n.mismatched} · 미실행 ${n.notRun}`; };
function table(id, rows, label, expected) {
  byId(id).replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const value of [label(row), expected(row), result(row), row.requestId ?? '미제공', time(row.checkedAt)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    return tr;
  }));
}
let revision = 0;
async function load() {
  const current = ++revision;
  byId('room').hidden = true;
  byId('refresh').disabled = true;
  byId('status').textContent = '가린 서버 기록을 읽는 중입니다.';
  try {
    const response = await fetch('/api/operations', { cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error();
    const d = await response.json();
    if (d.schema !== 'byteback.operations.v1' || !Array.isArray(d.stageChecks) || d.stageChecks.length !== 22
        || !Array.isArray(d.officialChecks) || d.officialChecks.length !== 41 || !Array.isArray(d.probes)) throw new Error();
    if (current !== revision) return;
    byId('revision').textContent = `기록 시각 ${time(d.recordedAt)} · 검사 기준 ${d.inspectedCommit} · 관측 배포 ${d.deployedCommit ?? '미확인'} (단계 ${d.deployedStep ?? '미확인'}) · 현재 제공 커밋 ${d.servingCommit ?? '로컬 / 미확인'}. 이 기록은 저장된 관측이며 현재 배포와 같다고 가정하지 않습니다.`;
    byId('policy').textContent = `구현 규칙 ${d.policy.rules.length}개 · 운영 판정 실측 미실행`;
    byId('rules').replaceChildren(...[...d.policy.rules, ...d.policy.detectionRules, ...d.policy.deviceRules, ...d.policy.recoveryRules].map(rule => {
      const li = document.createElement('li'); li.textContent = rule; return li;
    }));
    byId('detection').textContent = `미확인 · ${d.detection.reason}`;
    byId('revocation').textContent = `미확인 · ${d.revocation.reason}`;
    byId('recovery').textContent = `운영 복구 미실행 · 기준 사본 ${d.recovery.copyMatchesBaseline ? '해시 일치' : '해시 불일치'}`;
    byId('baseline').textContent = `로컬 정책 시험용 버전 ${d.recovery.baselineCommit} · SHA-256 ${d.recovery.baselineSha256}`;
    byId('official-count').textContent = counts(d.officialChecks);
    byId('official').replaceChildren(...d.officialChecks.map((row, index) => {
      const li = document.createElement('li'); li.textContent = `${index + 1}. ${row.status === 'not_run' ? '미실행' : '기록 확인 필요'}`; return li;
    }));
    byId('stage-count').textContent = counts(d.stageChecks);
    byId('probe-count').textContent = counts(d.probes);
    table('stages', d.stageChecks, row => `${row.step} · ${row.kind === 'normal' ? '정상' : '금지'}`, row => row.expected);
    table('probes', d.probes, row => `${row.method} ${row.path}`, row => row.expected);
    byId('room').hidden = false;
    byId('status').textContent = '서버 기록을 읽었습니다. 심판 판정은 별도 확인이 필요합니다.';
  } catch { if (current === revision) byId('status').textContent = '서버 기록을 읽지 못했습니다. 이전 수치로 성공을 표시하지 않습니다.'; }
  finally { if (current === revision) byId('refresh').disabled = false; }
}
byId('refresh').addEventListener('click', load);
window.addEventListener('offline', () => { ++revision; byId('room').hidden = true; byId('refresh').disabled = false; byId('status').textContent = '오프라인 · 서버 기록 미확인'; });
void load();
