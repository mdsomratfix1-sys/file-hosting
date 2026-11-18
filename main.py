import os
import re
import json
import html
import logging
import asyncio
import random
import sqlite3
from datetime import datetime, timezone
from urllib.parse import quote_plus

import httpx
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup,
    InputMediaPhoto
)
from telegram.constants import ParseMode
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters
)

# ============================================================
# SOMRAT MOVIE BOT
# Python 3.10+ | python-telegram-bot 21.x | SQLite (no MySQL)
# Configure BOT_TOKEN, TMDB_API_KEY and ADMIN_IDS as env vars.
# ============================================================

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "").strip()
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x.isdigit()}
DB_PATH = os.getenv("DB_PATH", "somrat_movie_bot.db")
TMDB_BASE = "https://api.themoviedb.org/3"
IMG_BASE = "https://image.tmdb.org/t/p/"
LANGUAGE = os.getenv("TMDB_LANGUAGE", "en-US")
PAGE_SIZE = 10
logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO
)
log = logging.getLogger("somrat-movie-bot")

# ---------- Database ----------
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
            joined_at TEXT, blocked INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS favorites(
            user_id INTEGER, media_type TEXT, media_id INTEGER,
            title TEXT, poster TEXT, PRIMARY KEY(user_id, media_type, media_id)
        );
        CREATE TABLE IF NOT EXISTS watchlist(
            user_id INTEGER, media_type TEXT, media_id INTEGER,
            title TEXT, poster TEXT, PRIMARY KEY(user_id, media_type, media_id)
        );
        CREATE TABLE IF NOT EXISTS history(
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            query TEXT, searched_at TEXT
        );
        CREATE TABLE IF NOT EXISTS alerts(
            user_id INTEGER, media_type TEXT, media_id INTEGER,
            title TEXT, release_date TEXT, sent INTEGER DEFAULT 0,
            PRIMARY KEY(user_id, media_type, media_id)
        );
        CREATE TABLE IF NOT EXISTS searches(
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            query TEXT, searched_at TEXT
        );
        """)
        con.commit()

def touch_user(user):
    with db() as con:
        con.execute("""INSERT INTO users(user_id,username,first_name,joined_at)
        VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        username=excluded.username, first_name=excluded.first_name""",
        (user.id, user.username or "", user.first_name or "", datetime.now(timezone.utc).isoformat()))
        con.commit()

def is_blocked(uid):
    with db() as con:
        row = con.execute("SELECT blocked FROM users WHERE user_id=?", (uid,)).fetchone()
        return bool(row and row["blocked"])

def is_admin(uid):
    return uid in ADMIN_IDS

# ---------- TMDB helpers ----------
async def tmdb(path, params=None):
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY সেট করা হয়নি।")
    p = dict(params or {})
    p["api_key"] = TMDB_API_KEY
    p.setdefault("language", LANGUAGE)
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(f"{TMDB_BASE}{path}", params=p)
        response.raise_for_status()
        return response.json()

def title_of(item, media_type="movie"):
    return item.get("title") or item.get("name") or item.get("original_title") or item.get("original_name") or "Unknown"

def year_of(item):
    date = item.get("release_date") or item.get("first_air_date") or ""
    return date[:4] if date else "N/A"

def poster_url(path, size="w500"):
    return f"{IMG_BASE}{size}{path}" if path else None

def stars(value):
    try:
        return f"{float(value):.1f}/10"
    except (ValueError, TypeError):
        return "N/A"

def media_label(kind):
    return {"movie":"🎬 Movie", "tv":"📺 TV Series", "person":"👤 Person"}.get(kind, kind)

async def search_multi(query):
    data = await tmdb("/search/multi", {"query": query, "include_adult": "false", "page": 1})
    results = []
    for item in data.get("results", []):
        kind = item.get("media_type")
        if kind in ("movie", "tv", "person"):
            results.append((kind, item))
        if len(results) >= PAGE_SIZE:
            break
    return results

async def get_details(kind, mid):
    append = "credits,videos,images,recommendations,similar,external_ids"
    return await tmdb(f"/{kind}/{mid}", {"append_to_response": append, "include_image_language": "en,null"})

def movie_card_text(kind, item):
    if kind == "person":
        return f"👤 <b>{html.escape(title_of(item, kind))}</b>\nKnown for: {html.escape(item.get('known_for_department') or 'N/A')}"
    return (f"{'🎬' if kind == 'movie' else '📺'} <b>{html.escape(title_of(item, kind))}</b>\n"
            f"📅 {year_of(item)}  •  ⭐ {stars(item.get('vote_average'))}\n"
            f"🗂 {media_label(kind)}")

def search_keyboard(results, page=0):
    rows = []
    for i, (kind, item) in enumerate(results):
        label = f"{title_of(item, kind)[:38]} ({year_of(item)})" if kind != "person" else f"{title_of(item, kind)[:42]} • Person"
        rows.append([InlineKeyboardButton(label, callback_data=f"pick:{kind}:{item['id']}")])
    rows.append([InlineKeyboardButton("❌ Close", callback_data="close")])
    return InlineKeyboardMarkup(rows)

async def send_search_results(update, context, query):
    uid = update.effective_user.id
    with db() as con:
        now = datetime.now(timezone.utc).isoformat()
        con.execute("INSERT INTO history(user_id,query,searched_at) VALUES(?,?,?)", (uid, query, now))
        con.execute("INSERT INTO searches(user_id,query,searched_at) VALUES(?,?,?)", (uid, query, now))
        con.commit()
    results = await search_multi(query)
    if not results:
        await update.effective_message.reply_text("😕 কোনো ফলাফল পাওয়া যায়নি। অন্য বানানে চেষ্টা করুন।")
        return
    # Individual poster + details; buttons provide the full selection list.
    intro = f"🔎 <b>Search Results:</b> {html.escape(query)}\nFound {len(results)} result(s). নিচে পছন্দেরটি নির্বাচন করুন:"
    await update.effective_message.reply_text(intro, parse_mode=ParseMode.HTML, reply_markup=search_keyboard(results))
    for kind, item in results:
        caption = movie_card_text(kind, item)
        photo = poster_url(item.get("profile_path") if kind == "person" else item.get("poster_path"))
        if photo:
            try:
                await update.effective_message.reply_photo(photo=photo, caption=caption, parse_mode=ParseMode.HTML,
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("বিস্তারিত দেখুন", callback_data=f"pick:{kind}:{item['id']}")]]))
                continue
            except Exception as e:
                log.warning("Poster send failed: %s", e)
        await update.effective_message.reply_text(caption, parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("বিস্তারিত দেখুন", callback_data=f"pick:{kind}:{item['id']}")]]))

def details_keyboard(kind, mid, item):
    rows = [
        [InlineKeyboardButton("▶ Watch Trailer", callback_data=f"trailer:{kind}:{mid}"),
         InlineKeyboardButton("🖼 Gallery", callback_data=f"gallery:{kind}:{mid}")],
        [InlineKeyboardButton("❤️ Favorite", callback_data=f"fav:{kind}:{mid}"),
         InlineKeyboardButton("📌 Watchlist", callback_data=f"list:{kind}:{mid}")],
        [InlineKeyboardButton("🎯 Similar", callback_data=f"similar:{kind}:{mid}"),
         InlineKeyboardButton("📤 Share", callback_data=f"share:{kind}:{mid}")],
    ]
    if kind in ("movie", "tv"):
        rows.append([InlineKeyboardButton("🔔 Alert me", callback_data=f"alert:{kind}:{mid}")])
    return InlineKeyboardMarkup(rows)

def detail_caption(kind, d):
    if kind == "person":
        bio = (d.get("biography") or "Biography not available.")[:1800]
        known = d.get("known_for_department") or "N/A"
        birthday = d.get("birthday") or "N/A"
        place = d.get("place_of_birth") or "N/A"
        return (f"👤 <b>{html.escape(title_of(d, kind))}</b>\n"
                f"Department: {html.escape(known)}\nBirthday: {birthday}\nBirthplace: {html.escape(place)}\n\n"
                f"<b>Biography</b>\n{html.escape(bio)}")
    genres = ", ".join(x["name"] for x in d.get("genres", [])) or "N/A"
    date = d.get("release_date") or d.get("first_air_date") or "N/A"
    runtime = d.get("runtime")
    if not runtime and d.get("episode_run_time"):
        runtime = d["episode_run_time"][0]
    runtime_text = f"{runtime} min" if runtime else "N/A"
    overview = d.get("overview") or "Overview not available."
    companies = ", ".join(x["name"] for x in d.get("production_companies", [])[:5]) or "N/A"
    countries = ", ".join(x["name"] for x in d.get("production_countries", [])[:5]) or "N/A"
    budget = f"${d.get('budget'):,}" if d.get("budget") else "N/A"
    revenue = f"${d.get('revenue'):,}" if d.get("revenue") else "N/A"
    lang = d.get("original_language", "N/A").upper()
    cast = d.get("credits", {}).get("cast", [])[:8]
    crew = d.get("credits", {}).get("crew", [])
    directors = [x["name"] for x in crew if x.get("job") == "Director"][:3]
    cast_text = ", ".join(x["name"] for x in cast) or "N/A"
    director_text = ", ".join(directors) or "N/A"
    return (f"{'🎬' if kind == 'movie' else '📺'} <b>{html.escape(title_of(d, kind))}</b>\n"
            f"⭐ Rating: {stars(d.get('vote_average'))} ({d.get('vote_count',0)} votes)\n"
            f"📅 Release: {date}\n🌐 Language: {lang}\n⏱ Runtime: {runtime_text}\n"
            f"🎭 Genres: {html.escape(genres)}\n💰 Budget: {budget}\n💵 Revenue: {revenue}\n"
            f"🌍 Countries: {html.escape(countries)}\n🏢 Companies: {html.escape(companies)}\n"
            f"🎬 Director: {html.escape(director_text)}\n⭐ Cast: {html.escape(cast_text)}\n\n"
            f"<b>📖 Overview</b>\n{html.escape(overview[:2200])}\n\n"
            f"🆔 TMDB ID: <code>{d.get('id')}</code>")

async def send_details(query, context, kind, mid):
    d = await get_details(kind, mid)
    caption = detail_caption(kind, d)
    photo_path = d.get("profile_path") if kind == "person" else d.get("poster_path")
    photo = poster_url(photo_path, "w780")
    markup = details_keyboard(kind, mid, d)
    if photo:
        await query.message.reply_photo(photo=photo, caption=caption, parse_mode=ParseMode.HTML, reply_markup=markup)
    else:
        await query.message.reply_text(caption, parse_mode=ParseMode.HTML, reply_markup=markup)
    if kind in ("movie", "tv") and d.get("backdrop_path"):
        await query.message.reply_photo(photo=poster_url(d["backdrop_path"], "w1280"), caption="🖼 Backdrop")

# ---------- User commands ----------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    touch_user(update.effective_user)
    if is_blocked(update.effective_user.id):
        return await update.message.reply_text("আপনার অ্যাকাউন্টটি বট থেকে ব্লক করা হয়েছে।")
    text = (
        "👋 <b>স্বাগতম SOMRAT MOVIE BOT-এ!</b>\n\n"
        "🎬 মুভি, টিভি সিরিজ, অভিনেতা ও পরিচালকের তথ্য খুঁজুন এক জায়গায়।\n\n"
        "🔎 শুধু নাম লিখে পাঠান। আমি TMDB থেকে সর্বোচ্চ ১০টি ফলাফল দেখাব।\n\n"
        "✨ <b>ফিচার:</b> Movie Search • TV Search • Person Search • Posters • Trailer • Cast & Crew • Watchlist • Favorites • Trending • Quiz\n\n"
        "📌 শুরু করতে যেকোনো মুভি বা মানুষের নাম লিখুন।\n\n"
        "কমান্ড: /search /trending /toprated /upcoming /nowplaying /watchlist /favorites /help\n\n"
        "<i>Powered by TMDB • SOMRAT</i>"
    )
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🔎 Search", callback_data="prompt_search"),
         InlineKeyboardButton("🔥 Trending", callback_data="discover:trending")],
        [InlineKeyboardButton("⭐ Top Rated", callback_data="discover:top"),
         InlineKeyboardButton("🆕 Upcoming", callback_data="discover:upcoming")],
        [InlineKeyboardButton("🧠 Movie Quiz", callback_data="quiz:start"),
         InlineKeyboardButton("⚖ Compare Movies", callback_data="compare:start")]
    ])
    await update.message.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=keyboard)

async def help_cmd(update, context):
    await update.message.reply_text(
        "/search - সার্চ\n/trending - ট্রেন্ডিং\n/toprated - সেরা রেটিং\n"
        "/upcoming - আসন্ন মুভি\n/nowplaying - বর্তমানে হলে\n/favorites - পছন্দের তালিকা\n"
        "/watchlist - পরে দেখবেন\n/history - সার্চ ইতিহাস\n/compare - দুটি মুভি তুলনা\n"
        "/quiz - মুভি কুইজ\n/alerts - আপনার রিলিজ অ্যালার্ট\n\n"
        "যেকোনো নাম সরাসরি লিখলেও সার্চ হবে।"
    )

async def search_cmd(update, context):
    q = " ".join(context.args).strip()
    if not q:
        context.user_data["awaiting"] = "search"
        return await update.message.reply_text("🔎 যে মুভি, সিরিজ বা ব্যক্তির নাম খুঁজছেন লিখুন:")
    await safe_search(update, context, q)

async def safe_search(update, context, q):
    try:
        await send_search_results(update, context, q)
    except Exception as e:
        log.exception("Search error")
        await update.effective_message.reply_text(f"⚠️ সার্চ করা যায়নি: {html.escape(str(e)[:300])}")

async def text_handler(update, context):
    touch_user(update.effective_user)
    if is_blocked(update.effective_user.id):
        return
    text = (update.message.text or "").strip()
    mode = context.user_data.pop("awaiting", None)
    if mode == "compare_first":
        context.user_data["compare_first"] = text
        context.user_data["awaiting"] = "compare_second"
        return await update.message.reply_text("এবার দ্বিতীয় মুভির নাম লিখুন:")
    if mode == "compare_second":
        first = context.user_data.pop("compare_first", "")
        context.user_data["awaiting"] = None
        return await compare_names(update, context, first, text)
    if mode == "search" or text:
        await safe_search(update, context, text)

async def callback_handler(update, context):
    q = update.callback_query
    await q.answer()
    data = q.data or ""
    uid = q.from_user.id
    if data == "close":
        return await q.edit_message_reply_markup(reply_markup=None)
    if data == "prompt_search":
        context.user_data["awaiting"] = "search"
        return await q.message.reply_text("🔎 মুভি, সিরিজ বা ব্যক্তির নাম লিখুন:")
    if data.startswith("pick:"):
        _, kind, mid = data.split(":")
        try:
            await send_details(q, context, kind, int(mid))
        except Exception as e:
            log.exception("Details error")
            await q.message.reply_text(f"তথ্য আনা যায়নি: {html.escape(str(e)[:250])}")
    elif data.startswith(("fav:", "list:")):
        action, kind, mid = data.split(":")
        try:
            d = await tmdb(f"/{kind}/{mid}")
            table = "favorites" if action == "fav" else "watchlist"
            with db() as con:
                con.execute(f"INSERT OR IGNORE INTO {table}(user_id,media_type,media_id,title,poster) VALUES(?,?,?,?,?)",
                    (uid, kind, int(mid), title_of(d, kind), d.get("poster_path") or ""))
                con.commit()
            await q.message.reply_text("❤️ Favorites-এ যোগ হয়েছে!" if action == "fav" else "📌 Watchlist-এ যোগ হয়েছে!")
        except Exception as e:
            await q.message.reply_text(f"সমস্যা হয়েছে: {html.escape(str(e)[:200])}")
    elif data.startswith("trailer:"):
        _, kind, mid = data.split(":")
        try:
            d = await tmdb(f"/{kind}/{mid}/videos")
            vids = d.get("results", [])
            chosen = next((v for v in vids if v.get("site") == "YouTube" and v.get("type") == "Trailer" and v.get("official")), None)
            chosen = chosen or next((v for v in vids if v.get("site") == "YouTube" and v.get("type") in ("Trailer","Teaser")), None)
            if chosen:
                url = f"https://www.youtube.com/watch?v={chosen['key']}"
                await q.message.reply_text(f"▶ <a href=\"{url}\">Watch Official Trailer</a>", parse_mode=ParseMode.HTML)
            else:
                d2 = await tmdb(f"/{kind}/{mid}")
                title = title_of(d2, kind)
                url = "https://www.youtube.com/results?search_query=" + quote_plus(title + " official trailer")
                await q.message.reply_text(f"ট্রেলার TMDB-তে পাওয়া যায়নি। <a href=\"{url}\">YouTube-এ খুঁজুন</a>", parse_mode=ParseMode.HTML)
        except Exception as e:
            await q.message.reply_text(f"Trailer পাওয়া যায়নি: {html.escape(str(e)[:200])}")
    elif data.startswith("gallery:"):
        _, kind, mid = data.split(":")
        try:
            d = await tmdb(f"/{kind}/{mid}/images", {"include_image_language":"en,null"})
            paths = [x["file_path"] for x in d.get("posters", [])[:5]]
            paths += [x["file_path"] for x in d.get("backdrops", [])[:5]]
            if not paths:
                return await q.message.reply_text("এই শিরোনামের কোনো gallery image পাওয়া যায়নি।")
            media = [InputMediaPhoto(poster_url(p, "w780")) for p in paths[:10]]
            await q.message.reply_media_group(media)
        except Exception as e:
            await q.message.reply_text(f"Gallery error: {html.escape(str(e)[:200])}")
    elif data.startswith("similar:"):
        _, kind, mid = data.split(":")
        try:
            d = await tmdb(f"/{kind}/{mid}/similar")
            await show_list(q.message, d.get("results", [])[:10], kind)
        except Exception as e:
            await q.message.reply_text(f"তথ্য পাওয়া যায়নি: {html.escape(str(e)[:200])}")
    elif data.startswith("share:"):
        _, kind, mid = data.split(":")
        await q.message.reply_text(f"TMDB: https://www.themoviedb.org/{kind}/{mid}\nএই লিংকটি বন্ধুদের পাঠাতে পারেন।")
    elif data.startswith("alert:"):
        _, kind, mid = data.split(":")
        try:
            d = await tmdb(f"/{kind}/{mid}")
            date = d.get("release_date") or d.get("first_air_date") or ""
            with db() as con:
                con.execute("INSERT OR REPLACE INTO alerts(user_id,media_type,media_id,title,release_date,sent) VALUES(?,?,?,?,?,0)",
                    (uid, kind, int(mid), title_of(d, kind), date))
                con.commit()
            await q.message.reply_text("🔔 Release alert সংরক্ষণ করা হয়েছে। বট চালু থাকা অবস্থায় প্রতিদিন চেক হবে।")
        except Exception as e:
            await q.message.reply_text(f"Alert যোগ করা যায়নি: {html.escape(str(e)[:200])}")
    elif data.startswith("discover:"):
        kind = data.split(":")[1]
        endpoints = {"trending":"/trending/movie/day", "top":"/movie/top_rated", "upcoming":"/movie/upcoming", "now":"/movie/now_playing"}
        if kind == "trending":
            endpoint = endpoints["trending"]
        elif kind in endpoints:
            endpoint = endpoints[kind]
        else:
            return
        try:
            result = await tmdb(endpoint)
            await show_list(q.message, result.get("results", [])[:10], "movie")
        except Exception as e:
            await q.message.reply_text(f"তথ্য পাওয়া যায়নি: {html.escape(str(e)[:200])}")
    elif data == "quiz:start":
        await start_quiz(q.message, context)
    elif data == "compare:start":
        context.user_data["awaiting"] = "compare_first"
        await q.message.reply_text("প্রথম মুভির নাম লিখুন:")

async def show_list(message, items, kind):
    if not items:
        return await message.reply_text("কোনো ফলাফল পাওয়া যায়নি।")
    for item in items:
        caption = movie_card_text(kind, item)
        photo = poster_url(item.get("poster_path"))
        markup = InlineKeyboardMarkup([[InlineKeyboardButton("বিস্তারিত", callback_data=f"pick:{kind}:{item['id']}")]])
        if photo:
            try:
                await message.reply_photo(photo, caption=caption, parse_mode=ParseMode.HTML, reply_markup=markup)
                continue
            except Exception:
                pass
        await message.reply_text(caption, parse_mode=ParseMode.HTML, reply_markup=markup)

async def discover_cmd(update, context, endpoint):
    try:
        d = await tmdb(endpoint)
        await show_list(update.message, d.get("results", [])[:10], "movie")
    except Exception as e:
        await update.message.reply_text(f"TMDB error: {html.escape(str(e)[:200])}")

async def trending(update, context): await discover_cmd(update, context, "/trending/movie/day")
async def toprated(update, context): await discover_cmd(update, context, "/movie/top_rated")
async def upcoming(update, context): await discover_cmd(update, context, "/movie/upcoming")
async def nowplaying(update, context): await discover_cmd(update, context, "/movie/now_playing")

# ---------- Saved lists ----------
async def saved_list(update, context, table):
    with db() as con:
        rows = con.execute(f"SELECT * FROM {table} WHERE user_id=? ORDER BY rowid DESC LIMIT 30", (update.effective_user.id,)).fetchall()
    if not rows:
        return await update.message.reply_text("তালিকাটি এখনো খালি।")
    for row in rows:
        await update.message.reply_text(
            f"{'❤️' if table=='favorites' else '📌'} {html.escape(row['title'])}",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("বিস্তারিত", callback_data=f"pick:{row['media_type']}:{row['media_id']}")]])
        )
async def favorites(update, context): await saved_list(update, context, "favorites")
async def watchlist(update, context): await saved_list(update, context, "watchlist")

async def history_cmd(update, context):
    with db() as con:
        rows = con.execute("SELECT query,searched_at FROM history WHERE user_id=? ORDER BY id DESC LIMIT 15", (update.effective_user.id,)).fetchall()
    if not rows:
        return await update.message.reply_text("আপনার সার্চ ইতিহাস খালি।")
    text = "🕘 <b>আপনার সাম্প্রতিক সার্চ</b>\n\n" + "\n".join(f"• {html.escape(r['query'])}" for r in rows)
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)

async def alerts_cmd(update, context):
    with db() as con:
        rows = con.execute("SELECT title,release_date FROM alerts WHERE user_id=? ORDER BY release_date", (update.effective_user.id,)).fetchall()
    if not rows:
        return await update.message.reply_text("আপনার কোনো release alert নেই।")
    await update.message.reply_text("🔔 <b>Your Alerts</b>\n\n" + "\n".join(f"• {html.escape(r['title'])} — {r['release_date'] or 'TBA'}" for r in rows), parse_mode=ParseMode.HTML)

# ---------- Comparison ----------
async def compare_cmd(update, context):
    if len(context.args) >= 2:
        await compare_names(update, context, " ".join(context.args[:1]), " ".join(context.args[1:]))
    else:
        context.user_data["awaiting"] = "compare_first"
        await update.message.reply_text("প্রথম মুভির নাম লিখুন:")

async def compare_names(update, context, first, second):
    try:
        a = await tmdb("/search/movie", {"query": first})
        b = await tmdb("/search/movie", {"query": second})
        if not a.get("results") or not b.get("results"):
            return await update.effective_message.reply_text("দুটি মুভিই খুঁজে পাওয়া যায়নি।")
        x, y = a["results"][0], b["results"][0]
        lines = ["⚖ <b>Movie Comparison</b>"]
        for label, item in [(first, x), (second, y)]:
            d = await tmdb(f"/movie/{item['id']}")
            lines.append(f"\n🎬 <b>{html.escape(title_of(d))}</b>\nYear: {year_of(d)}\nRating: {stars(d.get('vote_average'))}\nRuntime: {d.get('runtime') or 'N/A'} min\nPopularity: {d.get('popularity',0):.1f}\nGenres: {', '.join(g['name'] for g in d.get('genres',[]))}")
        await update.effective_message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)
    except Exception as e:
        await update.effective_message.reply_text(f"Comparison error: {html.escape(str(e)[:200])}")

# ---------- Quiz ----------
async def start_quiz(message, context):
    try:
        d = await tmdb("/movie/popular")
        choices = d.get("results", [])[:4]
        if len(choices) < 4:
            return await message.reply_text("এখন কুইজ শুরু করা যাচ্ছে না।")
        correct = random.choice(choices)
        options = random.sample(choices, 4)
        context.bot_data.setdefault("quizzes", {})[message.chat_id] = correct["id"]
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(title_of(x)[:45], callback_data=f"quizans:{x['id']}")] for x in options])
        await message.reply_text("🧠 <b>Movie Quiz</b>\n\nএই মুভিটির নাম কী?\n\n" + f"⭐ Rating: {stars(correct.get('vote_average'))}\n📅 Year: {year_of(correct)}", parse_mode=ParseMode.HTML, reply_markup=keyboard)
    except Exception as e:
        await message.reply_text(f"Quiz error: {html.escape(str(e)[:200])}")

# ---------- Admin ----------
def admin_only(update):
    return is_admin(update.effective_user.id)

async def admin_cmd(update, context):
    if not admin_only(update):
        return await update.message.reply_text("⛔ Admin only.")
    await update.message.reply_text(
        "🛠 <b>Admin Commands</b>\n/stats — User/search stats\n/broadcast text — সবাইকে বার্তা\n"
        "/block USER_ID\n/unblock USER_ID\n/api — TMDB API health check",
        parse_mode=ParseMode.HTML
    )

async def stats_cmd(update, context):
    if not admin_only(update): return await update.message.reply_text("⛔ Admin only.")
    with db() as con:
        users = con.execute("SELECT COUNT(*) n FROM users").fetchone()["n"]
        active = con.execute("SELECT COUNT(DISTINCT user_id) n FROM searches WHERE searched_at >= datetime('now','-7 days')").fetchone()["n"]
        searches = con.execute("SELECT COUNT(*) n FROM searches").fetchone()["n"]
        favs = con.execute("SELECT COUNT(*) n FROM favorites").fetchone()["n"]
    await update.message.reply_text(f"📊 <b>Bot Statistics</b>\nUsers: {users}\nSearch users (7d): {active}\nTotal searches: {searches}\nFavorites saved: {favs}", parse_mode=ParseMode.HTML)

async def broadcast_cmd(update, context):
    if not admin_only(update): return await update.message.reply_text("⛔ Admin only.")
    message = " ".join(context.args).strip()
    if not message: return await update.message.reply_text("ব্যবহার: /broadcast আপনার বার্তা")
    with db() as con:
        ids = [r["user_id"] for r in con.execute("SELECT user_id FROM users WHERE blocked=0").fetchall()]
    sent = failed = 0
    for uid in ids:
        try:
            await context.bot.send_message(uid, message)
            sent += 1
            await asyncio.sleep(0.04)
        except Exception:
            failed += 1
    await update.message.reply_text(f"Broadcast complete.\nSent: {sent}\nFailed: {failed}")

async def block_cmd(update, context):
    if not admin_only(update): return await update.message.reply_text("⛔ Admin only.")
    if not context.args or not context.args[0].isdigit(): return await update.message.reply_text("ব্যবহার: /block USER_ID")
    uid = int(context.args[0])
    with db() as con:
        con.execute("UPDATE users SET blocked=1 WHERE user_id=?", (uid,))
        con.commit()
    await update.message.reply_text(f"User {uid} blocked (যদি user আগে বট চালিয়ে থাকে)।")

async def unblock_cmd(update, context):
    if not admin_only(update): return await update.message.reply_text("⛔ Admin only.")
    if not context.args or not context.args[0].isdigit(): return await update.message.reply_text("ব্যবহার: /unblock USER_ID")
    uid = int(context.args[0])
    with db() as con:
        con.execute("UPDATE users SET blocked=0 WHERE user_id=?", (uid,))
        con.commit()
    await update.message.reply_text(f"User {uid} unblocked.")

async def api_cmd(update, context):
    if not admin_only(update): return await update.message.reply_text("⛔ Admin only.")
    try:
        d = await tmdb("/configuration")
        await update.message.reply_text(f"✅ TMDB API connected.\nImage base: {d.get('images',{}).get('secure_base_url','N/A')}")
    except Exception as e:
        await update.message.reply_text(f"❌ TMDB API error: {html.escape(str(e)[:300])}")

async def quiz_answer(update, context):
    q = update.callback_query
    await q.answer()
    try:
        correct = context.bot_data.get("quizzes", {}).get(q.message.chat_id)
        selected = int(q.data.split(":")[1])
        if correct == selected:
            await q.message.reply_text("🎉 সঠিক উত্তর! দারুণ!")
        else:
            d = await tmdb(f"/movie/{correct}")
            await q.message.reply_text(f"❌ সঠিক উত্তর: {title_of(d)}")
    except Exception:
        await q.message.reply_text("কুইজের উত্তর যাচাই করা যায়নি।")

async def unknown_command(update, context):
    await update.message.reply_text("এই কমান্ডটি চিনি না। /help লিখুন।")

async def error_handler(update, context):
    log.exception("Unhandled exception", exc_info=context.error)

def main():
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN environment variable missing.")
    if not TMDB_API_KEY:
        raise SystemExit("TMDB_API_KEY environment variable missing.")
    init_db()
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("search", search_cmd))
    app.add_handler(CommandHandler("trending", trending))
    app.add_handler(CommandHandler("toprated", toprated))
    app.add_handler(CommandHandler("upcoming", upcoming))
    app.add_handler(CommandHandler("nowplaying", nowplaying))
    app.add_handler(CommandHandler("favorites", favorites))
    app.add_handler(CommandHandler("watchlist", watchlist))
    app.add_handler(CommandHandler("history", history_cmd))
    app.add_handler(CommandHandler("alerts", alerts_cmd))
    app.add_handler(CommandHandler("compare", compare_cmd))
    app.add_handler(CommandHandler("quiz", lambda u,c: start_quiz(u.message,c)))
    app.add_handler(CommandHandler("admin", admin_cmd))
    app.add_handler(CommandHandler("stats", stats_cmd))
    app.add_handler(CommandHandler("broadcast", broadcast_cmd))
    app.add_handler(CommandHandler("block", block_cmd))
    app.add_handler(CommandHandler("unblock", unblock_cmd))
    app.add_handler(CommandHandler("api", api_cmd))
    app.add_handler(CallbackQueryHandler(quiz_answer, pattern=r"^quizans:"))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    app.add_error_handler(error_handler)
    log.info("SOMRAT MOVIE BOT is running.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
