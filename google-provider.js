// Google Maps Platform provider.
// Cost control: exactly ONE StreetViewPanorama and ONE Map are ever created
// per page load; every round just re-points them. (Google bills Street View
// per panorama *instantiation* and maps per map load.)

const GOOGLE_MAPS_LOADER = (g) => {
  // Official dynamic library import bootstrap (unchanged from Google's docs).
  var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
  b = b[c] || (b[c] = {});
  var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(), u = () => h || (h = new Promise(async (f, n) => {
    await (a = m.createElement("script"));
    e.set("libraries", [...r] + "");
    for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
    e.set("callback", c + ".maps." + q);
    a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
    d[q] = f;
    a.onerror = () => (h = n(Error(p + " could not load.")));
    a.nonce = m.querySelector("script[nonce]")?.nonce || "";
    m.head.append(a);
  }));
  d[l] ? console.warn(p + " only loads once. Ignoring:", g) : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
};

// Marker icons: red pin with "?" (or round number) = player's guess, green pin with a tick = true location.
function pinDataUrl(fill, stroke, textColor, inner) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46" width="36" height="46">
    <path d="M18 1.5C9.2 1.5 2.5 8.2 2.5 17c0 11.5 15.5 27.5 15.5 27.5S33.5 28.5 33.5 17C33.5 8.2 26.8 1.5 18 1.5z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <circle cx="18" cy="17" r="10.5" fill="#fff"/>${inner.replace(/TEXTCOLOR/g, textColor)}</svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
