# 차곡 — 개인용 중국어 시험 대비

`ch.baecha.xyz`를 위한 한국어 UI의 중국어 반복 학습 웹앱. HTML/CSS/vanilla ES modules + Cloudflare Workers Static Assets + D1입니다. 평소 학습에는 AI API, API key, 별도 서버, 로그인 계정이 필요하지 않습니다. 기본 dark mode이며 모바일·태블릿·Chromebook·데스크톱에 대응합니다.

## 1. 설치

Node.js 22 이상을 사용합니다.

```bash
npm install
cp .dev.vars.example .dev.vars
```

`postinstall`은 SheetJS 0.20.3을 `public/vendor`로 복사합니다. XLSX 화면에서만 지연 로드하며, 실행 중 외부 CDN 요청은 없습니다. `.npmrc`는 npm 12의 직접 지정 tarball 의존성을 허용합니다. `.dev.vars`는 Git에 포함하지 않습니다.

## 2. D1 생성

Cloudflare 계정 없이 로컬 개발만 할 경우 DB 생성과 database_id 교체는 배포 직전까지 건너뛰어도 됩니다.

```bash
npx wrangler login
npx wrangler d1 create ch-study
```

출력된 UUID로 `wrangler.jsonc`의 `REPLACE_WITH_D1_DATABASE_ID`를 교체합니다. D1 binding 이름은 `DB`입니다.

## 3. Migration과 예제 데이터

```bash
npm run db:migrate
npm run db:seed
```

로컬 D1은 `.wrangler/state`에 저장됩니다. seed는 단어 13개, 문장 4개, 문법 3개, 문화 4개이며 동일 seed를 다시 실행해도 중복되지 않습니다. 시험범위를 보장하는 교재가 아닌 기능 확인용 소량 데이터입니다.

운영 D1에는 다음 명령을 별도로 실행합니다.

```bash
npx wrangler d1 migrations apply ch-study --remote
# 예제 데이터도 운영에 넣고 싶은 경우에만:
npx wrangler d1 execute ch-study --remote --file=fixtures/seed.sql
```

## 4. 로컬 실행

```bash
npm run dev
```

`http://127.0.0.1:8787`에 접속합니다. `/admin/import`에서 `public/fixtures/sample.xlsx` 또는 `public/fixtures/vocabulary.csv`를 올리고 **서버 검증 · 미리보기 → 확인한 데이터 가져오기**를 누릅니다. seed를 먼저 넣었다면 중복 경고가 정상입니다. `둘 다 유지` 또는 `덮어쓰기` 정책으로 실제 저장을 확인할 수 있습니다.

로컬 관리자 인증은 `.dev.vars`의 `LOCAL_DEV=true`와 loopback 호스트가 **동시에** 일치할 때만 허용합니다. dev 서버는 `127.0.0.1`에 바인딩합니다. 운영에는 LOCAL_DEV를 설정하지 않습니다.

## 5. 운영 배포

먼저 아래 Access 설정을 완료하고 운영 migration을 적용합니다.

```bash
npm run check
npm test
npm run deploy
```

배포는 Cloudflare 인증과 실제 D1 UUID가 있어야 성공합니다. 이 저장소의 예시 UUID로 실제 운영 배포는 할 수 없습니다. `workers_dev`와 preview URL은 꺼져 있습니다.

## 6. ch.baecha.xyz 연결

`baecha.xyz` zone이 배포 계정의 Cloudflare에서 관리되어야 합니다. `wrangler.jsonc`의 다음 route가 Workers Custom Domain을 생성합니다.

```json
{ "pattern": "ch.baecha.xyz", "custom_domain": true }
```

이미 같은 이름의 충돌하는 DNS 레코드가 있으면 Cloudflare 대시보드에서 실제 용도를 확인한 뒤 정리합니다. 배포 후 Workers → Settings → Domains & Routes에서 인증서와 도메인 활성화를 확인합니다.

## 7. 관리자 인증 — Cloudflare Access

Cloudflare Zero Trust → Access → Applications에서 Self-hosted 애플리케이션을 만듭니다.

