const PATTERNS = [
  {
    "id": "suspicious-admin-membership",
    "name": "이상 출처의 관리자 그룹 추가·사용",
    "technique": "T1098",
    "condition": "관리자 그룹 추가와 원격 출처·평범한 계정의 즉시 관리자 명령·업무 시간 밖 명령 중 하나가 함께 있거나 방금 얻은 관리자 권한으로 명령을 실행함.",
    "evidence": "MITRE T1098은 계정 권한 변경을, T1078은 확보한 정상 계정의 권한 사용을 설명하며 그룹 추가만으로 악용을 확정하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1098/",
      "https://attack.mitre.org/techniques/T1078/"
    ],
    "confidence": 0.93
  },
  {
    "id": "unfamiliar-offhours-admin-command",
    "name": "낯선 출처의 시간 밖 관리자 명령",
    "technique": "T1078",
    "condition": "실제로 실행된 관리자 명령과 처음 보는 출발 주소 및 업무·수업 시간 밖 사용이 함께 확인됨.",
    "evidence": "MITRE T1078은 정상 계정 권한의 악용을 설명하므로 낯선 출처와 평소 밖 활동을 함께 확인함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1078/"
    ],
    "confidence": 0.9
  },
  {
    "id": "bulk-admin-membership",
    "name": "여러 계정의 관리자 그룹 편입",
    "technique": "T1098",
    "condition": "같은 주소에서 3개 이상 계정이 관리자 그룹에 추가됐다는 설명과 유효한 count가 함께 있음.",
    "evidence": "MITRE T1098의 계정 권한 변경 관점에서 다수 계정의 관리자 그룹 편입을 검토함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1098/"
    ],
    "confidence": 0.9
  },
  {
    "id": "unfamiliar-admin-session",
    "name": "낯선 출처에서 세션 관리자 권한 전환",
    "technique": "T1078",
    "condition": "세션의 관리자 권한 전환과 처음 보는 요청 주소가 함께 확인됨.",
    "evidence": "MITRE T1078은 정상 계정의 높아진 권한 사용을 설명하며 세션 전환만으로 취약점 악용 T1068을 확정하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1078/",
      "https://attack.mitre.org/techniques/T1068/"
    ],
    "confidence": 0.92
  },
  {
    "id": "other-account-admin-command",
    "name": "다른 계정 권한으로 관리자 명령 실행",
    "technique": "T1078",
    "condition": "다른 계정의 권한으로 관리자 명령을 실제 실행했다는 경보가 있음.",
    "evidence": "MITRE T1078은 다른 정상 계정의 권한 악용을 포함하므로 성공한 권한 사용을 확인함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1078/"
    ],
    "confidence": 0.92
  },
  {
    "id": "rapid-admin-reentry",
    "name": "관리자 권한 제거 직후 재편입",
    "technique": "T1098",
    "condition": "관리자 그룹에서 빠진 계정이 1분 이내 다시 들어왔다는 설명과 2회 이상 count가 함께 있음.",
    "evidence": "MITRE T1098의 계정 권한 조작 관점에서 제거 직후 관리자 권한 재획득을 검토함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1098/"
    ],
    "confidence": 0.88
  },
  {
    "id": "privilege-change-review",
    "name": "계정·그룹·권한 사용 검토",
    "technique": "T1068",
    "condition": "권한 창·관리자 명령·그룹 변경·계정 종류 조회는 있으나 성공한 악용의 복합 근거가 부족함.",
    "evidence": "MITRE T1068은 소프트웨어 취약점 악용이며 권한 창 또는 기법 번호만으로 입증되지 않아 T1078·T1098 대상 활동도 알림으로 검토함.",
    "sources": [
      "https://attack.mitre.org/techniques/T1068/",
      "https://attack.mitre.org/techniques/T1078/",
      "https://attack.mitre.org/techniques/T1098/"
    ],
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
  const group = typeof data?.group === 'string' ? data.group.toLowerCase() : '';
  const adminGroup = /^(?:administrators|admins|domain admins|관리자)$/u.test(group);
  const added = /관리자\s*그룹.*(?:추가|들어|편입)|added.*admin(?:istrator)?s?\s*group/iu.test(description)
    && !/관리자\s*그룹(?:은|이)?\s*아닙|추가(?:는|가)?\s*없|not.*admin(?:istrator)?s?\s*group/iu.test(description);
  const command = /관리자\s*명령|권한\s*명령|admin(?:istrator)?\s*command/iu.test(description)
    || (adminGroup && added && /명령\s*실행/iu.test(description));
  const executed = command && /실행(?:했|됐|됨|이)|명령\s*실행|명령을\s*실행|command.*executed/iu.test(description)
    && !/실행(?:은|이)?\s*(?:없|안)|실패|취소|failed|cancelled|not\s*executed/iu.test(description);
  const unfamiliar = /처음\s*(?:보는|봅)|낯선|unfamiliar|new\s*(?:source|address)/iu.test(description);
  const offhours = /(?:수업|업무)\s*시간\s*밖|업무처럼\s*보이지\s*않는\s*시각|outside.*hours|off.hours/iu.test(description);
  const remote = /원격\s*주소|remote\s*(?:source|address)/iu.test(description);
  const ordinaryAccount = /평범한\s*계정|ordinary\s*account/iu.test(description);
  const recentAdmin = /방금\s*관리자가\s*된|just.*became.*admin/iu.test(description);
  const count = typeof data?.count === 'number' || (typeof data?.count === 'string' && /^\d{1,6}$/u.test(data.count)) ? Number(data.count) : 0;
  let match = null;
  if ((adminGroup && added && (remote || (executed && (ordinaryAccount || offhours)))) || (recentAdmin && executed)) match = PATTERNS[0];
  else if (executed && unfamiliar && offhours) match = PATTERNS[1];
  else if (adminGroup && added && /같은\s*주소|same\s*(?:source|address)/iu.test(description) && /계정\s*\d+\s*개|multiple\s*accounts/iu.test(description) && Number.isInteger(count) && count >= 3 && count <= 1_000_000) match = PATTERNS[2];
  else if (/세션.*관리자\s*권한.*바뀌|session.*(?:became|changed).*admin/iu.test(description) && unfamiliar) match = PATTERNS[3];
  else if (executed && /다른\s*계정의\s*권한|another\s*account.s\s*privileges/iu.test(description)) match = PATTERNS[4];
  else if (adminGroup && /(?:그룹에서\s*빠진|제거|removed).*(?:1\s*분|one\s*minute).*(?:다시.*관리자|re.?added)/iu.test(description) && Number.isInteger(count) && count >= 2 && count <= 1_000_000) match = PATTERNS[5];
  // A quoted exercise, explicit denial or approved maintenance lacks clear misuse evidence.
  const reviewOnly = /수업\s*(?:예제|연습)|교육\s*예제|simulation|example|승인된\s*(?:관리|변경|작업)|approved\s*maintenance|추가(?:는|가)?\s*없|권한\s*변경(?:은|이)?\s*없/iu.test(description);
  if (match) return decision(reviewOnly ? 0.6 : match.confidence, match.name);
  const review = command || /권한\s*상승|관리자\s*그룹|로컬\s*그룹|그룹.*(?:추가|설명.*바뀌)|계정\s*종류|privilege\s*escalation|group.*(?:added|changed)/iu.test(description);
  if (review) return decision(PATTERNS[6].confidence, PATTERNS[6].name);
  return decision(0.1, '해당 없음');
}
