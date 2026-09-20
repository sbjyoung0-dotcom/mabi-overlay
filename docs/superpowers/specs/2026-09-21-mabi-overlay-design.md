# mabi-overlay 설계

작성일: 2026-09-21

## 목적

마비노기 모바일 PC 클라이언트 위에 띄우는 투명 오버레이. MoFo(`mofo.exe`)의 가공 시설 HUD와 같은 동작을 재구현하고, 채집 즐겨찾기 버튼을 추가한다. 게임 정보는 넥슨 공식 `MabinogiMobile_CLI.exe`를 오버레이가 직접 호출해서 받는다. AI 도구(Claude 등)는 관여하지 않는다.

## 범위

포함:
- 가공 HUD: 6개 시설 타일, 시설당 슬롯 7칸, 남은 시간, 완료 수령 버튼
- 채집 즐겨찾기: "아이템명 × 반복 횟수" 버튼, 진행률 패널, 중단
- 상태 배지: 게임 꺼짐 / MM AI 에이전트 꺼짐, 날개 잔량, 도구 상태, 무게
- 오버레이 기본: 항상 위, 투명, 위젯 영역만 클릭, F8 완전 관통, 위치 잠금/드래그
- ⚙ 설정: 즐겨찾기 추가·삭제, 시설 표시 여부, 위치 잠금

제외 (CLI가 지원하지 않음):
- 물물교환 — 2026-09-21 기준 `capabilities` 28개 명령에 없음. 명령이 추가되면 ⚙ 설정의 "미지원 명령" 목록에 자동 표시되며, 버튼 추가는 후속 작업으로 한다.
- 착용 장비 조회 — `get_items`는 소모품·재료만 다루고 장비·의상·펫은 제외.
- 미디어 리모컨, 연주 테마 등 MoFo의 나머지 기능.

## 기술 선택

- Electron (Node 24 이미 설치, Rust 없음). 결과물은 `dist/mabi-overlay/` 폴더(약 200MB) + `mabi-overlay.exe`, 설치 없이 폴더째 이동 가능.
- 렌더러는 프레임워크 없는 HTML/JS. 위젯이 둘뿐이라 React가 필요 없다.
- WebView2가 아닌 Electron 내장 Chromium을 쓰므로 런타임 의존성 없음.

## 구조

```
mabi-overlay/
├─ package.json
├─ main/
│  ├─ index.js     BrowserWindow 생성: transparent, frame:false, alwaysOnTop('screen-saver'),
│  │               skipTaskbar, 전체 화면 크기. setIgnoreMouseEvents(true,{forward:true}) 기본.
│  ├─ cli.js       CLI 래퍼. 경로 탐색(MABINOGI_CLI_PATH → C:/D:/E:\Nexon\MabinogiMobile\).
│  │               run(command, body) → {exitCode, json}. 비ASCII 바디는 base64: 접두.
│  │               응답은 %LOCALAPPDATA%\MabinogiMobileCLI\last-response.json(UTF-8)을 우선 읽고,
│  │               없으면 stdout을 JSON.parse.
│  ├─ altering.js  3초 주기 get_altering_works 폴링. 채집 루프 중에는 폴링 정지.
│  ├─ gather.js    채집 루프 상태기계. 한 번에 하나만 실행.
│  ├─ config.js    %APPDATA%\mabi-overlay\config.json 읽기/쓰기.
│  └─ ipc.js       렌더러 ↔ 메인 채널 정의.
└─ renderer/
   ├─ index.html
   ├─ altering.js  가공 HUD
   ├─ gather.js    즐겨찾기 버튼 + 진행 패널
   ├─ settings.js  ⚙ 패널
   └─ interact.js  위젯 영역 hover 감지 → 메인에 setIgnoreMouseEvents 토글 요청, F8 처리
```

## CLI 계약 (2026-09-21 capabilities 기준)

| 명령 | 용도 | 비고 |
|---|---|---|
| `status` | 연결 확인 | exit 5: reason `game_off` / `option_off` |
| `capabilities` | 명령 목록 | 시작 시 1회 캐시, exit 4 시 재조회 |
| `get_altering_works` | 가공 슬롯 | 항목: DisplayName, FacilityName, State(InProgress/Completed), IsCompleted, RemainingSeconds |
| `complete_altering_work` `{displayName}` | 시설 단위 수령 | 이동 포함 블로킹. 에러: no_completed_work_at_facility, not_completed_yet, blocked, overweight 등 |
| `get_gatherable_items` `[filter]` | 채집 가능 목록 | DisplayName, ToolOk |
| `execute_gathering` `{displayName}` | 1회 최대 100개 채집 | 블로킹(게임 9분 타임아웃). 호출당 정령의 날개 5개. 응답: result completed/stopped 또는 error overweight/tool_broken/blocked/timeout/canceled/not_enough_currency. gained, target, cost 포함 |
| `stop_action` | 진행 중 행동 중지 | 채집 중단에 사용 |
| `get_currencies` | 날개 잔량 | 패널 갱신용 |
| `get_inventory` | 무게 현재/최대 | 패널 갱신용 |

