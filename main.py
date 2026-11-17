
import os
import re
import asyncio
import logging
from pathlib import Path

from aiohttp import web
from telegram import Update, InputFile
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
)
from telegram.constants import ChatAction
from telegram.error import TelegramError
import yt_dlp

# ================= CONFIG =================

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
PORT = int(os.getenv("PORT", 10000))

DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/tmp/downloads"))

# Maximum file size: 2 GB (decimal)
MAX_FILE_SIZE = 2_000_000_000

# Optional: Self-hosted Telegram Local Bot API
LOCAL_BOT_API_URL = os.getenv("LOCAL_BOT_API_URL", "").rstrip("/")

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ==========================================

logging.basicConfig(
    format="%(asctime)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(
    r'https?://[^\s<>"\']+',
    re.IGNORECASE
)


def download_video(url: str):
    """Download video using yt-dlp."""

    ydl_opts = {
        "format": "bestvideo*+bestaudio/best",
        "outtmpl": str(
            DOWNLOAD_DIR / "%(title).100s.%(ext)s"
        ),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "merge_output_format": "mp4",
        "retries": 5,
        "fragment_retries": 5,
        "socket_timeout": 60,
        "max_filesize": MAX_FILE_SIZE,
        "overwrites": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:

            info = ydl.extract_info(
                url,
                download=True
            )

            filename = ydl.prepare_filename(info)

            if not os.path.exists(filename):

                base = os.path.splitext(filename)[0]

                for ext in [
                    ".mp4",
                    ".mkv",
                    ".webm",
                    ".mov",
                    ".m4v",
                ]:
                    candidate = base + ext

                    if os.path.exists(candidate):
                        filename = candidate
                        break

            if not os.path.exists(filename):
                return None, "ভিডিও ফাইল পাওয়া যায়নি"

            size = os.path.getsize(filename)

            if size > MAX_FILE_SIZE:
                os.remove(filename)
                return None, "ভিডিও 2GB সীমা অতিক্রম করেছে"

            title = info.get("title", "Video")

            return filename, title[:150]

    except Exception as e:
        logger.exception("Download failed")
        return None, str(e)[:300]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):

    await update.message.reply_text(
        "🎬 VIDEO DOWNLOADER BOT\n\n"
        "যেকোনো সমর্থিত ভিডিও লিংক পাঠাও।\n\n"
        "Supported platforms:\n"
        "• YouTube\n"
        "• Facebook\n"
        "• Instagram\n"
        "• TikTok\n"
        "• Twitter / X\n"
        "• Vimeo\n"
        "• Reddit\n"
        "• Other yt-dlp supported sites\n\n"
        "Maximum download size: 2GB\n\n"
        "শুধু ভিডিও লিংক পাঠাও।"
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):

    await update.message.reply_text(
        "📌 HOW TO USE\n\n"
        "1. ভিডিওর লিংক কপি করো।\n"
        "2. এখানে পাঠাও।\n"
        "3. বট ভিডিও ডাউনলোড করবে।\n"
        "4. আপলোড সীমার মধ্যে থাকলে Telegram-এ পাঠাবে।\n\n"
        "Maximum configured size: 2GB"
    )


async def handle_url(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    message = update.message

    if not message:
        return

    text = message.text or message.caption or ""

    urls = URL_PATTERN.findall(text)

    if not urls:
        await message.reply_text(
            "❌ সঠিক ভিডিও লিংক পাঠাও।"
        )
        return

    url = urls[0].rstrip(".,)")

    status = await message.reply_text(
        "⏳ ভিডিও লিংক পাওয়া গেছে।\n"
        "ডাউনলোড শুরু হচ্ছে..."
    )

    filepath = None

    try:

        await context.bot.send_chat_action(
            chat_id=message.chat_id,
            action=ChatAction.UPLOAD_VIDEO,
        )

        loop = asyncio.get_running_loop()

        filepath, title = await loop.run_in_executor(
            None,
            download_video,
            url,
        )

        if not filepath or not os.path.exists(filepath):

            await status.edit_text(
                f"❌ ডাউনলোড ব্যর্থ!\n\n{title}"
            )
            return

        file_size = os.path.getsize(filepath)

        if file_size > MAX_FILE_SIZE:

            await status.edit_text(
                "❌ ভিডিও 2GB সীমা অতিক্রম করেছে।"
            )
            return

        size_mb = file_size / (1024 * 1024)

        await status.edit_text(
            f"📤 Telegram-এ আপলোড হচ্ছে...\n\n"
            f"🎬 {title}\n"
            f"📦 Size: {size_mb:.2f} MB"
        )

        with open(filepath, "rb") as video:

            await message.reply_video(
                video=InputFile(
                    video,
                    filename=os.path.basename(filepath),
                ),
                caption=f"✅ {title}",
                supports_streaming=True,
                read_timeout=3600,
                write_timeout=3600,
                connect_timeout=120,
                pool_timeout=120,
            )

        await status.delete()

    except TelegramError as e:

        logger.exception("Telegram upload failed")

        try:
            await status.edit_text(
                "❌ Telegram আপলোড ব্যর্থ হয়েছে।\n\n"
                f"কারণ: {str(e)[:400]}\n\n"
                "Telegram Bot API-এর আপলোড সীমা "
                "অথবা Local Bot API Server পরীক্ষা করো।"
            )
        except Exception:
            pass

    except Exception as e:

        logger.exception("Processing error")

        try:
            await status.edit_text(
                f"❌ সমস্যা হয়েছে:\n{str(e)[:300]}"
            )
        except Exception:
            pass

    finally:

        if filepath and os.path.exists(filepath):

            try:
                os.remove(filepath)
            except Exception:
                logger.warning("Could not delete temporary file")


# ================ HEALTH SERVER ================

async def health(request):

    return web.Response(text="OK")


async def start_web_server():

    app = web.Application()

    app.router.add_get("/", health)
    app.router.add_get("/health", health)

    runner = web.AppRunner(app)

    await runner.setup()

    site = web.TCPSite(
        runner,
        "0.0.0.0",
        PORT,
    )

    await site.start()

    logger.info("Health server started")


# ================ MAIN BOT ================

def main():

    if not BOT_TOKEN:

        print("BOT_TOKEN missing!")
        return

    builder = Application.builder().token(BOT_TOKEN)

    # Configure self-hosted Local Bot API if provided
    if LOCAL_BOT_API_URL:

        builder = (
            builder
            .base_url(LOCAL_BOT_API_URL + "/bot")
            .base_file_url(LOCAL_BOT_API_URL + "/file/bot")
            .local_mode(True)
        )

    application = builder.build()

    application.add_handler(
        CommandHandler("start", start)
    )

    application.add_handler(
        CommandHandler("help", help_command)
    )

    application.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            handle_url,
        )
    )

    loop = asyncio.new_event_loop()

    asyncio.set_event_loop(loop)

    async def run_all():

        await start_web_server()

        await application.initialize()

        await application.start()

        await application.updater.start_polling(
            allowed_updates=Update.ALL_TYPES
        )

        logger.info("VIDEO DOWNLOADER BOT STARTED")

        while True:
            await asyncio.sleep(3600)

    try:

        loop.run_until_complete(run_all())

    except KeyboardInterrupt:
        pass

    finally:

        async def shutdown():

            if application.updater.running:
                await application.updater.stop()

            if application.running:
                await application.stop()

            await application.shutdown()

        loop.run_until_complete(shutdown())
        loop.close()


if __name__ == "__main__":
    main()
