
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const db = require('./db');
const tg = require('./telegram');
const C = require('./config');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newCode = () => crypto.randomBytes(6).toString('base64url');
const otpCode = () => String(crypto.randomInt(100000, 1000000));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 3600 * 1000 };

const cleanName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 180) || 'file';
const kindOf = (m = '') => (m.startsWith('image/') ? 'image' : m.startsWith('video/') ? 'video'
  : m.startsWith('audio/') ? 'audio' : m === 'application/pdf' ? 'pdf' : 'file');
const isSafeInline = (m = '') => /^(image|video|audio)\//.test(m) || m === 'application/pdf';
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, telegram_id: u.telegram_id });
const publicFile = (f) => ({
  id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind, share_code: f.share_code,
  downloads: f.downloads, created_at: f.created_at, owner: f.owner_name, url: `/f/${f.share_code}`,
});

// ---- rate limit ----
const hits = new Map();
function limited(req) {
  const k = req.ip + req.path, t = now();
  let e = hits.get(k);
  if (!e || e.reset < t) e = { n: 0, reset: t + 15 * 60 * 1000 };
  e.n++; hits.set(k, e);
  return e.n > 20;
}

// ---- auth helpers ----
function tokenOf(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return (req.cookies && req.cookies.sid) || null;
}
function currentUser(req) {
  const sid = tokenOf(req);
  if (!sid) return null;
  const u = db.sessionUser(sid);
  return u && !u.banned ? u : null;
}
function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'আগে লগইন করুন' });
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'অনুমতি নেই' });
    next();
  });
}
function loadFileForUser(req, res) {
  const f = db.fileById(Number(req.params.id));
  if (!f || (f.owner_id !== req.user.id && req.user.role !== 'admin')) {
    res.status(404).json({ error: 'ফাইল পাওয়া যায়নি' }); return null;
  }
  return f;
}

async function sendOtp(tid, code) {
  if (!tg.configured()) { console.log(`[DEV] OTP (${tid}): ${code}`); return; }
  await tg.sendMessage(tid, `🔐 আপনার ভেরিফিকেশন কোড: <b>${code}</b>\n১০ মিনিটের মধ্যে ব্যবহার করুন।`);
}

function seedAdmin() {
  if (!C.ADMIN_USERNAME || !C.ADMIN_PASSWORD) { console.log('⚠️ ADMIN_USERNAME/ADMIN_PASSWORD সেট নেই'); return; }
  const hash = bcrypt.hashSync(C.ADMIN_PASSWORD, 10);
  const existing = db.userByName(C.ADMIN_USERNAME);
  if (existing) db.setAdminPassword(hash, existing.id);
  else db.createUser(C.ADMIN_USERNAME, hash, C.ADMIN_TELEGRAM_ID || null, 'admin', 1, now());
  console.log('✅ অ্যাডমিন প্রস্তুত:', C.ADMIN_USERNAME);
}

