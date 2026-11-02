// Diagnostic v2: shows how the Speetto page requests and renders its data (run by the Discover workflow)
const HOST = process.env.HOST || 'https://www.dhlottery.co.kr';
const UA = 'lottery-data-updater/1.0 (personal use)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (s) => s.replace(/\s+/g, ' ');

async function req(url, opt = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'application/json, text/html, */*', ...(opt.headers || {}) }
  });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type') || '', text };
}

const PAGE = '/st/pblcnDsctn?stGmTypeCd=st2000';
console.log('\n===== SPEETTO PAGE ' + HOST + PAGE);
const page = await req(HOST + PAGE);
const html = page.text;
console.log('status ' + page.status + ', ' + html.length + ' bytes');

// 1) the code that builds the table (shows which fields hold the numbers)
const m1 = /fn_handleTable\s*:\s*function/.exec(html);
console.log('\n--- [1] table building code');
console.log(m1 ? squash(html.slice(m1.index, m1.index + 7000)) : 'not found');

// 2) filter buttons (gdsType / gdsPrice / gdsStatus) and their values
console.log('\n--- [2] filter buttons');
const tags = [...html.matchAll(/<[a-z]+[^>]*class="[^"]*(?:gdsType|gdsPrice|gdsStatus)[^"]*"[^>]*>/gi)];
for (const t of tags.slice(0, 40)) console.log(squash(html.slice(t.index, t.index + t[0].length + 60)));
if (!tags.length) console.log('no matching tags');

// 3) how the shared request helper sends GET parameters (array encoding etc.)
console.log('\n--- [3] request helper (sendHttpJson)');
const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
  .map((m) => new URL(m[1], HOST + PAGE).href)
  .filter((u) => u.startsWith(HOST))
  .slice(0, 30);
const blobs = [['page html', html]];
for (const u of srcs) {
  await sleep(250);
  try {
    const js = await req(u);
    if (js.status === 200) blobs.push([u.replace(HOST, ''), js.text]);
  } catch (e) { /* ignore */ }
}
let found = false;
for (const [label, text] of blobs) {
  const m = /sendHttpJson\s*[:=]\s*(?:async\s*)?function\s*\([^)]*\)\s*\{/.exec(text) || /function\s+sendHttpJson\s*\([^)]*\)\s*\{/.exec(text);
  if (m) {
    console.log('found in ' + label);
    console.log(squash(text.slice(m.index, m.index + 2500)));
    found = true;
    break;
  }
}
if (!found) console.log('definition not found in ' + blobs.length + ' files');

// 4) direct calls with different parameter styles
const H = { 'x-requested-with': 'XMLHttpRequest', referer: HOST + PAGE };
const base = 'pageNum=1&recordCountPerPage=8';
const VARIANTS = [
  ['no filters', base],
  ['gdsType=SP2000', 'gdsType=SP2000&' + base],
  ['gdsType=st2000', 'gdsType=st2000&' + base],
  ['gdsType[]=SP2000', 'gdsType%5B%5D=SP2000&' + base],
  ['guess all three', 'gdsType=SP2000&gdsPrice=2000&gdsStatus=ING&' + base]
];
console.log('\n\n===== DIRECT CALLS =====');
for (const [label, qs] of VARIANTS) {
  await sleep(700);
  console.log('\n>>> ' + label + '  GET /st/selectPblcnDsctn.do?' + qs);
  try {
    const r = await req(HOST + '/st/selectPblcnDsctn.do?' + qs, { headers: H });
    console.log('status ' + r.status + ' | ' + r.type + ' | ' + r.text.length + ' bytes');
    let j = null;
    try { j = JSON.parse(r.text); } catch (e) { /* not json */ }
    if (j && j.data && Array.isArray(j.data.list)) {
      console.log('total=' + j.data.total + ' list.length=' + j.data.list.length);
      console.log('LIST ITEM 0: ' + JSON.stringify(j.data.list[0]));
      console.log('LIST ITEM 1: ' + JSON.stringify(j.data.list[1]));
      const rd = j.data.stRnkDate;
      console.log('stRnkDate length=' + (rd ? rd.length : 'none') + ' ITEM 0: ' + JSON.stringify(rd && rd[0]));
    } else {
      console.log(squash(r.text).slice(0, 700));
    }
  } catch (e) {
    console.log('request failed: ' + e.message);
  }
}
console.log('\n===== DONE =====');
