# 스마트설비 (SmartSD)

소규모 배관 설비 업체를 위한 현장·정산 통합 관리 웹앱입니다.
**문의 접수 → 현장 확인 → 견적 → 고객 승인 → 작업 배정 → 자재 사용 → 완료 정산**을 하나의 흐름으로 잇고,
업체가 돈과 신뢰를 잃는 네 지점을 자동으로 찾아냅니다.

| 찾아내는 문제 | 예방 (입력 순간) | 탐지 (전체 재검사) |
|---|---|---|
| 추가 작업 승인 누락 | 승인 없는 추가 작업·초과 사용 자재가 있으면 작업 완료 불가 | 승인 없이 수행·자재 사용, 견적 초과 사용, 승인 지연, 구두 승인 |
| 자재 중복 예약 | 가용 재고·장비 대수를 넘는 예약 거부, 같은 자재 두 번 예약 거부 | 재고 초과 예약, 장비 시간대 이중 예약, 중복 줄, 끝난 작업 예약 |
| 작업팀 일정 충돌 | 같은 팀·공유 인원 겹치는 배정 거부 + 빈 팀 추천 | 팀·인원 이중 배정, 이동 시간 부족, 지난 일정 미처리 |
| 청구 누락 | 승인 항목을 청구서에서 빼려면 사유 필수 | 완료 후 미청구, 추가 작업 미청구, 청구액 부족, 미수금 연체 |

![오늘 화면](docs/screenshots/pc-01-오늘-대시보드.png)

## 공개 사이트

- 제출 페이지 (사업 기획서 · 화면 · 테스트 결과): **https://skdehr0413-cmd.github.io/smartsd/**
- 실제 작동 데모 (PC·휴대폰, 설치 없음): **https://skdehr0413-cmd.github.io/smartsd/demo/smartsd-demo.html**

GitHub Pages가 이 저장소의 `docs/` 폴더를 게시합니다(설정 → Pages → Deploy from a branch → `/docs`).
사이트는 `npm run build:site` 로 다시 만듭니다.

## 제출물

| 제출물 | 위치 |
|---|---|
| 사업 기획서 | [docs/business-plan.md](docs/business-plan.md) |
| 실제 작동하는 웹앱 (PC·모바일) | 이 저장소 (`npm start`) · 서버 없이 여는 단일 파일 데모 [docs/demo/smartsd-demo.html](docs/demo/smartsd-demo.html) |
| 화면 캡처 (PC 12장 · 휴대폰 11장) | [docs/screenshots/](docs/screenshots/README.md) |
| 테스트 결과 (66개 통과) | [docs/test-report.md](docs/test-report.md) · 원본 로그 [docs/test-results/](docs/test-results) |

## 실행

Node.js 20 이상이 필요합니다. 실행에는 외부 패키지가 필요 없습니다.

```bash
npm install          # 테스트·빌드 도구(Playwright, esbuild)만 설치
npm start            # http://localhost:3000  (데이터: data/smartsd.json)
npm run demo         # 메모리 저장 + 기준 시각 2026-09-29 10:30 고정 (캡처와 같은 화면)
```

처음 실행하면 가상 업체 "한결배관설비"의 데모 데이터(작업건 19건, 누락·충돌 사례 16건)가 오늘 날짜 기준으로 만들어집니다.
설정(더보기) 화면에서 언제든 초기화할 수 있습니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | 포트 |
| `DATA_FILE` | `data/smartsd.json` | 저장 파일, `:memory:` 이면 메모리 |
| `SMARTSD_NOW` | (현재 한국 시각) | 기준 시각 고정 (`2026-09-29T10:30`) |
| `SMARTSD_SEED` | `demo` | `empty` 이면 빈 데이터로 시작 |
| `SMARTSD_ALLOW_RESET` | `1` | `0` 이면 데모 초기화 API 차단 |

### 둘러보기 (데모 데이터)

1. **오늘** — "지금 놓치고 있는 돈"과 4대 위험 타일을 누르면 점검 화면으로 갑니다.
2. **J-0009 주방 수전 교체** — 고객 승인 없이 트랩을 교체한 사례. "작업 완료"가 막히고, 추가 작업 탭에서 현장 서명을 받으면 풀립니다.
3. **일정 → 9/30** — 1팀 이중 배정, 1팀·3팀에 모두 속한 대표의 중복 배정이 빨간 블록으로 보입니다.
4. **자재** — PVC 하수관(보유 7, 예약 10)과 고압 세척기(1대, 같은 시간 2곳) 중복 예약.
5. **정산 / J-0011** — 완료 4일째 청구서 미발행. 청구서 발행 화면에서 항목을 빼 보면 경고가 뜹니다.
6. **J-0004 → 현장·견적 → 승인 링크** — 고객이 받는 견적서 화면에서 서명해 승인할 수 있습니다.
7. 휴대폰 크기로 줄이면 하단 탭·카드 화면으로 바뀝니다. 설정에서 사용자를 "현장 2팀"으로 바꾸면 '오늘'에 그 팀 일정만 보입니다.

