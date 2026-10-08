import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

export const TTL_MS = 15 * 60 * 1000;
export const RULE_ID = 'xdr.brute_force.deny';
const trustedContext = new AsyncLocalStorage();

export function canonicalIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.toLowerCase().replace(/^::ffff:(?=\d+\.)/u, '');
  return isIP(ip) ? ip : null;
}

export function checkSource(sourceIp, at, document) {
  const source = canonicalIp(sourceIp);
  if (!source || !Number.isFinite(Date.parse(at))
    || document?.schema !== 'aleph.xdr.deny-rules.v1' || document.moduleKey !== 'brute-force' || !Array.isArray(document.rules)) return null;
  const now = Date.parse(at);
  return document.rules.find(rule => rule?.ruleId === RULE_ID && rule.action === 'deny' && canonicalIp(rule.sourceIp) === source
    && Number.isFinite(Date.parse(rule.startsAt)) && Number.isFinite(Date.parse(rule.expiresAt))
    && Date.parse(rule.expiresAt) - Date.parse(rule.startsAt) > 0
    && Date.parse(rule.expiresAt) - Date.parse(rule.startsAt) <= TTL_MS
    && Date.parse(rule.startsAt) <= now && now < Date.parse(rule.expiresAt)
    && Array.isArray(rule.alertIds) && rule.alertIds.length > 0
    && rule.alertIds.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(id) && id !== 'unknown')) ?? null;
}

export async function loadDenyRules(path = new URL('../xdr/brute-force/deny-rules.json', import.meta.url)) {
  return JSON.parse(await readFile(path, 'utf8'));
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
  try { document = await (context.rules ?? loadDenyRules)(); }
  catch { return null; } // Delegate to the existing policy; never create an allow.
  const at = (context.clock ?? (() => new Date().toISOString()))();
  return checkSource(context.sourceIp, at, document);
}
