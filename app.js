// PanoGuru game controller.
import { haversineKm, scoreForDistance, formatDistance, formatPoints, weightedPick, randomPointInCountry, countryAt } from "./geo.js?v=14";
import { createGoogleProvider } from "./google-provider.js?v=14";
import { createMockProvider } from "./mock-provider.js?v=14";
import { emptyStats, applyGame, summarize, loadLocal, saveLocal, createCloud } from "./stats.js?v=14";

const CFG = Object.assign({
  appName: "PanoGuru", tagline: "Guess the World", googleMapsApiKey: "",
  rounds: 5, maxScorePerRound: 5000, scoreScaleKm: 1492.7,
  triesPerCountry: 6, maxCountriesPerRound: 8, repoUrl: "#",
}, window.PANOGURU_CONFIG || {});

const LS_KEY = "panoguru.apiKey";
const LS_BEST = "panoguru.best";
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const ui = {
  pano: $("pano"), panoWrap: $("pano-wrap"), mapWrap: $("map-wrap"), map: $("map"), mapTap: $("map-tap"), mapClose: $("map-close"), guess: $("btn-guess"), mapHint: $("map-hint"), openMap: $("btn-open-map"), compassRose: $("compass-rose"),
  screens: { menu: $("screen-menu"), setup: $("screen-setup"), game: $("screen-game"), result: $("screen-result"), final: $("screen-final"), profile: $("screen-profile") },
  play: $("btn-play"), best: $("best-score"), bestLine: $("best-line"), linkKey: $("link-key"),
  apiKey: $("api-key"), saveKey: $("btn-save-key"), mock: $("btn-mock"), setupBack: $("btn-setup-back"),
  hudRound: $("hud-round"), hudRounds: $("hud-rounds"), hudScore: $("hud-score"), ret: $("btn-return"), hudProfile: $("btn-hud-profile"), hudAvatar: $("hud-avatar"), hudProfileIcon: $("hud-profile-icon"),
  resDistance: $("res-distance"), resPoints: $("res-points"), resCountry: $("res-country"), next: $("btn-next"),
  viewPlace: $("btn-view-place"), peekBar: $("peek-bar"), peekBack: $("btn-peek-back"), peekNext: $("btn-peek-next"),
  finalScore: $("final-score"), finalMax: $("final-max"), finalRounds: $("final-rounds"), again: $("btn-again"), share: $("btn-share"),
  loading: $("loading"), loadingText: $("loading-text"), toast: $("toast"),
  profileBtn: $("btn-profile"), signIn: $("btn-signin"), signOut: $("btn-signout"), userChip: $("user-chip"), userPhoto: $("user-photo"), userName: $("user-name"),
  profileBack: $("btn-profile-back"), profileSignIn: $("btn-profile-signin"), profilePhoto: $("profile-photo"), profileName: $("profile-name"), profileSub: $("profile-sub"),
  st: { games: $("st-games"), best: $("st-best"), avg: $("st-avg"), avgkm: $("st-avgkm"), level: $("st-level"), countries: $("st-countries"), empty: $("st-empty"),
        strong: $("st-strong"), weak: $("st-weak"), continents: $("st-continents"), recent: $("st-recent") },
};

const state = {
  provider: null, mock: params.get("mock") === "1", countries: [],
  round: 0, total: 0, rounds: [], current: null, next: null, guess: null, busy: false,
  stats: emptyStats(), cloud: null, user: null, places: {},
};

