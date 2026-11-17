// Telegram Bot API-র সব কল এখানে। ফাইল স্টোরেজ = Telegram চ্যানেল (কোনো ফ্রি লিমিট নেই)।
const { BOT_TOKEN, CHANNEL_ID, BACKUP_CHAT_ID, FILE_BACKUP_CHAT_ID, FILE_BACKUP_2_CHAT_ID, TG_API_BASE } = require('./config');

// TG_API_BASE ডিফল্ট public API; নিজের Local Bot API server চালালে সেটার URL দিন (২০MB লিমিট উঠে যায়)
const API = `${TG_API_BASE}/bot${BOT_TOKEN}`;
const FILE_API = `${TG_API_BASE}/file/bot${BOT_TOKEN}`;

const configured = () => Boolean(BOT_TOKEN);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'invalid response' }));
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

function sendMessage(chatId, text, reply_markup) {
  return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) });
}

function copyMessage(toChatId, fromChatId, messageId) {
  return call('copyMessage', { chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId });
}

// বাফার চ্যানেলে আপলোড (sendDocument = মূল কোয়ালিটি বজায় থাকে)। { message_id, file_id } ফেরত দেয়
async function storeBuffer(buffer, filename, mime, caption, chatId = CHANNEL_ID) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);
  if (caption) form.append('caption', String(caption).slice(0, 1000));
  const res = await fetch(`${API}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({ ok: false, description: 'invalid response' }));
  if (!data.ok) throw new Error(`sendDocument: ${data.description}`);
  return { message_id: data.result.message_id, file_id: data.result.document.file_id };
}

// getFile: শুধু ২০MB পর্যন্ত কাজ করে (Bot API সীমা)
async function getFilePath(fileId) {
  const f = await call('getFile', { file_id: fileId });
  return f.file_path;
}
const fileUrl = (filePath) => `${FILE_API}/${filePath}`;

const deleteMessage = (chatId, messageId) => call('deleteMessage', { chat_id: chatId, message_id: messageId });

module.exports = {
  configured, call, sendMessage, copyMessage, storeBuffer, getFilePath, fileUrl, deleteMessage, esc,
  CHANNEL_ID, BACKUP_CHAT_ID, FILE_BACKUP_CHAT_ID, FILE_BACKUP_2_CHAT_ID,
};
