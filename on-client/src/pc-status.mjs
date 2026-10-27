// Student addition: local, non-elevated OS readings. No shell, remote telemetry or engine identity.
import os from 'node:os';
import {statfs, mkdir, lstat, readFile, appendFile, writeFile, rename} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

export const PC_INTERVAL_MS = 5000;
export const PC_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 17281;
const MAX_BYTES = 24 * 1024 * 1024;
const GIB = 1024 ** 3;
const SCHEMA = 'keshev.pc-status.v1';
const units = {cpu: '%', memory: 'GiB', disk: 'GiB'};
const sources = {
  cpu: 'node:os.cpus — 전체 논리 CPU 시간 차이',
  memory: 'node:os.totalmem/freemem — 전체 물리 메모리',
  disk: 'node:fs.statfs — C: 일반 사용자 가용 공간',
};
const unavailable = (name, reason, at) => ({
  status: 'unavailable', value: null, unit: units[name], measuredAt: at,
  source: sources[name], reason,
});
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function isPcSample(sample) {
  if (!sample || sample.kind !== 'measured' || !Number.isFinite(Date.parse(sample.measuredAt))) return false;
  if (sample.startedAt !== undefined && (!Number.isFinite(Date.parse(sample.startedAt))
    || Date.parse(sample.startedAt) > Date.parse(sample.measuredAt)
    || Date.parse(sample.measuredAt) - Date.parse(sample.startedAt) > 120000)) return false;
  for (const key of Object.keys(units)) {
    const m = sample[key];
    if (!m || m.unit !== units[key] || !Number.isFinite(Date.parse(m.measuredAt))
      || typeof m.source !== 'string' || m.source.length > 180) return false;
    if (m.status === 'unavailable') {
      if (m.value !== null || typeof m.reason !== 'string' || !m.reason || m.reason.length > 200) return false;
    } else if (m.status === 'ok') {
      if (!finite(m.value) || m.value < 0 || !finite(m.percent) || m.percent < 0 || m.percent > 100) return false;
      if (key === 'cpu' && m.value > 100) return false;
      if (key !== 'cpu' && (!finite(m.totalGiB) || m.totalGiB <= 0 || m.value > m.totalGiB)) return false;
    } else return false;
  }
  return true;
}

// Older saved rows have only the CPU window start; preserve and read those records too.
function measurementStart(sample) {
  const ended = Date.parse(sample.measuredAt);
  const started = Date.parse(sample.startedAt ?? sample.cpu?.startedAt ?? sample.measuredAt);
  return Number.isFinite(started) && started <= ended && ended - started <= 120000 ? started : ended;
}

function cpuTimes(readCpu) {
  const rows = readCpu();
  if (!Array.isArray(rows) || !rows.length) throw Error('CPU_UNAVAILABLE');
  let total = 0, idle = 0;
  for (const row of rows) {
    if (!row?.times || !['user', 'nice', 'sys', 'idle', 'irq'].every(k => finite(row.times[k]) && row.times[k] >= 0)) throw Error('CPU_UNAVAILABLE');
    idle += row.times.idle;
    total += Object.values(row.times).reduce((a, b) => a + b, 0);
  }
  return {total, idle, cores: rows.length};
}

export async function measurePc({
  clock = () => new Date(), readCpu = os.cpus, totalmem = os.totalmem, freemem = os.freemem,
  readDisk = statfs, diskPath = process.platform === 'win32' ? 'C:\\' : null,
  wait = ms => delay(ms), sampleMs = 1000,
} = {}) {
  let cpu;
  const cpuStart = clock().toISOString();
  try {
    const before = cpuTimes(readCpu);
    await wait(sampleMs);
    const after = cpuTimes(readCpu);
    const total = after.total - before.total, idle = after.idle - before.idle;
    if (before.cores !== after.cores || total <= 0 || idle < 0 || idle > total) throw Error('CPU_UNAVAILABLE');
    const percent = 100 * (total - idle) / total;
    cpu = {status: 'ok', value: percent, percent, unit: '%', measuredAt: clock().toISOString(),
      startedAt: cpuStart, source: sources.cpu, scope: '전체 논리 CPU', sampleMs};
  } catch {
    cpu = unavailable('cpu', 'CPU 시간 정보를 읽지 못했거나 측정 구간의 변화량을 확인할 수 없습니다.', clock().toISOString());
  }
  let memory;
  try {
    const total = totalmem(), free = freemem();
    if (!finite(total) || total <= 0 || !finite(free) || free < 0 || free > total) throw Error('MEMORY_UNAVAILABLE');
    memory = {status: 'ok', value: (total - free) / GIB, totalGiB: total / GIB,
      percent: 100 * (total - free) / total, unit: 'GiB', measuredAt: clock().toISOString(),
      source: sources.memory, scope: '전체 물리 메모리 · 총량 - OS 가용량'};
  } catch {
    memory = unavailable('memory', '운영체제의 전체·가용 물리 메모리를 읽지 못했습니다.', clock().toISOString());
  }
  let disk;
  try {
    if (!diskPath) throw Error('DISK_UNSUPPORTED');
    const fs = await readDisk(diskPath, {bigint: true});
    const size = fs.frsize > 0 ? fs.frsize : fs.bsize;
    const total = Number(size * fs.blocks), available = Number(size * fs.bavail);
    if (!finite(total) || total <= 0 || !finite(available) || available < 0 || available > total) throw Error('DISK_UNAVAILABLE');
    disk = {status: 'ok', value: available / GIB, totalGiB: total / GIB, percent: 100 * available / total,
      unit: 'GiB', measuredAt: clock().toISOString(), source: sources.disk, scope: 'C: 드라이브 · 일반 사용자 가용 공간'};
  } catch (error) {
    const reason = ['EACCES', 'EPERM'].includes(error?.code) ? '현재 일반 사용자 권한으로 C: 공간을 읽을 수 없습니다.'
      : !diskPath ? '이 실행 환경은 C: 드라이브 측정을 지원하지 않습니다.'
        : 'C: 드라이브가 없거나 파일 시스템의 가용 공간을 읽지 못했습니다.';
    disk = unavailable('disk', reason, clock().toISOString());
  }
  return {kind: 'measured', measuredAt: clock().toISOString(), cpu, memory, disk};
}

