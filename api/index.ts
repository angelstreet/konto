import { handle } from 'hono/vercel';

// Import the app - need to init DB first
import { initDatabase, migrateDatabase } from '../backend/src/db.js';
import { app } from '../backend/src/index.js';

let initialized = false;

const handler = async (req: Request) => {
  if (!initialized) {
    await initDatabase();
    await migrateDatabase();
    initialized = true;
  }
  return handle(app)(req);
};

export default handler;
