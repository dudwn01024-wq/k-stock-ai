# 공개 K-Stock AI npm Critical 진단 및 수정

기준 커밋: `4eff9be86dc0bde2bf5098c0b9941720335afaec`.
격리 브랜치: `fix/npm-critical-reproducible-install`.
원본 저장소의 사용자 변경을 보존했으며, 개인 자동매매 저장소에는 접근하지 않았다.
초기 진단은 로컬에서만 수행했다. 이후 사용자가 이 3개 파일의 GitHub 반영 및 backend 배포를 승인했다.
이 문서는 배포 직전 검증 기록이다. 실제 commit·push·배포 결과와 LIVE SHA는 작업 완료 보고에서 확인한다.
frontend 배포, Render 환경변수·Auto Deploy·rewrite 변경은 승인 범위에 포함되지 않는다.

## 확인된 사실과 운영 확인의 한계

Render 로그에 알려진 사실은 `npm install`, 86개 audited packages, Critical 1건이다.
사용자가 Render Shell에서 `node -p "require('proxy-addr/package.json').version"`을 실행했고,
제공된 스크린샷을 상위 작업이 직접 확인한 결과 **운영 설치 버전 2.0.7**이 확인됐다.
이는 공식 영향 범위에 속하는 패키지의 운영 설치를 확인한 것이다.
전체 운영 설치 트리와 그 시점의 npm audit JSON은 확보하지 않았으므로,
원래 로그의 Critical 1건과 동일한 advisory인지 및 실제 악용 여부는 별도 확인 사항이다.

루트에는 npm lockfile이 없었다. 동일 manifest를 깨끗한 디렉터리에서 설치한 결과:
Express 4.22.3, cors 2.8.6, dotenv 16.6.1, pg 8.23.0,
proxy-addr 2.0.8이 선택됐으며 npm audit 결과는 **0건**이었다.
로컬 검증은 기존 설치된 **Node 24.21.0 / npm 11.19.0 / Windows**를 사용했다.
Render의 **Node 24.14.1 / Linux**와 npm 버전·캐시·기존 node_modules 상태는 재현하지 못했다.
패키지 수가 같다는 사실만으로 같은 설치 트리라고 볼 수 없다.

## 확인된 취약 버전과 보안 재현

의존 경로는 `k-stock-ai-backend → express@4.22.3 → proxy-addr`이다.
Express가 선언하는 범위는 `~2.0.7`로, 취약 2.0.7과 수정 2.0.8 모두 허용한다.

