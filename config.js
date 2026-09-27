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

  // Game rules
  rounds: 5,
  maxScorePerRound: 5000,
  scoreScaleKm: 1492.7, // GeoGuessr-style: score = 5000 * exp(-distance / scale)

  // Street View search: parallel lookups per batch, total attempts and time
  // budget before falling back to a well-covered city
  parallelSearches: 3,
  maxAttempts: 45,
  searchTimeoutMs: 25000,

  // Links
  repoUrl: "https://github.com/GuruprakashMP/panoguru",
};