// ---------- small UI helpers ----------
function setCompass(heading) {
  // Rotate the rose so that its N points towards true north relative to the view direction (up = where you look).
  if (Number.isFinite(heading)) ui.compassRose.style.transform = `rotate(${-heading}deg)`;
}
function showScreen(name) {
  for (const [k, el] of Object.entries(ui.screens)) el.classList.toggle("hidden", k !== name);
}
function setLoading(on, text) {
  if (text) ui.loadingText.textContent = text;
  ui.loading.classList.toggle("hidden", !on);
}
let toastTimer = null;
function toast(msg, kind = "error", ms = 5000) {
  ui.toast.textContent = msg;
  ui.toast.className = `toast ${kind === "info" ? "info" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), ms);
}
function setMapMode(mode) {
  ui.mapWrap.classList.remove("hidden", "mini", "mini-hidden", "expanded", "result", "final");
  const buttonStyle = (CFG.miniMap || "button") === "button";
  ui.mapWrap.classList.add(mode === "mini" && buttonStyle ? "mini-hidden" : mode);
  ui.openMap.classList.toggle("hidden", !(mode === "mini" && buttonStyle));
  ui.openMap.innerHTML = state.guess ? "&#x1F5FA;&#xFE0F; Map &middot; pin placed" : "&#x1F5FA;&#xFE0F; Open map";
  ui.mapClose.textContent = mode === "expanded" ? "\u2715" : "\u26F6";
  ui.mapClose.setAttribute("aria-label", mode === "expanded" ? "Shrink map" : "Enlarge map");
  ui.mapClose.title = mode === "expanded" ? "Shrink map (Esc)" : "Enlarge map";
  setTimeout(() => state.provider?.resize(), 220);
}
function storage(get, key, value) {
  try { return get ? localStorage.getItem(key) : localStorage.setItem(key, value); } catch { return null; }
}

// ---------- provider ----------
async function ensureProvider() {
  if (state.provider) return true;
  if (state.mock) {
    state.provider = createMockProvider({ countries: state.countries, onPov: setCompass });
    return true;
  }
  const key = CFG.googleMapsApiKey || storage(true, LS_KEY) || "";
  if (!key) { showScreen("setup"); return false; }
  state.provider = createGoogleProvider(key, {
    onPov: setCompass,
    onPanoStatus: (status, panoId, { recovered } = {}) => {
      if (recovered) { toast("That spot did not load, went back one step.", "info", 3000); return; }
      // The round's first panorama could not be displayed: report and move to another place (max 3 times per round).
      state.panoRetries = (state.panoRetries || 0) + 1;
      toast(`Street View could not load this place (${status}). ${state.panoRetries <= 3 ? "Trying another…" : ""}`, "info", 5000);
      if (state.panoRetries <= 3 && !ui.screens.game.classList.contains("hidden")) {
        state.round -= 1; // redo this round number with a new location
        prefetchNext();
        nextRound();
      }
    },
    onAuthError: () => {
      state.provider = null;
      setLoading(false);
      setMapMode("hidden");
      toast("Google rejected this API key (check key, Maps JavaScript API enabled, website restriction).", "error", 9000);
      if (!CFG.googleMapsApiKey) { try { localStorage.removeItem(LS_KEY); } catch {} }
      showScreen("setup");
    },
  });
  setLoading(true, "Loading Google Maps…");
  try {
    await state.provider.load();
  } catch (err) {
    console.error(err);
    state.provider = null;
    setLoading(false);
    toast("Could not load Google Maps. Check your internet connection and API key.");
    showScreen("menu");
    return false;
  }
  return true;
}

// ---------- locations ----------
// Well-covered fallback spots (city centres) used only if random sampling keeps failing.
const SAFE_SPOTS = [
  [40.758, -73.9855], [51.508, -0.128], [48.8698, 2.3078], [40.4203, -3.7058], [42.8782, -8.5448], [41.9028, 12.4964],
  [52.5163, 13.3777], [35.6595, 139.7005], [-33.8688, 151.2093], [-23.5505, -46.6333], [19.4326, -99.1332], [43.6532, -79.3832],
  [-26.2041, 28.0473], [13.7563, 100.5018], [1.2903, 103.852], [37.5665, 126.978], [25.033, 121.5654], [13.0827, 80.2707],
  [12.9716, 77.5946], [41.0082, 28.9784], [55.7558, 37.6173], [-34.6037, -58.3816], [-33.4489, -70.6693], [-12.0464, -77.0428],
  [4.711, -74.0721], [-6.2088, 106.8456], [3.139, 101.6869], [14.5995, 120.9842], [-36.8485, 174.7633], [64.1466, -21.9426],
  [38.7223, -9.1393], [37.9838, 23.7275], [52.2297, 21.0122], [59.3293, 18.0686], [25.2048, 55.2708], [-1.2921, 36.8219],
  [5.6037, -0.187], [32.0853, 34.7818], [47.8864, 106.9057], [61.2181, -149.9003],
];

function buildLocation(found, country) {
  const actual = countryAt(state.countries, found.lat, found.lng) || country;
  const countryName = actual?.n || "";
  // Street View's own description (street / town / region), plus the country if it is not already mentioned.
  const desc = (found.description || "").trim();
  const place = desc && countryName && !desc.toLowerCase().includes(countryName.toLowerCase()) ? `${desc}, ${countryName}` : (desc || countryName);
  return { panoId: found.panoId, lat: found.lat, lng: found.lng, country: countryName, countryCode: actual?.c || "", continent: actual?.ct || "", place, heading: Math.floor(Math.random() * 360) };
}

/**
 * Choose where the next round starts.
 *  - "town" candidates: a random spot within a few km of a real town/village (more clues, easier);
 *  - "wild" candidates: a uniformly random point in the country (harder, remote roads).
 *  Early rounds lean towards towns, late rounds towards the wild.
 *  Variety: no country twice in a game, at most two rounds per continent.
 */
function townShare(roundNumber) {
  const r = Math.max(1, roundNumber);
  if (CFG.townShare != null) return CFG.townShare;
  return r <= 2 ? 0.85 : r === 3 ? 0.6 : 0.4;
}
function pickCountryForGame(countries, used) {
  for (let i = 0; i < 12; i++) {
    const c = weightedPick(countries, "w");
    if (used.countries.has(c.c)) continue;
    if ((used.continents.get(c.ct) || 0) >= 2) continue;
    return c;
  }
  return weightedPick(countries, "w");
}
function usedSoFar() {
  const used = { countries: new Set(), continents: new Map() };
  const seen = [...state.rounds.map((r) => ({ c: r.countryCode, ct: r.continent })), state.current ? { c: state.current.countryCode, ct: state.current.continent } : null].filter(Boolean);
  for (const x of seen) { if (x.c) used.countries.add(x.c); if (x.ct) used.continents.set(x.ct, (used.continents.get(x.ct) || 0) + 1); }
  return used;
}
function pointNearTown(country) {
  const list = state.places?.[country.c];
  if (!list || !list.length) return null;
  const town = weightedPick(list.map(([lat, lng, w]) => ({ lat, lng, w })), "w");
  // uniform point in a disk of radius R km around the town centre
  const R = CFG.townRadiusKm || 6;
  const d = R * Math.sqrt(Math.random()), a = Math.random() * 2 * Math.PI;
  const lat = town.lat + (d * Math.cos(a)) / 111;
  const lng = town.lng + (d * Math.sin(a)) / (111 * Math.cos((town.lat * Math.PI) / 180) || 1);
  return { lat, lng };
}

async function findLocation(onProgress, forRound = state.round + 1) {
  const countries = state.countries;
  const parallel = CFG.parallelSearches || 3;
  const deadline = Date.now() + (CFG.searchTimeoutMs || 25000);
  const used = usedSoFar();
  const pTown = townShare(forRound);
  let attempts = 0;
  const statuses = {};
  while (Date.now() < deadline && attempts < (CFG.maxAttempts || 45)) {
    if (!state.provider) throw new Error("Map provider unavailable (API key rejected?)");
    const batch = [];
    for (let i = 0; i < parallel; i++) {
      const country = pickCountryForGame(countries, used);
      const town = Math.random() < pTown ? pointNearTown(country) : null;
      const pt = town || randomPointInCountry(country);
      const radiusKm = town ? Math.min(country.km, CFG.townSearchKm || 10) : country.km;
      const strict = attempts % 2 === 0; // alternate: official-only search, then any outdoor imagery
      attempts++;
      batch.push(state.provider.findPanorama(pt, radiusKm, { strict }).then((r) => ({ r, country, town: !!town })));
    }
    const results = await Promise.all(batch);
    for (const { r, country, town } of results) {
      if (r?.status === "OK") { const loc = buildLocation(r, country); loc.kind = town ? "town" : "wild"; return loc; }
      const s = r?.status || "NONE";
      statuses[s] = (statuses[s] || 0) + 1;
    }
    console.info(`[panoguru] search: ${attempts} tries, statuses ${JSON.stringify(statuses)}`);
    onProgress?.(attempts, statuses);
  }
  // Fallback so the game never hangs: a random well-covered city.
  const [lat, lng] = SAFE_SPOTS[Math.floor(Math.random() * SAFE_SPOTS.length)];
  const r = await state.provider.findPanorama({ lat, lng }, 3, { strict: false });
  if (r?.status === "OK") return buildLocation(r, null);
  throw new Error(`No Street View found (${attempts} tries, statuses ${JSON.stringify(statuses)}, fallback ${r?.status})`);
}
function searchProgress(attempts, statuses) {
  if (ui.loading.classList.contains("hidden")) return;
  const detail = Object.entries(statuses).map(([k, v]) => `${k} ×${v}`).join(", ");
  ui.loadingText.textContent = `Finding a place… (${attempts} tries${detail ? ": " + detail : ""})`;
}
function prefetchNext() {
  state.next = findLocation(searchProgress).catch((err) => { console.warn(err); state.lastError = String(err?.message || err); return null; });
}

// ---------- game flow ----------
async function startGame() {
  if (state.busy) return;
  state.busy = true;
  try {
    if (!(await ensureProvider())) return;
    state.round = 0; state.total = 0; state.rounds = []; state.guess = null;
    ui.hudRounds.textContent = CFG.rounds;
    ui.hudScore.textContent = "0";
    setMapMode("mini");
    state.provider.createMap(ui.map, { onClick: onMapClick });
    state.provider.clearOverlays();
    setLoading(true, "Finding a place…");
    prefetchNext();
    await nextRound();
  } finally {
    state.busy = false;
  }
}

async function nextRound() {
  setLoading(true, "Finding a place…");
  let loc = await state.next;
  if (!loc) {
    try { loc = await findLocation(searchProgress); } catch (err) { console.error(err); state.lastError = String(err?.message || err); }
  }
  if (!state.provider) { setLoading(false); return; } // key was rejected meanwhile; setup screen is showing
  if (!loc) {
    setLoading(false);
    toast(`Could not find a Street View location. ${state.lastError || ""}`.trim(), "error", 12000);
    showScreen("menu");
    setMapMode("hidden");
    return;
  }
  state.current = loc;
  state.round += 1;
  state.guess = null;
  state.panoRetries = 0;
  console.info(`[panoguru] round ${state.round}: pano ${loc.panoId} in ${loc.country || "?"} (${loc.kind || "fallback"})`);
  if (state.round < CFG.rounds) prefetchNext(); else state.next = null;

  ui.peekBar.classList.add("hidden");
  ui.panoWrap.classList.remove("hidden", "invisible");
  state.provider.showPanorama(ui.pano, { panoId: loc.panoId, heading: loc.heading });
  setCompass(loc.heading);
  state.provider.clearOverlays();
  state.provider.resetView();
  ui.guess.disabled = true;
  ui.guess.textContent = "Place your pin";
  ui.mapHint.classList.remove("hidden");
  state.provider.setGuessMode?.(true);
  ui.hudRound.textContent = state.round;
  setMapMode("mini");
  showScreen("game");
  setLoading(false);
}

function onMapClick(point) {
  if (!ui.screens.game.classList.contains("hidden") && !ui.mapWrap.classList.contains("mini")) {
    state.guess = point;
    state.provider.setGuess(point);
    ui.guess.disabled = false;
    ui.guess.textContent = "Guess";
    ui.mapHint.classList.add("hidden");
    ui.openMap.innerHTML = "&#x1F5FA;&#xFE0F; Map &middot; pin placed";
  }
}

function submitGuess() {
  if (!state.guess || !state.current || state.busy) return;
  const answer = { lat: state.current.lat, lng: state.current.lng };
  const km = haversineKm(state.guess, answer);
  const points = scoreForDistance(km, CFG);
  state.total += points;
  const roundInfo = { guess: state.guess, answer, km, points, country: state.current.country, countryCode: state.current.countryCode, continent: state.current.continent, place: state.current.place || state.current.country };
  state.rounds.push(roundInfo);
  ui.hudScore.textContent = formatPoints(state.total);
  ui.resDistance.textContent = formatDistance(km);
  ui.resPoints.textContent = formatPoints(points);
  ui.resCountry.textContent = roundInfo.place ? `It was in ${roundInfo.place}` : "";
  if (CFG.useGeocoder && state.provider.placeName) {
    // Upgrade to "Town, Region, Country" when the Geocoding API is available (async, non-blocking).
    state.provider.placeName(answer).then((name) => {
      if (name && state.rounds[state.rounds.length - 1] === roundInfo) { roundInfo.place = name; ui.resCountry.textContent = `It was in ${name}`; }
    });
  }
  ui.next.textContent = state.round >= CFG.rounds ? "See results" : "Next round";
  ui.panoWrap.classList.add("invisible");
  ui.openMap.classList.add("hidden");
  state.provider.setGuessMode?.(false);
  setMapMode("result");
  state.provider.showResult([{ guess: state.guess, answer }]);
  showScreen("result");
}

function showFinal() {
  ui.peekBar.classList.add("hidden");
  ui.panoWrap.classList.add("invisible");
  ui.finalScore.textContent = formatPoints(state.total);
  ui.finalMax.textContent = formatPoints(CFG.rounds * CFG.maxScorePerRound);
  ui.finalRounds.innerHTML = state.rounds.map((r, i) =>
    `<li><span>Round ${i + 1} · ${escapeHtml(r.place || r.country || "?")}</span><span class="muted">${formatDistance(r.km)}</span><span>${formatPoints(r.points)}</span></li>`
  ).join("");
  const best = Number(storage(true, LS_BEST) || 0);
  if (state.total > best) { storage(false, LS_BEST, String(state.total)); }
  updateBest();
  recordGame();
  setMapMode("final");
  state.provider.showResult(state.rounds.map((r) => ({ guess: r.guess, answer: r.answer })));
  showScreen("final");
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function updateBest() {
  const best = Number(storage(true, LS_BEST) || 0);
  ui.bestLine.classList.toggle("hidden", !best);
  ui.best.textContent = formatPoints(best);
}

function backToMenu() {
  ui.openMap.classList.add("hidden");
  ui.panoWrap.classList.add("invisible");
  setMapMode("hidden");
  showScreen("menu");
}

async function share() {
  const text = `I scored ${formatPoints(state.total)} / ${formatPoints(CFG.rounds * CFG.maxScorePerRound)} in ${CFG.appName}: ${CFG.tagline}! ${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("Result copied to clipboard", "info", 2500); }
  } catch { /* user cancelled */ }
}

