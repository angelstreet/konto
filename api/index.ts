import { Hono } from 'hono';

const app = new Hono();

// Health - no backend needed
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Lazy-load backend for all other API routes
app.all('/api/:path{.*}', async (c) => {
  const { app: backend } = await import('../backend/src/index.js');
  return backend.fetch(c.req.raw);
});

export default app;
