# Durable synthetic reference source

This independently runnable Node connector is a test fixture, not a pilot choice. It requires no workspace package or external library. SQLite holds the synthetic source record and operation result in one transaction with full synchronous durability.

Set `REFERENCE_DB` to a writable persistent file, `CLEW_CONNECTOR_SECRET` to the transport key and `CLEW_URL` to the trusted Clew base URL. Start `node server.mjs`. Mount the database directory when running the image. Do not put real data in this source.

An approved `reference.complete` or `reference.undo` carries `X-Clew-Operation-Id` and `{ref, revision}`. The source permanently binds the operation key to the person, assignment, operation and approved revision. Retries return its original result. Changed input is rejected; stale revisions produce a known failure. `reference.lookup` reads evidence under the same person and assignment. The advertised replay window is 24 hours even though this fixture retains its key records indefinitely.

`REFERENCE_TEST_FAULT` may be `crash-after-commit`, `drop-after-commit` or `malformed-after-commit`. These deliberately fail only after the source commits. Restart with the same database; lookup still recovers the outcome. Fault control is process configuration, never an unauthenticated HTTP endpoint.
