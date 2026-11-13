import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function reset(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clew-reset-shell-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'scripts/fixtures-reset.sh'),
      readFileSync(new URL('../../scripts/fixtures-reset.sh', import.meta.url)),
    );
    const executable = (path: string, body: string) =>
      writeFileSync(join(dir, path), '#!/bin/sh\nset -eu\n' + body, { mode: 0o755 });
    executable('scripts/compose.sh', 'printf "compose %s\\n" "$*" >> "$LOG"\n');
    executable(
      'bin/bun',
      [
        'printf "bun %s\\n" "$*" >> "$LOG"',
        'if [ "${GUARD_FAIL:-}" = yes ] && [ "$2" = --check ]; then exit 7; fi',
        'if [ "${RETIRE_FAIL:-}" = yes ] && [ "$2" = --sources-stopped ]; then exit 8; fi',
      ].join('\n'),
    );
    executable(
      'bin/docker',
      [
        'if [ "$1" = exec ]; then while [ "$1" != bun ]; do shift; done; shift; exec bun "$@"; fi',
        'printf "docker %s\\n" "$*" >> "$LOG"',
        'if [ "$1 $2" = "volume ls" ]; then',
        '  printf "%s\\n" clew_hr_state clew_finance_state clew_incidents_state clew_communication_state clew_timesheet_state clew_servicedesk_state clew_postgres_data clew_calendar_data another_hr_state',
        'fi',
        'if [ "${REMOVE_FAIL:-}" = yes ] && [ "$1 $2 $3" = "volume rm clew_finance_state" ]; then exit 9; fi',
      ].join('\n'),
    );
    const result = Bun.spawnSync(['sh', 'scripts/fixtures-reset.sh'], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: join(dir, 'bin') + ':' + process.env.PATH,
        COMPOSE_PROJECT_NAME: 'clew',
        LOG: join(dir, 'log'),
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { code: result.exitCode, commands: readFileSync(join(dir, 'log'), 'utf8').trim().split('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('reset stops sources and retires work before deleting only the six fixture volumes', () => {
  const { code, commands } = reset();
  expect(code).toBe(0);
  expect(commands.filter(c => c.startsWith('docker volume rm'))).toEqual([
    'docker volume rm clew_hr_state',
    'docker volume rm clew_finance_state',
    'docker volume rm clew_incidents_state',
    'docker volume rm clew_communication_state',
    'docker volume rm clew_timesheet_state',
    'docker volume rm clew_servicedesk_state',
  ]);
  expect(
    commands.indexOf('compose stop hr finance incidents communication timesheet payroll servicedesk'),
  ).toBeLessThan(commands.indexOf('bun scripts/dev-reset.ts --sources-stopped'));
  expect(commands.indexOf('bun scripts/dev-reset.ts --sources-stopped')).toBeLessThan(
    commands.indexOf('docker volume rm clew_hr_state'),
  );
  expect(commands.at(-1)).toBe('compose up -d hr finance incidents communication timesheet payroll servicedesk');
});
test('a live-server guard failure cannot stop a source or touch a volume', () => {
  const { code, commands } = reset({ GUARD_FAIL: 'yes' });
  expect(code).toBe(7);
  expect(commands).toEqual(['bun scripts/dev-reset.ts --check']);
});
test('retirement or volume-removal failure prevents a reset from claiming success', () => {
  const retirement = reset({ RETIRE_FAIL: 'yes' });
  expect(retirement.code).toBe(8);
  expect(retirement.commands.some(c => c.startsWith('docker volume rm'))).toBe(false);
  const removal = reset({ REMOVE_FAIL: 'yes' });
  expect(removal.code).toBe(9);
  expect(removal.commands.at(-1)).toBe('docker volume rm clew_finance_state');
});
