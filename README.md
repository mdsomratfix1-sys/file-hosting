# SOMRAT MOVIE BOT

## Features
- TMDB multi-search: movies, TV series, people (up to 10 results)
- Posters, release year, rating, full details, cast/crew, backdrop
- Official YouTube trailer link with YouTube search fallback
- Gallery, similar movies, share links
- Favorites, watchlist, search history, release alerts
- Trending, top rated, upcoming, now playing
- Movie comparison and quiz
- Admin: stats, broadcast, block/unblock, API health
- SQLite persistence (no MySQL)

## Run locally
1. Install Python 3.10+.
2. `pip install -r requirements.txt`
3. Set environment variables:
   - `BOT_TOKEN` = token from @BotFather
   - `TMDB_API_KEY` = TMDB API key (v3 auth key)
   - `ADMIN_IDS` = comma-separated Telegram numeric user IDs, e.g. `123456789,987654321`
4. Run: `python main.py`

## Render
Create a Background Worker (recommended for polling), upload these files, and set:
- Build command: `pip install -r requirements.txt`
- Start command: `python main.py`
- Environment variables: `BOT_TOKEN`, `TMDB_API_KEY`, `ADMIN_IDS`

Important: Render's local filesystem may be ephemeral depending on service/disk setup. For persistent SQLite data, attach a persistent disk and set `DB_PATH` to a path on that disk, e.g. `/var/data/somrat_movie_bot.db`.

## Notes / limitations
- Search spelling correction is delegated to TMDB's search matching; no separate fuzzy correction engine is included.
- Genre/year/rating filters are not yet exposed as interactive filter menus in this starter build.
- Release alerts are stored, but scheduled daily notification delivery is not yet implemented.
- Movie quiz is a lightweight rating/year clue quiz, not an image quiz.
- TMDB data availability varies by title and region. Some budget/revenue, biography, images, trailers or credits may be missing.
- This bot provides information and official trailer links; it does not download or stream copyrighted movies.
- Add your Telegram user ID to `ADMIN_IDS` before using admin commands.
