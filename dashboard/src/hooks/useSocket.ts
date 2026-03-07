'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const ref = useRef(false);

  useEffect(() => {
    if (ref.current) return;
    ref.current = true;

    const s = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
    });

    s.on('connect', () => setSocket(s));
    s.on('disconnect', () => setSocket(null));

    return () => {
      s.disconnect();
    };
  }, []);

  return socket;
}