## 구조

```
src/core/        업무 엔진 — 서버와 브라우저가 같은 코드를 사용 (의존성 없음, ES 모듈)
  commands.js    업무 명령 33개 (단계별 가드, 트랜잭션, 이력)
  detectors.js   4대 누락·충돌 탐지 규칙 18개
  model.js       파생 값 계산 (가용 재고, 승인 수량, 청구 근거, 팀 일정)
  views.js       화면·API용 조회 (대시보드, 상세, 일정, 자재, 정산, 고객 공개 화면)
  engine.js      명령 실행(복사본에서 실행 → 성공 시 반영), 조회, 라우팅
  routes.js      REST 경로 ↔ 명령 매핑
  seed.js        데모 데이터 (실제 명령으로 생성)
src/server/      node:http 서버 — REST API, 정적 파일, JSON 파일 저장(원자적 쓰기), 보안 헤더
public/          반응형 SPA (빌드 없이 동작, 프레임워크 없음)
  js/views/      오늘, 작업건, 문의 접수, 작업 상세(7단계), 일정, 자재, 정산, 점검, 설정, 고객 승인
tests/           단위·API(node:test), E2E(Playwright, PC·휴대폰)
scripts/         화면 캡처, 단일 파일 데모 빌드
docs/            사업 기획서, 테스트 보고서, 화면 캡처, 단독 데모
```

- **한 엔진, 두 실행 환경:** 브라우저는 서버가 없으면 같은 엔진을 직접 돌리고 `localStorage` 에 저장합니다. 그래서 단일 HTML 파일 데모가 서버와 똑같이 동작합니다.
- **탐지는 저장값이 아닌 계산값:** 모든 점검 항목은 현재 데이터 전체에서 매번 다시 계산하므로, 강제 진행이나 데이터 이관이 있어도 빠지지 않습니다.
- **시간:** 모든 시각은 한국 현지 시각 문자열(`YYYY-MM-DDTHH:mm`)로 저장하고 계산해 서버·브라우저 시간대와 무관합니다.
- **금액:** 원 단위 정수, 부가세 10% 원 미만 절사.

### 주요 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/state`, `/api/dashboard`, `/api/findings`, `/api/jobs/:id`, `/api/schedule?from=&days=`, `/api/materials`, `/api/settlement?month=` | 조회 |
| POST | `/api/jobs` | 문의 접수 |
| POST | `/api/jobs/:id/survey`, `/survey/complete` | 현장 확인 예약·결과 |
| POST/PUT | `/api/jobs/:id/quotes`, `/api/quotes/:id`, `/api/quotes/:id/send` | 견적 작성·수정·발송 |
| POST | `/api/quotes/:id/approve`, `/reject` | 고객 승인 기록 |
| POST | `/api/jobs/:id/schedule`, `/reservations`, `/start`, `/usages` | 배정·예약·착수·자재 사용 |
| POST | `/api/jobs/:id/change-orders`, `/change-orders/from-excess`, `/api/change-orders/:id/{approve,reject,cancel,perform,waive}` | 추가 작업 |
| POST | `/api/jobs/:id/complete`, `/invoices`, `/api/invoices/:id/{payments,void}` | 완료·청구·수금 |
| POST | `/api/findings/ack` | 주의·참고 항목 확인 처리 |
| GET/POST | `/api/public/quotes/:token`, `/api/public/change-orders/:token` (+`/approve`, `/reject`) | 고객용 공개 링크 |

충돌·누락은 `409` 와 코드(`SCHEDULE_CONFLICT`, `INSUFFICIENT_STOCK`, `EQUIPMENT_BOOKED`, `DUPLICATE_RESERVATION`, `UNAPPROVED_CHANGE_ORDER`, `UNAPPROVED_EXCESS_USAGE`, `BILLING_OMISSION` 등)로 응답합니다.
강제로 진행하려면 `force: true` 와 `reason` 을 함께 보내야 하며, 그 사유는 이력과 점검 화면에 남습니다.
요청 헤더 `x-actor` 는 이력에 남을 사용자 이름입니다.

## 테스트

```bash
npm test               # 단위 39 + API 9
npm run test:coverage  # 커버리지 (업무 엔진 줄 98.4%)
npm run test:e2e       # Playwright E2E — PC 9 + 휴대폰 9
npm run screenshots    # docs/screenshots 다시 만들기
npm run build:standalone  # docs/demo/smartsd-demo.html 다시 만들기
```

## 알려진 한계

- 로그인·권한이 없습니다. 데모·파일럿 준비용이므로 인터넷에 그대로 공개하지 마세요.
- 저장소는 단일 JSON 파일입니다(소규모 단일 사업장 기준). 운영 단계에서는 PostgreSQL로 옮깁니다.
- 문자·알림톡 발송, 전자세금계산서, 결제 연동은 로드맵에 있습니다([사업 기획서 10장](docs/business-plan.md#10-로드맵)).
