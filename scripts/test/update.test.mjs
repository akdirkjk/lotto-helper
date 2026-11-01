// 실행: node --test scripts/test/
// 가짜 서버(공식/미러)를 띄워 update.mjs 의 동작을 확인합니다. 실제 인터넷에는 접속하지 않습니다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW_1248 = Date.UTC(2026, 9, 31, 12, 0);   // 2026-10-31 21:00 KST → 1248회까지 나온 시점
const NOW_1249 = Date.UTC(2026, 10, 7, 12, 0);

let server, port;
const state = { latest: 1248, official: 'ok', mirror: 'ok' };

function nums(n) {
  const s = new Set(); let k = n;
  while (s.size < 6) { k = (k * 31 + 7) % 45; s.add(k + 1); }
  const arr = [...s];
  let b = (n % 45) + 1; while (arr.includes(b)) b = (b % 45) + 1;
  return { arr, b };
}
const officialRow = (n, tamper) => {
  const { arr, b } = nums(n);
  const a = tamper ? [...arr.slice(0, 5), ((arr[5] % 45) + 1)] : arr;
  const o = { ltEpsd: n, ltRflYmd: '20261031' };
  a.forEach((v, i) => { o['tm' + (i + 1) + 'WnNo'] = v; });
  o.bnsWnNo = b;
  return o;
};

before(async () => {
  server = http.createServer((req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.url.startsWith('/official')) {
      if (state.official === 'html') return send(200, '<html>접속 대기</html>', 'text/html');
      if (state.official === '500') return send(500, 'err');
      const last = state.official === 'future' ? state.latest + 2 : state.latest;
      const list = Array.from({ length: last }, (_, i) => officialRow(i + 1, state.official === 'tampered' && i + 1 === state.latest - 3));
      return send(200, JSON.stringify({ data: { list } }));
    }
    const m = req.url.match(/^\/mirror\/(latest|\d+)\.json$/);
    if (m) {
      if (state.mirror === 'down') return send(503, 'down');
      const n = m[1] === 'latest' ? state.latest : Number(m[1]);
      if (n > state.latest) return send(404, '{}');
      const { arr, b } = nums(n);
      return send(200, JSON.stringify({ draw_no: n, numbers: arr, bonus_no: b, date: '2026-10-31T00:00:00Z' }));
    }
    send(404, 'no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());

// 주의: 가짜 서버가 같은 프로세스에 있으므로 spawnSync 를 쓰면 서버가 멈춰 버립니다 → 비동기 실행
function run(dataPath, now = NOW_1248) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/update.mjs'], {
      env: { ...process.env, DATA_PATH: dataPath, NOW_MS: String(now),
        LOTTO_OFFICIAL_URL: `http://127.0.0.1:${port}/official`, LOTTO_MIRROR_BASE: `http://127.0.0.1:${port}/mirror/` }
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => child.kill(), 20000);
    child.on('close', (code) => { clearTimeout(kill); resolve({ code, out }); });
  });
}
const tmp = () => join(mkdtempSync(join(tmpdir(), 'lotto-')), 'lottery.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const reset = () => { state.latest = 1248; state.official = 'ok'; state.mirror = 'ok'; };

test('공식 데이터로 최근 60회차 저장', async () => {
  reset(); const p = tmp(); const r = await run(p);
  const d = read(p);
  assert.equal(r.code, 0, r.out);
  assert.equal(d.lotto.source, 'official');
  assert.equal(d.lotto.latest, 1248);
  assert.equal(d.lotto.draws.length, 60);
  assert.equal(d.lotto.draws[0].date, '2026-10-31');
  assert.equal(d.lotto.draws[59].draw, 1189);
  assert.equal(d.lotto.draws[0].numbers.length, 6);
});

test('다시 실행해도 변경이 없으면 파일을 쓰지 않음', async () => {
  reset(); const p = tmp(); await run(p);
  const before = readFileSync(p, 'utf8');
  const r = await run(p);
  assert.match(r.out, /변경 없음/);
  assert.equal(readFileSync(p, 'utf8'), before);
});

test('공식이 HTML(접속 대기)을 돌려주면 미러로 대체', async () => {
  reset(); state.official = 'html'; const p = tmp(); const r = await run(p);
  assert.equal(r.code, 0, r.out);
  assert.equal(read(p).lotto.source, 'mirror');
});

test('둘 다 실패하면 기존 데이터를 유지하고 실패(종료코드 1)로 알림', async () => {
  reset(); const p = tmp(); await run(p);
  const before = readFileSync(p, 'utf8');
  state.official = '500'; state.mirror = 'down';
  const r = await run(p);
  assert.equal(r.code, 1);
  assert.equal(readFileSync(p, 'utf8'), before);
});

test('저장된 회차의 번호가 바뀐 응답은 거부', async () => {
  reset(); const p = tmp(); await run(p);
  const keep = read(p).lotto.draws.find((x) => x.draw === 1245).numbers.join();
  state.official = 'tampered';
  const r = await run(p);
  assert.match(r.out, /저장본과 다릅니다/);
  assert.equal(read(p).lotto.draws.find((x) => x.draw === 1245).numbers.join(), keep);
});

test('아직 추첨 전인 회차가 섞인 응답은 거부', async () => {
  reset(); state.official = 'future'; const p = tmp(); const r = await run(p);
  assert.match(r.out, /추첨 전인 회차/);
  assert.equal(read(p).lotto.source, 'mirror');
});

test('새 회차(1249)가 나오면 반영하고 60개를 유지', async () => {
  reset(); const p = tmp(); await run(p);
  state.latest = 1249;
  const r = await run(p, NOW_1249);
  const d = read(p);
  assert.equal(r.code, 0, r.out);
  assert.equal(d.lotto.latest, 1249);
  assert.equal(d.lotto.draws[0].draw, 1249);
  assert.equal(d.lotto.draws.length, 60);
});
