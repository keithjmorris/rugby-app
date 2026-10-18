// config.js — which competitions the app follows.
// League IDs come from Highlightly's /leagues list (see NOTES.md). Always use IDs, never names.
//
//   kind:   'club' or 'intl'   (international matches are where England is looked for)
//   women:  true for women's competitions
//   table:  true if the competition has a league table worth showing
//   losingBonus: the losing-bonus margin, ONLY where the rules are known to be
//           standard (4 for a win, 2 for a draw, try bonus + losing bonus).
//           Leave it out and the table shows a single BP column instead.

window.RUGBY_CONFIG = {
  pinnedNation: 'England',

  // Clubs a user can choose to follow come from this league's table.
  clubPickerLeagueId: 11847,

  competitions: [
    // English club rugby
    { id: 11847, name: 'Premiership', kind: 'club', table: true, losingBonus: 7 },
    { id: 46738, name: 'Champions Cup', kind: 'club', table: true, losingBonus: 7 },
    { id: 45036, name: 'Challenge Cup', kind: 'club', table: true, losingBonus: 7 },
    { id: 9294, name: 'Premiership Cup', kind: 'club', table: true },

    // Men's internationals (Six Nations has a Grand Slam bonus, so BP total only)
    { id: 44185, name: 'Six Nations', kind: 'intl', table: true },
    { id: 124179, name: 'Nations Championship', kind: 'intl', table: true },
    { id: 72268, name: 'Internationals', kind: 'intl', table: false },
    { id: 59503, name: 'World Cup', kind: 'intl', table: true },

    // Women's internationals
    { id: 47589, name: "Women's Six Nations", kind: 'intl', women: true, table: true },
    { id: 120775, name: 'WXV 1', kind: 'intl', women: true, table: true },
    { id: 83331, name: "Women's Internationals", kind: 'intl', women: true, table: false },
    { id: 60354, name: "Women's World Cup", kind: 'intl', women: true, table: true },
  ],
};
