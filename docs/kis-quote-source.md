# KIS 현재가 응답의 사용 기준

이 문서는 분석 웹사이트의 현재가 표시 전환을 위한 로컬 구현 설명이다. 실제 증권 데이터를 호출하거나 운영 배포를 검증한 보고가 아니다. 주문·계좌·Risk 정책은 이 변경의 범위에 포함되지 않는다.

## 기존 문제와 바꾸는 방식

현재가는 Naver, 추천·상세 분석 일봉은 KIS일 때 제공처와 조회 시점을 함께 읽어야 했다. 현재가·거래량·거래대금·시가·고가·저가를 **KIS 현재가 API의 동일한 `output` 한 개**에서 가져오도록 정규화 모듈을 추가했다. 없는 값을 Naver나 다른 KIS 응답으로 채우지 않는다. 현재가 × 거래량을 거래대금으로 만들거나 전일 종가를 역산하지 않는다.

원천은 `/uapi/domestic-stock/v1/quotations/inquire-price`, TR ID는 `FHKST01010100`이다. [한국투자증권 공식 `inquire_price.py`](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_price/inquire_price.py)가 이를 정의한다. 공식 예제는 REST 조회와 연속 실시간 WebSocket을 구분하므로, 이 구현도 한 번 조회한 스냅샷을 실시간 스트리밍이라고 부르지 않는다.

| 화면 값 | 실제 선택 필드 | 처리 |
| --- | --- | --- |
| 현재가 | `stck_prpr` | 양의 안전한 정수만 수치로 사용 |
| 전일 대비 | `prdy_vrss` | 제공된 부호 그대로 검증하며 부호 코드와 모순되면 `null` |
| 등락률 | `prdy_ctrt` | 제공된 소수 값만 사용. 현재가·전일 대비로 새 비율을 만들지 않음 |
| 거래량 | `acml_vol` | 0 이상 정수. 실제 0과 결측을 구분 |
| 거래대금 | `acml_tr_pbmn` | 0 이상 정수 원문. 다른 값으로 계산하지 않음 |
| 시가·고가·저가 | `stck_oprc`, `stck_hgpr`, `stck_lwpr` | 양수와 고저 순서 확인. 모순되면 OHLC 표시를 보류 |
| 응답 종목 | `stck_shrn_iscd` | 요청한 6자리 코드와 반드시 같아야 함 |

위 필드명과 의미는 [공식 `chk_inquire_price.py`의 응답 매핑](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_price/chk_inquire_price.py)과 대조했다. 업종명 `bstp_kor_isnm`은 종목명이 아니며, 문서에 없는 임의 종목명 필드도 선택하지 않는다. 이 API만으로 확인되지 않는 `stockName`은 `null`이다. 별도 종목 검색·목록의 이름을 화면에서 쓰는 경우에는 그 별도 출처를 구별해야 한다.

## 요청 시장과 실제 응답 범위는 다르다

공식 KIS 예제에서 요청 코드는 J=KRX, NX=NXT, UN=통합으로 설명된다. 이번 변경은 기존 일봉·기간 차트와 같이 **J 요청만** 허용한다. NX·UN·다른 종목 형식으로 조회 범위를 넓히지 않는다.

메타데이터에는 `requestedMarket: J`, `requestedMarketScope: KRX`를 남긴다. 그러나 응답에서 실제 포함 시장을 독립적으로 입증한 필드는 확인하지 못했으므로 `responseMarketScope: UNKNOWN`, `marketScope: UNKNOWN`을 유지한다. `rprs_mrkt_kor_name`의 KOSPI·KOSDAQ을 KRX·NXT 범위 증명으로 사용하지 않는다.

## 거래일과 원천 시각이 비어 있는 이유

확인한 공식 현재가 응답 매핑에는 **이 시세의 거래일이나 체결 시각을 확정할 필드가 없다**. `w52_hgpr_date` 등은 52주 고가 발생일이며 현재가의 거래일이 아니다. 수신한 한국 날짜나 마지막 KIS 일봉 날짜를 현재가 날짜로 붙이지도 않는다.

