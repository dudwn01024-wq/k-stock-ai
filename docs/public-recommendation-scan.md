# 공개 추천 실행과 Gemini 연결

`GET /api/stock/recommendations`는 기존 50종목 scanner를 실행한다. 진행 중인 요청은 같은 Promise를 공유하며 scanner의 종목 동시성 2, 점수·등급·정렬은 그대로 사용한다.

서버가 만든 `scanId`와 실행 시작·완료 시각, 성공·실패 수, 후보/기존 제공처 메타데이터·Gemini 입력만 프로세스 메모리에 보관한다. 완료 후 TTL은 10분, 최대 20개이다. AI가 진행 중인 항목은 강제 교체하지 않으며 전부 진행 중이면 새 scan을 503으로 보류한다. TTL은 재사용 기간이며 시세 최신성·거래일 증명이 아니다. 재시작·만료·용량 교체로 사라질 수 있다.

`GET /api/stock/recommendations-ai?scanId=...`는 서버가 보관한 해당 실행만 읽는다. scanner를 호출하지 않는다. 동일 ID의 AI 진행·완료·실패 결과를 재사용하며 기존 Gemini 제공자·모델·내부 retry/validation·최대 3종목 정책은 유지한다. 브라우저는 가격·점수·후보·키를 전달할 수 없다. 추가 필드는 400, 없는 ID는 410이며 자동 재스캔하지 않는다. 오류 메시지에 provider 예외·인증정보를 전달하지 않는다.

프런트는 후보를 먼저 표시하고 AI를 연결한다. 새 요청 generation과 scanId가 모두 맞아야 AI 결과를 표시한다. 실패해도 후보는 유지한다. 이전 백엔드가 scanId를 주지 않으면 AI를 호출하지 않고 업데이트/재조회 안내를 표시한다. 이전 프런트가 scanId 없이 새 백엔드를 호출하면 400으로 명시적으로 실패하며 재스캔하지 않는다. 이 전환 오류는 후보 조회와 분리된다.

배포 확인은 `/api/health`의 `recommendationProtocol=RECOMMENDATION_SCAN_V1`, `buildCommit`(Render 제공 시), 프런트 정적 자산으로 한다. 확인 목적으로 실제 scanner/Gemini를 반복 호출하지 않는다. 기존 공개 백엔드 주소와 공개/개인 실행 경계를 유지한다.

검증 명령(실제 외부 통신 차단):

```sh
node --require ./tests/helpers/local-only.cjs --test tests/public-recommendation-integration.test.cjs tests/public-home.test.cjs tests/strategy-authority.test.cjs tests/null-data-integrity.test.cjs
cd frontend
node node_modules/vite/bin/vite.js build
```

`node tests/recommendation-preview.cjs`는 127.0.0.1:5192에 합성 화면만 제공한다. `?scenario=waiting`, `ai-error`, `scan-error`, `legacy`로 상태를 검증한다. 실제 데이터/자격정보를 읽거나 외부 서버로 프록시하지 않는다. 이 서버는 운영 앱에서 import하지 않는다.