- 보호 대상: `ch.baecha.xyz/admin`, `ch.baecha.xyz/admin/*`, `ch.baecha.xyz/api/*`.
- 정책: 관리자의 이메일만 Allow. 광범위한 Bypass 정책을 만들지 않습니다.
- 학습 GET API를 공개해야 하므로 `/api/*` Access 보호는 선택 사항입니다. 이를 보호하면 일반 학습도 Access 로그인이 필요합니다. 개인 전용이면 전체 도메인을 하나의 Access 애플리케이션으로 보호하는 것이 가장 간단합니다.
- 공개 학습 + 관리자 전용 쓰기가 필요하면 `/admin`과 `/admin/*`만 Access로 보호하고 **Path 속성이 `/`인 Access 인증 쿠키**가 같은 호스트 API에도 전달되도록 설정합니다. Worker는 API의 `Cf-Access-Jwt-Assertion` 또는 `CF_Authorization` JWT를 검증합니다. 도메인·경로별로 다른 AUD 앱을 만들지 말고 같은 앱을 사용합니다.
- Workers 환경변수에 `ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`, `ACCESS_AUD=<Application Audience tag>`를 설정합니다. 이 값들은 비밀번호가 아니지만 클라이언트 번들에는 들어가지 않습니다.
- 운영에서 `LOCAL_DEV`는 삭제합니다.

Worker는 jose를 사용하여 서명, RS256 알고리즘, issuer, audience, 만료를 검증합니다. 이메일 헤더만 신뢰하지 않습니다. JWT 누락/위조/설정 누락 시 쓰기는 401입니다. `/admin` HTML도 보호하며, 모든 변경은 동일 출처 Origin + JSON 요청을 요구합니다. 인증된 자동화 클라이언트도 정확한 Origin 헤더를 보내야 합니다.

공개 API에는 학습 정답이 포함됩니다. 개인 학습 프로그램이므로 정답 은닉이나 성적 위조 방지를 제공하지 않습니다. 시험범위가 비공개 자료라면 **전체 도메인을 Access로 보호**하세요.

## 페이지

- `/`: 학습 대시보드, 누적 통계, 단어 검색
- `/match`: 3분 중국어·한국어 짝 맞추기 (최대 4쌍 · 4행 2열, 정답 두 자리만 연속 보충)
- `/learn`: 중국어↔한국어 뜻 선택
- `/write`: 재귀 component 조립, Easy/Normal/Hard
- `/pronunciation`: 한자→병음, 듣기→한자, 병음→한자, TTS 속도 설정
- `/sentence`: 클릭 기반 문장 배열, 반복 토큰 지원, 선택 취소
- `/grammar`: 맞는 문장/틀린 문장/오류 부분/빈칸/배열
- `/culture`: 객관식/OX/단답형
- `/test`: 영역별 수량 또는 자동 배분, 최대 100문제, 결과와 오답
- `/admin`, `/admin/import`, `/admin/vocabulary`, `/admin/grammar`, `/admin/sentences`, `/admin/culture`: 가져오기·수정·삭제·검색·백업

## Import 형식

CSV는 UTF-8, 첫 행은 영문 필드명입니다. XLSX도 첫 행이 필드명인 시트를 사용합니다. 시트 이름은 `vocabulary`, `sentences`, `grammar`, `culture`를 권장합니다. 각 시트를 선택하고 개별로 미리보기·저장합니다. `npm run fixtures`로 예제 SQL/CSV/JSON/XLSX를 다시 생성하고 XLSX의 모든 값을 검증할 수 있습니다. JSON 백업도 같은 화면에서 데이터 종류를 선택하여 복원합니다.

최대 500행/파일 5 MB/JSON 요청 2 MB. 더 큰 파일은 분할합니다. 한 import는 단일 bulk POST이며 D1 batch로 원자적으로 저장합니다. 업로드한 원본 파일을 서버에 보내거나 보관하지 않습니다.

| 유형 | 필수 열 | 선택 열 |
| --- | --- | --- |
| vocabulary | simplified, pinyin, meaning | traditional, korean_hanja_reading, characters |
| sentences | korean, chinese, tokens | explanation |
| grammar | title, explanation, correct_examples, wrong_examples | tags, questions |
| culture | category, question, answer | distractors, explanation |

