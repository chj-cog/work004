# 부자재 발주 체크리스트

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
2. SQL Editor에서 `supabase/migrations/`의 파일을 번호 순서대로 실행합니다 (`0001_init.sql`, `0002_import.sql`, `0003_signup_approval.sql`). 개발용 예시 데이터가 필요하면 `supabase/seed.sql`도 실행합니다.
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

## 명령

```bash
npm test
```

```bash
npm run build
```

## 배포 (Vercel)

1. 저장소를 Vercel에 연결합니다.
2. Environment Variables에 `.env.example`의 값을 모두 넣습니다. `CRON_SECRET`을 넣으면 Vercel Cron이 이 값으로 인증합니다.
3. 배포 후 설정·휴일 화면에서 관리자가 **지금 동기화**를 한 번 눌러 공휴일을 받습니다. 이후 매일 03:00(KST)에 자동 동기화됩니다.

## 운영 메모

- 계획 발주는 저장하지 않고 화면을 열 때마다 계산합니다. **발주 완료**를 체크한 순간 `purchase_orders`에 저장되고, 이후 계산에서는 입고 예정 재고로 쓰입니다.
- **입고 처리**를 누르면 해당 수량이 현재 재고에 더해집니다. 생산에 쓴 만큼의 재고 차감은 아직 자동이 아니므로, 프로젝트가 끝나면 재고를 고치고 상태를 "완료"로 바꿔야 합니다.
