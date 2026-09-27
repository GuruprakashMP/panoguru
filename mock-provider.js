// Mock provider: no Google account needed. Draws a synthetic "panorama" and a
// simple equirectangular world map from the bundled country outlines, so the
// whole game flow can be tested offline (?mock=1).

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createMockProvider({ countries = [], onPov } = {}) {
  let panoEl = null, panoCanvas = null, panoState = { seed: 1, heading: 0, startId: null, id: null };
  let mapEl = null, mapCanvas = null, mapClick = null;
  let guess = null, resultPairs = [];

  async function load() {}

  function findPanorama(point, radiusKm) {
    return new Promise((resolve) => setTimeout(() => {
      if (Math.random() < 0.12) return resolve({ status: "ZERO_RESULTS" }); // simulate "no coverage here"
      const jitter = () => (Math.random() - 0.5) * Math.min(radiusKm, 20) / 111;
      const lat = Math.max(-85, Math.min(85, point.lat + jitter()));
      const lng = point.lng + jitter();
      resolve({ status: "OK", panoId: `mock:${lat.toFixed(4)},${lng.toFixed(4)}`, lat, lng, description: "Mock Street, Mock Town", shortDescription: "Mock Street" });
    }, 60));
  }

  // ---- panorama ----
  function drawPano() {
    if (!panoCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = panoCanvas.clientWidth, H = panoCanvas.clientHeight;
    if (panoCanvas.width !== W * dpr) { panoCanvas.width = W * dpr; panoCanvas.height = H * dpr; }
    const ctx = panoCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const horizon = H * 0.58;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#1d4ed8"); sky.addColorStop(1, "#93c5fd");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon);
    const ground = ctx.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, "#4b5563"); ground.addColorStop(1, "#1f2937");
    ctx.fillStyle = ground; ctx.fillRect(0, horizon, W, H - horizon);
    // road
    ctx.fillStyle = "#374151";
    ctx.beginPath(); ctx.moveTo(W * 0.35, H); ctx.lineTo(W * 0.48, horizon); ctx.lineTo(W * 0.52, horizon); ctx.lineTo(W * 0.65, H); ctx.fill();
    // objects around 360 degrees, positioned by heading
    const rng = seeded(panoState.seed);
    const pxPerDeg = W / 90; // 90 deg field of view
    for (let i = 0; i < 40; i++) {
      const az = rng() * 360, kind = rng(), h = 20 + rng() * 90, w = 12 + rng() * 40;
      let rel = ((az - panoState.heading + 540) % 360) - 180;
      if (Math.abs(rel) > 60) continue;
      const x = W / 2 + rel * pxPerDeg;
      if (kind < 0.5) { ctx.fillStyle = `hsl(${200 + rng() * 40}, 15%, ${35 + rng() * 25}%)`; ctx.fillRect(x - w / 2, horizon - h, w, h); }
      else { ctx.fillStyle = `hsl(${100 + rng() * 40}, 45%, ${28 + rng() * 15}%)`; ctx.beginPath(); ctx.arc(x, horizon - h * 0.5, w * 0.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "600 13px system-ui";
    ctx.fillText(`heading ${Math.round(panoState.heading)}°`, 12, H - 14);
  }

  function showPanorama(container, { panoId, heading = 0 }) {
    panoState.id = panoId; panoState.startId = panoId; panoState.seed = hashString(panoId); panoState.heading = heading;
    if (!panoEl) {
      panoEl = document.createElement("div"); panoEl.className = "mock-pano";
      panoCanvas = document.createElement("canvas"); panoEl.appendChild(panoCanvas);
      const badge = document.createElement("div"); badge.className = "mock-badge"; badge.textContent = "Mock panorama (no API key). Drag to look around."; panoEl.appendChild(badge);
      container.appendChild(panoEl);
      let dragging = false, lastX = 0;
      const down = (x) => { dragging = true; lastX = x; };
      const move = (x) => { if (!dragging) return; panoState.heading = (panoState.heading - (x - lastX) / 4 + 360) % 360; lastX = x; drawPano(); onPov?.(panoState.heading); };
      panoEl.addEventListener("pointerdown", (e) => { down(e.clientX); panoEl.setPointerCapture(e.pointerId); });
      panoEl.addEventListener("pointermove", (e) => move(e.clientX));
      panoEl.addEventListener("pointerup", () => { dragging = false; });
      window.addEventListener("resize", drawPano);
    }
    requestAnimationFrame(drawPano);
  }
  function refreshView() { drawPano(); }
  function returnToStart() { if (panoState.startId) { panoState.id = panoState.startId; drawPano(); } }

  // ---- map ----
  function proj(W, H) {
    const s = Math.min(W / 360, H / 180);
    const ox = (W - 360 * s) / 2, oy = (H - 180 * s) / 2;
    return { toXY: (lat, lng) => [ox + (lng + 180) * s, oy + (90 - lat) * s], toLL: (x, y) => ({ lat: 90 - (y - oy) / s, lng: (x - ox) / s - 180 }) };
  }
  function drawMap() {
    if (!mapCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = mapCanvas.clientWidth, H = mapCanvas.clientHeight;
    if (!W || !H) return;
    if (mapCanvas.width !== W * dpr) { mapCanvas.width = W * dpr; mapCanvas.height = H * dpr; }
    const ctx = mapCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b2a4a"; ctx.fillRect(0, 0, W, H);
    const { toXY } = proj(W, H);
    ctx.fillStyle = "#2f4f3f"; ctx.strokeStyle = "#6b8f7a"; ctx.lineWidth = 0.6;
    for (const c of countries) for (const p of c.p) {
      ctx.beginPath();
      p.r[0].forEach(([lng, lat], i) => { const [x, y] = toXY(lat, lng); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const dot = (pt, color, text) => {
      const [x, y] = toXY(pt.lat, pt.lng);
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 0.5);
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    };
    resultPairs.forEach((pair, i) => {
      if (pair.guess) {
        const [x1, y1] = toXY(pair.guess.lat, pair.guess.lng), [x2, y2] = toXY(pair.answer.lat, pair.answer.lng);
        ctx.setLineDash([6, 6]); ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        dot(pair.guess, "#ef4444", resultPairs.length > 1 ? String(i + 1) : "?");
      }
      dot(pair.answer, "#10b981", "\u2713");
    });
    if (guess) dot(guess, "#ef4444", "?");
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "11px system-ui"; ctx.fillText("Mock map: tap to guess", 8, H - 8);
  }
  function createMap(container, { onClick }) {
    mapClick = onClick;
    if (mapEl) return;
    mapEl = document.createElement("div"); mapEl.className = "mock-map";
    mapCanvas = document.createElement("canvas"); mapEl.appendChild(mapCanvas); container.appendChild(mapEl);
    mapEl.addEventListener("click", (e) => {
      const r = mapCanvas.getBoundingClientRect();
      const { toLL } = proj(r.width, r.height);
      const ll = toLL(e.clientX - r.left, e.clientY - r.top);
      if (Math.abs(ll.lat) <= 90 && Math.abs(ll.lng) <= 180) mapClick?.(ll);
    });
    window.addEventListener("resize", drawMap);
    new ResizeObserver(() => drawMap()).observe(mapEl);
    drawMap();
  }
  function setGuess(pt) { guess = pt; drawMap(); }
  function setGuessMode(on) { if (mapEl) mapEl.style.cursor = on ? "crosshair" : "grab"; }
  function clearOverlays() { guess = null; resultPairs = []; drawMap(); }
  function showResult(pairs) { guess = null; resultPairs = pairs; drawMap(); }
  function resetView() { drawMap(); }
  function resize() { drawPano(); drawMap(); }

  return { name: "mock", load, findPanorama, showPanorama, returnToStart, refreshView, createMap, setGuess, setGuessMode, clearOverlays, showResult, resetView, resize };
}
