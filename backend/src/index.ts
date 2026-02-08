import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import db from './db.js';

const app = new Hono();

app.use('/*', cors());

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/api/users', (c) => {
  const users = db.prepare('SELECT * FROM users').all();
  return c.json(users);
});

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`🦎 Kompta API running on http://localhost:${info.port}`);
});
