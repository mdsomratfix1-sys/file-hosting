SOMRAT CLOUD — COMPLETE READY PACKAGE
====================================

এই ফোল্ডারে Render backend-এর সম্পূর্ণ কোড এবং Blogger-এর Theme XML আছে।

গুরুত্বপূর্ণ: পুরোনো GitHub কোড Replace করবেন, কিন্তু Render-এর Environment Variables বা Persistent Disk/Database মুছবেন না। Telegram Bot Token/Channel ID কখনো GitHub-এ লিখবেন না।

A) GITHUB-এ পুরোনো কোড Replace
-----------------------------
1. ZIP Extract করুন।
2. Extract করা Somrat_Cloud_Complete_Ready ফোল্ডার খুলুন।
3. এই ফোল্ডারের ভেতরের সব ফাইল ও ফোল্ডার (index.js, package.json, package-lock.json, Dockerfile, src, public, render.yaml ইত্যাদি) GitHub Repository-এর ROOT-এ আপলোড করুন।
   অর্থাৎ GitHub root-এ সরাসরি Dockerfile এবং index.js দেখা যাবে; Somrat_Cloud_Complete_Ready নামে আরেকটি nested folder-এর ভিতরে রাখবেন না।
4. GitHub-এ আগের application source files replace/delete করে নতুনগুলো commit করুন।
5. GitHub-এ README_BN.txt এবং BLOGGER_THEME_UPLOAD.xml রাখতে পারেন; এগুলো backend চালাতে বাধা দেবে না।
6. Render-এ Root Directory ফাঁকা/root রাখুন, Runtime Docker থাকুক। Manual Deploy → Deploy latest commit দিন।

B) RENDER ENVIRONMENT VARIABLES
--------------------------------
আগের Environment Variables অক্ষত রাখুন। অন্তত এগুলো সঠিক থাকতে হবে:
BOT_TOKEN       = আপনার Telegram bot token
CHANNEL_ID      = Telegram-এর private storage channel ID
FRONTEND_ORIGINS= https://somratownloader.blogspot.com
SITE_URL        = https://file-hosting-1oe4.onrender.com
MAX_UPLOAD_MB   = 20

BACKUP_CHAT_ID, BOT_USERNAME, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_TELEGRAM_ID থাকলে আগের মতো রাখুন। কোনো secret GitHub-এ দেবেন না।

C) BLOGGER THEME INSTALL
------------------------
1. Blogger Dashboard → Theme → Backup (আগের theme backup রাখুন)।
2. Theme → Restore/Upload থেকে BLOGGER_THEME_UPLOAD.xml নির্বাচন করুন।
3. Blog খুলে সর্বোচ্চ ২টি ছবি দিয়ে পরীক্ষা করুন।

D) কী কাজ করার কথা
------------------
- Login/registration ছাড়া public guest image upload.
- একবারে সর্বোচ্চ ২টি image.
- Telegram storage channel-এ ফাইল পাঠানো.
- আপলোডের পর share URL, Copy Link এবং Open Image.

E) DATA ও SAFETY
----------------
- Render Environment Variables, Persistent Disk এবং database data মুছবেন না।
- Render free service-এর local filesystem persistent নাও হতে পারে; ডাটাবেস স্থায়ী রাখতে Render Persistent Disk configure থাকতে হবে।
- Telegram Bot-কে storage channel-এ admin permission দিন।
- Public endpoint-এ rate limit আছে; তবু abuse/spam monitor করুন।
- বাস্তব আপলোড পরীক্ষা না করা পর্যন্ত production-ready ধরে নেবেন না।

এই প্যাকেজে Backend API-তে POST /api/public/upload route আছে; এটি image-only এবং max 2 files গ্রহণ করে।
