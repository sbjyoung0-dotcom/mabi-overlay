# mabi-overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마비노기 모바일 위에 띄우는 Electron 투명 오버레이 — 가공 시설 HUD(수령 버튼) + 채집/가공 즐겨찾기 + 자동 재가공 — 을 넥슨 공식 `MabinogiMobile_CLI.exe`만 호출해서 구현한다.

**Architecture:** 메인 프로세스(Node)가 CLI를 자식 프로세스로 실행하고 결과를 IPC로 렌더러에 보낸다. CLI 호출은 `cli-lock`으로 직렬화한다(채집 루프 > 수동 버튼 > 자동 재가공 > 폴링). 렌더러는 프레임워크 없는 HTML/JS 위젯 3개(가공/채집/가공 등록)와 설정 모달이다. 모든 게임 로직은 메인의 순수 모듈에 두고 `node:test`로 검증한다.

**Tech Stack:** Node 24, Electron(최신 안정), electron-builder(dir 타깃), node:test. Rust 없음.

**Spec:** `docs/superpowers/specs/2026-09-21-mabi-overlay-design.md`

## Global Constraints

- 플랫폼: Windows 11, Node 24.19, Electron. Rust/cargo 사용 금지.
- CLI 경로: `MABINOGI_CLI_PATH` 환경변수 → `C:\Nexon\MabinogiMobile\MabinogiMobile_CLI.exe` → `D:\...` → `E:\...` 순.
- CLI 응답은 **stdout을 JSON.parse**한다. `last-response.json`은 쓰지 않는다.
- 비ASCII 바디는 `base64:` + UTF-8 base64로 보낸다.
- 조회 명령은 바디를 그대로, 행동 명령은 `{status, body}` 래퍼로 온다. 둘 다 처리한다.
- 종료코드: 0 성공, 2 usage, 3 canceled, 4 unknown_command, 5 disconnected(`reason`: `game_off`|`option_off`).
- `execute_gathering` 1회 = 최대 100개, 날개 5개. `execute_altering` 1회 = 가공 1건, 날개 5개. 시설당 슬롯 7칸.
- 가공 폴링 주기 3초. 연결 확인 10초. 자동 재가공 실패 재시도 60초, 3회 연속 실패 시 해제.
- CLI는 한 번에 하나만 실행(cli-lock). 채집 루프 중 폴링·자동 재가공 정지.
- 설정 파일: `%APPDATA%\mabi-overlay\config.json`.
- 코드는 CommonJS, `'use strict'`. 테스트는 `node:test` + `node:assert/strict`. 파일명은 kebab-case.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `package.json`, `.gitignore` | 스크립트(start/test/build), electron-builder 설정 |
| `shared/channels.js` | IPC 채널 이름 상수(메인·렌더러 공용, UMD) |
| `main/config.js` | config.json 기본값·읽기·쓰기 |
| `main/cli.js` | CLI 경로 탐색, 바디 인코딩, stdout 파싱, 종료코드 분류, `run()` |
| `main/cli-lock.js` | 우선순위 직렬화 잠금 |
| `main/altering.js` | 시설 분류, 슬롯 그룹핑, 3초 폴러 |
| `main/gather-loop.js` | 채집 N회 루프, 중단, 결과 해석 |
| `main/alter-queue.js` | 가공 N건 등록, 자동 재가공, 자동 소모 날개 누적 |
| `main/connection.js` | `status` 기반 연결 감시 |
| `main/game-status.js` | 날개 잔량·무게 조회 |
| `main/ipc.js` | IPC 핸들러 등록 |
| `main/preload.js` | `window.mabi` 브리지 |
| `main/index.js` | 창 생성, 모듈 조립, F8 |
| `renderer/index.html`, `style.css` | 위젯 마크업·스타일 |
| `renderer/util.js` | DOM 헬퍼, 확인 모달, 시간 포맷 |
| `renderer/altering-hud.js` | 가공 HUD 렌더 |
| `renderer/gather-panel.js` | 채집 버튼·진행 패널 |
| `renderer/alter-panel.js` | 가공 등록 버튼·진행·자동 상태 |
| `renderer/settings.js` | ⚙ 모달 |
| `renderer/interact.js` | 마우스 관통 토글, 드래그, F8 배너 |
| `renderer/app.js` | 부트스트랩·이벤트 배선 |
| `tests/helpers/fake-spawn.js` | 가짜 spawn |
| `tests/helpers/memory-config.js` | 메모리 config |
| `tests/*.test.js` | 모듈별 테스트 |
| `README.md` | 실행/빌드 안내 |

---

### Task 1: 프로젝트 스캐폴드 + config.js

**Files:**
- Create: `package.json`, `.gitignore`, `main/config.js`, `tests/config.test.js`

**Interfaces:**
- Produces: `createConfig({ filePath, fsImpl? }) → { filePath, get(): Config, set(patch): Config }`, `DEFAULTS`
- Config 형태:
  ```js
  { gatherFavorites: [{ displayName, repeat }], alterFavorites: [{ displayName, count, autoRequeue }],
    visibleFacilities: { metal, wood, leather, cloth, medicine, food }, layout: '1row'|'2row',
    positions: { altering:{x,y}, gather:{x,y}, alter:{x,y} }, locked: boolean, autoSpentWings: { date, amount } }
  ```

- [ ] **Step 1: package.json, .gitignore 작성 후 electron 설치**

`package.json`:
```json
{
  "name": "mabi-overlay",
  "version": "0.1.0",
  "private": true,
  "description": "Mabinogi Mobile altering/gathering overlay (uses official MabinogiMobile_CLI)",
  "main": "main/index.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test \"tests/**/*.test.js\"",
    "build": "electron-builder --win dir"
  },
  "build": {
    "appId": "local.mabi-overlay",
    "productName": "mabi-overlay",
    "directories": { "output": "dist" },
    "files": ["main/**", "renderer/**", "shared/**", "package.json"],
    "win": { "target": "dir" }
  }
}
```
`.gitignore`:
```
node_modules/
dist/
```
Run: `npm install --save-dev electron electron-builder`
Expected: `node_modules/electron` 생성, package.json에 devDependencies 추가.

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/config.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfig, DEFAULTS } = require('../main/config');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mabi-cfg-'));
  return path.join(dir, 'sub', 'config.json');
}

test('파일이 없으면 기본값', () => {
  const cfg = createConfig({ filePath: tmpFile() });
  assert.deepEqual(cfg.get(), DEFAULTS);
});

test('set은 얕은 병합 후 저장하고, 다시 열면 유지된다', () => {
  const file = tmpFile();
  const cfg = createConfig({ filePath: file });
  cfg.set({ locked: false, gatherFavorites: [{ displayName: '통나무', repeat: 10 }] });
  const again = createConfig({ filePath: file });
  assert.equal(again.get().locked, false);
  assert.deepEqual(again.get().gatherFavorites, [{ displayName: '통나무', repeat: 10 }]);
  assert.equal(again.get().layout, '2row');
});

test('get은 복사본을 준다', () => {
  const cfg = createConfig({ filePath: tmpFile() });
  cfg.get().gatherFavorites.push({ displayName: 'x', repeat: 1 });
  assert.equal(cfg.get().gatherFavorites.length, 0);
});

test('깨진 파일은 기본값으로 대체', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{oops', 'utf8');
  assert.deepEqual(createConfig({ filePath: file }).get(), DEFAULTS);
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/config'`

- [ ] **Step 4: 구현** — `main/config.js`

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  gatherFavorites: [],   // [{ displayName, repeat }]
  alterFavorites: [],    // [{ displayName, count, autoRequeue }]
  visibleFacilities: { metal: true, wood: true, leather: true, cloth: true, medicine: true, food: true },
  layout: '2row',        // '1row' | '2row'
  positions: { altering: { x: 100, y: 100 }, gather: { x: 100, y: 320 }, alter: { x: 100, y: 460 } },
  locked: true,
  autoSpentWings: { date: null, amount: 0 },
});

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function createConfig({ filePath, fsImpl = fs }) {
  let data = clone(DEFAULTS);
  try {
    data = { ...clone(DEFAULTS), ...JSON.parse(fsImpl.readFileSync(filePath, 'utf8')) };
  } catch { /* 파일 없음 또는 깨짐 → 기본값 */ }

  function save() {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    fsImpl.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    filePath,
    get: () => clone(data),
    set(patch) { data = { ...data, ...clone(patch) }; save(); return clone(data); },
  };
}

module.exports = { DEFAULTS, createConfig };
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: 4 pass.

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json .gitignore main/config.js tests/config.test.js
git commit -m "feat: 프로젝트 스캐폴드와 config 모듈

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: cli.js — CLI 실행 래퍼

**Files:**
- Create: `main/cli.js`, `tests/helpers/fake-spawn.js`, `tests/cli.test.js`

**Interfaces:**
- Produces:
  - `findCliPath({ env?, exists? }) → string|null`
  - `encodeBody(body) → string|undefined`
  - `parseStdout(stdout) → { status, body }|null`
  - `classify(exitCode, parsed) → Result`
  - `createCli({ cliPath, spawn? }) → { run(command, body?): Promise<Result>, cliPath }`
  - `Result = { ok: boolean, kind: 'ok'|'rejected'|'invalid_body'|'usage'|'canceled'|'unknown_command'|'disconnected'|'parse_error'|'cli_missing'|'error', exitCode, status?, body, error?, message?, reason? }`
  - 테스트 헬퍼 `createFakeSpawn(responses) → { spawn, calls }` — `responses`는 배열 `[{ stdout, exitCode, error, wait }]` 또는 함수 `(command, bodyArg, n) => 응답`

- [ ] **Step 1: 가짜 spawn 헬퍼** — `tests/helpers/fake-spawn.js`

```js
'use strict';
const { EventEmitter } = require('node:events');

// spawn을 흉내 낸다. 응답은 배열(호출 순서대로, 마지막 항목 반복) 또는 함수(command, bodyArg, n).
// 응답 필드: stdout(문자열), exitCode(기본 0), error(Error → 'error' 이벤트), wait(Promise → 끝날 때까지 close 지연)
function createFakeSpawn(responses) {
  const calls = [];
  let idx = 0;
  const spawn = (file, args) => {
    const command = args[0];
    const bodyArg = args[1];
    calls.push({ file, command, bodyArg });
    const r = typeof responses === 'function'
      ? responses(command, bodyArg, calls.length)
      : responses[Math.min(idx++, responses.length - 1)];
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', 3);
    setImmediate(async () => {
      if (r.wait) await r.wait;
      if (r.error) { child.emit('error', r.error); return; }
      if (r.stdout) child.stdout.emit('data', Buffer.from(r.stdout, 'utf8'));
      child.emit('close', r.exitCode ?? 0);
    });
    return child;
  };
  return { spawn, calls };
}

module.exports = { createFakeSpawn };
```

- [ ] **Step 2: 실패하는 테스트** — `tests/cli.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findCliPath, encodeBody, parseStdout, classify, createCli } = require('../main/cli');
const { createFakeSpawn } = require('./helpers/fake-spawn');

test('findCliPath: 환경변수가 최우선', () => {
  const p = findCliPath({ env: { MABINOGI_CLI_PATH: 'X:\\cli.exe' }, exists: (f) => f === 'X:\\cli.exe' });
  assert.equal(p, 'X:\\cli.exe');
});

test('findCliPath: 기본 경로 중 존재하는 첫 번째', () => {
  const p = findCliPath({ env: {}, exists: (f) => f.startsWith('D:') });
  assert.equal(p, 'D:\\Nexon\\MabinogiMobile\\MabinogiMobile_CLI.exe');
});

test('findCliPath: 없으면 null', () => {
  assert.equal(findCliPath({ env: {}, exists: () => false }), null);
});

test('encodeBody: 없음/ASCII/객체', () => {
  assert.equal(encodeBody(undefined), undefined);
  assert.equal(encodeBody(null), undefined);
  assert.equal(encodeBody('abc'), 'abc');
  assert.equal(encodeBody({ a: 1 }), '{"a":1}');
});

test('encodeBody: 비ASCII는 base64: 접두', () => {
  assert.equal(encodeBody('안녕'), 'base64:7JWI64WV');
  const json = '{"displayName":"통나무"}';
  assert.equal(encodeBody({ displayName: '통나무' }), 'base64:' + Buffer.from(json, 'utf8').toString('base64'));
});

test('parseStdout: 래퍼 없는 조회 응답은 status ok로 감싼다', () => {
  assert.deepEqual(parseStdout('{"completedCount":0,"works":[]}\n'), { status: 'ok', body: { completedCount: 0, works: [] } });
  assert.deepEqual(parseStdout('[]'), { status: 'ok', body: [] });
});

test('parseStdout: status/body 래퍼 유지, \\u 이스케이프 복원', () => {
  const r = parseStdout('{"status":"accepted","body":{"result":"started","cost":"\\uC815\\uB839"}}');
  assert.equal(r.status, 'accepted');
  assert.equal(r.body.cost, '정령');
});

test('parseStdout: 빈 문자열/깨진 JSON은 null', () => {
  assert.equal(parseStdout(''), null);
  assert.equal(parseStdout('{oops'), null);
});

test('classify: exit 5 → disconnected + reason', () => {
  const r = classify(5, { status: 'ok', body: { pipe: 'disconnected', reason: 'option_off' } });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'disconnected');
  assert.equal(r.reason, 'option_off');
});

test('classify: exit 0 rejected', () => {
  const r = classify(0, { status: 'rejected', body: { error: 'not_found', message: 'x' } });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'rejected');
  assert.equal(r.error, 'not_found');
  assert.equal(r.message, 'x');
});

test('classify: exit 0 accepted는 ok, body.error는 호출자가 본다', () => {
  const r = classify(0, { status: 'accepted', body: { error: 'overweight', gained: 40, target: 100 } });
  assert.equal(r.ok, true);
  assert.equal(r.body.error, 'overweight');
});

test('classify: exit 4 unknown_command, exit 0 + null → parse_error', () => {
  assert.equal(classify(4, null).kind, 'unknown_command');
  assert.equal(classify(0, null).kind, 'parse_error');
});

test('createCli.run: 명령과 인코딩된 바디를 넘기고 결과를 분류', async () => {
  const { spawn, calls } = createFakeSpawn([{ stdout: '{"status":"accepted","body":{"result":"started"}}' }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const r = await cli.run('execute_altering', { displayName: '상급 가죽' });
  assert.equal(calls[0].file, 'X:\\cli.exe');
  assert.equal(calls[0].command, 'execute_altering');
  assert.match(calls[0].bodyArg, /^base64:/);
  assert.equal(r.ok, true);
  assert.equal(r.body.result, 'started');
});

test('createCli.run: 바디 없으면 인자 하나', async () => {
  const { spawn, calls } = createFakeSpawn([{ stdout: '{"pipe":"connected"}' }]);
  await createCli({ cliPath: 'X:\\cli.exe', spawn }).run('status');
  assert.equal(calls[0].bodyArg, undefined);
});

test('createCli.run: cliPath null → cli_missing (spawn 안 함)', async () => {
  const cli = createCli({ cliPath: null, spawn: () => { throw new Error('should not spawn'); } });
  assert.equal((await cli.run('status')).kind, 'cli_missing');
});

test('createCli.run: spawn ENOENT → cli_missing', async () => {
  const err = Object.assign(new Error('nope'), { code: 'ENOENT' });
  const { spawn } = createFakeSpawn([{ error: err }]);
  assert.equal((await createCli({ cliPath: 'X:\\cli.exe', spawn }).run('status')).kind, 'cli_missing');
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/cli'`

