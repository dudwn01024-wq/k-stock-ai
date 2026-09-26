# KRX 장마감 관찰 v1.0.0

후속 자료 범위: [장마감 보고서 자료·조회 계획](observation-eod-data-plan.md). 공식 자료 결합으로 2026-09-24~27 KOSPI 휴장 근거를 확보했다. 이는 전체 세션 캘린더·일봉 완성·수급 확정 승격이 아니다. 다음 조회는 대상일 포함 기존 130봉 목표이며 ‘이전 20봉’만으로 모든 지표를 충족한다고 보지 않는다. 아래 구현·검증 기록은 보존한다.

정책 ID: `KRX_EOD_OBSERVATION`. 사용자 승인 범위는 정책 적용·로컬 검증이다. 외부 조회 승인이 아니다.
기존 종합 전략·인증·요청 제한·공개/개인용 실행 경계는 변경하지 않았다.

## 적용 경로

기존 개인용 `POST /api/observation/evaluate` → `createObservationService` →
`createEodInputs` → `evaluateEod` → 같은 `ObservationResult` 화면 → `OBSERVATION_V2` JSON.
브라우저는 종목과 필수 `targetBusinessDate`만 전달할 수 있다. 정책·근거·인증 설정은 전달할 수 없다.
신규 관찰은 대상일 누락·잘못된 날짜를 외부 요청 전에 거부한다. 과거 기록의 오프라인 읽기 호환은 유지한다. 날짜 지정은 개장·완성 근거가 아니다.
서버 기본 provider는 여전히 미연결이며 화면 버튼이 실제 조회를 활성화하지 않는다.

- 분석 대상일·뉴스 구간·원본 시각·수신 시각·평가 기준 시점·오프라인 재검증 실행 시점을 구분한다. Asia/Seoul 표시와 원문 offset을 함께 보존한다.
- 이전 거래일 정규장 마감 **초과**, 대상 거래일 정규장 마감 **이하**인 기사만 후보로 선택한다. 휴장 중 발행 기사도 이 구간에 있으면 포함한다. 구간 밖은 참고만 표시한다.
- 캘린더의 적용 기간 내 모든 날짜가 명시돼야 하며, 대상일과 직전 OPEN 세션의 마감 근거가 필요하다. 주말 제외 추산이나 날짜 특례는 없다.
- KRX·완성·종가/거래량·수정 구분 근거가 있어야 일봉을 사용한다. 오래된 일봉은 STALE, 미완성/범위 미확인은 UNKNOWN이다.
- 수급은 대상일·KRX·주 단위·확정 근거가 모두 필요하다. 실제 0은 보존한다. 잠정·누락은 참고와 보류로 남긴다.
- 뉴스 시각 의미·시간대·구간 수집 범위·기사별 기존 주의 키워드 평가가 필요하다. 단순 조회 성공이나 빈 기사 목록을 ‘악재 없음’으로 취급하지 않는다.
- `evaluateMarketContext`의 기존 거래량 1.5/0.7, 수급 부호, 뉴스 주의 조건을 그대로 사용한다. 원본 입력과 계산 결과를 분리한다.
- 종가를 `currentPrice`에 넣지 않는다. 전체 `calculateTradingStrategy`는 현재가 없이 호출되므로 진입·목표·손절·위험보상 값을 생성하지 않는다.

## 기존 전략과의 적용 제한 — 한곳에 정리

1. `evaluateExecutionPosition`: 현재가 대비 진입 구간·추격 여부를 요구한다.
2. `evaluateTechnicalConditions` 및 전체 `ENTRY_GATE`: 현재가 입력을 요구한다.

승인된 장마감 정책은 이 조건들의 의미 변경 승인이 아니다. 호환 가능한 거래량·수급·뉴스가 모두 양호해도 전체는 **판단 보류**다. 현재가 조건을 삭제·통과시키지 않았다. 차후 별도의 장마감 전략 계약이 필요하며 이번에 다시 정책 승인을 요구하지 않는다.
`riskReady=false`, `ledgerInputReady=false`, ‘거래 허가 미평가 / 주문 기능 미연결’은 항상 유지한다.

## 증거와 승인 구분

