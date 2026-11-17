// Telegram বট: ফাইল পাঠালে সেভ হয়, শেয়ার লিংক ফেরত দেয়। Long-polling ব্যবহার (কোনো ডোমেইন লাগে না)।
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const tg = require('./telegram');
const { SITE_URL, FRONTEND_URL, MAX_BYTES, MAX_MB, ADMIN_TELEGRAM_ID, CHANNEL_ID, FILE_BACKUP_CHAT_ID, FILE_BACKUP_2_CHAT_ID } = require('./config');

const newCode = () => crypto.randomBytes(6).toString('base64url');
const cleanName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 180) || 'file';
const kindOf = (m = '') => (m.startsWith('image/') ? 'image' : m.startsWith('video/') ? 'video'
  : m.startsWith('audio/') ? 'audio' : m === 'application/pdf' ? 'pdf' : 'file');
const reply = (chatId, text) => tg.sendMessage(chatId, text).catch((e) => console.error('reply:', e.message));

function attachmentOf(m) {
  if (m.document) return { file_id: m.document.file_id, name: m.document.file_name, size: m.document.file_size, mime: m.document.mime_type };
  if (m.video) return { file_id: m.video.file_id, name: m.video.file_name || `video_${m.message_id}.mp4`, size: m.video.file_size, mime: m.video.mime_type || 'video/mp4' };
  if (m.audio) return { file_id: m.audio.file_id, name: m.audio.file_name || `audio_${m.message_id}.mp3`, size: m.audio.file_size, mime: m.audio.mime_type || 'audio/mpeg' };
  if (m.voice) return { file_id: m.voice.file_id, name: `voice_${m.message_id}.ogg`, size: m.voice.file_size, mime: 'audio/ogg' };
  if (m.animation) return { file_id: m.animation.file_id, name: m.animation.file_name || `animation_${m.message_id}.mp4`, size: m.animation.file_size, mime: m.animation.mime_type || 'video/mp4' };
  if (m.video_note) return { file_id: m.video_note.file_id, name: `video_note_${m.message_id}.mp4`, size: m.video_note.file_size, mime: 'video/mp4' };
  if (m.photo) { const p = m.photo[m.photo.length - 1]; return { file_id: p.file_id, name: `photo_${m.message_id}.jpg`, size: p.file_size, mime: 'image/jpeg' }; }
  return null;
}

function welcome(tid) {
  return `👋 <b>স্বাগতম SOMRAT Storage-এ!</b>\nএই বটে যেকোনো সমর্থিত ফাইল পাঠান। রেজিস্ট্রেশন লাগবে না।\n\n` +
    `📂 /myfiles — আপনার ফাইলের তালিকা\n❓ /help — সাহায্য\n\n` +
    `আপনার ফাইল মূল চ্যানেল ও ২টি ব্যাকআপ চ্যানেলে কপি হবে।\nসর্বোচ্চ ফাইল সাইজ: ${MAX_MB} MB`;
}

function ensureTelegramUser(tid) {
  let user = db.userByTelegram(tid);
  if (user) return user;
  const username = `tg_${tid}`;
  const pass = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  const result = db.createUser(username, pass, tid, 'user', 1, Date.now());
  return db.userById(result.lastInsertRowid);
}

function mediaFileId(message) {
  for (const key of ['document', 'video', 'audio', 'voice', 'animation', 'video_note']) {
    if (message[key] && message[key].file_id) return message[key].file_id;
  }
  if (message.photo && message.photo.length) return message.photo[message.photo.length - 1].file_id;
  return null;
}