- [ ] **Step 4: 구현** — `main/cli.js`

```js
'use strict';
const fs = require('node:fs');
const childProcess = require('node:child_process');

const DEFAULT_PATHS = [
  'C:\\Nexon\\MabinogiMobile\\MabinogiMobile_CLI.exe',
  'D:\\Nexon\\MabinogiMobile\\MabinogiMobile_CLI.exe',
  'E:\\Nexon\\MabinogiMobile\\MabinogiMobile_CLI.exe',
];

function findCliPath({ env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [env.MABINOGI_CLI_PATH, ...DEFAULT_PATHS].filter(Boolean);
  return candidates.find((p) => exists(p)) || null;
}

// 문자열은 그대로, 객체는 JSON. 비ASCII가 있으면 base64: 접두 (Windows 콘솔 코드페이지 회피)
function encodeBody(body) {
  if (body === undefined || body === null) return undefined;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  if (/^[\x00-\x7f]*$/.test(text)) return text;
  return 'base64:' + Buffer.from(text, 'utf8').toString('base64');
}

// 조회 명령은 바디를 그대로, 행동 명령은 {status, body} 래퍼 → 항상 {status, body}로 정규화
function parseStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'status' in parsed && 'body' in parsed) {
    return { status: parsed.status, body: parsed.body };
  }
  return { status: 'ok', body: parsed };
}

const EXIT_KINDS = { 2: 'usage', 3: 'canceled', 4: 'unknown_command', 5: 'disconnected' };

function classify(exitCode, parsed) {
  if (exitCode !== 0) {
    const body = parsed ? parsed.body : null;
    return {
      ok: false, kind: EXIT_KINDS[exitCode] || 'error', exitCode, body,
      reason: body && body.reason, message: body && body.message,
    };
  }
  if (!parsed) return { ok: false, kind: 'parse_error', exitCode, body: null };
  const { status, body } = parsed;
  if (status === 'rejected' || status === 'invalid_body') {
    return { ok: false, kind: status, exitCode, body, error: body && body.error, message: body && body.message };
  }
  return { ok: true, kind: 'ok', exitCode, status, body };
}

function createCli({ cliPath, spawn = childProcess.spawn } = {}) {
  function run(command, body) {
    return new Promise((resolve) => {
      if (!cliPath) { resolve({ ok: false, kind: 'cli_missing', exitCode: null, body: null }); return; }
      const args = [command];
      const encoded = encodeBody(body);
      if (encoded !== undefined) args.push(encoded);
      let child;
      try {
        child = spawn(cliPath, args, { windowsHide: true });
      } catch (err) {
        resolve({ ok: false, kind: 'cli_missing', exitCode: null, body: null, message: err.message });
        return;
      }
      const chunks = [];
      child.stdout.on('data', (c) => chunks.push(c));
      child.on('error', (err) => {
        resolve({ ok: false, kind: err.code === 'ENOENT' ? 'cli_missing' : 'error', exitCode: null, body: null, message: err.message });
      });
      child.on('close', (code) => {
        resolve(classify(code, parseStdout(Buffer.concat(chunks).toString('utf8'))));
      });
    });
  }
  return { run, cliPath };
}

module.exports = { DEFAULT_PATHS, findCliPath, encodeBody, parseStdout, classify, createCli };
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: config 4 + cli 16 pass.

- [ ] **Step 6: 커밋**

```bash
git add main/cli.js tests/helpers/fake-spawn.js tests/cli.test.js
git commit -m "feat: CLI 실행 래퍼 (경로 탐색, base64 바디, 응답 분류)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: cli-lock.js — 우선순위 직렬화

**Files:**
- Create: `main/cli-lock.js`, `tests/cli-lock.test.js`

**Interfaces:**
- Produces: `PRIORITY = { GATHER: 0, MANUAL: 1, AUTO: 2, POLL: 3 }`, `createLock() → { run(priority, fn): Promise, tryRun(priority, fn): Promise|null, isBusy(): boolean, busyPriority(): number|null }`
- `run`은 대기열에 넣고 우선순위(낮은 숫자 먼저, 같으면 선입선출)로 실행. `tryRun`은 잠금이 비어 있을 때만 실행하고 아니면 `null`.

- [ ] **Step 1: 실패하는 테스트** — `tests/cli-lock.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLock, PRIORITY } = require('../main/cli-lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('run: 순차 실행, 동시에 두 개가 돌지 않는다', async () => {
  const lock = createLock();
  const log = [];
  const job = (name, ms) => async () => { log.push(name + ':start'); await sleep(ms); log.push(name + ':end'); };
  await Promise.all([lock.run(PRIORITY.POLL, job('a', 20)), lock.run(PRIORITY.POLL, job('b', 5))]);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('run: 대기열은 우선순위 숫자가 낮은 것 먼저', async () => {
  const lock = createLock();
  const log = [];
  const p0 = lock.run(PRIORITY.POLL, () => sleep(20));
  const pAuto = lock.run(PRIORITY.AUTO, async () => log.push('auto'));
  const pGather = lock.run(PRIORITY.GATHER, async () => log.push('gather'));
  await Promise.all([p0, pAuto, pGather]);
  assert.deepEqual(log, ['gather', 'auto']);
});

test('tryRun: 바쁘면 null, 비어 있으면 실행', async () => {
  const lock = createLock();
  const p = lock.run(PRIORITY.GATHER, () => sleep(10));
  assert.equal(lock.isBusy(), true);
  assert.equal(lock.busyPriority(), PRIORITY.GATHER);
  assert.equal(lock.tryRun(PRIORITY.POLL, async () => 1), null);
  await p;
  assert.equal(lock.isBusy(), false);
  assert.equal(await lock.tryRun(PRIORITY.POLL, async () => 1), 1);
});

test('run: 작업이 던져도 다음 작업은 계속', async () => {
  const lock = createLock();
  await assert.rejects(lock.run(PRIORITY.MANUAL, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await lock.run(PRIORITY.MANUAL, async () => 'ok'), 'ok');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/cli-lock'`

- [ ] **Step 3: 구현** — `main/cli-lock.js`

```js
'use strict';

// CLI는 한 번에 하나만. 숫자가 낮을수록 먼저 실행된다.
const PRIORITY = { GATHER: 0, MANUAL: 1, AUTO: 2, POLL: 3 };

function createLock() {
  let current = null;   // { priority }
  const queue = [];     // { priority, fn, resolve, reject, seq }
  let seq = 0;

  function next() {
    if (current || queue.length === 0) return;
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const job = queue.shift();
    current = { priority: job.priority };
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => { current = null; next(); });
  }

  function run(priority, fn) {
    return new Promise((resolve, reject) => {
      queue.push({ priority, fn, resolve, reject, seq: seq++ });
      next();
    });
  }

  function tryRun(priority, fn) {
    if (current || queue.length > 0) return null;
    return run(priority, fn);
  }

  return {
    run,
    tryRun,
    isBusy: () => current !== null,
    busyPriority: () => (current ? current.priority : null),
  };
}

module.exports = { PRIORITY, createLock };
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 모두 pass.

- [ ] **Step 5: 커밋**

```bash
git add main/cli-lock.js tests/cli-lock.test.js
git commit -m "feat: CLI 우선순위 직렬화 잠금

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: altering.js — 시설 분류·그룹핑·폴러

**Files:**
- Create: `main/altering.js`, `tests/altering.test.js`

**Interfaces:**
- Consumes: `createCli().run`, `createLock()`, `PRIORITY`
- Produces:
  - `FACILITIES = [{ key, name, short, color, keywords }]` (metal, wood, leather, cloth, medicine, food)
  - `isCompleted(work) → boolean`
  - `classifyFacility(name) → key|'other'`
  - `groupWorks(works) → { [key]: { key, facilityName, works: [], completed: [] } }` (other 포함)
  - `createAlteringPoller({ cli, lock, intervalMs?, onUpdate, onError, setInterval?, clearInterval? }) → { start(), stop(), refreshNow(): Promise }`
  - `onUpdate` 인자 `Update = { completedCount, works, groups, fetchedAt }`

- [ ] **Step 1: 실패하는 테스트** — `tests/altering.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFacility, groupWorks, isCompleted, createAlteringPoller, FACILITIES } = require('../main/altering');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

const SAMPLE = [
  { DisplayName: '상급 가죽', FacilityName: '가죽 가공 시설', State: 'InProgress', IsCompleted: false, RemainingSeconds: 1214 },
  { DisplayName: '상급 가죽', FacilityName: '가죽 가공 시설', State: 'Completed', IsCompleted: true, RemainingSeconds: 0 },
  { DisplayName: '말린 찻잎', FacilityName: '식재료 가공 시설', State: 'NotStarted', IsCompleted: false, RemainingSeconds: 3000 },
  { DisplayName: '버섯 포자', FacilityName: '약품 가공 시설', State: 'InProgress', IsCompleted: false, RemainingSeconds: 10 },
];

test('FACILITIES는 6개, 키 순서 고정', () => {
  assert.deepEqual(FACILITIES.map((f) => f.key), ['metal', 'wood', 'leather', 'cloth', 'medicine', 'food']);
});

test('classifyFacility: 키워드로 분류, 모르면 other', () => {
  assert.equal(classifyFacility('가죽 가공 시설'), 'leather');
  assert.equal(classifyFacility('식재료 가공 시설'), 'food');
  assert.equal(classifyFacility('연금 공방'), 'medicine');
  assert.equal(classifyFacility('알 수 없음'), 'other');
  assert.equal(classifyFacility(undefined), 'other');
});

test('isCompleted: IsCompleted 또는 State Completed', () => {
  assert.equal(isCompleted({ IsCompleted: true }), true);
  assert.equal(isCompleted({ State: 'Completed' }), true);
  assert.equal(isCompleted({ State: 'InProgress', IsCompleted: false }), false);
});

test('groupWorks: 시설별로 묶고 완료 목록을 따로 둔다', () => {
  const g = groupWorks(SAMPLE);
  assert.equal(g.leather.works.length, 2);
  assert.equal(g.leather.completed.length, 1);
  assert.equal(g.leather.facilityName, '가죽 가공 시설');
  assert.equal(g.food.works.length, 1);
  assert.equal(g.medicine.works.length, 1);
  assert.equal(g.metal.works.length, 0);
  assert.equal(g.other.works.length, 0);
});

test('poller.refreshNow: 정상 응답이면 onUpdate', async () => {
  const { spawn } = createFakeSpawn([{ stdout: JSON.stringify({ completedCount: 1, works: SAMPLE }) }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const updates = [];
  const poller = createAlteringPoller({ cli, lock: createLock(), onUpdate: (u) => updates.push(u), onError: () => assert.fail('no error') });
  await poller.refreshNow();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].completedCount, 1);
  assert.equal(updates[0].groups.leather.completed.length, 1);
});

test('poller: 잠금이 바쁘면 이번 주기를 건너뛴다', async () => {
  const { spawn, calls } = createFakeSpawn([{ stdout: '{"completedCount":0,"works":[]}' }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = createLock();
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => setTimeout(r, 15)));
  const poller = createAlteringPoller({ cli, lock, onUpdate: () => {}, onError: () => {} });
  await poller.refreshNow();
  assert.equal(calls.length, 0);
  await hold;
  await poller.refreshNow();
  assert.equal(calls.length, 1);
});

test('poller: 연결 끊김이면 onError', async () => {
  const { spawn } = createFakeSpawn([{ stdout: '{"pipe":"disconnected","reason":"game_off"}', exitCode: 5 }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const errors = [];
  const poller = createAlteringPoller({ cli, lock: createLock(), onUpdate: () => assert.fail('no update'), onError: (r) => errors.push(r) });
  await poller.refreshNow();
  assert.equal(errors[0].kind, 'disconnected');
  assert.equal(errors[0].reason, 'game_off');
});

test('poller.start/stop: 주입한 setInterval을 쓴다', async () => {
  const { spawn } = createFakeSpawn([{ stdout: '{"completedCount":0,"works":[]}' }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  let registered = null; let cleared = null;
  const poller = createAlteringPoller({
    cli, lock: createLock(), intervalMs: 3000, onUpdate: () => {}, onError: () => {},
    setInterval: (fn, ms) => { registered = { fn, ms }; return 42; },
    clearInterval: (id) => { cleared = id; },
  });
  poller.start();
  assert.equal(registered.ms, 3000);
  poller.stop();
  assert.equal(cleared, 42);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/altering'`