export function createPcStatusService({
  directory = fileURLToPath(new URL('../.local/pc-status/', import.meta.url)),
  clock = () => new Date(), measure = () => measurePc({clock}),
} = {}) {
  const file = join(directory, 'history.jsonl');
  let rows = [], initialized = false, storage = {status: 'ok', reason: ''};
  let chain = Promise.resolve(), lastCompacted = 0, pending = null, needsCompaction = false;
  const now = () => clock().getTime();
  const prune = () => {
    const time = now();
    const before = rows.length;
    rows = rows.filter(row => Date.parse(row.measuredAt) > time - PC_RETENTION_MS
      && Date.parse(row.measuredAt) <= time + 5000).slice(-MAX_ROWS);
    if (rows.length < before) needsCompaction = true;
  };
  const enqueue = fn => {
    const result = chain.then(fn);
    chain = result.catch(() => {});
    return result;
  };
  async function checkFile() {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) throw Error('UNSAFE_HISTORY');
      return info;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function init() {
    if (initialized) return;
    initialized = true;
    try {
      for (let parent = resolve(directory); ; parent = dirname(parent)) {
        try {
          const info = await lstat(parent);
          if (!info.isDirectory() || info.isSymbolicLink()) throw Error('UNSAFE_DIRECTORY');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (dirname(parent) === parent) break;
      }
      await mkdir(directory, {recursive: true});
      const folder = await lstat(directory);
      if (!folder.isDirectory() || folder.isSymbolicLink()) throw Error('UNSAFE_DIRECTORY');
      if (await checkFile()) {
        const data = await readFile(file, 'utf8');
        const loaded = data.split('\n').filter(Boolean).map(line => JSON.parse(line));
        if (!loaded.every(isPcSample)) throw Error('INVALID_HISTORY');
        rows = loaded.sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
      }
      prune();
    } catch {
      rows = [];
      storage = {status: 'unavailable', reason: '로컬 기록을 읽거나 보관 위치를 확인하지 못했습니다. 실측값은 별도로 표시하며 기존 파일은 덮어쓰지 않습니다.'};
    }
  }
  async function persist(sample) {
    if (storage.status !== 'ok') return;
    try {
      const info = await checkFile();
      if (!lastCompacted || needsCompaction || now() - lastCompacted >= 10 * 60 * 1000 || (info?.size ?? 0) > MAX_BYTES * .8) {
        const temporary = file + '.pending-' + process.pid;
        await writeFile(temporary, rows.map(row => JSON.stringify(row)).join('\n') + '\n', {flag: 'wx', mode: 0o600});
        await rename(temporary, file);
        lastCompacted = now();
        needsCompaction = false;
      } else await appendFile(file, JSON.stringify(sample) + '\n', {mode: 0o600});
    } catch {
      storage = {status: 'unavailable', reason: '로컬 기록 저장에 실패했습니다. 현재 실측값은 읽었지만 재실행 후 기록 복원은 보장할 수 없습니다.'};
    }
  }
  const envelope = () => ({schema: SCHEMA, kind: 'measured', intervalMs: PC_INTERVAL_MS,
    retentionHours: 24, disk: 'C:', servedAt: clock().toISOString(), storage: {...storage},
    nextSampleAt: rows.length ? new Date(measurementStart(rows.at(-1)) + PC_INTERVAL_MS).toISOString() : null});
  return Object.freeze({
    history: () => enqueue(async () => {
      await init(); prune();
      return {...envelope(), latest: rows.at(-1) ?? null, history: structuredClone(rows)};
    }),
    sample() {
      if (pending) return pending;
      pending = enqueue(async () => {
        await init(); prune();
        let latest = rows.at(-1);
        const started = now();
        const age = latest ? started - measurementStart(latest) : Infinity;
        if (age < 0 || age >= PC_INTERVAL_MS) {
          latest = {...await measure(), startedAt: new Date(started).toISOString()};
          if (!isPcSample(latest) || Math.abs(Date.parse(latest.measuredAt) - now()) > 5000) throw Error('PC_MEASUREMENT_INVALID');
          rows.push(latest); prune();
          await persist(latest);
        }
        return {...envelope(), latest: structuredClone(latest)};
      }).finally(() => { pending = null; });
      return pending;
    },
  });
}
