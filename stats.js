// Player statistics: aggregation (pure functions), local storage backend, and an
// optional Firebase backend (Google sign-in + Firestore) for a real profile that
// follows the player across devices.

const LS_STATS = "panoguru.stats";
const FIREBASE_VERSION = "10.14.1";

// ---------- aggregation ----------
export function emptyStats() {
  return { v: 1, games: 0, rounds: 0, totalPoints: 0, totalKm: 0, best: 0, perfect: 0, countries: {}, continents: {}, recent: [] };
}

/** Fold one finished game into the stats object (returns the same object, mutated). */
export function applyGame(stats, game) {
  stats.games += 1;
  stats.best = Math.max(stats.best || 0, game.total);
  for (const r of game.rounds) {
    stats.rounds += 1;
    stats.totalPoints += r.points;
    stats.totalKm += r.km;
    if (r.points >= 4999) stats.perfect += 1;
    if (r.countryCode) {
      const c = (stats.countries[r.countryCode] ||= { n: r.country, rounds: 0, points: 0, km: 0 });
      c.rounds += 1; c.points += r.points; c.km += r.km;
    }
    if (r.continent) {
      const k = (stats.continents[r.continent] ||= { rounds: 0, points: 0, km: 0 });
      k.rounds += 1; k.points += r.points; k.km += r.km;
    }
  }
  stats.recent = [{ at: game.at, total: game.total, places: game.rounds.map((r) => r.country).filter(Boolean) }, ...(stats.recent || [])].slice(0, 12);
  return stats;
}

/** Derived numbers for the profile screen. */
export function summarize(stats) {
  const avgGame = stats.games ? stats.totalPoints / stats.games : 0;
  const avgRound = stats.rounds ? stats.totalPoints / stats.rounds : 0;
  const avgKm = stats.rounds ? stats.totalKm / stats.rounds : 0;
  const countries = Object.entries(stats.countries || {}).map(([code, c]) => ({ code, name: c.n, rounds: c.rounds, avg: c.points / c.rounds, avgKm: c.km / c.rounds }));
  const eligible = countries.filter((c) => c.rounds >= 2);
  const strongest = [...eligible].sort((a, b) => b.avg - a.avg).slice(0, 5);
  const weakest = [...eligible].sort((a, b) => a.avg - b.avg).slice(0, 5);
  const continents = Object.entries(stats.continents || {}).map(([name, k]) => ({ name, rounds: k.rounds, avg: k.points / k.rounds, avgKm: k.km / k.rounds })).sort((a, b) => b.avg - a.avg);
  const level = avgRound >= 4000 ? "World master" : avgRound >= 3000 ? "Globetrotter" : avgRound >= 2000 ? "Explorer" : avgRound >= 1000 ? "Traveller" : "Rookie";
  return { avgGame, avgRound, avgKm, strongest, weakest, continents, countriesSeen: countries.length, level };
}

// ---------- local backend ----------
export function loadLocal() {
  try { const raw = localStorage.getItem(LS_STATS); return raw ? { ...emptyStats(), ...JSON.parse(raw) } : emptyStats(); } catch { return emptyStats(); }
}
export function saveLocal(stats) {
  try { localStorage.setItem(LS_STATS, JSON.stringify(stats)); } catch { /* private mode etc. */ }
}

// ---------- Firebase backend (optional) ----------
export function createCloud(firebaseConfig) {
  if (!firebaseConfig || !firebaseConfig.apiKey) return null;
  let app = null, auth = null, db = null, mods = null, user = null;
  const listeners = new Set();

  async function load() {
    if (mods) return mods;
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
    ]);
    mods = { ...appMod, ...authMod, ...fsMod };
    app = mods.initializeApp(firebaseConfig);
    auth = mods.getAuth(app);
    db = mods.getFirestore(app);
    mods.onAuthStateChanged(auth, (u) => { user = u; for (const cb of listeners) cb(u); });
    return mods;
  }

  function onUser(cb) { listeners.add(cb); if (mods) cb(user); }
  function currentUser() { return user; }

  async function signIn() {
    await load();
    const provider = new mods.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await mods.signInWithPopup(auth, provider);
  }
  async function signOut() { await load(); await mods.signOut(auth); }

  async function loadStats(uid) {
    await load();
    const snap = await mods.getDoc(mods.doc(db, "users", uid));
    return snap.exists() && snap.data().stats ? { ...emptyStats(), ...snap.data().stats } : null;
  }

  /** Save the aggregated stats (and the game itself) for the signed-in user. */
  async function saveGame(uid, profile, stats, game) {
    await load();
    const userRef = mods.doc(db, "users", uid);
    await mods.setDoc(userRef, { name: profile.name || "", photo: profile.photo || "", stats, updatedAt: mods.serverTimestamp() }, { merge: true });
    if (game) await mods.addDoc(mods.collection(db, "users", uid, "games"), { ...game, createdAt: mods.serverTimestamp() });
  }

  async function saveStats(uid, profile, stats) { return saveGame(uid, profile, stats, null); }

  return { load, onUser, currentUser, signIn, signOut, loadStats, saveGame, saveStats };
}
