# 부자재 발주 체크리스트

**배포한 앱: https://material-order-checklist.vercel.app**

가입 후 관리자 승인을 받은 팀원만 쓸 수 있습니다.

## 최신 추가 내용 (2026-11-18)

**말·글로 받은 재고·일정 변경을 정리해서 반영하는 "받은 내용" 화면**을 추가했습니다.

- **정리**: 통화·메신저에서 들은 내용("스크류 두 박스 반 남았고 피원 건은 다음 주 화요일로 당겨졌어요")을 글로 붙여 넣거나 녹음하면, 부자재·프로젝트별 재고와 일정 변경으로 정리합니다.
- **확인 후 반영**: 원래 말, 정리 결과, 확정하면 달라지는 발주를 나란히 보여 주고, 사람이 고쳐서 확정해야 재고·생산일정에 반영됩니다. 처리 기록이 남습니다.
- **누구나 녹음 가능**: 받아 적기를 쓰는 사람의 브라우저 안에서 돌립니다(무료, 서버 없음, 음성이 기기 밖으로 나가지 않음). 정확도가 낮아 녹음으로 올린 항목은 항상 "확인 필요"로 표시됩니다.
- **더 정확하게 쓰려면**: 선택 사항인 PC 도우미(Whisper large + LLM)를 켜면 정확도가 올라갑니다.
- **AI 모델 비교와 한계**: STT·LLM 모델을 비교하고 실패 사례를 분석했습니다. 성공 기준(정리 정확도 85%)에는 미달(73%)이라 자동 반영하지 않습니다. [모델 비교](docs/model-comparison.md) · [검증 결과](docs/evaluation.md) · [한계와 다음 스텝](docs/limits-next-steps.md)
- 이 밖에 부자재·프로젝트에 "다르게 부르는 이름"과 포장 단위 입력 칸, Next.js 보안 업데이트(16.4.6).

