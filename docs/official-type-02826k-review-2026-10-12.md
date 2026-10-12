# 02826K 공식 유형 차단 수정 검토 — 2026-10-12

## 원인과 운영 확인 범위

부모가 확인한 사용자 직접 실행: 2026-10-12 13:00:32~13:00:37 KST.
Render 로그 04:00:37.003762973 UTC, instance `srv-dajs02p42hec73fn02h0-c4h5f`:
`TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE`, stage `UNIVERSE_LOAD`, 목록 요청 10회,
유형 확인 4회, 유형 HTTP 요청 0회, `02826K` / `KOSPI`.
이번 실행에는 중복 이벤트가 없었다. 이전 중복의 해결 여부는 입증되지 않았다.

`02826K`는 유효한 마지막 영문형 코드다. 해당 코드는 공식 유형 확인이 필요하지만
기준 main `29b36c615d5cb5715c1168cfb29ae4bd49318239`의 검토 근거 목록에는 없었다.
따라서 코드 문법 문제가 아니라 검토된 정확한 근거의 누락으로 `UNVERIFIED`가 반환됐다.

## 검토한 공식 근거

1. [삼성물산 공식 IR 기본정보](https://www.samsungcnt.com/ir/stock-info/listinginfo.do)
   - 2026-06-30 기준 표가 보통주 코드 `028260`과 우선주 코드 `02826K`를 구분한다.
   - 우선주 수는 1,467,590주, 신주 상장일은 2015-09-15로 제시한다.
2. [KIND 2026-04-29 정정 주요사항보고서(감자결정)](https://kind.krx.co.kr/external/2026/04/29/001087/20260429002762/11309.htm)
   - 보고 주체가 삼성물산이고 회사 홈페이지도 위 회사와 일치한다.
   - 비보통주 발행현황은 2015-09-02 발행분이며 현재 수량 1,467,590주다.
   - 회사는 우선주 외 다른 종류주식이 없음을 명시한다.
   - 존속기간 항목은 `-`로, 문서에 정해진 만료일이 제시되지 않는다.
     상환권자·전환권자는 없다고 기재한다. 임의의 expiry를 만들지 않았다.

두 자료의 명시적 종류와 동일 클래스 정보로 exact 코드에 연결했다. 코드 말미 K 또는
종목명만으로 판단하지 않았다. KIND의 주식종류 증명과 issuer의 코드 증명을 분리하는
기존 계약을 유지한다. 확인일은 2026-10-12이며, issuer 표의 기준일은 2026-06-30이다.
공시의 감자 효력일 2026-04-29는 보통주 감자에 관한 것으로 우선주 만료일이 아니다.
이 검토를 미래의 모든 회사 변경에 대한 영구 보장으로 표현하지 않는다.

공식 원문을 직접 GET한 사본은 `../type-02826k-evidence/`에 보존했다.
SHA-256:
- issuer-code.html: `e9869f668208d4fb25511d4cac54f3881c58c38c9176377d324fb21d5acfd653`
- kind-type.html: `50ac0b301495455b960d19b6d095b8bf86cc01c55792ea546a9a31aaddfbdfe5`

시세·뉴스·universe 실행 API는 읽지 않았다. 자료 탐색에서 노출된 비공식 시세/뉴스
검색 결과는 분류 근거로 사용하지 않았다.

## 최소 수정

production 변경은 `services/krxStockSecurityType.js` 한 파일이다.

- `02826K` / `A02826K` / KOSPI에 `NON_COMMON` 근거 한 건을 추가한다.
- issuer 코드 근거는 위 exact HTTPS URL에만 허용한다. 다른 코드·시장·URL은 허용하지 않는다.
- 유형 근거는 KIND URL 및 `typeSourceProvider: KRX_KIND`를 계속 요구한다.
- checkedOn은 2026-10-12, testOnly는 false, 기존 evidence 필드 형태를 사용한다.
- 기존 00680K·00088K·00104K 및 unknown 코드의 분류/metadata는 그대로다.

런타임 HTTP·재시도·요청 상한 증가를 추가하지 않았다. 숫자/혼용 코드 정책,
미확인 영문형 차단, 중복 실패, unique500 및 양 시장 cutoff 증명을 유지한다.
확인된 비보통주를 제외해도 raw 시총은 페이지 경계 증명에 계속 포함한다.
가격·추세·거래량·수급·뉴스·AI·판정·주문·history·frontend·lockfile은 변경하지 않았다.

## 회귀와 검토 산출물

`tests/official-stock-type-02826k.test.cjs`의 새 회귀 12개가 다음을 확인한다:
검토 전 UNVERIFIED/검토 후 NON_COMMON, exact provenance, 잘못된 시장/인접/소문자 코드,
URL 변조·issuer 유형 대체의 거부, 기존 분류 보존, 명칭에 의존하지 않는 제외,
excluded row의 cutoff 포함, 신규 검토 코드의 중복 실패, 499개 불완전 목록 실패,
10회 상한 및 미증명 cutoff 실패, 다른 미확인 코드 차단, 정상 fingerprint/요청 수 보존.

역사적 byte/scope 검사는 `without-reviewed-02826k.cjs`로 이 exact record/issuer binding만
정규화하고 다른 모든 유형 검증·cache·분류 코드를 기존 main과 비교한다.
기존 `universe-duplicate-boundary.cjs`도 이번 유형 파일의 정확한 hash와 정규화 비교를 요구한다.
기존 실패진단·페이지증명·중복진단 테스트 3개의 byte 검사에 이 좁은 예외를 연결했다.
다른 assertion·테스트 삭제/skip은 없다.

관련 부분 회귀: **181/181 통과**, 실패·skip 0.
Vite production build: 성공(2,312 modules), 기존 500 kB chunk 경고 유지.
최종 전체 회귀: **2,416/2,416 통과**, 실패·skip·cancelled 0, exit 0(91개 suite).
실행 결과와 metadata는 `../duplicate-evidence/type-full.*`에서 확인한다.

작업 브랜치는 `fix/official-type-02826k`, 시작 기준 HEAD는 `29b36c6`이다.
초기 검토 단계에서는 로컬 변경만 준비했고, 이후 부모 검토 완료 및 기존 사용자 승인에
따라 이 동일 유형 수정의 작업 브랜치 저장·main 반영·backend 배포가 승인됐다.
이 문서는 반영 직전의 검증 기록이며, 실제 SHA·deploy ID·LIVE·설치/시작/health 결과는
최종 배포 보고와 worktree 옆 증거 파일에서 확인한다. 원본 미커밋 파일을 보존했으며
개인 프로젝트에 접근하지 않았다. frontend 배포·설정 변경은 포함하지 않는다.

이 수정이 제거하는 것은 `02826K`에 대한 근거 누락 차단이다. 전체 500종목의 실제
수집 성공이나 기존 중복 문제의 해결은 검증하지 않았다. 다른 미확인 코드·중복·cutoff
미증명·상한 초과가 나오면 여전히 분석을 중단한다.
