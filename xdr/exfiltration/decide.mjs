// Standalone offline judgment: evidence only, no storage or connection effects.
const PATTERNS = [
  {
    "id": "unfamiliar-bulk-transfer",
    "name": "낯선 목적지의 대량 자료 전송",
    "technique": "T1048",
    "condition": "처음 보는 목적지·실제 외부 전송·50MB 이상·100개 이상 파일이 함께 있음.",
    "evidence": "대체 프로토콜 유출 T1048 관점의 대량 반출 후보이며 프로토콜 자체는 경보에 없어 확정하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.93
  },
  {
    "id": "offhours-archive-transfer",
    "name": "시간 밖 낯선 목적지의 압축 파일 반출",
    "technique": "T1048",
    "condition": "업무/수업 시간 밖 압축 파일이 처음 보는 목적지로 실제 전송되고 50MB 이상임.",
    "evidence": "T1048의 외부 반출 관점에서 시간 밖 대용량 압축 전송을 검토하며 시간 밖 사용 하나로 차단하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.92
  },
  {
    "id": "repeated-bulk-transfer",
    "name": "반복된 대용량 외부 전송",
    "technique": "T1048",
    "condition": "같은 목적지·대용량 전송 반복 설명·50MB 이상·count 5회 이상이 함께 있음.",
    "evidence": "T1048 대상 유출 후보를 반복 횟수와 전송량으로 보강하며 단일 대용량 정상 작업과 구분함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.9
  },
  {
    "id": "unusual-port-transfer",
    "name": "낯선 포트의 대량 자료 연속 전송",
    "technique": "T1048",
    "condition": "평소 쓰지 않던 포트·자료 연속 전송 설명·50MB 이상·파일 20개 이상이 함께 있음.",
    "evidence": "T1048은 C2와 다른 프로토콜 반출이며 비정상 포트와 대량 자료 전송은 검토 신호이지 프로토콜 확정 증거는 아님.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.9
  },
  {
    "id": "unfamiliar-archive-transfer",
    "name": "낯선 목적지의 대용량 압축 전송",
    "technique": "T1048",
    "condition": "처음 보는 목적지로 압축 파일 실제 전송·50MB 이상이 함께 있음.",
    "evidence": "T1048 관점의 대용량 외부 반출 후보를 목적지 이력 설명과 함께 검토함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.89
  },
  {
    "id": "whole-library-transfer",
    "name": "짧은 시간의 자료실 전체 외부 복사",
    "technique": "T1048",
    "condition": "짧은 시간 자료실 전체 외부 복사 설명·50MB 이상·100개 이상 파일이 함께 있음.",
    "evidence": "T1048 관점에서 단기간 자료 전체 반출과 전송량을 함께 검토함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.95
  },
  {
    "id": "c2-bulk-transfer",
    "name": "명령 통로의 대용량 반복 반출",
    "technique": "T1041",
    "condition": "명령 통로로 실제 전송·50MB 이상·count 5회 이상이 함께 있음.",
    "evidence": "T1041은 기존 C2 통로로 자료를 유출하는 기법이며 경보의 명령 통로 설명과 대량 반복 전송을 대조함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1041/"
    ],
    "confidence": 0.94
  },
  {
    "id": "transfer-review",
    "name": "외부 전송·압축 준비 검토",
    "technique": "T1048",
    "condition": "낯선 목적지·평소보다 늘어난 전송·압축 준비·실패·짧은 명령 통로 자료 등 복합 근거가 부족한 활동.",
    "evidence": "T1041·T1048 대상 활동을 알림으로 검토하며 실패 또는 준비만으로 성공한 유출을 확정하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1048/"
    ],
    "confidence": 0.6
  }
];

const decision = (confidence, reason) => ({
  action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason,
});
const integer = value => (typeof value === 'number' || (typeof value === 'string' && /^\d{1,16}$/u.test(value)))
  && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function decide(alert) {
  const text = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 4096) : '';
  const bytes = integer(alert?.data?.bytes);
  const files = integer(alert?.data?.files);
  const count = integer(alert?.data?.count);
  const destination = typeof alert?.data?.dstip === 'string' && alert.data.dstip.length > 0;
  const unfamiliar = /처음\s*(?:보는|봅)|낯선|평소와\s*다른|unfamiliar|new\s*(?:destination|address)/iu.test(text);
  const offhours = /(?:수업|업무)\s*시간\s*밖|off.hours|outside.*hours/iu.test(text);
  const archive = /압축\s*파일|archive|compressed\s*file/iu.test(text);
  const c2 = /명령\s*통로|command.*channel|c2\s*channel/iu.test(text);
  const sent = /나갔|올라갔|전송(?:됐|이|입|했)|복사됐|sent|uploaded|transferred/iu.test(text);
  const repeated = /반복|연속|전송이\s*\d+\s*번|repeat/iu.test(text);
  const unusualPort = /평소에\s*쓰지\s*않던\s*포트|unusual\s*port/iu.test(text);
  const whole = /짧은\s*시간.*자료실\s*전체.*외부|whole.*library.*external/iu.test(text);
  const reviewOnly = /실패|취소|외부\s*전송.*없|전송(?:은|이)?\s*없|큰\s*파일.*아닙|수업\s*(?:예제|연습)|승인된|failed|cancelled|not\s*(?:sent|transferred)|approved|simulation/iu.test(text);
  let match = null;
  if (destination && bytes !== null && bytes >= 50_000_000 && sent && !reviewOnly) {
    if (c2 && repeated && count >= 5) match = PATTERNS[6];
    else if (whole && files >= 100) match = PATTERNS[5];
    else if (unfamiliar && archive && offhours) match = PATTERNS[1];
    else if (unusualPort && repeated && files >= 20) match = PATTERNS[3];
    else if (repeated && count >= 5 && /같은\s*목적지|same\s*destination/iu.test(text)) match = PATTERNS[2];
    else if (unfamiliar && files >= 100) match = PATTERNS[0];
    else if (unfamiliar && archive) match = PATTERNS[4];
  }
  if (match) return decision(match.confidence, match.name);
  const review = unfamiliar || offhours || archive || c2 || unusualPort || whole
    || /전송량.*(?:평소보다|높)|파일\s*수.*늘|자료\s*\d+\s*건.*읽힌\s*뒤|백업처럼|다른\s*주소|전송.*실패|unusual.*(?:volume|transfer)/iu.test(text);
  return review ? decision(PATTERNS[7].confidence, PATTERNS[7].name) : decision(.1, '해당 없음');
}
