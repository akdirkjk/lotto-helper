#!/usr/bin/env node
// 로또 / 연금복권 / 스피또 데이터를 받아 data/lottery.json 으로 저장합니다.
// Node 22 이상, 외부 패키지 없음. GitHub Actions 에서 예약 실행됩니다.
//
// 원칙
//  1) 받은 값은 모두 검증하고, 하나라도 이상하면 "기존 데이터를 그대로 유지"합니다.
//  2) 변경이 없으면 파일을 쓰지 않습니다 (불필요한 커밋 방지).
//  3) 가져오지 못한 항목이 있으면 종료 코드 1 → Actions 가 빨간색으로 표시되고 메일이 옵니다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchPension } from './sources/pension.mjs';
import { fetchSpeetto } from './sources/speetto.mjs';

const env = process.env;
const CFG = {
  dataPath: env.DATA_PATH || 'data/lottery.json',
  official: env.LOTTO_OFFICIAL_URL || 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all',
  mirror: env.LOTTO_MIRROR_BASE || 'https://smok95.github.io/lotto/results/',
  keep: 60,            // 보관할 최근 회차 수
  timeoutMs: 15000
};

// ---------- 공통 ----------
const nowMs = () => (env.NOW_MS ? Number(env.NOW_MS) : Date.now());
const WEEK = 7 * 24 * 3600 * 1000;
const LOTTO_FIRST = Date.UTC(2002, 11, 7, 11, 45);               // 1회: 2002-12-07 20:45 KST
const expectedLotto = () => Math.floor((nowMs() - LOTTO_FIRST) / WEEK) + 1;
const drawDate = (n) => new Date(Date.UTC(2002, 11, 7) + (n - 1) * WEEK).toISOString().slice(0, 10);

