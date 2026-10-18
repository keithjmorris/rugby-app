// api/rugby.js — Vercel serverless proxy for the Highlightly Rugby API.
//
// The browser only ever calls our own endpoint, e.g.
//   /api/rugby?path=/matches&date=2026-10-18&timezone=Europe/London
// Everything except `path` is forwarded to Highlightly as a query parameter.
//
// The API key lives ONLY in the HIGHLIGHTLY_API_KEY environment variable
// (Vercel → Settings → Environment Variables, and a gitignored .env locally).
//
// HIGHLIGHTLY_RUGBY_BASE is optional. Leave it unset for a Rugby API
// subscription. If the account moves to "All Sports", set it to
//   https://sports.highlightly.net/rugby
// in Vercel and redeploy — no code change needed.

const BASE = (process.env.HIGHLIGHTLY_RUGBY_BASE || 'https://rugby.highlightly.net').replace(/\/+$/, '');

// Endpoint roots the front end may use. Odds and bookmakers are deliberately excluded.
const ALLOWED_ROOTS = new Set([
  'matches',
  'standings',
  'highlights',
  'leagues',
  'teams',
  'countries',
  'last-five-games',
  'head-2-head',
]);

// Every status value in the Highlightly Rugby docs, classified.
// (Kept in step with STATUS_GROUPS in app.js once the front end exists.)
const LIVE = new Set([
  'First half', 'Half time', 'Second half', 'Extra time',
  'Break time', 'Penalties', 'Suspended', 'Interrupted',
]);
const NOT_YET_PLAYED = new Set(['Not started', 'To be announced', 'Unknown']);
// Finished, Finished after extra time, Awarded, Abandoned, Postponed, Cancelled
// are all "settled" for caching purposes.

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// How often live scores refresh. Vercel setting LIVE_CACHE_SECONDS:
// 300 (5 minutes) suits the 100-requests-a-day BASIC plan; set 20 after the upgrade.
function liveSeconds() {
  const n = parseInt(process.env.LIVE_CACHE_SECONDS, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 15), 900) : 300;
}

// How long one real API call may be shared by every family member.
function matchesCacheSeconds(matches) {
  if (!matches.length) return 30 * MIN;
  const now = Date.now();
  const live = liveSeconds();
  let seconds = 7 * DAY;

  for (const m of matches) {
    const desc = m && m.state && m.state.description;
    const kickoff = Date.parse(m && m.date);
    const hoursSinceKickoff = Number.isFinite(kickoff) ? (now - kickoff) / HOUR / 1000 : NaN;

    if (LIVE.has(desc)) return live; // anything live → refresh fast

    if (!desc || NOT_YET_PLAYED.has(desc)) {
      if (!Number.isFinite(hoursSinceKickoff)) seconds = Math.min(seconds, 30 * MIN);
      // Kicks off within 3 hours, or should have started and hasn't updated yet.
      else if (hoursSinceKickoff > -3 && hoursSinceKickoff < 12) return live;
      else if (hoursSinceKickoff > -24) seconds = Math.min(seconds, 30 * MIN);
      else seconds = Math.min(seconds, 3 * HOUR);
    } else if (!Number.isFinite(hoursSinceKickoff) || hoursSinceKickoff < 36) {
      // Recently finished: scores and statuses can still be corrected.
      seconds = Math.min(seconds, 30 * MIN);
    }
  }
  return seconds;
}

function cacheSecondsFor(root, segments, body) {
  switch (root) {
    case 'matches': {
      const list = Array.isArray(body) ? body
        : Array.isArray(body && body.data) ? body.data
        : body && body.id ? [body] : [];
      return matchesCacheSeconds(list);
    }
    case 'standings': return 30 * MIN;
    case 'highlights': return 15 * MIN;
    case 'last-five-games':
    case 'head-2-head': return HOUR;
    case 'teams': return segments[1] === 'statistics' ? 6 * HOUR : DAY;
    case 'leagues':
    case 'countries': return DAY;
    default: return 5 * MIN;
  }
}

function setCache(res, seconds) {
  const swr = seconds <= 900 ? 10 : seconds;
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${swr}`);
  res.setHeader('X-Rugby-Cache-Seconds', String(seconds));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Only GET is supported' });
  }

  const apiKey = process.env.HIGHLIGHTLY_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'HIGHLIGHTLY_API_KEY is not set in this Vercel project' });
  }

  const rawPath = String((req.query && req.query.path) || '').trim();
  const path = '/' + rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/i.test(path)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Missing or invalid path, e.g. ?path=/matches' });
  }
  const segments = path.slice(1).split('/');
  const root = segments[0].toLowerCase();
  if (!ALLOWED_ROOTS.has(root)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: `Endpoint "${root}" is not allowed`, allowed: [...ALLOWED_ROOTS] });
  }

  // Forward every other query parameter.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'path') continue;
    if (!/^[A-Za-z]{1,40}$/.test(key)) continue;
    for (const v of [].concat(value)) {
      const s = String(v);
      if (s.length <= 200) params.append(key, s);
    }
  }
  const qs = params.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { 'x-rapidapi-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Could not reach Highlightly', detail: String(err && err.message || err) });
  }

  // Pass through rate-limit headers so we can see how much of the daily quota is left.
  upstream.headers.forEach((value, name) => {
    if (/ratelimit|quota|remaining/i.test(name)) res.setHeader(name, value);
  });

  const text = await upstream.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }

  if (!upstream.ok) {
    // Cache errors only very briefly, so a fixed problem clears quickly
    // but a burst of family taps doesn't burn the quota.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
    return res.status(upstream.status).json({
      error: `Highlightly returned ${upstream.status}`,
      upstream: body !== null ? body : text.slice(0, 2000),
    });
  }
  if (body === null) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Highlightly returned something that was not JSON', upstream: text.slice(0, 2000) });
  }

  setCache(res, cacheSecondsFor(root, segments, body));
  return res.status(200).json(body);
};

// Exposed for local testing only.
module.exports._test = { matchesCacheSeconds, cacheSecondsFor, LIVE, NOT_YET_PLAYED };
