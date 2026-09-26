# PAPER 실행 경계 (로컬 분리 검증)

서버의 `KSTOCK_EXECUTION_MODE`가 정확히 `personal-local`이고 `NODE_ENV`가
`production`이 아닌 경우에만 PAPER를 등록한다. 그 외에는 공개 모드다.
브라우저 query/header/storage는 모드 설정이 아니다. 기존 계좌/인증/Risk/Ledger
계산 및 PAPER 거래 규칙은 변경하지 않는다.

PowerShell에서 저장소 루트의 공개 서버:

```powershell
$env:KSTOCK_EXECUTION_MODE='public'
node server.js
```

개인용 로컬 서버(공개 서버를 종료한 뒤 별도 실행):

```powershell
$env:KSTOCK_EXECUTION_MODE='personal-local'
$env:NODE_ENV='development'
node server.js
```

개인용 서버는 127.0.0.1에만 바인딩한다. 기본 포트는 기존 5000이다.
다른 로컬 터미널에서 `cd frontend` 후 `npm run dev`로 프런트를 실행한다.
로컬 프런트의 `/api`는 Vite가 `http://127.0.0.1:5000`으로 전달한다.
포트를 따로 변경했다면 Vite의 고정 프록시 포트와 일치시켜야 한다.
Vite preview도 같은 로컬 프록시를 사용하며 프런트 `.env`는 읽지 않는다.
공개 호스트에서 제공하는 프런트의 기존 분석 API 주소는 유지한다.

프런트는 `/api/runtime-config`의 정확한 개인 모드 응답을 받은 후에만 PAPER
버튼을 표시한다. 확인 전/오류/공개 모드에는 PAPER 패널을 마운트하지 않는다.
공개 서버는 `/api/paper`와 하위 경로를 OPTIONS 포함 JSON 404로 응답한다.
현재 별칭은 없다. PAPER 라우터/엔진은 공개 모드에서 로드하지 않는다.

안전한 로컬 회귀 검증 (preview 경계 테스트 전에 프런트 빌드 필요):

```powershell
cd frontend
node --require ../tests/helpers/local-only.cjs node_modules/vite/bin/vite.js build
cd ..
node --require ./tests/helpers/local-only.cjs --test tests/execution-mode.test.cjs tests/paper-access.test.cjs tests/paper-api.test.cjs tests/paper-panel.test.cjs tests/paper-trading.test.cjs tests/order-lifecycle.test.cjs tests/chart-price-field.test.cjs tests/strategy-authority.test.cjs
```

테스트는 실제 server.js 라우팅을 Express에 등록하고 loopback HTTP로 검증한다.
서버 환경/공급자는 대역이며 실제 .env, KIS, DB를 사용하지 않는다.
UI는 실제 JSX의 hook/render를 대역으로 검증하며 브라우저 E2E와는 다르다.
빌드한 SPA의 로컬 Vite preview 프록시에서도 PAPER 요청의 JSON 404를 확인한다.
이 작업은 전체 보안 검증/공개 배포가 아니다. 기존 KIS 분석 테스트 endpoint,
시세 재제공 권한, 공개 호스팅 rewrite/CORS 정책은 별도 검토 대상이다.