const GUESS_INNER = (label) => `<text x="18" y="22.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${label.length > 1 ? 13 : 16}" font-weight="bold" fill="TEXTCOLOR">${label}</text>`;
const ANSWER_INNER = `<path d="M12 17.5l4.2 4.2L24.5 13" fill="none" stroke="TEXTCOLOR" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
function guessIcon(label = "?") {
  return { url: pinDataUrl("#ef4444", "#7f1d1d", "#b91c1c", GUESS_INNER(label)), scaledSize: new google.maps.Size(36, 46), anchor: new google.maps.Point(18, 45) };
}
function answerIcon() {
  return { url: pinDataUrl("#10b981", "#065f46", "#047857", ANSWER_INNER), scaledSize: new google.maps.Size(36, 46), anchor: new google.maps.Point(18, 45) };
}

export function createGoogleProvider(apiKey, { onAuthError, onPanoStatus, onPov } = {}) {
  let libs = null;
  let pano = null;
  let map = null;
  let svService = null;
  let guessMarker = null;
  let overlays = [];
  let startPanoId = null;
  let mapClickHandler = null;

  async function load() {
    if (libs) return;
    window.gm_authFailure = () => onAuthError?.();
    GOOGLE_MAPS_LOADER({ key: apiKey, v: "weekly" });
    const [mapsLib, svLib, markerLib] = await Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("streetView"),
      google.maps.importLibrary("marker"),
    ]);
    libs = { ...mapsLib, ...svLib, ...markerLib };
    svService = new libs.StreetViewService();
  }

  /**
   * Nearest outdoor panorama within radiusKm of the point.
   * Resolves to { status: "OK", panoId, lat, lng } or { status: "<reason>" }.
   * strict=true limits to official Google imagery (when the API supports it).
   */
  function findPanorama(point, radiusKm, { strict = true } = {}) {
    const { StreetViewPreference, StreetViewSource } = libs;
    const request = {
      location: { lat: point.lat, lng: point.lng },
      radius: Math.round(radiusKm * 1000),
      preference: StreetViewPreference?.NEAREST || "nearest",
    };
    const OUTDOOR = StreetViewSource?.OUTDOOR || "outdoor";
    if (strict && StreetViewSource?.GOOGLE) request.sources = [StreetViewSource.GOOGLE, OUTDOOR];
    else request.source = OUTDOOR;
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => finish({ status: "TIMEOUT" }), 7000);
      const ok = (data) => {
        const ll = data?.location?.latLng;
        if (!ll || !data.location.pano) return finish({ status: "NO_DATA" });
        finish({ status: "OK", panoId: data.location.pano, lat: ll.lat(), lng: ll.lng() });
      };
      let p;
      try {
        p = svService.getPanorama(request, (data, status) => (status === "OK" ? ok(data) : finish({ status: String(status || "UNKNOWN") })));
      } catch (err) {
        console.warn("getPanorama threw", err);
        return finish({ status: "ERROR " + (err?.message || err) });
      }
      if (p && typeof p.then === "function") {
        p.then((res) => ok(res?.data), (err) => finish({ status: String(err?.code || err?.message || err || "REJECTED") }));
      }
    });
  }

  function showPanorama(container, { panoId, heading = 0 }) {
    startPanoId = panoId;
    if (!pano) {
      pano = new libs.StreetViewPanorama(container, {
        pano: panoId,
        pov: { heading, pitch: 0 },
        zoom: 1,
        addressControl: false,
        showRoadLabels: false,
        linksControl: true,
        panControl: false,
        zoomControl: false,
        fullscreenControl: false,
        enableCloseButton: false,
        motionTracking: false,
        motionTrackingControl: false,
        imageDateControl: false,
        clickToGo: true,
        scrollwheel: true,
        visible: true,
      });
      pano.addListener("status_changed", () => {
        const s = pano.getStatus();
        console.info("[panoguru] panorama status:", s, pano.getPano());
        if (s !== "OK") onPanoStatus?.(s, pano.getPano());
      });
      pano.addListener("pano_changed", () => console.info("[panoguru] pano_changed:", pano.getPano()));
      pano.addListener("pov_changed", () => onPov?.(pano.getPov().heading));
      return;
    }
    pano.setPano(panoId);
    pano.setPov({ heading, pitch: 0 });
    pano.setZoom(1);
  }

  function returnToStart() {
    if (pano && startPanoId) {
      pano.setPano(startPanoId);
      pano.setPov({ heading: pano.getPov().heading, pitch: 0 });
    }
  }

  function createMap(container, { onClick }) {
    mapClickHandler = onClick;
    if (map) return;
    map = new libs.Map(container, {
      center: { lat: 20, lng: 0 },
      zoom: 1,
      minZoom: 1,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      clickableIcons: false,
      keyboardShortcuts: false,
      mapTypeId: "roadmap",
      backgroundColor: "#0b1220",
      draggableCursor: "crosshair",
      draggingCursor: "grabbing",
    });
    map.addListener("click", (e) => mapClickHandler?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
  }

  function setGuess(point) {
    if (!point) {
      if (guessMarker) guessMarker.setMap(null);
      guessMarker = null;
      return;
    }
    if (!guessMarker) {
      guessMarker = new libs.Marker({ map, position: point, draggable: true, title: "Your guess (drag to adjust)", icon: guessIcon("?"), zIndex: 20 });
      guessMarker.addListener("dragend", () => {
        const p = guessMarker.getPosition();
        mapClickHandler?.({ lat: p.lat(), lng: p.lng() }, { fromDrag: true });
      });
    } else {
      guessMarker.setPosition(point);
      guessMarker.setMap(map);
    }
  }

  function clearOverlays() {
    for (const o of overlays) o.setMap(null);
    overlays = [];
    setGuess(null);
  }

  /** Draw guess/answer pairs with dashed lines and fit the view. */
  function showResult(pairs) {
    clearOverlays();
    const bounds = new google.maps.LatLngBounds();
    pairs.forEach((pair, i) => {
      const { guess, answer } = pair;
      const answerMarker = new libs.Marker({ map, position: answer, icon: answerIcon(), title: `True location${pairs.length > 1 ? " (round " + (i + 1) + ")" : ""}`, zIndex: 10 });
      overlays.push(answerMarker);
      bounds.extend(answer);
      if (guess) {
        const gm = new libs.Marker({ map, position: guess, icon: guessIcon(pairs.length > 1 ? String(i + 1) : "?"), title: "Your guess", zIndex: 15 });
        overlays.push(gm);
        bounds.extend(guess);
        const line = new libs.Polyline({
          map, path: [guess, answer], geodesic: false, strokeOpacity: 0,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: "#fbbf24", scale: 3 }, offset: "0", repeat: "14px" }],
        });
        overlays.push(line);
      }
    });
    google.maps.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 14) map.setZoom(14); });
    map.fitBounds(bounds, 60);
  }

  /** Crosshair cursor while guessing, hand cursor on result maps. */
  function setGuessMode(on) {
    map?.setOptions({ draggableCursor: on ? "crosshair" : "grab" });
  }

  function resetView() {
    if (!map) return;
    map.setCenter({ lat: 20, lng: 0 });
    map.setZoom(1);
  }

  function resize() {
    if (map) google.maps.event.trigger(map, "resize");
    if (pano) google.maps.event.trigger(pano, "resize");
  }

  return { name: "google", load, findPanorama, showPanorama, returnToStart, createMap, setGuess, setGuessMode, clearOverlays, showResult, resetView, resize };
}