현재 프로젝트에는 공식 출처와 적용 기간이 검증된 날짜별 KRX 세션 레지스트리, 일봉 완성 계약, Naver 수급 확정/시장/단위 계약이 없다.
따라서 실제 자료는 자동 USABLE로 승격하지 않는다. `EOD_INPUTS_V1`의 실자료 경로는 저장된 허용 필드만 읽고 미확인 근거를 남긴다.
KIS 요청 `J=KRX`, 수정주가 파라미터 해석은 기존 `observationEvidence`의 공식 문서 연결을 유지한다. 이를 Naver의 시장 근거로 전파하지 않는다.
현재 `calendar/completion/finality/coverage`가 충족되는 사례는 **서버 testOnly + MOCK_FIXTURE**의 합성 테스트에만 존재한다. `TEST_FIXTURE_ONLY`를 실제 기록에 쓸 수 없다. 실자료의 근거 검증/매핑이 확보되기 전 이를 사용하는 통과 경로는 없다.
테스트 자료의 출처·가상 세션은 실제 시장 증거가 아니다.

## 기록과 재검증

새 기록에는 `policy`, `eodInputs`, `eodReview`를 추가한다. JSON을 다시 읽어 `evaluateEod(record)`를 호출하면 같은 정책·기준 시점·결과·이유가 나온다. 지원하지 않는 정책 버전은 거부한다.
원본 V1/V2에는 덮어쓰지 않는다. 오프라인 스크립트는 원본 ID/SHA256, 별도 UUID, `revalidatedAt`과 새 보고서를 `revalidation/`에 배타 생성한다.
과거 계산값은 증거 보존 목적으로 그대로 남기되 장마감 판정 입력으로 재사용하지 않는다. 원본 현재가를 종가로 바꾸거나 기사별 시각을 복원하지 않는다.
`.local/strategy-observations/live-once/`, `test/`, `revalidation/`은 Git 제외 경로다.

## 실제 기록 결과

원본 `3b7d655e-bcb7-44d7-b1d3-57776fa6b333`, 평가 기준 `2026-09-24T12:17:40.364Z` (21:17:40.364 KST), 저장 일봉 대상일 `2026-09-23`.
추가 조회 없이 **HELD**: 원본 종가·수정구분·시장/완성 근거, 공식 세션 캘린더, KRX 확정 수급, 기사별 발행 시각·구간 수집 근거가 부족하다. 9월 23일 자료라는 이유만으로 STALE로 처리하지 않았다. 과거 현재가 숫자를 분석 종가로 사용하지 않았다.

## 외부 요청 없는 실행

프로젝트 루트 `C:\Users\82107\Documents\GitHub\k-stock-ai`에서:

```powershell
node tests/observation-eod.test.cjs
node tests/observation-eod-preview.cjs
```

브라우저 `http://127.0.0.1:5192` → 개인용 전략 관찰 → 판단 확인.
미리 빌드한 프런트를 사용하며, 테스트 서버와 브라우저 CSP가 외부 통신을 차단한다. 테스트 데이터 외 공급자는 로드하지 않는다. 종료는 Ctrl+C.
새로 빌드하려면 `frontend`에서 `node --require ../tests/helpers/local-only.cjs node_modules/vite/bin/vite.js build`.

실제 저장 기록의 **오프라인** 재검증 (항상 새로운 결과 파일 생성):

```powershell
node --require ./tests/helpers/local-only.cjs scripts/revalidate-observation.cjs 3b7d655e-bcb7-44d7-b1d3-57776fa6b333
```

## 다음 실제 조회 전에 필요한 것

먼저 공식 KRX 세션/휴장 적용 기간·일봉 완성 근거, 수급의 KRX/단위/확정 의미, 뉴스 발행 시각 의미·구간 완전성을 확인해야 한다. 단순 새 조회로 이 공식 계약이나 현재가 전용 전략 충돌을 해소할 수 없다.
새 조회가 별도 승인된다면 같은 005930의 대상 거래일 KRX 일봉·앞선 20개 일봉, 같은 날 KRX 수급, 승인 뉴스 구간에 필요한 기사별 발행 시각과 기존 키워드 평가 근거만 필요하다. 관찰에 Naver 현재가는 사용하지 않는다.
기존 요청 상한(일봉 2 / Naver 시세·수급 4 / 뉴스 1 / 필요 시 토큰 1)을 늘리지 않는다. 이 범위로 뉴스 전체 구간을 확보하지 못하면 보류한다. 계좌·주문 요청은 필요하지 않다. 이번 작업에서 해당 조회는 실행하지 않았다.

## 이번 변경·검증 기록

