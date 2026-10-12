# expanded500 중복 오류 진단 — 2026-10-12

## 결론 및 완료 범위

이번 변경은 **중복 위치 진단 보강**이다. 운영 중복 자체의 복구 완료를 주장하지 않는다.
제공된 화면은 `UNIVERSE_DUPLICATE_SYMBOL`로 목록 수집 단계에서 중단한 상태다.
1·2단계와 Gemini를 실행하기 전에 실패하며, 이전 저장 결과는 별도 문구로 표시된다.
실제 실패 응답의 행이나 발생 위치가 없으므로 페이지 내부 중복, 페이지 간 겹침,
시장 간 중복 중 어느 경우였는지는 아직 확정할 수 없다.

현재 GitHub main을 읽기 전용으로 처음과 마지막에 확인했다:
`5ad387ff04769dcdde53114bf0079835f0341849`.
부모 작업이 전달한 backend LIVE는 같은 SHA, frontend LIVE는
`4eff9be86dc0bde2bf5098c0b9941720335afaec`이다. LIVE는 이번 작업에서 재확인하지 않았다.

## 코드로 확인한 근거

- `server.js`는 기본 Naver adapter로 `createRecommendationUniverse`를 생성한다.
  expanded 목록은 정적 500종목 배열에서 오지 않는다.
- adapter는 응답의 MARKET_VALUE, page, pageSize, totalCount 및 정확한 행 수를 검증한다.
- `normalizedRow`는 원래 `itemCode`를 사용한다. 코드 trim, 숫자 변환, padding,
  대소문자 정규화가 없으므로 이런 파싱 변환이 서로 다른 코드를 합치는 경우는 없다.
- loader는 유효한 코드가 같은 페이지 또는 이전 페이지/시장에 다시 나타나면 중단한다.
  기존 Set은 처음 나타난 위치를 보존하지 않아 원인을 구분할 수 없었다.
- `expandedRunFailureDiagnostic`도 중복 위치를 기록하지 않았다.
  기존 로그에 요청 수가 있더라도 페이지 내부 중복과 페이지 간 중복을 확정할 수 없다.
- 순위 변동은 페이지 겹침의 가능한 이유이며 이번 증거로 입증된 원인은 아니다.
  실제 외부 universe 재조회로 재현하지 않았다.

초기 위임 환경의 Render 로그 조회는 workspace 미선택으로 차단됐다. 이후 부모 작업이
기존 승인 workspace `tea-dajrqoek1f9s7396omcg`를 명시해 조회했고, 아래 기존 오류 로그를
전달했다. workspace 확인은 더 이상 남은 차단이 아니다. 두 실행은 독립적으로 진단한다.

## 추가로 확인된 두 운영 실패

동일 instance: `srv-dajs02p42hec73fn02h0-7zsdd`.
아래는 부모가 Render에서 확인해 전달한 로그이며, 이 위임 작업이 재조회한 로그는 아니다.

| UTC 시각 | 오류 | 목록 요청 | 유형 확인 | 유형 HTTP 요청 | 확인 필요 코드 |
| --- | --- | ---: | ---: | ---: | --- |
| 2026-10-12T02:25:13.113231775Z | UNIVERSE_DUPLICATE_SYMBOL | 9 | 3 | 0 | 기존 진단에 없음 |
| 2026-10-12T02:25:00.855860387Z | TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE | 10 | 4 | 0 | 02826K / KOSPI |

두 로그의 stage는 `UNIVERSE_LOAD`, universeCoverage는 null이다. 후자의 blockedSymbol과
blockedMarket만 `02826K`, `KOSPI`이며 전자의 해당 필드는 null이다.
두 실행의 요청 수·유형 확인 수를 합하거나, 앞선 유형 실패를 뒤의 중복 원인으로
해석해서는 안 된다.

**중복 실행:** loader는 KOSPI 1페이지와 KOSDAQ 1페이지를 먼저 읽고, 같은 페이지를
재시도하지 않는다. 따라서 9회째 중복은 해당 시장의 후속 페이지에서 발생했다.
시장·페이지 번호·행 번호·중복 코드 및 WITHIN_PAGE/CROSS_PAGE/CROSS_MARKET은 기존 로그에
없다. 공식 유형 확인 3회는 코드/시장 조합의 분류 확인 수이며 중복 코드의 식별자가 아니다.
현재 코드에서 기록되는 검토된 예외 근거와 유형 검사는 중복 위치 정보의 대체물이 아니다.

`../duplicate-evidence/log-counter-ambiguity.cjs`의 **순수 TEST_ONLY 페이지**에서 세 중복
형태 모두 `9 / 3 / 0`과 동일한 오류 코드로 실패하는 것을 검증했다. 이는 운영 원인을
모의 재현해 확정한 결과가 아니라, 로그 카운터만으로 원인을 구분할 수 없다는 반증이다.
순위 변동·정렬 동률·제공처 내부 반복 중 어느 이유였는지는 여전히 미확정이다.

