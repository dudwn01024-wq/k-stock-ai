# 삼성전자 일회성 관찰 — 기존 조회 경로 연결 및 오프라인 검증

이전 실제 조회 요청은 자격정보 미설정으로 사전검사에서 중단했다. 이번 작업은 실제 조회 승인을 사용하지 않고 기존 조회 경로 연결과 오프라인 검증만 수행했다. 실제 API 요청·토큰 발급은 0회다. 현재 설정 선택 단계에서는 별도로 승인된 프로젝트 루트 `.env`만 dotenv로 불러와 설정 여부를 확인했다. 원문·키 값은 출력하지 않았고 다른 인증 파일은 읽지 않았다.

## 추가한 제한 모듈

`services/observationHttpBudget.js`는 기존 조회 코드에서 확인한 005930용 KIS 일봉·토큰, Naver 기본시세·시세 이력·수급·뉴스 경로만 허용하는 독립 HTTP 전송 모듈이다. 계좌·주문·PAPER·AI 모듈을 import하지 않는다.

- 허용 호스트·경로·HTTP 메서드·종목·query를 검사한다.
- 실제 전송 함수를 호출하기 직전에 서비스별 횟수를 증가시킨다. 상한은 KIS 일봉 2, Naver 시세/수급 합계 4, 뉴스 1, 필요한 인증 1이다.
- 동시 요청, 동일 URL 재시도, 자동 리다이렉트를 허용하지 않는다. 오류 후 다음 전송은 차단한다.
- 개별 요청은 최대 10초, 전송 허용 시간은 최대 60초다. 만료 후 새 요청을 차단하고 진행 중 요청은 남은 시간 이내에 abort한다.
- 독점 생성한 고정 실행 표식을 남겨 새 인스턴스의 한도 초기화를 거부한다. 표식을 삭제해 재실행하면 안 된다.
- 보고/표식에는 인증 값이나 응답 본문을 기록하지 않는다.

## 실제 함수 연결

`services/observationMarketData.js#createOneShotObservation().observe('005930')` → 기존 `strategyObservation.observe()` → `createMarketDataProvider()` → 아래 기존 함수 → 같은 `budget.fetch` → HTTP 전송 경계 순서다. 모든 데이터 조회는 순차 실행한다.

- KIS `fetchKisDailyOHLCV`: 기존 페이지 조회·정규화·토큰 로직을 사용한다. `forkWithTransport`로 관찰 전용 전송 함수 및 캐시/대기열을 분리한다. 기존 reader의 유효한 메모리 토큰은 재사용하되, 다른 요청의 진행 중 promise는 공유하지 않는다. 관찰 중 새 토큰을 얻었다면 관찰 reader에만 보관한다.
- Naver `fetchStockQuoteData`, `fetchStockNewsBySymbol`: `server.js`에서 `services/naverMarketData.js`로 이동했다. 서버도 이동된 동일 함수를 사용한다. 관찰에서만 `failFast:true`를 주입해 실패를 삼키고 다음 조회로 넘어가지 않도록 한다.
- 기존 뉴스 키워드 평가와 차트·전략 계산은 그대로 사용한다. KIS 실패 응답은 retry 루프에 도달하기 전 제한 모듈에서 예외로 중단된다. 자동 토큰 재발급·추가 페이지도 같은 한도를 통과한다.
- 전체 작업의 deadline이 지나면 활성 HTTP 요청을 abort하고 이후 요청을 차단한다. 성공/실패/보류와 관계없이 `finally`에서 실행 표식을 종료한다. 같은 관찰 객체는 두 번째 평가를 거부한다.

**웹서버 시작이나 화면 클릭으로 실제 조회를 활성화하지 않았다.** 기존 공개/개인용 라우터와 기본 미연결 관찰 화면은 유지된다. 위 명시적 1회 실행 진입점은 기본 `approved=false`이며, 미래에 새 실제 조회 승인을 받은 호출자만 활성화할 수 있다. 이번에 실제 진입점을 실행하지 않았고 이전 승인을 자동 사용하지 않았다. 글로벌 fetch·다른 서비스의 인증/재시도 정책도 바꾸지 않았다.

## 로컬 검증

