// SQLite (MySQL লাগবে না)। ফাইলের আসল ডাটা Telegram-এ থাকে, এখানে শুধু মেটাডাটা।
const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR, DB_PATH } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  telegram_id TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  verified INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  otp_hash TEXT,
  otp_expires INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tg_file_id TEXT NOT NULL,
  tg_message_id INTEGER,
  share_code TEXT UNIQUE NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL COLLATE NOCASE,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

`);

// Existing database migration: one-way hashed personal login codes.
try { db.exec('ALTER TABLE users ADD COLUMN login_code_hash TEXT'); } catch (e) {
  if (!String(e.message).includes('duplicate column')) throw e;
}

// ব্যাকআপের জন্য: ডাটা বদলালে dirty = true হয়
let dirty = true;
const w = (sql) => { const s = db.prepare(sql); return (...a) => { const r = s.run(...a); dirty = true; return r; }; };
const r1 = (sql) => { const s = db.prepare(sql); return (...a) => s.get(...a); };
const rN = (sql) => { const s = db.prepare(sql); return (...a) => s.all(...a); };
// সেশন বদলালে ব্যাকআপ লাগে না
const wNoBackup = (sql) => { const s = db.prepare(sql); return (...a) => s.run(...a); };

module.exports = {
  db,
  isDirty: () => dirty,
  markDirty: () => { dirty = true; },
  clearDirty: () => { dirty = false; },

  createUser: w(`INSERT INTO users (username, password_hash, telegram_id, role, verified, created_at) VALUES (?,?,?,?,?,?)`),
  setAdminPassword: w(`UPDATE users SET password_hash=?, role='admin', verified=1 WHERE id=?`),
  promoteAdmin: w(`UPDATE users SET role='admin', verified=1 WHERE id=?`),
  userByName: r1(`SELECT * FROM users WHERE username = ?`),
  userByLoginCode: r1(`SELECT * FROM users WHERE login_code_hash = ?`),
  setLoginCode: w(`UPDATE users SET login_code_hash=?, verified=1 WHERE id=?`),
  createInvite: w(`INSERT INTO invite_codes (code, created_at) VALUES (?,?)`),
  inviteByCode: r1(`SELECT * FROM invite_codes WHERE code=?`),
  consumeInvite: w(`UPDATE invite_codes SET used_by=?, used_at=? WHERE id=? AND used_by IS NULL`),
  listInvites: rN(`SELECT id, code, used_by, created_at, used_at FROM invite_codes ORDER BY id DESC LIMIT 200`),
  userById: r1(`SELECT * FROM users WHERE id = ?`),
  userByTelegram: r1(`SELECT * FROM users WHERE telegram_id = ?`),
  setOtp: w(`UPDATE users SET otp_hash=?, otp_expires=? WHERE id=?`),
  markVerified: w(`UPDATE users SET verified=1, otp_hash=NULL, otp_expires=NULL WHERE id=?`),
  setBanned: w(`UPDATE users SET banned=? WHERE id=?`),
  deleteUser: w(`DELETE FROM users WHERE id=?`),
  listUsers: rN(`SELECT id, username, telegram_id, role, verified, banned, created_at,
                 (SELECT COUNT(*) FROM files f WHERE f.owner_id = users.id) AS files
                 FROM users ORDER BY id DESC`),
  filesOfUser: rN(`SELECT tg_message_id FROM files WHERE owner_id=? AND tg_message_id IS NOT NULL`),

  createSession: wNoBackup(`INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)`),
  sessionUser: r1(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`),
  deleteSession: wNoBackup(`DELETE FROM sessions WHERE token=?`),

  insertFile: w(`INSERT INTO files (owner_id, name, mime, size, kind, tg_file_id, tg_message_id, share_code, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?)`),
  filesByOwner: rN(`SELECT * FROM files WHERE owner_id=? AND name LIKE ? ORDER BY id DESC LIMIT 200`),
  fileById: r1(`SELECT * FROM files WHERE id=?`),
  fileByCode: r1(`SELECT f.*, u.username AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.share_code=?`),
  renameFile: w(`UPDATE files SET name=? WHERE id=?`),
  deleteFile: w(`DELETE FROM files WHERE id=?`),
  bumpDownloads: w(`UPDATE files SET downloads = downloads + 1 WHERE id=?`),
  listAllFiles: rN(`SELECT f.id, f.name, f.size, f.kind, f.share_code, f.downloads, f.created_at, u.username AS owner
                    FROM files f JOIN users u ON u.id = f.owner_id ORDER BY f.id DESC LIMIT 300`),
  stats: r1(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM files) AS files,
             (SELECT COALESCE(SUM(size),0) FROM files) AS bytes,
             (SELECT COALESCE(SUM(downloads),0) FROM files) AS downloads`),
};
