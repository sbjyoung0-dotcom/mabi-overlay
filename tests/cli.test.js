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
