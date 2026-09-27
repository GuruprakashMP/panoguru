// PanoGuru game controller.
import { haversineKm, scoreForDistance, formatDistance, formatPoints, weightedPick, randomPointInCountry, countryAt } from "./geo.js";
import { createGoogleProvider } from "./google-provider.js";
import { createMockProvider } from "./mock-provider.js";

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
  pano: $("pano"), mapWrap: $("map-wrap"), map: $("map"), mapTap: $("map-tap"), mapClose: $("map-close"), guess: $("btn-guess"),
  screens: { menu: $("screen-menu"), setup: $("screen-setup"), game: $("screen-game"), result: $("screen-result"), final: $("screen-final") },
  play: $("btn-play"), best: $("best-score"), bestLine: $("best-line"), linkKey: $("link-key"),
  apiKey: $("api-key"), saveKey: $("btn-save-key"), mock: $("btn-mock"), setupBack: $("btn-setup-back"),
  hudRound: $("hud-round"), hudRounds: $("hud-rounds"), hudScore: $("hud-score"), ret: $("btn-return"),
  resDistance: $("res-distance"), resPoints: $("res-points"), resCountry: $("res-country"), next: $("btn-next"),
  finalScore: $("final-score"), finalMax: $("final-max"), finalRounds: $("final-rounds"), again: $("btn-again"), share: $("btn-share"),
  loading: $("loading"), loadingText: $("loading-text"), toast: $("toast"),
};

const state = {
  provider: null, mock: params.get("mock") === "1", countries: [],
  round: 0, total: 0, rounds: [], current: null, next: null, guess: null, busy: false,
};

// ---------- small UI helpers ----------
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
  ui.mapWrap.classList.remove("hidden", "mini", "expanded", "result", "final");
  ui.mapWrap.classList.add(mode);
  setTimeout(() => state.provider?.resize(), 220);
}
function storage(get, key, value) {
  try { return get ? localStorage.getItem(key) : localStorage.setItem(key, value); } catch { return null; }
}

// ---------- provider ----------
async function ensureProvider() {
  if (state.provider) return true;
  if (state.mock) {
    state.provider = createMockProvider({ countries: state.countries });
    return true;
  }
  const key = CFG.googleMapsApiKey || storage(true, LS_KEY) || "";
  if (!key) { showScreen("setup"); return false; }
  state.provider = createGoogleProvider(key, {
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
async function findLocation() {
  const countries = state.countries;
  for (let c = 0; c < CFG.maxCountriesPerRound; c++) {
    const country = weightedPick(countries, "w");
    for (let t = 0; t < CFG.triesPerCountry; t++) {
      const pt = randomPointInCountry(country);
      const found = await state.provider.findPanorama(pt, country.km);
      if (found) {
        const actual = countryAt(countries, found.lat, found.lng) || country;
        return { panoId: found.panoId, lat: found.lat, lng: found.lng, country: actual.n, heading: Math.floor(Math.random() * 360) };
      }
    }
  }
  throw new Error("No Street View found after many tries");
}
function prefetchNext() {
  state.next = findLocation().catch((err) => { console.warn(err); return null; });
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
    try { loc = await findLocation(); } catch (err) { console.error(err); }
  }
  if (!loc) {
    setLoading(false);
    toast("Could not find a Street View location. Please try again.");
    showScreen("menu");
    setMapMode("hidden");
    return;
  }
  state.current = loc;
  state.round += 1;
  state.guess = null;
  if (state.round < CFG.rounds) prefetchNext(); else state.next = null;

  ui.pano.classList.remove("hidden", "invisible");
  state.provider.showPanorama(ui.pano, { panoId: loc.panoId, heading: loc.heading });
  state.provider.clearOverlays();
  state.provider.resetView();
  ui.guess.disabled = true;
  ui.guess.textContent = "Place your pin";
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
  }
}

function submitGuess() {
  if (!state.guess || !state.current || state.busy) return;
  const answer = { lat: state.current.lat, lng: state.current.lng };
  const km = haversineKm(state.guess, answer);
  const points = scoreForDistance(km, CFG);
  state.total += points;
  state.rounds.push({ guess: state.guess, answer, km, points, country: state.current.country });
  ui.hudScore.textContent = formatPoints(state.total);
  ui.resDistance.textContent = formatDistance(km);
  ui.resPoints.textContent = formatPoints(points);
  ui.resCountry.textContent = state.current.country ? `It was in ${state.current.country}` : "";
  ui.next.textContent = state.round >= CFG.rounds ? "See results" : "Next round";
  ui.pano.classList.add("invisible");
  setMapMode("result");
  state.provider.showResult([{ guess: state.guess, answer }]);
  showScreen("result");
}

function showFinal() {
  ui.finalScore.textContent = formatPoints(state.total);
  ui.finalMax.textContent = formatPoints(CFG.rounds * CFG.maxScorePerRound);
  ui.finalRounds.innerHTML = state.rounds.map((r, i) =>
    `<li><span>Round ${i + 1} · ${r.country ? escapeHtml(r.country) : "?"}</span><span class="muted">${formatDistance(r.km)}</span><span>${formatPoints(r.points)}</span></li>`
  ).join("");
  const best = Number(storage(true, LS_BEST) || 0);
  if (state.total > best) { storage(false, LS_BEST, String(state.total)); }
  updateBest();
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
  ui.pano.classList.add("invisible");
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

// ---------- events ----------
function bind() {
  ui.play.addEventListener("click", startGame);
  ui.again.addEventListener("click", startGame);
  ui.guess.addEventListener("click", submitGuess);
  ui.next.addEventListener("click", () => (state.round >= CFG.rounds ? showFinal() : nextRound()));
  ui.ret.addEventListener("click", () => state.provider?.returnToStart());
  ui.share.addEventListener("click", share);
  ui.mapTap.addEventListener("click", () => setMapMode("expanded"));
  ui.mapClose.addEventListener("click", () => setMapMode("mini"));
  ui.mapWrap.addEventListener("mouseenter", () => { if (matchMedia("(pointer: fine)").matches && ui.mapWrap.classList.contains("mini")) setMapMode("expanded"); });
  ui.mapWrap.addEventListener("mouseleave", () => { if (matchMedia("(pointer: fine)").matches && ui.mapWrap.classList.contains("expanded")) setMapMode("mini"); });
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
  try {
    const res = await fetch("countries.json");
    state.countries = (await res.json()).countries;
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
