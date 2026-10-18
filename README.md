# Rugby

Family rugby dashboard (Rugby Union). Plain HTML, CSS and JS with no build
step, hosted on Vercel. Data from the Highlightly Rugby API through a
serverless proxy, so the API key never reaches the browser.

## Files

- `index.html`: the app (Live, Fixtures, Results, Tables)
- `app.js`: all app logic
- `config.js`: which competitions are followed, by Highlightly league ID
- `style.css`: styles (keep `.overlay[hidden] { display: none; }` in every version)
- `explorer.html`: raw data explorer for checking real API responses
- `api/rugby.js`: proxy at `/api/rugby?path=/...`, with an allow-list and shared caching
- `NOTES.md`: what the real data looks like, league IDs, and gaps to raise with Highlightly

## Environment variables (Vercel → Settings → Environment Variables)

- `HIGHLIGHTLY_API_KEY`: required
- `HIGHLIGHTLY_RUGBY_BASE`: optional. Unset means `https://rugby.highlightly.net`.
  Set it to `https://sports.highlightly.net/rugby` on an All Sports subscription.
- `LIVE_CACHE_SECONDS`: optional. How often live scores refresh. Unset means 300 (5 minutes),
  which suits the 100-a-day BASIC plan. Set it to 20 after upgrading.

Changing any variable takes effect only after a redeploy.

## Caching (shared by everyone through Vercel's edge)

| Request | Cache |
|---|---|
| Matches with anything live, or kicking off within 3 hours | `LIVE_CACHE_SECONDS` (default 5 min) |
| Matches finished in the last 36 hours, or kicking off within 24 hours | 30 min |
| Fixtures more than a day away | 3 hours |
| Matches all settled and older than 36 hours | 7 days |
| Standings | 30 min |
| Highlights | 15 min |
| Form and head-to-head | 1 hour |
| Team season statistics | 6 hours |
| Leagues, teams, countries | 1 day |
| Errors | 15 s |

The app fetches one season list per competition, and that single list feeds Live, Fixtures and
Results. While something is live, only those competitions are re-fetched.

## Followed teams

England (men's and women's internationals, not age-grade sides) are always followed.
Each person can add Premiership clubs with "My clubs"; the choice is saved on that device only.
