import type { DatabaseConfig } from '../types/config.types.js';

export function loadDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'trading_bot',
  };
}
