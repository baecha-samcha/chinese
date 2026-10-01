# 차곡 — 개인용 중국어 시험 대비

`ch.baecha.xyz`를 위한 한국어 UI의 중국어 반복 학습 웹앱. HTML/CSS/vanilla ES modules + Cloudflare Workers Static Assets + D1입니다. 평소 학습에는 AI API, API key, 별도 서버, 로그인 계정이 필요하지 않습니다. 기본 dark mode이며 모바일·태블릿·Chromebook·데스크톱에 대응합니다.

## 1. 설치

Node.js 22 이상을 사용합니다.

```bash
npm install
cp .dev.vars.example .dev.vars
```

`postinstall`은 SheetJS 0.20.3을 `public/vendor`로 복사합니다. XLSX 화면에서만 지연 로드하며, 실행 중 외부 CDN 요청은 없습니다. `.npmrc`는 npm 12의 직접 지정 tarball 의존성을 허용합니다. `.dev.vars`는 Git에 포함하지 않습니다.

`postinstall`은 또한 decomposition에 쓰이는 BMP 밖 한자(CJK 확장 B 이상, 예: 𠂇 U+20087)를 위한 self-hosted fallback 폰트를 `public/vendor/fonts/hanamin`에 준비합니다. 시스템/일반 CJK 웹폰트는 이 범위를 거의 지원하지 않아 tofu(□)로 깨지므로, `@vp-tw/cjk-web-fonts-hanamin`(Hanazono, MIT/OFL) 패키지에서 실제로 필요한 unicode-range 블록만 복사합니다. `scripts/scan-rare-components.mjs <export.json>`으로 현재 vocabulary/D1 데이터에 새로운 BMP 밖 구성요소가 생겼는지 점검할 수 있고, 있다면 `scripts/data/cjk-fallback-known.json`에 추가한 뒤 `npm run vendor`를 다시 실행하세요. `.hanzi`/`.component`에만 fallback으로 적용되어 기존 한글/영문 UI 폰트는 그대로입니다.

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

로컬 D1은 `.wrangler/state`에 저장됩니다. seed는 단어 13개, 문장 4개, 문법 3개, 문화 4개이며(migration `0003`이 자기소개 문장 6개를 추가로 보장합니다) 동일 seed를 다시 실행해도 중복되지 않습니다. 시험범위를 보장하는 교재가 아닌 기능 확인용 소량 데이터입니다.

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
- `/learn`: 단어·문장 공통 퀴즈 — 뜻·한자·병음 중 문제/정답 필드 선택, 카테고리, 객관식/직접 입력 (객관식 오답 보기에는 같은 문제 값을 가진 다른 항목의 정답이 절대 들어가지 않음 — 예: 같은 뜻 "몇 살이니?"의 你几岁了？/你多大了？)
- `/match`: 3분 중국어·한국어 짝 맞추기 (최대 4쌍 · 4행 2열, 정답 두 자리만 연속 보충)
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
| vocabulary | simplified, pinyin, meaning | traditional, korean_hanja_reading, characters, source, exam_tags |
| sentences | korean, chinese, tokens | explanation, source, pinyin, category, exam_tags |
| grammar | title, explanation, correct_examples, wrong_examples | tags, questions, exam_tags |
| culture | category, question, answer | distractors, explanation, exam_tags |

배열/객체 열은 **JSON 문자열**로 저장합니다. `characters`가 없으면 simplified를 Unicode 글자 단위로 분리합니다. 분해 없는 글자는 뜻·발음은 학습하지만 조립에서는 제외됩니다.

### 교과서 / 보충자료 선택

홈, 학습 화면, 종합시험의 **학습 범위**에서 `둘 다`, `교과서만`, `보충자료만`을 선택합니다. 선택은 이 브라우저에 저장되어 화면 이동·새로고침 후에도 유지됩니다. 단어 뜻·발음·조립, 문장 배열, 검색, 종합시험의 출제 수와 객관식 오답 후보에도 같은 범위를 적용합니다. 시험 시작 후에는 범위를 변경할 수 없습니다. 범위를 바꾸면 연습 문제 대기열과 시험 자동 배분을 새 범위로 다시 구성합니다. 누적 풀이 통계는 기존 전체 학습 기록입니다.