- `node tests/observation-provider-integration.test.cjs`: 현재 40 PASS (기존 경로 20 + LIVE 설정 선택 20). 관찰 → 실제 KIS/Naver 함수 → 공통 제한 → 테스트 HTTP 응답 → 관찰 기록까지 실행했다. 테스트용 KIS 자격정보만 주입했다.
- 현재 설정 선택 단계에서 제한 테스트 36 + 관찰 HTTP 테스트 25 = 61 PASS. 앞선 경로 연결 단계의 관련 회귀 132 PASS와 데이터 시각 회귀 PASS 결과는 유지하며 관련 없는 전체 검사는 반복하지 않았다. 모두 `tests/helpers/local-only.cjs`로 외부 통신을 차단했다. 실제 서비스/AI 호출은 없다.
- 정상 경로에서 KIS 2 / Naver 시세·수급 4 / 뉴스 1 / 인증 1의 동일 누적 카운터를 확인했다. 불필요한 Naver fallback은 생략한다. 세 번째 일봉, 금지 경로, 내부 재시도, 토큰 갱신, HTTP 오류·리다이렉트, 전체 시간 초과 후 추가 전송이 차단된다.
- 테스트 관찰에는 반드시 `테스트 데이터`를 표시한다. 실제 데이터의 최신성 정책을 만들거나 VERIFIED로 승격하지 않는다. 전체 경로를 통과해도 최신성 근거가 없으면 HELD이고 `riskReady=false`, `ledgerInputReady=false`다.
- 서버용 기본 reader의 동작과 기존 전략 계산을 회귀 확인했다. 계좌·주문·PAPER·Ledger·AI 모듈은 관찰 의존 그래프에 없다.

테스트 기록은 임시 테스트 디렉터리에 생성 후 정리한다. 이전 `.local/strategy-observations/live-once/005930-preflight-stopped.json`은 그대로 보존하며 이번에 실제 시장 데이터 기록을 생성하지 않았다.

## 앞선 경로 연결 단계 변경 파일

- `server.js`: 기존 Naver 조회/뉴스 평가 함수의 모듈 참조로 교체. 기존 실행 경계 설정은 보존.
- `services/naverMarketData.js`: 위 함수 이동, 관찰 전용 전송 주입과 fail-fast 옵션.
- `services/kisMarketData.js`: 기존 구현을 reader 단위로 격리하고 전송·대기 함수 주입. 기본 reader의 인증/정규화/계산은 유지.
- `services/observationMarketData.js`: 기존 관찰 서비스와 KIS/Naver 함수를 하나의 한도로 연결하는 명시적 1회 진입점.
- `services/observationHttpBudget.js`: 전체 작업 deadline 및 기존 KIS 대기열의 대기 시간도 제한.
- `services/strategyObservation.js`: 조회별 수신 시각·단위 보존, 실제 조회 기록과 미연결/테스트 기록 구분. 전략 조건은 불변.
- `scripts/observation-config-check.cjs`: 기존 변수의 설정 여부만 출력.
- `tests/observation-provider-integration.test.cjs`: 실제 조회 함수들을 실행하는 오프라인 통합 테스트.
- `tests/data-freshness.test.cjs`, `tests/required-data.test.cjs`: 이동된 함수 및 기존 실행 경계에 맞춘 테스트 의존 주입.
- `docs/observation-http-budget.md`: 연결 구조, 검증 범위, 사전확인 명령.

현재 `codex/paper-execution-boundary` 브랜치와 앞선 미커밋 변경을 보존했다. 프런트 수정, B 브랜치 변경, commit/push, Render/배포 작업은 하지 않았다.

## 개인용 관찰의 명시적 LIVE 설정 선택

현재 단계 변경 파일은 `services/observationCredentials.js`, `services/observationMarketData.js`, `scripts/observation-config-check.cjs`, `tests/observation-provider-integration.test.cjs`, `tests/observation.test.cjs`, 이 문서다. 인증 핵심 모듈, 서버 실행 경계, 계좌/주문/전략 코드는 이번 단계에서 바꾸지 않았다.

