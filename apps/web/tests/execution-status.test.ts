import { describe, expect, test } from 'bun:test';
import { SUBJECT_CHANGED, type ExecutionSummary } from '@clew/contracts';
import { executionStatus } from '../src/execution-status';

const execution = (state: 'failed' | 'unknown', reason: string | null = null): ExecutionSummary => ({
  id: 'e1',
  decisionId: 'd1',
  operation: 'hr.flag',
  state,
  reason,
  compensates: null,
});

describe('a started action whose person no longer has the user name it was decided for (D122)', () => {
  test('refused before it was sent: nothing went, and the person decides again', () => {
    expect(executionStatus(execution('failed', SUBJECT_CHANGED))).toBe(
      'Personen har inte längre det användarnamn som beslutet gällde. Inget skickades. Fatta beslutet igen.',
    );
  });
  test('refused after an attempt whose answer is missing: it is not sent again, and the outcome is checked at the source', () => {
    expect(executionStatus(execution('unknown', SUBJECT_CHANGED))).toBe(
      'Personen har inte längre det användarnamn som beslutet gällde, så åtgärden skickas inte igen. Utfallet behöver kontrolleras i källsystemet.',
    );
  });
  test('any other failure keeps its own words', () => {
    expect(executionStatus(execution('failed'))).toBe(
      'Åtgärden kunde inte genomföras. Kontrollera beskedet innan du fattar ett nytt beslut.',
    );
  });
});