// ---------- look at the place again (between guess and next round) ----------
function peekPlace() {
  const last = state.rounds[state.rounds.length - 1];
  if (!last) return;
  ui.screens.result.classList.add("hidden");
  setMapMode("hidden");
  ui.panoWrap.classList.remove("hidden", "invisible");
  state.provider.returnToStart();
  state.provider.refreshView?.();
  ui.peekNext.textContent = state.round >= CFG.rounds ? "See results \u2192" : "Next round \u2192";
  ui.peekBar.classList.remove("hidden");
}
function peekBack() {
  const last = state.rounds[state.rounds.length - 1];
  ui.peekBar.classList.add("hidden");
  ui.panoWrap.classList.add("invisible");
  setMapMode("result");
  if (last) state.provider.showResult([{ guess: last.guess, answer: last.answer }]);
  ui.screens.result.classList.remove("hidden");
}
function peekNext() {
  ui.peekBar.classList.add("hidden");
  if (state.round >= CFG.rounds) showFinal(); else nextRound();
}

// ---------- stats & accounts ----------
function recordGame() {
  const game = {
    at: Date.now(), total: state.total,
    rounds: state.rounds.map((r) => ({ country: r.country, countryCode: r.countryCode, continent: r.continent, km: Math.round(r.km * 10) / 10, points: r.points, place: r.place || "" })),
  };
  applyGame(state.stats, game);
  saveLocal(state.stats);
  if (state.cloud && state.user) {
    state.cloud.saveGame(state.user.uid, { name: state.user.displayName, photo: state.user.photoURL }, state.stats, game)
      .catch((err) => { console.warn(err); toast("Could not save the game to your profile (offline?).", "error", 4000); });
  }
}

