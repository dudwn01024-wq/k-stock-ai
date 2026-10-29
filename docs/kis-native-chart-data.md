# KIS 원천 일·주·월·년 봉 차트

## 공식 계약과 구현 구분

KIS 공식 예제는 `inquire-daily-itemchartprice`를 일·주·월·년 기간별 시세 API로 정의하고, 기간 코드 `D/W/M/Y`, 한 번에 최대 100건, `J` 요청 시장 코드, 수정주가 값 `0`을 설명합니다. 이 구현은 그 요청 형식을 따릅니다. [KIS 공식 API 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py)

응답에서 영업일자·시가·고가·저가·종가·누적 거래량·누적 거래대금·응답 종목 코드를 읽습니다. 필드 의미는 공식 확인용 예제의 매핑을 참고했습니다. [KIS 공식 응답 필드 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/chk_inquire_daily_itemchartprice.py)

아래의 조회 범위·엄격 검증·캐시·현재 기간 구분은 이 프로젝트가 추가한 보수적 처리 정책입니다. 공식 API가 모든 응답의 확정 여부나 전체 상장 이력을 보장한다는 의미가 아닙니다.

## 읽기 계약

`createKisMarketData()`가 반환하는 `fetchKisChartOHLCV(symbol, options)`를 사용합니다.

```js
await reader.fetchKisChartOHLCV('005930', {period: 'W'});
```

- `symbol`: 숫자 6자리 문자열. 영숫자 코드를 변환하거나 다른 제공처로 대체하지 않습니다.
- `period`: `D`, `W`, `M`, `Y` 중 하나. 분봉·시간봉은 지원하지 않습니다.
- 선택 `startDate/endDate`: 유효한 `YYYYMMDD`. 종료일은 조회 당시 KST 날짜를 넘지 않습니다.
- 선택 `onDataRequest`: 실제 일봉 API 데이터 요청 직전에 호출하는 계수용 함수. 캐시·동시 요청 공유에서는 새로 호출하지 않습니다.

기본 종료일은 KST 오늘입니다. 기본 조회 시작일은 종료일에서 다음 일수만큼 전이며, 1900년 이전으로 내려가지 않습니다.

| 기간 | 기본 최대 조회 폭 | 한 응답의 최대 봉 수 |
| --- | ---: | ---: |
| D 일봉 | 730일 | 100 |
| W 주봉 | 1,461일 | 100 |
| M 월봉 | 3,653일 | 100 |
| Y 년봉 | 36,600일 | 100 |

선택 범위도 위 최대 폭 안이어야 합니다. 충분한 기간을 요청하되 **한 페이지·한 데이터 시도만** 실행하고, 차트 데이터 요청에는 15초 중단 신호를 적용합니다. 100봉이 없다고 추가 페이지를 호출하거나 일봉 130개를 주·월·년 봉으로 합성하지 않습니다. 상장 기간·공급 범위·조회 조건에 따라 적은 봉이 반환될 수 있습니다. 100봉은 이번 응답의 최대 구간이며 전체 이력이나 화면의 모든 기간을 뜻하지 않습니다. `fullHistory:false`이며 전체 이력을 확보했다는 주장을 하지 않습니다.

기존 OAuth 토큰 캐시, 직렬 요청 큐, 기존 캐시 TTL을 공유합니다. 토큰 발급은 데이터 요청과 별도이며 기존 정책을 유지합니다. 차트 캐시는 종목·기간·조회 범위·J/0 조건별로 분리하고, 기존 상세 분석용 일봉 캐시를 서로 덮어쓰지 않습니다. 같은 진행 중 차트 요청은 하나로 합치며, 캐시의 원래 `receivedAt`을 그대로 보존합니다. 반환 객체는 별도 복사본이어서 화면이 수정해도 내부 캐시가 바뀌지 않습니다.

## 반환값

```text
{
  symbol, period, source: KIS_NATIVE_PERIOD_OHLCV,
  status: READY | EMPTY,
  rows: [date, open, high, low, close, volume, tradingValue,
         dataMetadata, periodStatus, calendarIncomplete],
  metadata,
  requestCount: 0 | 1,
  cacheStatus: MISS | HIT | COALESCED
}
```

`rows`는 **과거 → 최신** 순서입니다. 숫자는 해당 기간의 KIS 원천 응답만 사용합니다. 거래량의 실제 `0`은 유지하며 결측을 `0`으로 바꾸지 않습니다. 선택 항목인 거래대금이 없으면 `null`입니다.

`metadata`는 원천 거래일, 원천 시각(`null`이면 미제공), 원래 조회 시각, 요청 시장 `J`, 요청 기간, 수정주가 `0`, 일치한 응답 종목 코드, 단위(KRW/SHARES), 실제 반환 거래일 목록을 담습니다. 요청 시장 코드를 기록하지만 실제 응답의 시장 범위를 별도로 증명하지 않으므로 `marketScope:UNKNOWN`을 유지합니다.

빈 응답은 `EMPTY`, 빈 봉 배열, 기준 거래일 `null`로 반환합니다. 종가나 빈 봉을 만들어 넣지 않습니다.

## 현재 기간과 과거 기간

원천 거래일을 조회 시각의 **KST 달력 기간**과 비교합니다. 주의 시작은 월요일입니다.

- `CURRENT_PERIOD_PROVISIONAL`: 조회 시각과 같은 일·주·월·년 기간입니다. 달력상 진행 중인 기간으로 표시합니다.
- `PAST_PERIOD_FINALITY_UNCONFIRMED`: 과거 달력 기간입니다. 제공처의 확정 처리를 입증한 상태는 아닙니다.
- 빈 자료는 `UNKNOWN`입니다.

모든 상태에서 `sourceFinality:UNCONFIRMED`를 유지합니다. 예를 들어 일요일에 금요일 자료만 있으면 일봉은 과거 기간이지만 같은 주의 주봉은 여전히 현재 기간입니다. 새벽·장 마감·휴장이라는 이유로 봉을 추가하거나 확정 처리하지 않습니다. 이 분류는 거래소 휴장 달력 검증이나 제공처 확정 플래그를 대체하지 않습니다.

## 실패 처리와 검증 한계

응답 종목 코드가 없거나 다름, 잘못된 날짜, 요청 범위 밖의 날짜, 같은 기간의 중복 봉, OHLC 가격 관계 오류, 결측 필수값, 음수·부정확한 정수 거래량 등을 만나면 **전체 응답을 거부**합니다. 최신 행이 잘못됐을 때 이를 버리고 과거 행을 최신으로 표시하지 않습니다. HTTP·전송·JSON·제공처 오류도 한 번 시도 후 오류로 반환하며 재시도·다른 제공처 대체는 없습니다.

회귀 검사는 TEST_ONLY 환경·고정 시각·가상 응답과 외부 통신 차단으로 실행합니다. 실제 운영 종목 응답, 제공처 가용성·요금·응답 정밀도, 주·월·년 봉의 운영 화면 일치는 별도 실데이터 검증 대상입니다. 이 변경에서 실제 증권·AI·계좌·주문 API를 호출하거나 새 인증값을 읽지 않았습니다.
