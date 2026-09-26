# 삼성전자 장마감 보고서: 자료·조회 범위 확정

확인일: 2026-09-24. 정책 `KRX_EOD_OBSERVATION v1.0.0` 유지. **실제 조회 승인이나 실행 명령이 아니다.**
현 브랜치 `codex/paper-execution-boundary`, HEAD `844dc645a6bb9f7288549820e01c8b8d265b52c5` 및 기존 미커밋 변경을 보존했다.

## 결과 의미

현재 화면은 ‘개별 조건 — 전체 전략 통과가 아닙니다’와 현재가 전용 기술/진입 조건의 미평가 이유를 함께 표시한다. 이미 구분돼 있어 화면을 다시 수정하지 않았다.
거래량·수급·뉴스만 평가된 보고서의 의미는 **분석 일부 완료**이며 기술 조건·전체 전략·거래 허가는 미평가/보류다. 기존 HELD, riskReady=false, ledgerInputReady=false를 유지한다.

## 거래일 근거: 확인한 휴장과 미확인 개장을 구분

| 근거 ID | 공식 출처·적용 규칙 | 확인 범위 |
| --- | --- | --- |
| KASI_2026 | [2026년 월력요항, 2025-06-30 발표](https://www.kasi.re.kr/kor/post/newsMaterial/32031): 추석 9/25, 추석 연휴 9/24~26, 이어지는 일요일 9/27 | 2026년의 해당 공휴일 날짜 |
| KRX_KOSPI_HOLIDAY | [KOSPI 거래 절차·Holiday Rules](https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp): 정부 규정 공휴일·토요일 휴장, 거래소가 지정하는 특별 휴장도 존재 | KRX KOSPI 시장 휴장 규칙 |
| KRX_REGULAR_HOURS | 같은 공식 문서 Trading Hours: 정규장 09:00~15:30, 정규장 이외 거래 구간도 별도 표시 | 일반 시간 규칙. 개별 날짜의 특별 세션 확인을 대체하지 않음 |

**두 공식 근거를 결합한 판단:** KRX KOSPI의 2026-09-24~27은 CLOSED로 문서상 확인한다. 날짜별 단독 공지가 없어도 이 근거는 유효하다. 이번 연결의 범위는 해당 4일이며 연간 개장일 배열을 만들지 않는다.
9/22·9/23이 공휴일이 아니라는 사실만으로 OPEN/마감 시각을 확정하지 않는다. 해당 날짜의 특별 휴장·세션 변경 적용 여부는 별도 확인 대상이다. 공식 공지 검색에서 보이는 9/23 **파생상품 야간** 휴장 제목을 주식 정규장 근거로 쓰지 않았다.
휴장 근거는 일봉 완성·수급 확정 근거가 아니다. 기존 런타임의 완전한 세션 캘린더는 여전히 미완성이다. **부분 휴장 근거 확보와 전체 세션 캘린더 준비 완료는 다르다.**
`tests/helpers/observation-eod-fixtures.cjs`의 9/25 OPEN은 명시된 `SYNTHETIC TEST DATA`다. 실제 9/25는 위 공식 규칙상 휴장이다. 테스트 일정과 실 캘린더를 섞거나 운영 캘린더를 바꾸지 않았다.

## 일봉 수: 코드에서 산출

근거: `services/chartAnalysis.js`의 `analyzeMovingAverages` 및 각 계산 함수, `services/observationMarketData.js`의 `maxBars:130`/`slice(-21,-1)`.

| 계산 | 대상일 포함 필요한 유효 일봉 | 의미 |
| --- | --- | --- |
| MA5/20/60/120 | 각각 5/20/60/120 | 종가 단순평균. MA120은 차트 엔진 산출물이며 현재 관찰의 cleanInput/종합 전략은 MA60까지 직접 소비 |
| RSI14 / ATR14 | 각각 최소 15 | 전일 대비 변화/TR 필요. 초기화 이후 전체 제공 구간을 순차 반영 |
| MACD(12,26,9) | 최소 34 (=26+9-1) | EMA 초기값에 입력 이력이 영향을 줌 |
| Bollinger(20) | 20 | 대상일 포함 종가 |
| 캔들 | 단일봉 1, 장악형 2 | OHLC·유효 range 필요 |
| 지지저항 / 차트 패턴 | 실행 최소 5 / 20, 각각 최근 80봉 검색 | 피벗 양쪽 2봉. 충분한 개수라도 패턴/지지저항 존재를 보장하지 않음 |
| Elliott 후보 | 실행 최소 30, 최근 100봉 검색 + swing 6개 | 수량만 채워 탐지를 보장할 수 없음 |
| 거래량 비율 | 21 | 대상일 거래량 / **대상일 제외 이전 20봉 평균** |

정리: 모든 차트 산출물의 최소 길이는 **대상일 포함 120 유효봉**, 기존 관찰의 요청 목표는 그대로 **130봉**이다. 130봉은 계산 재현을 위한 기존 입력 창이며 정확도/수렴/전략 통과 보장이 아니다. EMA·Wilder 결과를 120봉과 130봉에서 같다고 가정하지 않는다.
KIS reader는 날짜 중복 제거 후 과거→최신 순서, 차트 정규화는 최신→과거 순서로 계산한다. 대상일 이후 봉은 사용하지 않으며, 누락·중복·잘못된 OHLCV와 실제 거래일 연속성은 별도 점검 대상이다.

### 공식 API 의미와 남은 설명

[KIS 공식 기간별시세 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py):
`GET /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`, TR `FHKST03010100`.
`FID_COND_MRKT_DIV_CODE=J`는 KRX, `D`는 일봉, `FID_ORG_ADJ_PRC=0`은 수정주가(1은 원주가), 1회 최대 100건이다. 기존 요청의 0을 유지하며 원주가와 섞지 않는다.
[공식 출력 매핑](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/chk_inquire_daily_itemchartprice.py)에서 영업일·OHLC·누적 거래량 필드를 확인했다.
이 예제/매핑에는 **각 OHLC와 acml_vol의 정규장·시간외·애프터마켓 포함 범위, 최종 확정 시각/플래그, 사후 정정 기준**을 확정할 설명이 없다. `J`로 거래소는 지정되지만 정규장만이라는 뜻은 아니다. 정규장 15:30 종료나 응답 성공만으로 완성 봉으로 승격하지 않는다.
기존 `latestSourceIntegrity.complete`는 숫자/날짜 유효성 검사이며 거래 세션 완성 플래그가 아니다.

## 수급·뉴스: 조회할 수 있는 값과 의미 계약

| 항목 | 현재 코드·공식 자료에서 확인한 내용 | 남은 설명/다음 조회의 한계 |
| --- | --- | --- |
| Naver 수급 | `services/naverMarketData.js`: `/api/stock/005930/integration`의 `dealTrendInfos[]`, `foreignerPureBuyQuant`, `organPureBuyQuant`; 날짜 후보 `localTradedAt/tradeDate/bizdate/date/localDate`. 모든 날짜가 있으면 최신 행, 아니면 첫 행 사용 | `/integration`에는 현재 요청상 시장·대상일 파라미터가 없다. 기존 코드의 SHARES 지정은 공식 단위 증거가 아님. KRX/NXT/통합, 주/천주, 잠정/확정, 정정 시점의 필드 계약 미확인. 반환된 대상일 행 존재는 확인 가능하지만 원하는 과거 날짜 조회·확정치를 보장하지 못함 |
| KIS 대안(문서 비교만) | [공식 종목별 투자자매매동향(일별)](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/investor_trade_by_stock_daily.py): `/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily`, TR `FHPTJ04160001`, `FID_COND_MRKT_DIV_CODE=J`, `FID_INPUT_ISCD=005930`, `FID_INPUT_DATE_1=20260923`, `FID_ORG_ADJ_PRC=''`, `FID_ETC_CLS_CODE=''` | [공식 필드 매핑](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/chk_investor_trade_by_stock_daily.py)의 `stck_bsop_date`, `frgn_ntby_qty`, `orgn_ntby_qty`, `rprs_mrkt_kor_name`을 확인. 수량/대금은 분리되지만 수량 배율·포함 세션·최종 확정 시점 보장은 미확인. `bold_yn`을 확정 플래그로 해석하지 않음. 새 경로는 현 허용목록 밖이므로 **호출 계획 0회**, 구현하지 않음 |
| Naver 뉴스 | `/api/news/stock/005930?pageSize=10&page=1` 한 번. 기존 reader는 `items` 또는 묶음의 `items`를 읽고 `datetime/createdAt/date` 중 있는 값을 사용. 기존 키워드 평가는 첫 10개 title+summary를 사용 | 날짜 범위 지정·이전 페이지 조회가 없으므로 승인 구간 전체 수집을 보장할 수 없다. 기사별 발행 vs 갱신 의미·시간대·정렬·수집 완전성 미확인. 새 조회는 원본 시각/ID를 보존할 뿐 이 의미를 스스로 증명하지 못함 |

검토한 Naver 공식 공개 자료: [증시 도움말](https://help.pay.naver.com/faq/list.help?categoryId=11173), [차트 도움말](https://help.pay.naver.com/faq/list.help?categoryId=11175), [뉴스 검색 서비스 소개](https://help.naver.com/service/5603/contents/19109?lang=ko&osType=COMMONOS).
증시 도움말에서 뉴스/공시 노출 기준 항목 존재는 확인했지만 공개 추출 내용으로 위 JSON 필드 계약을 확보하지 못했다. 뉴스 검색 서비스 설명은 현재 사용하는 증권 뉴스 경로의 계약이 아니므로 대체 근거로 쓰지 않는다. 비공식 블로그의 ‘다음날 확정’ 같은 주장은 채택하지 않았다.
뉴스 근거 보존은 ID/시각만 허용하고 기사별 키워드 평가와 원문의 연결은 현재 저장하지 않는다. 따라서 **새 조회만으로 구간별 뉴스 평가 재현까지 완성되지는 않는다**. 의미·범위가 확인된 후 별도 최소 연결 범위를 검토해야 하며 이번에 저장 방식이나 전략을 바꾸지 않았다.

## 제공처에 한 번에 확인할 질문

1. **KRX 일정:** 2026-09-22·23 KOSPI 정규장의 특별 휴장/시간 변경 적용 여부를 확인할 공식 일정 또는 공지는 무엇인가? 일반 마감 15:30을 해당 날짜에 적용 가능한가?
2. **KIS 일봉:** `J/D/ORG_ADJ=0`의 OHLC와 `acml_vol`은 각각 어떤 세션을 포함하며, 정규장 종가와 최종 일봉을 어떻게 구분하는가? 완료/정정 시각·플래그는 무엇인가? 수정주가 기준일과 거래량 조정 여부는 무엇인가?
3. **Naver 수급 / KIS 대안:** 지정한 수급 필드의 시장·세션·단위/배율·기관 분류 범위는 무엇인가? 잠정/확정 구분 필드와 확정 시각, 이후 정정 규칙은 무엇인가? 해당 날짜 행을 선택하는 공식 방법은 무엇인가?
4. **Naver 뉴스:** `datetime/createdAt/date`는 최초 발행 또는 갱신 중 무엇이며 시간대는 무엇인가? 해당 종목의 과거 구간 조회·정렬·누락/중복·전체 수집 확인을 공식적으로 지원하는가? 첫 페이지 10건만으로 구간 완전성을 확인할 수 있는가?

문의 발송은 하지 않았다. 답변을 대신해 시각/단위/확정을 추정하거나 신규 API를 연결하지 않는다.

## 최소 실제 조회 계획(별도 승인 전 실행 금지)

종목 **삼성전자 005930**, 자료 대상 **2026-09-23** 고정. 이는 과거 저장 자료와 맞춘 보고 대상이며 개장/완성 확인을 뜻하지 않는다.
뉴스 구간은 직전 거래일 확인 후 확정한다. 9/22·23의 정규 세션이 확인되면 **9/22 15:30 초과~9/23 15:30 이하 KST**다. 9/24 이후 기사는 별도 참고이며 목표 구간을 바꾸지 않는다.

| 요청(모두 순차, 재시도/리다이렉트 없음) | 파라미터·보존 필드 | 상한 |
| --- | --- | --- |
| KIS 기간별 일봉 | 위 경로, `J/005930/D/0`, `FID_INPUT_DATE_1=20240923`, 첫 `DATE_2=20260923`. 두 번째는 첫 응답 최저 영업일의 직전 달력 날짜를 종료일로 사용(거래일 추산 아님). 대상일 포함 최신 130 유효봉 목표. `output1.stck_shrn_iscd`, `output2[].stck_bsop_date/stck_oprc/stck_hgpr/stck_lwpr/stck_clpr/acml_vol`, 수정 관련 `mod_yn/flng_cls_code/prtt_rate`, 요청 연결 ID/수신 시각 | 2회. 부족하면 추가 요청하지 않음 |
| Naver 기존 조회 묶음 | `/basic` → 필요한 경우 `/price?pageSize=1&page=1`, `/api/realtime?query=SERVICE_ITEM:005930` → `/integration`. 현재가 필드 `closePrice/nowPrice`는 장마감 종가 대체 금지. 대상일 수급 행/수량/시각 후보는 위 표대로 보존 | 시세·수급 합계 4회. 정상 `/basic`+`/integration`이면 2회만 |
| Naver 기존 뉴스 | 위 `pageSize=10&page=1`; `articleId/id/officeId`, `datetime/createdAt/date` 원문과 수신 시각. 구간 불충분/의미 미확인은 보류 | 1회. 본문·추가 페이지 0회 |
| KIS 인증 | 기존 LIVE 일치 토큰 재사용, 필요한 경우 `/oauth2/tokenP` | 0~1회, 인증 응답 저장 금지 |
| KIS 수급 대안 | 문서 비교에만 사용 | **0회** |

정상 기존 묶음은 일봉2+Naver2+뉴스1=데이터5회, 기존 절대 상한은 데이터7+인증1이다. 한도 소진이 목표가 아니며 오류 시 중단한다.
**대상일 연결 후속 수정 (2026-09-25, 외부 조회 없음):** API → 서비스 → 관찰 provider → `fetchKisDailyOHLCV`에 필수 대상일이 연결됐다. 관찰 전용 `observationTargetDate`와 `endDate`가 일치해야 하며 최대 2회 내에서 수집한다. OBSERVATION_V2의 `dailySelection`은 요청 범위·반환 개수·중복/제외 사유·계산 행을 원본 `evidence`와 분리해 저장한다. 과거 기록은 변경하지 않는다. 세션·완성·수급 확정·뉴스 의미 문제와 별도 실제 조회 승인 필요는 그대로다.
일회 실행 표식도 이미 소비된 상태이므로 이전 승인/표식을 삭제·재사용하지 않는다. 새 실행 승인 이후에만 별도의 안전한 실행 범위를 정해야 한다.

## 기존 자료·변경 검증

원본 `3b7d655e-bcb7-44d7-b1d3-57776fa6b333`의 V1/005930/일봉 기준일 9/23·수신 시점 9/24 21:17:40.364 KST를 재확인했다. 원본 OHLCV·요청 응답 근거·기사별 시각은 없다. 원본 해시 불변을 확인했고 수치나 과거 근거를 새로 채우지 않았다.
이번에는 문서만 변경한다. 실행 코드·화면·실제 기록·테스트 가상 캘린더 불변. 코드 테스트/빌드/캡처를 반복하지 않는다. 공식 문서 열람 이외 프로그램 외부 요청·인증·계좌·주문·PAPER·DB·Render 작업 0회, commit/push/merge/배포 없음.
