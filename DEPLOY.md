# 배포 가이드 — estudy.konetee.com (Render)

이 문서대로 따라 하면 앱을 인터넷에 올리고 `https://estudy.konetee.com` 으로 접속할 수 있습니다.
소요 시간: 20~30분. 코딩은 필요 없고, 웹사이트에서 클릭 + DNS 한 줄 추가입니다.

---

## 0. 미리 준비할 것

- **GitHub 계정** (무료) — 코드를 올려둘 곳
- **Render 계정** (무료) — https://render.com (GitHub으로 로그인 가능)
- **Anthropic API 키** — 지금 `.env` 에 쓰고 있는 그 키 (`sk-ant-...`)
- **konetee.com 도메인 관리 페이지** 접속 권한 (DNS 레코드를 추가할 곳)

---

## 1. 코드를 GitHub 비공개 저장소에 올리기

이 폴더는 아직 git 저장소가 아닙니다. 먼저 GitHub에서 **비공개(Private) 저장소**를 하나 만드세요
(이름 예: `estudy`). 그런 다음 이 폴더에서 아래를 실행합니다.

> ⚠️ `.env` 파일(실제 키)은 `.gitignore` 에 이미 등록돼 있어 **업로드되지 않습니다.** 안전합니다.

```bash
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin https://github.com/<본인아이디>/estudy.git
git push -u origin main
```

---

## 2. Render에서 Web Service 만들기

1. https://render.com 로그인 → **New +** → **Web Service**
2. 방금 만든 GitHub 저장소(`estudy`)를 선택 → **Connect**
3. 설정값 확인 (대부분 자동으로 채워짐):
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (일단 무료) 또는 Starter($7/월, 항상 켜짐)

---

## 3. 환경변수(Environment Variables) 입력 ← 가장 중요

Render의 **Environment** 탭에서 아래 3개를 추가합니다. (코드에는 절대 넣지 않습니다.)

| Key | Value | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | 본인 API 키 |
| `APP_PASSWORD` | 원하는 암호 | 이 암호를 입력해야 앱에 들어옴 (지인과 공유) |
| `CLAUDE_MODEL` | `claude-haiku-4-5` | (선택) 비용 절감용. 안 넣으면 opus-4-8 |

> 💡 공개 후 요금이 걱정되면 `CLAUDE_MODEL` 을 `claude-haiku-4-5` 로 두세요. 이 앱 용도엔 충분하고 훨씬 저렴합니다.

입력 후 **Create Web Service** → 몇 분 기다리면 배포 완료.
`https://estudy-xxxx.onrender.com` 같은 주소가 생깁니다. 열어서 **암호를 입력하고** 잘 되는지 확인하세요.

---

## 4. 커스텀 도메인 estudy.konetee.com 연결

1. Render 서비스 → **Settings** → **Custom Domains** → **Add Custom Domain**
2. `estudy.konetee.com` 입력 → Render가 **CNAME 값**을 하나 알려줍니다
   (예: `estudy-xxxx.onrender.com`)
3. **konetee.com 도메인 관리 사이트(DNS)** 로 가서 레코드 추가:

   | Type | Name(호스트) | Value(값) |
   |---|---|---|
   | CNAME | `estudy` | `estudy-xxxx.onrender.com` (Render가 준 값) |

4. 저장 후 몇 분~최대 1시간 → Render가 자동으로 인증하고 **무료 SSL(https)** 을 발급합니다.
5. `https://estudy.konetee.com` 접속 완료! 🎉

---

## 5. 코드 수정 후 재배포

앞으로 코드를 고치면, 아래만 하면 Render가 **자동으로 다시 배포**합니다.

```bash
git add .
git commit -m "수정 내용"
git push
```

---

## 알아두면 좋은 것

- **마이크(말하기/회화)**: HTTPS에서만 작동합니다. Render가 SSL을 주니 오히려 로컬보다 안정적입니다.
- **무료 티어의 콜드 스타트**: 15분간 접속이 없으면 서버가 잠들고, 다음 첫 접속이 30~50초 걸립니다.
  본인·지인용이면 괜찮고, 데모나 실사용이면 Starter($7/월)로 올리면 항상 켜져 있습니다.
- **비용**: 서버비(무료~$7) + Anthropic API 사용료(토큰당). API는 실제 사용량만큼 나갑니다.
- **암호 변경**: Render의 `APP_PASSWORD` 값을 바꾸고 저장하면 즉시 적용됩니다.
- **암호 잠금 끄기**: `APP_PASSWORD` 환경변수를 지우면 잠금이 사라집니다(비권장 — 공개 시 요금 위험).