- [ ] **Step 3: 구현** — `main/altering.js`

```js
'use strict';
const { PRIORITY } = require('./cli-lock');

// MoFo와 같은 6개 시설 분류. keywords는 FacilityName(없으면 DisplayName)에 부분 일치.
const FACILITIES = [
  { key: 'metal', name: '금속 가공 시설', short: '금속', color: '#94a3b8', keywords: ['금속'] },
  { key: 'wood', name: '목재 가공 시설', short: '목재', color: '#a16207', keywords: ['목재', '나무'] },
  { key: 'leather', name: '가죽 가공 시설', short: '가죽', color: '#c2410c', keywords: ['가죽'] },
  { key: 'cloth', name: '옷감 가공 시설', short: '옷감', color: '#7c3aed', keywords: ['옷감', '직물', '천 '] },
  { key: 'medicine', name: '약품 가공 시설', short: '약품', color: '#16a34a', keywords: ['약품', '포자', '진액', '연금'] },
  { key: 'food', name: '식재료 가공 시설', short: '식재료', color: '#fbbf24', keywords: ['식재료', '요리', '음식'] },
];

function isCompleted(w) { return w.IsCompleted === true || w.State === 'Completed'; }

function classifyFacility(name) {
  const n = name || '';
  const f = FACILITIES.find((fac) => fac.keywords.some((k) => n.includes(k)));
  return f ? f.key : 'other';
}

function groupWorks(works) {
  const groups = {};
  for (const f of FACILITIES) groups[f.key] = { key: f.key, facilityName: null, works: [], completed: [] };
  groups.other = { key: 'other', facilityName: null, works: [], completed: [] };
  for (const w of works || []) {
    const g = groups[classifyFacility(w.FacilityName || w.DisplayName)];
    g.facilityName = g.facilityName || w.FacilityName || null;
    g.works.push(w);
    if (isCompleted(w)) g.completed.push(w);
  }
  return groups;
}

function createAlteringPoller({ cli, lock, intervalMs = 3000, onUpdate, onError, setInterval: si = setInterval, clearInterval: ci = clearInterval }) {
  let timer = null;
  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const p = lock.tryRun(PRIORITY.POLL, () => cli.run('get_altering_works'));
      if (!p) return; // CLI 사용 중 → 이번 주기 건너뜀
      const r = await p;
      if (r.ok && r.body && Array.isArray(r.body.works)) {
        onUpdate({ completedCount: r.body.completedCount || 0, works: r.body.works, groups: groupWorks(r.body.works), fetchedAt: Date.now() });
      } else {
        onError(r);
      }
    } finally {
      running = false;
    }
  }

  return {
    start() { if (!timer) { timer = si(poll, intervalMs); poll(); } },
    stop() { if (timer) { ci(timer); timer = null; } },
    refreshNow: poll,
  };
}

module.exports = { FACILITIES, isCompleted, classifyFacility, groupWorks, createAlteringPoller };
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 모두 pass.

- [ ] **Step 5: 커밋**

```bash
git add main/altering.js tests/altering.test.js
git commit -m "feat: 가공 시설 분류·그룹핑·폴러

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: gather-loop.js — 채집 N회 루프

**Files:**
- Create: `main/gather-loop.js`, `tests/gather-loop.test.js`

**Interfaces:**
- Consumes: `cli.run`, `lock.run`, `PRIORITY.GATHER`
- Produces:
  - `interpretGatherResult(result) → { action: 'continue'|'stop', reason, message, gained, target?, cost? }`
  - `createGatherLoop({ cli, lock, onProgress }) → { start({ displayName, repeat }): Promise<Summary>, stop(): Promise, isRunning(): boolean }`
  - `onProgress` 인자: `{ running, displayName, repeat, i, gainedTotal, lastCost, status: 'started'|'gathering'|'iteration_done'|'stopping'|'done', lastMessage?, done?, reason?, message? }`

- [ ] **Step 1: 실패하는 테스트** — `tests/gather-loop.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretGatherResult, createGatherLoop } = require('../main/gather-loop');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

const accepted = (body) => ({ stdout: JSON.stringify({ status: 'accepted', body }) });
const rejected = (body) => ({ stdout: JSON.stringify({ status: 'rejected', body }) });

test('interpret: completed → continue, gained 누적', () => {
  const it = interpretGatherResult({ ok: true, body: { result: 'completed', gained: 100, target: 100, cost: '5 spent' } });
  assert.equal(it.action, 'continue'); assert.equal(it.gained, 100); assert.equal(it.cost, '5 spent');
});

test('interpret: timeout은 계속, blocked/overweight/stopped는 정지', () => {
  assert.equal(interpretGatherResult({ ok: true, body: { error: 'timeout', gained: 30 } }).action, 'continue');
  const b = interpretGatherResult({ ok: true, body: { error: 'blocked', kind: 'Popup', gained: 0 } });
  assert.equal(b.action, 'stop'); assert.match(b.message, /Popup/);
  assert.equal(interpretGatherResult({ ok: true, body: { error: 'overweight', gained: 40 } }).message, '무게 초과');
  assert.equal(interpretGatherResult({ ok: true, body: { result: 'stopped', gained: 12 } }).reason, 'stopped');
});

test('interpret: rejected/disconnected는 정지', () => {
  assert.equal(interpretGatherResult({ ok: false, kind: 'rejected', error: 'not_enough_currency' }).message, '정령의 날개 부족');
  assert.equal(interpretGatherResult({ ok: false, kind: 'disconnected', reason: 'game_off' }).reason, 'disconnected');
});

test('loop: N회 모두 completed면 N번 호출하고 합산', async () => {
  const { spawn, calls } = createFakeSpawn([accepted({ result: 'completed', gained: 100, target: 100 })]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const events = [];
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: (p) => events.push(p) });
  const s = await loop.start({ displayName: '통나무', repeat: 3 });
  assert.equal(calls.filter((c) => c.command === 'execute_gathering').length, 3);
  assert.equal(s.reason, 'completed'); assert.equal(s.gainedTotal, 300); assert.equal(s.i, 3);
  assert.equal(events.at(-1).running, false);
  assert.equal(loop.isRunning(), false);
});

test('loop: 2회차 overweight면 거기서 멈춘다', async () => {
  const { spawn, calls } = createFakeSpawn([
    accepted({ result: 'completed', gained: 100, target: 100 }),
    accepted({ error: 'overweight', gained: 40, target: 100 }),
  ]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const s = await createGatherLoop({ cli, lock: createLock(), onProgress: () => {} }).start({ displayName: '통나무', repeat: 5 });
  assert.equal(calls.length, 2); assert.equal(s.reason, 'overweight'); assert.equal(s.gainedTotal, 140); assert.equal(s.i, 2);
});

test('loop: 첫 호출이 rejected면 0회', async () => {
  const { spawn, calls } = createFakeSpawn([rejected({ error: 'tool_missing', message: 'no tool' })]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const s = await createGatherLoop({ cli, lock: createLock(), onProgress: () => {} }).start({ displayName: '통나무', repeat: 5 });
  assert.equal(calls.length, 1); assert.equal(s.reason, 'tool_missing'); assert.equal(s.message, '도구 없음');
});

test('loop.stop: stop_action을 즉시 호출하고 다음 회차를 시작하지 않는다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { spawn, calls } = createFakeSpawn((command) => (command === 'execute_gathering'
    ? { ...accepted({ result: 'completed', gained: 100, target: 100 }), wait: gate }
    : accepted({ result: 'stopped' })));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: () => {} });
  const done = loop.start({ displayName: '통나무', repeat: 5 });
  await new Promise((r) => setImmediate(r));
  assert.equal(loop.isRunning(), true);
  await loop.stop();
  release();
  const s = await done;
  assert.equal(s.reason, 'user_stop');
  assert.deepEqual(calls.map((c) => c.command), ['execute_gathering', 'stop_action']);
});

test('loop: 실행 중 start는 거부', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { spawn } = createFakeSpawn([{ ...accepted({ result: 'completed', gained: 1 }), wait: gate }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: () => {} });
  const p = loop.start({ displayName: 'a', repeat: 1 });
  await assert.rejects(loop.start({ displayName: 'b', repeat: 1 }), /already running/);
  release(); await p;
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/gather-loop'`

- [ ] **Step 3: 구현** — `main/gather-loop.js`

```js
'use strict';
const { PRIORITY } = require('./cli-lock');

const STOP_MESSAGES = {
  overweight: '무게 초과', tool_broken: '도구 파손', tool_missing: '도구 없음', canceled: '게임에서 취소됨',
  not_enough_currency: '정령의 날개 부족', no_route: '경로 없음', not_in_field: '필드가 아님',
  required_consumable_missing: '필요 소모품 없음', insufficient_living_skill_level: '생활 스킬 레벨 부족',
  not_found: '아이템 없음', cost_payment_failed: '날개 결제 실패',
};

// execute_gathering 한 번의 결과 → 루프를 계속할지
function interpretGatherResult(r) {
  if (!r.ok) {
    if (r.kind === 'disconnected') return { action: 'stop', reason: 'disconnected', message: '게임 연결 끊김', gained: 0 };
    const reason = r.error || r.kind;
    return { action: 'stop', reason, message: STOP_MESSAGES[reason] || r.message || reason, gained: 0 };
  }
  const b = r.body || {};
  const gained = Number(b.gained) || 0;
  if (b.error === 'timeout') return { action: 'continue', reason: 'timeout', message: '9분 제한, 이어서 진행', gained, target: b.target, cost: b.cost };
  if (b.error === 'blocked') return { action: 'stop', reason: 'blocked', message: `게임 화면 확인 필요: ${b.kind || ''}`.trim(), gained, cost: b.cost };
  if (b.error) return { action: 'stop', reason: b.error, message: STOP_MESSAGES[b.error] || b.message || b.error, gained, cost: b.cost };
  if (b.result === 'stopped') return { action: 'stop', reason: 'stopped', message: b.message || '중지됨', gained, cost: b.cost };
  return { action: 'continue', reason: 'completed', message: '', gained, target: b.target, cost: b.cost };
}

function createGatherLoop({ cli, lock, onProgress }) {
  let state = null; // { displayName, repeat, i, gainedTotal, lastCost, stopRequested }

  function emit(extra) { onProgress({ running: true, ...state, ...extra }); }

  async function start({ displayName, repeat }) {
    if (state) throw new Error('already running');
    state = { displayName, repeat, i: 0, gainedTotal: 0, lastCost: null, stopRequested: false };
    emit({ status: 'started' });
    let reason = 'completed';
    let message = `${repeat}회 완료`;
    await lock.run(PRIORITY.GATHER, async () => {
      for (let i = 1; i <= repeat; i++) {
        if (state.stopRequested) { reason = 'user_stop'; message = '사용자 중단'; break; }
        state.i = i;
        emit({ status: 'gathering' });
        const it = interpretGatherResult(await cli.run('execute_gathering', { displayName }));
        state.gainedTotal += it.gained;
        state.lastCost = it.cost || state.lastCost;
        if (state.stopRequested) { reason = 'user_stop'; message = '사용자 중단'; break; }
        if (it.action === 'stop') { reason = it.reason; message = it.message; break; }
        emit({ status: 'iteration_done', lastMessage: it.message });
      }
    });
    const summary = { done: true, status: 'done', reason, message, displayName, repeat, i: state.i, gainedTotal: state.gainedTotal, lastCost: state.lastCost };
    state = null;
    onProgress({ running: false, ...summary });
    return summary;
  }

  // 잠금을 거치지 않고 stop_action을 바로 보낸다 — 진행 중인 채집을 게임에서 멈추게 하기 위해
  async function stop() {
    if (!state) return;
    state.stopRequested = true;
    emit({ status: 'stopping' });
    await cli.run('stop_action');
  }

  return { start, stop, isRunning: () => state !== null };
}

module.exports = { interpretGatherResult, createGatherLoop };
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 모두 pass.

- [ ] **Step 5: 커밋**

```bash
git add main/gather-loop.js tests/gather-loop.test.js
git commit -m "feat: 채집 N회 루프와 중단

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: alter-queue.js — 가공 N건 등록 + 자동 재가공

**Files:**
- Create: `main/alter-queue.js`, `tests/helpers/memory-config.js`, `tests/alter-queue.test.js`

**Interfaces:**
- Consumes: `cli.run`, `lock.run`, `PRIORITY.MANUAL/AUTO`, `config.get/set`, `Update.groups` (Task 4)
- Produces:
  - `WINGS_PER_CALL = 5`
  - `interpretAlterResult(result) → { ok, reason?, message?, result?, cost?, collected? }`
  - `addAutoSpent(config, amount, nowMs) → { date, amount }`
  - `createAlterQueue({ cli, lock, config, onProgress?, onAutoEvent?, now?, retryMs?, maxFailures? }) → { enqueue({ displayName, count }): Promise<Summary>, handleWorksUpdate(update): Promise, pauseAuto(bool), isAutoPaused(): boolean }`
  - `onProgress`: `{ running, displayName, count, registered, stoppedReason?, stoppedMessage?, lastCost? }`
  - `onAutoEvent`: `{ type: 'collecting'|'requeued'|'paused'|'disabled', displayName, count?, index?, message?, retryAfter?, autoSpentWings? }`

