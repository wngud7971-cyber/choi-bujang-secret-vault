const PATTERNS = [
  {
    "id": "unsigned-service-change",
    "name": "서명 없는 서비스 생성·변경",
    "condition": "새 서비스 등록 또는 실행 파일 변경과 서명 없음이 함께 확인되고, 임시 실행 경로 또는 반복 등록이 동반됨.",
    "evidence": "MITRE T1543은 서비스 생성·변경을 통한 지속 실행을 설명하므로 서명 없음과 비정상 경로·반복 등록을 함께 확인함.",
    "sources": ["https://attack.mitre.org/techniques/T1543/"],
    "confidence": 0.95
  },
  {
    "id": "unfamiliar-service-autostart",
    "name": "미등록 서비스의 임시 파일 자동 시작",
    "condition": "평소 목록에 없는 서비스가 재시작 후에도 남도록 등록되고 임시 실행 경로를 가리킴.",
    "evidence": "MITRE T1543은 서비스의 자동 시작 악용을 설명하며 알려진 목록 밖의 등록과 임시 경로를 조합해 검토함.",
    "sources": ["https://attack.mitre.org/techniques/T1543/"],
    "confidence": 0.9
  },
  {
    "id": "suspicious-scheduled-task",
    "name": "낯선 예약 작업의 임시 파일 실행",
    "condition": "예약 작업이 임시 실행 경로를 가리키며 처음 보는 작업·임의 이름·수업 시간 밖 실행·시작 항목과 같은 파일 중 하나가 확인됨.",
    "evidence": "MITRE T1053은 예약 작업을 통한 반복 실행을 설명하므로 예약 작업 존재만으로 차단하지 않고 비정상 실행 경로와 추가 신호를 확인함.",
    "sources": ["https://attack.mitre.org/techniques/T1053/"],
    "confidence": 0.9
  },
  {
    "id": "unfamiliar-startup-entry",
    "name": "평소 목록 밖의 시작 폴더 프로그램",
    "condition": "실제 시작 폴더 실행 경로와 평소 목록에 없는 프로그램 추가가 함께 확인됨.",
    "evidence": "시작 폴더는 MITRE T1547.001의 자동 실행 위치이며 T1543 서비스와 구분하여 새 미등록 실행 항목을 확인함.",
    "sources": ["https://attack.mitre.org/techniques/T1547/001/"],
    "confidence": 0.88
  },
  {
    "id": "persistence-change-review",
    "name": "서비스·예약 작업·시작 항목 변경 검토",
    "condition": "서비스·예약 작업·시작 항목·임시 실행 파일 변경은 있으나 서명·실행·승인 근거가 부족함. 수준 또는 기법 번호만으로 차단하지 않음.",
    "evidence": "MITRE T1543·T1053·T1547.001의 감시 대상 변경은 정상 관리 작업도 포함하므로 단일 신호는 알림으로 검토함.",
    "sources": ["https://attack.mitre.org/techniques/T1543/", "https://attack.mitre.org/techniques/T1053/", "https://attack.mitre.org/techniques/T1547/001/"],
    "confidence": 0.6
  }
];

const decision = (confidence, reason) => ({
  action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',
  confidence, reason,
});

export function decide(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 4096) : '';
  const data = alert?.data;
  const path = typeof data?.path === 'string' ? data.path.slice(0, 2048).replaceAll('\\', '/').toLowerCase() : '';
  const temporary = /(?:^|\/)(?:temp|tmp)(?:\/|$)/u.test(path);
  const startupPath = /\/start menu\/programs\/startup\/[^/]+$/u.test(path);
  const service = /서비스|\bservice\b/iu.test(description);
  const task = /예약\s*작업|scheduled\s*task/iu.test(description);
  const startup = /시작\s*(?:폴더|항목|프로그램)|startup/iu.test(description);
  const unsigned = /서명\s*(?:없는|없(?:습니다|음))|서명(?:이|은)?\s*없|unsigned/iu.test(description);
  const unknown = /평소\s*목록에\s*없는|처음\s*보는|낯선|unfamiliar|unknown/iu.test(description);
  const registration = /새\s*서비스|등록(?:됐|이|을|됨)|new\s*service|created|registered/iu.test(description)
    && !/등록(?:은|이)?\s*없|no\s*registration/iu.test(description);
  const changedBinary = /실행\s*파일(?:이|을)?\s*바뀌|binary\s*changed/iu.test(description);
  const repeated = /연속|반복|repeated/iu.test(description) && Number(data?.count) >= 3;
  const educational = /수업\s*(?:예제|연습)|교육\s*예제|simulation|example/iu.test(description);
  let match = null;
  if (service && unsigned && (registration || changedBinary) && (temporary || repeated)) match = PATTERNS[0];
  else if (service && unknown && registration && temporary && /다시\s*켜|재시작|자동\s*시작|autostart|reboot/iu.test(description)) match = PATTERNS[1];
  else if (task && temporary && (unknown || /임의\s*문자열|수업\s*시간\s*밖|같은\s*임시\s*파일|random\s*name|outside.*hours/iu.test(description))) match = PATTERNS[2];
  else if (startup && startupPath && unknown && /추가|생성|added|created/iu.test(description)) match = PATTERNS[3];
  if (match) return decision(educational ? 0.6 : match.confidence, match.name);

  // Unchanged, observed ordinary activity has no creation evidence. A signature
  // alone is never an exemption for an otherwise suspicious new service/task.
  const ordinary = /평소\s*시각에\s*그대로|기존.*서명된\s*채로\s*실행\s*중|목록을\s*읽기만|기존\s*예약\s*작업.*마쳤/iu.test(description);
  if (ordinary && !unsigned && !unknown && !registration && !changedBinary && !temporary) return decision(0.1, '해당 없음');
  if (service || task || startup || (temporary && /실행\s*파일.*생겼|file.*created/iu.test(description))) {
    return decision(PATTERNS[4].confidence, PATTERNS[4].name);
  }
  return decision(0.1, '해당 없음');
}
