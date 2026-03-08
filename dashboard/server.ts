import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import next from 'next';
import { Server } from 'socket.io';
import { initSocketHandlers } from './src/lib/socket-server';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

async function ensureDatabase() {
  try {
    execSync('npx prisma db push', { stdio: 'inherit' });
    console.log('> Database schema synced (users table ready)');
  } catch (e) {
    console.warn('> prisma db push failed - users table may already exist');
  }
}

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

ensureDatabase().then(() => app.prepare()).then(() => {
  const httpServer = createServer(handler);

  const io = new Server(httpServer, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: { origin: '*' },
  });

  initSocketHandlers(io);

  httpServer.listen(port, () => {
    console.log(`> Dashboard ready on http://${hostname}:${port}`);
    console.log(`> Socket.io on ws://${hostname}:${port}/api/socket`);
    console.log(`> Environment: ${dev ? 'development' : 'production'}`);
  });
});
