// Telegram বট: ফাইল পাঠালে সেভ হয়, শেয়ার লিংক ফেরত দেয়। Long-polling ব্যবহার (কোনো ডোমেইন লাগে না)।
const crypto = require('crypto');
const db = require('./db');
const tg = require('./telegram');
const { SITE_URL, FRONTEND_URL, MAX_BYTES, MAX_MB, ADMIN_TELEGRAM_ID } = require('./config');

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
  if (m.photo) { const p = m.photo[m.photo.length - 1]; return { file_id: p.file_id, name: `photo_${m.message_id}.jpg`, size: p.file_size, mime: 'image/jpeg' }; }
  return null;
}

function welcome(tid) {
  return `👋 <b>স্বাগতম!</b>\nএই বটে ফাইল পাঠালে সেটা আপনার অ্যাকাউন্টে সেভ হবে এবং শেয়ার লিংক পাবেন।\n\n` +
    `🆔 আপনার টেলিগ্রাম আইডি: <code>${tid}</code>\n(এটি ওয়েবসাইটে রেজিস্ট্রেশনের সময় দিন)\n\n` +
    `🌐 ওয়েবসাইট: ${FRONTEND_URL}\n📂 /myfiles — আপনার ফাইলের তালিকা\n❓ /help — সাহায্য\n\n` +
    `সর্বোচ্চ ফাইল সাইজ: ${MAX_MB} MB`;
}

async function saveAttachment(chatId, tid, a) {
  const user = db.userByTelegram(tid);
  if (!user) return reply(chatId, `ফাইল সেভ করতে আগে ওয়েবসাইটে রেজিস্টার করুন।\nআপনার টেলিগ্রাম আইডি: <code>${tid}</code>`);
  if (user.banned) return reply(chatId, 'আপনার অ্যাকাউন্ট বন্ধ করা আছে।');
  if (a.size && a.size > MAX_BYTES) return reply(chatId, `⚠️ ফাইল বড়। সর্বোচ্চ ${MAX_MB} MB।`);
  const name = cleanName(a.name);
  const code = newCode();
  db.insertFile(user.id, name, a.mime || 'application/octet-stream', a.size || 0, kindOf(a.mime), a.file_id, null, code, Date.now());
  return reply(chatId, `✅ সেভ হয়েছে: <b>${tg.esc(name)}</b>\n🔗 ${FRONTEND_URL}/#/f/${code}`);
}

async function handle(msg) {
  const chatId = msg.chat.id;
  const tid = String(msg.from ? msg.from.id : chatId);
  const cmd = (msg.text || '').trim().split(/\s+/)[0].toLowerCase().replace(/@.+$/, '');

  if (cmd === '/start' || cmd === '/help') return reply(chatId, welcome(tid));

  if (cmd === '/myfiles') {
    const user = db.userByTelegram(tid);
    if (!user) return reply(chatId, 'প্রথমে ওয়েবসাইটে রেজিস্টার করুন।');
    const files = db.filesByOwner(user.id, '%').slice(0, 10);
    if (!files.length) return reply(chatId, 'এখনো কোনো ফাইল নেই।');
    return reply(chatId, files.map((f, i) => `${i + 1}. ${tg.esc(f.name)}\n${FRONTEND_URL}/#/f/${f.share_code}`).join('\n\n'));
  }

  if (cmd === '/stats') {
    if (tid !== String(ADMIN_TELEGRAM_ID)) return reply(chatId, 'এই কমান্ড শুধু অ্যাডমিনের জন্য।');
    const s = db.stats();
    return reply(chatId, `👤 ইউজার: ${s.users}\n📁 ফাইল: ${s.files}\n⬇️ মোট ডাউনলোড: ${s.downloads}`);
  }

  const att = attachmentOf(msg);
  if (att) return saveAttachment(chatId, tid, att);
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
