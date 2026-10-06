import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
}).trim();
// Read the original fictional sentences from history; never copy them into this script.
const baseline = JSON.parse(git('show', '8a0927400ec0d0a8ff08146db773fec80fb6d216:data.json'));
const matches = text => baseline.notes.some(note => text.includes(note.content));
const secret = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/u;
const get = async url => {
  const result = await fetch(url, {
    headers: { 'User-Agent': 'stage2-note-removal-check' },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  return result.text();
};

try {
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
    .split('\0').filter(Boolean);
  const localHits = [];
  const secretHits = [];
  for (const file of files) {
    const text = await readFile(resolve(root, file), 'utf8');
    if (matches(text)) localHits.push(file);
    if (secret.test(text)) secretHits.push(file);
  }
  console.log(JSON.stringify({ scope: 'local_publishable_files', filesChecked: files.length,
    noteMatches: localHits, secretMatches: secretHits }));
  assert.equal(localHits.length + secretHits.length, 0, 'LOCAL_SCAN_FAILED');
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'public/data.json'), 'utf8')).notes, []);
  git('check-ignore', 'private/step2-notes.sql');
  if (process.argv.includes('--live')) {
    const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
    const repo = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/?$/u.exec(config.repoUrl);
    assert.ok(repo, 'INVALID_REPOSITORY');
    const api = `https://api.github.com/repos/${repo[1]}/${repo[2]}`;
    const info = JSON.parse(await get(api));
    const latest = JSON.parse(await get(`${api}/commits/${encodeURIComponent(info.default_branch)}`));
    assert.match(latest.sha, /^[a-f0-9]{40}$/u);
    const tree = JSON.parse(await get(`${api}/git/trees/${latest.sha}?recursive=1`));
    assert.equal(tree.truncated, false, 'INCOMPLETE_REPOSITORY_TREE');
    const blobs = tree.tree.filter(item => item.type === 'blob');
    const repoHits = [];
    const repoSecretHits = [];
    // Bounded concurrency, with results limited to file names and counts.
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < blobs.length) {
        const item = blobs[cursor++];
        const path = item.path.split('/').map(encodeURIComponent).join('/');
        const text = await get(`https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/${latest.sha}/${path}`);
        if (matches(text)) repoHits.push(item.path);
        if (secret.test(text)) repoSecretHits.push(item.path);
      }
    }));
    console.log(JSON.stringify({ scope: 'github_latest', commit: latest.sha,
      filesChecked: blobs.length, noteMatches: repoHits.sort(), secretMatches: repoSecretHits.sort() }));

    const app = new URL(config.publicAppUrl);
    assert.ok(app.protocol === 'https:' && !app.username && !app.password
      && app.pathname === '/' && !app.search && !app.hash, 'INVALID_DEPLOYMENT_URL');
    const staticPaths = blobs.filter(item => item.path.startsWith('public/'))
      .map(item => item.path.slice('public'.length));
    if (!staticPaths.includes('/aleph.json')) staticPaths.push('/aleph.json');
    const deployedHits = [];
    const deployedSecretHits = [];
    let deployedCommit;
    for (const path of staticPaths) {
      const text = await get(new URL(path, app));
      if (matches(text)) deployedHits.push(path);
      if (secret.test(text)) deployedSecretHits.push(path);
      if (path === '/data.json') assert.deepEqual(JSON.parse(text).notes, []);
      if (path === '/aleph.json') deployedCommit = JSON.parse(text).commit;
    }
    console.log(JSON.stringify({ scope: 'current_deployed_static_files', filesChecked: staticPaths.length,
      noteMatches: deployedHits, secretMatches: deployedSecretHits,
      deployedCommit, matchesGithubLatest: deployedCommit === latest.sha }));
    assert.equal(repoHits.length + repoSecretHits.length + deployedHits.length + deployedSecretHits.length,
      0, 'LIVE_SCAN_FAILED');
    assert.equal(deployedCommit, latest.sha, 'DEPLOYMENT_IS_NOT_LATEST');
  } else {
    console.log('GitHub 최신 파일 및 배포 파일: 미실행 (--live로 확인).');
  }
} catch {
  console.error('점검 실패: 앞의 파일 결과, 네트워크 연결 또는 배포 상태를 확인하세요. 본문·키는 출력하지 않습니다.');
  process.exitCode = 1;
}
