# Naver 뉴스 전용 관찰 범위

`naver-news-only`는 개인용 로컬 서버 내부의 명시적 범위다. 기존 기본 `GET https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1`을 유지한다. 새 다중 페이지 승인에 한해 `pageSize=10` 또는 `20`과 `page=1..5`를 정확히 묶고 순차 요청할 수 있다. 다른 KIS·Naver 시세·수급·기사 본문·AI·계좌·주문 경로는 허용하지 않는다. 기존 `full-observation`, 일봉·투자자 수급 범위와 전략 계산은 변경하지 않는다.

실제 실행에는 사용자 승인으로 새로 발급한 `approvalId`가 필요하다. 기존 1페이지 승인의 조건(`page=1`, `pageSize=10`, 요청 최대 1회)은 그대로 읽는다. 다중 페이지 승인은 `scope`, `symbol=005930`, `targetDate`, `pageSize=10|20`, `maxPages=1..5`, `naverNewsMaxRequests=1..maxPages`를 정확히 묶는다. 새 탐색 실행은 여기에 유효한 `probeDateCutoff`를 반드시 명시해 함께 묶는다. 값이 다르거나 빠진 승인은 첫 HTTP 전에 거부하며 기존 승인 기록에는 탐색 기준을 소급해 추가하지 않는다. 공통 HTTP 제한은 **해당 뉴스 승인에 한해서만** 승인 상한을 적용하고, 앞 페이지부터 순서대로 전송한다. 20건 응답은 근거 저장 단계에서도 최대 20건까지 보존한다. 공개 서버에는 라우터가 없고 브라우저 body의 범위·승인 필드는 거부하며 query/header는 실행 설정으로 사용하지 않는다. 이번 확장에서는 테스트 승인만 발급하고 외부 API를 호출하지 않았다.

`OBSERVATION_V2`의 `NEWS_COLLECTION`에는 요청·응답별 식별자, 기사 ID/officeId, 제목, 언론사, URL(안전한 Naver URL만), 원본 시각 필드와 파싱 결과, 수신 시각, 페이지와 제공된 메타정보만 허용 목록으로 저장한다. 12자리 `YYYYMMDDHHmm`는 달력상 유효한 연·월·일·시·분 성분으로만 파싱해 `providerDatetime`/`providerDatetimeParsed`에 남긴다. 시간대와 발행/갱신 의미는 부여하지 않는다. 원본 응답 전체와 인증정보는 저장하지 않는다. 기사 식별값이 동일하고 근거도 동일하면 한 건만 계산하며, 동일 식별값의 근거가 다르면 충돌로 남기고 임의 선택하지 않는다. `COLLECTED`는 자료 수집 성공만 뜻하며 종합 전략 평가는 하지 않는다. `riskReady=false`, `ledgerInputReady=false`와 거래 허가 미평가를 유지한다.

승인된 뉴스 구간은 이전 확인된 KRX 거래일 정규장 마감 **초과**부터 대상 거래일 정규장 마감 **이하**다. 현재 프로젝트에는 2026-09-23에 적용할 날짜별 공식 KRX 세션 근거가 없고, Naver의 `datetime`·`createdAt`·`date`가 발행시각인지 갱신시각인지 확인되지 않았다. 따라서 실제 응답의 기사별 구간 판정은 `TIME_UNVERIFIED`이며 이를 뉴스 없음·악재 없음으로 바꾸지 않는다. 합성 일정/발행시각은 `testOnly` 테스트에서만 주입 가능하며 테스트 기록에만 남는다.

기존 `window`는 KRX 거래일·세션 근거가 필요한 **전략 뉴스 구간**이다. 별도 `probeDateCutoff`는 탐색 깊이를 확인하는 날짜일 뿐이다. 명시적으로 승인된 탐색 실행에서는 정상 파싱된 `YYYYMMDDHHmm`의 **날짜 성분만** 기준일과 비교한다. 한 기사라도 그 날짜 이하이면 그 페이지를 처리하고 `probeBoundaryReached:true`, `probeFirstReachedPage`를 저장한 뒤 추가 요청을 멈춘다. 파싱 오류·ISO 시각은 이 탐색 비교에 사용하지 않는다. 페이지 번호나 정렬 순서로 오래된 기사를 추정하지 않는다. 세션 근거가 없어도 탐색은 멈출 수 있지만, 그것으로 전략 뉴스 구간을 확정하거나 기사를 전략에 포함하지 않는다. 탐색 기준에 닿으면 `collectionStatus:UNVERIFIED`, 승인 상한까지 닿지 못하면 `INCOMPLETE`로 기록하며 두 경우 모두 `fullCoverageProven:false`, 전략 `HELD`다. 발행/갱신 의미와 시간대·정렬은 계속 미확인이다. 기존 탐색 기준 없는 승인 경로와 테스트 전용 전략 구간 중단 동작은 유지한다. 응답에 없는 `totalCount`, `hasNext`, `sort`는 `null`로 유지한다. 빈 페이지나 명시적 `hasNext=false`에서는 추가 요청을 멈춘다.

외부 통신 차단 통합 테스트: `node tests/observation-news.test.cjs`. 테스트 승인 → 기존 Naver 함수 → 공통 제한 → 합성 HTTP → 파일 저장/다시 읽기 → 같은 근거로 재검증을 포함한다. 가상 일정과 합성 뉴스는 실제 제공처·KRX 근거가 아니다.
