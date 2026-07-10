import 'dotenv/config';
import path from 'path';
import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const DATA_DIR = path.join(process.cwd(), 'data');

createApp(DATA_DIR).then(app => {
  // Loopback only: a single-user local-first app has no business being
  // reachable from the LAN (the default binds 0.0.0.0).
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Stashd server on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
