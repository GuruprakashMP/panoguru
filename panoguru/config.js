// PanoGuru configuration. Edit this file, nothing else is needed.
window.PANOGURU_CONFIG = {
  appName: "PanoGuru",
  tagline: "Guess the World",

  // Google Maps Platform API key (Maps JavaScript API enabled, restricted to
  // your website URL). Leave empty to be asked for a key in the browser
  // (stored only on that device) - handy for local testing.
  googleMapsApiKey: "",

  // Game rules
  rounds: 5,
  maxScorePerRound: 5000,
  scoreScaleKm: 1492.7, // GeoGuessr-style: score = 5000 * exp(-distance / scale)

  // Street View search: attempts per round before giving up on a country
  triesPerCountry: 6,
  maxCountriesPerRound: 8,

  // Links
  repoUrl: "https://github.com/GuruprakashMP/panoguru",
};
