// 연금복권720+ 당첨번호 수집부.
//
// ⚠️ 아직 연결되지 않았습니다. 동행복권 연금복권 결과 페이지가 내부적으로 부르는 JSON 주소를
//    확인해야 합니다. (Actions 탭 → "주소 탐색" 을 실행하면 후보 주소가 로그에 나옵니다)
//
// 주소가 확인되면 이 함수만 채우면 됩니다. 반환 형식:
//   { status: 'ok', draws: [{ draw: 339, date: '2026-10-29', group: 2, numbers: [4,8,5,2,1,6] }, ...] }
//   (draws 는 최신 회차부터, 최소 26개 권장)
export async function fetchPension({ prev }) {
  return {
    status: 'not-configured',
    message: '연금복권 자동 연동 주소가 아직 설정되지 않았습니다.',
    draws: (prev && prev.draws) || []
  };
}