- 서버 내부 호출자가 `createOneShotObservation({credentialSource:'KIS_LIVE', environment:...})`를 명시적으로 선택한 경우만 LIVE 이름 체계를 사용한다. 기본값 `GENERIC`은 일반 설정을 유지하며 LIVE 자동 대체가 없다.
- 주입된 서버 실행 환경을 기존 `resolveExecutionMode`로 확인한다. `KSTOCK_EXECUTION_MODE=personal-local`이고 `NODE_ENV`가 production이 아닌 경우만 LIVE 선택을 허용한다. 공개/잘못된 모드는 요청 전에 차단한다.
- LIVE 묶음은 `KIS_LIVE_APP_KEY`, `KIS_LIVE_APP_SECRET`, `KIS_LIVE_BASE_URL`이다. 두 값은 비어 있거나 공백을 포함하면 거부한다. 주소는 기존 LIVE probe 코드와 같은 `https://openapi.koreainvestment.com:9443`와 정확히 일치해야 한다. 일반/VTS 주소를 대신 사용하지 않는다.
- 선택한 세 항목은 새 관찰 전용 KIS reader의 함수 인자로만 전달한다. `process.env.KIS_APP_KEY`·`KIS_APP_SECRET`을 덮어쓰거나 파일에 복사하지 않는다. 이 reader는 일반 reader의 토큰·진행 중 인증·캐시를 상속하지 않는다. 토큰 발급 알고리즘은 기존 구현을 그대로 사용한다.
- 관찰 전용 reader의 토큰/일봉 요청도 기존 공통 budget을 거친다. 키/시크릿 하나 누락, 서버 주소 불일치, 공개 모드이면 HTTP 0회로 중단한다.
- 선택값을 읽는 웹 API·URL·헤더는 추가하지 않았다. 공개 관찰 API는 계속 404다. 개인용 API의 URL/헤더는 설정 선택으로 사용하지 않고, body의 추가 설정 필드는 400으로 거부한다.
- 키가 설정되어 있다는 것은 실제 발급 환경이나 인증 성공을 증명하지 않는다. 토큰 발급·실제 조회·거래 승인은 별개이며 이번에 실행하지 않았다.

## 외부 요청 없는 재확인

기존 로딩 근거는 `server.js`의 `dotenv.config()`와 설치된 dotenv의 작업 폴더 `.env` 기본 경로다. 확인 스크립트는 `--project-env`를 명시했을 때만 저장소 루트의 기존 `.env`를 같은 방식으로 읽는다. 오류 코드를 확인하며 vault/다른 설정 파일은 읽지 않는다. 기존 환경변수를 강제로 덮어쓰지 않는다.

`--personal-local-live`는 사전확인 프로세스 안에서만 개인용 모드를 명시적으로 선택한다. 전역 환경변수나 파일을 수정하지 않는다. 상속된 `NODE_ENV=production`은 우회하지 않는다. 서버 시작이나 실제 조회 승인으로 사용되지 않는다.

```powershell
Set-Location 'C:\Users\82107\Documents\GitHub\k-stock-ai'
node scripts/observation-config-check.cjs --project-env --personal-local-live
```

현재 로컬 사전확인 결과: 선택 출처 KIS_LIVE, 두 LIVE 필수 변수 true, serverMatchesLive=true, configurationReady=true, errorCode=null, externalRequests=0. 일반 변수의 빈 값은 이 명시적 LIVE 선택의 검사를 막지 않는다. 값·일부 문자열·길이·해시·토큰은 출력하거나 기록하지 않았다.

옵션 없는 `node scripts/observation-config-check.cjs`는 기존 일반 변수의 설정 여부만 확인한다. 일반 변수가 false라고 해서 LIVE 전용 키가 없다는 뜻은 아니다.

## 검증 범위

설정 함수만 시험한 것이 아니다. 테스트 전용 LIVE 키/시크릿/서버 묶음이 기존 토큰/일봉 함수와 HTTP 전송 경계에 도달하는 것을 확인했다. 일반 토큰을 먼저 캐시한 상태에서도 LIVE 관찰은 이를 재사용하지 않았고, 일반/VTS 주소가 설정되어 있어도 선택한 LIVE 주소만 사용했다. 모든 외부 응답은 테스트 데이터이고 네트워크는 차단했다.

실제 로컬 설정은 사전확인에만 사용했다. 실제 API 인증/조회 성공 여부와 실데이터 최신성은 이번 검증 범위 밖이다. 실제 조회는 새 승인을 받은 뒤에만 명시적으로 실행할 수 있다. commit/push/Render/배포는 하지 않았다.
