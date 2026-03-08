import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import { DatabaseClient } from './DatabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Runs SQL migration files from the /migrations directory in order.
 * Tracks applied migrations in a schema_migrations table to avoid re-running.
 */
export class MigrationRunner {
  private db: DatabaseClient;
  private migrationsDir: string;

  constructor() {
    this.db = DatabaseClient.getInstance();
    this.migrationsDir = join(__dirname, '..', '..', '..', 'migrations');
  }

  /**
   * Ensures the schema_migrations tracking table exists.
   */
  private async ensureMigrationsTable(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT NOW()
      )
    `);
  }

  /**
   * Returns the set of already-applied migration filenames.
   * @returns Set of applied migration filenames
   */
  private async getAppliedMigrations(): Promise<Set<string>> {
    const rows = await this.db.query<{ filename: string } & import('mysql2/promise').RowDataPacket>(
      'SELECT filename FROM schema_migrations ORDER BY id ASC',
    );
    return new Set(rows.map((r) => r.filename));
  }

  /**
   * Runs all pending SQL migrations in order.
   * @returns Number of migrations applied
   */
  async run(): Promise<number> {
    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrations();

    let files: string[];
    try {
      files = await readdir(this.migrationsDir);
    } catch {
      logger.warn('Migrations directory not found, skipping', { dir: this.migrationsDir });
      return 0;
    }

    const sqlFiles = files
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of sqlFiles) {
      if (applied.has(file)) {
        logger.debug('Migration already applied, skipping', { file });
        continue;
      }

      const filePath = join(this.migrationsDir, file);
      const sql = await readFile(filePath, 'utf-8');

      try {
        const statements = sql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          await this.db.execute(statement);
        }

        await this.db.execute(
          'INSERT INTO schema_migrations (filename) VALUES (?)',
          [file],
        );

        count++;
        logger.debug('Migration applied', { file });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Migration failed', { file, error: errorMsg });
        throw new Error(`Migration failed: ${file} - ${errorMsg}`);
      }
    }

    if (count === 0) {
      logger.debug('No pending migrations');
    } else {
      logger.debug('Migrations complete', { applied: count });
    }

    return count;
  }
}