function renderProfile() {
  const st = state.stats, sum = summarize(st);
  const signedIn = !!state.user;
  ui.profilePhoto.classList.toggle("hidden", !signedIn || !state.user.photoURL);
  if (signedIn && state.user.photoURL) ui.profilePhoto.src = state.user.photoURL;
  ui.profileName.textContent = signedIn ? (state.user.displayName || "Player") : "Your stats";
  ui.profileSub.textContent = signedIn ? "Saved to your Google account, available on every device" : (state.cloud ? "Stored on this device only. Sign in to keep them everywhere." : "Stored on this device only");
  ui.profileSignIn.classList.toggle("hidden", signedIn || !state.cloud);
  ui.st.games.textContent = st.games;
  ui.st.best.textContent = formatPoints(st.best || 0);
  ui.st.avg.textContent = formatPoints(sum.avgGame);
  ui.st.avgkm.textContent = st.rounds ? formatDistance(sum.avgKm) : "–";
  ui.st.level.textContent = sum.level;
  ui.st.countries.textContent = sum.countriesSeen;
  ui.st.empty.classList.toggle("hidden", st.games > 0);
  const li = (label, sub, value, pct) => `<li><span>${escapeHtml(label)}${sub ? ` <span class="sub">${escapeHtml(sub)}</span>` : ""}${pct != null ? `<div class="bar" style="width:${Math.max(4, Math.round(pct))}%"></div>` : ""}</span><span>${value}</span></li>`;
  ui.st.strong.innerHTML = sum.strongest.map((c) => li(c.name, `${c.rounds} rounds`, formatPoints(c.avg), c.avg / 50)).join("");
  ui.st.weak.innerHTML = sum.weakest.map((c) => li(c.name, `${c.rounds} rounds · ${formatDistance(c.avgKm)} off`, formatPoints(c.avg), c.avg / 50)).join("");
  ui.st.continents.innerHTML = sum.continents.map((k) => li(k.name, `${k.rounds} rounds · ${formatDistance(k.avgKm)} off`, formatPoints(k.avg) + " avg", k.avg / 50)).join("");
  ui.st.recent.innerHTML = (st.recent || []).map((g) => li(new Date(g.at).toLocaleDateString(), (g.places || []).slice(0, 5).join(", "), formatPoints(g.total))).join("");
}