export async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json, text/plain, */*', 'user-agent': 'lottery-data-updater/1.0 (personal use)', ...headers }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (text.trimStart().startsWith('<')) throw new Error('JSON이 아닌 HTML 응답 (점검·접속 대기·차단일 수 있음)');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- 로또 ----------
function cleanLotto({ draw, numbers, bonus }) {
  draw = Number(draw);
  const nums = (Array.isArray(numbers) ? numbers : []).map(Number);
  bonus = Number(bonus);
  if (!Number.isInteger(draw) || draw < 1) return null;
  if (nums.length !== 6 || nums.some((n) => !Number.isInteger(n) || n < 1 || n > 45) || new Set(nums).size !== 6) return null;
  if (!Number.isInteger(bonus) || bonus < 1 || bonus > 45 || nums.includes(bonus)) return null;
  return { draw, date: drawDate(draw), numbers: [...nums].sort((a, b) => a - b), bonus };
}

// 최신부터 연속 keep 개만 남기고, 이상한 점이 있으면 예외
function finalizeLotto(rows, sourceName, prev) {
  const byDraw = new Map(rows.map((r) => [r.draw, r]));
  const latest = Math.max(...byDraw.keys());
  if (latest > expectedLotto()) throw new Error(`아직 추첨 전인 회차(${latest}회)가 들어 있습니다`);
  const draws = [];
  for (let d = latest; d > latest - CFG.keep; d--) {
    if (!byDraw.has(d)) throw new Error(`${d}회 데이터가 빠져 있습니다`);
    draws.push(byDraw.get(d));
  }
  // 이미 저장된 회차의 번호가 바뀌었다면 → 형식 변경이나 오염 가능성이 있으니 거부
  const old = prev && Array.isArray(prev.draws) ? prev.draws : [];
  const oldLatest = old.length ? Math.max(...old.map((d) => d.draw)) : 0;
  if (latest < oldLatest) throw new Error(`최신 회차가 이전(${oldLatest}회)보다 낮습니다`);
  for (const o of old) {
    const n = byDraw.get(o.draw);
    if (n && n.numbers.join() !== o.numbers.join()) throw new Error(`${o.draw}회 번호가 저장본과 다릅니다 (형식 변경·오염 의심)`);
  }
  return { latest, source: sourceName, draws };
}

async function lottoFromOfficial(prev) {
  const json = await getJson(CFG.official, { referer: 'https://www.dhlottery.co.kr/lt645/result' });
  const list = json && json.data && json.data.list;
  if (!Array.isArray(list) || !list.length) throw new Error('응답 형식이 달라졌습니다 (data.list 없음)');
  const rows = list
    .map((it) => cleanLotto({ draw: it.ltEpsd, numbers: [1, 2, 3, 4, 5, 6].map((i) => it['tm' + i + 'WnNo']), bonus: it.bnsWnNo }))
    .filter(Boolean);
  if (rows.length < list.length * 0.99) throw new Error(`형식이 맞지 않는 행이 많습니다 (${rows.length}/${list.length})`);
  return finalizeLotto(rows, 'official', prev);
}

async function lottoFromMirror(prev) {
  const base = CFG.mirror;
  const latestRaw = await getJson(base + 'latest.json');
  const latest = Number(latestRaw.draw_no);
  if (!Number.isInteger(latest)) throw new Error('미러 최신 회차 형식 오류');
  const want = Array.from({ length: CFG.keep }, (_, i) => latest - i);
  const rows = (await pool(want, 8, async (d) => {
    const o = d === latest ? latestRaw : await getJson(base + d + '.json');
    return cleanLotto({ draw: o.draw_no, numbers: o.numbers, bonus: o.bonus_no });
  })).filter(Boolean);
  return finalizeLotto(rows, 'mirror', prev);
}

async function updateLotto(prev) {
  const errors = [];
  for (const [name, fn] of [['공식', lottoFromOfficial], ['미러', lottoFromMirror]]) {
    try {
      const r = await fn(prev);
      console.log(`로또: ${name} 데이터로 ${r.latest}회까지 확보`);
      return r;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.warn(`로또 ${name} 실패 → ${e.message}`);
    }
  }
  throw new Error(errors.join(' / '));
}

// ---------- 저장 ----------
const skeleton = () => ({
  schema: 1,
  generatedAt: '',
  lotto: { latest: 0, source: '', draws: [] },
  pension: { status: 'not-configured', message: '', draws: [] },
  speetto: { status: 'not-configured', message: '', rows: [] }
});

async function readPrev() {
  try { return { ...skeleton(), ...JSON.parse(await readFile(CFG.dataPath, 'utf8')) }; }
  catch { return skeleton(); }
}
const stable = (o) => JSON.stringify({ ...o, generatedAt: '' });

async function main() {
  const prev = await readPrev();
  const next = JSON.parse(JSON.stringify(prev));
  const problems = [];

  try { next.lotto = await updateLotto(prev.lotto); }
  catch (e) { problems.push('로또: ' + e.message); }

  for (const [key, fn] of [['pension', fetchPension], ['speetto', fetchSpeetto]]) {
    try {
      const r = await fn({ prev: prev[key], env, getJson });
      if (r) next[key] = r;
      if (r && r.status === 'error') problems.push(`${key}: ${r.message}`);
    } catch (e) {
      problems.push(`${key}: ${e.message}`);
      next[key] = { ...(prev[key] || {}), status: 'error', message: e.message };   // 기존 값은 유지
    }
  }

  if (stable(next) !== stable(prev)) {
    next.generatedAt = new Date(nowMs()).toISOString();
    await mkdir(dirname(CFG.dataPath), { recursive: true });
    await writeFile(CFG.dataPath, JSON.stringify(next, null, 1) + '\n', 'utf8');
    console.log('저장함:', CFG.dataPath);
  } else {
    console.log('변경 없음 (파일을 쓰지 않음)');
  }

  if (problems.length) {
    console.error('\n⚠️ 문제가 있었습니다:\n- ' + problems.join('\n- '));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('update.mjs')) main();
