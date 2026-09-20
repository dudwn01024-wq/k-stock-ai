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
체결이 없으면 최대 15분 후 미검증(`NO`)으로 종료합니다. 다른 인자 조합은
연결하지 않습니다. 환경변수로 live 모드를 활성화할 수 없습니다.

## 수집 코어의 범위

- 기존 `createRealtimeService`와 `parseTrades`를 재사용합니다.
- 종목은 삼성전자 005930, SK하이닉스 000660으로 고정합니다.
- 관찰 최대 15분, 종목별 출력 샘플은 최대 5개입니다. 요약은 전체 수신을
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
