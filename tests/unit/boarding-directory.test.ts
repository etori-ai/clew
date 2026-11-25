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
    async seedPerson({ name: _name, employments, ...person }) {
      // The memory directory holds the managers apart from what the layers match on (`managerIds`, D147).
      directory.setPerson({
        ...person,
        employments: employments.map(({ managerId: _managerId, ...job }) => job),
        managerIds: employments.flatMap(job => (job.managerId ? [job.managerId] : [])),
      });
    },
  };
});
