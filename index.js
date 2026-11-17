// এন্ট্রি পয়েন্ট: আগে ব্যাকআপ থেকে ডাটাবেস ফেরত আনা, তারপর সার্ভার + বট চালু
const config = require('./src/config');
const backup = require('./src/backup');

(async () => {
  try {
    await backup.restoreIfMissing();
  } catch (e) {
    console.error('ব্যাকআপ রিস্টোর ব্যর্থ (নতুন ডাটাবেস দিয়ে চলবে):', e.message);
  }
  require('./src/server').start();
  require('./src/bot').start();
  setInterval(() => backup.backupNow(), config.BACKUP_EVERY_MS);

  process.on('SIGTERM', async () => {
    await backup.backupNow();
    process.exit(0);
  });
})();
