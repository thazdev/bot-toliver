import type { DatabaseConfig } from '../types/config.types.js';

/** Railway usa MYSQLHOST, MYSQLPORT, etc. (sem underscore). Suporta ambos. */
export function loadDatabaseConfig(): DatabaseConfig {
  const url =
    process.env.MYSQL_PUBLIC_URL ??
    process.env.MYSQL_URL ??
    process.env.DATABASE_URL;
  const host = process.env.MYSQL_HOST ?? process.env.MYSQLHOST ?? 'localhost';
  const port = parseInt(
    process.env.MYSQL_PORT ?? process.env.MYSQLPORT ?? '3306',
    10,
  );
  const user = process.env.MYSQL_USER ?? process.env.MYSQLUSER ?? 'root';
  const password =
    process.env.MYSQL_PASSWORD ?? process.env.MYSQLPASSWORD ?? '';
  const database =
    process.env.MYSQL_DATABASE ??
    process.env.MYSQLDATABASE ??
    'trading_bot';
  return {
    host,
    port,
    user,
    password,
    database,
    url: url && url.startsWith('mysql') ? url : undefined,
  };
}