단어·문장 시트의 `source`는 `0`=교과서, `1`=보충자료입니다. XLSX 숫자와 CSV/JSON의 `"0"`, `"1"` 문자열을 모두 처리합니다. 빈칸·null·열 누락은 **출처 미지정**으로 보존하고 ‘둘 다’에서만 포함합니다. 기존 데이터를 교과서로 임의 분류하지 않습니다. 문법·문화는 출처 구분 없이 공통 범위입니다. `source_url`은 참고 출처 URL이며 학습 범위를 지정하는 `source`와는 별개의 열입니다.

### 시험 범위 태그 (`exam_tags`)

`source`는 **어디에서 나온 자료인지**(교과서/보충자료), `exam_tags`는 **어느 시험 범위에 포함되는지**를 나타내는 별개의 값입니다. 시험 범위는 `exams` 테이블에 `2026-midterm`(표시 이름 ‘2026 중간고사’)처럼 안정적인 ID와 표시 이름으로 등록하고, 네 가지 데이터 모두 `exam_tags`에 ID 목록을 가집니다. 한 항목이 여러 시험에 들어갈 수 있습니다(예: `["2026-midterm","2026-final"]`). 문법 `tags`(주제 태그)와는 다른 열입니다.

- 학습 화면의 **시험 범위**에서 `전체` 또는 등록된 시험을 고릅니다. 학습 범위(출처)와 함께 적용됩니다(예: 보충자료 ∩ 2026 중간고사).
- CSV/XLSX의 `exam_tags` 열은 JSON 배열 또는 쉼표 구분 ID(`2026-midterm, 2026-final`)를 받습니다. 등록되지 않은 ID는 서버 검증에서 오류입니다. 열이 없는 덮어쓰기 가져오기는 기존 태그를 유지합니다.
- 관리 목록과 가져오기 미리보기에서 출처와 시험 범위를 별도 배지로 표시합니다.

`2026-midterm`은 `exam-scope.pdf`(교과서 pp.30–75 스캔 + 중국어 I 보충자료) 인쇄본과 대조해 `migrations/0004_exam_scope.sql`로 기록했습니다. 항목별 PDF 쪽수 근거와 미확인 항목은 `scripts/data/exam-2026-midterm.json`에 있습니다. 이 migration은 스키마를 추가하고, 근거가 있는 출처 미지정 행의 `source`만 채우며(이미 있는 출처는 변경하지 않음), 확인된 행에 태그를 붙입니다. 행은 id와 내용이 함께 맞을 때만 갱신하고 삭제·ID 변경은 없습니다.

새 시험(예: 기말고사)을 추가하려면 같은 형식의 근거 파일을 만들고 `node scripts/exam-scope.mjs migration scripts/data/exam-2026-final.json > migrations/0005_….sql`로 migration을 만든 뒤 적용합니다(`--with-schema`는 0004에서만 사용).

실전 시험 모드는 태그된 행의 고정 스냅숏 `public/data/exam-scope.json`으로 출제합니다. 운영 D1 export에서 다시 만들 때:

```bash
npx wrangler d1 export ch-study --remote --output /tmp/ch-export.sql   # 읽기 전용 export
node scripts/exam-scope.mjs build --dump /tmp/ch-export.sql --exam 2026-midterm
```

아직 운영에 적용되지 않은 migration은 export 사본에만 적용한 뒤 태그된 행을 고릅니다. export 파일은 저장소에 넣지 않습니다.

### 단어·문장 공통 퀴즈 (`/learn`)

단어와 문장은 모두 `public/js/quiz.js`에서 같은 StudyItem(`meaning` 뜻 · `hanzi` 한자 · `pinyin` 병음 · `category`)으로 정규화되고, 하나의 퀴즈 엔진이 `문제 필드 → 정답 필드`로 출제합니다. 단어는 `meaning/simplified/pinyin`, 문장은 `korean/chinese/pinyin`을 사용합니다. 학습 대상(단어/문장), 카테고리, 문제·정답 필드(여러 개 선택 가능, 같은 필드끼리의 조합은 자동 제외), 답 방식을 고릅니다. 예전 `direction` 설정은 그대로 해석됩니다(forward = 한자 → 뜻, reverse = 뜻 → 한자, mixed = 둘 다). 종합시험의 뜻 학습은 연습 설정과 관계없이 단어 뜻 ↔ 한자 객관식으로 유지합니다. 문장 배열(`/sentence`)은 별도 기능으로 그대로 남아 있습니다.

