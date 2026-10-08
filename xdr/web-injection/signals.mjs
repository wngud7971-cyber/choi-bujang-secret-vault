import config from './patterns.mjs';
import { redact, safeId, validIp } from '../brute-force/alert-fields.mjs';

// Local conservative thresholds, not MITRE-specified blocking thresholds.
export const POLICY = Object.freeze({ minimumLevel: 10, minimumAttempts: 3, windowSeconds: 180 });
const boundedCount = value => /^(?:0|[1-9]\d{0,6})$/u.test(String(value ?? ''))
  && Number(value) <= 1_000_000 ? Number(value) : null;

function decode(value) {
  let text = typeof value === 'string' ? value.slice(0, 8192) : '';
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(/(?:%[a-f\d]{2})+/giu, part => {
      try { return decodeURIComponent(part); } catch { return ''; }
    });
    if (next === text) break;
    text = next;
  }
  return text;
}

export function matchPatterns(alert) {
  const description = redact(alert?.rule?.description ?? alert?.description);
  const level = alert?.rule?.level ?? alert?.level;
  const source = alert?.data?.srcip ?? alert?.srcip;
  const srcip = typeof source === 'string' ? source.toLowerCase().replace(/^::ffff:(?=\d+\.)/u, '') : '';
  const timestamp = typeof alert?.timestamp === 'string' && Number.isFinite(Date.parse(alert.timestamp))
    ? new Date(alert.timestamp).toISOString() : null;
  const explicitCount = boundedCount(alert?.data?.count);
  const describedCount = boundedCount(/(\d{1,7})\s*(?:번|건)/u.exec(description)?.[1]);
  // Conflicting counts use the smaller value; never sum Wazuh aggregates.
  const attempts = explicitCount !== null && describedCount !== null ? Math.min(explicitCount, describedCount)
    : explicitCount ?? describedCount ?? 1;
  const row = { id: safeId(alert?.id), timestamp, srcip: validIp(srcip) ? srcip : null,
    level: Number.isInteger(level) && level >= 0 && level <= 16 ? level : 0, attempts };

  // Inspect arguments without URL/path normalization (which removes ../).
  // These strings stay inside this function and never reach Jev or the reason.
  const url = typeof alert?.data?.url === 'string' ? alert.data.url.slice(0, 8192)
    : typeof alert?.url === 'string' ? alert.url.slice(0, 8192) : '';
  const relative = url.replace(/^https?:\/\/[^/\s?#]+/iu, '').split('#')[0];
  const question = relative.indexOf('?');
  const path = decode(question < 0 ? relative : relative.slice(0, question));
  const args = question < 0 ? [] : relative.slice(question + 1).split('&').map(pair => {
    const equals = pair.indexOf('=');
    return decode((equals < 0 ? pair : pair.slice(equals + 1)).replace(/\+/gu, ' '));
  });
  const tutorialContext = /수업|공지\s*제목|예시|설명용/u.test(description);
  const deniedSignal = /(?:삽입|주입|공격)\s*(?:표식|표기)?[^.]{0,12}(?:아닙|없)/u.test(description);
  const sqlSyntax = args.some(text => /\bselect\b[\s\S]{1,200}\bfrom\b|\b(?:or|and)\s+(?:\d+|'[^']*')\s*=\s*(?:\d+|'[^']*')|;\s*(?:select|insert|update|delete|drop|exec)\b/iu.test(text)
    || (/\b(?:select|insert|update|delete)\b/iu.test(text) && /--|\/\*/u.test(text)));
  const scriptTag = args.some(text => /<\s*\/?\s*script(?:\s[^>]{0,200})?\s*>/iu.test(text));
  const parentSegments = Math.max(0, ...[path, ...args].map(text => (text.match(/(?:^|\/)\.\.(?=\/)/gu) ?? []).length));
  const descriptionSql = !deniedSignal && /SQL\s*(?:구문|표식|주입)|데이터베이스\s*조회[^.]{0,30}이어\s*붙/iu.test(description);
  const descriptionScript = !deniedSignal && /스크립트\s*(?:삽입|주입|표식)/u.test(description);
  const descriptionTraversal = !deniedSignal && /경로[^.]{0,40}(?:여러\s*단계[^.]{0,20}거슬러|이탈\s*표기)/u.test(description);
  const commandSyntax = args.some(text => /(?:;|&&|\|\|)\s*(?:whoami|id|uname|cat|echo|cmd|powershell)\b/iu.test(text));
  const descriptionCommand = !deniedSignal && /명령\s*구분자/u.test(description)
    && /연속\s*요청|(?:요청|시도)[^.]{0,20}반복|구분자[^.]{0,20}반복/u.test(description)
    && !/반복(?:되지)?\s*않|반복[^.]{0,10}없|연속[^.]{0,10}아니/u.test(description);
  const flags = {
    'sql-injection': sqlSyntax || descriptionSql,
    'script-injection': scriptTag || descriptionScript,
    'path-traversal': parentSegments >= config.patterns.find(p => p.id === 'path-traversal').conditions.minimumParentSegments
      || descriptionTraversal,
    'command-injection': commandSyntax || descriptionCommand,
  };
  const matched = config.patterns.filter(p => flags[p.id]);
  const hints = new Set();
  if (/SQL|\bselect\b|데이터베이스|따옴표|구분/iu.test(description) || args.some(text => /\b(?:select|sql)\b|['";]/iu.test(text))) hints.add('sql-injection');
  if (/스크립트/u.test(description) || args.some(text => /\bscript\b/iu.test(text))) hints.add('script-injection');
  if (/경로|\bup\b/u.test(description) || parentSegments > 0) hints.add('path-traversal');
  if (/명령\s*구분자/u.test(description) || commandSyntax) hints.add('command-injection');
  const candidates = matched.length ? matched : config.patterns.filter(p => hints.size === 0 || hints.has(p.id));
  const suspicious = matched.length > 0 || args.some(text => /['";]/u.test(text))
    || (row.level > 3 && /검색|주소|경로|조회|요청|따옴표|구분|주입|SQL|스크립트/u.test(description));
  return { row, matched, candidates, normal: !suspicious,
    clear: matched.length > 0 && !tutorialContext && !deniedSignal && Boolean(row.srcip && row.timestamp)
      && row.level >= POLICY.minimumLevel && attempts >= POLICY.minimumAttempts,
    signals: { sqlSyntax: sqlSyntax || descriptionSql, scriptTag: scriptTag || descriptionScript,
      repeatedParentSegments: flags['path-traversal'], tutorialContext, deniedSignal,
      commandSyntax: flags['command-injection'],
      separatorOnly: /구분/u.test(description) && !sqlSyntax && !descriptionSql,
      successAfterAttempt: /뒤[^.]{0,12}정상\s*조회/u.test(description),
      unusualLengthOnly: /길/u.test(description) && matched.length === 0 },
  };
}

export function reviewSummary(match, attempts = match.row.attempts) {
  return { schema: 'aleph.xdr.jev.v1', patterns: match.candidates.map(p => p.id),
    level: match.row.level, attempts, repeatedSource: Boolean(match.row.srcip && match.row.timestamp && attempts >= POLICY.minimumAttempts),
    ...match.signals };
}
