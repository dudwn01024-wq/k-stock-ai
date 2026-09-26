# 관찰 근거 보존과 정책 결정 (2026-09-24)

후속 상태: 아래 ‘초안·미적용’ 부분은 당시 기록이다. 이후 사용자가 승인한 장마감 정책은 [observation-eod.md](observation-eod.md)에 따라 관찰 평가·화면·V2 저장·오프라인 재검증에 적용했다. 데이터의 공식 근거 부족과 현재가 전용 전략 충돌은 계속 보류한다.

이번 작업에는 실제 조회가 없다. 기존 브랜치와 변경을 보존하고, 관찰 전용 경로만 수정했다.
기존 전략 계산·인증·요청 상한·실행 경계는 변경하지 않았다.

## 연결된 경로

`createMarketDataProvider` → 기존 `fetchKisDailyOHLCV` / `fetchStockQuoteData` / `fetchStockNewsBySymbol`
→ 관찰 전용 evidence transport → **기존 공통 HTTP budget** → 응답의 허용 필드 추출
→ 기존 변환/전략 평가 → `createObservationService` → `OBSERVATION_V2` JSON
→ JSON 다시 읽기 → `reviewObservationFreshness` (`OBSERVATION_FRESHNESS_V2`).

전역 KIS/Naver 조회 함수는 변경하지 않았다. 관찰에 주입하는 transport만 감싸고, 기존 budget을 우회하지 않는다.
`oauth2/tokenP`는 기존 budget으로 바로 전달하고 인증 응답을 수집하지 않는다. 오류는 고정 코드로만 남긴다.
실제 기록 `.local/strategy-observations/live-once/`, 테스트 기록 `.local/strategy-observations/test/`는 Git 제외 상태다.
통합 테스트는 임시 디렉터리의 `test/`를 사용하고 테스트 데이터임을 명시한다.
기존 V1은 그대로 읽히며 근거를 현재 설정에서 보충하지 않는다. 과거 실제 기록은 재저장하지 않았다.

## 저장 계약

- 관찰 ID, OBSERVATION_V2, 전략 코드 SHA256, freshness 정책 버전 및 평가/실행 시점.
- OBSERVATION_EVIDENCE_V1의 요청별 UUID: 로컬 연결 ID이며 제공자 발급 ID가 아니다.
- 요청: 고정 제공처/API 경로/GET, 허용된 종목·시장·기간·수정주가·페이지 파라미터만. 인증 헤더/본문/URL 전체는 저장하지 않는다.
- 응답: 같은 요청 ID 아래 수신 시각과 `{path,value,status}`. `PRESENT`, 실제 `NULL`, `REJECTED_VALUE`를 구별하고 없는 필드는 생성하지 않는다.
- KIS: output1 단축 종목코드, output2 영업일·OHLC·거래량·거래대금·수정 관련 코드. 원본 문자열/숫자 타입과 실제 0 보존.
- Naver: 기존 reader가 읽는 가격/거래량 원본, 수급 원본 수치와 날짜 후보, 뉴스 **기존 전략이 사용하는 첫 10개**의 기사 ID·매체 ID·시각 필드. 원문 기사 본문·URL·인증 데이터·임의 문자열은 저장하지 않는다.
- 유효 필드라도 객체/허용 형식 밖의 문자열은 값 없이 `REJECTED_VALUE`로 남긴다. 전체 HTTP 응답/헤더/오류 객체를 복사하지 않는다.
- 의미 해석은 별도 `evidenceFacts`: 요청으로 확인한 KIS 시장/수정주가와 응답 원본을 분리. Naver 시각 의미·시간대(명시 offset이 없을 때)·시장·확정 여부는 추정하지 않는다.
- 요청과 응답 종목 충돌, 같은 관찰의 KIS 요청 시장 충돌은 `EVIDENCE_*_MISMATCH`로 보류. 요청 J를 Naver로 전파하지 않는다.
- 잘못된 응답 때문에 조회가 중단되어도 그때까지 모은 안전한 근거와 실패 상태만 보존한다. 자동 재시도 없음.

