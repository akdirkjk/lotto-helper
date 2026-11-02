// Pension Lottery 720+ results (uses the same JSON the official result page loads).
//   GET /pt720/selectPstPt720WnList.do  -> every draw: psltEpsd, psltRflYmd, wnBndNo (group), wnRnkVl (6 digits)
const WEEK = 7 * 24 * 3600 * 1000;
const PENSION_FIRST = Date.UTC(2020, 4, 7, 10, 30);   // draw 1: 2020-05-07 evening (KST)
const KEEP = 60;                                       // how many recent draws to store

function ymd(s) {
  s = String(s ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

function clean(it) {
  const draw = Number(it.psltEpsd);
  const group = Number(it.wnBndNo);
  const digits = String(it.wnRnkVl ?? '');
  if (!Number.isInteger(draw) || draw < 1) return null;
  if (!Number.isInteger(group) || group < 1 || group > 5) return null;
  if (!/^\d{6}$/.test(digits)) return null;
  return { draw, date: ymd(it.psltRflYmd), group, numbers: digits.split('').map(Number) };
}

export async function fetchPension({ prev, env, getJson }) {
  const host = env.DH_HOST || 'https://www.dhlottery.co.kr';
  const now = env.NOW_MS ? Number(env.NOW_MS) : Date.now();
  const expected = Math.floor((now - PENSION_FIRST) / WEEK) + 1;

  const json = await getJson(host + '/pt720/selectPstPt720WnList.do', {
    referer: host + '/pt720/result',
    'x-requested-with': 'XMLHttpRequest'
  });
  const list = json && json.data && json.data.result;
  if (!Array.isArray(list) || !list.length) {
    throw new Error('Unexpected response (data.result missing)' + (json && json.resultMessage ? ': ' + json.resultMessage : ''));
  }

  const rows = list.map(clean).filter(Boolean);
  if (rows.length < list.length * 0.99) throw new Error(`Too many malformed rows (${rows.length}/${list.length})`);

  const byDraw = new Map(rows.map((r) => [r.draw, r]));
  const latest = Math.max(...byDraw.keys());
  if (latest > expected) throw new Error(`Draw ${latest} is later than expected (${expected})`);

  const draws = [];
  for (let d = latest; d > latest - KEEP; d--) {
    if (!byDraw.has(d)) throw new Error(`Draw ${d} is missing`);
    draws.push(byDraw.get(d));
  }

  // Already stored draws must not change (guards against format changes / corrupted responses)
  const old = prev && Array.isArray(prev.draws) ? prev.draws : [];
  const oldLatest = old.length ? Math.max(...old.map((d) => d.draw)) : 0;
  if (latest < oldLatest) throw new Error(`Latest draw ${latest} is lower than stored ${oldLatest}`);
  for (const o of old) {
    const n = byDraw.get(o.draw);
    if (n && (n.group !== o.group || n.numbers.join('') !== o.numbers.join(''))) {
      throw new Error(`Draw ${o.draw} differs from the stored copy`);
    }
  }

  console.log(`Pension: got draws up to ${latest}`);
  return { status: 'ok', source: 'official', latest, draws };
}