배열/객체 열은 **JSON 문자열**로 저장합니다. `characters`가 없으면 simplified를 Unicode 글자 단위로 분리합니다. 분해 없는 글자는 뜻·발음은 학습하지만 조립에서는 제외됩니다.

```json
{"simplified":"请","traditional":"請","pinyin":"qǐng","meaning":"부탁하다","korean_hanja_reading":"청","characters":[{"char":"请","traditional":"請","decomposition":{"type":"layout","layout":"left-right","children":[{"type":"character","value":"讠"},{"type":"character","value":"青"}]}}]}
```

`layout`: `left-right`, `top-bottom`, `surround`, `other`. 재귀 깊이 8, 자식 2~8개, 단어 최대 32글자입니다. 한자음은 검색에만 사용합니다. 성조 정보는 pinyin에 포함하며 별도 성조 필드를 만들지 않습니다.

```json
{"korean":"너는 학생이니?","chinese":"你是学生吗？","tokens":["你","是","学生","吗"]}
```

문법의 `questions`는 추가 유형의 명시적 정답 데이터입니다. correct/wrong은 예문 배열로 자동 생성합니다.

```json
[
 {"type":"error","prompt":"你叫什么名字吗？에서 불필요한 부분은?","options":["你","叫","什么","吗"],"answer":"吗"},
 {"type":"blank","prompt":"你___什么名字？","options":["叫","是","吗"],"answer":"叫"},
 {"type":"order","prompt":"너는 학생이니?","tokens":["你","是","学生","吗"],"answer":"你是学生吗？"}
]
```

`你知道他喜欢什么吗？`는 명시적인 정상 예문에 들어 있습니다. 전역 문자열 기반 문법 판정은 하지 않습니다. 문화 단답형은 앞뒤 공백과 Unicode 정규화만 처리하며 동의어 자동 판정은 하지 않습니다.

미리보기는 `VALID/WARNING/ERROR`를 표시합니다. 필수 값, JSON, 글자 순서, 토큰 정합성, 문법 정답 보기를 서버에서도 검사합니다. 번체자/분해 누락·유사 단어·동일 항목은 경고입니다. **문제 있는 행만 보기 → 이 행 수정**에서 해당 JSON만 고칠 수 있고 행 제외도 가능합니다. 수정 후에는 재검증해야 합니다. 미리보기 이후 DB 내용이 바뀌면 409로 재검증을 요구합니다.

단어 중복 키는 `(simplified, pinyin, meaning)`입니다. 전체/행별 `기존 유지`, `덮어쓰기`, `둘 다 유지`를 지원합니다. 기존 중복이 여러 개면 덮어쓰기는 최신 ID 하나를 갱신합니다. 문장은 `(korean,chinese)`, 문법은 `title`, 문화는 `(category,question,answer)`를 비교합니다.

## DB schema

`migrations/0001_initial.sql`이 원본입니다.

| 테이블 | 내용 |
| --- | --- |
| vocabulary | 단어, 번체, 병음과 검색 정규화, 뜻, 한자음, characters JSON, 생성/수정 시각 |
| characters | 단어 FK, 글자 순서, 간체/번체, decomposition JSON |
| components | component value PK, 선택적 stroke_count/shape_group metadata |
| character_components | 글자↔component, 재귀 path, 위치; pool은 실제 사용 관계만 조회 |
| sentences | 한국어, 중국어, tokens JSON, 해설 |
| grammar_rules | 제목/해설, 정답/오답 예문, tags, questions JSON |
| culture_items | 분류/질문/정답, distractors JSON, 해설 |

단어 insert/update trigger가 파생 글자와 component 관계를 갱신하고 삭제 시 FK cascade가 적용됩니다. component metadata는 운영자가 필요할 때 D1에서 보완할 수 있습니다. 한자별 고정 오답 목록은 없습니다. 실제 등록 pool에서 위치, 알려진 획수·형태군을 점수화하여 가중 무작위 추출합니다. pool이 작으면 선택지가 적어질 수 있습니다. IDS 자동 분석기는 향후 `CharacterData.decomposition`을 생성하는 어댑터로 연결하면 됩니다.