// ---- Telegram stream ----
async function streamFile(f, req, res, download) {
  let filePath;
  try { filePath = await tg.getFilePath(f.tg_file_id); }
  catch (e) { return res.status(502).json({ error: 'Telegram থেকে ফাইল পড়া যাচ্ছে না: ' + e.message }); }

  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;
  const up = await fetch(tg.fileUrl(filePath), { headers });
  if (!up.ok || !up.body) return res.status(502).json({ error: 'ডাউনলোড ব্যর্থ' });

  const forceDownload = download || !isSafeInline(f.mime);
  res.status(up.status);
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  for (const h of ['content-length', 'content-range']) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('Content-Disposition', `${forceDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  Readable.fromWeb(up.body).pipe(res);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: C.MAX_BYTES, files: 10 } });

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && C.FRONTEND_ORIGINS.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/config', (req, res) => res.json({
    maxMb: C.MAX_MB,
    botUsername: C.BOT_USERNAME,
    frontendUrl: C.FRONTEND_URL,
    apiUrl: C.SITE_URL
  }));

  // ---------- auth ----------
  app.post('/api/auth/register', wrap(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const tid = String(req.body.telegram_id || '').trim();

    if (!/^[A-Za-z0-9_.]{3,24}$/.test(username))
      return res.status(400).json({ error: 'ইউজারনেম ৩-২৪ অক্ষর (ইংরেজি, সংখ্যা, _ .)' });
    if (password.length < 6)
      return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষর' });
    if (!/^\d{5,15}$/.test(tid))
      return res.status(400).json({ error: 'সঠিক টেলিগ্রাম আইডি দিন (@userinfobot থেকে পাবেন)' });
    if (db.userByName(username))
      return res.status(409).json({ error: 'এই ইউজারনেম আগে থেকেই আছে' });
    if (db.userByTelegram(tid))
      return res.status(409).json({ error: 'এই টেলিগ্রাম আইডিতে আগে অ্যাকাউন্ট খোলা আছে' });

    const info = db.createUser(username, await bcrypt.hash(password, 10), tid, 'user', 0, now());
    const code = otpCode();
    db.setOtp(sha(code), now() + 10 * 60 * 1000, info.lastInsertRowid);
    try { await sendOtp(tid, code); }
    catch (e) {
      db.deleteUser(info.lastInsertRowid);
      return res.status(400).json({ error: 'আগে বটে /start লিখুন, তারপর আবার রেজিস্টার করুন' });
    }
    res.json({ ok: true });
  }));

  app.post('/api/auth/resend', wrap(async (req, res) => {
    const user = db.userByName(String(req.body.username || '').trim());
    if (!user || user.verified) return res.json({ ok: true });
    const code = otpCode();
    db.setOtp(sha(code), now() + 10 * 60 * 1000, user.id);
    await sendOtp(user.telegram_id, code);
    res.json({ ok: true });
  }));

  app.post('/api/auth/verify', (req, res) => {
    const user = db.userByName(String(req.body.username || '').trim());
    if (!user) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
    if (user.verified) return res.json({ ok: true });
    const good = user.otp_hash && user.otp_expires > now() && user.otp_hash === sha(String(req.body.code || '').trim());
    if (!good) return res.status(400).json({ error: 'কোড ভুল বা মেয়াদ শেষ' });
    db.markVerified(user.id);
    res.json({ ok: true });
  });

  app.post('/api/auth/login', wrap(async (req, res) => {
    if (limited(req))
      return res.status(429).json({ error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পর আবার চেষ্টা করুন' });

    const user = db.userByName(String(req.body.username || '').trim());
    const ok = user && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'ইউজারনেম বা পাসওয়ার্ড ভুল' });
    if (user.banned) return res.status(403).json({ error: 'এই অ্যাকাউন্ট বন্ধ করা হয়েছে' });
    if (!user.verified)
      return res.status(403).json({ error: 'আগে ভেরিফাই করুন', needsVerify: true, username: user.username });

    const token = crypto.randomBytes(32).toString('hex');
    db.createSession(token, user.id, now());
    res.cookie('sid', token, cookieOpts);
    res.json({ ok: true, token, user: publicUser(user) });
  }));

  app.post('/api/auth/logout', (req, res) => {
    const t = tokenOf(req);
    if (t) db.deleteSession(t);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    const u = currentUser(req);
    res.json({ user: u ? publicUser(u) : null });
  });

  // ---------- files (owner) ----------
  app.get('/api/files', requireUser, (req, res) => {
    const q = `%${String(req.query.q || '').slice(0, 60)}%`;
    res.json({ files: db.filesByOwner(req.user.id, q).map(publicFile) });
  });

  app.post('/api/files', requireUser, upload.array('files', 10), wrap(async (req, res) => {
    if (!req.files || !req.files.length)
      return res.status(400).json({ error: 'কোনো ফাইল পাওয়া যায়নি' });
    if (!tg.configured() || !tg.CHANNEL_ID)
      return res.status(500).json({ error: 'সার্ভারে BOT_TOKEN/CHANNEL_ID সেট করা নেই' });

    const out = [];
    for (const f of req.files) {
      const name = cleanName(f.originalname);
      const mime = f.mimetype || 'application/octet-stream';
      const sent = await tg.storeBuffer(f.buffer, name, mime, `${req.user.username}: ${name}`);

      // Permanent Channel-এ কপি
      if (tg.PERMANENT_CHANNEL_ID) {
        try {
          await tg.copyMessage(tg.PERMANENT_CHANNEL_ID, tg.CHANNEL_ID, sent.message_id);
          console.log('Permanent backup copied:', name);
        } catch (e) {
          console.error('Permanent copy failed:', e.message);
        }
      }

      const info = db.insertFile(req.user.id, name, mime, f.size, kindOf(mime), sent.file_id, sent.message_id, newCode(), now());
      out.push(publicFile(db.fileById(info.lastInsertRowid)));
    }
    res.json({ files: out });
  }));

  app.patch('/api/files/:id', requireUser, (req, res) => {
    const f = loadFileForUser(req, res);
    if (!f) return;
    const name = cleanName(req.body.name);
    db.renameFile(name, f.id);
    res.json({ ok: true });
  });

  app.delete('/api/files/:id', requireUser, wrap(async (req, res) => {
    const f = loadFileForUser(req, res);
    if (!f) return;
    db.deleteFile(f.id);
    if (f.tg_message_id && tg.CHANNEL_ID)
      tg.deleteMessage(tg.CHANNEL_ID, f.tg_message_id).catch(() => {});
    res.json({ ok: true });
  }));

  // ---------- public share ----------
  app.get('/api/share/:code', (req, res) => {
    const f = db.fileByCode(req.params.code);
    if (!f) return res.status(404).json({ error: 'এই লিংকের ফাইল নেই' });
    res.json({ file: publicFile(f) });
  });

  app.get('/api/share/:code/raw', wrap(async (req, res) => {
    const f = db.fileByCode(req.params.code);
    if (!f) return res.status(404).json({ error: 'এই লিংকের ফাইল নেই' });
    const download = 'download' in req.query;
    if (download) db.bumpDownloads(f.id);
    await streamFile(f, req, res, download);
  }));

  // ---------- admin ----------
  app.get('/api/admin/stats', requireAdmin, (req, res) => res.json({ stats: db.stats() }));
  app.get('/api/admin/users', requireAdmin, (req, res) => res.json({ users: db.listUsers() }));
  app.get('/api/admin/files', requireAdmin, (req, res) => res.json({ files: db.listAllFiles().map(publicFile) }));

  app.post('/api/admin/users/:id/ban', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'নিজেকে বন্ধ করা যাবে না' });
    db.setBanned(req.body.banned ? 1 : 0, id);
    res.json({ ok: true });
  });

  app.delete('/api/admin/users/:id', requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'নিজেকে মোছা যাবে না' });
    for (const row of db.filesOfUser(id))
      tg.deleteMessage(tg.CHANNEL_ID, row.tg_message_id).catch(() => {});
    db.deleteUser(id);
    res.json({ ok: true });
  }));

  // ---------- static + SPA ----------
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
  app.get('/f/:code', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'পাওয়া যায়নি' }));

  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: `ফাইল সর্বোচ্চ ${C.MAX_MB} MB হতে পারে` });
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE')
      return res.status(400).json({ error: 'একবারে বেশি ফাইল' });
    console.error('server error:', err && err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err && err.message ? err.message : 'সার্ভার সমস্যা' });
  });

  return app;
}

function start() {
  seedAdmin();
  createApp().listen(C.PORT, '0.0.0.0', () => console.log(`🌐 সার্ভার চালু: port ${C.PORT}`));
}

module.exports = { start };
