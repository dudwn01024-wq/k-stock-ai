# 관찰 실행 범위 (2026-09-25, 실제 조회 없음)

- 서버 생성 옵션 `scope`의 허용값은 `full-observation`(기본값), `kis-daily-only` 두 개다. 알 수 없는 값은 생성 단계에서 거부한다.
- `kis-daily-only`는 서버 내부 `executionMode: 'personal-local'`에서만 생성한다. 일회 실행 래퍼는 기존 `resolveExecutionMode`로 서버 환경을 확인한다. 브라우저 body의 scope는 기존 API 허용 필드에 없어 400, query/header의 scope는 사용하지 않으며 공개 경로는 기존처럼 404다.
- `createOneShotObservation`의 내부 옵션은 `scope: 'kis-daily-only'`, `credentialSource: 'KIS_LIVE'`를 사용한다. 날짜는 기존 `observe(symbol, {targetBusinessDate})` 인자로 전달한다. 아직 실제 실행 승인/실행을 뜻하지 않는다.
- 서버 내부 `dailyOptions`는 `{market:'J', timeframe:'D', adjustedPrice:'0', maxBars:130}`만 지원한다. 다른 값은 거부하며 기존 reader의 고정 J/D/0와 130봉·2회 분할 로직을 재사용한다. KIS_LIVE 자격정보 묶음과 일반 환경변수는 변경하지 않는다.
- 관찰 provider는 기존 reader → 일봉 선택 결과에서 즉시 반환한다. Naver 객체 생성/시세/수급/뉴스, 차트 지표 계산, 종합 전략 평가를 실행하지 않는다. 전송 직전에는 범위 검사를 거친 뒤 **변경하지 않은 공통 HTTP 제한**(일봉 2회, 토큰 최대 1회)을 통과한다. 다른 경로와 오류 이후 전송은 차단한다.
- `OBSERVATION_V2`에 `recordType: DAILY_COLLECTION`, scope/source, `strategyEvaluated:false`를 명시한다. 기존 일봉 선택 결과·허용된 원본 응답 근거·대상일 OHLCV·요청 횟수만 저장하고 전략/정책 평가 필드는 만들지 않는다. `COLLECTED`는 수집 결과이며 일봉 확정/정확성 또는 전략 통과가 아니다. 부족한 봉은 `INCOMPLETE`, 충돌/대상일 누락은 `INVALID`, 조회 실패는 `FAILED`로 구분한다. Naver·뉴스 부재는 수집 실패 사유가 아니다.
- 기존 test / live-once / unconnected 폴더 선택과 UUID 신규 파일 저장(`wx`)을 재사용한다. 기존 전체 관찰의 기록 형식·화면·전략은 그대로다. 전체 전략 재검증 스크립트는 일봉 수집 기록을 전략으로 재해석하지 않고 명시적으로 거부한다.
- riskReady=false, ledgerInputReady=false, 거래 허가 미평가 / 주문 기능 미연결을 유지한다.

## 로컬 검증

`node --test --experimental-test-isolation=none tests/observation-scope.test.cjs`: 16 PASS.
실제 KIS reader를 테스트 인증정보/HTTP 응답으로 실행했으며 API → 서비스 → 일봉 reader → 공통 제한 → 전송 경계 → 저장/다시 읽기를 연결했다. 가상 일봉은 시장 캘린더 근거가 아니다.

- 첫 종료일 20260923, 두 번째 종료일 20260615, J/D/0, 130행 보존.
- Naver 시세·수급·뉴스, 계좌·주문·PAPER, 종합 전략 계산 호출 0회.
- 기본 및 명시적 full-observation은 기존 조회·계산·기록 동작 유지.
- 공개/production 모드, 잘못된 scope·시장·가격 기준·목표 수량, 금지 전송 거부.
- 오류 시 추가 요청 없음, 비밀정보 미저장, 수집 부족은 뉴스 부재 실패와 구분.
- 관련 회귀: provider-integration 46, eod 31, observation 25, target-date 15, http-budget 36 PASS. 문법/공백/diff 검사 PASS. 화면 변경이 없어 빌드·캡처를 반복하지 않았다.

## 다음 실제 실행의 제한

후속 작업에서 기존 고정 승인 실행 표식 `.local/strategy-observations/live-once/005930-approved-run.json`을 보존하고, 일봉 전용 실행에 [approvalId별 1회 승인](observation-approvals.md)을 연결했다. 새 실행은 별도의 명시적 사용자 승인과 해당 조건의 READY 기록이 필요하다. 기존 표식을 삭제하거나 초기화해서 재실행하지 않는다. 이번에는 테스트 승인으로만 검증했으며 실제 조회 승인을 생성하거나 실행하지 않았다.

이번 변경 파일: services/observationScope.js(신규), services/observationMarketData.js, services/strategyObservation.js, scripts/revalidate-observation.cjs, tests/observation-scope.test.cjs(신규), tests/observation-eod.test.cjs(관찰 전용 의존 모듈 검사 목록만 갱신), 본 문서. 인증 핵심·공통 요청 제한·일봉 reader/병합·전략·실행 경계·화면 파일은 이번에 수정하지 않았다.
