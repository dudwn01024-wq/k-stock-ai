# 개인용 전략 관찰 — 주문 미연결

## 완료 범위

기존 `personal-local` 실행 경계 안에서 종목 선택 → 버튼 한 번 → 서버 공급자 한 번 조회 → 입력/출처/최신성 검증 → 기존 전략 전체 평가 → 화면 및 개별 JSON 기록 저장을 연결했다.
공개/설정 누락/오류 모드에서는 `/api/observation`을 CORS와 SPA fallback보다 먼저 404 처리한다. 요청/브라우저가 모드, 전략 입력, 최신성, 테스트 모드를 지정할 수 없다.
`PaperAccess`, PAPER 계산, 계좌/인증/Risk/Ledger/주문 엔진은 변경하지 않았다. `executionMode`의 기존 분기 안에 관찰 라우터만 추가했다.
이전 공개 화면 작업을 보존했다. 남은 상세 누락 표시만 정리했다(누락 count/dataPoints를 0으로 보정하지 않음, 패턴 데이터 부재와 검사 후 미탐지 구분).

## 전략과 입력

`services/tradingStrategy.js`의 `calculateTradingStrategy` 전체 결과를 기존 `isEntryAllowed` 순수 판정 함수로 확인한다. 이 함수의 명칭과 달리 관찰 결과는 거래 권한이 아니다.
실제 코드 파일 SHA256을 각 기록에 저장한다. 해당 엔진은 수정하지 않았다.

- 원본 수치: 현재가, 거래량, 외국인/기관 순매수. 실제 0은 유지한다.
- 계산 입력: MA5/20/60, RSI14, MACD/Signal/Histogram, 볼린저 위치, ATR14, 지지/저항, 캔들/차트/엘리엇 검사 결과, 20일 평균 거래량, 기존 뉴스 주의 여부.
- 기술조건: 기존 7개 조건에서 긍정 3개 이상/주의 0개. 필수 MA/RSI/MACD/볼린저 정보가 모두 필요하다. MA 정배열 및 현재가>MA20, RSI 40~65, MACD>Signal 및 Histogram>0, 볼린저 위치 20~65 등이 기존 긍정 조건이다. 패턴들도 기존 코드대로 모두 평가한다.
- 시장조건: 거래량/수급/뉴스 정보 완결, 주의 없음. 거래량 비율 0.7 이하, 양 주체 순매도, 뉴스 주의 신호는 기존 주의 조건이다. 1.5 이상 거래량은 기존 긍정 조건이다.
- 가격조건: 실제 지지선/저항선/ATR 계산, 손절=지지선−ATR×0.5, 손익비≥2, 기존 ±1.5% 진입 구간, 유효한 가격 순서 등 기존 최종 판정을 모두 적용한다.
- 관찰 검증: 원본 완결성, 동일 종목/기준일, 유효 수치, 각 입력군의 출처·기준 시각·최신성, 패턴 검사 출력 부재를 추가로 확인하여 불확실하면 보류한다. 전략 기준을 완화하지 않는다.

필요 정보가 유효하고 기존 전체 판정이 통과하면 **분석 조건 충족**, 유효하지만 통과하지 못하면 **조건 미충족**, 정보 부족/오래됨/최신성 미확인/조회 오류이면 **판단 보류**다.
항상 `거래 허가 미평가 / 주문 기능 미연결`, riskReady=false, ledgerInputReady=false.

## 실제 연결은 없음

기본 관찰 공급자는 미연결이므로 버튼 클릭 시 `LIVE_DATA_NOT_AUTHORIZED`와 함께 보류 기록을 만든다. import/startup만으로 조회/기록하지 않는다.
실제 최신성 기준이 없으므로 운영 VERIFIED 문자열만으로 통과시키지 않는다. 실제 데이터 연결 후에도 최신성 정책이 미확정이면 보류한다.
테스트 모드와 공급자는 서버 생성 인자로만 주입한다. `tests/helpers/observation-fixtures.cjs`의 테스트 수치·기준시각·고정 수신시각·최신성 증거는 운영 기본값/오류 대체값이 아니다.

## 로컬 실행

저장소 루트 PowerShell:

```powershell
Set-Location C:\Users\82107\Documents\GitHub\k-stock-ai
node tests/observation-preview.cjs
```

http://127.0.0.1:5190 → **개인용 전략 관찰 · 주문 없음** → 종목 선택 → **판단 확인**.
이미 실행 중이면 주소만 연다. 종료는 Ctrl+C. 실제 `server.js`를 실행할 필요가 없다.
테스트 서버는 외부 소켓/실제 공급자·DB 모듈을 차단하고, 브라우저 CSP도 동일 로컬 origin만 허용한다. 공개 첫 화면의 초기 요청에는 빈 테스트 응답만 제공한다.

