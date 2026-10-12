# K-Stock AI 공통 비밀번호 비공개 전환

기준 main `06c553ff211526383971dbcc375b5daa7edaeee1`, 로컬 브랜치 `fix/private-site-password`.
현재는 로컬 구현·mock 검증만 수행했으며 push/merge/배포·운영 설정 변경·기존 사이트 종료를 하지 않았다.

## 구현 범위

- 기존 Node 백엔드가 `frontend/dist`를 같은 출처로 제공한다. UI와 데이터 API 모두 서버 인증을 거친다. 안내 HTML/종목 HTML/디렉터리 별칭/JS/CSS/robots/sitemap도 보호한다.
- 공개 예외는 `/login`, 로그인 전용 `/site-login.js`, `/site-login.css`, `POST /api/site-access/login`, 최소 liveness `GET/HEAD /healthz`뿐이다. `/api/health`의 기존 상세 상태는 보호한다.
- 로그인은 아이디 없이 비밀번호 하나. scrypt 검증, 1시간 절대 만료, 서버 메모리 세션, `__Host-kstock-site` Secure/HttpOnly/SameSite=Strict 쿠키를 사용한다. 서버 재시작 시 세션이 모두 무효화된다. 로그아웃은 서버 세션을 삭제하고 쿠키·브라우저 캐시/저장소를 정리한다.
- 모든 데이터 API는 쿠키와 CSRF 헤더가 필요하다. 상태 변경에는 같은 출처 Origin도 요구한다. 설정 누락/잘못된 설정은 503으로 닫히며 공개 모드로 fallback하지 않는다.
- 로그인 실패는 socket peer 기준 5회/15분, 전체 20회/15분으로 제한한다. Render 프록시를 공유하면 실패 제한도 공유될 수 있다. 임의 X-Forwarded-For를 신뢰하지 않는다. 세션/실패 map은 제한된 크기다.
- 인증 응답은 no-store/Vary: Cookie. client 초기화는 세션 확인 후에만 앱을 mount하며, 만료·401·뒤로가기·화면 복귀 때 재확인한다. 비밀번호/세션 쿠키/CSRF를 localStorage 등에 저장하지 않는다.
- 보유자 참고 기능도 사이트 세션으로 보호하므로 두 번째 비밀번호가 필요 없다. 평균매수가와 가격 계산은 기존 방식이며 서버 소유 상세 snapshot만 사용한다. 기존 보유 경고 사유·CAUTION 수정은 유지한다.
- 기본 50종목 화면의 자동 시세/추천 분석 시작을 제거했다. 로그인/첫 화면은 분석·수집·AI를 실행하지 않고 사용자의 명시적인 버튼 요청만 처리한다.
- PAPER/관찰 경로는 모든 메서드에서 404이며 주문/계좌 권한을 추가하지 않는다. 사이트 접속 보호와 개인 자동매매 실행 모드는 별개다.

## 사용자에게 필요한 설정 (값은 기록하지 않음)

Render 백엔드의 안전한 Environment 설정 화면에서 사용자가 직접 입력한다. 채팅·저장소·명령 기록에 실제 값을 전달하지 않는다.

| 키 | 의미/검증 조건 |
| --- | --- |
| `SITE_ACCESS_PASSWORD` | 공통 접속 비밀번호. 12자 이상, UTF-8 1024바이트 이하. 공백도 입력 그대로 비교한다. |
| `SITE_SESSION_SECRET` | 별개의 서명키. 사용자가 자신의 비밀번호 관리 도구에서 준비한 충분히 무작위인 32바이트 이상/4096바이트 이하 문자열. 접속 비밀번호와 재사용하지 않는다. |
| `SITE_PUBLIC_ORIGIN` | 최종 사이트의 HTTPS 출처. 현재 백엔드를 사용하면 `https://k-stock-ai.onrender.com`. 경로·query·fragment·사용자 정보를 넣지 않는다. |

기존 `HOLDING_GUIDANCE_ACCESS_SECRET`, `HOLDING_GUIDANCE_TOKEN_SECRET`은 이 전환의 사이트/보유자 인증에 사용하지 않는다. 기존 금융/AI/이력 환경변수나 디스크 경로는 임의로 변경하지 않는다.

## 수동 배포·종료 순서