async function saveAttachment(chatId, tid, a, msg) {
  const user = ensureTelegramUser(tid);
  if (user.banned) return reply(chatId, 'আপনার অ্যাকাউন্ট বন্ধ করা আছে।');
  if (!SITE_URL) {
    return reply(chatId, '⚠️ SITE_URL সেট করা নেই। Render-এর public URL Environment Variables-এ দিন।');
  }
  if (!CHANNEL_ID || !FILE_BACKUP_CHAT_ID || !FILE_BACKUP_2_CHAT_ID) {
    return reply(chatId, '⚠️ Storage channel configuration অসম্পূর্ণ। অ্যাডমিনকে CHANNEL_ID, FILE_BACKUP_CHAT_ID এবং FILE_BACKUP_2_CHAT_ID সেট করতে বলুন।');
  }
  if (a.size && a.size > MAX_BYTES) return reply(chatId, `⚠️ ফাইল বড়। সর্বোচ্চ ${MAX_MB} MB।`);
  const name = cleanName(a.name);
  try {
    // মূল এবং দুই ব্যাকআপ চ্যানেলে Telegram-এর server-side copy; কোনো public file URL প্রকাশ করা হয় না।
    const main = await tg.copyMessage(CHANNEL_ID, chatId, msg.message_id);
    await tg.copyMessage(FILE_BACKUP_CHAT_ID, chatId, msg.message_id);
    await tg.copyMessage(FILE_BACKUP_2_CHAT_ID, chatId, msg.message_id);
    const storedId = mediaFileId(main);
    if (!storedId) throw new Error('মূল চ্যানেলের কপি থেকে file_id পাওয়া যায়নি');
    const code = newCode();
    db.insertFile(user.id, name, a.mime || 'application/octet-stream', a.size || 0, kindOf(a.mime), storedId, main.message_id, code, Date.now());
    const url = `${SITE_URL}/api/share/${code}/raw`;
    const text = `✅ <b>তিনটি চ্যানেলে সফলভাবে সেভ হয়েছে</b>\n📄 ${tg.esc(name)}\n\n🔗 <code>${url}</code>\n\nমূল Storage + Backup 1 + Backup 2`;
    return tg.sendMessage(chatId, text, { inline_keyboard: [[{ text: '🔗 লিংক কপি করুন', copy_text: { text: url } }, { text: '▶️ লিংক খুলুন', url }]] });
  } catch (e) {
    console.error('triple channel save failed:', e.message);
    return reply(chatId, `❌ তিনটি চ্যানেলে কপি সম্পন্ন হয়নি। কোনো ফাইল সেভ হয়েছে বলে নিশ্চিত করা যাচ্ছে না।\nকারণ: ${tg.esc(e.message)}`);
  }
}

async function handle(msg) {
  const chatId = msg.chat.id;
  const tid = String(msg.from ? msg.from.id : chatId);
  const cmd = (msg.text || '').trim().split(/\s+/)[0].toLowerCase().replace(/@.+$/, '');

  if (cmd === '/start' || cmd === '/help') return reply(chatId, welcome(tid));

  if (cmd === '/myfiles') {
    const user = db.userByTelegram(tid);
    if (!user) return reply(chatId, 'এখনো কোনো ফাইল নেই। ফাইল পাঠালেই এখানে তালিকায় দেখা যাবে।');
    const files = db.filesByOwner(user.id, '%').slice(0, 10);
    if (!files.length) return reply(chatId, 'এখনো কোনো ফাইল নেই।');
    return reply(chatId, files.map((f, i) => `${i + 1}. ${tg.esc(f.name)}\n${SITE_URL}/api/share/${f.share_code}/raw`).join('\n\n'));
  }

  if (cmd === '/stats') {
    if (tid !== String(ADMIN_TELEGRAM_ID)) return reply(chatId, 'এই কমান্ড শুধু অ্যাডমিনের জন্য।');
    const s = db.stats();
    return reply(chatId, `👤 ইউজার: ${s.users}\n📁 ফাইল: ${s.files}\n⬇️ মোট ডাউনলোড: ${s.downloads}`);
  }

  const att = attachmentOf(msg);
  if (att) return saveAttachment(chatId, tid, att, msg);
  return reply(chatId, 'ফাইল পাঠান, অথবা /help লিখুন।');
}

async function loop() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg.call('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) handle(u.message).catch((e) => console.error('bot handler:', e.message));
      }
    } catch (e) {
      console.error('bot poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function start() {
  if (!tg.configured()) { console.log('BOT_TOKEN নেই, বট বন্ধ থাকবে (ওয়েবসাইট চলবে)'); return; }
  tg.call('deleteWebhook', {}).catch(() => {}).then(() => { console.log('🤖 বট চালু'); loop(); });
}

module.exports = { start };