| 테스트 선택 | 테스트 조건 | 결과 |
|---|---|---|
| 삼성전자 | 현재가 100, 지지 100, 저항 120, ATR 10; 유효 지표·뉴스 주의 없음 | 충족; 계산 손절 95, 손익비 4 |
| SK하이닉스 | 같은 입력에서 뉴스 주의=true | 미충족 |
| LG에너지솔루션 | 거래량 null | 보류 |
| NAVER | 최신성 UNKNOWN | 보류 |
| 현대차 | 오래됨 STALE | 보류 |
| 카카오 | 공급자 조회 오류 | 보류; 테스트 값으로 대체 안 함 |

이 표의 값은 모두 테스트 데이터다. 실제 종목 평가가 아니다.

## 기록

`.local/strategy-observations/test/<UUID>.json`에 테스트 기록, 기본 미연결 경로는 `unconnected/`에 저장한다. Git ignore에 포함했다.
UUID는 **관찰 기록 ID**로만 쓰며 fill/event ID가 아니다. 파일은 새 이름으로 `wx` 저장하고, 저장 완료 후 같은 객체를 화면에 반환한다. 저장 오류는 성공으로 표시하지 않고 자동 재시도하지 않는다.
원본 수치/계산 입력/전략 계산 결과를 구분하고, 출처·공급자 기준일/시각·별도 수신시각·이유·코드 hash를 보존한다.
필드 allowlist로 원본 인증 응답/키/토큰/계좌/공급자 오류 상세를 제외한다. 거래 원장/PAPER 저장소/DB는 사용하지 않는다.
관찰 기록은 로컬 검증용 파일이며 운영 원장 수준의 내구성·복구 보장을 주장하지 않는다.

## 검증

```powershell
node --require ./tests/helpers/local-only.cjs --test tests/observation.test.cjs
node --require ./tests/helpers/local-only.cjs --test tests/observation-ui.test.cjs
node --require ./tests/helpers/local-only.cjs --test tests/execution-mode.test.cjs tests/paper-access.test.cjs tests/paper-api.test.cjs tests/paper-panel.test.cjs tests/chart-price-field.test.cjs tests/strategy-authority.test.cjs
node --check services/strategyObservation.js
node --check services/observationApi.js
node --check tests/observation-preview.cjs
git diff --check
Set-Location frontend
node --require ../tests/helpers/local-only.cjs node_modules/vite/bin/vite.js build
```

신규 서비스/HTTP/저장 테스트 23개 + 관찰 UI 테스트 5개 + 영향받은 기존 테스트 71개 PASS.
브라우저에서 여섯 종목을 한 번씩 평가하여 화면의 상태·이유·기록 ID와 저장 JSON 일치를 확인했다. `artifacts/strategy-observation/browser-checks.json`과 캡처 참조.
공개 모드 실제 HTTP 404/SPA 우회 불가, 위조 입력 거부, 조회 한 번, 저장 실패 시 미확정, 중복 실행 차단, 관찰 중 계좌/PAPER/Ledger 함수 호출 0회를 검증했다.
프런트 빌드 PASS(기존 큰 번들 경고 유지). 실제 외부 API, 계좌, 토큰, DB, Render 연결은 없었다.

## 실제 시세 확인 전 필요한 별도 승인

현재 코드 연결은 하지 않았다. 다음 범위를 한 번에 승인받은 뒤 전용 read-only 공급자 연결을 준비한다.

- 종목 1개(사용자 지정), 버튼 한 번, 평가 종료/오류 시 종료, 반복·예약·WebSocket 없음.
- 기존 일봉 `fetchKisDailyOHLCV`와 KIS `inquire-daily-itemchartprice`: OHLCV 약 130개. KIS APP KEY/SECRET을 보호된 서버 환경에서 사용하며 유효 캐시 토큰이 없으면 OAuth `tokenP` 발급이 필요할 수 있다. 계좌번호는 불필요.
- 기존 `fetchStockQuoteData`: Naver basic/price/polling/integration을 통한 현재가·거래량·수급. 기존 `fetchStockNewsBySymbol`: Naver 종목 뉴스와 기존 뉴스 평가. 이 경로에는 KIS 인증을 사용하지 않는다. 외부 제공처의 이용 가능성과 최신성은 별도 미확인.
- 기존 KIS 함수에는 **최대 10페이지 × 페이지당 최대 4시도**가 있다. 따라서 그대로 실행하지 않는다. 승인받을 권장 실행 예산은 KIS 일봉 최대 2회, Naver 시세/수급 최대 4회, 뉴스 1회, 필요할 때 토큰 최대 1회이며 자동 재시도 0회다. 허용 목록·호출 예산·종료 가드를 연결 전에 적용해야 한다. 충분한 데이터가 없으면 보류하고 멈춘다.
- 기록: 승인된 종목의 사용 수치/계산값/출처/기준 시각/수신 시각/결과/이유만. 인증 응답/토큰/키/계좌는 제외.
- 허용된 시세·뉴스·토큰 endpoint만 통과시키는 전용 전송 경로를 사용하고, 계좌/주문/PAPER/Risk/Ledger 모듈과 메서드를 차단한다. 홈페이지의 자동 분석 조회까지 따라 실행되지 않도록 관찰 공급자 호출만 분리한다.

이번 검증은 테스트 응답으로 연결 흐름을 확인한 것이며 실제 시세 정확성이나 실시간성 검증이 아니다.
