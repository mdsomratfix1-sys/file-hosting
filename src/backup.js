// Render/Railway ফ্রি প্ল্যানে ডিস্ক মুছে যায়। তাই SQLite ডাটাবেস প্রাইভেট চ্যানেলে ব্যাকআপ রাখা হয়
// এবং নতুন করে চালু হলে সেখান থেকে ফেরত আনা হয়। ফাইল নিজেও Telegram-এ থাকে, তাই ফাইল হারায় না।
const fs = require('fs');
const path = require('path');
const { DATA_DIR, DB_PATH, BACKUP_CHAT_ID } = require('./config');
const tg = require('./telegram');

let lastBackupMsgId = null;

async function restoreIfMissing() {
  if (fs.existsSync(DB_PATH)) return;
  if (!tg.configured() || !BACKUP_CHAT_ID) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const chat = await tg.call('getChat', { chat_id: BACKUP_CHAT_ID });
  const doc = chat.pinned_message && chat.pinned_message.document;
  if (!doc) { console.log('কোনো ব্যাকআপ নেই, নতুন ডাটাবেস তৈরি হবে'); return; }
  const filePath = await tg.getFilePath(doc.file_id);
  const res = await fetch(tg.fileUrl(filePath));
  if (!res.ok) throw new Error('ব্যাকআপ ডাউনলোড ব্যর্থ');
  fs.writeFileSync(DB_PATH, Buffer.from(await res.arrayBuffer()));
  console.log('✅ ডাটাবেস ব্যাকআপ থেকে ফেরত আনা হয়েছে');
}

async function backupNow() {
  const db = require('./db');
  if (!tg.configured() || !BACKUP_CHAT_ID || !db.isDirty()) return;
  db.clearDirty();
  const tmp = path.join(DATA_DIR, 'backup-tmp.db');
  try {
    await db.db.backup(tmp); // সেফ স্ন্যাপশট
    const sent = await tg.storeBuffer(fs.readFileSync(tmp), 'app-backup.db', 'application/octet-stream',
      'DB backup ' + new Date().toISOString(), BACKUP_CHAT_ID);
    await tg.call('pinChatMessage', { chat_id: BACKUP_CHAT_ID, message_id: sent.message_id, disable_notification: true });
    if (lastBackupMsgId) tg.deleteMessage(BACKUP_CHAT_ID, lastBackupMsgId).catch(() => {});
    lastBackupMsgId = sent.message_id;
  } catch (e) {
    db.markDirty();
    console.error('ব্যাকআপ ব্যর্থ:', e.message);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

module.exports = { restoreIfMissing, backupNow };
