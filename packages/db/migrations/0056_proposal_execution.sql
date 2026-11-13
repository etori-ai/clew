-- M1: the approved decision that last took a proposal. While it is pending, running or unknown, another manager's
-- confirmation of the same person is refused (`composition/execution-projection.ts`).
ALTER TABLE "proposal" ADD COLUMN "execution_id" text;
