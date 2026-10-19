// app.js — Rugby family dashboard. Plain JS, no build step.
// All data comes through our own /api/rugby proxy (the API key never reaches the browser).
(() => {
  'use strict';

  const CFG = window.RUGBY_CONFIG;
  const TZ = 'Europe/London';
  const RESULTS_DAYS = 45; // Results tab shows this many days before "Show earlier results"

  // ── Status handling ─────────────────────────────────────────────────────
  // Every status value in the Highlightly Rugby docs, classified explicitly.
  // Anything not listed (including "Unknown") is placed by its kick-off time.
  const STATUS_GROUPS = {
    live: ['First half', 'Half time', 'Second half', 'Extra time', 'Break time', 'Penalties', 'Suspended', 'Interrupted'],
    upcoming: ['Not started', 'To be announced'],
    postponed: ['Postponed'],
    finished: ['Finished', 'Finished after extra time', 'Awarded', 'Abandoned'],
    cancelled: ['Cancelled'],
  };
  const STATUS_OF = {};
  for (const [group, list] of Object.entries(STATUS_GROUPS)) for (const s of list) STATUS_OF[s] = group;

  const HOUR = 3600e3;
  const DAY = 24 * HOUR;

  function phase(m) {
    const group = STATUS_OF[m.state && m.state.description];
    if (group) return group;
    return kickoff(m) > Date.now() ? 'upcoming' : 'finished';
  }
  // Not started on paper, but kick-off has passed: the provider hasn't updated yet.
  function isOverdue(m) {
    if (phase(m) !== 'upcoming') return false;
    const since = Date.now() - kickoff(m);
    return since > 0 && since < 12 * HOUR;
  }
  const kickoff = m => Date.parse(m.date) || 0;

  function statusTag(m) {
    const d = m.state && m.state.description;
    if (!d || d === 'Not started' || d === 'Finished') return '';
    if (d === 'Finished after extra time') return 'After extra time';
    return d;
  }

  function parseScore(m) {
    const s = m.state && m.state.score;
    if (!s) return null;
    const parts = String(s).split('-').map(x => parseInt(x.trim(), 10));
    return parts.length === 2 && parts.every(Number.isFinite) ? parts : null;
  }

  // ── Small helpers ───────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
  const fDayKey = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const fDayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fDayShort = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
  const dayKey = t => fDayKey.format(new Date(t));

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  };

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    tab: 'live',
    filter: 'mine',          // 'mine' | 'england' | 'all' | 'club:<id>'
    search: '',
    seasons: {},             // compId → season
    matches: {},             // compId → [match]
    cacheSecs: {},           // compId → seconds the proxy said this list is fresh for
    errors: {},              // compId → message
    standings: {},           // `${compId}:${season}` → response or {error}
    highlights: {},          // compId → [highlight] (newest 40 per competition)
    matchHighlights: {},     // matchId → [highlight] fetched for the match popup
    tableComp: null,
    followed: store.get('rugby.followedClubs', []), // [{id, name, logo}]
    showOlder: false,
    loadedAt: null,
    loading: true,
  };
  const compById = Object.fromEntries(CFG.competitions.map(c => [c.id, c]));

  // ── API ─────────────────────────────────────────────────────────────────
  async function api(path, params = {}) {
    const q = new URLSearchParams({ path, ...params });
    const res = await fetch('/api/rugby?' + q);
    let json = null;
    try { json = await res.json(); } catch { /* handled below */ }
    if (!res.ok) {
      const up = json && json.upstream;
      const detail = (up && (up.message || up.error)) || (json && json.error) || res.statusText;
      const err = new Error(res.status === 429 ? 'Daily request limit reached at Highlightly' : String(detail));
      err.status = res.status;
      throw err;
    }
    return { json, cacheSeconds: parseInt(res.headers.get('X-Rugby-Cache-Seconds'), 10) || null };
  }
  const listOf = json => Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : []);

  async function loadSeasons() {
    try {
      const pages = await Promise.all([api('/leagues'), api('/leagues', { offset: 100 })]);
      for (const { json } of pages) {
        for (const l of listOf(json)) {
          if (!compById[l.id]) continue;
          const seasons = (l.seasons || []).map(s => s.season).filter(Number.isFinite);
          if (seasons.length) state.seasons[l.id] = Math.max(...seasons);
        }
      }
    } catch (e) { /* fall back below */ }
    // Fallback if /leagues failed: club seasons start in the autumn and use the starting year.
    const now = new Date();
    const y = now.getUTCFullYear();
    for (const c of CFG.competitions) {
      if (!state.seasons[c.id]) state.seasons[c.id] = c.kind === 'club' && now.getUTCMonth() < 6 ? y - 1 : y;
    }
  }

  async function loadMatches(comp) {
    const season = state.seasons[comp.id];
    const all = [];
    let minCache = null;
    for (let offset = 0, page = 0; page < 4; page++, offset += 100) {
      const { json, cacheSeconds } = await api('/matches', { leagueId: comp.id, season, ...(offset ? { offset } : {}) });
      const list = listOf(json);
      all.push(...list);
      if (cacheSeconds) minCache = minCache ? Math.min(minCache, cacheSeconds) : cacheSeconds;
      const total = json && json.pagination && json.pagination.totalCount;
      if (!total || all.length >= total || list.length === 0) break;
    }
    for (const m of all) m._comp = comp;
    state.matches[comp.id] = all;
    state.cacheSecs[comp.id] = minCache;
    delete state.errors[comp.id];
  }

  async function loadAll() {
    state.loading = true;
    render();
    await loadSeasons();
    await Promise.all(CFG.competitions.map(c => loadMatches(c).catch(e => { state.errors[c.id] = e.message; })));
    state.loading = false;
    state.loadedAt = Date.now();
    render();
    scheduleRefresh();
    loadHighlights();
  }

  // ── Highlights ──────────────────────────────────────────────────────────
  // One request per competition that has results in the Results window; the newest
  // 40 highlights each. They feed the "Latest highlights" strip and the ▶ markers.
  async function loadHighlights() {
    const cutoff = Date.now() - RESULTS_DAYS * DAY;
    const comps = CFG.competitions.filter(c => (state.matches[c.id] || [])
      .some(m => phase(m) === 'finished' && kickoff(m) >= cutoff));
    await Promise.all(comps.map(async c => {
      try {
        const { json } = await api('/highlights', { leagueId: c.id, season: state.seasons[c.id], limit: 40 });
        state.highlights[c.id] = listOf(json);
      } catch { /* highlights are optional; leave this competition without them */ }
    }));
    render();
  }

  const decode = s => { const t = document.createElement('textarea'); t.innerHTML = String(s || ''); return t.value; };
  const safeUrl = u => /^https:\/\//i.test(String(u || '')) ? u : '';

  // Full match highlights first, then other clips; newest first within each.
  function sortHighlights(list) {
    return list.slice().sort((a, b) =>
      (a.category === 'match-highlights' ? 0 : 1) - (b.category === 'match-highlights' ? 0 : 1) || (b.id || 0) - (a.id || 0));
  }
  function highlightsForMatch(id) {
    if (state.matchHighlights[id]) return state.matchHighlights[id];
    const all = Object.values(state.highlights).flat().filter(h => h.match && String(h.match.id) === String(id));
    return all.length ? all : null;
  }
  const hasHighlights = id => !!(highlightsForMatch(id) || []).length;

  function highlightCard(h) {
    const url = safeUrl(h.url);
    if (!url) return '';
    const when = h.match && h.match.date ? fDayShort.format(new Date(h.match.date)) : '';
    const meta = [decode(h.channel), when].filter(Boolean).join(' · ');
    const img = safeUrl(h.imgUrl);
    return `<a class="hl" href="${esc(url)}" target="_blank" rel="noopener">
      <span class="hl-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<i class="hl-play" aria-hidden="true"></i></span>
      <span class="hl-title">${esc(decode(h.title))}</span>
      ${meta ? `<span class="hl-meta">${esc(meta)}</span>` : ''}
    </a>`;
  }

  function highlightStrip() {
    const items = [];
    for (const c of CFG.competitions) {
      for (const h of state.highlights[c.id] || []) {
        if (!h.match || !h.match.homeTeam || !h.match.awayTeam) continue;
        if (passesFilter({ ...h.match, _comp: c })) items.push(h);
      }
    }
    if (!items.length) return '';
    items.sort((a, b) => (Date.parse(b.match.date) || 0) - (Date.parse(a.match.date) || 0) || (b.id || 0) - (a.id || 0));
    return `<section class="day hl-strip">
      <h2 class="day-title">Latest highlights</h2>
      <div class="hl-row">${items.slice(0, 12).map(highlightCard).join('')}</div>
    </section>`;
  }

  // ── Live refresh ────────────────────────────────────────────────────────
  // Only competitions with something live, about to start, or overdue are re-fetched.
  let refreshTimer = null;
  let refreshDueAt = 0;
  function activeComps() {
    return CFG.competitions.filter(c => (state.matches[c.id] || []).some(m => {
      if (phase(m) === 'live' || isOverdue(m)) return true;
      const until = kickoff(m) - Date.now();
      return phase(m) === 'upcoming' && until > 0 && until < 3 * HOUR;
    }));
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    const comps = activeComps();
    let secs;
    if (comps.length) {
      const cached = comps.map(c => state.cacheSecs[c.id]).filter(Boolean);
      secs = Math.max(30, cached.length ? Math.min(...cached) : 300);
    } else {
      secs = 30 * 60; // nothing live: quiet background refresh every half hour
    }
    refreshDueAt = Date.now() + secs * 1000;
    refreshTimer = setTimeout(runRefresh, secs * 1000);
    state.liveEvery = comps.length ? secs : null;
    updateStamp();
  }
  async function runRefresh() {
    if (document.hidden) return; // picked up again when the page becomes visible
    const comps = activeComps();
    const targets = comps.length ? comps : CFG.competitions;
    await Promise.all(targets.map(c => loadMatches(c).catch(e => { state.errors[c.id] = e.message; })));
    state.loadedAt = Date.now();
    render();
    scheduleRefresh();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && refreshDueAt && Date.now() >= refreshDueAt) runRefresh();
  });

  function updateStamp() {
    const el = $('updated');
    if (state.loading && !state.loadedAt) { el.textContent = 'Loading…'; return; }
    if (!state.loadedAt) { el.textContent = ''; return; }
    let s = 'Updated ' + fTime.format(new Date(state.loadedAt));
    if (state.liveEvery) {
      const mins = state.liveEvery >= 60 ? Math.round(state.liveEvery / 60) + ' min' : state.liveEvery + ' sec';
      s += ` · live scores every ${mins}`;
    }
    el.textContent = s;
  }

  // ── Teams and filters ───────────────────────────────────────────────────
  const nationRe = new RegExp('^' + CFG.pinnedNation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  function isNation(team, comp) {
    // Only in international competitions, so club sides can never match.
    // Excludes age-grade sides such as "England U20".
    return comp.kind === 'intl' && nationRe.test(team.name || '') && !/\bu\s?\d{2}\b|under/i.test(team.name || '');
  }
  function isFollowedClub(team) {
    return state.followed.some(f => f.id === team.id || norm(f.name) === norm(team.name));
  }
  function isTracked(team, comp) { return isNation(team, comp) || isFollowedClub(team); }

  function passesFilter(m) {
    const comp = m._comp;
    const teams = [m.homeTeam || {}, m.awayTeam || {}];
    if (state.search) {
      const q = norm(state.search);
      const hay = norm([teams[0].name, teams[1].name, comp.name, m.league && m.league.name].join(' '));
      return hay.includes(q);
    }
    switch (true) {
      case state.filter === 'all': return true;
      case state.filter === 'england': return teams.some(t => isNation(t, comp));
      case state.filter.startsWith('club:'): {
        const f = state.followed.find(x => 'club:' + x.id === state.filter);
        return !!f && teams.some(t => t.id === f.id || norm(t.name) === norm(f.name));
      }
      default: return teams.some(t => isTracked(t, comp));
    }
  }

  function allMatches() {
    return Object.values(state.matches).flat();
  }

  // ── Rendering: shared bits ──────────────────────────────────────────────
  function initials(name) {
    const words = String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  }
  function hue(name) {
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  function crest(team, size = '') {
    const fb = `<span class="crest crest-fallback ${size}" style="--h:${hue(team.name)}" aria-hidden="true">${esc(initials(team.name))}</span>`;
    if (!team.logo) return fb;
    return `<img class="crest ${size}" src="${esc(team.logo)}" alt="" loading="lazy" data-fallback="${esc(initials(team.name))}" data-hue="${hue(team.name)}">`;
  }
  // Broken logo → initials badge (error events don't bubble, so listen in the capture phase).
  document.addEventListener('error', e => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.closest('.hl-thumb')) { img.remove(); return; }
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
    const span = document.createElement('span');
    span.className = img.className + ' crest-fallback';
    span.style.setProperty('--h', img.dataset.hue);
    span.textContent = img.dataset.fallback;
    img.replaceWith(span);
  }, true);

  function compLabel(m) {
    const week = m.week && /^\d+$/.test(String(m.week)) ? ` · Round ${m.week}` : '';
    return esc(m._comp.name) + week;
  }

  function matchCard(m) {
    const ph = phase(m);
    const score = parseScore(m);
    const showScore = score && ph !== 'upcoming' && ph !== 'postponed';
    const tag = statusTag(m);
    const overdue = isOverdue(m);
    const hw = showScore && score[0] > score[1];
    const aw = showScore && score[1] > score[0];
    const time = fTime.format(new Date(kickoff(m)));
    let right;
    if (ph === 'live') right = `<span class="live-pill"><i></i>${esc(m.state.description)}</span>`;
    else if (overdue) right = `<span class="tag">Awaiting update</span>`;
    else if (tag) right = `<span class="tag tag-${ph}">${esc(tag)}</span>`;
    else right = `<span class="when">${ph === 'upcoming' ? time : 'FT'}</span>`;
    if (ph === 'finished' && hasHighlights(m.id)) right = `<span class="hl-mark" title="Highlights available">▶ Video</span>${right}`;

    const row = (team, pts, win) => `
      <div class="team-row${win ? ' win' : ''}${isTracked(team, m._comp) ? ' tracked' : ''}">
        ${crest(team)}
        <span class="team-name">${esc(team.name)}</span>
        <span class="pts">${showScore ? pts : ''}</span>
      </div>`;
    return `
      <button type="button" class="match match-${ph}" data-match="${m.id}">
        <div class="match-meta"><span class="comp">${compLabel(m)}</span><span class="meta-right">${right}</span></div>
        ${row(m.homeTeam || {}, showScore ? score[0] : '', hw)}
        ${row(m.awayTeam || {}, showScore ? score[1] : '', aw)}
      </button>`;
  }

  function groupByDay(list) {
    const groups = [];
    let current = null;
    for (const m of list) {
      const k = dayKey(kickoff(m));
      if (!current || current.key !== k) { current = { key: k, label: fDayLong.format(new Date(kickoff(m))), items: [] }; groups.push(current); }
      current.items.push(m);
    }
    return groups;
  }
  const dayBlocks = list => groupByDay(list).map(g => `
    <section class="day">
      <h2 class="day-title">${esc(g.label)}</h2>
      <div class="cards">${g.items.map(matchCard).join('')}</div>
    </section>`).join('');

  function emptyMsg(text) { return `<p class="empty">${text}</p>`; }

  function filterDescription() {
    if (state.search) return `matching “${esc(state.search)}”`;
    if (state.filter === 'all') return 'in the followed competitions';
    if (state.filter === 'england') return `for ${esc(CFG.pinnedNation)}`;
    if (state.filter.startsWith('club:')) {
      const f = state.followed.find(x => 'club:' + x.id === state.filter);
      return f ? `for ${esc(f.name)}` : '';
    }
    return 'for your teams';
  }

  function errorBanner() {
    const errs = Object.entries(state.errors);
    if (!errs.length) return '';
    const items = errs.map(([id, msg]) => `${esc(compById[id] ? compById[id].name : id)}: ${esc(msg)}`).join('<br>');
    return `<div class="banner">Some data couldn't be loaded.<br>${items}</div>`;
  }

  // ── Tabs ────────────────────────────────────────────────────────────────
  function renderLive() {
    const list = allMatches().filter(passesFilter);
    const live = list.filter(m => phase(m) === 'live' || isOverdue(m)).sort((a, b) => kickoff(a) - kickoff(b));
    const today = dayKey(Date.now());
    const later = list.filter(m => phase(m) === 'upcoming' && !isOverdue(m) && dayKey(kickoff(m)) === today)
      .sort((a, b) => kickoff(a) - kickoff(b));
    let html = '';
    if (live.length) html += `<section class="day"><h2 class="day-title live-title">Live now</h2><div class="cards">${live.map(matchCard).join('')}</div></section>`;
    if (later.length) html += `<section class="day"><h2 class="day-title">Later today</h2><div class="cards">${later.map(matchCard).join('')}</div></section>`;
    if (!html) {
      const next = list.filter(m => phase(m) === 'upcoming' && kickoff(m) > Date.now()).sort((a, b) => kickoff(a) - kickoff(b))[0];
      html = emptyMsg(`No live matches ${filterDescription()} right now.`);
      if (next) html += `<section class="day"><h2 class="day-title">Next up · ${esc(fDayShort.format(new Date(kickoff(next))))}</h2><div class="cards">${matchCard(next)}</div></section>`;
    }
    return html;
  }

  function renderFixtures() {
    const all = allMatches();
    const list = all.filter(m => (phase(m) === 'upcoming' && !isOverdue(m)) || phase(m) === 'postponed')
      .filter(passesFilter).sort((a, b) => kickoff(a) - kickoff(b));
    const horizon = all.filter(m => phase(m) === 'upcoming').reduce((mx, m) => Math.max(mx, kickoff(m)), 0);
    const note = horizon ? `<p class="footnote">Highlightly currently lists fixtures up to ${esc(fDayShort.format(new Date(horizon)))}. More are added as the season goes on.</p>` : '';
    if (!list.length) return emptyMsg(`No fixtures listed ${filterDescription()}.`) + note;
    return dayBlocks(list) + note;
  }

  function renderResults() {
    const list = allMatches().filter(m => phase(m) === 'finished' || phase(m) === 'cancelled')
      .filter(passesFilter).sort((a, b) => kickoff(b) - kickoff(a));
    if (!list.length) return emptyMsg(`No results ${filterDescription()} this season.`);
    const cutoff = Date.now() - RESULTS_DAYS * DAY;
    const recent = state.showOlder ? list : list.filter(m => kickoff(m) >= cutoff);
    const hidden = list.length - recent.length;
    let html = highlightStrip();
    html += recent.length ? dayBlocks(recent) : emptyMsg(`No results ${filterDescription()} in the last ${RESULTS_DAYS} days.`);
    if (hidden > 0) html += `<button type="button" class="more-btn" data-action="older">Show ${hidden} earlier result${hidden === 1 ? '' : 's'}</button>`;
    return html;
  }

  // ── Tables ──────────────────────────────────────────────────────────────
  const tableComps = () => CFG.competitions.filter(c => c.table);

  function defaultTableComp() {
    const firstWithClub = tableComps().find(c => c.kind === 'club');
    return (firstWithClub || tableComps()[0]).id;
  }

  async function ensureStandings(comp) {
    const season = state.seasons[comp.id];
    const key = `${comp.id}:${season}`;
    if (state.standings[key]) return;
    state.standings[key] = { loading: true };
    try {
      const { json } = await api('/standings', { leagueId: comp.id, season });
      state.standings[key] = json || {};
    } catch (e) {
      state.standings[key] = { error: e.message };
    }
    if (state.tab === 'tables') render();
  }

  // Bonus points are inside `points`: BP = points − 4×wins − 2×draws.
  // Where the losing-bonus rule is known, the losing bonus is worked out from scores
  // and the rest is the try bonus. Every figure is sanity-checked against the results;
  // if anything disagrees we fall back to a single BP column, or none.
  function bonusColumns(comp, rows) {
    const bp = rows.map(r => (r.points || 0) - 4 * (r.wins || 0) - 2 * (r.draws || 0));
    if (bp.some(x => x < 0)) return { mode: 'none' };
    if (!comp.losingBonus) return { mode: 'bp', bp };

    const lb = {}, played = {};
    for (const m of state.matches[comp.id] || []) {
      if (phase(m) !== 'finished') continue;
      const s = parseScore(m);
      if (!s) continue;
      for (const [team, f, a] of [[m.homeTeam, s[0], s[1]], [m.awayTeam, s[1], s[0]]]) {
        played[team.id] = (played[team.id] || 0) + 1;
        if (f < a && a - f <= comp.losingBonus) lb[team.id] = (lb[team.id] || 0) + 1;
      }
    }
    const ok = rows.every((r, i) => {
      const l = lb[r.team.id] || 0;
      return played[r.team.id] === r.gamesPlayed && l <= bp[i] && bp[i] - l <= r.gamesPlayed;
    });
    if (!ok) return { mode: 'bp', bp };
    return { mode: 'split', bp, lb: rows.map(r => lb[r.team.id] || 0) };
  }

  function standingsTable(comp, group) {
    const rows = (group.standings || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    if (!rows.length) return '';
    const bonus = bonusColumns(comp, rows);
    const head = bonus.mode === 'split' ? '<th title="Try bonus">TB</th><th title="Losing bonus">LB</th>'
      : bonus.mode === 'bp' ? '<th title="Bonus points">BP</th>' : '';
    const body = rows.map((r, i) => {
      const pd = (r.scoredPoints || 0) - (r.receivedPoints || 0);
      const b = bonus.mode === 'split' ? `<td>${bonus.bp[i] - bonus.lb[i]}</td><td>${bonus.lb[i]}</td>`
        : bonus.mode === 'bp' ? `<td>${bonus.bp[i]}</td>` : '';
      return `<tr class="${isTracked(r.team, comp) ? 'tracked' : ''}">
        <td class="pos">${r.position ?? ''}</td>
        <td class="team-col">${crest(r.team, 'sm')}<span class="tname" title="${esc(r.team.name)}">${esc(r.team.name)}</span></td>
        <td>${r.gamesPlayed ?? 0}</td><td>${r.wins ?? 0}</td><td>${r.draws ?? 0}</td><td>${r.loses ?? 0}</td>
        <td class="wide-only">${r.scoredPoints ?? 0}</td><td class="wide-only">${r.receivedPoints ?? 0}</td><td>${pd > 0 ? '+' + pd : pd}</td>
        ${b}<td class="pts-col">${r.points ?? 0}</td></tr>`;
    }).join('');
    const note = bonus.mode === 'split' ? 'TB try bonus · LB losing bonus (worked out from results)'
      : bonus.mode === 'bp' ? 'BP bonus points' + (comp.id === 44185 || comp.id === 47589 ? ', including any Grand Slam bonus' : '') : '';
    return `
      <section class="table-section">
        <h3 class="table-title">${esc(group.name || comp.name)}</h3>
        <div class="table-wrap">
          <table class="standings">
            <thead><tr><th>#</th><th class="team-col">Team</th><th>P</th><th>W</th><th>D</th><th>L</th>
              <th class="wide-only" title="Points for">PF</th><th class="wide-only" title="Points against">PA</th><th title="Points difference">PD</th>${head}<th>Pts</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        ${note ? `<p class="footnote">${note}</p>` : ''}
      </section>`;
  }

  function renderTables() {
    if (!state.tableComp) state.tableComp = store.get('rugby.tableComp', null) || defaultTableComp();
    const comp = compById[state.tableComp] || compById[defaultTableComp()];
    const chips = tableComps().map(c =>
      `<button type="button" class="chip${c.id === comp.id ? ' on' : ''}" data-table="${c.id}">${esc(c.name)}</button>`).join('');
    const season = state.seasons[comp.id];
    const data = state.standings[`${comp.id}:${season}`];
    let body;
    if (!data || data.loading) { body = emptyMsg('Loading table…'); ensureStandings(comp); }
    else if (data.error) body = `<div class="banner">Couldn't load the table: ${esc(data.error)}</div>`;
    else {
      const groups = (data.groups || []).filter(g => (g.standings || []).length);
      body = groups.length ? groups.map(g => standingsTable(comp, g)).join('')
        : emptyMsg(`Highlightly has no table for ${esc(comp.name)} ${season} yet.`);
    }
    return `<div class="chips table-chips">${chips}</div>${body}`;
  }

  // ── Main render ─────────────────────────────────────────────────────────
  function renderChips() {
    const chips = [
      ['mine', 'My teams'],
      ['england', CFG.pinnedNation],
      ...state.followed.map(f => ['club:' + f.id, f.name, f]),
      ['all', 'All'],
    ];
    $('chips').innerHTML = chips.map(([key, label, team]) =>
      `<button type="button" class="chip${state.filter === key && !state.search ? ' on' : ''}" data-filter="${esc(key)}">${team ? crest(team, 'xs') : ''}${esc(label)}</button>`).join('');
  }

  function render() {
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    $('filters').hidden = state.tab === 'tables';
    renderChips();
    updateStamp();
    const content = $('content');
    if (state.loading && !state.loadedAt) { content.innerHTML = emptyMsg('Loading matches…'); return; }
    const html = { live: renderLive, fixtures: renderFixtures, results: renderResults, tables: renderTables }[state.tab]();
    content.innerHTML = errorBanner() + html;
  }

  // ── Match detail ────────────────────────────────────────────────────────
  function findMatch(id) { return allMatches().find(m => String(m.id) === String(id)); }

  function formFor(team, excludeId) {
    return allMatches()
      .filter(m => m.id !== excludeId && phase(m) === 'finished' && parseScore(m) &&
        [m.homeTeam, m.awayTeam].some(t => t && (t.id === team.id)))
      .sort((a, b) => kickoff(b) - kickoff(a)).slice(0, 5)
      .map(m => {
        const s = parseScore(m);
        const home = m.homeTeam.id === team.id;
        const f = home ? s[0] : s[1], a = home ? s[1] : s[0];
        const r = f > a ? 'W' : f < a ? 'L' : 'D';
        const opp = home ? m.awayTeam.name : m.homeTeam.name;
        return `<span class="form form-${r}" title="${esc(`${r} ${f}–${a} ${home ? 'v' : 'at'} ${opp}, ${fDayShort.format(new Date(kickoff(m)))}`)}">${r}</span>`;
      }).join('');
  }

  function predictionHtml(pred, m) {
    const pick = arr => (arr || []).slice().sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt)).pop();
    const p = pick(pred && pred.live) || pick(pred && pred.prematch);
    if (!p || !p.probabilities) return '';
    const n = v => Math.max(0, parseFloat(String(v).replace('%', '')) || 0);
    const h = n(p.probabilities.home), d = n(p.probabilities.draw), a = n(p.probabilities.away);
    const tot = h + d + a || 1;
    const w = x => (x / tot * 100).toFixed(1);
    return `
      <section class="detail-block">
        <h3>${p.type === 'live' ? 'Live' : 'Pre-match'} prediction <small>(Highlightly)</small></h3>
        <div class="pred-bar"><span style="width:${w(h)}%"></span><span style="width:${w(d)}%"></span><span style="width:${w(a)}%"></span></div>
        <div class="pred-labels"><span>${esc(m.homeTeam.name)} ${Math.round(h)}%</span><span>Draw ${Math.round(d)}%</span><span>${esc(m.awayTeam.name)} ${Math.round(a)}%</span></div>
      </section>`;
  }

  function lineupsHtml(l, m) {
    if (!l || !l.home || !l.away) return '';
    const side = (team, x) => {
      const players = (arr) => (arr || []).slice().sort((p, q) => (p.shirtNumber || 99) - (q.shirtNumber || 99))
        .map(p => `<li><b>${esc(p.shirtNumber ?? '')}</b> ${esc(p.name || p.shortName || '')}</li>`).join('');
      return `<div><h4>${esc(team.name)}</h4><ol class="lineup">${players(x.initialLineup)}</ol>
        ${(x.substitutions || []).length ? `<h5>Replacements</h5><ol class="lineup">${players(x.substitutions)}</ol>` : ''}</div>`;
    };
    return `<section class="detail-block"><h3>Line-ups</h3><div class="lineups">${side(m.homeTeam, l.home)}${side(m.awayTeam, l.away)}</div></section>`;
  }

  function factsHtml(d) {
    const facts = [];
    if (d.venue && d.venue.name) facts.push(['Venue', [d.venue.name, d.venue.city].filter(Boolean).join(', ')]);
    if (d.referee && d.referee.name) facts.push(['Referee', d.referee.name + (d.referee.nationality ? ` (${d.referee.nationality})` : '')]);
    if (d.forecast && d.forecast.status) facts.push(['Weather', [d.forecast.status, d.forecast.temperature].filter(Boolean).join(', ')]);
    if (!facts.length) return '';
    return `<section class="detail-block"><dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`;
  }

  function renderMatchSheet(m, detail, extra = '') {
    const ph = phase(m);
    const score = parseScore(m);
    const showScore = score && ph !== 'upcoming' && ph !== 'postponed';
    const when = `${fDayShort.format(new Date(kickoff(m)))} · ${fTime.format(new Date(kickoff(m)))}`;
    const status = ph === 'live' ? `<span class="live-pill"><i></i>${esc(m.state.description)}</span>`
      : isOverdue(m) ? '<span class="tag">Awaiting update</span>'
      : statusTag(m) ? `<span class="tag tag-${ph}">${esc(statusTag(m))}</span>`
      : ph === 'finished' ? '<span class="tag">Full time</span>' : '';
    const formRow = team => {
      const f = formFor(team, m.id);
      return f ? `<div class="form-row"><span>${esc(team.name)}</span><span class="forms">${f}</span></div>` : '';
    };
    const forms = formRow(m.homeTeam) + formRow(m.awayTeam);
    let detailHtml = '';
    if (detail === 'loading') detailHtml = '<p class="muted">Loading match detail…</p>';
    else if (detail && detail.error) detailHtml = `<p class="muted">Couldn't load match detail: ${esc(detail.error)}</p>`;
    else if (detail) {
      const parts = factsHtml(detail) + lineupsHtml(detail.lineups, m) + predictionHtml(detail.predictions, m);
      detailHtml = parts + (detail.lineups ? '' :
        '<p class="muted">Highlightly has no line-ups, scorers or cards for this match.</p>');
    }
    $('matchBody').innerHTML = `
      <p class="sheet-kicker" id="matchTitle">${compLabel(m)}</p>
      <p class="sheet-when">${esc(when)} ${status}</p>
      <div class="scoreboard">
        <div class="sb-team">${crest(m.homeTeam, 'lg')}<span>${esc(m.homeTeam.name)}</span></div>
        <div class="sb-score">${showScore ? `${score[0]}<i>–</i>${score[1]}` : '<small>v</small>'}</div>
        <div class="sb-team">${crest(m.awayTeam, 'lg')}<span>${esc(m.awayTeam.name)}</span></div>
      </div>
      ${matchHighlightsHtml(m)}
      ${forms ? `<section class="detail-block"><h3>Recent form <small>(this season, newest first)</small></h3>${forms}</section>` : ''}
      ${detailHtml}
      <section class="detail-block" id="h2hBlock">${extra || `<button type="button" class="more-btn" data-action="h2h" data-match="${m.id}">Show head-to-head</button>`}</section>`;
  }

  function matchHighlightsHtml(m) {
    const list = highlightsForMatch(m.id);
    if (!list || !list.length) return '';
    return `<section class="detail-block"><h3>Highlights</h3>
      <div class="hl-grid">${sortHighlights(list).map(highlightCard).join('')}</div></section>`;
  }

  async function openMatch(id) {
    const m = findMatch(id);
    if (!m) return;
    openOverlay('matchOverlay');
    renderMatchSheet(m, 'loading');
    // Finished match not covered by the competition lists: ask for its highlights directly.
    if (phase(m) === 'finished' && !highlightsForMatch(m.id)) {
      api('/highlights', { matchId: m.id }).then(({ json }) => {
        state.matchHighlights[m.id] = listOf(json);
        if (state.matchHighlights[m.id].length && !$('matchOverlay').hidden &&
          $('matchBody').querySelector(`[data-match="${m.id}"]`) && lastDetail[m.id]) {
          renderMatchSheet(m, lastDetail[m.id]);
        }
      }).catch(() => {});
    }
    let detail;
    try {
      const { json } = await api('/matches/' + m.id);
      detail = Array.isArray(json) ? json[0] : json; // Highlightly returns an array of one
      if (!detail) detail = { error: 'No detail returned' };
    } catch (e) { detail = { error: e.message }; }
    lastDetail[m.id] = detail;
    if (!$('matchOverlay').hidden && $('matchBody').querySelector(`[data-match="${m.id}"]`)) renderMatchSheet(m, detail);
  }
  const lastDetail = {};

  async function loadH2H(id) {
    const m = findMatch(id);
    const block = $('h2hBlock');
    if (!m || !block) return;
    block.innerHTML = '<p class="muted">Loading head-to-head…</p>';
    try {
      const { json } = await api('/head-2-head', { teamIdOne: m.homeTeam.id, teamIdTwo: m.awayTeam.id });
      const list = listOf(json).filter(x => x.id !== m.id).sort((a, b) => kickoff(b) - kickoff(a));
      if (!list.length) { block.innerHTML = '<h3>Head-to-head</h3><p class="muted">No previous meetings held by Highlightly.</p>'; return; }
      block.innerHTML = '<h3>Head-to-head <small>(last meetings)</small></h3>' + list.map(x => {
        const s = parseScore(x);
        return `<div class="h2h-row"><span class="h2h-date">${esc(fDayShort.format(new Date(kickoff(x))))}</span>
          <span class="h2h-teams">${esc(x.homeTeam.name)} <b>${s ? s[0] + '–' + s[1] : 'v'}</b> ${esc(x.awayTeam.name)}</span>
          <span class="h2h-comp">${esc((x.league && x.league.name) || '')}</span></div>`;
      }).join('');
    } catch (e) {
      block.innerHTML = `<p class="muted">Couldn't load head-to-head: ${esc(e.message)}</p>`;
    }
  }

  // ── Club picker ─────────────────────────────────────────────────────────
  function pickerClubs() {
    const seen = new Map();
    for (const m of state.matches[CFG.clubPickerLeagueId] || []) {
      for (const t of [m.homeTeam, m.awayTeam]) if (t && t.id && !seen.has(t.id)) seen.set(t.id, { id: t.id, name: t.name, logo: t.logo || null });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function renderPicker() {
    const clubs = pickerClubs();
    $('pickGrid').innerHTML = clubs.length ? clubs.map(c => {
      const on = state.followed.some(f => f.id === c.id);
      return `<button type="button" class="pick${on ? ' on' : ''}" data-pick="${c.id}" aria-pressed="${on}">${crest(c)}<span>${esc(c.name)}</span></button>`;
    }).join('') : '<p class="muted">The club list appears once the Premiership fixtures have loaded.</p>';
  }
  function togglePick(id) {
    const club = pickerClubs().find(c => String(c.id) === String(id));
    if (!club) return;
    if (state.followed.some(f => f.id === club.id)) {
      state.followed = state.followed.filter(f => f.id !== club.id);
      if (state.filter === 'club:' + club.id) state.filter = 'mine';
    } else {
      state.followed = [...state.followed, club].sort((a, b) => a.name.localeCompare(b.name));
    }
    store.set('rugby.followedClubs', state.followed);
    renderPicker();
    render();
  }

  // ── Overlays ────────────────────────────────────────────────────────────
  function openOverlay(id) {
    $(id).hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeOverlays() {
    document.querySelectorAll('.overlay').forEach(o => { o.hidden = true; });
    document.body.classList.remove('no-scroll');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlays(); });

  // ── Events ──────────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    const t = e.target.closest('button, .overlay');
    if (!t) return;
    if (t.classList.contains('overlay')) { if (e.target === t) closeOverlays(); return; }
    if (t.dataset.close !== undefined) return closeOverlays();
    if (t.dataset.tab) {
      state.tab = t.dataset.tab;
      store.set('rugby.tab', state.tab);
      history.replaceState(null, '', '#' + state.tab);
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    if (t.dataset.filter) {
      state.filter = t.dataset.filter;
      state.search = '';
      $('search').value = '';
      render();
      return;
    }
    if (t.dataset.table) {
      state.tableComp = Number(t.dataset.table);
      store.set('rugby.tableComp', state.tableComp);
      render();
      return;
    }
    if (t.dataset.pick) return togglePick(t.dataset.pick);
    if (t.dataset.action === 'older') { state.showOlder = true; render(); return; }
    if (t.dataset.action === 'h2h') return loadH2H(t.dataset.match);
    if (t.id === 'pickBtn') { renderPicker(); openOverlay('pickOverlay'); return; }
    if (t.dataset.match && t.classList.contains('match')) return openMatch(t.dataset.match);
  });

  let searchTimer;
  $('search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value.trim(); render(); }, 150);
  });

  // ── Start ───────────────────────────────────────────────────────────────
  const fromHash = location.hash.slice(1);
  state.tab = ['live', 'fixtures', 'results', 'tables'].includes(fromHash) ? fromHash : store.get('rugby.tab', 'live');
  loadAll();

  // Exposed for testing only.
  window.__rugby = { state, phase, bonusColumns, STATUS_GROUPS };
})();