직접 입력은 정답이 한자·병음일 때만 제공합니다(한국어 뜻은 객관식). 병음은 성조까지 채점하며, 대소문자·Unicode 조합형·공백/띄어쓰기(gěi nǐ = gěinǐ)·apostrophe·문장부호 차이는 무시하고 `v`, `u:`를 ü로, 숫자 성조(`ni3 hao3`, 5/0은 경성)를 성조 기호로 바꿔 비교합니다(`public/js/pinyin.js`의 `pinyinAnswerKey`). 성조가 다르거나 빠진 답은 오답입니다. 오답이면 내 답과 정답을 함께 보여줍니다. Chromebook처럼 성조 문자를 입력하기 어려운 환경을 위해, 정답이 병음인 직접 입력 학습을 처음 시작하면 숫자 성조·v 입력 안내가 작은 modal 카드로 뜹니다(자동으로 닫히지 않음, Esc = 확인). `확인`은 다음 방문까지, `다시 보지 않기`는 계속 숨기고(`localStorage`의 `ch.pinyinInputGuideDismissed`), 답 방식 옆 `?` 버튼으로 언제든 다시 볼 수 있습니다. 안내의 예시는 `public/js/pinyin.js`의 `PINYIN_INPUT_EXAMPLES` 하나에서 나오고 `tests/quiz.test.mjs`가 모두 실제 채점으로 검증합니다.

문장 병음·카테고리는 migration `0003_sentence_pinyin_category.sql`로 추가됩니다. 이 migration은 자기소개 표현 6개를 같은 중국어 문장이 이미 있으면 그 행을 재사용해 `category='자기소개'`와 병음만 채우고, 없을 때만 새로 만듭니다. 시험범위 PDF(중국어1.pdf, 2026년 보충자료.pdf)에 병음이 인쇄된 문장은 생성기의 PDF 표기(`pdf` 목록)를 그대로 씁니다(哪里 nǎli, 多重 duōzhòng, 拜拜 báibai, 1米75 → Yī mǐ qī wǔ, 60公斤 → Liù shí gōngjīn 등, 숫자 문장은 PDF 읽기를 병음으로 저장하므로 직접 입력도 그 읽기로 채점). 나머지 문장의 병음은 `scripts/generate-sentence-pinyin.mjs`로 만든 초안 `scripts/data/sentence-pinyin.sql`에 있습니다(단어장 병음 우선, 없으면 pinyin-pro 사전·성조 변화 적용, `-- REVIEW:` 줄은 사람이 확인할 항목). 비어 있는 병음만 채우므로 다시 실행해도 수정한 값은 덮어쓰지 않습니다. `node scripts/review-sentence-pinyin.mjs <sentences.json> <vocabulary.json> > outputs/sentence-pinyin-review.md`로 실제 적용될 병음과 REVIEW/WARNING(음절 수, 다음자, 고유명사, 숫자, 문장부호, pinyin-pro 문맥 판독 차이, 띄어쓰기)·중복 문장을 검수표로 볼 수 있습니다. 병음이 없는 문장은 병음이 필요한 방향에서만 자동 제외됩니다.

운영 반영 순서(코드 배포 전에 migration 먼저):

```bash
npx wrangler d1 migrations apply ch-study --remote
npx wrangler d1 execute ch-study --remote --file=scripts/data/sentence-pinyin.sql
npm run deploy
```

XLSX/CSV **덮어쓰기** 가져오기는 파일에 있는 열만 갱신합니다. 열 자체가 없으면(`pinyin`, `category`, `source`, `explanation`, `traditional`, `korean_hanja_reading`, `characters` 등) 기존 값을 유지하고, 열이 있는데 칸이 비어 있으면 명시적으로 비웁니다. 단, `characters` 빈 칸은 분해가 실수로 지워지지 않도록 '없음'으로 취급해 기존 값을 유지합니다. 새 행 추가(INSERT)는 이전과 같습니다.