## REST API

| 메서드 | 경로 | 인증 |
| --- | --- | --- |
| GET | `/api/vocabulary?q=` | 공개 학습 |
| GET | `/api/{vocabulary,sentences,grammar,culture}` | 공개 학습 |
| GET | `/api/{vocabulary,sentences,grammar,culture}/:id` | 공개 학습 |
| POST | `/api/{vocabulary,sentences,grammar,culture}` | 관리자 |
| PUT, DELETE | `/api/{vocabulary,sentences,grammar,culture}/:id` | 관리자 |
| GET | `/api/components` | 공개 학습 |
| GET | `/api/admin/session` | 인증 여부만 반환 |
| POST | `/api/import/preview` | 관리자 |
| POST | `/api/import` | 관리자, preview fingerprint 필수 |
| GET | `/api/export` | 관리자, 전체 JSON |

쓰기 body는 JSON이며 불명확한 ID, 유효하지 않은 데이터, 과대 요청을 거부합니다. SQL 값은 prepared binding을 사용하고 테이블/열 이름은 서버 allowlist에서만 선택합니다. CSV 내보내기는 브라우저에서 생성하며 수식으로 해석될 수 있는 셀을 무력화합니다. 원문 완전 복원용 백업은 JSON을 사용하세요.

## 학습 기록 · 오프라인 · 발음

`localStorage`: `ch.stats`(유형별 키, vocabularyId, correct/wrong/lastSeen/streak), `ch.settings`, `ch.speech`, `ch.dataset`. 틀린 횟수가 많고 연속 정답이 적은 항목의 가중치를 높입니다. 다른 기기로 동기화하지 않으며 브라우저 데이터를 삭제하면 기록도 사라집니다.

로드한 데이터는 메모리와 localStorage에 캐시합니다. 연결이 끊겨도 현재 화면과 SPA 학습을 유지하고 API 실패 시 마지막 데이터를 사용합니다. Service Worker 기반의 완전 오프라인 새로고침은 제공하지 않습니다.

TTS는 Web Speech API의 zh-CN 음성에 **간체자**를 전달합니다. 기본 속도 .9/.6이며 .3~1.5 사이로 설정합니다. 중국어 음성 미설치·미지원 환경에서는 안내와 건너뛰기를 제공하며 앱을 중단하지 않습니다. 실제 음성 품질과 오프라인 가능 여부는 OS/브라우저의 음성 엔진에 달려 있습니다.

## 프로젝트 구조

```
public/index.html          SPA 진입점
public/css/style.css       반응형 dark UI
public/js/app.js           라우팅
public/js/api.js           API와 데이터 캐시
public/js/validation.js    클라이언트/서버 공통 검증
public/js/study.js         출제·조립·채점·가중 통계
public/js/learning-ui.js   학습/시험 UI
public/js/speech.js        TTS
public/js/admin.js         관리자 CRUD·export
public/js/import.js        CSV/XLSX 파싱·미리보기
public/js/utils.js         안전한 DOM·저장 유틸리티
src/worker.ts              인증·REST·Static Assets
migrations/                D1 schema와 trigger
fixtures/                  seed SQL·테스트 데이터
scripts/                   의존성 복사·seed 재생성
tests/                     로직·브라우저·API 테스트
```

## 검증

```bash
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npx wrangler deploy --dry-run
```

E2E는 별도 로컬 D1 디렉터리를 초기화하고 개발 서버를 자동으로 띄웁니다. 실제 운영 DB는 사용하지 않습니다. TTS는 브라우저 API 호출과 fallback을 자동 검증하며 실제 소리는 지원 기기에서 확인해야 합니다.

## 범위와 남은 작업

구현된 범위: Phase 1~4의 import/CRUD/검색, 모든 학습 유형, 종합시험, 로컬 통계와 가중 출제, 관리자 인증, JSON/CSV 백업.

