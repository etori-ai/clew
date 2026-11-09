/** Register development MCP providers for an explicit person. Provider content is never seeded into Clew. */
import { database, closeDatabase, schema } from '@clew/db';
import { eq } from 'drizzle-orm';
import { requireFixtureDevelopment } from './fixture-development';
import { connectMcp } from '../apps/server/src/mcp/adapters/http';
import type { McpWatch } from '@clew/contracts';

requireFixtureDevelopment();
const option = (flag: string) => process.argv[process.argv.indexOf(flag) + 1];
const personId = process.argv.includes('--person') ? option('--person') : undefined;
if (!personId) throw new Error('Usage: bun scripts/dev-mcp.ts --person <id> [--interval <seconds>]');
const interval = process.argv.includes('--interval') ? Number(option('--interval')) : 30;
if (!Number.isInteger(interval) || interval < 30) throw new Error('Interval must be at least 30 seconds');
try {
  const [person] = await database()
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(eq(schema.people.id, personId));
  if (!person) throw new Error('Target person does not exist');
  const fixtures: Array<{ id: string; url: string; read: string; writes: string[]; watch: McpWatch }> = [
    {
      id: 'pulse',
      url: 'http://mcp-pulse:4035/mcp',
      read: 'get_pending_poll',
      writes: ['submit_poll'],
      watch: {
        tool: 'get_pending_poll',
        arguments: {},
        intervalSeconds: interval,
        identity: ['/pollId'],
        condition: { pointer: '/answered', equals: false },
        deliverInitial: true,
      },
    },
    {
      id: 'status',
      url: 'http://mcp-status:4036/mcp',
      read: 'get_service_status',
      writes: [],
      watch: {
        tool: 'get_service_status',
        arguments: {},
        intervalSeconds: interval,
        identity: ['/service', '/incidentId', '/state'],
        deliverInitial: false,
      },
    },
  ];
  for (const fixture of fixtures) {
    const remote = await connectMcp(fixture.url);
    try {
      if (![fixture.read, ...fixture.writes].every(name => remote.tools.some(t => t.name === name)))
        throw new Error('Required tools not advertised');
      const id = 'dev-' + fixture.id + '-' + personId;
      await database().transaction(async tx => {
        const inserted = await tx
          .insert(schema.mcpConnections)
          .values({
            id,
            personId,
            url: fixture.url,
            enabled: true,
            readTools: [fixture.read],
            writeTools: fixture.writes,
            watch: fixture.watch,
          })
          .onConflictDoNothing()
          .returning({ id: schema.mcpConnections.id });
        if (inserted.length)
          await tx.insert(schema.audit).values({ actor: 'operator:dev-mcp', action: 'mcp.registered', subject: id });
      });
      console.log(`Registered ${remote.title} for ${personId} (${id}); provider tools discovered over HTTP.`);
    } finally {
      await remote.close();
    }
  }
} finally {
  await closeDatabase();
}
