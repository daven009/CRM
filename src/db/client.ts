import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let dbInstance: Database.Database | null = null;

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) {
    return configured;
  }

  return path.join(process.cwd(), "data", "crm.sqlite");
}

function ensureParentDir(filePath: string) {
  if (filePath === ":memory:") {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function getDb() {
  if (!dbInstance) {
    const databasePath = resolveDatabasePath();
    ensureParentDir(databasePath);
    dbInstance = new Database(databasePath);
    dbInstance.pragma("journal_mode = WAL");
  }

  return dbInstance;
}

export function closeDb() {
  dbInstance?.close();
  dbInstance = null;
}
