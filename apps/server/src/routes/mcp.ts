import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { protectedRoute, InputError, type Env } from '../context';
import { mcp } from '../composition/mcp';

export const mcpRoutes = new Hono<Env>();
mcpRoutes.use('*', protectedRoute());
mcpRoutes.use('*', bodyLimit({ maxSize: 65536 }));
mcpRoutes.get('/', async c => c.json(await mcp.inbox(c.get('session').context)));
mcpRoutes.get('/:id', async c =>
  c.json(await mcp.view(c.get('session').context, c.req.param('id'), c.req.query('delivery'))),
);
mcpRoutes.post('/:id/decisions', async c => {
  const input = await c.req.json();
  if (
    !input ||
    typeof input.decisionId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(input.decisionId) ||
    typeof input.name !== 'string' ||
    input.name.length > 200 ||
    !input.arguments ||
    typeof input.arguments !== 'object' ||
    Array.isArray(input.arguments)
  )
    throw new InputError('Bekräftelsen är inte giltig.');
  return c.json(
    await mcp.decide(c.get('session').context, c.req.param('id'), input.decisionId, input.name, input.arguments),
  );
});
