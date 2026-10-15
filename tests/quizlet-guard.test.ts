import assert from 'node:assert/strict';
import test from 'node:test';
import { ImportGuard } from '../src/lib/gravity/quizlet-import-guard.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('limits each caller for one minute and resets expired buckets', () => {
  const guard = new ImportGuard();
  for (let count = 0; count < 10; count += 1) assert.equal(guard.allow('first', 1_000), true);
  assert.equal(guard.allow('first', 1_001), false);
  assert.equal(guard.allow('first', 60_999), false);
  assert.equal(guard.allow('second', 1_001), true);
  assert.equal(guard.allow('first', 61_000), true);
});

test('concurrent callers of the same set share one provider task', async () => {
  const guard = new ImportGuard();
  const pending = deferred<string>();
  let calls = 0;
  const first = guard.run('same-set', () => { calls += 1; return pending.promise; });
  const second = guard.run('same-set', async () => { throw new Error('Duplicate task must not run'); });
  assert.ok(first);
  assert.equal(second, first);
  pending.resolve('complete');
  assert.equal(await first, 'complete');
  assert.equal(await second, 'complete');
  assert.equal(calls, 1);
});

test('only two distinct sets run at once and completed tasks release capacity', async () => {
  const guard = new ImportGuard();
  const one = deferred<number>();
  const two = deferred<number>();
  const first = guard.run('first', () => one.promise);
  const second = guard.run('second', () => two.promise);
  assert.ok(first);
  assert.ok(second);
  assert.equal(guard.run('third', async () => 3), null);
  assert.equal(guard.run('first', async () => 99), first);
  one.resolve(1);
  await first;
  const third = guard.run('third', async () => 3);
  assert.ok(third);
  assert.equal(await third, 3);
  two.resolve(2);
  await second;
});

test('failed tasks release their deduplication key and concurrency slot', async () => {
  const guard = new ImportGuard();
  const pending = deferred<string>();
  const failed = guard.run('failed-set', () => pending.promise);
  assert.ok(failed);
  const rejection = assert.rejects(failed, /upstream failed/);
  pending.reject(new Error('upstream failed'));
  await rejection;
  const retried = guard.run('failed-set', async () => 'recovered');
  assert.ok(retried);
  assert.notEqual(retried, failed);
  assert.equal(await retried, 'recovered');
});
