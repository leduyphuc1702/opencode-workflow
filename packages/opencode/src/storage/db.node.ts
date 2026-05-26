import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { mkdirSync } from "fs"
import path from "path"

export function init(dbPath: string) {
  ensureDatabaseDirectory(dbPath)
  const sqlite = new DatabaseSync(dbPath)
  const db = drizzle({ client: sqlite })
  return db
}

function ensureDatabaseDirectory(dbPath: string) {
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) return
  mkdirSync(path.dirname(dbPath), { recursive: true })
}
