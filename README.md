# mabi-overlay

마비노기 모바일 PC 클라이언트 위에 띄우는 투명 오버레이. 가공 시설 현황·수령, 채집/가공 즐겨찾기, 자동 재가공.
게임 정보는 넥슨 공식 `MabinogiMobile_CLI.exe`를 직접 호출해서 받는다. AI 도구는 필요 없다.

## 실행 전
1. 게임 설정 → [게임/기타] → **MM AI 에이전트 활성화** 켜기 (CLI가 자동 설치됨)
2. **MoFo 등 다른 CLI 호출 프로그램은 끈다** — 동시에 돌리면 응답이 섞인다
3. CLI 위치가 기본(`C:\Nexon\MabinogiMobile\`)이 아니면 환경변수 `MABINOGI_CLI_PATH`에 전체 경로 지정

## 개발
```
npm install
npm test
npm start
```

## 배포판 만들기
```
npm run build
```
→ `dist/win-unpacked/mabi-overlay.exe` (폴더째 옮겨서 실행. 코드 서명 없음 → 첫 실행 시 SmartScreen "추가 정보 → 실행").

## 조작
- 위젯 밖은 게임으로 클릭이 통과한다. **F8**: 위젯까지 완전 관통 토글.
- 🔒 클릭 → ✋: 헤더를 드래그해 위치 이동. 다시 클릭해 잠금.
- ⚙: 채집/가공 즐겨찾기(게임 연결 상태에서 목록 불러오기), 자동 재가공, 시설 표시.
- 🔁: 자동 재가공 전체 일시정지/재개.

## 비용
- `execute_gathering` 1회(최대 100개) = 정령의 날개 5개
- `execute_altering` 1건 = 정령의 날개 5개 (자동 재가공도 동일, 오늘 누적치는 가공 등록 위젯에 표시)

## 설정 파일
`%APPDATA%\mabi-overlay\config.json`
