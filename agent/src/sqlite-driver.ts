export interface SqliteStatement {
  run(...params: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export async function openSqlite(path: string): Promise<{ database: SqliteDatabase; driver: string }> {
  try {
    const imported = await import('better-sqlite3');
    const Constructor = imported.default as unknown as new (file: string) => SqliteDatabase;
    return { database: new Constructor(path), driver: 'better-sqlite3' };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') throw error;
    const imported = await import('node:sqlite');
    return { database: new imported.DatabaseSync(path, { timeout: 5000 }) as unknown as SqliteDatabase, driver: 'node:sqlite' };
  }
}
