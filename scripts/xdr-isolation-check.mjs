import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, createContext } from 'node:vm';

// Local loader compatibility check, not the judge or a security sandbox.
// Only relative JavaScript files can be imported by the decision graph.
const root = new URL('../', import.meta.url);
const entry = new URL('xdr/brute-force/decide.mjs', root);
// No process, network, timers, AbortController or host filesystem in the VM.
const context = createContext({});
const modules = new Map();
function checkImport(specifier) {
  if (/\.json(?:[?#]|$)/u.test(specifier)) throw new Error('JSON imports are disabled');
  if (!/^\.\.?\//u.test(specifier)) throw new Error('Builtin and package imports are disabled');
  if (!/\.mjs$/u.test(specifier)) throw new Error('Only JavaScript modules are supported');
}
async function link(specifier, parent) {
  checkImport(specifier);
  return load(new URL(specifier, parent.identifier).href);
}
async function load(identifier) {
  if (!identifier.startsWith(root.href)) throw new Error('Module outside project');
  if (!modules.has(identifier)) modules.set(identifier, (async () => {
    return new SourceTextModule(await readFile(new URL(identifier), 'utf8'), {
      context, identifier, initializeImportMeta: meta => { meta.url = identifier; },
      importModuleDynamically: () => { throw new Error('Dynamic imports are disabled'); },
    });
  })());
  return modules.get(identifier);
}

// Negative controls prove that the known rejected imports cannot slip through.
for (const [source, error] of [
  ["import config from './patterns.json' with { type: 'json' };", /JSON imports are disabled/u],
  ["import 'node:fs';", /Builtin and package imports are disabled/u],
  ["import 'fs';", /Builtin and package imports are disabled/u],
  ["import 'jose';", /Builtin and package imports are disabled/u],
]) {
  const control = new SourceTextModule(source, { context, identifier: entry.href });
  await assert.rejects(control.link(link), error);
}
const loaded = await load(entry.href);
await loaded.link(link);
await loaded.evaluate();
const fixture = JSON.parse(await readFile(new URL('xdr/fixtures/brute-force.json', root), 'utf8'));
const counts = { block: 0, alert: 0, record: 0 };
let normalBlocked = 0;
for (const alert of fixture.alerts) {
  const decision = await loaded.namespace.decide(alert);
  assert.ok(Object.hasOwn(counts, decision.action));
  assert.ok(Number.isFinite(decision.confidence));
  counts[decision.action] += 1;
  if (alert.rule.level <= 3 && decision.action === 'block') normalBlocked += 1;
}
assert.deepEqual(counts, { block: 10, alert: 9, record: 9 });
assert.equal(normalBlocked, 0);
console.log(JSON.stringify({ importGuardsChecked: true,
  moduleFiles: [...modules.keys()].map(identifier => identifier.slice(root.href.length)).sort(),
  counts, normalBlocked }));