- 구현: `services/observationEod.js` 신규, `services/strategyObservation.js`, `services/observationApi.js`, `frontend/src/ObservationPanel.jsx`, `scripts/revalidate-observation.cjs` 수정.
- 테스트/미리보기: `tests/observation-eod.test.cjs`, `tests/helpers/observation-eod-fixtures.cjs`, `tests/observation-eod-preview.cjs` 신규. 기존 `observation.test.cjs`, `observation-provider-integration.test.cjs`, `observation-freshness.test.cjs`, `observation-ui.test.cjs`를 새 정책 기대값에 맞게 수정.
- 문서: 이 문서와 `docs/observation-evidence.md`의 후속 승인 상태 안내.
- `node tests/observation-eod.test.cjs`: 31 PASS. HTTP/저장/재읽기 일치, 완성·미완성, 잠정·확정/0·누락, 뉴스 경계·휴장, 캘린더 누락, 현재가 대입 금지, 비밀값 제외, 계좌/PAPER/거래 원장 호출 0 확인.
- `node tests/observation-provider-integration.test.cjs`: 46 PASS. 기존 KIS/Naver 함수→요청 제한→테스트 HTTP→EOD/V2 저장/재검증.
- `node tests/observation.test.cjs`: 25 PASS. 실제 로컬 라우팅의 공개 404, 브라우저 설정 주입 거부, 단일 호출/저장 회귀.
- `node tests/observation-freshness.test.cjs`: 23 PASS. 기존 기록 호환, 원본 불변, 오프라인 HTML.
- `node tests/observation-ui.test.cjs`: 5 PASS. 서버 허용 확인, 수동 평가, 선택 대상일, 오류 표시.
- 프런트 빌드 성공. 기존 500KB 초과 번들 경고는 유지. syntax 및 `git diff --check` 통과.
- 실제 브라우저에서 완성·잠정 수급·미완성·시장 불일치와 실제 저장 기록 재검증 화면 확인. 1280px 화면의 가로 넘침 없음. 모바일은 이번에 별도 검증하지 않았다.
- 테스트 화면: `artifacts/observation-eod/test-complete.png` (테스트 데이터 표시).
- 실제 기록 새 결과: `.local/strategy-observations/revalidation/4ddfd81f-8556-4a9e-9086-ef76b510914f.json` 및 `.html`. 원본 SHA256 불변, 저장 결과 재평가 일치 확인.
- 외부 데이터/토큰 요청 0. `.env` 접근 없음. commit/push/배포 없음. 기존 브랜치·미커밋 변경 보존.


## 대상일 전달 후속 검증 (2026-09-25, 외부 조회 0)

- 신규 관찰의 대상일은 필수다. API → service.observe → createMarketDataProvider → fetchKisDailyOHLCV → FID_INPUT_DATE_2까지 전달한다. 일반 검색 reader의 날짜 기본값은 유지한다.
- 관찰 전용 2회 상한과 재시도 0을 적용한다. 기존 공통 HTTP 제한/허용목록은 변경하지 않는다. 두 번째 종료일은 첫 응답의 가장 오래된 유효 일봉보다 하루 전이다.
- 같은 날짜·수치의 중복만 제거한다. 충돌은 계산 보류, 미래 행·유효하지 않은 행은 제외 사유를 기록한다. 목표 130개 부족도 기록하며 지표 계산식/최소 입력 기준은 변경하지 않는다.
- OBSERVATION_V2.dailySelection에 선택일, 실제 요청 기간, 페이지별 반환 범위/개수, 제외·충돌·중복, 계산용 OHLCV 행을 보존한다. 원본 응답은 기존 evidence에 별도 보존한다. 재검증은 저장된 행으로 계산 입력 일치를 확인하며 서버 날짜를 쓰지 않는다.
- 합성 정상 사례: 요청 20240923~20260923 / 20240923~20260615, 반환 140행, 계산 20260517~20260923의 130행, 오래된 10행은 목표 수량 밖으로 구분. 이 날짜들은 가상 입력이며 개장일 증거가 아니다.
- 변경 코드: services/observationDaily.js(신규), kisMarketData.js, observationMarketData.js, strategyObservation.js, observationApi.js, observationEod.js; scripts/revalidate-observation.cjs; frontend/src/ObservationPanel.jsx. 기존 미커밋 인증/경계/화면 작업은 보존했다.
- 관련 테스트: observation-target-date(15), observation-provider-integration(46), observation-eod(31), observation(25), observation-ui(5), observation-http-budget(36), required-data의 KIS reader 관련 사례(11) PASS. 전체 테스트를 실행한 결과가 아니다.
- 재현: 저장소 루트에서 node --test --experimental-test-isolation=none tests/observation-target-date.test.cjs. 외부 통신 차단/합성 인증·응답만 사용한다. 프로그램 실제 조회 명령이 아니다.
- 프런트 빌드 PASS(기존 큰 번들 경고). 오프라인 브라우저에서 날짜 미선택 버튼 차단, 2026-09-23 선택·전달·보류 표시 확인. 정책의 세션·완성·수급 확정·뉴스 시각 의미 미확인은 유지한다.
