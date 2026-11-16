const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20); // Bot API download সীমা ২০MB

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  SITE_URL: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // ফ্রন্টএন্ড (InfinityFree বা অন্য হোস্টে) — শেয়ার লিংক এখানে তৈরি হয়
  FRONTEND_URL: (process.env.FRONTEND_URL || process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // কোন কোন ওয়েবসাইট থেকে API কল করা যাবে (কমা দিয়ে)
  FRONTEND_ORIGINS: (process.env.FRONTEND_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'app.db'),
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  TG_API_BASE: (process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/$/, ''),
  BOT_USERNAME: process.env.BOT_USERNAME || '',
  CHANNEL_ID: process.env.CHANNEL_ID || '',           // ফাইল স্টোরেজ চ্যানেল (প্রাইভেট)
  BACKUP_CHAT_ID: process.env.BACKUP_CHAT_ID || '',   // ডাটাবেস ব্যাকআপ চ্যানেল (প্রাইভেট)
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_TELEGRAM_ID: process.env.ADMIN_TELEGRAM_ID || '',
  MAX_MB,
  MAX_BYTES: MAX_MB * 1024 * 1024,
  BACKUP_EVERY_MS: Number(process.env.BACKUP_MINUTES || 10) * 60 * 1000,
};
