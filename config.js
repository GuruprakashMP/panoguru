// PanoGuru configuration. Edit this file, nothing else is needed.
window.PANOGURU_CONFIG = {
  appName: "PanoGuru",
  tagline: "Guess the World",

  // Google Maps Platform API key (Maps JavaScript API enabled, restricted to
  // your website URL). Leave empty to be asked for a key in the browser
  // (stored only on that device) - handy for local testing.
  googleMapsApiKey: "AIzaSyAw930OuURXC9aHmVN3-WNrZqvNyKjm9Qk",

  // Small map while playing: "button" (just an "Open map" button, keeps the view clear)
  // or "thumbnail" (a small live map preview in the corner)
  miniMap: "button",

  // Place names on the result screen: Street View's own description (street, town,
  // region) is always used and is free. Set useGeocoder: true for cleaner
  // "Town, Region, Country" names via the Geocoding API (needs that API enabled in
  // Google Cloud and allowed on the key; 10,000 free requests per month).
  useGeocoder: false,

  // Player accounts (Google sign-in + cloud-saved stats). Leave null to keep
  // stats on the device only. To enable: create a Firebase project (see README,
  // section "Player accounts") and paste its web config object here, e.g.
  // firebase: { apiKey: "...", authDomain: "xxx.firebaseapp.com", projectId: "xxx", appId: "..." },
  firebase: {
    apiKey: "AIzaSyAOLmSjP9XUt9iozqYINqw4DcJ9hrTeJeA",
    authDomain: "pelagic-force-509911-p6.firebaseapp.com",
    projectId: "pelagic-force-509911-p6",
    storageBucket: "pelagic-force-509911-p6.firebasestorage.app",
    messagingSenderId: "214389893616",
    appId: "1:214389893616:web:c43cabacb4d6693bd95535",
  },

  // Game rules
  rounds: 5,
  maxScorePerRound: 5000,
  scoreScaleKm: 1492.7, // GeoGuessr-style: score = 5000 * exp(-distance / scale)

  // Location picking. Most rounds start near a real town or village (clues to
  // read); the rest are uniformly random points in the country (remote roads).
  // townShare: null = automatic arc (rounds 1-2: 85% town, round 3: 60%, rounds 4-5: 40%);
  // set a number 0..1 to force a fixed share. townRadiusKm = how far from the town centre.
  townShare: null,
  townRadiusKm: 6,
  townSearchKm: 10,

  // Street View search: parallel lookups per batch, total attempts and time
  // budget before falling back to a well-covered city
  parallelSearches: 3,
  maxAttempts: 45,
  searchTimeoutMs: 25000,

  // Links
  repoUrl: "https://github.com/GuruprakashMP/panoguru",
};
