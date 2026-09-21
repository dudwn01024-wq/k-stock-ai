# KIS 실시간 거래량 읽기 전용 검증 도구

프로젝트 루트에서 Node.js 20.6 이상과 설치된 기존 의존성을 사용합니다.

```powershell
node --env-file=.env scripts/verify-kis-realtime-volume.cjs
```

`.env`를 읽기만 하며 결과 파일을 만들지 않습니다. 인증값, 원본 프레임,
오류 원문을 출력하지 않습니다. 다른 실행 중인 KIS 클라이언트와의 계정
구독 한도 공유 여부는 이 도구가 확인할 수 없습니다.

## 명시적 읽기 전용 실측 실행

기본 명령은 `SAFE_MODE`로 종료하며 인증 요청과 WebSocket 연결을 하지 않습니다.
실측하려는 경우에만 정확히 `--live` 인자를 추가합니다.

```powershell
node --env-file=.env scripts/verify-kis-realtime-volume.cjs --live
```

`--live`는 읽기 전용 연결 허용이며 정규장 판정이 아닙니다. 특별장·휴장일을
추측하지 않고 연결 성공, 종목별 구독 ACK, 실제 체결, 날짜·시간을 관찰합니다.
체결이 없으면 최대 3분 후 미검증(`NO`)으로 종료합니다. 다른 인자 조합은
연결하지 않습니다. 환경변수로 live 모드를 활성화할 수 없습니다.

## 수집 코어의 범위

- 기존 `createRealtimeService`와 `parseTrades`를 재사용합니다.
- 종목은 삼성전자 005930, SK하이닉스 000660으로 고정합니다.
- 관찰 최대 3분, 종목별 출력 샘플은 최대 5개입니다. 요약은 전체 수신을
  집계하며 모든 원본 메시지를 메모리에 저장하지 않습니다.
- SIGINT/Ctrl+C, SIGTERM, 시간 만료, 오류 시 서비스와
  타이머·리스너를 정리합니다.
- 제공 RATE와 직접 계산값의 차이를 배수·백분율 가설별로 보고합니다.
  0.011의 비교 허용차는 진단 가설용이며 KIS 반올림 규칙의 검증 결과가
  아닙니다. `receivedAt` 지연에는 서버 시계 오차도 포함될 수 있습니다.
- 날짜·숫자가 맞는 것만으로 전일 데이터의 의미나 세션·신선도 기준이
  검증되지는 않습니다. 따라서 현재 충분 여부는 항상 `NO`이며 공식 의미와
  실측 결과 검토가 별도로 필요합니다. 재연결 여부는 실제 socket 생성 횟수로
  기록하며 재연결을 고의로 유도하지 않습니다.
- 두 종목 모두 날짜·시간·거래량·분모·RATE 관계가 유효한 연속 5개 샘플을
  확보하고 누적량 역행이 없으면 `SAMPLES_COLLECTED`로 조기 종료합니다.
  `numericalAnalysisReady:true`는 수치 분석 가능 의미이며 production 활성화나
  B 전략 전체 검증 완료를 뜻하지 않습니다. 세션 의미는 `UNKNOWN`입니다.
- production 평가, `validated:false`, 기존 임계값, 서버 API를 변경하지
  않으며 주문·계좌 API를 사용하지 않습니다.

오프라인 테스트:

```powershell
node --test tests/verify-kis-realtime-volume.test.cjs
```

## 수신 / 파싱 진단

종료 요약은 totalFrames, jsonControlFrames, pingpongFrames, subscribeAckFrames,
realtimeDataFrames, realtimeTradeFrames, unknownFrames, parseSuccess, parseFailure를 분리합니다.
parseSuccess/parseFailure는 H0STCNT0 프레임 단위이며 sampleCount는 대상 종목 레코드 수입니다.
제어/데이터 분류와 하위 분류 카운터는 서로 겹치므로 모두 더하면 totalFrames가 되지 않습니다.
ACK는 체결 수신 성공을 뜻하지 않습니다. symbolTradeFrames는 payload 경계 가설에서
대상 종목이 관찰된 프레임 수이며, 파싱 실패 시 실제 레코드 경계가 맞는지는 미확정입니다.

실패 상세는 최대 5건의 프레임 종류·고정 TR ID·숫자 count/길이/필드 수·허용된 두 종목·
안전한 오류 코드만 포함합니다. 원문, 인증 헤더, 제어 메시지 본문, 임의 TR ID는 출력하지 않습니다.
원인 분류: A=H0STCNT0 미수신, B=H0STCNT0 수신/파싱 성공 없음,
C=파싱 성공/대상 샘플 없음, D=대상 샘플 있음. D도 production 검증 완료는 아닙니다.

공식 구조 대조 기준:
https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/ccnl_krx/ccnl_krx.py
0-based index: 종목 0, 체결시각 1, 누적량 13, 영업일 33, 전일동시간누적량 41,
전일동시간비율 42, 시간구분 43, 시장구분 44. 총 46필드입니다.

현재 파서는 공식 LEGACY_46과 관찰된 OBSERVED_47을 명시적으로 지원합니다.
전체 필드 수가 recordCount × 46 또는 × 47과 정확히 일치해야 합니다.
47형식의 마지막 index 46은 UNKNOWN_EXTRA_FIELD로만 보존하며 진단 출력이나
거래량·세션·validation 판정에는 사용하지 않습니다. 빈 index 44는 그대로 유지합니다.
45/48필드 등 미확인 형식은 FIELD_COUNT_MISMATCH로 거부합니다.