## 필수 입력별 확인 결과

① 제공/수신된 필드의 변환·저장 누락, ② 제공 여부/의미 미확인, ③ API 미제공 확인, ④ 정책 미정.
**③으로 확정할 항목은 없다.** 이전 기록에 없거나 공식 예제에 열거되지 않았다는 이유로 미제공을 단정하지 않는다.

| 입력·전략에서 필요한 이유 | 기존 시점/기간 기준 | 요청/응답 근거 | 제공 근거·현재 부족 이유 |
| --- | --- | --- | --- |
| 일봉 OHLC: MA/RSI/MACD/ATR·지지저항·패턴 | 계산 lookback은 기존 chartAnalysis 유지. 거래일/완성 세션 검증 계약 없음 | KIS FID_INPUT_ISCD, DATE_1/2, PERIOD=D, MRKT=J, ORG_ADJ_PRC=0; output1.stck_shrn_iscd; output2[].stck_bsop_date/stck_oprc/hgpr/lwpr/clpr | KIS 공식 예제/필드 매핑 확인. ① 요청과 output1은 버렸고 OHLC rows는 지표로만 저장. ② 당일 완성·세션 범위는 미확인. ④ 평가 시점 미정 |
| 거래량: 최신 일봉 거래량 / 이전 20개 일봉 평균, 기존 1.5·0.7 기준 | 20개 이전 행 평균만 정의됨. 시간 유효기간 아님 | output2[].acml_vol, stck_bsop_date | KIS 공식 필드 확인. ① 원본 행·단위 근거와 연결이 빠짐. ② 최신 일봉 완성 여부, ④ 어느 시점의 거래량을 평가할지 미정 |
| 현재가: 기술조건·진입 구간·위험보상 계산 | 기존 진입 허용폭 1.5% 등 가격 조건은 존재. 허용 지연·장마감/장중 계약 없음 | Naver /basic: closePrice \|\| nowPrice, localTradedAt; 필요 시 /price | 기존 reader가 이 필드를 읽음. 이전 저장 수치/정규화 시각만 존재. ① 원본 필드 선택·시각 원문 누락. ② 체결/제공자 갱신 의미, 시장, 수정 여부의 공식 근거 미확인. ④ 허용 지연 미정 |
| 외국인·기관 수급: 순매수 조건 | 날짜가 모두 있으면 가장 큰 날짜, 아니면 첫 행. 유효기간·잠정치 허용 기준 없음 | /integration dealTrendInfos[].foreignerPureBuyQuant, organPureBuyQuant, localTradedAt/tradeDate/bizdate/date/localDate | 기존 코드가 이 형태를 소비함. ① 원본 수치/날짜 경로 누락. ② SHARES는 기존 코드 규약이며 공식 단위·시장·세션·잠정/확정 의미 미확인. ④ 허용 집계 구간 미정 |
| 뉴스: 주의 키워드가 있으면 후보 제외 | 공급자 순서 첫 10개 title+summary 키워드 검사. **발행 시각 정렬/유효기간 없음** | /news/stock: items 또는 group[].items의 articleId/id/officeId, datetime/createdAt/date | 기존 reader가 날짜/ID를 반환하지만 observer는 hasCautionSignal만 저장: ① 코드 경로상 누락. 원본 미보존으로 과거 실제 제공 필드는 확정 불가. ② 발행/수정 시각 의미·시간대·조회 완전성 미확인. ④ 뉴스 창 미정 |

KIS 캐시 TTL은 전송/캐시 설정일 뿐 전략 최신성 유효기간이 아니다. Naver 필드의 기존 코드·합성 응답 통과는 공식 제공 계약이나 실제 응답 제공의 증거가 아니다.

## 공식 근거와 적용 조건

