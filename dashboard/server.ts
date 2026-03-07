import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { initSocketHandlers } from './src/lib/socket-server';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
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
