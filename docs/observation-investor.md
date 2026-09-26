# KIS 일별 수급 전용 관찰 (실제 조회 미실행)

## 공식 근거와 고정 요청

2026-09-25 확인한 KIS 공식 open-trading-api:

- [호출 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/investor_trade_by_stock_daily.py): `GET /uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily`, TR ID `FHPTJ04160001`.
- [필드 매핑 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/chk_investor_trade_by_stock_daily.py): 아래 원본 필드를 사용한다. Python 코드를 실행/import하지 않았다.

| 원본 필드 | 공식 설명에 따른 의미 |
|---|---|
| stck_bsop_date | 주식 영업 일자 |
| frgn_ntby_qty | 외국인 순매수 수량 |
| orgn_ntby_qty | 기관계 순매수 수량 |
| frgn_shnu_vol / frgn_seln_vol | 외국인 매수 / 매도 거래량 |
| orgn_shnu_vol / orgn_seln_vol | 기관계 매수 / 매도 거래량 |

요청은 `FID_COND_MRKT_DIV_CODE=J`, `FID_INPUT_ISCD=005930`, `FID_INPUT_DATE_1=선택한 대상일(YYYYMMDD)`, `FID_ORG_ADJ_PRC=""`, `FID_ETC_CLS_CODE=""`이다. 두 공란은 공식 예제의 지시이며 일봉의 수정주가 0을 복사하지 않는다. 날짜 누락/잘못된 날짜는 요청 전 거부한다. 시장 J의 KRX 의미는 요청 파라미터 설명에 근거하며 응답에 시장 코드가 있다고 주장하지 않는다.

공식 예제는 output1/output2 각각 객체 또는 배열을 처리한다. 해당 구조에서 7개 필드만 원래 경로와 함께 보존하며 임의 별칭이나 확정 필드를 추가하지 않는다. 수치 원문과 검증 후 정수값을 분리하고, 실제 0과 누락/null/형식 오류를 구별한다. 예제의 수량·거래량 설명을 기록하되 배율의 명시적 설명은 확인하지 못해 `unit.scale=UNVERIFIED`로 둔다.

## 내부 실행과 승인 경계

`createOneShotObservation`의 서버 내부 옵션 `scope:'kis-investor-daily-only'`, `credentialSource:'KIS_LIVE'`로 선택한다. `observe('005930', {targetBusinessDate:'2026-09-23'})`가 이번 검증 예다. 특정 대상일을 코드에 고정하지 않았다. 일반/full 및 일봉 전용은 기존 경로 그대로다.

실행에는 personal-local과 정확히 일치하는 READY 승인이 필요하다. 새 scope의 승인 조건은 아래 **6개 필드**만 허용한다.

`scope, symbol, targetDate, market, kisInvestorMaxRequests:1, kisTokenMaxRequests:1`

새로운 실제 사용자 승인 이후에만 기존 store.issue로 고유 ID를 발급할 수 있다. 이번에는 임시 폴더의 테스트 승인만 사용했다. 기존 일봉 승인 조건·소비 파일·실제 관찰 파일은 변경하지 않았다. 실행 함수가 승인 ID를 자동 생성하지 않는다.

전송 전에 CONSUMED 기록과 기존 공통 제한을 거친다. 새 분류표는 유효한 수급 승인 핸들이 있을 때만 활성화한다. 기존 full/daily 분류표에는 새 API를 추가하지 않았다. 수급 1회+토큰 최대 1회, 자동 토큰 갱신/재시도/리다이렉트/연속 페이지 조회 없음. 원래 제한 숫자는 늘리지 않는다.

독립 수급 어댑터는 기존 KIS_LIVE 설정 선택과 공통 제한의 OAuth 경로를 사용한다. 일봉 reader의 비공개 토큰 함수나 계좌 모듈을 불러오지 않으며 인증 핵심 파일을 수정하지 않았다. 별도 실행에서 다른 인증 설정의 메모리 토큰을 가져오지 않는다. 모듈 import만으로 인증·조회·백그라운드 작업이 시작되지 않는다.

공개 환경에서는 생성과 관찰 API 모두 차단한다. 웹에서 승인 발급 경로를 만들지 않았고 기존 API는 body의 scope/approvalId를 거부하며 query/header 값은 사용하지 않는다. 실행 조건은 서버 내부에서만 지정한다.

