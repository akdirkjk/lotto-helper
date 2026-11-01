#!/usr/bin/env node
// 동행복권 페이지가 내부적으로 부르는 데이터 주소(.do / API)를 찾아 로그로 출력합니다.
// 한 번만 실행하는 진단용입니다. (페이지 HTML 과 거기 연결된 스크립트를 읽기만 합니다)
const HOST = 'https://www.dhlottery.co.kr';
const PAGES = [
  ['연금복권 추첨결과', '/pt720/result'],
  ['스피또2000 발행내역', '/st/pblcnDsctn?stGmTypeCd=st2000'],
  ['스피또1000 발행내역', '/st/pblcnDsctn?stGmTypeCd=st1000'],
  ['스피또500 발행내역', '/st/pblcnDsctn?stGmTypeCd=st500'],
  ['로또 추첨결과 (비교용)', '/lt645/result']
];
const H = { 'user-agent': 'lottery-data-updater/1.0 (personal use)', accept: 'text/html,*/*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: H, redirect: 'follow' });
  const text = await res.text();
  return { status: res.status, finalUrl: res.url, text };
}

const RE_DO = /["'`]((?:https?:\/\/[^"'`\s]+)?\/[A-Za-z0-9_\-\/]+\.do(?:\?[^"'`\s]*)?)["'`]/g;
const RE_API = /["'`](\/(?:pt720|st|lt645|common|api)\/[A-Za-z0-9_\-\/]+(?:\?[^"'`\s]*)?)["'`]/g;
function findEndpoints(text) {
  const out = new Set();
  for (const re of [RE_DO, RE_API]) for (const m of text.matchAll(re)) out.add(m[1]);
  return out;
}

const seen = new Map();   // 주소 -> 어디서 발견했는지
for (const [label, path] of PAGES) {
  console.log(`\n===== ${label}  ${HOST}${path}`);
  try {
    const page = await get(HOST + path);
    console.log(`상태 ${page.status}, ${page.text.length.toLocaleString()}바이트, 최종 주소 ${page.finalUrl}`);
    if (page.status !== 200) { console.log('→ 정상 응답이 아닙니다. (접속 제한일 수 있음)'); continue; }
    findEndpoints(page.text).forEach((e) => { if (!seen.has(e)) seen.set(e, `${label} (HTML)`); });

    const srcs = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
      .map((m) => new URL(m[1], page.finalUrl).href)
      .filter((u) => u.startsWith(HOST) && !/jquery|bootstrap|\.min\.js.*(slick|swiper)/i.test(u))
      .slice(0, 20);
    for (const u of srcs) {
      await sleep(300);                                   // 서버에 부담을 주지 않도록 천천히
      try {
        const js = await get(u);
        if (js.status !== 200 || js.text.length > 3_000_000) continue;
        findEndpoints(js.text).forEach((e) => { if (!seen.has(e)) seen.set(e, `${label} → ${u.replace(HOST, '')}`); });
      } catch { /* 무시 */ }
    }
  } catch (e) {
    console.log('요청 실패:', e.message);
  }
  await sleep(500);
}

const interesting = [...seen].filter(([e]) => /pt720|\/st\/|lt645|Epsd|Pblcn|select|Info|result/i.test(e));
console.log(`\n\n===== 발견된 후보 주소 (${interesting.length}개 / 전체 ${seen.size}개) =====`);
for (const [e, where] of interesting.slice(0, 200)) console.log(`${e}\n    ↳ ${where}`);
if (!seen.size) console.log('발견된 주소가 없습니다. 접속이 제한되었거나, 페이지가 다른 방식으로 데이터를 불러올 수 있습니다.');
