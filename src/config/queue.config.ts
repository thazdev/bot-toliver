import type { RedisConfig } from '../types/config.types.js';

export interface QueueConnectionConfig {
  connection: {
    host: string;
    port: number;
    password?: string;
  };
}

export function loadQueueConfig(redisConfig: RedisConfig): QueueConnectionConfig {
  return {
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      ...(redisConfig.password ? { password: redisConfig.password } : {}),
    },
  };
}