**앞선 유형 미확인 실행:** `02826K`는 허용되는 마지막 영문형 식별자이며 문법 오류가
아니다. 현재 `REVIEWED_OFFICIAL_RECORDS`의 코드 3개에는 등록돼 있지 않아 정확한
공식 코드/시장/주식종류 근거를 찾지 못하고 `UNVERIFIED`로 반환한다. 동일한 TEST_ONLY
fixture에서 10회째 이 코드를 만나 유형 확인 4회/HTTP 0회로 중단하는 것도 확인했다.
이는 현재 코드의 차단 이유를 확정한 것이며, 실제 주식종류를 확인한 결과는 아니다.
이 코드의 첫 등장이 유형 확인을 막으므로 동일 실행에서 이를 단순히 중복 코드로
처리한 것으로 볼 수 없다. 공식 유형 분류 모듈과 근거 목록은 변경하지 않았다.

실제 외부 universe나 새 공식 금융 자료를 조회하지 않았다. 기존 안전 조건을 유지하면서
운영 중복을 복구하는 추가 수정을 결정할 정보가 부족하므로, 진단 보강 이외의 production
변경을 추가하지 않고 여기서 멈춘다.

## 최소 production 변경

1. `services/recommendationUniverse.js`: 중복 감지용 Map에 최초 시장·페이지·행 번호를 보존한다.
   중복 시 기존 오류 코드로 즉시 실패하고 최초·반복 위치만 전달한다.
2. `services/recommendationUniverseDiagnostics.js`: 공개 코드 및 제한된 위치만 복사하는
   `safeUniverseDuplicate`를 추가한다. 위치로 WITHIN_PAGE/CROSS_PAGE/CROSS_MARKET을 산출한다.
3. `services/expandedRunFailureDiagnostics.js`: 중복 오류에만 검증된 optional `universeDuplicate`를
   API 상태와 기존 실패 로그에 포함한다. 오래된 진단 응답의 형태는 그대로 읽을 수 있다.

예시(순수 TEST_ONLY fixture):

```json
{"kind":"CROSS_PAGE","symbol":"000100","first":{"market":"KOSPI","page":1,"row":100},"repeated":{"market":"KOSPI","page":2,"row":1}}
```

원시 행, 이름, 시총 값, HTTP headers/body, 예외 메시지/stack는 새 필드에 포함하지 않는다.
중복검사, unique500, 양 시장 cutoff 아래의 전체 경계 페이지 또는 실제 시장 끝 증명,
동률에서 엄격한 `< cutoff`, 요청 상한 10회를 유지한다.
중복 제거, 추가 요청·재시도·자동 재실행, 목록 추정·채우기는 추가하지 않았다.
정상 출력/fingerprint/요청 수는 현재 main과 동일하다. 원자적 시점 증명은 여전히
`snapshotConsistency: NOT_PROVEN`이다.

server, 가격·추세·거래량·수급·뉴스·AI·최종 순위/판정/주문·저장 로직,
frontend 및 두 lockfile은 변경하지 않았다. FAILED 후 이전 결과 표시도 그대로 유지한다.

## 테스트 변경 및 검증

- `tests/recommendation-universe-duplicate-diagnostics.test.cjs`: 새 회귀 11개.
  같은 페이지, 경계 겹침, 값/순위 변동에 따른 반복, 전체 페이지 반복, 시장 간 반복,
  제외 ETF 반복, 잘못된 symbol, 진단 allowlist, 정상 fingerprint/cutoff/동률 및 변경 범위를 검증한다.
- `tests/helpers/universe-duplicate-boundary.cjs`: 과거 UI 작업의 범위 검사를 보존하면서
  위 세 production 파일의 정확한 SHA-256 source만 예외로 허용한다. 다른 변경은 실패한다.
  과거 기준과 이번 시작 main의 해당 파일이 같은지도 확인한다.
- 이 helper를 기존 범위 검사 13개에 연결했다:
  final-public-analysis-labels, gemini-price-regression, home-seo-fallback, light-theme-ui,
  neutral-strategy-prices-ui, public-ai-enum-display, public-analysis-language, public-prerender,
  public-router, public-seo, stock-detail-routes, stock-landing, strategy-explanation-ui.
  테스트 삭제·skip이나 계산/동작 assertion 완화는 없다.

| 검증 | 결과 |
| --- | --- |
| 관련 9개 suite의 부분 회귀(마지막 범위 helper 회귀 추가 전) | 160/160 통과 |
| 최종 전체 90개 suite | 2,404/2,404 통과, 실패·skip·cancelled 0, exit 0 |
| 초기 baseline guard 문제의 해당 suite 부분 재검증 | 24/24 통과 |
| 추가 운영 로그의 카운터 모호성 / 별도 유형 차단 fixture | 4가지 사례 모두 예상 실패·카운터 확인, exit 0 |
| Vite production build | 성공, 2,312 modules, exit 0 |
| 구문 검사 및 git diff whitespace | 통과 |