1. 로컬 패치/테스트를 검토하고 게시·배포·기존 공개 사이트 종료에 대한 별도 승인을 받는다. 사용자가 위 세 설정을 안전한 화면에 저장했는지 확인한다. 실제 값을 읽지 않는다.
2. 기존 백엔드의 **단일 인스턴스** 구성을 확인한다. 메모리 세션이므로 여러 인스턴스/worker로 확장하려면 별도 공유 세션 설계가 필요하다. 지금은 확장하지 않는다.
3. 승인된 코드로 백엔드 build command를 `npm ci && npm --prefix frontend ci && npm --prefix frontend run build`로 설정한다. start command는 `node server.js`, health check는 `/healthz`로 설정한다. build에서 frontend/dist가 생성되어야 한다. AutoDeploy/preview 설정은 승인 범위 안에서 확인한다.
4. private 코드를 배포하고 revision/build 성공을 확인한다. 무인증 HTML/원본 정적 파일/기존 API가 로그인 전용 또는 401/404/503인지 확인한다. `/healthz` 204만으로 로그인 설정 완료를 판정하지 않는다. 실제 비밀번호 입력과 로그인은 사용자가 수행한다. 분석/수집 버튼을 시험 목적으로 누르지 않는다.
5. 기존 정적 프런트 `https://k-stock-ai-1.onrender.com` (`srv-dakg4l8u01pc73f1iq70`)의 서비스·custom domain 별칭·기존 public preview를 종료하거나, 기존 HTML/JS/guide가 남지 않는 안전한 안내 전용 전환을 별도로 승인·적용한다. redirect 규칙만 추가하고 예전 파일을 남겨두는 방식으로 완료 판정하지 않는다. CDN 반영과 직접 .html/assets 경로 차단까지 확인한다.
6. 사용자에게 새 단일 출처 URL과 재로그인 방법을 안내한다. 기존 공개 프런트/preview가 남아 있으면 비공개 전환 완료로 보고하지 않는다. 과거에 이미 다운로드/검색 캐시된 사본의 완전 회수는 보장할 수 없다.

기존 백엔드 서비스는 `srv-dajs02p42hec73fn02h0`이며 위 ID/주소는 저장된 배포 증거와 코드 기준이다. 현재 Dashboard 설정값·서비스 상태를 이번 작업에서 변경하거나 실제 조회하지 않았다. Render UI에서 실제 설정을 확인한 뒤 적용한다.

## 롤백 주의

`06c553ff` 등 이전 공개 revision으로 rollback하면 데이터 API가 다시 공개된다. 비공개 전환 후에는 **검증된 private revision**으로만 rollback한다. 첫 private 배포 실패 시 이전 public 서비스가 계속 제공될 수 있으므로 완료로 보고하지 않는다. private 대체 revision이 없으면 서비스 중단/접근 차단을 유지한 상태에서 수정하며 public revision을 정상 복구안으로 사용하지 않는다.

## 수급/개인 프로젝트 분리

전수 수급 UNKNOWN 초안은 `k-stock-ai-duplicate-fix`에 그대로 보존하고 이 배포 단위에 포함하지 않았다. 공급처·점수·가격·거래량·뉴스 계산은 변경하지 않았다. 개인 자동매매 프로젝트에 접근하지 않았다.

KIS `investor-trend-estimate` / `HHPTJ04160200`은 **비활성 설계**로 남긴다. 전달된 공식 지원표 조사에서는 실전 지원이 표시되고 VTS는 비어 있다. `frgn_fake_ntby_qty`, `orgn_fake_ntby_qty`, `sum_fake_ntby_qty`는 장중 추정 수량이며 `bsop_hour_gb`를 거래일/원천 갱신 시각으로 해석하지 않는다. 입력 구분/시간 매핑·원천 날짜·개인 클라우드 호스팅/캐시 이용 조건 확인과 별도 활성화 승인 전에는 키 설정·새 endpoint·실제 호출·점수 반영을 하지 않는다.

공식 링크: [KIS legacy/postman](https://github.com/koreainvestment/open-trading-api/tree/main/legacy/postman), [KIS API portal](https://apiportal.koreainvestment.com/provider). 비공개 전환 자체가 데이터 제공처의 재가공/이용 허용을 대신하지 않는다.

## 검증 기록

실제 비밀번호·서명키·시장/뉴스/Gemini/KIS/계좌/주문/수집 API를 사용하지 않는다. 새 인증 테스트는 unstripped 실제 서버 route registration과 mock provider counter를 사용한다. 역사적 계산/실행 모드 테스트는 고정된 정확한 인증 변경만 분리하여 기존 계산 경계를 보호한다. private 파일 hash 경계는 다른 변경을 허용하지 않는다.

전체 94개 테스트 파일의 2,429개 테스트와 주요 9개 파일의 141개 테스트가 통과했다. 프런트엔드 빌드도 성공했다(2,314개 모듈, 기존 청크 크기 경고만 있음).

PC 1440px/모바일 390px의 독립 브라우저 프로필에서 mock 서버로 다음을 확인했다: 루트·직접 HTML·디렉터리 별칭·종목 페이지·정적 자산의 비인증 차단, 오답 처리, 올바른 로그인, 새로고침, 로그아웃, 로그아웃 후 뒤로가기, 1시간 만료, 로그인 실패 횟수 제한. Secure/HttpOnly/SameSite=Strict cookie를 확인했고 금융 제공자 호출과 외부 요청은 모두 0회였다. 브라우저 검증은 명시적 `testOnly: true`의 loopback 서버로만 실행했으며, 운영 설정은 HTTPS를 요구한다.

실행 로그, 결과 JSON, PC·모바일 화면, 검토용 전체 패치와 파일 hash manifest는 작업 폴더 `private-site-evidence`에 저장했다. 원본 작업폴더 및 기존 수급 UNKNOWN 초안의 내용은 변경하지 않았다. 운영 로그인, 실제 HTTPS cookie/CDN/도메인 반영, 실 공급자 동작과 새 비밀값 설정은 배포 전까지 미검증이다.
