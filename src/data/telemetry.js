// Usage statistics: pure settings (importable in node), read by src/core/telemetry.js.
//
// Everything goes through Vercel Web Analytics (free plan: page views only, no custom events; 50,000 per month
// SHARED with the account's other projects, collection suspended beyond that; one month of history):
//   - the real page view "/" on load: visits, countries, devices, referrers;
//   - game milestones sent as virtual pages "/jeu/…" (window.va('pageview')), each at most once per session,
//     `maxMarks` per session: Pages tab of the Vercel dashboard. List: PATHS below.
// Vercel's script (/_vercel/insights/script.js, served by the deployment) is injected on *.vercel.app and on the
// custom production domain (tides-of-fortune.fr) only.
//
// Never anything: in dev (npm run dev), under automation (navigator.webdriver), in ?shot= showcases, with
// ?telemetry=0, Do Not Track or Global Privacy Control, or when the player turns off Options → “Statistics”.
// ?telemetry=debug: milestones go to window.__telemetry.log, nothing is sent (tests, local checks).
export const TELEMETRY = {
  vercelHost: /\.vercel\.app$|(^|\.)tides-of-fortune\.fr$/,   // production (.vercel.app, previews, or the custom domain)
  vercelScript: '/_vercel/insights/script.js',
  vercel: true,                                  // false = nothing at all
  maxMarks: 14,                                  // virtual pages per session (shared quota: stay frugal)
  fluidityS: 180,                                // seconds at sea before the smoothness measurement (once)
  sessionMin: [15, 30, 60],                      // session-length milestones (minutes with the tab visible)
  logMax: 300,                                   // debug-mode log
  hitchMs: 100,                                  // a "hitch" frame
  slowMs: 34,                                    // frame below 30 fps
};

// Virtual pages (all under /jeu/). The first-game path is numbered so it sorts in Vercel's list.
export const PATHS = {
  loaded: b => `/jeu/chargement/${b}`,                      // menu shown; b = duration bracket (loadBucket)
  bootFail: '/jeu/echec-chargement',
  newGame: '/jeu/parcours/1-nouvelle-partie',
  mode: m => `/jeu/mode/${m}`,                              // classique | assistance
  resumed: '/jeu/partie-reprise',
  // goal steps (state.tutorials.goals.step): entering a step = the previous one is cleared
  step: {
    'p-sail': '/jeu/parcours/2-prologue-commence',
    visit: { 'p-strike': '/jeu/parcours/3-prologue-gagne', 'p-board': '/jeu/parcours/3-prologue-gagne', offer: '/jeu/parcours/3-prologue-passe', other: '/jeu/parcours/3-prologue-quitte' },
    accept: '/jeu/parcours/4-gouverneur-vu',
    mission: '/jeu/parcours/5-mission-acceptee',
    rank: '/jeu/parcours/6-mission-reussie',
    done: '/jeu/parcours/7-premier-grade',
  },
  missionFailed: '/jeu/mission/echouee',
  promote: '/jeu/promotion',
  capture: '/jeu/prise',
  duel: w => `/jeu/duel/${w}`,                              // gagne | perdu
  defeat: k => `/jeu/defaite/${k}`,                         // naufrage | prison | abandon
  retire: '/jeu/retraite',
  fluidity: (q, b) => `/jeu/fluidite/${q}/${b}`,            // bas | moyen | eleve | ultra, bracket of the median fps at sea
  session: m => `/jeu/session/${m}min`,
  error: '/jeu/erreur',
};

export function loadBucket(s) { return s < 10 ? 'moins-de-10s' : s < 20 ? '10-20s' : s < 40 ? '20-40s' : 'plus-de-40s'; }
export function fpsBucket(fps) { return fps >= 55 ? '55fps-et-plus' : fps >= 45 ? '45-55fps' : fps >= 30 ? '30-45fps' : 'moins-de-30fps'; }