기존 설치에는 `0002_study_source.sql` migration이 필요합니다. 운영에 반영할 때는 다음 순서를 사용합니다.

```bash
npx wrangler d1 migrations apply ch-study --remote
npm run deploy
```

이후 `/admin/import`에서 `chinese_study_dataset_with_source.xlsx`의 `vocabulary`, `sentences`를 각각 검증·가져오기 합니다. 기존 동일 항목의 출처를 갱신하려면 **덮어쓰기**를 선택합니다(`기존 유지`는 기존 출처도 유지). DB migration만 적용하면 기존 행은 미지정이므로 특정 출처 선택 시 나오지 않습니다. 한 내용이 두 자료에 모두 있는 별도 행을 함께 보관하려면 `둘 다 유지` 정책으로 각 출처 행을 보관할 수 있습니다. JSON 백업과 CSV 내보내기에도 source를 포함합니다.

```json
{"simplified":"请","traditional":"請","pinyin":"qǐng","meaning":"부탁하다","korean_hanja_reading":"청","characters":[{"char":"请","traditional":"請","decomposition":{"type":"layout","layout":"left-right","children":[{"type":"character","value":"讠"},{"type":"character","value":"青"}]}}]}
```

`layout`: `left-right`, `top-bottom`, `surround`, `other`. 재귀 깊이 8, 자식 2~8개, 단어 최대 32글자입니다. 한자음은 검색에만 사용합니다. 성조 정보는 pinyin에 포함하며 별도 성조 필드를 만들지 않습니다.

각 글자는 선택적으로 `assemblyEnabled: true|false`를 가질 수 있습니다. decomposition이 있어도 `public/js/validation.js`의 `assemblyEligible`은 leaf 2~3개·깊이 2 이하인 "의미 있는 구성요소" 수준의 분해만 자동으로 조립 문제 대상으로 삼습니다 (실제 데이터 감사 기준: 好=女+子, 明=日+月처럼 남아있는 모든 정상 분해는 이 범위 안에 있고, 德=彳+十+罒+一+心처럼 5개로 쪼개지는 항목만 벗어납니다). `assemblyEnabled`를 명시하면 이 휴리스틱을 오버라이드합니다 — decomposition 자체는 절대 지우지 않고 "조립 문제로 낼지"만 별도로 표시합니다. 한 단어의 모든 글자가 조립 대상에서 제외되면 그 단어는 조립 문제 후보군에서 자동으로 빠집니다(에러 없음). `scripts/apply-assembly-review.mjs`가 이런 리뷰를 재현 가능한 SQL로 만들어 주며, `scripts/data/assembly-overrides.json`에 현재 리뷰 목록이 있습니다.

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
| exams | 시험 범위 ID(`2026-midterm`)·표시 이름·정렬 순서 (0004) |

`vocabulary`·`sentences`에는 `source`(0002), 네 학습 테이블 모두에 `exam_tags` JSON 배열(0004)이 있습니다.

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
| GET | `/api/exams` | 공개 학습, 등록된 시험 범위 |
| GET | `/api/admin/session` | 인증 여부만 반환 |
| POST | `/api/import/preview` | 관리자 |
| POST | `/api/import` | 관리자, preview fingerprint 필수 |
| GET | `/api/export` | 관리자, 전체 JSON |

쓰기 body는 JSON이며 불명확한 ID, 유효하지 않은 데이터, 과대 요청을 거부합니다. SQL 값은 prepared binding을 사용하고 테이블/열 이름은 서버 allowlist에서만 선택합니다. CSV 내보내기는 브라우저에서 생성하며 수식으로 해석될 수 있는 셀을 무력화합니다. 원문 완전 복원용 백업은 JSON을 사용하세요.

## 학습 기록 · 오프라인 · 발음

`localStorage`: `ch.stats`(유형별 키, vocabularyId, correct/wrong/lastSeen/streak), `ch.settings`, `ch.speech`, `ch.dataset`. 틀린 횟수가 많고 연속 정답이 적고 오래 복습하지 않은(최대 2주 기준) 항목의 가중치를 높입니다. 공통 퀴즈는 `vocabulary:<id>:meaning>pinyin`, `sentences:<id>:pinyin>meaning`처럼 항목 + 방향별로 기록하므로, 같은 항목이라도 방향마다 숙련도가 따로 쌓입니다. 방향별 기록이 아직 없는 단어의 뜻↔한자 방향은 예전 `vocabulary:<id>` 기록을 이어서 사용합니다(localStorage migration 없음). 다른 기기로 동기화하지 않으며 브라우저 데이터를 삭제하면 기록도 사라집니다.

