# Rugby

Family rugby dashboard (Rugby Union). Plain HTML, CSS and JS with no build
step, hosted on Vercel. Data from the Highlightly Rugby API through a
serverless proxy, so the API key never reaches the browser.

## Files

- `index.html`: home page (placeholder for now)
- `explorer.html`: raw data explorer for checking real API responses
- `style.css`: styles
- `api/rugby.js`: proxy at `/api/rugby?path=/...`, with an allow-list and shared caching

## Environment variables (Vercel → Settings → Environment Variables)

- `HIGHLIGHTLY_API_KEY`: required
- `HIGHLIGHTLY_RUGBY_BASE`: optional. Unset means `https://rugby.highlightly.net`.
  Set it to `https://sports.highlightly.net/rugby` on an All Sports subscription.

Changing either variable takes effect only after a redeploy.

## Caching (shared by everyone through Vercel's edge)

| Request | Cache |
|---|---|
| Matches with anything live, or kicking off within 3 hours | 20 s |
| Matches finished in the last 36 hours, or kicking off within 24 hours | 10 min |
| Fixtures more than a day away | 1 hour |
| Matches all settled and older than 36 hours | 7 days |
| Standings | 30 min |
| Highlights | 15 min |
| Form and head-to-head | 1 hour |
| Team season statistics | 6 hours |
| Leagues, teams, countries | 1 day |
| Errors | 15 s |
