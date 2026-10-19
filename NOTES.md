# Data notes (from real Highlightly responses)

## Plan
- 18 Oct 2026: key works on rugby.highlightly.net, plan tier "BASIC" (treat as 100 requests/day).

## League IDs (from /leagues, 108 leagues in total). Always use IDs, never names.

| Competition | ID | Seasons held |
|---|---|---|
| Premiership Rugby (England) | 11847 | 2019–2026 |
| Championship ("Greene King IPA Championship") | 10996 | 2021–2026 |
| Premiership Rugby Cup | 9294 | 2021–2026 |
| United Rugby Championship | 65460 | 2020–2026 |
| Top 14 | 14400 | 2020–2026 |
| Super Rugby | 61205 | 2021–2026 |
| European Rugby Champions Cup | 46738 | 2020–2026 |
| Challenge Cup | 45036 | 2020–2026 |
| Six Nations | 44185 | 2021–2026 |
| Six Nations Women | 47589 | 2020–2026 |
| Six Nations U20 | 48440 | 2021–2026 |
| Nations Championship | 124179 | 2026 |
| World Rugby Nations Cup | 125030 | 2026 |
| Rugby Championship | 73119 | 2020–2025 (no 2026) |
| Friendly International (men) | 72268 | 2020–2026 |
| Friendly International Women | 83331 | 2021–2026 |
| World Cup | 59503 | 2023, 2027 |
| World Cup Women | 60354 | 2022, 2025 |
| WXV 1 Women | 120775 | 2023, 2024, 2026 |
| Premier 15s Women | 13549 | 2020–2025 (no 2026) |
| Elite 1 Women (France) | 123328 | 2024–2026 |
| Super W Women | 4188 | 2021–2026 |
| Super Rugby Aupiki Women | 116520 | 2024–2026 |
| Lions Tour | 75672 | 2021, 2025 |
| World Championship U20 | 87586 | 2026 |

Ignore these duplicates: "Premiership Rugby" 5039 (labelled Austria, up to 2024) and
41632 (labelled Wales, unclear).

## Confirmed from /highlights?leagueId=11847&season=2026 (19 Oct 2026, All Sports PRO)
- `{data, plan, pagination}`; newest first; limit max 40.
- Items: id, type ("VERIFIED"), imgUrl (YouTube thumbnail), title, description (null), url (YouTube watch),
  embedUrl, channel, source ("youtube"), category ("match-highlights"), match (full match object).
- 9 highlights for 15 finished matches; some matches have two (TNT Sports + club channel).
- `channel` can contain HTML entities ("&amp;"), so decode before display.
- Data error: highlight 12377 ("Bath v Northampton Champions Cup 2025/26") is attached to the
  Premiership Round 3 match 46844930 (Northampton v Bath, Oct 2026). Shown as supplied; reported, not filtered.

## Line-ups
- Highlightly (19 Oct 2026): line-ups, venue, referee, forecast and predictions are only populated for
  "certain leagues and matches". None seen so far for the Premiership.

## Gaps to raise with Highlightly
- Highlight 12377 is attached to the wrong match (see above).
- Which leagues actually carry line-ups?
- No player statistics endpoint.
- Documented match detail has no events timeline, team stats or clock.
- Standings rows have no bonus-point fields (to be confirmed with real data).
- Rugby Championship has no 2026 season.
- Premier 15s Women / Premiership Women's Rugby has no 2026 season.
- Three leagues named "Premiership Rugby".

## Confirmed from /matches?leagueId=11847&season=2026 (18 Oct 2026)
- Season numbering: "2026" = the 2026/27 season (round 1 was 25–27 Sep 2026).
- List comes back newest first. Up to 100 per call; the Premiership season so far is 25 matches.
- Fixtures held only to 31 Oct 2026 (round 5), about 2 weeks ahead.
- `state.score` is a "home - away" string, e.g. "28 - 24"; null before kick-off.
- `week` is a string ("5"). `date` is UTC ISO; show in Europe/London.
- Team names are plain: "Bristol", "Northampton Saints", "Newcastle Red Bulls".
- Some teams have `logo: null` (Newcastle Red Bulls, 789661), so a fallback badge is needed.
- No bonus points or tries in the list. Losing bonus could be worked out from scores; try bonus could not.

## Confirmed from /matches/46844079 (Leicester v Gloucester, Premiership)
- Returns an ARRAY holding one match object, not a bare object.
- venue, referee and forecast are all fields of nulls; `lineups` is null. No events, no stats.
- `predictions.prematch` holds about 20 near-identical snapshots; use the last (latest generatedAt).
  Probabilities are strings like "71.44%".

## Confirmed from /standings?leagueId=11847&season=2026
- `groups[0].name` = "English Premiership 26/27" (useful as a heading).
- Rows: team{id,logo,name}, position, gamesPlayed, wins, draws, loses, scoredPoints, receivedPoints, points.
- `points` INCLUDES bonus points. Bonus total = points − 4×wins − 2×draws.
  Cross-checked against all 15 results: P/W/D/L/PF/PA match exactly, and
  losing bonus (lost by ≤7, worked out from scores) ≤ bonus total for every team,
  so try bonus = total − losing bonus.
- Different competitions use different bonus rules (e.g. Top 14 losing bonus is ≤5),
  so split TB/LB only where the rule is known; the BP total works anywhere wins = 4, draws = 2.
