import { Hono } from 'hono';
import { handle } from 'hono/vercel';

// Minimal test first, then import backend
let backendApp: any = null;
let initError: string | null = null;

const wrapper = new Hono();

wrapper.get('/api/health', (c) => {
  if (initError) {
    return c.json({ status: 'error', error: initError }, 500);
  }
  return c.json({ status: 'ok', backend: !!backendApp });
});

wrapper.all('/api/*', async (c) => {
  if (!backendApp) {
    try {
      const { initDatabase, migrateDatabase } = await import('../backend/src/db.js');
      const { app } = await import('../backend/src/index.js');
      await initDatabase();
      await migrateDatabase();
      backendApp = app;
    } catch (e: any) {
      initError = e.message || String(e);
      return c.json({ status: 'error', error: initError }, 500);
    }
  }
  return backendApp.fetch(c.req.raw);
});

export const config = {
  runtime: 'nodejs',
};

export default handle(wrapper);
