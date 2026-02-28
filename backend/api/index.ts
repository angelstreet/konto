import { handle } from '@hono/node-server/vercel';
import { app, ensureServerBootstrap } from '../src/index.js';

const handler = handle(app);

export default async function vercelHandler(req: any, res: any) {
  await ensureServerBootstrap();
  return handler(req, res);
}