CLI 종료코드: 0 성공(단, 바디의 status/error 별도 확인), 2 사용법 오류, 3 취소, 4 미지원 명령, 5 연결 없음.

## 가공 HUD 동작 (MoFo와 동일 규칙)

- 시설 6종은 FacilityName/DisplayName 키워드로 분류: 금속, 목재, 가죽, 옷감, 약품(약품·포자·진액·연금), 식재료(식재료·요리·음식).
- 슬롯 색: 완료(`IsCompleted || State==="Completed"`) 주황, 진행 중 파랑(남은 시간 mm:ss), 대기 회색, 빈 슬롯 투명.
- 시설 타일에 완료 건이 1개 이상이면 "완료 N" 버튼. 클릭 → 해당 시설의 완료 항목 중 첫 번째 DisplayName으로 `complete_altering_work` 호출 → 응답 후 즉시 재폴링.
- 헤더에 "수령 가능 N건" 배지.
- 1행/2행 레이아웃 전환 버튼.

## 채집 루프

```
클릭 → 확인 다이얼로그
      "통나무 × 10회 (최대 1,000개) · 정령의 날개 50개 소모 · 현재 잔량 N개"
      → 시작
루프 i = 1..N:
   execute_gathering {displayName}   (블로킹, 타임아웃 없이 대기)
   응답 분류:
     result: completed        → 누적 gained += gained, 계속
     result: stopped          → 누적 후 종료, message 표시 (유저가 게임에서 멈춤)
     error: overweight        → 종료, "무게 초과"
     error: tool_broken       → 종료, "도구 파손"
     error: blocked (kind)    → 종료, "게임 화면 확인 필요: {kind}"
     error: timeout           → 누적 후 계속 (게임 9분 제한, 채집은 이미 진행됨)
     error: not_enough_currency → 종료, 필요/보유 표시
     exit 5                   → 종료, 연결 배지
중단 버튼 → stop_action 호출, 다음 회차 시작 안 함, 현재 회차 응답은 기다림
```

진행 패널: `i/N회 · 누적 gained개 · 날개 잔량(응답 cost에서) · 무게 현재/최대 · 도구 OK/파손`. 루프 종료 후 사유를 10초간 표시.

루프 중 제약: 가공 폴링 정지, 다른 즐겨찾기 버튼 비활성, 수령 버튼 비활성. CLI는 한 번에 하나만 실행한다.

## 마우스 관통

- 창 전체는 기본 관통(`setIgnoreMouseEvents(true, {forward:true})`).
- 렌더러가 `mouseenter`/`mouseleave`로 위젯 영역 진입을 감지해 메인에 `set-interactive(true/false)` 전송.
- F8: 완전 관통 토글(위젯도 클릭 불가). 전역 단축키 `globalShortcut.register('F8')`.
- 위치 잠금 해제 시 위젯을 드래그해 이동, 좌표는 config.json에 저장.

## 오류 처리

- 시작 시 `status` 확인. exit 5면 HUD 상단 배지: `game_off` → "게임을 실행하세요", `option_off` → "설정에서 MM AI 에이전트를 켜세요". 10초마다 재시도.
- CLI 실행 파일을 못 찾으면 배지 "CLI 없음: MABINOGI_CLI_PATH 설정" 표시.
- exit 4 → `capabilities` 재조회 1회 후 재시도, 그래도 4면 해당 기능 버튼 비활성.
- JSON 파싱 실패 → 해당 폴링 건너뜀, 연속 3회 실패 시 배지.
- 자식 프로세스는 렌더러가 아닌 메인에서만 실행하고, 종료 시 진행 중인 CLI 프로세스를 정리한다.

## 설정 파일

`%APPDATA%\mabi-overlay\config.json`
```json
{
  "favorites": [{ "displayName": "통나무", "repeat": 10 }],
  "visibleFacilities": { "metal": true, "wood": true, "leather": true, "cloth": true, "medicine": true, "food": true },
  "layout": "2row",
  "positions": { "altering": { "x": 100, "y": 100 }, "gather": { "x": 100, "y": 300 } },
  "locked": true
}
```
⚙ 설정의 즐겨찾기 추가는 `get_gatherable_items` 목록에서 선택 + 반복 횟수 입력. 목록은 패널 열 때마다 새로 조회.

## 검증

- 단위 테스트(node:test): `cli.js`(경로 탐색, base64 인코딩, 종료코드/응답 분류), `gather.js`(completed 연속, overweight 중단, blocked 중단, timeout 계속, 사용자 중단). CLI는 가짜 실행 파일(스크립트)로 대체.
- 수동 검증: 게임 실행 상태에서 (1) 가공 슬롯 표시와 수령 1회, (2) 채집 1회(날개 5개 소모 — 실행 전 사용자에게 알림), (3) F8·드래그·잠금, (4) 게임 종료 시 배지 전환.

## 결과물

`npm run build` → `dist/mabi-overlay/mabi-overlay.exe` + 동반 파일. 코드 서명 없음(SmartScreen 경고 1회).
