// Mirrored from patterns.json. The judge needs only this file.
const PATTERNS = [
  {
    "id": "log4shell-remote-lookup",
    "name": "Log4Shell 원격 조회 구문",
    "condition": "요청 머리글·주소·인자에 완전한 ${jndi:원격프로토콜://대상} 형태가 있음. 제한된 URL 디코딩 후 ldap·ldaps·rmi·dns만 확인하며 외부 조회는 하지 않음.",
    "evidence": "CVE-2021-44228은 로그에 기록된 JNDI 조회를 악용하며 MITRE T1190의 공개 서비스 취약점 악용에 해당함.",
    "sources": ["https://nvd.nist.gov/vuln/detail/CVE-2021-44228", "https://logging.apache.org/security.html", "https://attack.mitre.org/techniques/T1190/"],
    "protocols": ["ldap", "ldaps", "rmi", "dns"],
    "confidence": 0.95
  },
  {
    "id": "log4shell-lookup-fragment",
    "name": "불완전한 JNDI 조회 후보",
    "condition": "요청에 ${jndi: 시작 또는 jndi:원격프로토콜: 흔적이 있지만 완전한 조회 구문이 아님. 원격 악용으로 확정하지 않고 알림만 남김.",
    "evidence": "CVE-2021-44228의 JNDI 형태 일부는 검토 신호이며 완전한 조회·실행 증거 없이 차단하지 않음.",
    "sources": ["https://logging.apache.org/security.html", "https://attack.mitre.org/techniques/T1190/"],
    "confidence": 0.6
  },
  {
    "id": "log4shell-scanner-trace",
    "name": "Log4Shell 점검 도구 흔적",
    "condition": "요청에 CISA가 안내한 CVE-2021-44228_scanner 또는 Invoke-Log4ShellScan 이름이 있음. 도구 이름만으로 악용을 확정하지 않음.",
    "evidence": "CISA AA21-356A는 해당 점검 도구를 소개하며 점검 흔적 자체는 악성 행위나 침해 성공의 증거가 아님.",
    "sources": ["https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a"],
    "markers": ["cve-2021-44228_scanner", "invoke-log4shellscan"],
    "confidence": 0.6
  },
  {
    "id": "log4shell-context-review",
    "name": "취약점 관련 맥락 검토",
    "condition": "요청의 CVE-2021-44228·JNDI·Log4Shell·Log4j 언급 또는 T1190 경보의 취약점·조회·점검 설명이 있음. 단어·규칙 수준·T1190만으로 차단하지 않음.",
    "evidence": "MITRE T1190은 공개 서비스 악용의 분류이며 취약점 검색·교육 자료·경보 설명만으로 실제 악용을 확정할 수 없음.",
    "sources": ["https://attack.mitre.org/techniques/T1190/", "https://logging.apache.org/security.html"],
    "confidence": 0.5
  }
];

const decision = (confidence, reason) => ({
  action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',
  confidence, reason,
});

function decode(value) {
  let text = value.slice(0, 16_384);
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(/(?:%[a-f\d]{2})+/giu, part => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    if (next === text) break;
    text = next;
  }
  return text;
}

function requestValues(alert) {
  const values = [];
  // Bounded, cycle-safe traversal of request fields only. Metadata is never
  // mistaken for a received payload. No original value leaves this function.
  let visited = 0;
  function collect(value, depth = 0) {
    if (visited++ >= 256 || depth > 4) return;
    if (typeof value === 'string') values.push(decode(value));
    else if (Array.isArray(value)) {
      for (const item of value.slice(0, 64)) collect(item, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value).slice(0, 64)) collect(item, depth + 1);
    }
  }
  const data = alert?.data;
  if (data && typeof data === 'object') {
    for (const key of ['url', 'uri', 'query', 'querystring', 'args', 'params',
      'headers', 'useragent', 'user_agent', 'http_user_agent', 'request']) collect(data[key]);
  }
  return values;
}

export function decide(alert) {
  const values = requestValues(alert);
  const remote = PATTERNS[0];
  const full = new RegExp('\\$\\{\\s*jndi\\s*:\\s*(?:' + remote.protocols.join('|')
    + ')\\s*:\\/\\/[^\\s{}/?#]+(?:[/?#][^\\s{}]*)?\\s*\\}', 'iu');
  const complete = values.some(value => full.test(value));
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 2048) : '';
  // Explicit educational context in the trusted rule description warrants
  // review even with a quoted signature. Never create an allow from it.
  const educational = /수업|교육|예제|tutorial|documentation|quoted example/iu.test(description);
  if (complete) return decision(educational ? 0.6 : remote.confidence, remote.name);
  if (values.some(value => /\$\{\s*jndi\s*:|jndi\s*:\s*(?:ldap|ldaps|rmi|dns)\s*:/iu.test(value))) {
    return decision(PATTERNS[1].confidence, PATTERNS[1].name);
  }
  if (values.some(value => PATTERNS[2].markers.some(marker => value.toLowerCase().includes(marker)))) {
    return decision(PATTERNS[2].confidence, PATTERNS[2].name);
  }
  const technique = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.includes('T1190');
  const requestContext = values.some(value => /cve-2021-44228|\bjndi\b|log4shell|log4j|cve-list|lookup-fragment/iu.test(value));
  const metadataContext = technique && /CVE-2021-44228|jndi|log4shell|log4j|취약점|원격\s*조회|조회\s*형태|점검\s*도구|라이브러리.*로그|로그.*라이브러리/iu.test(description);
  if (requestContext || metadataContext) return decision(PATTERNS[3].confidence, PATTERNS[3].name);
  return decision(0.1, '해당 없음');
}
