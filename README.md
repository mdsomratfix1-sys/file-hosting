SOMRAT STORAGE — TELEGRAM BOT + 2 BACKUP CHANNELS
==================================================

কাজের ধরন
---------
১) ইউজার Telegram bot-এ ফাইল পাঠাবে।
২) Bot ফাইলটি মূল Storage Channel এবং দুইটি Backup Channel-এ copyMessage দিয়ে কপি করবে।
৩) তিনটি কপি সফল হওয়ার পরেই Bot Render-এর public share link পাঠাবে।
৪) লিংক থেকে ছবি/PDF দেখা এবং সমর্থিত ভিডিও/অডিও চালানো যাবে; অন্য ফাইল ডাউনলোড হবে।
৫) /myfiles দিয়ে নিজের ফাইলের লিংক দেখা যাবে।

গুরুত্বপূর্ণ: তিনটি চ্যানেলে কপি সম্পন্ন না হলে বট success link দেবে না। কোনো ধাপে ব্যর্থ হলে আংশিক কপি হয়ে থাকতে পারে; সেক্ষেত্রে সংশ্লিষ্ট চ্যানেল পরীক্ষা করে ম্যানুয়ালি পরিষ্কার করতে হতে পারে। Bot নিজে থেকে ফাইল মুছে না। Telegram-এর channel owner/admin বা Telegram-এর নীতি/সীমাবদ্ধতা থেকে স্থায়ী সংরক্ষণের নিশ্চয়তা এই সফটওয়্যার দিতে পারে না।

A. ZIP থেকে GitHub-এ ফাইল দিন
-----------------------------
১) ZIP Extract করুন।
২) ভেতরের Somrat_Cloud_Complete_Ready ফোল্ডারের সব ফাইল GitHub repository-এর root-এ আপলোড করুন। অর্থাৎ package.json এবং index.js যেন repository-এর প্রথম স্তরে থাকে।
৩) .env.example-কে GitHub-এ secret মানসহ কপি করবেন না। BOT_TOKEN কখনো GitHub-এ দেবেন না।
৪) GitHub-এ Commit changes করুন।

B. Telegram Bot তৈরি
--------------------
১) Telegram-এ @BotFather খুলুন।
২) /newbot লিখে নির্দেশনা অনুসরণ করুন।
৩) BotFather যে token দেবে সেটি গোপন রাখুন।
৪) Bot-এর username নোট করে রাখুন।

C. তিনটি Private Channel তৈরি
-----------------------------
১) একটি Main Storage Channel এবং দুটি Backup Channel তৈরি করুন।
২) তিনটি চ্যানেল Private রাখুন (আপনি Public করতে চাইলে নিজ দায়িত্বে সেট করুন)।
৩) Bot-কে তিনটি চ্যানেলেই Admin করুন।
৪) তিনটি চ্যানেলেই Post Messages/Send Messages permission দিন।
৫) Channel ID বের করতে Telegram-এর নির্ভরযোগ্য ID bot/tool ব্যবহার করুন অথবা আপনার পরিচিত পদ্ধতিতে -100 দিয়ে শুরু হওয়া numeric ID সংগ্রহ করুন। Bot-কে চ্যানেলে Admin না করলে copy ব্যর্থ হবে।

D. Render-এ Deploy
------------------
১) Render Dashboard > New > Web Service খুলুন।
২) GitHub repository connect করুন।
৩) Runtime Docker নির্বাচন করুন (এই repository-তে Dockerfile আছে)।
৪) Deploy করুন।
৫) Render-এর Environment > Environment Variables-এ নিচের মানগুলো দিন:

BOT_TOKEN                  = BotFather-এর token
BOT_USERNAME               = @ ছাড়া bot username
SITE_URL                   = https://আপনার-render-service.onrender.com
CHANNEL_ID                 = Main Storage Channel ID
FILE_BACKUP_CHAT_ID        = Backup Channel 1 ID
FILE_BACKUP_2_CHAT_ID      = Backup Channel 2 ID
BACKUP_CHAT_ID             = Database backup channel ID (ঐচ্ছিক; আলাদা private channel ভালো)
MAX_UPLOAD_MB              = 20
ADMIN_TELEGRAM_ID          = আপনার Telegram numeric user ID (/stats-এর জন্য)

৬) SITE_URL-এ আপনার Render-এর আসল URL বসাবেন; localhost নয়।
৭) Environment Variables Save করে Manual Deploy > Deploy latest commit দিন।
৮) Render Logs-এ server ও bot চালুর বার্তা দেখুন।

E. পরীক্ষা
----------
১) Telegram-এ নিজের Bot খুলে /start দিন।
২) ছোট একটি JPG পাঠান।
৩) Main + Backup 1 + Backup 2—তিনটি চ্যানেলেই ফাইল কপি হয়েছে কি না দেখুন।
৪) Bot যে লিংক পাঠাবে সেটি অন্য ফোন/ব্রাউজারে খুলে দেখুন।
৫) ছোট MP4 এবং PDF দিয়েও পরীক্ষা করুন।
৬) /myfiles দিয়ে ফাইলের তালিকা দেখুন।

Bot commands:
/start বা /help — নির্দেশনা
/myfiles — নিজের ফাইলের তালিকা
/stats — ADMIN_TELEGRAM_ID সেট করা থাকলে পরিসংখ্যান

Environment variable-এর নাম হুবহু লিখবেন। Channel ID ভুল হলে বা Bot Admin না হলে কপি হবে না। BOT_TOKEN কাউকে পাঠাবেন না এবং GitHub-এ commit করবেন না।

সীমাবদ্ধতা ও ডাটা সুরক্ষা
-------------------------
- Hosted Telegram Bot API-তে getFile দিয়ে ডাউনলোডের সীমা ২০ MB। এই প্রকল্পে MAX_UPLOAD_MB ডিফল্ট ২০ MB রাখা হয়েছে যাতে Render share link দিয়ে ফাইল পড়া/stream করা যায়। বড় ফাইল তিন চ্যানেলে কপি হলেও এই লিংক দিয়ে stream/download নাও হতে পারে। MAX_UPLOAD_MB বাড়ালেই Telegram-এর getFile সীমা উঠে যায় না।
- ভিডিও/অডিও playback browser ও codec-এর ওপর নির্ভর করে।
- Render-এর ephemeral filesystem-এ SQLite DB deploy/restart-এ হারাতে পারে। BACKUP_CHAT_ID-তে database backup সক্রিয় রাখুন এবং সম্ভব হলে Render Persistent Disk ব্যবহার করুন।
- BACKUP_CHAT_ID হলো database backup channel; FILE_BACKUP_CHAT_ID এবং FILE_BACKUP_2_CHAT_ID হলো আসল ফাইলের দুটি backup channel।
- Bot কোনো চ্যানেলের পুরোনো ফাইল মুছে না। তবে Telegram-এর নিজস্ব সীমা/নীতি ও channel admin-এর কাজের ওপর স্থায়ী সংরক্ষণ নির্ভর করে।
- Production-এ ব্যবহারের আগে ছোট ফাইল দিয়ে তিন চ্যানেল, share link, restart ও database restore পরীক্ষা করুন।
