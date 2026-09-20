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
  let current = null; // 지금 실행 중인 자식 프로세스. 종료 시 killCurrent()로 정리한다.

  function run(command, body) {
    return new Promise((resolve) => {
      if (!cliPath) { resolve({ ok: false, kind: 'cli_missing', exitCode: null, body: null }); return; }
      const args = [command];
      const encoded = encodeBody(body);
      if (encoded !== undefined) args.push(encoded);
      let child;
      try {
        // stderr는 읽지 않고 버린다 — 파이프가 가득 차 자식이 블록되는 것을 막는다.
        child = spawn(cliPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch (err) {
        resolve({ ok: false, kind: 'cli_missing', exitCode: null, body: null, message: err.message });
        return;
      }
      current = child;
      const chunks = [];
      child.stdout.on('data', (c) => chunks.push(c));
      child.on('error', (err) => {
        if (current === child) current = null;
        resolve({ ok: false, kind: err.code === 'ENOENT' ? 'cli_missing' : 'error', exitCode: null, body: null, message: err.message });
      });
      child.on('close', (code) => {
        if (current === child) current = null;
        resolve(classify(code, parseStdout(Buffer.concat(chunks).toString('utf8'))));
      });
    });
  }

  // 종료(before-quit) 시 진행 중인 CLI 호출을 정리한다. 실행 중인 게 없으면 아무 일도 안 한다.
  function killCurrent() {
    if (!current) return;
    try { current.kill(); } catch { /* 이미 종료됐거나 kill 실패 — 무시 */ }
  }

  return { run, cliPath, killCurrent };
}

module.exports = { DEFAULT_PATHS, findCliPath, encodeBody, parseStdout, classify, createCli };
