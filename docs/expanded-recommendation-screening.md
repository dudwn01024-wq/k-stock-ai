# 공개 추천 2단계 스크리닝

기본 실행 모드는 `RECOMMENDATION_UNIVERSE_MODE=legacy50`이며 기존 50종목 추천 API, 4점 조건, 정렬, Gemini 연결을 그대로 사용한다. `expanded500`은 별도 운영 승인 후에만 설정한다. 이번 브랜치는 main 병합이나 Render 활성화를 포함하지 않는다.

확장 모드는 KOSPI·KOSDAQ 시가총액 목록을 검증해 500개 종목의 universe snapshot을 만든다. 목록은 확인된 Naver 모바일 내부 경로 `/api/stocks/marketValue/{market}?page=N&pageSize=100`에서 최대 10회 읽는다. 이 경로는 공식 공개 API 계약으로 확인되지 않았다. 각 시장에서 아직 읽지 않은 페이지가 전체 500위에 들어올 가능성이 남아 있으면 실행을 중단하며, 목록을 추정해 채우지 않는다. 종류가 명확하지 않은 상장 종목은 `UNKNOWN`으로 보존한다.

1단계는 종목당 기존 Naver 일봉 `price?pageSize=30&page=1`을 최대 1회 읽고 21거래일의 MA5/MA20, 이전 20일 평균 거래량, 고저와 조건 2개를 계산한다. 실패와 부족한 자료는 `LOOKUP_FAILED`, `INSUFFICIENT_DATA`로 구분한다. `preScreenScore`는 0~2의 사전 순서이며 기존 4점 최종 추천 점수가 아니다. 점수, 거래량 비율, universe 시가총액 순서로 정렬해 기본 40개를 고른다. 다른 460개는 `NOT_DEEP_REVIEWED`이며 `EXCLUDED`가 아니다.

2단계는 선정된 종목에만 기존 `buildRecommendationResult`와 기존 최종 정렬을 적용한다. 기존 상세 분석은 통상 basic 1회, price 1회, integration 2회, news 1회 등 종목당 약 5회 요청하며 누락 자료 보완 시 quote 경로에서 최대 2회가 더 일어날 수 있다. 실제 시도 수는 실행별 `requestStats`에 따로 기록한다. 1단계 동시성은 기본 4·최대 6, 2단계는 기본·최대 2다. 2단계 대상 수는 `RECOMMENDATION_DEEP_REVIEW_LIMIT`로 20~60 범위에서 설정하며 기본 40이다.

`POST /api/stock/recommendation-runs`만 새 확장 실행을 시작한다. `GET /api/stock/recommendation-runs/:runId`는 진행 상태만 읽는다. 진행 중 중복 POST는 같은 실행을 돌려주고, 서버 재시작으로 진행 상태가 사라지면 자동 재실행하지 않는다. 이력 저장이 설정된 경우 완성된 V2 기록을 읽는다. `RECOMMENDATION_EXPANDED_AI_ENABLED`의 기본값은 `false`여서 Gemini는 실행되지 않는다. 향후 별도 활성화할 때에도 최대 3개 후보의 기존 Gemini 입력·설명을 같은 V2 실행에 별도 불변 기록으로 연결한다. 기존 50종목 Gemini 경로와 프롬프트는 그대로 둔다.

V2 이력은 universe, fast, deep, 최종 manifest를 별도 원자적 파일로 기록하며 마지막 manifest가 있어야 완성된 실행으로 조회된다. V1 기록은 계속 읽을 수 있다. 운영에서 영구 저장소가 설정되지 않았으면 이력 상태는 `NOT_CONFIGURED`이며, 저장된 것처럼 표시하지 않는다. 100회·400MiB 한도와 자동 삭제 없음 정책은 유지한다. 합성 500종목 V2 1회 크기는 테스트에서 402,002바이트였다. 이 숫자는 실제 운영 기록 크기를 보장하지 않는다.

확장 화면은 모드를 서버에서 확인한 뒤에만 해당 경로를 보여준다. 방문·새로고침·이력 조회는 새 스캔을 시작하지 않으며, 사용자가 버튼을 눌러야 POST가 전송된다. 현재 공개 서비스의 `legacy50` 설정을 바꾸지 않으면 기존 동작이 유지된다.
