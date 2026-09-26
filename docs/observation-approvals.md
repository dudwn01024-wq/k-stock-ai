# 일봉 전용 1회 승인 경계

이번 변경은 로컬 테스트 전용 승인을 사용했다. 실제 승인 생성·API 조회·토큰 발급은 하지 않았다.

## 기존 표식 보존과 새 승인

- 기존 `live-once/005930-approved-run.json`은 읽기 비교로 보존을 확인했으며 삭제·초기화·덮어쓰지 않는다. 기존 full-observation 경로는 이 표식을 그대로 사용한다.
- 새 kis-daily-only 실행은 서버 내부 `createObservationApprovalStore`에 명시적으로 등록한 UUID `approvalId`가 있어야 한다. 실행 함수는 승인을 자동 생성하지 않는다.
- 실제 사용자 승인을 새로 받은 뒤에만 로컬 호출자가 `issue({approvalId, execution, userApproved:true})`를 호출할 수 있다. `userApproved`는 사람의 승인 사실을 전달하는 서버 내부 인자이며, 코드가 승인 사실을 만들어내는 수단이 아니다. 발급 API/웹 경로는 없다.
- 서버 설정 `personal-local`에서만 발급·실행 가능하다. production/public은 거부한다. 브라우저 body의 승인 ID/범위는 400, URL/query/header 값은 사용하지 않는다. 공개 관찰 API는 기존대로 404다.

`execution`은 아래 **8개 필드 전부**가 일치해야 한다. 다른 키나 값은 거부한다.

| 필드 | 현재 지원 범위 |
|---|---|
| scope | kis-daily-only |
| symbol | 005930 |
| targetDate | 승인한 유효한 YYYY-MM-DD (예: 2026-09-23); 자동 날짜 대체 없음 |
| market | J |
| timeframe | D |
| adjustedPrice | 문자열 0 |
| kisDailyMaxRequests | 2 |
| kisTokenMaxRequests | 1 |

목표 130봉과 기존 날짜 분할/검증은 그대로다. 다른 범위로 확대하는 승인 기능이 아니다.

## 실행과 저장

1. 기존 로컬 설정을 로딩한 서버 내부 코드에서 발급한 ID를 `createOneShotObservation({scope:'kis-daily-only', credentialSource:'KIS_LIVE', approvalId, environment})`에 명시한다.
2. 기존 `observe('005930', {targetBusinessDate: 승인한 날짜})` 호출이 READY와 모든 실행 조건을 검증한다. 승인 누락/범위 불일치 시 HTTP 0회다. 불일치는 READY를 소비하지 않으며, 동일한 잘못된 조건을 재시도해도 통과하지 못한다.
3. 소비 파일을 배타적으로 생성하고 디스크 동기화를 끝낸 뒤만 HTTP 제한 장치를 생성한다. 동시 실행 중 하나만 성공한다. 그 뒤 실패·타임아웃·프로세스 종료가 발생해도 CONSUMED는 유지된다.
4. 한 실행용 객체만 사용할 수 있는 내부 승인 핸들을 공통 제한 장치에 연결한다. 실제 전송 직전에도 종목/J/D/0와 대상일 상한(첫 요청 종료일은 정확히 대상일)을 검사한다. Naver·뉴스·계좌·주문 경로는 승인 핸들이 있어도 거부한다.
5. 결과 OBSERVATION_V2 DAILY_COLLECTION에 approvalId를 남기고 승인 기록의 resultId로 연결한다. 기존 전체 관찰의 기록 의미는 바꾸지 않는다.

실제 승인 폴더는 Git 제외 경로 `.local/strategy-observations/approvals/<approvalId>/`로 고정한다.

- `ready.json`: 생성 시각, 실행 조건과 상한, READY. 신규 생성만 가능.
- `consumed.json`: 같은 식별정보, CONSUMED, 소비 시각. 신규 생성만 가능.
- `result.json`: approvalId와 결과 기록 ID(결과 저장 전 실패 시 null). 신규 생성만 가능.
- `requests.json`: 이 실행의 기존 요청 제한 카운터 기록. 새 승인마다 별도 경로이며 이전 실행 기록을 건드리지 않는다.

`inspect(approvalId)`는 위 파일을 합쳐 READY/CONSUMED/INVALID를 반환한다. 손상·불완전 파일이나 없는 승인은 INVALID로 차단하며 자동 복구·초기화하지 않는다. 실행 결과 기록에 실패하더라도 소비 상태를 취소하지 않는다. 키·시크릿·토큰·헤더·인증 응답은 승인 기록에 저장하지 않는다.

테스트 승인은 별도 임시 폴더와 가짜 전송으로만 사용한다. 테스트 승인 핸들을 실제 HTTP 전송에 연결하면 거부한다. 원본 실제 조회 기록과 과거 승인 표식은 변경하지 않았다.

## 검증 (외부 통신 차단)

각 파일을 별도 Node 실행으로 확인했다:

`node --test --experimental-test-isolation=none tests/<파일명>`

- observation-approval.test.cjs: 24 PASS. 정상 READY→소비→기존 KIS reader→공통 제한→가짜 HTTP→V2 저장, 조건 불일치, 오류 후 재사용, 별도 Node 종료 후 재사용, 동시 소비, 손상 표식, 새 ID 분리, 비밀정보 비저장.
- observation-scope.test.cjs: 16 PASS. 실제 로컬 API 라우팅의 body/query/header 차단, 서버 승인 ID 유지, 공개 차단, 일봉 2회/토큰 1회, full-observation 동작 유지.
- observation-provider-integration.test.cjs: 46 PASS. 기존 인증 선택·조회·근거 저장 경로 회귀.
- observation-http-budget.test.cjs: 36 PASS. 공통 상한·재시도/리다이렉트·오류 후 차단 회귀.

재실행/오류 검증은 테스트 승인만 소비했다. 실제 외부 요청과 토큰 발급 0회. 일봉 전용 테스트의 Naver 시세·수급·뉴스 및 계좌·주문·PAPER 호출 0회다. full-observation 회귀의 Naver 응답은 테스트 응답만 사용했다.

riskReady=false, ledgerInputReady=false, 거래 허가 미평가 / 주문 기능 미연결 유지. 새로운 실제 사용자 승인 전까지 실제 실행하지 않는다.
