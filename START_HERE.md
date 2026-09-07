# cal.dudu-works.com 시작하기

예약 기간은 2026-09-09부터 2026-09-22까지입니다. 오전 09:00, 오후 13:00, 저녁 18:00, 총 42슬롯입니다.

## 1. ZIP을 풀고 VS Code에서 폴더 열기

ZIP을 풀어 package.json과 AGENTS.md가 있는 cal-dudu-starter 폴더를 엽니다. Node.js와 npm이 설치되어 있어야 합니다. Terminal 메뉴에서 New Terminal을 엽니다.

## 2. 같은 의존성 설치

Mac 터미널:

```sh
npm ci
npm test
npm run build
npm run dev
```

Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

각 명령이 종료된 뒤 다음 명령을 입력합니다. 마지막 명령은 서버를 계속 실행하므로 종료하지 않습니다. 브라우저에서 터미널의 Local 주소를 엽니다. 기본 주소는 http://localhost:5187 입니다. 가상 서비스 이름 cal.dudu-works.com은 실제 배포 주소가 아닙니다.

## 3. 공통 예약 시나리오

1. 고객 C01: 9/9 오전, 9/9 오후를 순서대로 신청합니다.
2. 고객 C02: 9/9 오전 하나를 신청합니다.
3. 어드민: C01의 9/9 오전을 확정합니다.
4. 고객 C02: 재선택 안내를 확인하고 9/10 오전을 신청합니다.
5. 어드민: C02의 9/10 오전을 확정합니다.
6. 어드민의 실행 기록에서 결과를 확인합니다.

희망 신청만으로 슬롯이 마감되지 않습니다. 확정된 슬롯에 다른 고객을 확정할 수 없습니다. 다른 희망이 하나라도 남아 있으면 접수 상태를 유지합니다.

## 4. Supabase SQL 설치

새 실습용 Supabase 프로젝트의 SQL Editor에서 New query를 엽니다. `sql/00_supabase.sql` 전체를 붙여 넣고 Run을 누릅니다. 테이블, 함수, 권한, 42슬롯이 함께 생성됩니다. 이전 버전의 SQL을 추가 실행하지 않습니다.

```sql
select count(*) as slots, min(date) as first_day, max(date) as last_day from public.slots;
```

예상 결과: 42, 2026-09-09, 2026-09-22.

RPC(앱에서 호출하는 DB 함수)는 submit_request, confirm_request, resubmit_request입니다. 고객은 Supabase Auth의 사용자 UUID로 식별합니다. 관리자 권한은 서버가 관리하는 app_metadata.role='admin'을 확인합니다. 고객이 수정할 수 있는 user_metadata에 관리자 권한을 넣지 않습니다.

현재 ZIP의 화면은 한 브라우저의 localStorage를 사용하는 공통 예약 실습 화면입니다. SQL 설치는 Supabase DB를 준비하는 단계입니다. 환경 변수 입력만으로 이 화면이 자동으로 Supabase에 연결되지는 않습니다. 로그인 화면과 DB 호출 연결은 아래 프롬프트로 이어갑니다.

## 5. VS Code의 Haiku에 넣는 연결 프롬프트

```text
AGENTS.md, PRD.md와 sql/00_supabase.sql을 읽어라. 고정 슬롯과 판정 함수를 다시 만들지 마라. 기존 로컬 모드는 유지하고 명시적인 Supabase 모드를 연결하라. 고객 로그인은 Supabase Auth를 사용하고 submit_request, confirm_request, resubmit_request를 호출하라. 관리자 여부는 서버의 app_metadata.role로 판정한다. DB 직접 쓰기는 하지 않는다. 인증·조회·저장 오류를 화면에 표시하고 실패 시 로컬 모드로 몰래 전환하지 마라. 위 공통 시나리오를 두 시험 사용자로 실행해 실제 결과를 기록하라.
```

.env.example을 참고하여 .env.local에 프로젝트 URL과 공개용 키를 입력합니다. service_role 키와 DB 비밀번호를 VITE_ 변수에 넣지 않습니다. .env.local은 제출하거나 Git에 올리지 않습니다.

## 6. 본인 기능 얹기

공통 시나리오가 통과하면 Git에 기본 버전을 저장합니다. 고객 카드에서 한 장면을 선택하여 Journey, Service Blueprint, 기능 선택 이유를 적습니다. UI의 희망 선택 상한 3과 1처럼 설정 하나만 바꾸고 동일 입력의 결과를 비교합니다. 42슬롯과 슬롯당 확정 한 명이라는 DB 규칙은 유지합니다.