## 저장과 결과의 의미

기존 파일 저장 경로/OBSERVATION_V2를 재사용하고 `recordType:INVESTOR_COLLECTION`로 구분한다. 실제 승인 후 결과는 기존 Git 제외 live-once 영역, 테스트는 임시 test 영역에 저장한다. 기존 파일을 덮어쓰지 않는다.

- 승인 ID·대상일·요청 시장·요청 상한/횟수는 요청 근거로 남긴다.
- 제공된 영업일자/7개 필드·원본 경로·요청 연결 ID·수신 시각은 응답 근거로 남긴다.
- 다른 날짜의 행은 참고 근거로 보존하고 대상일 입력에서는 제외한다. 대상일 누락 시 최신 행으로 대체하지 않는다. 대상일 중복 값 충돌은 임의 선택하지 않는다.
- 목표 7개 필드가 있으면 `COLLECTED`(수급 자료 확보), 누락/불일치 등은 `INCOMPLETE`, 조회 오류는 `FAILED`다.
- 별도 `strategyUse`는 항상 `HELD / SUPPLY_FINALITY_UNVERIFIED`다. 확정 시각·세션 포함 범위를 생성하지 않는다. 기존 EOD 정책이나 전체 전략에 자동 연결하지 않으며 전체 전략 재검증 명령에도 넣지 못한다.
- `riskReady=false`, `ledgerInputReady=false`, 거래 허가 미평가 / 주문 기능 미연결 유지.

## 로컬 통합 검증

명령: `node --test --experimental-test-isolation=none tests/observation-investor.test.cjs`

23 PASS. 테스트 전용 인증정보/응답으로 승인 → 수급 어댑터 → 공통 HTTP 제한 → 근거 보존 → OBSERVATION_V2 저장 → 다시 읽기/동일 재검증을 확인했다. 예: 20260923의 6개 수치가 모두 문자열 "0"인 합성 응답은 원문을 보존하고 정수 0으로 검증되며, 하나를 제거한 응답은 해당 필드가 없는 상태로 유지된다. 두 경우 모두 전략 사용은 HELD다.

추가 확인: 대상일 HTTP 전달, 다른 날짜/충돌 배제, token/data 오류 후 종료, 상한·재시도 차단, URL/header의 서버 설정 변경 불가, 공개 404, 소비된 승인 재사용 거부, 비밀정보 미저장. 수급 실행의 KIS 일봉·Naver 시세/수급·뉴스·AI·계좌·주문·PAPER 호출 0회. 모든 프로그램의 실제 외부 데이터/인증 호출 0회(공식 공개 문서 열람만 수행).

관련 회귀 명령은 위 명령의 파일명을 각각 바꾸어 실행했다: observation-scope.test.cjs 16, observation-provider-integration.test.cjs 46, observation-http-budget.test.cjs 36, observation-approval.test.cjs 24, observation-eod.test.cjs 31 PASS. 전체 테스트·프런트 빌드는 반복하지 않았다.

변경 파일: 신규 services/observationInvestorContract.js, services/observationInvestor.js, tests/observation-investor.test.cjs 및 본 문서. 연결 수정 services/observationScope.js, services/observationApproval.js, services/observationHttpBudget.js, services/observationEvidence.js, services/observationMarketData.js, services/strategyObservation.js, scripts/revalidate-observation.cjs. tests/observation-eod.test.cjs는 순수 계약 상수 모듈을 의존 목록에 추가했다.

## 다음 실제 조회 전 남은 의미 확인

새 사용자 승인으로 005930 / 2026-09-23 / J / 수급 1회·토큰 최대 1회 실행할 코드 경로는 준비됐다. 실제 제공 결과/권한/해당 날짜 반환 여부는 아직 검증하지 않았다. 한 응답에 대상일이 없으면 자동 추가 조회하지 않는다.

확정 수급의 공표/수정 시점, 최종 확정 근거, 집계 세션·시간외 포함 범위와 수량 배율은 위 예제만으로 확정하지 않았다. 자료 조회 성공으로 이를 대신하지 않는다. 기존 일봉의 확정/시간외 범위도 계속 미확인이다. 실제 승인은 이번 작업에서 생성하지 않았으며 commit/push/Render/배포도 하지 않았다.
