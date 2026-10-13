import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

export const TTL_MS = 15 * 60 * 1000;
export const RULE_ID = 'xdr.brute_force.deny';
export const WEB_RULE_ID = 'xdr.web_injection.deny';
export const XDR_RULE_IDS = Object.freeze([RULE_ID, WEB_RULE_ID]);
const moduleRules = { 'brute-force': RULE_ID, 'web-injection': WEB_RULE_ID };
const webPatterns = new Set(['sql-injection', 'script-injection', 'path-traversal', 'command-injection']);
const trustedContext = new AsyncLocalStorage();

export function canonicalIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.toLowerCase().replace(/^::ffff:(?=\d+\.)/u, '');
  return isIP(ip) ? ip : null;
}

export function checkSource(sourceIp, at, document) {
  const source = canonicalIp(sourceIp);
  if (!source || !Number.isFinite(Date.parse(at))
    || document?.schema !== 'aleph.xdr.deny-rules.v1' || !Object.hasOwn(moduleRules, document.moduleKey) || !Array.isArray(document.rules)) return null;
  const now = Date.parse(at);
  return document.rules.find(rule => rule?.ruleId === moduleRules[document.moduleKey] && rule.action === 'deny' && canonicalIp(rule.sourceIp) === source
    && Number.isFinite(Date.parse(rule.startsAt)) && Number.isFinite(Date.parse(rule.expiresAt))
    && Date.parse(rule.expiresAt) - Date.parse(rule.startsAt) > 0
    && Date.parse(rule.expiresAt) - Date.parse(rule.startsAt) <= TTL_MS
    && Date.parse(rule.startsAt) <= now && now < Date.parse(rule.expiresAt)
    && Array.isArray(rule.alertIds) && rule.alertIds.length > 0
    && rule.alertIds.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(id) && id !== 'unknown')
    && (document.moduleKey !== 'web-injection' || (Number.isFinite(rule.confidence) && rule.confidence >= 0.85 && rule.confidence <= 1
      && Number.isInteger(rule.attempts) && rule.attempts >= 3 && rule.attempts <= 1_000_000
      && Array.isArray(rule.patternIds) && rule.patternIds.length > 0 && rule.patternIds.every(id => webPatterns.has(id))))) ?? null;
}

export async function loadDenyRules(path = new URL('../xdr/brute-force/deny-rules.json', import.meta.url)) {
  return JSON.parse(await readFile(path, 'utf8'));
}

// Keep the existing single-document loader intact. A missing/broken optional
// document must not disable another module's existing rules.
export async function loadAllDenyRules(paths = [
  new URL('../xdr/brute-force/deny-rules.json', import.meta.url),
  new URL('../xdr/web-injection/deny-rules.json', import.meta.url),
]) {
  const documents = await Promise.all(paths.map(async path => {
    try { return await loadDenyRules(path); } catch { return null; }
  }));
  return documents.filter(Boolean);
}

// This context is set only by the server transport adapter. It adds no fields to
// the engine request and isolates simultaneous requests from different sources.
export function withTrustedSource({ sourceIp, rules, clock }, callback) {
  return trustedContext.run({ sourceIp: canonicalIp(sourceIp), rules, clock }, callback);
}

export async function activeXdrRule() {
  const context = trustedContext.getStore();
  if (!context?.sourceIp) return null;
  let document;
  try { document = await (context.rules ?? loadAllDenyRules)(); }
  catch { return null; } // Delegate to the existing policy; never create an allow.
  const at = (context.clock ?? (() => new Date().toISOString()))();
  for (const item of Array.isArray(document) ? document : [document]) {
    const match = checkSource(context.sourceIp, at, item);
    if (match) return match;
  }
  return null;
}
