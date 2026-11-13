import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, like } from 'drizzle-orm';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { database, schema, closeDatabase } from '@clew/db';
import { competenceTx, postgresCompetenceStore } from '../src/modules/competence/adapters/postgres';
import { competenceLeavers, competenceUsecases } from '../src/modules/competence/usecases';
import { dailyCopyStart, erasureStart, erasureWorkflowId, readNowStart } from '../src/modules/competence/domain';
import type { SourceHoldingsPage } from '../src/modules/competence/model';
import { postgresProvisionStore } from '../src/modules/people/adapters/postgres';
import { SCIM } from '../src/modules/people/contracts';
import { scimUsecases } from '../src/modules/people/usecases';
import { bindActivities } from '../src/dbos/workflows';
import { cancelDurable, durableResult } from '../src/dbos/start';
import { adoptExecutors, beat, claimDead, ensureHeartbeatTable } from '../src/dbos/heartbeat';
import { testEngine } from './durable';

// Real PostgreSQL, the durable engine (DBOS) in production Node, a synthetic person, connector and source. The engine
// runs under its own application name, so nothing here is dequeued by the development server.
test(
  'the competence copy starts in the transaction that asks for it, reads a source to the end once, and a run killed mid-read is adopted and goes on under its own lease',
  { timeout: 120_000 },
  async () => {
    const tag = randomUUID().slice(0, 8),
      engine = testEngine('competence'),
      store = postgresCompetenceStore(engine.durable);
    // A connector id is lower case; every row this test writes is named after it.
    const connectorId = 'test-copy-' + tag,
      personId = connectorId + '-anna',
      organisationId = connectorId + '-org',
      userName = connectorId + '.anna';
    const page: SourceHoldingsPage = {
      rows: [
        {
          key: userName.toUpperCase(),
          holdings: [
            { id: 'course:1:user:1', type: 'course:1', label: 'Brandskydd', kind: 'course', issuedOn: '2025-11-01' },
            {
              id: 'badge:4:user:1',
              type: 'badge:4',
              label: 'HLR-instruktör',
              kind: 'badge',
              issuedOn: '2026-01-01',
              expiresOn: '2026-12-31',
            },
          ],
        },
      ],
      withdrawalsReported: false,
    };
    const source = { connectorId, source: 'Testkällan' };
    let read = 0,
      scheduled = 0,
      reconciled = 0;
    const competence = competenceUsecases({
      store,
      staff: async () => ({ units: [] }),
      clock: () => new Date(),
      ids: () => randomUUID(),
      holdings: {
        switchedOn: async () => true,
        holdingsSources: async () => [source],
        readHoldings: async () => {
          read++;
          return page;
        },
        admitted: async (_connectorId, personIds) => new Set(personIds),
        reaches: async () => true,
      },
    });
    bindActivities({
      scheduleCompetenceCopy: async () => void scheduled++,
      competenceSources: only => competence.copySources(only),
      copyHoldings: async (run, s) => (await competence.copySource('system:test', run, s)).outcome,
      reconcileApprovals: async () => void reconciled++,
    });
    const copied = () => store.transaction(tx => tx.copiedFrom(connectorId));
    const reads = (run: string) =>
      database()
        .select()
        .from(schema.audit)
        .where(
          and(eq(schema.audit.subject, 'connector:' + connectorId), eq(schema.audit.action, 'competence.source_read')),
        )
        .then(rows => rows.filter(r => (r.details as { run?: string }).run === run));
    let child: ReturnType<typeof spawn> | undefined, launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    let typeId = '';
    try {
      await database().insert(schema.people).values({ id: personId, name: 'Synthetic copy', organisationId, userName });
      await database()
        .insert(schema.connectors)
        .values({ id: connectorId, url: 'http://copy.test', secret: 'sealed', createdBy: 'test', updatedBy: 'test' });
      typeId = await competence.seedType('operator:test', organisationId, {
        name: 'Brandskydd ' + tag,
        area: 'Säkerhet',
        kind: 'course',
        validityMonths: 36,
      });
      await competence.seedMapping('operator:test', organisationId, connectorId, { sourceType: 'course:1', typeId });

      // "Läs in nu", committed before any engine of this application runs: the row waits in the queue.
      const now = new Date().toISOString();
      const first = readNowStart('read-' + tag, connectorId, now);
      await store.transaction(tx => tx.enqueue(first));
      assert.deepEqual(await engine.row(first.id), {
        status: 'ENQUEUED',
        executor_id: null,
        queue_name: engine.durable.queue,
      });
      launched = await engine.launch();
      await durableResult(first.id);
      assert.equal(read, 1);
      assert.deepEqual((await copied()).map(h => [h.copy!.sourceId, h.typeId, h.personId]).sort(), [
        ['badge:4:user:1', null, personId],
        ['course:1:user:1', typeId, personId],
      ]);
      assert.equal((await reads('read-' + tag)).length, 1);
      assert.equal(scheduled, 0, 'a run started by hand asks for no daily run');
      assert.equal(reconciled, 0, 'a run started by hand reconciles no approvals');
      const record = await store.transaction(tx => tx.source(connectorId));
      assert.equal(record?.outcome, 'complete');
      assert.equal(record?.run, null);

      // The daily run asks for the next day's before it reads, and reads again without changing what it copied.
      const daily = dailyCopyStart('2098-01-01', now);
      await store.transaction(tx => tx.enqueue({ ...daily, id: daily.id + ':' + tag }));
      await durableResult(daily.id + ':' + tag);
      assert.equal(scheduled, 1);
      assert.equal(reconciled, 1, 'the daily run reconciles the approvals’ cards');
      assert.equal(read, 2);
      assert.equal((await copied()).length, 2);

      // With no source to read the daily run still reconciles (D108 item 7).
      bindActivities({ competenceSources: async () => [] });
      const quiet = dailyCopyStart('2098-01-03', now);
      await store.transaction(tx => tx.enqueue({ ...quiet, id: quiet.id + ':' + tag }));
      await durableResult(quiet.id + ':' + tag);
      assert.deepEqual([reconciled, read], [2, 2]);

      // One source's failure is that source's own: a source whose step fails after its retries is left for the next
      // run while the others are read, and a daily run that cannot ask for the next day's, or reconcile, still reads
      // (the server's hourly guard asks again, the next day reconciles again). The workflow ends well.
      const broken = { connectorId: 'broken-' + tag, source: 'Trasig' };
      let attempts = 0,
        asked = 0,
        tried = 0;
      bindActivities({
        scheduleCompetenceCopy: async () => {
          asked++;
          throw new Error('the database is gone');
        },
        // A reconciliation that keeps failing keeps the copy from nothing, nor the copy's failure it.
        reconcileApprovals: async () => {
          tried++;
          throw new Error('the directory is gone');
        },
        competenceSources: async () => [broken, source],
        copyHoldings: async (run, s) => {
          if (s.connectorId !== broken.connectorId) return (await competence.copySource('system:test', run, s)).outcome;
          attempts++;
          throw new Error('a write that keeps failing');
        },
      });
      const isolated = dailyCopyStart('2098-01-02', now);
      await store.transaction(tx => tx.enqueue({ ...isolated, id: isolated.id + ':' + tag }));
      await durableResult(isolated.id + ':' + tag);
      assert.equal((await DBOS.getWorkflowStatus(isolated.id + ':' + tag))?.status, 'SUCCESS');
      assert.deepEqual([asked, tried, attempts, read], [3, 3, 3, 3]);
      bindActivities({
        scheduleCompetenceCopy: async () => void scheduled++,
        competenceSources: only => competence.copySources(only),
        copyHoldings: async (run, s) => (await competence.copySource('system:test', run, s)).outcome,
        reconcileApprovals: async () => void reconciled++,
      });

      // Process death: a second instance starts a run, takes the source's lease and is SIGKILLed while it reads. Its
      // heartbeat lapses, this instance adopts the workflow, and the same run reads the source to the end here, once.
      const run = 'killed-' + tag;
      const killed = { ...readNowStart(run, connectorId, new Date().toISOString()) };
      child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./fixtures/competence-child.ts', import.meta.url))],
        {
          env: {
            ...process.env,
            DURABLE_APP: engine.name,
            DURABLE_EXECUTOR: 'copy-child',
            COPY_SOURCE: JSON.stringify(source),
            COPY_START: JSON.stringify(killed),
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('child instance did not start reading')), 30_000);
        child!.once('exit', code => reject(new Error('child instance exited before reading: ' + code)));
        child!.stdout!.on('data', chunk => {
          if (String(chunk).includes('reading')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await new Promise<void>(resolve => {
        child!.once('exit', () => resolve());
        child!.kill('SIGKILL');
      });
      const held = await store.transaction(tx => tx.source(connectorId));
      assert.equal(held?.run, run, 'the killed run still holds the lease');
      const stranded = await DBOS.getWorkflowStatus(killed.id);
      assert.deepEqual([stranded?.status, stranded?.executorId], ['PENDING', 'copy-child']);
      // Another run meanwhile finds the source held and reads nothing.
      assert.equal((await competence.copySource('system:test', 'other-' + tag, source)).outcome, 'busy');
      assert.equal(read, 3);
      await ensureHeartbeatTable();
      await beat(engine.name, 'copy-child', new Date(Date.now() - 120_000));
      assert.deepEqual(await claimDead(engine.name, launched.executorID), ['copy-child']);
      assert.deepEqual(await adoptExecutors(['copy-child']), [killed.id]);
      await durableResult(killed.id);
      assert.equal(read, 4);
      assert.equal((await reads(run)).length, 1);
      assert.equal((await copied()).length, 2);
      const after = await store.transaction(tx => tx.source(connectorId));
      assert.deepEqual([after?.run, after?.outcome], [null, 'complete']);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      await launched?.shutdown();
      await database().delete(schema.competenceHoldings).where(eq(schema.competenceHoldings.connectorId, connectorId));
      await database()
        .delete(schema.competenceSourceMappings)
        .where(eq(schema.competenceSourceMappings.connectorId, connectorId));
      await database().delete(schema.competenceSources).where(eq(schema.competenceSources.connectorId, connectorId));
      await database().delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, organisationId));
      await database()
        .delete(schema.audit)
        .where(like(schema.audit.subject, '%' + connectorId + '%'));
      if (typeId)
        await database()
          .delete(schema.audit)
          .where(eq(schema.audit.subject, 'competence-type:' + typeId));
      await database().delete(schema.connectors).where(eq(schema.connectors.id, connectorId));
      await database().delete(schema.people).where(eq(schema.people.id, personId));
      await engine.forget();
      await closeDatabase();
    }
  },
);

// The erasure a period after a person leaves (D108 item 14), on the same real PostgreSQL and engine. A day is the
// shortest period, so the clock the SCIM use cases and the copy run on is set back by a day less a few seconds: the
// deactivation commits a due time a few seconds ahead of the engine's own clock, and the workflow's sleep is short.
test(
  'the erasure starts in the deactivation’s transaction, waits until due and erases once; a reactivation cancels its wait; a killed instance’s erasure is adopted and erases once',
  { timeout: 120_000 },
  async () => {
    const tag = randomUUID().slice(0, 8),
      engine = testEngine('erasure'),
      DAY = 24 * 60 * 60_000;
    const org = 'test-erasure-' + tag,
      [anna, bo, cia] = ['anna', 'bo', 'cia'].map(name => `${org}-${name}`) as [string, string, string],
      people = [anna, bo, cia];
    const provisioner = { id: 'mk-' + tag, organisationId: org, label: 'Synthetic provisioner' };
    let lead = 3_000;
    const behind = () => new Date(Date.now() - DAY + lead);
    const cancelled: string[] = [];
    const cancel = async (id: string) => {
      cancelled.push(id);
      await cancelDurable(id);
    };
    const scim = scimUsecases({
      store: postgresProvisionStore({
        leavers: (tx, ended) => competenceLeavers(competenceTx(tx, engine.durable, undefined, ended)),
        cancel,
      }),
      clock: behind,
      ids: () => randomUUID(),
      digest: t => t,
    });
    const store = postgresCompetenceStore(engine.durable, cancel);
    const competence = competenceUsecases({
      store,
      staff: async () => ({ units: [] }),
      clock: () => new Date(),
      ids: () => randomUUID(),
    });
    let erasures = 0;
    bindActivities({
      eraseLeaver: async (personId, generation) => {
        erasures++;
        return competence.eraseDue(personId, generation);
      },
    });
    const active = (id: string, value: boolean) =>
      scim.patchUser(
        provisioner,
        id,
        { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'active', value }] },
        'https://clew.test/scim/v2',
      );
    const holdings = async (personId: string) => (await store.transaction(tx => tx.holdingsOf([personId]))).length;
    const erasedRows = (personId: string) =>
      database()
        .select()
        .from(schema.audit)
        .where(
          and(eq(schema.audit.subject, 'person:' + personId), eq(schema.audit.action, 'competence.person_erased')),
        );
    let child: ReturnType<typeof spawn> | undefined, launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    let typeId = '';
    const seeded: string[] = [];
    try {
      for (const id of people)
        await database()
          .insert(schema.people)
          .values({ id, organisationId: org, name: 'Synthetic erasure', userName: id.replaceAll('-', '.') });
      typeId = await competence.seedType('operator:test', org, { name: 'HLR ' + tag, area: 'Akut', kind: 'course' });
      for (const id of people)
        seeded.push(await competence.seedHolding('operator:test', org, id, { typeId, issuedOn: '2026-01-10' }));
      await competence.setRetention('operator:test', org, 1);

      // Deactivated before any engine of this application runs: the start waits in the queue with the intent.
      await active(anna, false);
      assert.deepEqual(await engine.row(erasureWorkflowId(anna, 1)), {
        status: 'ENQUEUED',
        executor_id: null,
        queue_name: engine.durable.queue,
      });
      launched = await engine.launch();
      assert.equal(await durableResult(erasureWorkflowId(anna, 1)), 'erased');
      assert.equal(await holdings(anna), 0);
      assert.equal((await erasedRows(anna)).length, 1);
      // A step retried after its commit (the acknowledgement lost) finds the intent erased and does nothing.
      assert.equal(await competence.eraseDue(anna, 1), 'stale');
      assert.equal((await erasedRows(anna)).length, 1);

      // Due in an hour, and reactivated while it waits: the wait is cancelled after the commit, nothing is erased.
      lead = 3_600_000;
      await active(bo, false);
      await durableWait(() => DBOS.getWorkflowStatus(erasureWorkflowId(bo, 1)), 'PENDING');
      await active(bo, true);
      assert.deepEqual(cancelled, [erasureWorkflowId(bo, 1)]);
      assert.equal((await DBOS.getWorkflowStatus(erasureWorkflowId(bo, 1)))?.status, 'CANCELLED');
      assert.equal(await competence.eraseDue(bo, 1), 'stale');
      assert.equal(await holdings(bo), 1);

      // Process death: a second instance starts Cia's erasure itself, due in ten seconds, and is SIGKILLed while it
      // sleeps. Its heartbeat lapses, this instance adopts the workflow, and it erases her here, once.
      lead = 10_000;
      await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, cia));
      const due = new Date(Date.now() + 10_000).toISOString();
      await store.transaction(tx =>
        tx.putErasure({
          personId: cia,
          organisationId: org,
          state: 'waiting',
          inactiveSince: new Date(Date.parse(due) - DAY).toISOString(),
          dueAt: due,
          generation: 1,
          updatedAt: new Date().toISOString(),
        }),
      );
      child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./fixtures/erasure-child.ts', import.meta.url))],
        {
          env: {
            ...process.env,
            DURABLE_APP: engine.name,
            DURABLE_EXECUTOR: 'erasure-child',
            ERASURE_START: JSON.stringify(erasureStart({ personId: cia, generation: 1, dueAt: due })),
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('child instance did not start')), 30_000);
        child!.once('exit', code => reject(new Error('child instance exited during startup: ' + code)));
        child!.stdout!.on('data', chunk => {
          if (String(chunk).includes('started ')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await new Promise<void>(resolve => {
        child!.once('exit', () => resolve());
        child!.kill('SIGKILL');
      });
      const stranded = await DBOS.getWorkflowStatus(erasureWorkflowId(cia, 1));
      assert.deepEqual([stranded?.status, stranded?.executorId], ['PENDING', 'erasure-child']);
      assert.equal(await holdings(cia), 1);
      await ensureHeartbeatTable();
      await beat(engine.name, 'erasure-child', new Date(Date.now() - 120_000));
      assert.deepEqual(await claimDead(engine.name, launched.executorID), ['erasure-child']);
      assert.deepEqual(await adoptExecutors(['erasure-child']), [erasureWorkflowId(cia, 1)]);
      const before = erasures;
      assert.equal(await durableResult(erasureWorkflowId(cia, 1)), 'erased');
      assert.equal(erasures - before, 1);
      assert.equal(await holdings(cia), 0);
      assert.equal((await erasedRows(cia)).length, 1);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      await launched?.shutdown();
      await database()
        .delete(schema.audit)
        .where(inArray(schema.audit.subject, [...people.map(id => 'person:' + id), 'organisation:' + org]));
      await database()
        .delete(schema.audit)
        .where(inArray(schema.audit.subject, ['competence-type:' + typeId, ...seeded.map(id => 'holding:' + id)]));
      await database().delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
      await database().delete(schema.competenceErasures).where(inArray(schema.competenceErasures.personId, people));
      await database().delete(schema.competenceRetention).where(eq(schema.competenceRetention.organisationId, org));
      await database().delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, org));
      await database().delete(schema.people).where(inArray(schema.people.id, people));
      await engine.forget();
      await closeDatabase();
    }
  },
);
/** The queue runner polls about once a second: wait for the row to be dequeued into the asked-for status. */
async function durableWait(read: () => Promise<{ status: string } | null>, status: string) {
  for (let i = 0; i < 100; i++) {
    if ((await read())?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`workflow did not reach ${status}`);
}
