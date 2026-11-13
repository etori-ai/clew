import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineControls, moveCandidate, moveToRunningVersion, moveWorkflow } from '../src/dbos/start';

const id = 'job:scan:2026-11-13';
const queue = 'test.ledger';
function night(status = 'PENDING', applicationVersion = 'previous') {
  const row = { status, applicationVersion, workflowName: 'scheduledJob' };
  let tail = Promise.resolve();
  const steps = [{ functionID: 0, error: null }];
  const controls: typeof engineControls = {
    version: 'current',
    async withMoveLock(receivedQueue, workflowID, run) {
      assert.equal(receivedQueue, queue);
      assert.equal(workflowID, id);
      const result = tail.then(run);
      tail = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    status: async () => ({ ...row }),
    steps: async () => [...steps],
    cancel: async () => {
      row.status = 'CANCELLED';
    },
    rewind: async (workflowID, options) => {
      assert.equal(workflowID, id);
      assert.equal(row.status, 'CANCELLED');
      assert.equal(options.queueName, queue);
      row.status = 'ENQUEUED';
      row.applicationVersion = options.applicationVersion;
      steps.splice(options.startStep);
    },
    resume: async (workflowID, receivedQueue) => {
      assert.equal(workflowID, id);
      assert.equal(receivedQueue, queue);
      assert.equal(row.status, 'CANCELLED');
      row.status = 'ENQUEUED';
    },
  };
  const start = () => moveToRunningVersion([id], queue, controls);
  return { row, steps, controls, start };
}

test('overlapping starts move one night once and a subsequent operator sees the current queued workflow', async () => {
  const w = night();
  const preview = await moveCandidate(w.controls, id, 'current');
  assert.ok('from' in preview);
  const [first, second, operator] = await Promise.all([
    w.start(),
    w.start(),
    moveWorkflow(w.controls, id, 'current', queue),
  ]);
  assert.deepEqual([first, second], [[id], []]);
  assert.ok('refused' in operator);
  assert.equal(w.row.status, 'ENQUEUED');
  assert.equal(w.row.applicationVersion, 'current');
});

test('a current-version nightly cancellation resumes from its checkpoints only once', async () => {
  const w = night('CANCELLED', 'current');
  // The operator still refuses current-version cancellations, which can represent deliberately cancelled reminders.
  assert.ok('refused' in (await moveWorkflow(w.controls, id, 'current', queue)));
  assert.deepEqual(await Promise.all([w.start(), w.start()]), [[id], []]);
  assert.equal(w.row.status, 'ENQUEUED');
  assert.deepEqual(w.steps, [{ functionID: 0, error: null }]);
});

test('a workflow that completes before cancellation keeps its terminal outcome and steps', async () => {
  for (const move of ['startup', 'operator']) {
    const w = night();
    w.controls.cancel = async () => {
      w.row.status = 'SUCCESS'; // DBOS leaves a completed workflow alone.
    };
    if (move === 'startup') assert.deepEqual(await w.start(), []);
    else assert.ok('refused' in (await moveWorkflow(w.controls, id, 'current', queue)));
    assert.equal(w.row.status, 'SUCCESS');
    assert.deepEqual(w.steps, [{ functionID: 0, error: null }]);
  }
});

test('a failed rewind leaves an older cancellation for the next start', async () => {
  const w = night();
  const rewind = w.controls.rewind;
  w.controls.rewind = async () => {
    throw new Error('rewind unavailable');
  };
  await assert.rejects(w.start(), /rewind unavailable/);
  assert.equal(w.row.status, 'CANCELLED');
  w.controls.rewind = rewind;
  assert.deepEqual(await w.start(), [id]);
  assert.equal(w.row.applicationVersion, 'current');
});

test('the operator preserves a step recorded between inspection and cancellation', async () => {
  const w = night();
  w.controls.cancel = async () => {
    w.steps.push({ functionID: 1, error: null });
    w.row.status = 'CANCELLED';
  };
  const moved = await moveWorkflow(w.controls, id, 'current', queue);
  assert.ok('from' in moved);
  assert.equal(moved.from, 2);
  assert.deepEqual(
    w.steps.map(s => s.functionID),
    [0, 1],
  );
});
