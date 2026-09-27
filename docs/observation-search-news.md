# NAVER API HUB 뉴스 검색 관찰 기반

기존 `m.stock.naver.com` 종목뉴스는 공개 최신 뉴스 표시 및 기존 관찰 경로에 그대로 둔다. 과거 날짜 탐색은 서버 내부 `naver-search-news-only` 범위로 분리했다. 이 범위는 `personal-local`에서만 선택할 수 있고 공개 HTTP 요청의 URL·헤더·본문으로 선택할 수 없다. 실제 전송은 서버 내부에서 명시적으로 발급한 1회용 승인과 정확히 한 번의 검색 요청 상한을 요구한다. 이 문서는 실제 조회를 승인하거나 자동으로 실행하지 않는다.

공식 [NAVER API HUB 뉴스 검색 문서](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)에 따르면 `GET https://naverapihub.apigw.ntruss.com/search/v1/news`이며 헤더는 `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`다. 이 코드의 환경변수 이름은 각각 `NAVER_API_HUB_API_KEY_ID`, `NAVER_API_HUB_API_KEY`다. 기존 NAVER Developers 검색 키와 API HUB 키는 별개다. [전환 안내](https://guide.ncloud-docs.com/docs/apihub-migration)를 따른다. 키 값은 기록하지 않는다.

`query`는 기존 공개 종목 목록의 종목명 매핑을 사용한다. `display`는 1~100, `start`는 1~1000이며 `sort=date`로 요청한다. `start`는 첫 요청 1에서 페이지마다 `display`만큼 증가한다. JSON 응답은 `total`, `start`, `display`, `items`를 제공한다. 문서는 일일 API 호출 한도 25,000회를 설명하지만 이 수치는 이 기능의 실행 승인 또는 요청 상한이 아니다. 날짜 범위 파라미터는 문서에 없으므로 제한된 페이지 탐색만 준비했다. 테스트용 최대 요청 수는 3회이고 실제 전송 상한은 1회다. 따라서 실제 실행은 `start=1` 한 페이지에서 끝난다. 승인 기록에는 `scope`, `symbol`, `query`, `targetDate`, `probeDateCutoff`, `sort`, `display`, `start`, `searchNewsMaxRequests`를 묶고, 전송 전에 일치 여부를 확인한다.

`pubDate` 원문과 파싱한 시각을 별도 저장한다. 문서상 이는 뉴스가 NAVER에 제공된 시각이며, NAVER에 제공되지 않은 기사는 원문 기사가 제공된 시각이다. 언론사의 최초 발행 시각이라고 확대 해석하지 않는다. 원문에 시간대 오프셋이 있는 경우에만 파싱하고 탐색 날짜는 Asia/Seoul 달력 성분으로 비교한다. `probeDateCutoff`는 페이지 깊이 탐색용이며 전략 뉴스 구간과 분리한다. 날짜에 도달해도 전체 수집 또는 전략 통과를 인정하지 않고 `UNVERIFIED`, `fullCoverageProven=false`, `HELD`를 유지한다. 기존 승인 기록과 실제 관찰 기록은 변경하지 않는다.
