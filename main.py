import os
import re
import asyncio
import logging
from pathlib import Path
from aiohttp import web
from telegram import Update, InputFile
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from telegram.constants import ChatAction
import yt_dlp

# ==================== CONFIG ====================
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
PORT = int(os.getenv("PORT", 10000))
DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/tmp/downloads"))
MAX_FILE_SIZE = 49 * 1024 * 1024  # \~49MB safe limit for Bot API
# =================================================

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(
    r'https?://(?:www\.)?(?:youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|vimeo\.com|reddit\.com|[\w\-]+\.[\w\-]+)/[^\s<>"\']+',
    re.IGNORECASE
)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🎬 <b>ভিডিও ডাউনলোডার বট</b>\n\n"
        "যেকোনো ভিডিওর লিংক পাঠাও (YouTube, Instagram, TikTok, Facebook, X ইত্যাদি)।\n"
        "আমি ভিডিও ডাউনলোড করে <b>Telegram-এর আসল ভিডিও ফাইল</b> হিসেবে পাঠাবো।\n\n"
        "শুধু লিংক পাঠালেই হবে।",
        parse_mode="HTML"
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📌 <b>কিভাবে ব্যবহার করবে:</b>\n"
        "১. যেকোনো সাপোর্টেড সাইটের ভিডিও লিংক পাঠাও\n"
        "২. বট ডাউনলোড করে Telegram ভিডিও হিসেবে পাঠাবে\n"
        "৩. প্লে, ফরওয়ার্ড, শেয়ার সব করা যাবে\n\n"
        "সাপোর্টেড: YouTube, Instagram, TikTok, Facebook, X/Twitter, Vimeo এবং আরও অনেক।",
        parse_mode="HTML"
    )


def download_video(url: str) -> tuple[str | None, str | None]:
    """ভিডিও ডাউনলোড করে লোকাল পাথ রিটার্ন করে"""
    ydl_opts = {
        'format': 'best[ext=mp4][filesize<45M]/bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[height<=720]/best',
        'outtmpl': str(DOWNLOAD_DIR / '%(title).70s.%(ext)s'),
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'merge_output_format': 'mp4',
        'retries': 5,
        'fragment_retries': 5,
        'socket_timeout': 30,
        # TikTok / anti-bot fixes
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        },
        'extractor_args': {
            'tiktok': {
                'api_hostname': 'api16-normal-c-useast1a.tiktokv.com',
            }
        },
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)

            if not os.path.exists(filename):
                base = os.path.splitext(filename)[0]
                for ext in ['.mp4', '.mkv', '.webm', '.mov']:
                    if os.path.exists(base + ext):
                        filename = base + ext
                        break

            if os.path.exists(filename):
                title = (info.get('title') or 'video')[:90]
                return filename, title
            return None, "ফাইল পাওয়া যায়নি"
    except Exception as e:
        logger.error(f"Download error: {e}")
        return None, str(e)[:180]


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    if not message:
        return

    text = message.text or message.caption or ""
    urls = URL_PATTERN.findall(text)

    if not urls:
        if text.strip().startswith("http"):
            urls = [text.strip()]
        else:
            await message.reply_text("❌ কোনো ভ্যালিড ভিডিও লিংক পাইনি। শুধু লিংক পাঠাও।")
            return

    url = urls[0]
    status_msg = await message.reply_text("⏳ লিংক পাওয়া গেছে... ডাউনলোড শুরু করছি...")

    filepath = None
    try:
        await context.bot.send_chat_action(chat_id=message.chat_id, action=ChatAction.UPLOAD_VIDEO)

        loop = asyncio.get_event_loop()
        filepath, title_or_error = await loop.run_in_executor(None, download_video, url)

        if not filepath or not os.path.exists(filepath):
            await status_msg.edit_text(f"❌ ডাউনলোড ব্যর্থ হয়েছে।\nকারণ: {title_or_error or 'অজানা সমস্যা'}")
            return

        file_size = os.path.getsize(filepath)
        if file_size > MAX_FILE_SIZE:
            await status_msg.edit_text(
                f"❌ ভিডিওটা খুব বড় ({file_size / 1024 / 1024:.1f} MB)।\n"
                f"Bot API-তে সর্বোচ্চ \~50MB আপলোড করা যায়।"
            )
            return

        await status_msg.edit_text("📤 Telegram-এ আপলোড করছি...")

        with open(filepath, 'rb') as video_file:
            await message.reply_video(
                video=InputFile(video_file, filename=os.path.basename(filepath)),
                caption=f"✅ {title_or_error}" if title_or_error else None,
                supports_streaming=True,
                read_timeout=180,
                write_timeout=180,
                connect_timeout=60,
            )

        await status_msg.delete()

    except Exception as e:
        logger.exception("Error handling url")
        try:
            await status_msg.edit_text(f"❌ সমস্যা হয়েছে: {str(e)[:200]}")
        except Exception:
            pass
    finally:
        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception:
                pass


# ---------- Health check for Render ----------
async def health(request):
    return web.Response(text="OK")


async def start_web_server():
    app = web.Application()
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", PORT)
    await site.start()
    logger.info(f"Health server running on port {PORT}")


def main():
    if not BOT_TOKEN:
        print("❌ BOT_TOKEN সেট করা নেই! Render Environment Variables-এ BOT_TOKEN দাও।")
        return

    application = Application.builder().token(BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(MessageHandler(filters.TEXT & \~filters.COMMAND, handle_url))

    # Health server + Bot একসাথে চালানো
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def run_all():
        await start_web_server()
        await application.initialize()
        await application.start()
        await application.updater.start_polling(allowed_updates=Update.ALL_TYPES)
        logger.info("🚀 বট চালু হয়েছে...")
        # চালু রাখা
        while True:
            await asyncio.sleep(3600)

    try:
        loop.run_until_complete(run_all())
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(application.stop())
        loop.close()


if __name__ == "__main__":
    main()