기존 회귀에서 500개가 모여도 양 시장의 cutoff 경계가 미증명인 경우, cutoff 동률,
잘못된 시장·행·symbol, 요청 상한 10회와 499개 불완전 목록의 실패를 확인한다.
목록 실패 시 fast/deep/AI는 0회이며 과거 결과는 이번 결과로 바뀌지 않는다.
가격 계산과 전략 관련 전체 회귀도 통과했다.

초기 전체는 2,403개 중 2,389 통과/14 실패였다. 13개는 이번 진단 추가와 과거
“backend 변경 없음” 검사의 충돌, 1개는 실행용 guard가 `.local` 아래의 존재하지 않는
legacy marker도 금지한 준비 문제였다. 동일 main baseline 2,393개에서는 같은 guard
문제 1개만 실패했다. 위의 엄격한 범위 helper와 **깨끗한 격리 checkout에 존재하지 않는
정확한 legacy marker의 ENOENT 경로만** 허용해 최종 전체를 재검증했다.
실제 legacy marker가 존재하면 guard는 여전히 읽기를 차단한다.

설치된 의존성을 읽기 전용 junction으로 재사용했으며 npm install/lock 변경은 없다.
환경은 Windows / Node v24.19.0 / Express 4.22.3 / proxy-addr 2.0.8 /
Vite 7.3.7 / React 19.3.0이다. Linux 운영 runtime/설치 트리는 재현하지 않았다.
build의 기존 500 kB chunk 경고는 남는다.

실행 증거는 worktree 옆 `../duplicate-evidence/`에 있다:
`targeted.stdout`, `full.stdout`, `full-initial.stdout`, `baseline-full.stdout`,
`baseline-approval.stdout`, `build.stdout`, `build.stderr` 및 각 실행의 `.json` metadata.
추가 로그 판단 근거는 `log-counter-ambiguity.json`, `log-ambiguity.stdout`에 있다.
실행 전 inherited 인증 환경값은 이름으로 제거하고, subprocess guard로 외부 fetch/socket/TLS,
비밀파일·개인 프로젝트 읽기, dotenv 및 실제 DB를 차단했다.
실제 금융·뉴스·KIS·Gemini·계좌·주문·공개 expanded POST·collector execute는 호출하지 않았다.
localhost fixture의 route 테스트는 운영 호출과 구분한다.

## 작업 공간, 배포 및 남은 차단

원본 저장소는 미커밋 파일을 포함해 보존했다. 개인용 프로젝트에는 접근하지 않았다.
현재 main을 별도 bare 복제 후 worktree/branch에서 작업했다:
`fix/expanded-universe-duplicate-diagnostics`, `../k-stock-ai-duplicate-fix`.
초기 진단 단계에서는 commit/push/merge/Render 배포·설정변경을 하지 않았다.
이후 사용자가 이 진단 수정의 작업 브랜치 저장·main 반영 및 backend 배포를 승인했다.
이 문서는 해당 반영 직전의 진단·검증 기록이다. 실제 GitHub SHA, 배포 ID·LIVE 상태와
설치/시작 로그 검증 결과는 최종 배포 보고 및 worktree 옆 실행 증거에서 확인한다.
frontend 배포, 환경변수·rewrite·Auto Deploy 설정 변경은 승인 범위에 포함되지 않는다.

승인된 반영 범위는 **backend만 1회의 진단 보강 배포**이며 frontend 배포는 포함하지 않는다.
이 배포는 원래 오류의 복구나 정상 완료를 보장하는 배포가 아니다. 이후 사용자가 직접
요청한 실행이 중복에 도달한 경우에만 새 위치 정보가 기록된다. 유형 미확인 차단이 먼저
발생하면 중복 위치는 얻을 수 없으며, 이를 위해 재실행을 자동화하거나 유형 검사를
우회하지 않는다. 이번 위임 작업에서는 실제 사용자 실행도 시작하지 않았다.

남은 정보는 중복 코드·최초/반복 시장/페이지/행 번호와, 페이지 겹침의 이유를 구분할
필요가 있는 경우의 비밀정보 없는 제공처 페이지 메타데이터/순위 근거다. 기존 카운터만으로
누락 종목이나 cutoff 완전성을 보충·추정할 수 없다. 유형 미확인 실행을 해결하려면 별도로
`02826K`/KOSPI의 정확한 공식 코드와 주식종류를 연결하는 검토된 근거가 필요하다.
이번 작업은 실제 외부 목록의 정상 500개 수집, 운영 API/배포 후 동작을 검증하지 않았다.
