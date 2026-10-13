# KIS 장중 추정 수급 — 기본 OFF 수동 참고 패널

최종 검증: 전체97개 파일/2,443개 테스트, 집중12개 파일/155개 테스트 통과. 빌드 성공(2,317개 모듈, 기존 청크 크기 경고). PC1440/390px의 OFF·자동호출0·더블클릭1건·한도/실패 시 이전 결과 제거·0/누락 구분·로그아웃 보호·가로 넘침 없음 확인. 실제 금융 요청/자격증명 사용/토큰 발급/외부 브라우저 요청0회.

기준 main/LIVE `02a01cdb42bf4a73ed3aa4f3513a008c7d45dd6a`, 브랜치 `feat/kis-intraday-estimate`, 격리 폴더 `k-stock-ai-kis-estimate`. 이번 단계는 로컬 구현·오프라인 검증만 한다. 실제 자격증명 설정·인증·조회·Git 게시·배포는 아직 하지 않는다. 전체 사이트 인증/CSRF, 기존 시세/VTS, 가격·수급·점수·AI·주문 로직과 이전 작업폴더를 유지한다. 개인 자동매매 프로젝트는 접근하지 않는다.

## 활성화 의도와 공식 조건

사용자는 문의 없이 본인 비공개 사이트의 수동 조회 연결을 요청했다. 문의 접수·답변·별도 서면 허가를 API의 필수 조건으로 두지 않는다. `KIS_INTRADAY_ESTIMATE_USAGE_CONFIRMED` 및 기존 키와 동일하면 차단하는 임의 게이트는 제거했다. 해당 변수가 기존 설정에 있어도 읽거나 사용하지 않는다.
`KIS_INTRADAY_ESTIMATE_ENABLED=true`는 사용자의 활성화 의도이며 증권사 허가·약관 동의·조회 권한이 검증됐다는 뜻이 아니다. 기본 OFF를 유지한다.
공식 [공개 고객 이용약관](https://apiportal.koreainvestment.com/api/terms/public?termsType=MARKET)(공개 version28) 제5조는 키와 시세정보 이용을 본인 범위로 제한한다. 제3자에게 키나 데이터를 제공하는 기능을 추가하지 않는다. 개인 Render 호스팅·캐시의 명시적 허용 또는 위반을 이 자료만으로 확정하지 않고, 문의 취소를 허가 수령으로 표현하지 않는다. 서버 파일/DB/Redis/공유 응답 캐시와 브라우저 persistent storage를 쓰지 않는다. 조회 결과는 응답·화면 메모리에만 존재하고 토큰은 서버 메모리에서 관리한다.

## 공식 API와 자료 한계

공식 저장소 버전 `208279102f43fd0c0f15fcf66c9e5a5adda27050`의 [조회 샘플](https://github.com/koreainvestment/open-trading-api/blob/208279102f43fd0c0f15fcf66c9e5a5adda27050/examples_llm/domestic_stock/investor_trend_estimate/investor_trend_estimate.py), [chk](https://github.com/koreainvestment/open-trading-api/blob/208279102f43fd0c0f15fcf66c9e5a5adda27050/examples_llm/domestic_stock/investor_trend_estimate/chk_investor_trend_estimate.py), [지원표](https://github.com/koreainvestment/open-trading-api/blob/208279102f43fd0c0f15fcf66c9e5a5adda27050/legacy/postman/README.md)를 확인했다. URL·해시는 `kis-estimate-evidence/official-sources.json`에 있다.
- GET `/uapi/domestic-stock/v1/quotations/investor-trend-estimate`, TR `HHPTJ04160200`, `MKSC_SHRN_ISCD`, `output2`.
- `bsop_hour_gb`는 입력구분이며 외국인/기관/합산 필드는 직원 입력 누계 가집계 수량이다. 단위는 주로 표시한다.
- 해당 지원표의 VTS 칸은 비어 있다. 새 기능은 실전 전용이며 기존 VTS 시세를 실전으로 전환하지 않는다.
- 외국인09:30/11:20/13:20/14:30, 기관10:00/11:20/13:20/14:30은 변동 가능한 예정 입력시간이다. 코드별 매핑·실제 갱신 완료를 증명하지 않는다.

원천 거래일·갱신시각·입력구분 시간 매핑은 미확인이다. `sourceTradeDate/sourceUpdatedAt=null`, `freshness/inputTimeMapping=UNCONFIRMED`이며 서버 `observedAt`만 별도 KST로 표시한다. 조회 날짜를 당일 최신성으로 바꾸지 않는다.
0·양수·음수를 보존하고 누락/잘못된 값은 null과 별도 상태로 구분한다. 합산을 계산해 채우거나 누계 행을 더하지 않는다. 원본 행과 입력코드 순서를 보존하며 마지막 행을 최신으로 고르지 않는다. 빈 응답을0으로 해석하지 않는다. `eligibleForSupplyScore=false`이며 NAVER 수급·4점·보유 판정·AI·주문에 주입하지 않는다. 점수 활용은 기준일·최신성·회차·집계 성격 검증 및 별도 정책 변경 범위다.

## Render 설정과 최소 입력

새 키 발급을 요구하지 않는다. 사용자가 보유한 본인 실전 AppKey/AppSecret을 새 분리 설정에 직접 입력한다. 값은 채팅/스크린샷에 보내지 않는다. 이번 작업에서 값을 읽거나 복사·전송하지 않는다.

| 키 | 값/조건 |
| --- | --- |
| `KIS_INTRADAY_ESTIMATE_ENABLED` | 기본 `false`/미설정. 정확히 문자열 `true`일 때만 켜짐 |
| `KIS_INTRADAY_ESTIMATE_ENVIRONMENT` | 정확히 `live`. VTS/미설정/다른 값 차단 |
| `KIS_INTRADAY_ESTIMATE_APP_KEY` | 보유 실전 앱키 원문, 공백/줄바꿈 없는 ASCII1~1024자 |
| `KIS_INTRADAY_ESTIMATE_APP_SECRET` | 그 앱시크리트 원문, 같은 형식. 따옴표를 붙이지 않음 |

기존 `KIS_APP_KEY/KIS_APP_SECRET/KIS_BASE_URL`은 읽어 복사하거나 덮어쓰지 않는다. 계좌번호·HTS ID·주문 Hashkey는 필요 없다. 실전 origin과 조회 경로는 고정되어 임의 host/주문 경로를 선택할 수 없다.

후속 최소 단계:
1. 사용자가 백엔드 `k-stock-ai`의 Environment에 위4개를 직접 준비한다. 처음에는 `ENABLED=false`, `ENVIRONMENT=live`, 보유 키2개를 입력하고 **Save only**로 저장한다. OFF에서는 이 adapter가 키를 읽거나 인증/조회하지 않는다.
2. 별도 Git 게시/배포 승인 후 검증된 코드를 반영하고 보호된 설정 API를 확인한다. 설정 조회는 외부 요청0회이며 기존 VTS는 유지한다.
3. 실제 실행을 구체적으로 승인한 뒤 사용자 직접 `ENABLED=true`를 반영하고 로그인 상태에서 종목1개의 수동 조회를 누른다. 이때 최초 실제 인증/조회가 발생할 수 있다. 이번 단계에서는 실행하지 않는다.

현재 LIVE에는 이 로컬 기능이 반영되지 않았다. 키 유효성·실제 권한/응답·원천 갱신시각·개인 클라우드 이용 해석을 오프라인 검증으로 확정하지 않는다.

## 인증 문맥별 공유

`kisEstimateTokenCache.js`는 환경(live/vts)·고정 host·앱키·앱시크리트 버전의 fingerprint로 서버 메모리 문맥을 나눈다. 키 원문을 캐시 이름/로그/API에 출력하지 않는다. 같은 실전 문맥의 새 adapter들은 토큰과 발급 중 Promise를 공유하고 발급 간격을60초로 제한한다. 다른 host/VTS/키/키 회전은 섞이지 않으며 잘못된 host-환경 조합은 차단한다.
기존 `kisMarketData.js`와 VTS 토큰 계층은 그대로다. 새 공유 계층은 새 adapter들 사이에만 적용되며 다른 프로그램/프로세스의 발급까지 조정한다고 주장하지 않는다. 기존 시세도 같은 실전 문맥을 사용하도록 후속 변경한다면 공유 연동이 추가로 필요하다.
토큰 발급은 승인된 수동 요청에서만 수행한다. 유효한 `expires_in`일 때만60초 여유로 유지하고 없으면 그 발급 참여 요청에서만 사용한다.401은 해당 문맥/토큰만 무효화하고 재발급/재조회하지 않는다. 늦은 구 토큰의401은 새 토큰을 지우지 않는다. 발급 대기 참여자의 취소는 시작자의 요청을 취소하지 않는다. 시작자 실패/취소는 함께 실패하며 자동 재시도하지 않는다.

## API·예산·검증

- 보호된 `GET /api/stock/intraday-supply/config`: cookie/CSRF 아래 비밀값 없는 준비 상태, 외부 요청0.
- 보호된 `GET /api/stock/intraday-supply?symbol=005930`: cookie/CSRF와 `X-KIS-Estimate-Intent: manual` 필요. GET만 허용(HEAD도405). 중복/추가 query/body 차단.
- 숫자6자리만 지원. 영문 혼합 코드의 KIS 지원은 미확인으로 이 패널에서만 차단하며 기존 universe는 변경하지 않는다.
- 단일 서비스 adapter 동시1건,60초 간격,15분당 수동5회/상류 HTTP10회. 실패 포함.
- 첫 조회 최대2회(인증 POST1+수급 GET1), 유효 토큰이면 GET1. 총10초 제한, 브라우저12초 취소, 응답64KiB/20행 이하.
- 재시도/자동 토큰 재발급/자동 갱신/bulk/페이지 확장은 없다. 로그인/새로고침/뒤로가기/50·500추천에서 설정 metadata 외 추가 KIS 조회를 하지 않는다.
- 메모리 상태는 재시작 시 초기화된다. 단일 인스턴스/프로세스를 유지한다. 다른 프로그램 총량이나 증권사 전체 한도를 보장하지 않는다.

실제 환경값·외부 네트워크·비밀 파일·개인 프로젝트 접근을 차단하고 mock 토큰 공유/기존 인증/계산 회귀와 로컬 빌드를 검증한다. PC1440/390px UI는 독립 임시 브라우저·loopback/mock이며 외부 요청을 차단하고 수급 그림에 MOCK를 표시한다.
최종 로그/JSON/그림/검토 패치/해시/보존 근거는 `kis-estimate-evidence`에 있다. 기존 핵심14개 파일과 이전 두 작업폴더를 보존하며 server/App은 추가 연결6줄 외 동일하다. 실제 금융 API·키 사용·토큰 발급·주문·계좌·수집·문의·push·merge·배포·운영 설정 변경은 이번 단계에서0이다.
