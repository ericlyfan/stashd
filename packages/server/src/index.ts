import path from 'path';
import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const DATA_DIR = path.join(process.cwd(), 'data');

createApp(DATA_DIR).then(app => {
  app.listen(PORT, () => {
    console.log(`Stashd server on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