따라서 현재가와 집계 메타데이터는 모두 다음처럼 남긴다.

- `source: KIS_CURRENT_QUOTE`
- `sourceBusinessDate: null`, `sourceTimestamp: null`
- `receivedAt`: 실제 이 응답을 받은 시각
- `sameResponse: true`, `dateConsistency: UNKNOWN`

“한 응답의 값”은 서로 다른 응답을 섞지 않았다는 뜻이다. 그 응답의 모든 값이 상세 분석 일봉·수급과 같은 거래일·시점이라는 뜻은 아니다. 출처를 KIS로 통일해도 이 날짜 확인 한계는 남으며 화면에 알려야 한다.

## 단위와 정밀도

국내 J 기본시세 인터페이스의 가격·거래대금은 KRW, 거래량은 주 수(`SHARES`)로 구별한다. [KRX 공식 시장 안내](https://global.krx.co.kr/contents/GLB/01/0109/0109000000/guide_to_trading_in_the_korean_stock_market.pdf)의 가격 KRW·주식 거래 단위 1주를 참고했다. 이 자료의 과거 호가표·시간·규정은 이번 코드에 복사하지 않는다. **해당 시장의 기본 단위 근거와 API 원문 숫자를 확인한 범위**이며, 이번 작업에서 실제 운영 응답의 거래대금을 대조 검증했다는 의미는 아니다. 동적으로 제공되는 개별 REST 문서의 거래대금 단위 상세까지 확보한 것으로 보고하지 않는다.

숫자에 만·억·백만원 배수를 임의로 곱하지 않는다. `fcam_cnnm`은 액면가 통화명이므로 현재가 통화를 별도로 검증한 필드로 사용하지 않는다. 원 단위 정수 값은 원문대로 보존한다.

- 안전한 정수: 수치와 정확한 정수 문자열을 함께 보존한다(`EXACT_INTEGER`).
- 예를 들어 원문이 `9007199254740993`이면 JavaScript의 안전한 정수 범위를 넘는다. 수치 `tradingValue`는 `null`, 정확한 `tradingValueText`는 그 문자열로 보존한다(`EXACT_INTEGER_TEXT_ONLY`). 근사 수치로 계산하지 않는다.
- 처음부터 안전 범위를 벗어난 JSON 숫자로 받은 경우에는 이미 정밀도를 잃었을 수 있다. 정확한 원문 문자열을 복원했다고 주장하지 않고 수치·문자열 모두 `null`로 둔다(`UNSAFE_JSON_NUMBER`).
- 결측은 `UNAVAILABLE`, 잘못된 정수 형식·범위는 `INVALID`로 구별한다. 거래량도 같은 정밀도 경계를 적용한다.
- 등락률의 원문 소수와 숫자로 바꾼 뒤의 소수를 비교한다. `0.10000000000000001`이나 `9007199254740990.9`처럼 조용히 반올림되는 값은 `changeRate: null`, 이유 `DECIMAL_PRECISION_LOSS`로 남기고 원문은 `changeRateText`에 보존한다. `+0.00`, `-0.00`, 앞뒤의 불필요한 0은 의미가 같으면 유효하다. 원문 소수 비교가 통과한 일반 값만 수치로 사용한다.

가상 예로 현재가 70,000원, 거래량 1,234주, 제공된 거래대금 87,234,567원이 있다고 하자. 거래대금은 그 제공값을 사용한다. `70,000 × 1,234`로 덮어쓰지 않는다. 이는 `TEST_ONLY` 예시이며 실제 종목 관측값이 아니다.

## 전일 대비 부호 검증

KIS의 [공식 실시간 체결가 문서](https://apiportal.koreainvestment.com/apiservice-apiservice?%2Ftryitout%2FH0STCNT0=)에는 같은 이름의 `PRDY_VRSS_SIGN`을 1=상한, 2=상승, 3=보합, 4=하한, 5=하락으로 정의한다. REST 응답의 부호 필드 존재는 위 공식 REST 매핑으로 확인했다. 다만 REST 수치가 언제나 무부호 절대값이라는 형식 보장은 확보하지 못했으므로 **부호 코드만으로 양수를 음수로 바꾸는 동작은 하지 않는다**.

제공된 부호 있는 전일 대비·등락률이 코드 방향과 맞으면 그대로 사용한다. 상승 코드에 음수가 오거나 하락 코드에 양수가 오면 해당 값은 `null`, 이유는 `SIGN_VALUE_CONFLICT`다. 알 수 없는 코드면 `SIGN_CODE_UNVERIFIED`로 남긴다. 보합은 실제 제공된 0을 확인한다. 상승·하락일에도 제공처 반올림으로 등락률이 0일 수 있으므로 0%를 임의의 작은 비율로 바꾸지 않는다.

## 누락·오류와 수급 경계

현재가가 결측·0·음수·안전하지 않은 수치면 응답 상태는 `UNAVAILABLE`, 이유는 `KIS_QUOTE_PRICE_UNAVAILABLE`다. 다른 표시 수치와 정수 문자열도 함께 비운다. 이전 정상 시세나 최신 일봉 종가로 채우지 않는다. 현재가가 유효하고 선택 항목만 없으면 그 항목만 `null`로 남긴다. 고가·저가·현재가의 범위가 모순되면 OHLC를 비우고 `OHLC_GEOMETRY_INVALID`를 기록한다.

시세 응답의 `frgn_ntby_qty`, 프로그램 순매수량을 분석에 선택한 KIS 수급으로 취급하지 않는다. `foreignerNet`, `institutionNet`은 이 모듈에서 항상 `null`이다. 선택 수급은 기존 검증된 수급 경로에서 별도로 가져와 그 출처·거래일과 연결해야 한다.

제공처 오류 코드, 출력 형식 또는 응답 종목 검증 실패는 안전한 `KIS_QUOTE_*` 코드로 실패한다. 제공처 오류 원문·인증 정보·추가 응답 내용은 결과에 복사하지 않는다.

## 조회·캐시와 검증 범위

연결 리더는 기존 토큰 캐시·요청 큐를 재사용하고, 현재가 전용 캐시와 동일 종목의 진행 중 요청 공유를 사용한다. 캐시 TTL은 기존 `KIS_OHLCV_CACHE_TTL_MS` 설정(기본 15초·기존 최소 5초)을 재사용한다. 캐시 적중에도 원래 `receivedAt`을 새 시각으로 바꾸지 않는다. 현재가 없는 `UNAVAILABLE` 결과는 정상 캐시로 저장하지 않는다. 만료 뒤 새 조회가 실패하면 지난 정상값을 반환하지 않는다.

실제 데이터 조회는 GET 한 번·시도 한 번이며 15초 제한을 둔다. 토큰 갱신은 데이터 조회 횟수와 별개이므로 `requestCount`만으로 전체 HTTP 횟수라고 주장하지 않는다. 자동 공급처 대체·추가 항목 보충 조회를 만들지 않는다. 독립 일봉·차트 캐시의 숫자를 현재가에 섞지 않는다.

`tests/kis-quote-snapshot.test.cjs` 18개와 `tests/kis-quote-reader.test.cjs` 18개를 함께 실행해 **36개 통과·실패 0·skip 0**을 확인했다. 전부 `TEST_ONLY` 입력이며 실제 제공처·AI·계좌·주문 API를 호출하지 않는다. 숫자·소수 정밀도, 0·결측, 부호·OHLC 모순, 종목 검증, 날짜 미추정, 다른 응답 보충 금지와 캐시·오류 경계를 검사했다. 실제 시장에서의 원천 응답 대조, 전체 통합 검사·빌드 및 Render 배포는 별도로 확인해야 한다.
