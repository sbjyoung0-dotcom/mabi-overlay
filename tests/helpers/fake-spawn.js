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
