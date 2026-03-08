import mysql, { type Pool, type PoolOptions, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { logger } from '../../utils/logger.js';
import { DB_POOL_SIZE } from '../../utils/constants.js';
import type { DatabaseConfig } from '../../types/config.types.js';

/**
 * MySQL connection pool manager.
 * Provides typed query and execute methods with automatic reconnection.
 */
export class DatabaseClient {
  private static instance: DatabaseClient | null = null;
  private pool: Pool;

  private constructor(config: DatabaseConfig) {
    const poolOptions: PoolOptions = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: DB_POOL_SIZE,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    };

    this.pool = config.url
      ? mysql.createPool(`${config.url}${config.url.includes('?') ? '&' : '?'}connectionLimit=${DB_POOL_SIZE}`)
      : mysql.createPool(poolOptions);
    const displayHost = config.url ? config.url.replace(/:[^:@]+@/, ':****@').replace(/\/\/[^/]+/, '//***').slice(0, 60) : config.host;
    logger.debug('DatabaseClient pool created', {
      host: displayHost,
      database: config.database,
      poolSize: DB_POOL_SIZE,
    });
  }

  /**
   * Initializes the DatabaseClient singleton.
   * @param config - MySQL connection configuration
   * @returns The singleton instance
   */
  static initialize(config: DatabaseConfig): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient(config);
    }
    return DatabaseClient.instance;
  }

  /**
   * Returns the singleton instance.
   * @returns The DatabaseClient instance
   */
  static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      throw new Error('DatabaseClient not initialized. Call initialize() first.');
    }
    return DatabaseClient.instance;
  }

  /**
   * Executes a SELECT query and returns typed rows.
   * @param sql - SQL query string
   * @param params - Query parameters
   * @returns Array of result rows
   */
  async query<T extends RowDataPacket>(sql: string, params?: (string | number | boolean | null | Date | Buffer)[]): Promise<T[]> {
    try {
      const [rows] = await this.pool.execute<T[]>(sql, params);
      return rows;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Database query error', { sql: sql.slice(0, 100), error: errorMsg });
      throw error;
    }
  }

  /**
   * Executes an INSERT/UPDATE/DELETE statement.
   * @param sql - SQL statement string
   * @param params - Statement parameters
   * @returns The result set header with affected rows, insertId, etc.
   */
  async execute(sql: string, params?: (string | number | boolean | null | Date | Buffer)[]): Promise<ResultSetHeader> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(sql, params);
      return result;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Database execute error', { sql: sql.slice(0, 100), error: errorMsg });
      throw error;
    }
  }

  /**
   * Returns the underlying connection pool.
   * @returns The mysql2 Pool instance
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Tests the database connection.
   * @returns True if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.pool.execute('SELECT 1');
      logger.debug('Database connection test successful');
      return true;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Database connection test failed', { error: errorMsg });
      return false;
    }
  }

  /**
   * Gracefully closes the connection pool.
   */
  async disconnect(): Promise<void> {
    await this.pool.end();
    DatabaseClient.instance = null;
    logger.debug('Database pool closed');
  }
}