- [ ] **Step 1: 메모리 config 헬퍼** — `tests/helpers/memory-config.js`

```js
'use strict';
const { DEFAULTS } = require('../../main/config');

function createMemoryConfig(initial = {}) {
  let data = JSON.parse(JSON.stringify({ ...DEFAULTS, ...initial }));
  return {
    filePath: ':memory:',
    get: () => JSON.parse(JSON.stringify(data)),
    set(patch) { data = { ...data, ...JSON.parse(JSON.stringify(patch)) }; return JSON.parse(JSON.stringify(data)); },
  };
}

module.exports = { createMemoryConfig };
```

- [ ] **Step 2: 실패하는 테스트** — `tests/alter-queue.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretAlterResult, addAutoSpent, createAlterQueue, WINGS_PER_CALL } = require('../main/alter-queue');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { groupWorks } = require('../main/altering');
const { createFakeSpawn } = require('./helpers/fake-spawn');
const { createMemoryConfig } = require('./helpers/memory-config');

const accepted = (body) => ({ stdout: JSON.stringify({ status: 'accepted', body }) });
const rejected = (body) => ({ stdout: JSON.stringify({ status: 'rejected', body }) });
const started = accepted({ result: 'started', cost: '5 spent' });
const work = (name, fac, done) => ({ DisplayName: name, FacilityName: fac, State: done ? 'Completed' : 'InProgress', IsCompleted: done, RemainingSeconds: done ? 0 : 100 });
const update = (works) => ({ completedCount: works.filter((w) => w.IsCompleted).length, works, groups: groupWorks(works), fetchedAt: 0 });

function setup(responses, cfg, opts = {}) {
  const { spawn, calls } = createFakeSpawn(responses);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = opts.lock || createLock();
  const config = createMemoryConfig(cfg);
  const events = [];
  const q = createAlterQueue({ cli, lock, config, onAutoEvent: (e) => events.push(e), ...opts });
  return { q, calls, config, events, lock };
}

test('interpretAlterResult: started/rejected/body.error', () => {
  assert.deepEqual(interpretAlterResult({ ok: true, body: { result: 'started', cost: 'c' } }), { ok: true, result: 'started', cost: 'c', collected: undefined });
  assert.equal(interpretAlterResult({ ok: false, kind: 'rejected', error: 'not_enough_ingredient' }).message, '재료 부족');
  assert.equal(interpretAlterResult({ ok: true, body: { error: 'blocked', kind: 'Dialog' } }).reason, 'blocked');
});

test('addAutoSpent: 같은 날은 누적, 날짜 바뀌면 리셋', () => {
  const config = createMemoryConfig();
  const day1 = new Date(2026, 8, 21, 10).getTime();
  const day2 = new Date(2026, 8, 22, 1).getTime();
  assert.deepEqual(addAutoSpent(config, 5, day1), { date: '2026-09-21', amount: 5 });
  assert.deepEqual(addAutoSpent(config, 5, day1), { date: '2026-09-21', amount: 10 });
  assert.deepEqual(addAutoSpent(config, 5, day2), { date: '2026-09-22', amount: 5 });
});

test('enqueue: N건 모두 started', async () => {
  const { q, calls } = setup([started]);
  const s = await q.enqueue({ displayName: '상급 가죽', count: 3 });
  assert.equal(calls.length, 3);
  assert.equal(s.registered, 3); assert.equal(s.stoppedReason, null); assert.equal(s.lastCost, '5 spent');
});

test('enqueue: 2건째 거부되면 멈춘다', async () => {
  const { q, calls } = setup([started, rejected({ error: 'not_enough_ingredient' })]);
  const s = await q.enqueue({ displayName: '상급 가죽', count: 5 });
  assert.equal(calls.length, 2);
  assert.equal(s.registered, 1); assert.equal(s.stoppedReason, 'not_enough_ingredient'); assert.equal(s.stoppedMessage, '재료 부족');
});

test('auto: 켜진 즐겨찾기의 완료 건을 수령하고 같은 수만큼 재등록', async () => {
  const { q, calls, config, events } = setup(
    (command) => (command === 'complete_altering_work' ? accepted({ collected: 2 }) : started),
    { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] },
    { now: () => new Date(2026, 8, 21).getTime() },
  );
  await q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true), work('상급 가죽', '가죽 가공 시설', true), work('상급 가죽', '가죽 가공 시설', false)]));
  assert.deepEqual(calls.map((c) => c.command), ['complete_altering_work', 'execute_altering', 'execute_altering']);
  assert.equal(config.get().autoSpentWings.amount, 2 * WINGS_PER_CALL);
  assert.deepEqual(events.map((e) => e.type), ['collecting', 'requeued', 'requeued']);
});

test('auto: 꺼진 즐겨찾기나 일시정지 상태면 아무것도 안 한다', async () => {
  const { q, calls } = setup([started], { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: false }] });
  await q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(calls.length, 0);
  const on = setup([started], { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] });
  on.q.pauseAuto(true);
  await on.q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(on.calls.length, 0);
});

test('auto: 실패하면 60초 대기, 3회 연속이면 토글 해제', async () => {
  let t = 1_000_000;
  const { q, calls, config, events } = setup(
    (command) => (command === 'complete_altering_work' ? accepted({ collected: 1 }) : rejected({ error: 'not_enough_ingredient' })),
    { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] },
    { now: () => t, retryMs: 60_000, maxFailures: 3 },
  );
  const u = update([work('상급 가죽', '가죽 가공 시설', true)]);
  await q.handleWorksUpdate(u);
  assert.equal(events.at(-1).type, 'paused');
  await q.handleWorksUpdate(u);            // 60초 안 지남 → 건너뜀
  assert.equal(calls.length, 2);
  t += 61_000; await q.handleWorksUpdate(u);
  t += 61_000; await q.handleWorksUpdate(u);
  assert.equal(events.at(-1).type, 'disabled');
  assert.equal(config.get().alterFavorites[0].autoRequeue, false);
});

test('auto: 채집 루프(GATHER)가 잠금을 잡고 있으면 끝날 때까지 기다린다', async () => {
  const lock = createLock();
  let release;
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => { release = r; }));
  const { q, calls } = setup(
    (command) => (command === 'complete_altering_work' ? accepted({ collected: 1 }) : started),
    { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] },
    { lock },
  );
  const p = q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0);
  release(); await hold; await p;
  assert.equal(calls.length, 2);
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/alter-queue'`

- [ ] **Step 4: 구현** — `main/alter-queue.js`

```js
'use strict';
const { PRIORITY } = require('./cli-lock');

const WINGS_PER_CALL = 5;

const REJECT_MESSAGES = {
  not_enough_ingredient: '재료 부족', not_available: '큐가 가득 참', not_enough_currency: '정령의 날개 부족',
  requires_user_interaction: '게임에서 직접 시작해야 하는 레시피', insufficient_facility_level: '시설 레벨 부족',
  ingredient_locked: '재료 잠김', insufficient_transfer_cost: '이송 비용 부족', blocked: '게임 화면 확인 필요',
  not_in_field: '필드가 아님', overweight: '무게 초과', facility_not_found: '시설 없음', not_found: '레시피 없음',
  no_completed_work_at_facility: '해당 시설에 완료된 가공 없음', not_completed_yet: '아직 완료되지 않음',
  no_altering: '가공 중인 작업 없음', timeout: '응답 시간 초과', canceled: '취소됨', cost_payment_failed: '날개 결제 실패',
};

// execute_altering / complete_altering_work 결과 해석
function interpretAlterResult(r) {
  if (!r.ok) {
    const reason = r.error || r.kind;
    return { ok: false, reason, message: REJECT_MESSAGES[reason] || r.message || reason };
  }
  const b = r.body || {};
  if (b.error) return { ok: false, reason: b.error, message: REJECT_MESSAGES[b.error] || b.message || b.error, cost: b.cost };
  return { ok: true, result: b.result, cost: b.cost, collected: b.collected };
}

function todayKey(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 자동 재가공으로 쓴 날개를 오늘 기준으로 누적 (자정 리셋)
function addAutoSpent(config, amount, nowMs) {
  const cur = config.get().autoSpentWings || { date: null, amount: 0 };
  const date = todayKey(nowMs);
  const next = cur.date === date ? { date, amount: cur.amount + amount } : { date, amount };
  config.set({ autoSpentWings: next });
  return next;
}

function createAlterQueue({ cli, lock, config, onProgress = () => {}, onAutoEvent = () => {}, now = Date.now, retryMs = 60_000, maxFailures = 3 }) {
  let autoPaused = false;
  let autoBusy = false;
  const itemState = {}; // displayName → { failures, retryAfter }

  async function enqueue({ displayName, count }) {
    let registered = 0; let stoppedReason = null; let stoppedMessage = null; let lastCost = null;
    onProgress({ running: true, displayName, count, registered });
    await lock.run(PRIORITY.MANUAL, async () => {
      for (let i = 0; i < count; i++) {
        const it = interpretAlterResult(await cli.run('execute_altering', { displayName }));
        if (!it.ok) { stoppedReason = it.reason; stoppedMessage = it.message; break; }
        registered++;
        lastCost = it.cost || lastCost;
        onProgress({ running: true, displayName, count, registered });
      }
    });
    const summary = { running: false, displayName, count, registered, stoppedReason, stoppedMessage, lastCost };
    onProgress(summary);
    return summary;
  }

  function failItem(displayName, message) {
    const s = itemState[displayName] || { failures: 0, retryAfter: 0 };
    s.failures += 1;
    s.retryAfter = now() + retryMs;
    itemState[displayName] = s;
    if (s.failures >= maxFailures) {
      const favs = config.get().alterFavorites.map((f) => (f.displayName === displayName ? { ...f, autoRequeue: false } : f));
      config.set({ alterFavorites: favs });
      s.failures = 0;
      onAutoEvent({ type: 'disabled', displayName, message });
    } else {
      onAutoEvent({ type: 'paused', displayName, message, retryAfter: s.retryAfter });
    }
  }

  // 폴링 결과에서 자동 재가공 대상(완료 + 토글 켜짐)을 골라 수령 → 같은 수만큼 재등록
  async function handleWorksUpdate(update) {
    if (autoPaused || autoBusy) return;
    const autoNames = new Set(config.get().alterFavorites.filter((f) => f.autoRequeue).map((f) => f.displayName));
    if (autoNames.size === 0) return;
    const t = now();
    const targets = [];
    for (const g of Object.values(update.groups)) {
      const counts = {};
      for (const w of g.completed) if (autoNames.has(w.DisplayName)) counts[w.DisplayName] = (counts[w.DisplayName] || 0) + 1;
      for (const [displayName, count] of Object.entries(counts)) {
        const s = itemState[displayName];
        if (s && s.retryAfter > t) continue;
        targets.push({ displayName, count });
      }
    }
    if (targets.length === 0) return;
    autoBusy = true;
    try {
      await lock.run(PRIORITY.AUTO, async () => {
        for (const { displayName, count } of targets) {
          onAutoEvent({ type: 'collecting', displayName, count });
          const col = interpretAlterResult(await cli.run('complete_altering_work', { displayName }));
          if (!col.ok) { failItem(displayName, col.message); continue; }
          let ok = true;
          for (let i = 0; i < count; i++) {
            const it = interpretAlterResult(await cli.run('execute_altering', { displayName }));
            if (!it.ok) { failItem(displayName, it.message); ok = false; break; }
            const autoSpentWings = addAutoSpent(config, WINGS_PER_CALL, now());
            onAutoEvent({ type: 'requeued', displayName, index: i + 1, count, autoSpentWings });
          }
          if (ok) itemState[displayName] = { failures: 0, retryAfter: 0 };
        }
      });
    } finally {
      autoBusy = false;
    }
  }

  return {
    enqueue,
    handleWorksUpdate,
    pauseAuto: (v) => { autoPaused = !!v; },
    isAutoPaused: () => autoPaused,
  };
}

module.exports = { WINGS_PER_CALL, interpretAlterResult, addAutoSpent, createAlterQueue };
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: 모두 pass.

- [ ] **Step 6: 커밋**

```bash
git add main/alter-queue.js tests/helpers/memory-config.js tests/alter-queue.test.js
git commit -m "feat: 가공 N건 등록과 자동 재가공

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: connection.js + game-status.js

**Files:**
- Create: `main/connection.js`, `main/game-status.js`, `tests/connection.test.js`, `tests/game-status.test.js`

**Interfaces:**
- Produces:
  - `createConnectionMonitor({ cli, lock, onChange, intervalMs?, setInterval?, clearInterval? }) → { start(), stop(), check(): Promise, report(result), current() }`
  - `onChange` 인자 `ConnState = { connected: boolean, reason: null|'game_off'|'option_off'|'cli_missing'|string }` (변할 때만 호출)
  - `findWings(currencies) → number|null`
  - `fetchGameStatus({ cli, lock }) → Promise<{ wings, weight: { current, max }|null }|null>` (잠금이 바쁘면 null)

- [ ] **Step 1: 실패하는 테스트** — `tests/connection.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionMonitor } = require('../main/connection');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

function mon(responses, cliPath = 'X:\\cli.exe') {
  const { spawn } = createFakeSpawn(responses);
  const cli = createCli({ cliPath, spawn });
  const changes = [];
  const m = createConnectionMonitor({ cli, lock: createLock(), onChange: (s) => changes.push(s) });
  return { m, changes };
}

test('check: connected', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"connected"}' }]);
  await m.check();
  assert.deepEqual(changes, [{ connected: true, reason: null }]);
  assert.deepEqual(m.current(), { connected: true, reason: null });
});

test('check: exit 5 option_off', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"disconnected","reason":"option_off"}', exitCode: 5 }]);
  await m.check();
  assert.deepEqual(changes, [{ connected: false, reason: 'option_off' }]);
});

test('check: cliPath 없음 → cli_missing', async () => {
  const { m, changes } = mon([], null);
  await m.check();
  assert.deepEqual(changes, [{ connected: false, reason: 'cli_missing' }]);
});

test('같은 상태는 다시 알리지 않는다', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"connected"}' }]);
  await m.check(); await m.check();
  assert.equal(changes.length, 1);
});

test('report: 폴러가 본 disconnected를 반영', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"connected"}' }]);
  await m.check();
  m.report({ ok: false, kind: 'disconnected', reason: 'game_off' });
  assert.deepEqual(changes.at(-1), { connected: false, reason: 'game_off' });
  m.report({ ok: false, kind: 'rejected' });
  assert.equal(changes.length, 2);
});
```

