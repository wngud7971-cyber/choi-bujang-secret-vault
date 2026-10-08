import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

// Local loader compatibility check, not the judge or a security sandbox.
// JSON module imports are refused; ordinary JavaScript dependencies are linked.
const root = new URL('../', import.meta.url);
const entry = new URL('xdr/brute-force/decide.mjs', root);
const context = createContext({
  process: { env: {}, argv: [] }, URL, AbortController, setTimeout, clearTimeout,
  fetch: () => { throw new Error('network_disabled'); },
});
const modules = new Map();
function rejectJson(specifier) {
  if (/\.json(?:[?#]|$)/u.test(specifier)) throw new Error('JSON imports are disabled');
}
async function link(specifier, parent) {
  rejectJson(specifier);
  const identifier = specifier.startsWith('node:') ? specifier : new URL(specifier, parent.identifier).href;
  if (!specifier.startsWith('node:') && !identifier.startsWith(root.href)) throw new Error('Module outside project');
  if (!modules.has(identifier)) modules.set(identifier, (async () => {
    if (identifier.startsWith('node:')) {
      const namespace = await import(identifier);
      return new SyntheticModule(Object.keys(namespace), function () {
        for (const name of Object.keys(namespace)) this.setExport(name, namespace[name]);
      }, { context, identifier });
    }
    return new SourceTextModule(await readFile(new URL(identifier), 'utf8'), {
      context, identifier, initializeImportMeta: meta => { meta.url = identifier; },
    });
  })());
  return modules.get(identifier);
}

// Negative control: this loader actually rejects the former import form.
const jsonControl = new SourceTextModule("import config from './patterns.json' with { type: 'json' };", {
  context, identifier: entry.href,
});
await assert.rejects(jsonControl.link(link), /JSON imports are disabled/u);
const loaded = await link(entry.href, { identifier: root.href });
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
console.log(JSON.stringify({ jsonImportGuardChecked: true, counts, normalBlocked }));