향후 확장: IDS 자동 분해, 이미지 기반 component 유사도, 사용자 계정/기기간 동기화, 완전 오프라인 PWA, 자유 입력 중국어 문법 parser. 이들은 초기 범위에 포함하지 않습니다. 일반 학습 목록은 개인 시험범위 규모를 전제로 전체 로드합니다. 대규모 공개 서비스에는 페이지네이션·요청 제한·동시 편집 잠금 등을 추가하세요.

배포 전 확인: 실제 D1 UUID, Access 정책과 AUD/issuer, LOCAL_DEV 제거, 비인증 POST/PUT/DELETE 거부, 도메인 인증서, 개인정보가 없는 시험범위 데이터, JSON 백업.

참고한 공식 문서: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Access JWT 검증](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [SheetJS 브라우저 배포](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).

## 최종 확인 결과 (2026-09-13)

- `npm install`: 성공, 의존성 audit 취약점 0개.
- 로컬 D1 migration과 24개 seed 항목 저장: 성공.
- `npm run check`: 모든 브라우저 JS 문법 검사와 Worker TypeScript 검사 통과.
- `npm test`: 13/13 통과.
- `npm run test:e2e`: Chromium 11/11 통과. 모든 라우트와 모바일 폭, 다섯 가지 검색, CSV 오류 행 수정, XLSX 4개 시트 import, 세 중복 정책, 100행 단일 bulk 저장, 오래된 preview 거부, CRUD/XSS 방어, 모든 학습 유형, TTS 간체자/속도/fallback, 혼합시험 완료, 네트워크 단절 후 학습, JSON/CSV export, 비인증 쓰기/관리 화면/위조 토큰 거부를 검증했습니다.
- 1440px 데스크톱과 390px 모바일 화면을 캡처하여 시각적으로 확인했습니다.
- Workers 배포 dry-run 통과. 실제 운영 배포와 실제 기기에서의 음성 청취는 수행하지 않았습니다.

로컬 개발의 `dev.host`에는 포트가 포함되어 있습니다. 다른 포트로 실행하려면 `npx wrangler dev --port 8790 --host 127.0.0.1:8790`처럼 함께 변경하세요. 이는 배포 도메인으로 로컬 요청의 호스트가 바뀌는 것을 막고 동일 출처 검사를 유지합니다.

## 매칭 모드

상단 **매칭** 또는 홈의 **짝 맞추기**에서 학습 범위를 선택하고 게임을 시작합니다. 기존 vocabulary와 오프라인 데이터 캐시를 사용합니다. 180초 제한시간과 매칭 시도 전체에 공유되는 10초 타이머는 `performance.now()` 기준으로 계산합니다. 정답·오답·작은 타이머 만료 시 작은 타이머를 10초로 초기화하며, 만료는 오답이 아닙니다.

전반부는 100/50점, 남은 시간이 90초 이하이면 130/80점입니다. 작은 타이머가 정확히 5초이면 낮은 점수이며, 5초 초과일 때만 높은 점수입니다. 콤보와 감점은 없습니다. 정답인 두 자리만 250ms 동안 사라진 뒤 새 카드로 보충합니다. 나머지 카드는 위치를 유지하며 계속 선택할 수 있습니다. 양쪽 열은 독립적인 무작위 대기열에서 미출제 단어를 우선 사용하고 순회 후 다시 섞습니다. 새 두 카드가 같은 쌍일 필요는 없지만 보충 후 맞출 수 있는 쌍은 최소 하나 유지합니다. 같은 열의 중복과 모호한 표시 문구를 피하며 후보가 부족할 때만 단어를 재사용합니다.

종료 시 최종 점수·정답 수·오답 수를 표시합니다. 각 시도는 기존 `ch.stats`의 `match:<vocabularyId>` 키에 저장되어 홈 누적 통계에 포함됩니다. 점수 자체는 현재 결과 화면에만 표시합니다. 화면 이동 시 게임 타이머를 정리합니다. 핵심 로직은 `public/js/match.js`, 화면은 `public/js/match-ui.js`, 검증은 `tests/match.test.mjs` 및 `tests/browser/match.spec.js`입니다.
