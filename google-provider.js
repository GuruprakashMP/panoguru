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

const ANSWER_ICON = {
  path: "M 0,0 m -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0",
  fillColor: "#10b981", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2.5, scale: 1,
};

export function createGoogleProvider(apiKey, { onAuthError } = {}) {
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
      guessMarker = new libs.Marker({ map, position: point, draggable: true, title: "Your guess" });
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
      const answerMarker = new libs.Marker({ map, position: answer, icon: ANSWER_ICON, title: `Round ${i + 1}`, zIndex: 10 });
      overlays.push(answerMarker);
      bounds.extend(answer);
      if (guess) {
        const gm = new libs.Marker({ map, position: guess, label: pairs.length > 1 ? String(i + 1) : undefined, title: "Your guess" });
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

  function resetView() {
    if (!map) return;
    map.setCenter({ lat: 20, lng: 0 });
    map.setZoom(1);
  }

  function resize() {
    if (map) google.maps.event.trigger(map, "resize");
    if (pano) google.maps.event.trigger(pano, "resize");
  }

  return { name: "google", load, findPanorama, showPanorama, returnToStart, createMap, setGuess, clearOverlays, showResult, resetView, resize };
}
