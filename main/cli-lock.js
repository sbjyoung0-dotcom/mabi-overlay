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
    (async () => {
      try {
        const result = await job.fn();
        current = null;
        next();
        job.resolve(result);
      } catch (err) {
        current = null;
        next();
        job.reject(err);
      }
    })();
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