`tests/game-status.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findWings, fetchGameStatus } = require('../main/game-status');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

test('findWings', () => {
  assert.equal(findWings([{ DisplayName: '골드', Amount: 1 }, { DisplayName: '정령의 날개', Amount: 28255 }]), 28255);
  assert.equal(findWings([]), null);
  assert.equal(findWings(null), null);
});

test('fetchGameStatus: 날개와 무게', async () => {
  const { spawn } = createFakeSpawn((command) => (command === 'get_currencies'
    ? { stdout: '[{"DisplayName":"정령의 날개","Amount":50}]' }
    : { stdout: '{"CurrentInventoryWeightAsDecimal":1449,"MaxInventoryWeightAsDecimal":1700}' }));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  assert.deepEqual(await fetchGameStatus({ cli, lock: createLock() }), { wings: 50, weight: { current: 1449, max: 1700 } });
});

test('fetchGameStatus: 잠금이 바쁘면 null', async () => {
  const lock = createLock();
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => setTimeout(r, 10)));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn: () => { throw new Error('no'); } });
  assert.equal(await fetchGameStatus({ cli, lock }), null);
  await hold;
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`main/connection.js`:
```js
'use strict';
const { PRIORITY } = require('./cli-lock');

function createConnectionMonitor({ cli, lock, onChange, intervalMs = 10_000, setInterval: si = setInterval, clearInterval: ci = clearInterval }) {
  let last = null;
  let timer = null;

  function publish(next) {
    if (JSON.stringify(next) !== JSON.stringify(last)) { last = next; onChange(next); }
  }

  async function check() {
    if (!cli.cliPath) { publish({ connected: false, reason: 'cli_missing' }); return; }
    const p = lock.tryRun(PRIORITY.POLL, () => cli.run('status'));
    if (!p) return;
    const r = await p;
    if (r.ok && r.body && r.body.pipe === 'connected') publish({ connected: true, reason: null });
    else publish({ connected: false, reason: r.reason || r.kind });
  }

  return {
    start() { if (!timer) { timer = si(check, intervalMs); check(); } },
    stop() { if (timer) { ci(timer); timer = null; } },
    check,
    report(result) {
      if (result && result.kind === 'disconnected') publish({ connected: false, reason: result.reason || 'disconnected' });
    },
    current: () => last,
  };
}

module.exports = { createConnectionMonitor };
```

`main/game-status.js`:
```js
'use strict';
const { PRIORITY } = require('./cli-lock');

function findWings(currencies) {
  const c = (currencies || []).find((x) => x.DisplayName === '정령의 날개');
  return c ? c.Amount : null;
}

// 날개 잔량 + 무게. 잠금이 바쁘면(채집/가공 중) null — 호출자는 이전 값을 유지한다.
async function fetchGameStatus({ cli, lock }) {
  const job = lock.tryRun(PRIORITY.POLL, async () => ({ cur: await cli.run('get_currencies'), inv: await cli.run('get_inventory') }));
  if (!job) return null;
  const { cur, inv } = await job;
  return {
    wings: cur.ok ? findWings(cur.body) : null,
    weight: inv.ok && inv.body ? { current: inv.body.CurrentInventoryWeightAsDecimal, max: inv.body.MaxInventoryWeightAsDecimal } : null,
  };
}

module.exports = { findWings, fetchGameStatus };
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 모두 pass.

- [ ] **Step 5: 커밋**