문제 출제는 독립 가중 무작위 추출이 아니라 가중 shuffle bag(`public/js/study.js`의 `buildQueue`/`drawFromQueue`)입니다. 매 cycle마다 현재 설정에서 출제 가능한 모든 항목이 최소 1번씩 후보가 되고, 약점 항목은 최대 4배까지만 더 자주 나오도록 상한이 있어 소수 문제가 한 cycle을 독점하지 않습니다. cycle이 끝나면 재섞고, 직전 문제와 동일한 문제는 가능하면 피합니다(후보가 1개뿐이면 불가피하게 반복). 설정 변경 등으로 후보군 자체가 바뀌면 큐를 새로 만듭니다. 틀린 문제는 바로 다시 내지 않고 다른 문제 3개 뒤에 같은 방향으로 재출제합니다(retry queue). 공통 퀴즈에서는 앞 두 글자가 같은 표현군(예: `祝你…`)이 최근 2문제 안에 겹치지 않도록 하고, 다른 후보가 없을 때만 이 조건을 풉니다.

로드한 데이터는 메모리와 localStorage에 캐시합니다. API 실패 시 마지막 데이터를 사용합니다.

### 오프라인 · 앱 설치

`public/sw.js` Service Worker가 첫 방문 때 학습 화면(HTML·CSS·학습 JS 모듈·아이콘·희귀 한자 폰트)을 미리 캐시합니다. 한 번 온라인으로 연 뒤에는 인터넷 없이 새로고침하거나 새로 열어도 모든 학습 화면·종합시험이 동작하며, 상단에 "마지막으로 저장된 학습 데이터" 안내가 표시됩니다. 온라인일 때는 항상 네트워크를 먼저 사용하므로(4초 이상 응답이 없으면 캐시) 배포 직후에도 옛 파일이 남지 않습니다. `/api`와 `/admin`은 캐시하지 않으므로 관리·가져오기·내보내기는 온라인에서만 가능합니다.

`manifest.webmanifest`로 휴대폰·태블릿·Chromebook에서 "홈 화면에 추가/앱 설치"가 가능합니다. 아이콘 원본은 `public/icons/icon.svg`, `icon-maskable.svg`이며 수정 후 `node scripts/icons.mjs`로 PNG를 다시 만듭니다. 학습 JS 모듈을 새로 추가하면 `public/sw.js`의 `SHELL`에도 추가하세요(`tests/offline.test.mjs`가 누락을 검사합니다).

TTS는 Web Speech API의 zh-CN 음성에 **간체자**를 전달합니다. 기본 속도 .9/.6이며 .3~1.5 사이로 설정합니다. 중국어 음성 미설치·미지원 환경에서는 안내와 건너뛰기를 제공하며 앱을 중단하지 않습니다. 실제 음성 품질과 오프라인 가능 여부는 OS/브라우저의 음성 엔진에 달려 있습니다.

## 프로젝트 구조

```
public/index.html          SPA 진입점
public/css/style.css       반응형 dark UI (상단 :root 디자인 토큰)
public/js/app.js           라우팅
public/js/api.js           API와 데이터 캐시
public/js/validation.js    클라이언트/서버 공통 검증
public/js/study.js         출제·조립·채점·가중 통계
public/js/learning-ui.js   학습/시험 UI (공통 문제 카드 renderQuestion)
public/js/ui.js            공통 UI 블록 (PageHeader·QuizToolbar·도움말·상태칩)
public/js/speech.js        TTS
public/js/admin.js         관리자 CRUD·export
public/js/import.js        CSV/XLSX 파싱·미리보기
public/js/utils.js         안전한 DOM·저장 유틸리티
src/worker.ts              인증·REST·Static Assets
migrations/                D1 schema와 trigger
fixtures/                  seed SQL·테스트 데이터
scripts/                   의존성 복사·seed 재생성·시험 범위(exam-scope.mjs)
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
