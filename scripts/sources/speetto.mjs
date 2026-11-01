// 스피또(500/1000/2000) 발행내역(출고율·잔여수량) 수집부.
//
// ⚠️ 아직 연결되지 않았습니다. 동행복권 스피또 발행내역 페이지(/st/pblcnDsctn)는
//    표 틀만 있고 값은 내부 JSON 으로 불러옵니다. 그 주소를 확인해야 합니다.
//
// 주소가 확인되면 이 함수만 채우면 됩니다. 반환 형식:
//   { status: 'ok', updatedAt: '2026-10-31T00:00:00Z',
//     rows: [{ game: 'speetto2000', round: 56, rate: 92, totalFirst: 6, remainFirst: 1,
//              totalSecond: 18, remainSecond: 2 }, ...] }
//   game 값: speetto2000 | speetto1000 | speetto500   (게임마다 최신 2개 회차면 충분)
export async function fetchSpeetto({ prev }) {
  return {
    status: 'not-configured',
    message: '스피또 자동 연동 주소가 아직 설정되지 않았습니다.',
    rows: (prev && prev.rows) || []
  };
}
