// Speetto (500 / 1000 / 2000) on-sale rounds: store stocking rate and remaining 1st / 2nd prizes.
// Uses the same JSON the official "issue details" page loads:
//   GET /st/selectPblcnDsctn.do?gdsType=SP2000&gdsPrice=2000&gdsStatus=<on sale>&pageNum=1&recordCountPerPage=8
// All three filters are required by the server. Items carry:
//   stGmTypeCd, stEpsd (round), stSpmtRt (store stocking rate %), stRnk1Rt / stRnk2Rt ("remaining/total"), dataChgDt (as-of date)
const ON_SALE = '\uD310\uB9E4\uC911';   // the on-sale status value used by the page (kept as escapes so the file stays ASCII)
const GAMES = [
  ['SP2000', '2000', 'speetto2000'],
  ['SP1000', '1000', 'speetto1000'],
  ['SP500', '500', 'speetto500']
];
const KEEP_PER_GAME = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function remainTotal(s) {
  const m = /^\s*([\d,]+)[^\d,/]*\/\s*([\d,]+)[^\d,/]*$/.exec(String(s ?? ''));
  return m ? { remain: Number(m[1].replace(/,/g, '')), total: Number(m[2].replace(/,/g, '')) } : null;
}

function asOfDate(s) {
  s = String(s ?? '').trim();
  if (/^\d{2}-\d{2}-\d{2}$/.test(s)) return '20' + s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

function clean(it, code, key) {
  if (!it || it.stGmTypeCd !== code) return null;
  const round = Number(it.stEpsd);
  const rate = Number(String(it.stSpmtRt ?? '').replace('%', ''));
  const r1 = remainTotal(it.stRnk1Rt);
  let r2 = remainTotal(it.stRnk2Rt);
  if (!r2 && !/\d/.test(String(it.stRnk2Rt ?? ''))) r2 = { remain: 0, total: 0 };   // no 2nd prize (empty, "-", "-/-", a label ...)
  if (!Number.isInteger(round) || round < 1) return null;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return null;
  if (!r1 || !r2 || r1.remain > r1.total || r2.remain > r2.total) return null;
  return {
    game: key, round, rate,
    totalFirst: r1.total, remainFirst: r1.remain,
    totalSecond: r2.total, remainSecond: r2.remain,
    asOf: asOfDate(it.dataChgDt)
  };
}

export async function fetchSpeetto({ prev, env, getJson }) {
  const host = env.DH_HOST || 'https://www.dhlottery.co.kr';
  const now = env.NOW_MS ? Number(env.NOW_MS) : Date.now();
  const rows = [];

  for (const [code, price, key] of GAMES) {
    await sleep(env.NOW_MS ? 0 : 600);   // be gentle with the server
    const qs = `gdsType=${code}&gdsPrice=${price}&gdsStatus=${encodeURIComponent(ON_SALE)}&pageNum=1&recordCountPerPage=8`;
    const json = await getJson(host + '/st/selectPblcnDsctn.do?' + qs, {
      referer: host + '/st/pblcnDsctn?stGmTypeCd=st' + price,
      'x-requested-with': 'XMLHttpRequest',
      AJAX: 'true',
      requestMenuUri: '/st/pblcnDsctn'
    });
    const list = json && json.data && json.data.list;
    if (!Array.isArray(list)) {
      throw new Error(`${key}: unexpected response (data.list missing)` + (json && json.resultMessage ? ': ' + json.resultMessage : ''));
    }
    const mine = list.filter((it) => it && it.stGmTypeCd === code);
    const good = mine.map((it) => clean(it, code, key)).filter(Boolean);
    if (good.length < mine.length) {
      const bad = mine.find((it) => !clean(it, code, key));
      const show = (k) => k + '=' + JSON.stringify(String(bad[k] ?? '')).slice(0, 40);
      const sample = ['stEpsd', 'stSpmtRt', 'stRnk1Rt', 'stRnk2Rt'].map(show).join(' ');
      throw new Error(`${key}: ${mine.length - good.length} item(s) have an unexpected format (e.g. ${sample})`);
    }
    good.sort((a, b) => b.round - a.round);
    rows.push(...good.slice(0, KEEP_PER_GAME));
  }

  if (!rows.length) throw new Error('No on-sale rounds were returned for any game');

  const checkedAt = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);   // KST date of this check
  console.log(`Speetto: ${rows.length} on-sale rounds (${rows.map((r) => r.game.replace('speetto', '') + ':' + r.round).join(', ')})`);
  return { status: 'ok', source: 'official', checkedAt, rows };
}
