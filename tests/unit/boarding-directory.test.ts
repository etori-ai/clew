import { randomUUID } from 'node:crypto';
import { memoryBoardingDirectory } from '../../apps/server/src/modules/boarding/adapters/memory';
import { boardingDirectoryContract } from '../boarding-directory-contract';

/** The boarding directory contract on the memory adapter (D124, D25); `tests/db/postgres-boarding-directory.test.ts` on Postgres. */
boardingDirectoryContract('memory', async () => {
  const directory = memoryBoardingDirectory();
  return {
    directory,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seedUnit(unit) {
      directory.setUnit(unit);
    },
    async seedPerson({ name: _name, ...person }) {
      directory.setPerson(person);
    },
  };
});
