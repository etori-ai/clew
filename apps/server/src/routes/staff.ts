import { Hono } from 'hono';
import { protectedRoute, type Env } from '../context';
import { staff } from '../composition/people';

/**
 * Personal (D94): one read, the units the signed-in manager manages with the people on them. The use case owns the
 * scope check and answers 403 to anyone who manages no unit; the route only hands over the session's context.
 */
export const staffRoutes = new Hono<Env>();
staffRoutes.use('*', protectedRoute());
staffRoutes.get('/', async c => c.json(await staff.overview(c.get('session').context)));
