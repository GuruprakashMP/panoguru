# PanoGuru: Guess the World

A free, open-source street-level geography guessing game (GeoGuessr-style).
You are dropped into a Google Street View panorama somewhere on Earth, look
around, then pin the place on the map. Five rounds, up to 5,000 points each.

Live site: https://guruprakashmp.github.io/panoguru/

Plain HTML/CSS/JS, no build step, no server. Works on phone and desktop, and
can be installed as an app from the browser menu ("Add to Home screen").

## 1. Get a Google Maps API key (one time, about 10 minutes)

Street View needs a key. Within Google's free monthly allowance (5,000 Street
View panorama loads + 10,000 map loads) it costs nothing; the game creates
exactly one panorama and one map per visit, so 5,000 = about 5,000 play
sessions per month.

1. Go to https://console.cloud.google.com/ and create a project (e.g. "panoguru").
2. Billing -> link a billing account (a card is required by Google even for free-tier use).
3. APIs & Services -> Library -> enable **Maps JavaScript API** (that is the only API needed).
4. APIs & Services -> Credentials -> Create credentials -> **API key**. Then click the key to edit it:
   - Application restrictions: **Websites** -> add `https://guruprakashmp.github.io/*`
     (for local testing also add `http://localhost:*/*` and `http://127.0.0.1:*/*`).
   - API restrictions: **Restrict key** -> select only *Maps JavaScript API*.
5. Protect yourself from surprise bills: Google Maps Platform -> Quotas -> Maps JavaScript API:
   set a daily cap for map loads and Street View (for example 150 per day, which is below the free monthly allowance).
   Also Billing -> Budgets & alerts -> create a budget of 1 EUR with email alerts.
6. Paste the key into `config.js`:

   ```js
   googleMapsApiKey: "AIza...",
   ```

If `googleMapsApiKey` is left empty, the game asks for a key in the browser
and stores it only on that device (handy for testing before you commit).

## 2. Publish on GitHub Pages

1. Create a public repository named `panoguru` on GitHub.
2. Upload all files of this folder (Add file -> Upload files, drag them in, Commit).
3. Settings -> Pages -> Build and deployment: Source **Deploy from a branch**,
   Branch **main**, folder **/ (root)** -> Save.
4. After a minute the site is live at `https://<your-username>.github.io/panoguru/`.

To update the game later, upload the changed files again (same names overwrite).

## 3. Run locally

Any static server works, for example:

```bash
python -m http.server 8000
```

then open http://localhost:8000/ (or http://localhost:8000/?mock=1 to play
the offline mock version without a key).

## Player accounts (optional): Google sign-in + cloud-saved stats

Without this, stats are kept in the browser only ("My stats" on the menu).
With Firebase (free tier, no card) players sign in with Google and their
stats follow them on every device.

1. https://console.firebase.google.com → **Add project** → pick your existing
   Google Cloud project (the one that owns the Maps key) → disable Analytics → Create.
2. Build → **Authentication** → Get started → Sign-in method → **Google** → Enable
   (choose a support email) → Save. Then Authentication → Settings →
   **Authorized domains** → Add `guruprakashmp.github.io`.
3. Build → **Firestore Database** → Create database → location e.g. `eur3` →
   **Production mode** → Create. Then **Rules** tab, replace everything with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
         match /games/{gameId} {
           allow read, write: if request.auth != null && request.auth.uid == uid;
         }
       }
     }
   }
   ```

   → Publish.
4. Project settings (gear) → Your apps → **Web app** (</>) → nickname `panoguru`,
   no hosting → Register → copy the `firebaseConfig` object.
5. Paste it into `config.js`:

   ```js
   firebase: { apiKey: "...", authDomain: "....firebaseapp.com", projectId: "...", appId: "..." },
   ```

The Firebase web config is meant to be public; the Firestore rules above are
what protect the data (each player can only read and write their own document).

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | screens and layout |
| `app.js` | game flow (rounds, scoring, results) |
| `geo.js` | distance, scoring formula, random point sampling inside country outlines |
| `google-provider.js` | Street View + Google Map adapter (one instance each, reused every round) |
| `mock-provider.js` | key-free stand-in used by `?mock=1` |
| `countries.json` | simplified outlines of ~107 countries with Street View coverage (Natural Earth, public domain) with per-country weights and search radius |
| `stats.js` | player statistics (local storage, and Firebase sign-in + Firestore when configured) |
| `config.js` | name, tagline, API key, rules, optional Firebase config |
| `manifest.webmanifest`, `sw.js`, `icon*.png/svg` | installable web app |

## Rules

- Score per round: `5000 * exp(-distance_km / 1492.7)`, perfect (5,000) within 25 m.
- Locations: a country is picked with a coverage-based weight, a random point
  inside it is drawn, and the nearest official outdoor Street View panorama
  within the country's search radius is used. The next round's location is
  fetched in the background while you play.

## Renaming

Change `appName`, `tagline` and `repoUrl` in `config.js`, the `<title>` in
`index.html`, and `name`/`short_name` in `manifest.webmanifest`.

## Licence and attribution

Code: MIT (see LICENSE). Street View imagery and maps are provided by Google
under the Google Maps Platform Terms of Service; the Google logo and
attribution must stay visible. Country outlines derived from Natural Earth.
