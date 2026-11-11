// Banco SQLite (módulo nativo do Node, sem dependências).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('professor', 'aluno')),
     turma TEXT NOT NULL DEFAULT '',
     password_hash TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE programs (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL COLLATE NOCASE,
     code TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (user_id, name)
   );
   CREATE TABLE settings (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     json TEXT NOT NULL
   );`,
  // 2: sem papel fixo; turmas próprias, convites e entregas
  `ALTER TABLE users DROP COLUMN role;
   ALTER TABLE users DROP COLUMN turma;
   ALTER TABLE users ADD COLUMN email TEXT;
   CREATE UNIQUE INDEX users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
   CREATE TABLE turmas (
     id INTEGER PRIMARY KEY,
     owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     invite_code TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX turmas_owner ON turmas(owner_id);
   CREATE TABLE turma_members (
     turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     joined_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (turma_id, user_id)
   );
   CREATE INDEX members_user ON turma_members(user_id);
   CREATE TABLE submissions (
     id INTEGER PRIMARY KEY,
     turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
     name TEXT NOT NULL,
     code TEXT NOT NULL,
     submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX submissions_turma ON submissions(turma_id, user_id);`,
];

export function openDb(file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'cnc.db')) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
