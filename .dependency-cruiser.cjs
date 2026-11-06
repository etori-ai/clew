/** Backend structure rules (D20), run by `bun run deps` as part of `bun run check`. See docs/architecture/backend-structure.md. */
const store = '^packages/db/|node_modules/(drizzle-orm|postgres)/';
const adapters = '^packages/calendar/src/(nextcloud|microsoft365|fake-graph|adapters)\\.ts$|/adapters?/';
const runtime = 'node_modules/(hono|jose|openid-client|@temporalio|@hono|ai|@ai-sdk)/';
const timers = 'node_modules/@temporalio/|^apps/server/src/temporal/';
const liveAdapters =
  '^apps/server/src/([^/]+|modules/[^/]+)/adapters/(postgres|temporal|provider)\\.ts$|^apps/server/src/composition/';
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Temporal workflows and activities type each other (import type), which is its documented pattern and not a runtime cycle.',
      severity: 'error',
      from: { pathNot: '^apps/server/src/temporal/(workflows|activities)\\.ts$' },
      to: { circular: true },
    },
    {
      name: 'routes-stay-thin',
      comment:
        'A route parses, validates, calls one use case and maps errors. It never reads the database or an adapter.',
      severity: 'error',
      from: { path: '^apps/server/src/routes/' },
      to: { path: store + '|' + adapters, pathNot: '^apps/server/src/composition/' },
    },
    {
      name: 'domain-is-pure',
      comment: 'domain.ts and domain/ hold pure functions: no database, no network, no runtime libraries.',
      severity: 'error',
      from: { path: '(^|/)domain(\\.ts$|/)' },
      to: { path: store + '|' + adapters + '|' + runtime },
    },
    {
      name: 'domain-no-core',
      comment: 'No Node built-ins in domain code either.',
      severity: 'error',
      from: { path: '(^|/)domain(\\.ts$|/)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'modules-do-not-import-each-other',
      comment:
        'A module reaches another only through the registry (clew.call or /api/connectors/call), so any module can be shipped separately as a connector (D21).',
      severity: 'error',
      from: { path: '^apps/server/src/modules/([^/]+)/' },
      to: { path: '^apps/server/src/modules/(?!$1/)[^/]+/' },
    },
    {
      name: 'modules-do-not-import-the-platform',
      comment:
        'A module knows its contract, the registry handle and its adapter, never routes, the stream or the assistant. The connector registry is platform code and is kept out of modules/ for that reason.',
      severity: 'error',
      from: { path: '^apps/server/src/modules/' },
      to: { path: '^apps/server/src/(routes|threads|assistant|temporal|scheduler|main)' },
    },
    {
      name: 'usecases-reach-stores-through-ports',
      comment:
        'A use case depends on the ports in its model.ts, never on Drizzle, Postgres, Temporal or an adapter (D25). The live adapters are paired in composition/. Connector descriptors (connector.ts) and adapters are the exceptions.',
      severity: 'error',
      from: {
        path: '^apps/server/src/(threads|modules/[^/]+|scheduler|assistant|connectors/usecases)/',
        pathNot: '/adapters/|/connector\\.ts$',
      },
      to: { path: store + '|' + timers + '|' + adapters + '|' + liveAdapters },
    },
    {
      name: 'unit-tests-stay-fast',
      comment:
        'tests/unit runs without Postgres, Temporal or a network (D25): it imports use cases, domain and the memory adapters, never a live adapter or the composition root.',
      severity: 'error',
      from: { path: '^tests/unit/' },
      to: { path: store + '|' + timers + '|' + liveAdapters, pathNot: '^packages/db/src/schema\\.ts$' },
    },
    {
      name: 'the-fake-graph-stays-out-of-the-server',
      comment:
        'The local fake of Microsoft Graph is a test double (D69): the unit suite and the graph service import it, the server and the calendar package never do, so no deployment carries it.',
      severity: 'error',
      from: { path: '^apps/|^packages/', pathNot: '^packages/calendar/src/fake-graph\\.ts$' },
      to: { path: '^packages/calendar/src/fake-graph\\.ts$' },
    },
    { name: 'packages-do-not-import-apps', severity: 'error', from: { path: '^packages/' }, to: { path: '^apps/' } },
    {
      name: 'contracts-is-a-leaf',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^packages/(?!contracts/)' },
    },
    {
      name: 'connectors-package-has-no-database',
      comment: 'The capability layer and the protocol must run in a connector built outside this repository.',
      severity: 'error',
      from: { path: '^packages/connectors/' },
      to: { path: '^packages/db/|node_modules/(drizzle-orm|postgres)/' },
    },
    {
      name: 'clew-does-not-import-connectors',
      comment:
        "Clew bundles only its core (D61): nothing in apps/ or packages/ imports a connector under connectors/, the fixtures included; the served protocol's documentation examples (D60) are the one exception.",
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: '^apps/server/src/routes/protocol\\.ts$' },
      to: { path: '^connectors/' },
    },
    {
      name: 'connectors-stand-alone',
      comment:
        'A connector under connectors/ depends on nothing in this repository: it is built the way a third party builds one.',
      severity: 'error',
      from: { path: '^connectors/' },
      to: { path: '^(apps|packages)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // TypeScript 7 has no JavaScript compiler API, so dependency-cruiser cannot tell `import type` from `import`:
    // a type a test needs from the store comes from packages/db/src/schema.ts, which the unit-test rule allows.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
