
const { BOT_TOKEN, CHANNEL_ID, BACKUP_CHAT_ID, PERMANENT_CHANNEL_ID, TG_API_BASE } = require('./config');

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

function sendMessage(chatId, text) {
  return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

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

async function getFilePath(fileId) {
  const f = await call('getFile', { file_id: fileId });
  return f.file_path;
}
const fileUrl = (filePath) => `${FILE_API}/${filePath}`;

const copyMessage = (toChatId, fromChatId, messageId) => call('copyMessage', {
  chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId
});

const deleteMessage = (chatId, messageId) => call('deleteMessage', {
  chat_id: chatId, message_id: messageId
});

module.exports = {
  configured, call, sendMessage, storeBuffer, getFilePath, fileUrl, deleteMessage, esc,
  CHANNEL_ID, BACKUP_CHAT_ID, PERMANENT_CHANNEL_ID, copyMessage,
};
