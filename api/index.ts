import { handle } from 'hono/vercel';
import { initDatabase, migrateDatabase } from '../backend/src/db.js';
import { app } from '../backend/src/index.js';

// Initialize DB on cold start (top-level await)
await initDatabase();
await migrateDatabase();

export const config = {
  runtime: 'nodejs',
};

export default handle(app);