```bash
git add main/connection.js main/game-status.js tests/connection.test.js tests/game-status.test.js
git commit -m "feat: 연결 감시와 날개/무게 조회

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: shared/channels.js + ipc.js + preload.js

**Files:**
- Create: `shared/channels.js`, `main/ipc.js`, `main/preload.js`, `tests/ipc.test.js`

**Interfaces:**
- Produces:
  - `CH` 상수(아래). 렌더러에서는 `window.CH`, 메인에서는 `require('../shared/channels')`.
  - `registerIpc({ ipcMain, services })` — `services = { config, cli, lock, gather, alterQueue, poller, setInteractive(bool), quit() }`
  - `listOf(result) → { items: Array|null, message? }`
  - `window.mabi = { invoke(channel, payload): Promise, on(channel, handler): unsubscribe }`

- [ ] **Step 1: 채널 상수** — `shared/channels.js`

```js
(function (root) {
  'use strict';
  const CH = {
    // renderer → main (invoke)
    CONFIG_GET: 'config:get',
    CONFIG_SET: 'config:set',
    GATHER_START: 'gather:start',
    GATHER_STOP: 'gather:stop',
    ALTER_ENQUEUE: 'alter:enqueue',
    ALTER_COLLECT: 'alter:collect',
    ALTER_REFRESH: 'alter:refresh',
    AUTO_PAUSE: 'auto:pause',
    LIST_GATHERABLE: 'lists:gatherable',
    LIST_ALTERABLE: 'lists:alterable',
    STATUS_GET: 'status:get',
    WINDOW_INTERACTIVE: 'window:set-interactive',
    WINDOW_QUIT: 'window:quit',
    // main → renderer (send)
    EV_ALTERING: 'altering:update',
    EV_GATHER: 'gather:progress',
    EV_ALTER: 'alter:progress',
    EV_AUTO: 'auto:event',
    EV_CONN: 'conn:status',
    EV_CLICKTHROUGH: 'clickthrough:changed',
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CH;
  else root.CH = CH;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: 실패하는 테스트** — `tests/ipc.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CH = require('../shared/channels');
const { registerIpc, listOf } = require('../main/ipc');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');
const { createMemoryConfig } = require('./helpers/memory-config');

function fakeIpcMain() {
  const handlers = {};
  return { handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = (payload) => fn({}, payload); } } };
}

function setup(responses) {
  const { spawn, calls } = createFakeSpawn(responses);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = createLock();
  const config = createMemoryConfig();
  const log = [];
  const services = {
    config, cli, lock,
    gather: { isRunning: () => false, start: async (a) => { log.push(['gather.start', a]); }, stop: async () => log.push(['gather.stop']) },
    alterQueue: { enqueue: async (a) => { log.push(['enqueue', a]); }, pauseAuto: (v) => log.push(['pause', v]), isAutoPaused: () => true },
    poller: { refreshNow: async () => log.push(['refresh']) },
    setInteractive: (v) => log.push(['interactive', v]),
    quit: () => log.push(['quit']),
  };
  const { handlers, ipcMain } = fakeIpcMain();
  registerIpc({ ipcMain, services });
  return { handlers, calls, config, log };
}

test('모든 renderer→main 채널에 핸들러가 등록된다', () => {
  const { handlers } = setup([]);
  for (const key of Object.keys(CH).filter((k) => !k.startsWith('EV_'))) assert.ok(handlers[CH[key]], key);
});

test('config get/set', async () => {
  const { handlers } = setup([]);
  assert.equal((await handlers[CH.CONFIG_GET]()).locked, true);
  assert.equal((await handlers[CH.CONFIG_SET]({ locked: false })).locked, false);
});

test('gather start/stop, alter enqueue, auto pause, window', async () => {
  const { handlers, log } = setup([]);
  await handlers[CH.GATHER_START]({ displayName: '통나무', repeat: 2 });
  await handlers[CH.GATHER_STOP]();
  await handlers[CH.ALTER_ENQUEUE]({ displayName: 'x', count: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(await handlers[CH.AUTO_PAUSE](true), true);
  await handlers[CH.WINDOW_INTERACTIVE](true);
  await handlers[CH.WINDOW_QUIT]();
  assert.deepEqual(log.map((l) => l[0]), ['gather.start', 'gather.stop', 'enqueue', 'refresh', 'pause', 'interactive', 'quit']);
});

test('alter collect: CLI 호출 후 해석 결과를 돌려주고 재폴링', async () => {
  const { handlers, calls, log } = setup([{ stdout: '{"status":"accepted","body":{"collected":2,"message":"ok"}}' }]);
  const r = await handlers[CH.ALTER_COLLECT]({ displayName: '상급 가죽' });
  assert.equal(calls[0].command, 'complete_altering_work');
  assert.equal(r.ok, true); assert.equal(r.collected, 2);
  assert.deepEqual(log, [['refresh']]);
});

test('lists: 정상/연결 없음', async () => {
  const ok = setup([{ stdout: '{"items":[{"DisplayName":"통나무","ToolOk":true}]}' }]);
  assert.deepEqual(await ok.handlers[CH.LIST_GATHERABLE](), { items: [{ DisplayName: '통나무', ToolOk: true }] });
  const off = setup([{ stdout: '{"pipe":"disconnected","reason":"game_off"}', exitCode: 5 }]);
  const r = await off.handlers[CH.LIST_ALTERABLE]();
  assert.equal(r.items, null); assert.match(r.message, /게임 연결/);
});

test('listOf: 배열 응답도 items로', () => {
  assert.deepEqual(listOf({ ok: true, body: [{ a: 1 }] }), { items: [{ a: 1 }] });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../main/ipc'`

- [ ] **Step 4: 구현**

`main/ipc.js`:
```js
'use strict';
const CH = require('../shared/channels');
const { PRIORITY } = require('./cli-lock');
const { interpretAlterResult } = require('./alter-queue');
const { fetchGameStatus } = require('./game-status');

function listOf(r) {
  if (!r.ok) {
    return { items: null, message: r.kind === 'disconnected' ? '게임 연결 후 추가할 수 있습니다' : (r.message || r.kind) };
  }
  const items = Array.isArray(r.body) ? r.body : (r.body && r.body.items) || [];
  return { items };
}

function registerIpc({ ipcMain, services }) {
  const { config, cli, lock, gather, alterQueue, poller, setInteractive, quit } = services;
  const h = (ch, fn) => ipcMain.handle(ch, (_event, payload) => fn(payload));

  h(CH.CONFIG_GET, () => config.get());
  h(CH.CONFIG_SET, (patch) => config.set(patch));

  h(CH.GATHER_START, ({ displayName, repeat }) => {
    if (!gather.isRunning()) gather.start({ displayName, repeat }).catch(() => {});
    return true;
  });
  h(CH.GATHER_STOP, () => gather.stop());

  h(CH.ALTER_ENQUEUE, ({ displayName, count }) => {
    alterQueue.enqueue({ displayName, count }).then(() => poller.refreshNow()).catch(() => {});
    return true;
  });
  h(CH.ALTER_COLLECT, async ({ displayName }) => {
    const r = interpretAlterResult(await lock.run(PRIORITY.MANUAL, () => cli.run('complete_altering_work', { displayName })));
    await poller.refreshNow();
    return r;
  });
  h(CH.ALTER_REFRESH, () => poller.refreshNow());
  h(CH.AUTO_PAUSE, (paused) => { alterQueue.pauseAuto(paused); return alterQueue.isAutoPaused(); });

  h(CH.LIST_GATHERABLE, async () => listOf(await lock.run(PRIORITY.MANUAL, () => cli.run('get_gatherable_items'))));
  h(CH.LIST_ALTERABLE, async () => listOf(await lock.run(PRIORITY.MANUAL, () => cli.run('get_alterable_items'))));
  h(CH.STATUS_GET, () => fetchGameStatus({ cli, lock }));

  h(CH.WINDOW_INTERACTIVE, (on) => { setInteractive(!!on); return true; });
  h(CH.WINDOW_QUIT, () => { quit(); return true; });
}

module.exports = { registerIpc, listOf };
```

`main/preload.js`:
```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mabi', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: 모두 pass.

- [ ] **Step 6: 커밋**

```bash
git add shared/channels.js main/ipc.js main/preload.js tests/ipc.test.js
git commit -m "feat: IPC 채널·핸들러·preload 브리지

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: main/index.js + 렌더러 골격 — `npm start`로 오버레이가 뜬다

**Files:**
- Create: `main/index.js`, `renderer/index.html`, `renderer/style.css`, `renderer/util.js`, `renderer/app.js`(임시 최소본)

**Interfaces:**
- Consumes: Task 1~8 전부
- Produces: 실행 가능한 앱. `window.UI = { el, confirm, fmtTime, flash }`.

- [ ] **Step 1: main/index.js**

```js
'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const CH = require('../shared/channels');
const { createConfig } = require('./config');
const { findCliPath, createCli } = require('./cli');
const { createLock } = require('./cli-lock');
const { createAlteringPoller } = require('./altering');
const { createGatherLoop } = require('./gather-loop');
const { createAlterQueue } = require('./alter-queue');
const { createConnectionMonitor } = require('./connection');
const { registerIpc } = require('./ipc');

let win = null;
let fullClickThrough = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: 0, y: 0, width, height,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// 위젯 위에 마우스가 있을 때만 클릭을 받는다. F8 완전 관통 중에는 무시.
function setInteractive(on) {
  if (!win || fullClickThrough) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
}

function toggleFullClickThrough() {
  fullClickThrough = !fullClickThrough;
  if (fullClickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send(CH.EV_CLICKTHROUGH, fullClickThrough);
}

app.whenReady().then(() => {
  const config = createConfig({ filePath: path.join(app.getPath('appData'), 'mabi-overlay', 'config.json') });
  const cli = createCli({ cliPath: findCliPath() });
  const lock = createLock();
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

  const alterQueue = createAlterQueue({ cli, lock, config, onProgress: (p) => send(CH.EV_ALTER, p), onAutoEvent: (e) => send(CH.EV_AUTO, e) });
  const conn = createConnectionMonitor({ cli, lock, onChange: (s) => send(CH.EV_CONN, s) });
  const poller = createAlteringPoller({
    cli, lock,
    onUpdate: (u) => { send(CH.EV_ALTERING, u); alterQueue.handleWorksUpdate(u).catch(() => {}); },
    onError: (r) => conn.report(r),
  });
  const gather = createGatherLoop({ cli, lock, onProgress: (p) => send(CH.EV_GATHER, p) });

  createWindow();
  registerIpc({ ipcMain, services: { config, cli, lock, gather, alterQueue, poller, setInteractive, quit: () => app.quit() } });
  globalShortcut.register('F8', toggleFullClickThrough);
  win.webContents.on('did-finish-load', () => { conn.start(); poller.start(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 2: renderer/index.html**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>mabi-overlay</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="clickthrough-banner" class="hidden">F8 완전 관통 모드 — 다시 F8로 해제</div>

  <section class="widget" id="w-altering" data-widget="altering">
    <header class="widget-header">
      <span class="title">가공 현황</span>
      <span id="badge-collectable" class="badge hidden"></span>
      <span id="badge-conn" class="badge badge-warn hidden"></span>
      <span class="spacer"></span>
      <button id="btn-auto" class="icon-btn" title="자동 재가공 일시정지/재개">🔁<span id="auto-count"></span></button>
      <button id="btn-layout" class="icon-btn" title="1행/2행 전환">▤</button>
      <button id="btn-lock" class="icon-btn" title="위치 잠금/이동">🔒</button>
      <button id="btn-settings" class="icon-btn" title="설정">⚙</button>
      <button id="btn-quit" class="icon-btn" title="종료">✕</button>
    </header>
    <div id="altering-body" class="facility-grid rows-2"></div>
    <div id="altering-msg" class="msg hidden"></div>
  </section>

  <section class="widget" id="w-gather" data-widget="gather">
    <header class="widget-header"><span class="title">채집</span><span class="spacer"></span><span id="gather-status" class="sub"></span></header>
    <div id="gather-buttons" class="btn-row"></div>
    <div id="gather-progress" class="progress hidden"></div>
  </section>

  <section class="widget" id="w-alter" data-widget="alter">
    <header class="widget-header"><span class="title">가공 등록</span><span class="spacer"></span><span id="alter-status" class="sub"></span></header>
    <div id="alter-buttons" class="btn-row"></div>
    <div id="alter-progress" class="progress hidden"></div>
  </section>

  <section class="widget modal hidden" id="settings" data-widget="settings">
    <header class="widget-header"><span class="title">설정</span><span class="spacer"></span><button id="btn-settings-close" class="icon-btn">✕</button></header>
    <div id="settings-body"></div>
  </section>

  <script src="../shared/channels.js"></script>
  <script src="util.js"></script>
  <script src="altering-hud.js"></script>
  <script src="gather-panel.js"></script>
  <script src="alter-panel.js"></script>
  <script src="settings.js"></script>
  <script src="interact.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: renderer/style.css**

```css
:root { --bg: rgba(15, 23, 42, 0.82); --fg: #e2e8f0; --muted: #94a3b8; --accent: #f59e0b; }
html, body { margin: 0; width: 100vw; height: 100vh; background: transparent; overflow: hidden;
  font: 12px/1.4 'Malgun Gothic', 'Segoe UI', sans-serif; color: var(--fg); user-select: none; }
.hidden { display: none !important; }
.widget { position: absolute; background: var(--bg); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
  padding: 6px; min-width: 260px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
.widget.dragging { outline: 2px dashed var(--accent); }
.widget-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
body.unlocked .widget-header { cursor: move; }
.title { font-weight: 700; }
.spacer { flex: 1; }
.sub { color: var(--muted); font-size: 11px; }
.badge { font-size: 10px; font-weight: 800; padding: 0 5px; border-radius: 4px; background: rgba(245,158,11,0.25); color: var(--accent); }
.badge-warn { background: rgba(239,68,68,0.3); color: #fca5a5; }
.icon-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 13px; padding: 0 3px; }
.icon-btn:hover { color: var(--fg); }
.icon-btn.paused { color: #fca5a5; }
.btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: var(--fg); border-radius: 5px;
  padding: 3px 8px; cursor: pointer; font-size: 11px; }
.btn:hover { background: rgba(255,255,255,0.18); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.primary, .btn.collect { background: var(--accent); color: #000; font-weight: 800; border: none; }
.btn.danger { background: #dc2626; color: #fff; border: none; }
.btn-row { display: flex; flex-wrap: wrap; gap: 4px; }
.facility-grid { display: grid; gap: 4px; }
.facility-grid.rows-2 { grid-template-columns: repeat(3, 1fr); }
.facility-grid.rows-1 { grid-template-columns: repeat(6, 1fr); }
.facility { border: 1px solid; border-radius: 6px; padding: 4px; background: rgba(0,0,0,0.25); min-width: 78px; }
.facility-top { display: flex; justify-content: space-between; align-items: center; gap: 4px; }
.facility-name { font-weight: 700; font-size: 11px; }
.slots { display: flex; gap: 3px; margin-top: 3px; }
.slot { width: 10px; height: 6px; border-radius: 2px; background: rgba(255,255,255,0.08); }
.slot.done { background: var(--accent); box-shadow: 0 0 4px rgba(245,158,11,0.7); }
.slot.progress { background: #38bdf8; box-shadow: 0 0 5px rgba(56,189,248,0.8); }
.slot.queued { background: rgba(148,163,184,0.45); }
.progress { margin-top: 4px; padding: 4px; background: rgba(0,0,0,0.3); border-radius: 5px; display: flex; flex-direction: column; gap: 3px; }
.msg { color: var(--accent); font-size: 11px; margin-top: 3px; }
.modal { left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 380px; max-width: 540px; z-index: 10; }
.confirm-text { white-space: pre-line; margin-bottom: 8px; }
.fav-row, .add-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; flex-wrap: wrap; }
.fav-row > span:first-child { flex: 1; }
select, input[type=number] { background: rgba(0,0,0,0.4); color: var(--fg); border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; padding: 2px 4px; font-size: 11px; }
input[type=number] { width: 48px; }
select { max-width: 220px; }
h3 { font-size: 12px; margin: 8px 0 4px; color: var(--accent); }
.warn { color: #fca5a5; font-size: 11px; }
#clickthrough-banner { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); background: rgba(220,38,38,0.7);
  padding: 2px 10px; border-radius: 4px; font-size: 11px; }
body.clickthrough .widget { opacity: 0.6; }
```

- [ ] **Step 4: renderer/util.js**

```js
// DOM 헬퍼. 다른 렌더러 스크립트가 window.UI로 쓴다.
window.UI = {
  // UI.el('div', { class: 'x', text: 'hi', onclick: fn }, [children])
  el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined) e.append(c);
    return e;
  },
  // 화면 중앙 확인 모달 (.widget이라 클릭 가능). 시작=true, 취소=false
  confirm(message) {
    return new Promise((resolve) => {
      const close = (v) => { box.remove(); resolve(v); };
      const box = UI.el('div', { class: 'widget modal confirm' }, [
        UI.el('div', { class: 'confirm-text', text: message }),
        UI.el('div', { class: 'btn-row' }, [
          UI.el('button', { class: 'btn primary', text: '시작', onclick: () => close(true) }),
          UI.el('button', { class: 'btn', text: '취소', onclick: () => close(false) }),
        ]),
      ]);
      document.body.append(box);
    });
  },
  fmtTime(sec) {
    if (!(sec > 0)) return '완료';
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  },
  // 잠깐 보여주고 숨김
  flash(elm, text, ms = 10000) {
    elm.textContent = text;
    elm.classList.remove('hidden');
    clearTimeout(elm._flashTimer);
    elm._flashTimer = setTimeout(() => elm.classList.add('hidden'), ms);
  },
};
```

- [ ] **Step 5: 임시 스텁** — 아직 없는 스크립트를 빈 객체로 만들어 로드 오류를 막는다. 각 파일에 다음 한 줄만:

`renderer/altering-hud.js`: `window.AlteringHud = { render() {} };`
`renderer/gather-panel.js`: `window.GatherPanel = { renderButtons() {}, renderProgress() {}, isRunning: () => false };`
`renderer/alter-panel.js`: `window.AlterPanel = { renderButtons() {}, renderProgress() {}, renderAutoEvent() {}, isRunning: () => false };`
`renderer/settings.js`: `window.Settings = { open() {}, close() {} };`
`renderer/interact.js`: `window.Interact = { init() {}, applyPositions() {} };`

`renderer/app.js` (임시):
```js
(async () => {
  const config = await window.mabi.invoke(CH.CONFIG_GET);
  document.getElementById('gather-status').textContent = `config OK (${config.layout})`;
  window.mabi.on(CH.EV_CONN, (s) => {
    const b = document.getElementById('badge-conn');
    b.textContent = s.connected ? '' : `연결 없음: ${s.reason}`;
    b.classList.toggle('hidden', s.connected);
  });
  document.getElementById('btn-quit').addEventListener('click', () => window.mabi.invoke(CH.WINDOW_QUIT));
})();
```

- [ ] **Step 6: 실행 확인**

Run: `npm start`
Expected: 화면 전체에 투명 창, 좌상단에 "가공 현황/채집/가공 등록" 위젯 3개가 겹쳐 보임(위치는 Task 13에서 적용). 채집 위젯 헤더에 `config OK (2row)`. 게임이 꺼져 있으면 빨간 배지 `연결 없음: game_off`(또는 `cli_missing`). ✕는 아직 클릭이 안 된다(관통 기본, Task 13에서 해결) → 작업 관리자 또는 터미널 Ctrl+C로 종료.

- [ ] **Step 7: 커밋**

```bash
git add main/index.js renderer/
git commit -m "feat: Electron 창과 렌더러 골격

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: interact.js — 마우스 관통·드래그·F8 (클릭이 되게 먼저)

**Files:**
- Modify: `renderer/interact.js`, `renderer/app.js`

**Interfaces:**
- Produces: `window.Interact = { init({ isLocked(): boolean, onMove(positions) }), applyPositions(positions) }`

- [ ] **Step 1: interact.js**

```js
// 위젯 위에서만 클릭을 받고(그 외는 게임으로 관통), 잠금 해제 시 헤더 드래그로 이동한다.
window.Interact = (() => {
  const M = window.mabi;
  let interactive = false;
  let isLocked = () => true;
  let onMove = () => {};
  let drag = null;

  function applyPositions(positions) {
    for (const [key, pos] of Object.entries(positions || {})) {
      const w = document.querySelector(`.widget[data-widget="${key}"]`);
      if (w) { w.style.left = `${pos.x}px`; w.style.top = `${pos.y}px`; }
    }
  }

  function readPositions() {
    const out = {};
    for (const w of document.querySelectorAll('.widget[data-widget]')) {
      if (w.dataset.widget === 'settings') continue;
      out[w.dataset.widget] = { x: w.offsetLeft, y: w.offsetTop };
    }
    return out;
  }

  function init(opts) {
    isLocked = opts.isLocked;
    onMove = opts.onMove;

    // forward:true 덕분에 관통 상태에서도 mousemove가 온다
    document.addEventListener('mousemove', (e) => {
      const over = !!(e.target.closest && e.target.closest('.widget'));
      if (over !== interactive) { interactive = over; M.invoke(CH.WINDOW_INTERACTIVE, over); }
      if (drag) { drag.el.style.left = `${e.clientX - drag.dx}px`; drag.el.style.top = `${e.clientY - drag.dy}px`; }
    });
    document.addEventListener('mousedown', (e) => {
      if (isLocked()) return;
      const header = e.target.closest('.widget-header');
      if (!header || e.target.closest('button')) return;
      const el = header.closest('.widget');
      if (el.dataset.widget === 'settings') return;
      drag = { el, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
      el.classList.add('dragging');
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag.el.classList.remove('dragging');
      drag = null;
      onMove(readPositions());
    });
    M.on(CH.EV_CLICKTHROUGH, (on) => {
      document.getElementById('clickthrough-banner').classList.toggle('hidden', !on);
      document.body.classList.toggle('clickthrough', on);
    });
  }

  return { init, applyPositions };
})();
```

- [ ] **Step 2: app.js에 배선 추가** — 임시 app.js를 아래로 교체

```js
(async () => {
  const M = window.mabi;
  const $ = (id) => document.getElementById(id);
  let config = await M.invoke(CH.CONFIG_GET);

  async function setConfig(patch) { config = await M.invoke(CH.CONFIG_SET, patch); rerender(); return config; }

  function rerender() {
    document.body.classList.toggle('unlocked', !config.locked);
    $('btn-lock').textContent = config.locked ? '🔒' : '✋';
    Interact.applyPositions(config.positions);
  }

  Interact.init({ isLocked: () => config.locked, onMove: (positions) => setConfig({ positions }) });
  $('btn-lock').addEventListener('click', () => setConfig({ locked: !config.locked }));
  $('btn-quit').addEventListener('click', () => M.invoke(CH.WINDOW_QUIT));
  M.on(CH.EV_CONN, (s) => {
    const b = $('badge-conn');
    b.textContent = s.connected ? '' : `연결 없음: ${s.reason}`;
    b.classList.toggle('hidden', s.connected);
  });
  rerender();
})();
```

- [ ] **Step 3: 실행 확인**

Run: `npm start`
Expected: 위젯 3개가 (100,100)/(100,320)/(100,460)에 떨어져 보임. 위젯 밖에서는 클릭이 바탕화면/게임으로 통과. 🔒 클릭 → ✋로 바뀌고 헤더를 드래그해 이동 가능, 놓으면 `%APPDATA%\mabi-overlay\config.json`의 positions가 갱신됨. F8 → 상단에 빨간 배너, 위젯 반투명, 클릭 불가; 다시 F8 → 복귀. ✕로 종료.

- [ ] **Step 4: 커밋**

```bash
git add renderer/interact.js renderer/app.js
git commit -m "feat: 마우스 관통 토글·드래그 이동·F8 완전 관통

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: altering-hud.js — 가공 HUD + 수령

**Files:**
- Modify: `renderer/altering-hud.js`, `renderer/app.js`

**Interfaces:**
- Produces: `window.AlteringHud = { render(update|null, config, onCollect(displayName)) }`

- [ ] **Step 1: altering-hud.js**

```js
// 가공 시설 6타일. MoFo 규칙: 완료=주황, 진행=파랑(남은 시간), 대기=회색, 빈 슬롯=투명. 완료 건이 있으면 "완료 N" 버튼.
window.AlteringHud = (() => {
  const FACILITIES = [
    { key: 'metal', short: '금속', color: '#94a3b8' },
    { key: 'wood', short: '목재', color: '#a16207' },
    { key: 'leather', short: '가죽', color: '#c2410c' },
    { key: 'cloth', short: '옷감', color: '#7c3aed' },
    { key: 'medicine', short: '약품', color: '#16a34a' },
    { key: 'food', short: '식재료', color: '#fbbf24' },
  ];
  const isDone = (w) => w.IsCompleted === true || w.State === 'Completed';

  function slotDots(works) {
    const dots = [];
    for (let i = 0; i < 7; i++) {
      const w = works[i];
      let cls = 'slot empty';
      let title = `${i + 1}번 슬롯: 빈 슬롯`;
      if (w && isDone(w)) { cls = 'slot done'; title = `${i + 1}번 슬롯: [완료] ${w.DisplayName}`; }
      else if (w && w.State === 'InProgress') { cls = 'slot progress'; title = `${i + 1}번 슬롯: [진행 중] ${w.DisplayName} (${UI.fmtTime(w.RemainingSeconds)})`; }
      else if (w) { cls = 'slot queued'; title = `${i + 1}번 슬롯: [대기열] ${w.DisplayName}`; }
      dots.push(UI.el('span', { class: cls, title }));
    }
    return dots;
  }

  function render(update, config, onCollect) {
    const body = document.getElementById('altering-body');
    body.className = `facility-grid ${config.layout === '1row' ? 'rows-1' : 'rows-2'}`;
    body.replaceChildren();
    let total = 0;
    for (const f of FACILITIES) {
      if (config.visibleFacilities[f.key] === false) continue;
      const g = update ? update.groups[f.key] : { works: [], completed: [] };
      const inProg = g.works.find((w) => w.State === 'InProgress');
      total += g.completed.length;
      const status = g.completed.length > 0
        ? UI.el('button', {
            class: 'btn collect', text: `완료 ${g.completed.length}`,
            title: `${g.completed.length}개 완료됨 - 클릭하여 수령`,
            onclick: (e) => { e.stopPropagation(); onCollect(g.completed[0].DisplayName); },
          })
        : UI.el('span', { class: 'sub', text: inProg ? UI.fmtTime(inProg.RemainingSeconds) : (g.works.length ? '대기' : '-') });
      body.append(UI.el('div', { class: 'facility', style: `border-color:${f.color}` }, [
        UI.el('div', { class: 'facility-top' }, [UI.el('span', { class: 'facility-name', text: f.short, style: `color:${f.color}` }), status]),
        UI.el('div', { class: 'slots' }, slotDots(g.works)),
      ]));
    }
    const badge = document.getElementById('badge-collectable');
    badge.textContent = `수령 가능 ${total}건`;
    badge.classList.toggle('hidden', total === 0);
  }

  return { render };
})();
```

- [ ] **Step 2: app.js 배선** — `rerender()`와 이벤트에 추가

app.js의 `let config = ...` 아래에:
```js
  let lastUpdate = null;

  async function collect(displayName) {
    const r = await M.invoke(CH.ALTER_COLLECT, { displayName });
    UI.flash($('altering-msg'), r.ok ? `수령 완료${r.collected != null ? ` ${r.collected}건` : ''}` : `수령 실패: ${r.message}`);
  }
```
`rerender()` 안에 추가:
```js
    AlteringHud.render(lastUpdate, config, collect);
```
이벤트/버튼(Interact.init 아래):
```js
  M.on(CH.EV_ALTERING, (u) => { lastUpdate = u; AlteringHud.render(u, config, collect); });
  $('btn-layout').addEventListener('click', () => setConfig({ layout: config.layout === '1row' ? '2row' : '1row' }));
```

- [ ] **Step 3: 실행 확인 (게임 켜짐, MM AI 에이전트 켜짐, MoFo 종료)**

Run: `npm start`
Expected: 3초 안에 6개 시설 타일에 슬롯 점이 채워짐(현재 가죽 7칸, 식재료 1칸 등). 진행 중 시설에 mm:ss. ▤로 1행/2행 전환. 완료 건이 있으면 주황 "완료 N" 버튼 + 헤더 배지 "수령 가능 N건". 클릭 시 캐릭터가 시설로 이동해 수령하고 `수령 완료` 메시지, 타일이 갱신됨. (완료 건이 없으면 버튼 없음 — 정상.)

- [ ] **Step 4: 커밋**

```bash
git add renderer/altering-hud.js renderer/app.js
git commit -m "feat: 가공 HUD와 수령 버튼

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: gather-panel.js + alter-panel.js — 즐겨찾기 버튼·진행·확인창

**Files:**
- Modify: `renderer/gather-panel.js`, `renderer/alter-panel.js`, `renderer/app.js`

**Interfaces:**
- Produces:
  - `window.GatherPanel = { renderButtons(config, onStart(fav)), renderProgress(progress, gameStatus), isRunning() }`
  - `window.AlterPanel = { renderButtons(config, onStart(fav)), renderProgress(progress), renderAutoEvent(event), isRunning() }`

- [ ] **Step 1: gather-panel.js**

```js
window.GatherPanel = (() => {
  let running = false;

  function renderButtons(config, onStart) {
    const row = document.getElementById('gather-buttons');
    row.replaceChildren();
    if (config.gatherFavorites.length === 0) {
      row.append(UI.el('span', { class: 'sub', text: '⚙에서 채집 즐겨찾기를 추가하세요' }));
      return;
    }
    for (const f of config.gatherFavorites) {
      row.append(UI.el('button', {
        class: 'btn fav', text: `${f.displayName} ×${f.repeat}`,
        title: `최대 ${f.repeat * 100}개 · 정령의 날개 ${f.repeat * 5}개`,
        disabled: running, onclick: () => onStart(f),
      }));
    }
  }

  function renderProgress(p, gameStatus) {
    const box = document.getElementById('gather-progress');
    running = !!p.running;
    box.classList.remove('hidden');
    clearTimeout(box._hideTimer);
    if (p.done) {
      box.replaceChildren(UI.el('div', { text: `종료: ${p.message} · ${p.i}/${p.repeat}회 · 누적 ${p.gainedTotal}개` }));
      box._hideTimer = setTimeout(() => box.classList.add('hidden'), 10000);
      return;
    }
    const statusText = gameStatus
      ? `날개 ${gameStatus.wings ?? '?'} · 무게 ${gameStatus.weight ? `${gameStatus.weight.current}/${gameStatus.weight.max}` : '?'}`
      : '';
    box.replaceChildren(
      UI.el('div', { text: `${p.displayName} ${p.i}/${p.repeat}회 · 누적 ${p.gainedTotal}개${p.lastMessage ? ` · ${p.lastMessage}` : ''}` }),
      UI.el('div', { class: 'sub', text: statusText }),
      UI.el('button', {
        class: 'btn danger', text: p.status === 'stopping' ? '중단 중...' : '중단',
        disabled: p.status === 'stopping', onclick: () => window.mabi.invoke(CH.GATHER_STOP),
      }),
    );
  }

  return { renderButtons, renderProgress, isRunning: () => running };
})();
```

- [ ] **Step 2: alter-panel.js**

```js
window.AlterPanel = (() => {
  let running = false;

  function renderButtons(config, onStart) {
    const row = document.getElementById('alter-buttons');
    row.replaceChildren();
    if (config.alterFavorites.length === 0) {
      row.append(UI.el('span', { class: 'sub', text: '⚙에서 가공 즐겨찾기를 추가하세요' }));
      return;
    }
    for (const f of config.alterFavorites) {
      row.append(UI.el('button', {
        class: 'btn fav', text: `${f.displayName} ×${f.count}건${f.autoRequeue ? ' 🔁' : ''}`,
        title: `정령의 날개 ${f.count * 5}개${f.autoRequeue ? ' · 자동 재가공 켜짐' : ''}`,
        disabled: running, onclick: () => onStart(f),
      }));
    }
  }

  function renderProgress(p) {
    const box = document.getElementById('alter-progress');
    running = !!p.running;
    box.classList.remove('hidden');
    clearTimeout(box._hideTimer);
    if (!p.running) {
      const tail = p.stoppedReason ? ` 후 중단: ${p.stoppedMessage}` : ' 완료';
      box.replaceChildren(UI.el('div', { text: `${p.displayName} ${p.registered}/${p.count}건 등록${tail}` }));
      box._hideTimer = setTimeout(() => box.classList.add('hidden'), 10000);
      return;
    }
    box.replaceChildren(UI.el('div', { text: `${p.displayName} ${p.registered}/${p.count}건 등록 중...` }));
  }

  function renderAutoEvent(e) {
    const s = document.getElementById('alter-status');
    const map = {
      collecting: () => `자동: ${e.displayName} 수령 중`,
      requeued: () => `자동 재등록 ${e.index}/${e.count} · 오늘 자동 소모 날개 ${e.autoSpentWings.amount}`,
      paused: () => `자동 일시정지(${e.displayName}): ${e.message}`,
      disabled: () => `자동 재가공 해제(${e.displayName}): ${e.message}`,
    };
    s.textContent = (map[e.type] || (() => ''))();
  }

  return { renderButtons, renderProgress, renderAutoEvent, isRunning: () => running };
})();
```

- [ ] **Step 3: app.js 배선** — 아래를 추가

상태 변수와 헬퍼(`collect` 옆):
```js
  let gameStatus = null;
  let autoPaused = false;

  async function refreshStatus() {
    if (GatherPanel.isRunning() || AlterPanel.isRunning()) return;
    const s = await M.invoke(CH.STATUS_GET);
    if (s) gameStatus = s;
  }

  function renderButtons() {
    GatherPanel.renderButtons(config, startGather);
    AlterPanel.renderButtons(config, startAlter);
    $('auto-count').textContent = String(config.alterFavorites.filter((f) => f.autoRequeue).length || '');
  }

  const busy = () => GatherPanel.isRunning() || AlterPanel.isRunning();

  async function startGather(fav) {
    if (busy()) return;
    await refreshStatus();
    const list = await M.invoke(CH.LIST_GATHERABLE);
    const item = list.items ? list.items.find((i) => i.DisplayName === fav.displayName) : null;
    let warn = '';
    if (!list.items) warn = `\n⚠ 목록 조회 실패: ${list.message}`;
    else if (!item) warn = '\n⚠ 현재 채집 가능 목록에 없습니다 (레벨/도구 확인)';
    else if (item.ToolOk === false) warn = '\n⚠ 도구가 없거나 내구도가 0입니다';
    const ok = await UI.confirm(
      `${fav.displayName} × ${fav.repeat}회 (최대 ${fav.repeat * 100}개)\n정령의 날개 ${fav.repeat * 5}개 소모 · 현재 잔량 ${gameStatus?.wings ?? '?'}개${warn}\n시작할까요?`,
    );
    if (ok) M.invoke(CH.GATHER_START, { displayName: fav.displayName, repeat: fav.repeat });
  }

  async function startAlter(fav) {
    if (busy()) return;
    await refreshStatus();
    const list = await M.invoke(CH.LIST_ALTERABLE);
    const item = list.items ? list.items.find((i) => i.DisplayName === fav.displayName) : null;
    const per = item && item.ProducedPerWork ? ` (예상 ${item.ProducedPerWork * fav.count}개)` : '';
    let warn = '';
    if (!list.items) warn = `\n⚠ 목록 조회 실패: ${list.message}`;
    else if (item && item.Alterable === false) {
      const missing = (item.MissingIngredients || []).map((m) => `${m.DisplayName} ${m.Owned}/${m.Required}`).join(', ');
      warn = `\n⚠ 지금은 가공 불가: ${item.Reason || ''} ${missing}`.trimEnd();
    }
    const ok = await UI.confirm(
      `${fav.displayName} × ${fav.count}건${per}\n정령의 날개 ${fav.count * 5}개 소모 · 현재 잔량 ${gameStatus?.wings ?? '?'}개${warn}\n시작할까요?`,
    );
    if (ok) M.invoke(CH.ALTER_ENQUEUE, { displayName: fav.displayName, count: fav.count });
  }
```
`rerender()` 안에 `renderButtons();` 추가.
이벤트/버튼:
```js
  M.on(CH.EV_GATHER, (p) => { GatherPanel.renderProgress(p, gameStatus); renderButtons(); if (p.done) refreshStatus(); });
  M.on(CH.EV_ALTER, (p) => { AlterPanel.renderProgress(p); renderButtons(); if (!p.running) refreshStatus(); });
  M.on(CH.EV_AUTO, async (e) => { AlterPanel.renderAutoEvent(e); if (e.type === 'disabled') { config = await M.invoke(CH.CONFIG_GET); rerender(); } });
  $('btn-auto').addEventListener('click', async () => {
    autoPaused = await M.invoke(CH.AUTO_PAUSE, !autoPaused);
    $('btn-auto').classList.toggle('paused', autoPaused);
    $('btn-auto').title = autoPaused ? '자동 재가공 일시정지됨 (클릭하여 재개)' : '자동 재가공 일시정지/재개';
  });
  setInterval(refreshStatus, 30000);
  refreshStatus();
```

- [ ] **Step 4: 실행 확인**

Run: `npm start`
Expected: 채집/가공 등록 위젯에 "⚙에서 ... 추가하세요" 안내(아직 즐겨찾기 없음). 콘솔 오류 없음(`Ctrl+Shift+I`는 없으므로 `win.webContents.openDevTools()`를 임시로 index.js에 넣어 확인해도 됨 — 확인 후 제거).
임시 검증: `%APPDATA%\mabi-overlay\config.json`에 `"gatherFavorites":[{"displayName":"통나무","repeat":1}]`을 손으로 넣고 재시작 → 버튼 `통나무 ×1` 표시 → 클릭 → 확인 모달에 날개 잔량과 도구 경고 표시. **취소**를 누른다(실제 채집은 Task 15에서).

- [ ] **Step 5: 커밋**

```bash
git add renderer/gather-panel.js renderer/alter-panel.js renderer/app.js
git commit -m "feat: 채집/가공 즐겨찾기 버튼과 진행 패널

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: settings.js — ⚙ 설정 모달

**Files:**
- Modify: `renderer/settings.js`, `renderer/app.js`

**Interfaces:**
- Produces: `window.Settings = { open(config, save(patch): Promise<Config>), close() }`

- [ ] **Step 1: settings.js**

```js
// ⚙ 설정: 채집/가공 즐겨찾기 추가·삭제, 자동 재가공 토글, 시설 표시.
window.Settings = (() => {
  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let save = null;

  function favRow(text, onDelete, extra) {
    return UI.el('div', { class: 'fav-row' }, [UI.el('span', { text }), extra || null, UI.el('button', { class: 'icon-btn', text: '✕', title: '삭제', onclick: onDelete })]);
  }

  async function loadList(channel, select, format) {
    select.replaceChildren(UI.el('option', { text: '불러오는 중...' }));
    const r = await window.mabi.invoke(channel);
    select.replaceChildren();
    if (!r || !r.items) { select.append(UI.el('option', { value: '', text: (r && r.message) || '게임 연결 후 추가할 수 있습니다' })); return; }
    if (r.items.length === 0) { select.append(UI.el('option', { value: '', text: '항목 없음' })); return; }
    for (const it of r.items) select.append(UI.el('option', { value: it.DisplayName, text: format(it) }));
  }

  const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Number(v) || dflt));

  function render() {
    const root = $('settings-body');
    root.replaceChildren();

    root.append(UI.el('h3', { text: '채집 즐겨찾기' }));
    cfg.gatherFavorites.forEach((f, i) => root.append(favRow(`${f.displayName} ×${f.repeat}회`,
      () => save({ gatherFavorites: cfg.gatherFavorites.filter((_, j) => j !== i) }))));
    const gSel = UI.el('select');
    const gRep = UI.el('input', { type: 'number', min: '1', max: '20', value: '10' });
    root.append(UI.el('div', { class: 'add-row' }, [
      UI.el('button', { class: 'btn', text: '목록 불러오기', onclick: () => loadList(CH.LIST_GATHERABLE, gSel, (it) => it.DisplayName + (it.ToolOk === false ? ' (도구 없음)' : '')) }),
      gSel, gRep, UI.el('span', { text: '회' }),
      UI.el('button', { class: 'btn primary', text: '추가', onclick: () => {
        if (!gSel.value) return;
        save({ gatherFavorites: [...cfg.gatherFavorites, { displayName: gSel.value, repeat: clamp(gRep.value, 1, 20, 10) }] });
      } }),
    ]));

    root.append(UI.el('h3', { text: '가공 즐겨찾기' }));
    cfg.alterFavorites.forEach((f, i) => {
      const chk = UI.el('input', { type: 'checkbox', onchange: (e) => save({ alterFavorites: cfg.alterFavorites.map((x, j) => (j === i ? { ...x, autoRequeue: e.target.checked } : x)) }) });
      chk.checked = !!f.autoRequeue;
      root.append(favRow(`${f.displayName} ×${f.count}건`,
        () => save({ alterFavorites: cfg.alterFavorites.filter((_, j) => j !== i) }),
        UI.el('label', { class: 'sub' }, [chk, ' 자동 재가공'])));
    });
    const aSel = UI.el('select');
    const aCnt = UI.el('input', { type: 'number', min: '1', max: '7', value: '6' });
    root.append(UI.el('div', { class: 'add-row' }, [
      UI.el('button', { class: 'btn', text: '목록 불러오기', onclick: () => loadList(CH.LIST_ALTERABLE, aSel, (it) =>
        `${it.DisplayName} (1건=${it.ProducedPerWork ?? '?'}개)` + (it.Alterable === false ? ` [불가: ${it.Reason || ''}]` : '')) }),
      aSel, aCnt, UI.el('span', { text: '건' }),
      UI.el('button', { class: 'btn primary', text: '추가', onclick: () => {
        if (!aSel.value) return;
        save({ alterFavorites: [...cfg.alterFavorites, { displayName: aSel.value, count: clamp(aCnt.value, 1, 7, 6), autoRequeue: false }] });
      } }),
    ]));
    root.append(UI.el('p', { class: 'warn', text: '⚠ 자동 재가공은 클릭 없이 캐릭터를 시설로 이동시키고 건당 정령의 날개 5개를 씁니다. 전투/던전 중에는 거부되며, 3회 연속 실패하면 자동으로 꺼집니다.' }));

    root.append(UI.el('h3', { text: '시설 표시' }));
    const facRow = UI.el('div', { class: 'add-row' });
    for (const [key, label] of [['metal', '금속'], ['wood', '목재'], ['leather', '가죽'], ['cloth', '옷감'], ['medicine', '약품'], ['food', '식재료']]) {
      const c = UI.el('input', { type: 'checkbox', onchange: (e) => save({ visibleFacilities: { ...cfg.visibleFacilities, [key]: e.target.checked } }) });
      c.checked = cfg.visibleFacilities[key] !== false;
      facRow.append(UI.el('label', {}, [c, ` ${label}`]));
    }
    root.append(facRow);
  }

  function open(config, saveFn) {
    cfg = config;
    save = async (patch) => { cfg = await saveFn(patch); render(); };
    render();
    $('settings').classList.remove('hidden');
  }
  function close() { $('settings').classList.add('hidden'); }

  return { open, close };
})();
```

- [ ] **Step 2: app.js 배선**

```js
  $('btn-settings').addEventListener('click', () => Settings.open(config, setConfig));
  $('btn-settings-close').addEventListener('click', () => Settings.close());
```

- [ ] **Step 3: 실행 확인 (게임 켜짐)**

Run: `npm start`
Expected: ⚙ → 모달. "목록 불러오기" → 채집 가능 아이템 드롭다운(도구 없는 항목엔 "(도구 없음)"). 아이템 선택 + 회수 → 추가 → 즉시 모달 목록과 채집 위젯 버튼에 반영, config.json 갱신. ✕로 삭제. 가공도 동일하며 "자동 재가공" 체크 시 버튼에 🔁, 헤더 🔁 옆 숫자 증가. 시설 체크 해제 → 타일 사라짐. 게임 꺼진 상태에서 "목록 불러오기" → "게임 연결 후 추가할 수 있습니다".

- [ ] **Step 4: 커밋**

```bash
git add renderer/settings.js renderer/app.js
git commit -m "feat: 설정 모달 (즐겨찾기·자동 재가공·시설 표시)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: 연결 배지 문구 + README + 빌드

**Files:**
- Modify: `renderer/app.js`
- Create: `README.md`

- [ ] **Step 1: 연결 배지 문구** — app.js의 `EV_CONN` 핸들러를 교체

```js
  const CONN_TEXT = { game_off: '게임을 실행하세요', option_off: '설정에서 MM AI 에이전트를 켜세요', cli_missing: 'CLI 없음: MABINOGI_CLI_PATH 설정' };
  M.on(CH.EV_CONN, (s) => {
    const b = $('badge-conn');
    b.textContent = s.connected ? '' : (CONN_TEXT[s.reason] || `연결 없음: ${s.reason}`);
    b.classList.toggle('hidden', s.connected);
  });
```

- [ ] **Step 2: README.md**

```markdown
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
```

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: `dist/win-unpacked/mabi-overlay.exe` 생성. 더블클릭 → 오버레이 표시.

- [ ] **Step 4: 커밋**

```bash
git add renderer/app.js README.md
git commit -m "docs: README, 연결 배지 문구

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: 실제 게임 수동 검증 (날개 소모 — 사용자 확인 후)

**전제:** 게임 실행, MM AI 에이전트 켜짐, MoFo 종료, `npm start` 또는 빌드본 실행. **실행 전에 사용자에게 소모량(채집 5 + 가공 5 + 자동 재가공 5 = 15개 예상)을 알리고 승인받는다.**

- [ ] **Step 1: 가공 HUD** — 슬롯 표시가 `MabinogiMobile_CLI get_altering_works` 결과와 일치하는지 대조. 완료 건이 있으면 수령 클릭 → 이동·수령·메시지·재폴링 확인.
- [ ] **Step 2: 채집 1회** — ⚙에서 도구 OK인 아이템을 `×1`로 추가 → 클릭 → 확인창의 날개 잔량이 `get_currencies`와 일치 → 시작 → 진행 패널에 `1/1회` → 종료 시 `누적 N개`. 종료 사유가 `1회 완료` 또는 `무게 초과` 중 하나.
- [ ] **Step 3: 채집 중단** — `×2`로 시작 후 진행 중 "중단" 클릭 → 캐릭터가 멈추고 `사용자 중단`, `execute_gathering`이 두 번째로 호출되지 않음(진행 패널 회차가 1에 머묾).
- [ ] **Step 4: 가공 1건 등록** — 가공 가능 레시피를 `×1건`으로 추가 → 시작 → `1/1건 등록 완료` → HUD 슬롯에 대기열 점 추가.
- [ ] **Step 5: 자동 재가공** — 같은 레시피에 자동 재가공 체크. 완료될 때까지 기다리거나 이미 완료된 건이 있는 시설로 테스트 → 헤더 🔁, `자동: ... 수령 중` → `자동 재등록 1/1 · 오늘 자동 소모 날개 5`. config.json의 `autoSpentWings.amount`가 5.
- [ ] **Step 6: 연결 배지** — 게임에서 MM AI 에이전트 끄기 → 10초 내 `설정에서 MM AI 에이전트를 켜세요`. 게임 종료 → `게임을 실행하세요`. 다시 켜면 배지 사라짐.
- [ ] **Step 7: 결과 기록** — 각 단계 결과(성공/실패, 실제 응답 메시지)를 `docs/superpowers/plans/2026-09-21-mabi-overlay.md` 이 섹션 아래에 체크박스와 함께 적고 커밋.

```bash
git add docs/superpowers/plans/2026-09-21-mabi-overlay.md
git commit -m "docs: 실게임 수동 검증 결과

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- 가공 HUD(6시설·7슬롯·색·수령 버튼·배지·1행/2행) → Task 4, 11
- 채집 즐겨찾기·루프·진행률·중단·응답 분기 → Task 5, 12
- 가공 즐겨찾기·N건 등록·예상 개수·확인창 → Task 6, 12
- 자동 재가공(토글·60초·3회 해제·🔁 배지·일시정지·날개 누적·채집 중 대기) → Task 6, 12
- 상태 배지(연결/날개/도구/무게) → Task 7, 12, 14
- 마우스 관통·F8·드래그·잠금·위치 저장 → Task 9, 10
- ⚙ 설정(목록 조회·추가·삭제·시설 표시·미연결 안내) → Task 13
- 오류 처리(exit 5 배지·CLI 없음·파싱 실패 건너뜀·base64·stdout 파싱·MoFo 동시 실행 경고) → Task 2, 7, 14. exit 4 자동 재조회는 스펙에 있으나 현재 28개 명령이 모두 존재하므로 `unknown_command`는 버튼 비활성 대신 실패 메시지로 표시(Task 5/6의 reason 표시)로 갈음 — 명령이 사라지는 상황은 게임 업데이트 시에만 발생.
- 물물교환 미지원 명시 → README/스펙. 미지원 명령 자동 표시는 스펙의 "후속 작업"이라 제외.
- 검증(단위 테스트 + 실게임) → 각 Task, Task 15
- 결과물(dir 빌드, SmartScreen 안내) → Task 14

**Type consistency 확인 포인트**
- `Update.groups[key].completed[0].DisplayName` — Task 4 생성, Task 6/11 소비 ✔
- `interpretAlterResult` 반환 `{ ok, reason, message, cost, collected }` — Task 6 정의, Task 8 `ALTER_COLLECT`·Task 11 `collect()` 소비 ✔
- `onProgress`(gather) 필드 `running/i/repeat/gainedTotal/status/lastMessage/done/message` — Task 5 정의, Task 12 소비 ✔
- `onAutoEvent` 필드 `type/displayName/index/count/message/autoSpentWings` — Task 6 정의, Task 12 소비 ✔
- `listOf → { items, message }` — Task 8 정의, Task 12/13 소비 ✔
- `fetchGameStatus → { wings, weight:{current,max} } | null` — Task 7 정의, Task 12 소비 ✔
