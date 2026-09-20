'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 브라우저 전용 스크립트(require 없음)라 실행은 안 하고 구문만 검사한다.
const rendererDir = path.join(__dirname, '..', 'renderer');
const rendererFiles = fs.readdirSync(rendererDir).filter((f) => f.endsWith('.js')).map((f) => path.join(rendererDir, f));
const files = [...rendererFiles, path.join(__dirname, '..', 'shared', 'channels.js')];

for (const file of files) {
  test(`구문 검사: ${path.relative(path.join(__dirname, '..'), file)}`, () => {
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() => new Function(code));
  });
}
