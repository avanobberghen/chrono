// App name, logo, language and colours. See README, "Customise the app".
// Changes here reach the phones automatically (no version bump needed).
self.CHRONO_SETTINGS = {
  appName: 'Chrono',
  clubName: "Chouet'Bike Club",          // shown under the app name; leave '' to hide

  // Image next to index.html (PNG with a transparent background works best).
  // Home-screen icons are separate files: icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png.
  logo: 'logo.png',

  // Languages offered in the app, as files in the lang/ folder. The first one is the fallback.
  languages: ['fr', 'en'],
  // 'auto' = the phone's language when available, otherwise the first of `languages`.
  // Or force one, e.g. 'fr'. Each user can also pick a language at the bottom of the home screen.
  language: 'auto',

  // 'auto' follows the phone's light/dark setting, 'dark' or 'light' forces one.
  mode: 'auto',

  // Colours (hex). bg = background, surface = cards, line = borders, ink = text, muted = secondary text,
  // accent = main buttons and active tabs, accentInk = text on accent,
  // go = Start, stop = Stop/Finish, split = Split, lap = Lap, actInk = text on the timing buttons.
  dark: {
    bg: '#0A1626', surface: '#12243B', line: '#21395A', ink: '#E9F0FA', muted: '#93A9C6',
    accent: '#4A90E2', accentInk: '#06172B',
    go: '#3DBE7E', stop: '#F0645A', split: '#D8EC3C', lap: '#5BB4F5', actInk: '#06172B'
  },
  light: {
    bg: '#EDF2F8', surface: '#FFFFFF', line: '#CFDAE7', ink: '#0E1E33', muted: '#55687F',
    accent: '#2A5684', accentInk: '#FFFFFF',
    go: '#16794A', stop: '#C33A2F', split: '#8A6A00', lap: '#1F6FC4', actInk: '#FFFFFF'
  }
};