[유지관리자 공식 공지 GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
및 [공식 2.0.8 릴리스](https://github.com/jshttp/proxy-addr/releases/tag/v2.0.8)에 따르면
**CVE-2026-90711**, CVSS 9.1, Critical이며 영향 버전은 `>=1.1.0 <2.0.8`, 수정 버전은 **2.0.8**이다.
잘못된 IPv4-mapped IPv6 신뢰 서브넷(예: `::ffff:10.0.0.0/8`) 또는 영 비트로 시작하는 IPv6 서브넷을
설정하면 IPv4 클라이언트까지 신뢰할 수 있다. 공격자는 X-Forwarded-For로 req.ip/req.ips를 위조하여
IP 기반 접근 제한·rate limit·감사 로그를 우회할 수 있다.

별도 가설 디렉터리에서 **proxy-addr만 2.0.7로 지정**했다. 이는 운영 설치 사본이 아니다.
그 설치의 npm audit JSON은 Critical 1건, advisory GHSA-jqcg-44mw-7w3h,
`fixAvailable: true`를 반환했다. 다른 심각도는 모두 0건이었다.
네트워크를 사용하지 않는 fixture에서 위 신뢰 설정은 외부 IPv4 주소를 신뢰하여
위조 주소를 반환했고, 2.0.8은 실제 socket peer 주소를 유지했다.
이 재현은 Render 경고와 일치하며 운영에도 2.0.7이 설치돼 있다.
운영에서 2.0.7이 선택된 정확한 캐시·설치 이력과 원래 audit JSON의 동일성은 미확정이다.

현재 server.js에서 `trust proxy` 설정 또는 req.ip/req.ips 기반 정책은 발견하지 않았다.
기존 로컬 전용 기능은 socket peer를 사용하거나 forwarding header를 거부한다.
현재 소스로 위 악용 조건이 충족됐다고 확인되지 않았으며, 이 취약점은 VTS 인증 문제와 별개다.

## 최소 변경

- `package-lock.json`: 새 npm v3 lockfile. 깨끗한 npm 설치의 감사 0건 트리를 고정하고 proxy-addr 2.0.8을 포함한다.
- `tests/proxy-trust-security.test.cjs`: 취약 서브넷 2종, 정상 IPv4/IPv6 신뢰 동작, Express 기본 정책 등 순수 fixture 테스트 5개.
- 이 문서: 증거, 재현성, 운영 확인 한계와 롤백 절차.

package.json, pnpm-lock.yaml, server.js, services, frontend, 계산·판정·주문·API 정책은 변경하지 않았다.
전체 업그레이드, npm audit fix --force, overrides 추가는 수행하지 않았다.

Render의 명시된 설치 명령은 npm이므로 루트 **npm lockfile을 해당 배포의 기준**으로 취급한다.
기존 pnpm lock은 운영 npm 설치 증거가 아니다. 두 lock의 proxy-addr는 모두 2.0.8이며,
새 npm lock의 pg-cloudflare / pg-connection-string / pg-protocol은 각각
1.4.1 / 2.14.1 / 1.16.1로 기존 pnpm의 1.4.0 / 2.14.0 / 1.16.0과 다르다.
이는 새 npm 해석 결과이며 운영 버전의 변경 전후 비교는 아니다.
앞으로 루트 npm 의존성 변경은 npm lock과 감사 결과를 함께 검토해야 한다.
frontend는 기존 별도 npm lock을 그대로 사용한다.

[npm 공식 문서](https://docs.npmjs.com/cli/v11/commands/npm-ci/)에 따라
검증·향후 재현 설치에는 `npm ci --ignore-scripts`를 사용할 수 있다.
현재 루트 고정 트리에는 install script가 없다.
현재 Render의 `npm install`도 새 lock을 소비한다는 것은 로컬 캐시 전환 테스트로 확인했다.
Render build 명령 변경은 별도 승인 후 고려할 사항이며 이번에는 변경하지 않았다.

## 감사 및 검증 결과

| 대상 | Critical | 전체 취약점 | 해석 |
| --- | ---: | ---: | --- |
| 알려진 Render 설치 로그 | 1 | 1 | 운영 proxy-addr 2.0.7 확인, 원래 audit JSON 미확보 |
| 수정 전 manifest의 깨끗한 npm 설치 | 0 | 0 | 현재 registry 해석 결과 |
| 2.0.7로 지정한 가설 설치 | 1 | 1 | 취약점 재현, 운영 결과 아님 |
| 새 lock의 npm ci 설치 | 0 | 0 | 로컬 고정 트리 |
| 취약 캐시 사본에 새 lock 적용 후 npm install | 0 | 0 | added 1 / removed 1 / audited 86 |

- 모든 npm 설치는 lifecycle scripts를 비활성화하고 사용자/global npm 설정·인증 환경을 제외했다.
- npm ci 및 기존 npm install 방식의 캐시 전환 성공. 두 경우 lock JSON 정규화 SHA-256은
  `8cbc4158971009b77cd31c983241be2b9bc2356342819dde990dcaa124c3f6ec`로 동일하다.
- 새 보안 테스트는 2.0.7 가설 설치에서 2개 실패 / 3개 통과, 수정 설치에서 5개 모두 통과했다.
- 첫 전체 테스트: 2,026개 중 2,013개 통과 / 13개 실패.
  6개는 빌드와 테스트 실행 시점이 겹쳐 산출물이 없었던 준비 문제,
  7개는 보수적인 preload가 mock factory 모듈 import도 차단한 테스트 준비 문제였다.
- 빌드 완료 후 관련 40개 테스트 모두 통과. 검토한 mock factory import를 허용하면서
  외부 통신·dotenv·실제 DB·비밀파일 차단을 유지한 별도 7개 suite에서 374개 모두 통과.
  최초 실패 13개는 이 재검증으로 모두 해소됐다.
- Git 반영·backend 배포 승인 후, build가 완료된 상태에서 검토된 mock factory import를 허용하는
  차단 환경으로 최종 전체 suite를 한 번 실행했다. **2,393개 모두 통과**, 실패·skip·cancelled 0건,
  종료 코드 0이었다. 외부 통신·비밀파일·dotenv·실제 DB 차단은 유지했다.
- frontend 기존 lock의 npm ci 성공, Vite production build 성공(2,312 modules).
  500 kB 이상 chunk 경고는 남으며 이번 의존성 고정 범위에서 변경하지 않았다.
- server.js 및 새 테스트 구문 검사, git diff whitespace 검사 통과.
- 실제 금융·뉴스·Gemini·KIS·계좌·주문·PAPER·expanded POST·collector API는 호출하지 않았다.
  테스트는 mock 또는 localhost fixture이며 외부 socket/fetch와 비밀파일 읽기를 차단했다.

원시 감사 JSON, 실행 stdout/stderr, metadata, 동작 비교는 격리 저장소 옆
`../npm-security-evidence/`에 저장했다. `baseline-audit.stdout`, `scenario-audit.stdout`,
`fixed-audit.stdout`, `cached-transition-install.stdout`, `proxy-behavior-before-after.json`,
`regression-tests.stdout`, `mock-factories-retest.stdout`, `build-dependent-retest.stdout`,
`frontend-build.stdout`, `final-full-regression.stdout`이 핵심 증거다.

## 배포 및 롤백

운영 취약 버전의 존재는 사용자 제공 Shell 결과로 확인됐다.
사용자가 승인한 순서는 이 3개 파일의 commit·작업 브랜치 push·안전한 main 반영 및
backend `srv-dajs02p42hec73fn02h0` 배포다. frontend는 배포하지 않는다.
배포 후에는 정확한 LIVE SHA, 설치 로그의 취약점 개수, 가능한 비밀정보 없는 설치 버전 확인이 필요하다.
전체 운영 audit JSON과 실제 악용 여부는 패키지 버전 확인과 구분한다.

로컬 롤백은 새로 추가한 위 3개 파일만 제거하면 된다. 원본 저장소는 변경되지 않았다.
향후 운영 롤백은 마지막 정상 배포 SHA `4eff9be86dc0bde2bf5098c0b9941720335afaec`로 되돌릴 수 있으나,
해당 SHA에는 npm lock이 없어 같은 설치 트리를 보장하지 않으며 기존 Critical 경고가 재발할 수 있다.
따라서 가능하면 앱 코드만 되돌리고 검증된 patched lock은 유지하는 롤백을 먼저 검토한다.