function showProfile() {
  state.profileReturn = ui.screens.game.classList.contains("hidden") ? "menu" : "game";
  renderProfile();
  ui.openMap.classList.add("hidden");
  showScreen("profile");
}
function closeProfile() {
  if (state.profileReturn === "game") {
    showScreen("game");
    ui.openMap.classList.toggle("hidden", !ui.mapWrap.classList.contains("mini-hidden"));
  } else {
    showScreen("menu");
  }
}

function applyUser(user) {
  state.user = user || null;
  ui.signIn.classList.toggle("hidden", !state.cloud || !!user);
  ui.userChip.classList.toggle("hidden", !user);
  ui.hudAvatar.classList.toggle("hidden", !(user && user.photoURL));
  ui.hudProfileIcon.classList.toggle("hidden", !!(user && user.photoURL));
  if (user && user.photoURL) ui.hudAvatar.src = user.photoURL;
  if (user) {
    ui.userName.textContent = user.displayName || user.email || "Signed in";
    if (user.photoURL) { ui.userPhoto.src = user.photoURL; ui.userPhoto.classList.remove("hidden"); } else ui.userPhoto.classList.add("hidden");
    state.cloud.loadStats(user.uid).then((cloudStats) => {
      if (cloudStats) {
        state.stats = cloudStats;
      } else if (state.stats.games > 0) {
        // first sign-in on a device that already has local games: keep them
        state.cloud.saveStats(user.uid, { name: user.displayName, photo: user.photoURL }, state.stats).catch(console.warn);
      }
      saveLocal(state.stats);
      updateBest();
      if (!ui.screens.profile.classList.contains("hidden")) renderProfile();
    }).catch((err) => { console.warn(err); toast("Could not load your profile. Check the Firestore rules (see README).", "error", 6000); });
  } else {
    state.stats = loadLocal();
  }
}