2026-09-24 확인: [KIS 공식 일봉 함수](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py)는 J=KRX / NX=NXT / UN=통합, D=일봉, 0=수정주가 / 1=원주가를 설명한다. 이 해석은 **저장된 해당 API의 요청값**에만 적용한다. 과거 기록이나 다른 제공처에 소급하지 않는다.
[공식 출력 필드 매핑](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/chk_inquire_daily_itemchartprice.py)에서 단축 종목코드·영업일·OHLC·누적 거래량을 확인했다. 코드 열거는 실제 요청의 필드 존재 보장이나 완성 일봉 보장은 아니다.
Naver 사용 경로에 대한 동등한 공식 응답/시각 의미 계약은 이번 자료에서 확인하지 못했다.
KRX 날짜별 휴장·세션의 공식 적용 기간은 계속 미확인이다. 근거 없는 달력을 추가하지 않았다.

## 사용자 결정 사항 — 초안 하나, 미적용

**제안: 우선 장마감 관찰용 입력 계약을 별도로 승인하고, 장중 실시간 판단은 계속 보류한다.**

- 평가 기준은 공식 캘린더로 확인한 최근 KRX 정규장 종료 시점. 프로그램 수신 시각과 분리한다.
- 해당 세션의 완성 일봉/거래량, 같은 시장·수정 기준의 종가, 같은 거래일의 확정 수급을 요구한다. 수급 확정 근거를 얻지 못하면 보류한다.
- 뉴스 창은 직전 정규장 종료 후부터 평가 기준 세션 종료까지 발행된 기사로 한정하는 안을 검토한다. 발행 의미/시간대/해당 구간 조회 완전성을 확인하지 못하면 보류한다.
- 영향: 장중 신호와 휴장 중 새로운 뉴스는 이 장마감 결과에 포함되지 않는다. 기존 종합 전략을 장마감 전략으로 자동 변환하는 승인이 아니며, 승인 후 입력 의미와 뉴스 선택의 영향 검토가 필요하다. 기존 가격·거래량·수급·리스크 조건은 완화하지 않는다.

평가 목적/시점, 뉴스 창, 확정 수급 요구, 시장·가격 수정 기준을 **위 한 묶음으로 결정**해야 한다. 코드에는 이 초안의 시간 창/종가 대체/뉴스 필터를 적용하지 않았다. 모든 관련 미정 사유와 riskReady=false, ledgerInputReady=false 유지.

## 다음 실제 조회로 확인할 수 있는 범위

새 승인이 있을 때 기존 요청 상한 안에서만, 실제 응답 필드 존재·값·단위 표기 유무·시각 원문·기사 ID·종목 일치와 KIS 요청 시장/수정 구분을 새 기록으로 확보할 수 있다. 시장·잠정 여부·시간대 필드가 실제로 오지 않으면 그 조회에서 없었다고만 기록한다.
새 조회로 뉴스 유효기간·전략 평가 목적·확정 수급 허용 정책을 결정할 수 없다. KRX 캘린더와 Naver 필드 의미는 공식 자료/공급자 확인이 별도로 필요하다. **먼저 미정 전략·최신성 기준 결정**, 그다음 필요한 근거를 좁혀 추가 조회 승인 순서다.

## 검증

`node tests/observation-provider-integration.test.cjs`: 기존 조회 함수/동일 budget/허용 필드/평가/파일 저장/재읽기/동일 정책 재검증. 정상 데이터는 기존 reader 소비 형태와 KIS 공식 예제의 shape를 사용한 합성 데이터다. 종목/시장 충돌·비밀 문자열 주입은 별도 오류 주입으로 표기한다.
`node tests/observation-freshness.test.cjs`: V1 호환, 캘린더·시점·누락 판정.
`node tests/observation.test.cjs`: 기존 관찰·공개 차단 경로 회귀. 외부 통신 차단 helper를 사용하고 실 자격정보는 읽지 않는다.
