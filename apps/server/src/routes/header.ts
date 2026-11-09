import { Hono } from 'hono';
import { protectedRoute, type Env } from '../context';
import { readSiteHeader } from '../connectors/header';

/** The shared header (D88) for the signed-in person: what their header connector lists for them, else Clew's default. */
export const headerRoutes = new Hono<Env>();
headerRoutes.use('*', protectedRoute());
headerRoutes.get('/', async c => c.json(await readSiteHeader(c.get('session').context)));