async function doSignIn() {
  if (!state.cloud) return;
  try { await state.cloud.signIn(); toast("Signed in", "info", 2000); }
  catch (err) {
    console.warn(err);
    const code = err?.code || "";
    toast(code.includes("popup-closed") ? "Sign-in cancelled." : `Sign-in failed (${code || err?.message || err}). Is guruprakashmp.github.io an authorized domain in Firebase?`, "error", 8000);
  }
}
async function doSignOut() { try { await state.cloud?.signOut(); toast("Signed out", "info", 2000); } catch (err) { console.warn(err); } }

// ---------- events ----------
function bind() {
  ui.play.addEventListener("click", startGame);
  ui.again.addEventListener("click", startGame);
  ui.guess.addEventListener("click", submitGuess);
  ui.next.addEventListener("click", () => (state.round >= CFG.rounds ? showFinal() : nextRound()));
  ui.viewPlace.addEventListener("click", peekPlace);
  ui.peekBack.addEventListener("click", peekBack);
  ui.peekNext.addEventListener("click", peekNext);
  ui.ret.addEventListener("click", () => state.provider?.returnToStart());
  ui.share.addEventListener("click", share);
  ui.profileBtn.addEventListener("click", showProfile);
  ui.profileBack.addEventListener("click", closeProfile);
  ui.hudProfile.addEventListener("click", showProfile);
  ui.signIn.addEventListener("click", doSignIn);
  ui.profileSignIn.addEventListener("click", doSignIn);
  ui.signOut.addEventListener("click", doSignOut);
  // The small map is a thumbnail: click/tap it to open the big map, place the pin there, Guess. The corner button shrinks it again.
  ui.mapTap.addEventListener("click", () => setMapMode("expanded"));
  ui.openMap.addEventListener("click", () => setMapMode("expanded"));
  ui.mapClose.addEventListener("click", () => setMapMode(ui.mapWrap.classList.contains("expanded") ? "mini" : "expanded"));
  ui.saveKey.addEventListener("click", () => {
    const key = ui.apiKey.value.trim();
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(key)) { toast("That does not look like a Google Maps API key (starts with AIza)."); return; }
    storage(false, LS_KEY, key);
    state.mock = false;
    startGame();
  });
  ui.mock.addEventListener("click", () => { state.mock = true; state.provider = null; startGame(); });
  ui.setupBack.addEventListener("click", () => showScreen("menu"));
  ui.linkKey.addEventListener("click", (e) => { e.preventDefault(); ui.apiKey.value = storage(true, LS_KEY) || ""; showScreen("setup"); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !ui.screens.game.classList.contains("hidden") && state.guess) submitGuess();
    if (e.key === "Escape" && ui.mapWrap.classList.contains("expanded")) setMapMode("mini");
    if ((e.key === "r" || e.key === "R") && !ui.screens.game.classList.contains("hidden") && !e.ctrlKey && !e.metaKey) state.provider?.refreshView?.();
  });
  window.addEventListener("resize", () => state.provider?.resize());
  window.addEventListener("beforeunload", () => {}); // no-op placeholder for future autosave
}

async function init() {
  document.querySelectorAll("[data-app-name]").forEach((el) => (el.textContent = CFG.appName));
  document.querySelectorAll("[data-tagline]").forEach((el) => (el.textContent = CFG.tagline));
  document.querySelectorAll("[data-repo-link]").forEach((el) => (el.href = CFG.repoUrl));
  document.title = `${CFG.appName}: ${CFG.tagline}`;
  ui.linkKey.classList.toggle("hidden", !!CFG.googleMapsApiKey);
  updateBest();
  bind();
  state.stats = loadLocal();
  state.cloud = createCloud(CFG.firebase);
  ui.signIn.classList.toggle("hidden", !state.cloud);
  if (state.cloud) {
    state.cloud.load().then(() => state.cloud.onUser(applyUser)).catch((err) => { console.warn("Firebase unavailable", err); ui.signIn.classList.add("hidden"); });
  }
  try {
    const [cRes, pRes] = await Promise.all([fetch("countries.json"), fetch("places.json")]);
    state.countries = (await cRes.json()).countries;
    state.places = (await pRes.json()).places;
  } catch (err) {
    console.error(err);
    toast("Could not load countries.json");
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  showScreen("menu");
  window.__panoguru = { state, CFG }; // for debugging / tests
}

init();
