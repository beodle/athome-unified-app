# athome-unified-app — 운영 지식

코드만 읽어서는 바로 안 보이는, 이 저장소 특유의 운영/설계 결정 사항을 기록한다.

## LinkedIn OAuth 토큰 갱신 절차

- **로컬 재발급 스크립트**: `/Users/jangmyeongseong/Desktop/claude code/work/athome/채용-콘텐츠/linkedin-성과분석/linkedin_oauth.py`
  - `python3 linkedin_oauth.py` 실행 → 브라우저에서 LinkedIn 인증 페이지가 열림(이미 로그인·승인된 세션이면 클릭 없이 자동 리다이렉트되기도 함) → `linkedin_token.json`에 새 `access_token`(60일)·`refresh_token`(365일) 저장.
  - 이 파일은 **athome-unified-app CI와는 별개**로, 로컬에서 상태 확인용으로만 쓰는 캐시다. `update.sh`가 `LINKEDIN_REFRESH_TOKEN` 환경변수가 없을 때(로컬 실행 시) 이 디렉터리의 `linkedin_token.json`/`linkedin_config.json`/`linkedin_oauth.py`에서 값을 자동으로 끌어오는 폴백 경로로만 연결돼 있다.
- **실제 데이터 수집 스크립트**: `linkedin_fetch.py` (이 저장소 안에 있음) — `LINKEDIN_REFRESH_TOKEN`으로 매 실행마다 새 `access_token`을 발급받아(`grant_type=refresh_token`) LinkedIn API를 호출한다. 재발급용이 아니라 **소비용** 스크립트다.
- **GitHub Actions는 GitHub Secret만 본다**: `linkedin_oauth.py`로 로컬 토큰을 새로 받아도, `beodle/athome-unified-app` 리포의 `LINKEDIN_REFRESH_TOKEN` Secret을 직접 갱신하지 않으면 CI(`update.yml`)는 계속 옛 토큰을 쓴다.
  ```bash
  # 새 refresh_token 추출 후
  gh secret set LINKEDIN_REFRESH_TOKEN --repo beodle/athome-unified-app < token_value.txt
  ```
- **대시보드의 "🔑 LinkedIn 토큰 만료 D-N" 배너는 실시간 체크가 아니라 하드코딩된 상수다**: `dashboard.html`의 `checkStale()`(약 723번 줄)이 `const __LI_TOKEN_EXPIRES__="..."`(약 722번 줄) 날짜와 오늘을 비교해서 D-14 이내면 배너를 띄운다. **토큰을 재발급하고 GitHub Secret을 갱신해도 이 상수는 자동으로 안 바뀐다** — 재발급할 때마다 새 `refresh_token`의 만료일(발급일 + 365일)로 이 값도 반드시 같이 고쳐야 배너가 사라진다. 안 고치면 실제로는 문제 없어도 계속 D-2로 떠 있는다(2026-08-19에 이걸 놓쳐서 실제로 겪은 문제).
- **"로컬 access_token 만료" 자체는 CI와 무관하다**: 로컬 `linkedin_token.json`의 `expires_at`(access_token, 60일)이 임박했다고 해서 CI가 끊기는 건 아니다 — CI는 `refresh_token`(365일)으로 매번 새 access_token을 받아 쓰기 때문. 다만 `refresh_token` 자체가 만료되면(1년 주기) 그때는 반드시 재발급 + Secret 갱신 + 위 배너 상수 갱신까지 세 가지를 모두 해야 한다.

## dashboard.html vs overview.html — LinkedIn 팔로워 표시 방식이 다른 이유 (의도적)

- **`dashboard.html`**: `lastFollowers(weeks)`가 **선택한 기간 말 시점의 스냅샷**을 보여준다. 기간 필터(1주/4주/이번 달 등)를 바꾸면 팔로워 숫자도 그 기간에 맞춰 바뀐다. 한 번 "기간과 무관하게 항상 최신값"으로 바꿨다가(커밋 `ede0e0b`) 사용자 피드백으로 되돌렸다(커밋 `3692729`, "계속 팔로워를 최신화로 보여주는 건 아닌 거 같아. 대시보드에는 기존과 같이 롤백").
- **`overview.html`("홈")**: `loadKpis()`가 `weeks[weeks.length-1]`, 즉 **기간과 무관하게 항상 가장 최근 값**을 보여준다. 홈은 "지금 몇 명이냐"를 보는 화면이라 이게 맞다고 판단해 유지 중이다.
- 두 화면의 팔로워 숫자가 다르게 보여도 **버그가 아니다**. 통일시키기 전에 반드시 이 히스토리를 먼저 확인할 것.
- `lastFollowers()`의 폴백 조회는 `sortedWeeks()`(진행 중인 이번 주 제외)가 아니라 전체 주차에서 찾도록 되어 있다 — `linkedin_fetch.py`가 팔로워 스냅샷을 항상 최신 주차(=대개 진행 중인 이번 주)에만 찍어두기 때문. 이 부분을 다시 `sortedWeeks()` 기반으로 되돌리면 팔로워가 0으로 보이는 버그가 재발한다.

## 채널 색상(`PRESET_COLORS`) 동기화 규칙

- `calendar.html`과 `overview.html` 양쪽에 각각 동일한 `PRESET_COLORS` 객체가 하드코딩돼 있다(공용 파일로 분리돼 있지 않음).
  ```js
  { '링크드인': '#4A77B5', '블로그': '#059669', '팟캐스트': '#E08A4F', '보도자료': '#1A1A1A', '기타': '#6B7280' }
  ```
- 새 채널을 추가할 때는 **두 파일 모두**에 같은 키·색을 추가해야 캘린더와 홈 화면에서 색이 일치한다. 한쪽만 추가하면 다른 쪽은 `FALLBACK_PALETTE`에서 임의 색을 배정받아 페이지마다 색이 달라진다.
- `calendar.html`의 채널 선택 드롭다운(`getChannelOptions()`)은 `PRESET_COLORS` 키 + 실제 저장된 이벤트의 채널 값을 합집합해서 만든다 — `PRESET_COLORS`에 채널을 추가하기만 하면 아직 아무 이벤트도 없어도 드롭다운에 바로 뜬다. 반면 필터 칩(`renderFilters()`)은 **실제 이벤트 데이터에 있는 채널만** 렌더링하므로, 새 채널을 추가해도 해당 채널의 이벤트가 하나도 없으면 필터 칩에는 안 보이는 게 정상이다.
