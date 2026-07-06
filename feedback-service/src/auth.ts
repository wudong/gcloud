import type { Context, Next } from 'hono';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

/**
 * Middleware: requires Bearer token for admin endpoints.
 * Token is set via ADMIN_TOKEN env var (stored in Secret Manager).
 */
export async function requireAuth(c: Context, next: Next) {
  if (!ADMIN_TOKEN) {
    return c.json({ error: 'Server not configured for admin access' }, 500);
  }

  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = auth.slice(7);
  if (token !== ADMIN_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}
