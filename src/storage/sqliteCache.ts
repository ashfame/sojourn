import sqlite3InitModule, {
  type Database,
  type Sqlite3Static
} from "@sqlite.org/sqlite-wasm";
import type { AppState } from "../domain/types";

export interface SqliteCacheStatus {
  available: boolean;
  backend: "opfs" | "transient" | "unavailable";
  sqliteVersion?: string;
  filename?: string;
  reason?: string;
}

export class SqliteWorkingCache {
  private constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly db: Database,
    readonly status: SqliteCacheStatus
  ) {}

  static async open(): Promise<SqliteWorkingCache | undefined> {
    try {
      const sqlite3 = await sqlite3InitModule();
      const hasOpfs = Boolean(sqlite3.oo1.OpfsDb) && globalThis.crossOriginIsolated;
      const db = hasOpfs
        ? new sqlite3.oo1.OpfsDb("/residency-days.sqlite3")
        : new sqlite3.oo1.DB("/residency-days.sqlite3", "ct");

      const cache = new SqliteWorkingCache(sqlite3, db, {
        available: true,
        backend: hasOpfs ? "opfs" : "transient",
        sqliteVersion: sqlite3.version.libVersion,
        filename: db.filename
      });
      cache.migrate();
      return cache;
    } catch (error) {
      console.warn("SQLite WASM cache unavailable", error);
      return undefined;
    }
  }

  saveState(state: AppState): void {
    const json = JSON.stringify(state);
    const statement = this.db.prepare(
      "insert into app_state(id, json, updated_at) values('current', ?, ?) " +
        "on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at"
    );
    try {
      statement.bind([json, new Date().toISOString()]).step();
    } finally {
      statement.finalize();
    }
  }

  loadState(): AppState | undefined {
    const json = this.db.selectValue(
      "select json from app_state where id = 'current'",
      undefined,
      this.sqlite3.capi.SQLITE_TEXT
    );
    return typeof json === "string" ? (JSON.parse(json) as AppState) : undefined;
  }

  exportBytes(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db);
  }

  private migrate(): void {
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists app_state (
        id text primary key,
        json text not null,
        updated_at text not null
      );
    `);
  }
}
