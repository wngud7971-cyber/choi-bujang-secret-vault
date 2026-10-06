import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

test('stage 2 build removes a stale public marker from data and deployment identity', async t => {
  const temporaryRoot = resolve(tmpdir());
  const fixture = await mkdtemp(join(temporaryRoot, 'stage2-build-'));
  t.after(async () => {
    if (!resolve(fixture).startsWith(`${temporaryRoot}${sep}stage2-build-`)) {
      throw new Error('Refusing to remove a directory outside the test fixture');
    }
    await rm(fixture, { recursive: true, force: true });
  });
  await mkdir(join(fixture, 'scripts'));
  await mkdir(join(fixture, 'public'));
  for (const script of ['build-public.mjs', 'deployment-identity.mjs']) {
    await copyFile(new URL(`../scripts/${script}`, import.meta.url), join(fixture, 'scripts', script));
  }
  const config = {
    step: 2, sampleMarker: 'SAMPLE_NOTE_1',
    judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  };
  // Simulate an old marker-bearing source and stale public output from stage 1.
  await writeFile(join(fixture, 'aleph.config.json'), JSON.stringify(config));
  await writeFile(join(fixture, 'data.json'), JSON.stringify({ sampleMarker: config.sampleMarker, notes: [] }));
  await writeFile(join(fixture, 'public', 'data.json'), JSON.stringify({ sampleMarker: config.sampleMarker, notes: [{}] }));
  execFileSync(process.execPath, [join(fixture, 'scripts', 'build-public.mjs')], {
    cwd: fixture, windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: { ...process.env,
      VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'Test-Student',
      VERCEL_GIT_REPO_SLUG: 'test-vault', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
      VERCEL_URL: 'test-vault.vercel.app',
    },
  });
  assert.deepEqual(JSON.parse(await readFile(join(fixture, 'public', 'data.json'), 'utf8')), { notes: [] });
  const identity = JSON.parse(await readFile(join(fixture, 'public', 'aleph.json'), 'utf8'));
  assert.equal(identity.step, 2);
  assert.ok(!Object.hasOwn(identity, 'sampleMarker'));
  assert.ok(!JSON.stringify(identity).includes(config.sampleMarker));
});