사용법은 아래 [받은 내용](#받은-내용-말글--재고일정) 절, 진행 경과는 [PROGRESS.md](PROGRESS.md)를 봅니다.

## 개요

생산일정을 기준으로 부자재별 "무엇을, 언제, 몇 개 발주하는가"를 한 장의 체크리스트로 만드는 웹 앱입니다. 요구사항은 [PRD.md](PRD.md)를 봅니다.

- Next.js 16 (App Router) · TypeScript
- Supabase (PostgreSQL, 로그인, 실시간 반영)
- Vercel 배포 (서울 리전, 매일 공휴일 동기화)

## 폴더

| 경로 | 내용 |
|---|---|
| `src/engine/` | 발주 계산 엔진. DB·화면과 분리된 순수 TypeScript (PRD §6) |
| `src/app/(app)/` | 로그인 후 화면 (S1~S7) |
| `src/app/login/`, `src/app/auth/` | 로그인 |
| `src/app/api/cron/holidays/` | 공휴일 동기화 예약 작업 |
| `src/lib/` | Supabase 클라이언트, DB → 엔진 입력 변환, 특일정보 API |
| `supabase/migrations/` | DB 스키마와 접근 권한(RLS) |
| `supabase/seed.sql` | PRD 예시 데이터 (개발용) |

## 처음 설정

1. [Supabase](https://supabase.com)에서 프로젝트를 만듭니다. 리전은 **Northeast Asia (Seoul)**.
2. SQL Editor에서 `supabase/migrations/`의 파일을 번호 순서대로 실행합니다 (`0001_init.sql`, `0002_import.sql`, `0003_signup_approval.sql`, `0004_intake.sql`). 개발용 예시 데이터가 필요하면 `supabase/seed.sql`도 실행합니다.
3. Authentication → Sign In / Providers → Email에서 **Allow new users to sign up을 켭니다.** 가입은 누구나 할 수 있지만, 관리자가 팀원 화면에서 승인해야 데이터를 볼 수 있습니다.
   - **Confirm email**: Supabase 기본 메일 서버는 한 시간에 보낼 수 있는 메일 수가 적습니다. 별도 메일 서버(SMTP)를 연결하기 전까지는 끄는 것을 권장합니다. 켜 두면 가입할 때마다 확인 메일이 나갑니다.
4. Authentication → URL Configuration에서 Site URL을 앱 주소로, Redirect URLs에 `http://localhost:3000/auth/callback`과 배포 주소의 `/auth/callback`을 추가합니다 (가입 확인 메일용).
5. **첫 번째로 가입한 사람이 자동으로 관리자**가 됩니다. 앱을 띄운 뒤 관리자가 될 사람이 먼저 가입하세요.
6. [공공데이터포털](https://www.data.go.kr)에서 「한국천문연구원_특일 정보」 활용 신청 후 일반 인증키(Decoding)를 받습니다.
7. `.env.example`을 `.env.local`로 복사하고 값을 채웁니다.

```bash
npm install
```

```bash
npm run dev
```

http://localhost:3000 에서 회원가입 후 로그인합니다. 이후 가입한 팀원은 관리자가 **팀원** 화면에서 승인합니다.

## 받은 내용 (말·글 → 재고·일정)

`받은 내용` 화면에서 말이나 글로 받은 재고·일정 변경을 정리하고, 사람이 확인해서 확정하면 재고와 생산일정에 반영됩니다.

1. **준비**: 부자재 화면에서 "다르게 부르는 이름"(스크류, 뽁뽁이)과 "포장 단위"(박스=800)를 넣습니다. 프로젝트에도 부르는 이름을 넣을 수 있습니다.
2. **넣기**: 글을 붙여 넣거나, 녹음하거나, 녹음 파일을 올립니다.
3. **확인**: 원래 말, 정리 결과, 확정하면 달라지는 발주가 나란히 나옵니다. 틀린 곳은 고칩니다. "확인 필요"가 붙은 것은 이유를 보고 직접 채웁니다.
4. **확정** 또는 **버리기**: 확정해야 반영됩니다. 누가 무엇을 근거로 바꿨는지 기록이 남습니다.

| 넣는 방법 | 받아 적기 | 정리 | 필요한 것 |
|---|---|---|---|
| 글 | — | 웹 앱 (규칙) | 없음 |
| 녹음, 녹음 파일 (**누구나**) | **쓰는 사람의 브라우저**에서 Whisper small | 웹 앱 (규칙) | 최신 Chrome·Edge 권장. 처음 한 번 모델 약 250MB를 내려받음 |
| 녹음, 글 (**PC 도우미가 있을 때**) | 이 PC의 Whisper large-v3-turbo | 이 PC의 LLM | PC 도우미 |

녹음은 도우미가 없어도 **각자의 브라우저 안에서** 받아 적습니다. 서버에 올리지 않고 비용도 들지 않으며, 음성은 쓰는 사람의 기기 밖으로 나가지 않습니다. 대신 PC 도우미보다 덜 정확해서(PoC에서 같은 크기 모델의 핵심어 인식률 67%) 이 방식으로 받아 적은 항목에는 항상 "확인 필요"를 붙입니다. 처음 쓸 때 모델을 내려받는 동안 화면에 진행률이 표시되고, 그 뒤로는 브라우저에 저장된 모델을 씁니다.

**PC 도우미**는 더 정확한 Whisper와 LLM을 이 PC에서 돌리는 작은 프로그램입니다. 선택 사항입니다. 켜는 방법은 [poc/README.md](poc/README.md)의 "브라우저에서 보기"와 같습니다 (`poc` 폴더에서 `.venv/Scripts/python web/server.py`). 도우미가 켜진 PC의 브라우저에서 웹 앱을 열면 화면에 "PC 도우미 연결됨"이 표시됩니다.

정리 정확도는 PoC에서 73%였습니다 ([docs/evaluation.md](docs/evaluation.md)). 그래서 자동으로 반영하지 않고 반드시 사람이 확인합니다.

## 명령

```bash
npm test
```

```bash
npm run build
```

## 배포 (Vercel)

운영 주소: **https://material-order-checklist.vercel.app** (Vercel 프로젝트 `material-order-checklist`, 서울 리전)

1. `vercel login` 후 프로젝트 폴더에서 연결합니다 (처음 한 번).
   ```bash
   vercel link --project material-order-checklist
   ```
2. Vercel → Settings → Environment Variables (Production)에 `.env.example`의 5개 값을 넣습니다. `CRON_SECRET`이 있어야 Vercel Cron이 인증됩니다.
   - 비밀 값은 대시보드에서 다시 볼 수 없으므로, 붙여 넣을 때 따옴표·공백이 섞이지 않게 주의합니다. 공휴일 동기화가 `Invalid API key`로 실패하면 `SUPABASE_SECRET_KEY`가 잘못 들어간 것입니다.
   - `NEXT_PUBLIC_`으로 시작하는 값은 빌드할 때 코드에 들어가므로, 바꾼 뒤에는 **다시 배포**해야 반영됩니다.
3. 배포합니다. 코드를 바꿀 때마다 같은 명령을 실행합니다.
   ```bash
   vercel deploy --prod
   ```
4. 설정·휴일 화면에서 관리자가 **공휴일 지금 동기화**를 한 번 누릅니다. 이후 매일 03:00(KST)에 자동으로 동기화됩니다.

## 운영 메모

- 계획 발주는 저장하지 않고 화면을 열 때마다 계산합니다. **발주 완료**를 체크한 순간 `purchase_orders`에 저장되고, 이후 계산에서는 입고 예정 재고로 쓰입니다.
- **입고 처리**를 누르면 해당 수량이 현재 재고에 더해집니다. 생산에 쓴 만큼의 재고 차감은 아직 자동이 아니므로, 프로젝트가 끝나면 재고를 고치고 상태를 "완료"로 바꿔야 합니다.
