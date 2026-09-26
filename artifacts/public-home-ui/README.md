# 공개 첫 화면 UI 검증 — 테스트 데이터 화면

브랜치: `codex/paper-execution-boundary` (commit/push/배포 없음).
기존 PAPER 실행 경계 작업을 보존하고 공개 첫 화면의 배치/표현만 수정했다.

## 화면

모든 화면은 실제 시세가 아닌 `tests/ui-preview.cjs`의 명시적인 MOCK_FIXTURE 응답이다.
PC viewport 1440×1000, 모바일 viewport 390×844. 전체 페이지 캡처는 세로로 길며 스크롤바 폭은 제외된다.

- `before-desktop.jpg`, `before-mobile.jpg`: 기존 화면. 전체 캡처용 before-build는 HEAD의 App에 이전 PAPER 접근 경계를 반영하여 별도 생성했다. 현재 소스/서버 파일은 되돌리지 않았다.
- `after-desktop.jpg`, `after-mobile.jpg`: 수정한 화면.
- `browser-checks.json`: 두 폭의 empty/missing/loading/error/stale DOM 안내 및 페이지 폭 확인 결과.

검색 입력/조회, 후보 선택 → 기존 상세 분석 이동, 모바일 펼쳐보기, 첫 화면 핵심 글자의 overflow도 브라우저에서 확인했다.
공개 화면에 PAPER/연결 정보가 없음을 확인했다. 시장 전체 데이터가 없어 조회 대상 후보 요약만 표시한다.

## 실행

저장소 루트 PowerShell에서:

```powershell
Set-Location C:\Users\82107\Documents\GitHub\k-stock-ai
node tests/ui-preview.cjs
```

브라우저: http://127.0.0.1:5188/?scenario=normal
상태 전환: scenario=empty, missing, loading, error, stale.
서버가 이미 실행 중이면 재실행하지 말고 주소만 연다. Ctrl+C로 종료한다.
실제 server.js는 실행하지 않는다. 테스트 서버는 127.0.0.1에만 바인딩하며 provider/DB 로딩과 외부 소켓을 차단한다.
테스트 응답에 CSP를 적용하여 페이지의 연결/리소스 로드는 같은 로컬 origin으로 제한한다.
before-build는 비교 캡처용 산출물이며 운영 빌드/기본 데이터가 아니다.

## 새로 실행한 검사

```powershell
node --require ./tests/helpers/local-only.cjs --test tests/public-home.test.cjs tests/chart-price-field.test.cjs tests/strategy-authority.test.cjs tests/paper-access.test.cjs tests/execution-mode.test.cjs tests/paper-api.test.cjs tests/paper-panel.test.cjs
node --check tests/ui-preview.cjs
node --check tests/public-home.test.cjs
git diff --check
Set-Location frontend
node --require ../tests/helpers/local-only.cjs node_modules/vite/bin/vite.js build
```

- 83 tests PASS (공개 첫 화면 신규 12개 포함).
- 기존 Express 라우팅과 Vite proxy를 통과하는 로컬 HTTP 요청에서 PAPER 404 확인.
- 프런트 빌드 PASS. 기존 500kB 초과 번들 경고 유지. 번들 최적화는 범위 밖.
- syntax/diff 검사 PASS. Git의 LF/CRLF 안내만 존재.
- 최초 sandbox 빌드는 esbuild 프로세스 생성 EPERM으로 실패했고, 외부 통신 차단을 유지한 로컬 프로세스 실행 승인 후 성공.

## 보존 및 한계

server.js, executionMode.js, PaperAccess.jsx, vite.config.js, paper-api.test.cjs, local-only.cjs의 SHA256은 작업 시작 시점과 동일하다.
App.jsx에는 이전 PaperAccess/로컬 API 주소 분기와 이번 UI 수정이 함께 있으며 기존 경계를 유지한다.
계좌/인증/Risk/Ledger/PAPER 계산/분석 계산/주문 코드는 변경하지 않았다.
실제 API/KIS/DB/Render/키/.env에 접근하지 않았다. 실제 외부 서비스의 최신 동작은 미확인이다.
현재 데이터 메타데이터 제공 코드가 freshnessStatus=UNKNOWN을 반환하므로 실서비스에서 오래됨을 확정할 수는 없다. STALE UI는 테스트 응답으로 검증했으며 임의 시간 임계값은 추가하지 않았다.
기존 상세 분석 내부의 일부 누락 요약은 0 또는 패턴 없음으로 표시되는 부분이 남아 있다. 이번 후보 요약에서는 누락과 미충족을 구분했으며, 상세 전체의 표시 감사는 완료 범위에 포함하지 않는다.
이 결과는 공개 첫 화면의 로컬 UI 개선 검증이며 전체 보안 검증/공개 배포 완료가 아니다.
