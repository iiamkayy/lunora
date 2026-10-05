/* ============================================================
   lunora — shared core (loaded by the shell and every app)
   ============================================================ */
(() => {
  'use strict';

  const MOTTO = 'For MISD X AISD students by MISD X AISD students';
  const VERSION = '1.0.0';
  const NS = 'lunora.';

  /* ---------------- utils ---------------- */
  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function sha256(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // insecure context (file://) fallback — better than nothing
      let h = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return 'fnv' + (h >>> 0).toString(16);
    }
  }

  function toast(msg, ms = 1800) {
    let el = document.querySelector('.vtoast');
    if (!el) { el = document.createElement('div'); el.className = 'vtoast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  /* ---------------- settings store ---------------- */
  const DEFAULTS = {
    accent: 'mint',
    wallpaper: { type: 'aurora', value: '', dim: 0.32, blur: 0 },   // aurora | gradient:<id> | image:<idbKey> | video:<idbKey> | url:<url>
    cloak: { preset: '', title: '', icon: '', auto: false },
    panic: { on: false, key: '`', url: 'https://classroom.google.com/h', mode: 'same', showBtn: true },
    engine: { selected: 'scramjet', wisp: '', bare: '' },
    ai: { model: 'openai' },
    os: { passwordOn: true, lastUser: '' },
  };

  function mergeDeep(base, over) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k of Object.keys(over || {})) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') {
        out[k] = mergeDeep(base[k], over[k]);
      } else if (over[k] !== undefined) out[k] = over[k];
    }
    return out;
  }

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); }
      catch { return d; }
    },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(NS + k); } catch {} },
    raw(k) { try { return JSON.parse(localStorage.getItem(NS + k)); } catch { return null; } },
  };

  const settings = {
    all() { return mergeDeep(DEFAULTS, store.get('settings', {})); },
    get path() { return null; },
    save(all) { store.set('settings', all); },
  };

  function getSettings() { return settings.all(); }
  function saveSettings(all, notify = true) {
    settings.save(all);
    if (notify) tellShell({ type: 'settingsChanged' });
  }
  function patchSettings(path, value, notify = true) {
    const all = settings.all();
    const parts = path.split('.');
    let cur = all;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
    saveSettings(all, notify);
    return all;
  }

  /* ---------------- IndexedDB blob store (big files: wallpapers, avatars, banners, media) ---------------- */
  const files = (() => {
    let dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        const req = indexedDB.open('lunora-files', 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files'); };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      return dbp;
    }
    async function put(key, blob) {
      const d = await db();
      return new Promise((res, rej) => {
        const tx = d.transaction('files', 'readwrite');
        tx.objectStore('files').put(blob, key);
        tx.oncomplete = () => res(key);
        tx.onerror = () => rej(tx.error);
      });
    }
    async function get(key) {
      const d = await db();
      return new Promise((res, rej) => {
        const tx = d.transaction('files', 'readonly');
        const r = tx.objectStore('files').get(key);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    }
    async function del(key) {
      const d = await db();
      return new Promise((res, rej) => {
        const tx = d.transaction('files', 'readwrite');
        tx.objectStore('files').delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    async function clear() {
      const d = await db();
      return new Promise((res, rej) => {
        const tx = d.transaction('files', 'readwrite');
        tx.objectStore('files').clear();
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    return { put, get, del, clear };
  })();

  /* ---------------- shell IPC (apps are iframes inside index.html) ---------------- */
  const IS_TOP = window.self === window.top;

  function tellShell(msg) {
    msg = { __lunora: true, ...msg };
    if (!IS_TOP && window.parent) window.parent.postMessage(msg, '*');
  }
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__lunora !== true) return;
    if (d.type === 'settingsChanged') {
      applyAccent();
      applyCloakFromSettings();
      document.dispatchEvent(new CustomEvent('lunora:settings'));
    }
    if (d.type === 'navigate' && window.VeloraBrowser?.navigate) window.VeloraBrowser.navigate(d.url);
  });

  /* open another app (works from the shell itself or from inside an app iframe) */
  function openApp(app, params) {
    if (IS_TOP) {
      if (window.VeloraShell) window.VeloraShell.openApp(app, params);
    } else {
      tellShell({ type: 'openApp', app, params });
    }
  }

  /* ---------------- accent ---------------- */
  function applyAccent() {
    const acc = getSettings().accent;
    if (acc && acc !== 'mint') document.documentElement.dataset.acc = acc;
    else delete document.documentElement.dataset.acc;
  }

  /* ---------------- tab cloak ---------------- */
  const CLOAKS = [
    { id: 'classroom', name: 'Google Classroom', title: 'Home', icon: 'https://ssl.gstatic.com/classroom/favicon.png' },
    { id: 'canvas', name: 'Canvas', title: 'Dashboard', icon: 'https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico' },
    { id: 'classlink', name: 'ClassLink', title: 'My Apps', icon: 'https://launchpad.classlink.com/favicon.ico' },
    { id: 'clever', name: 'Clever', title: 'Clever | Portal', icon: 'https://clever.com/favicon.ico' },
    { id: 'google', name: 'Google', title: 'Google', icon: 'https://www.google.com/favicon.ico' },
    { id: 'drive', name: 'Google Drive', title: 'My Drive - Google Drive', icon: 'https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png' },
    { id: 'docs', name: 'Google Docs', title: 'Untitled document - Google Docs', icon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' },
    { id: 'gmail', name: 'Gmail', title: 'Inbox - Gmail', icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
    { id: 'wikipedia', name: 'Wikipedia', title: 'Wikipedia', icon: 'https://en.wikipedia.org/static/favicon/wikipedia.ico' },
    { id: 'quizlet', name: 'Quizlet', title: 'Quizlet', icon: 'https://assets.quizlet.com/a/j/dist/app/i/logo/2021/q-twilight.aa6cc5d90fdd70c8.png' },
  ];

  const REAL_TITLE = document.title;
  let faviconEl = null;
  function setFavicon(href) {
    if (!faviconEl) {
      faviconEl = document.querySelector('link[rel="icon"]') || document.createElement('link');
      faviconEl.rel = 'icon';
      document.head.appendChild(faviconEl);
    }
    if (!href) { faviconEl.removeAttribute('href'); return; }
    faviconEl.href = href;
  }

  function applyCloak(title, icon) {
    document.title = title || REAL_TITLE;
    setFavicon(icon || '');
  }

  function applyCloakFromSettings() {
    const c = getSettings().cloak;
    if (c.preset) {
      const p = CLOAKS.find((x) => x.id === c.preset);
      if (p) return applyCloak(p.title, p.icon);
    }
    if (c.title || c.icon) return applyCloak(c.title, c.icon);
    applyCloak(REAL_TITLE, '');
  }

  document.addEventListener('visibilitychange', () => {
    const c = getSettings().cloak;
    if (!c.auto) return;
    if (document.hidden) {
      const p = CLOAKS.find((x) => x.id === (c.preset || 'classroom')) || CLOAKS[0];
      applyCloak(p.title, p.icon);
    } else {
      applyCloakFromSettings();
    }
  });

  /* ---------------- panic key ---------------- */
  function panicGo() {
    const p = getSettings().panic;
    if (!p.url) return;
    if (p.mode === 'new') window.open(p.url, '_blank', 'noopener');
    else window.location.href = p.url;
  }

  window.addEventListener('keydown', (e) => {
    const p = getSettings().panic;
    if (!p.on || !p.key) return;
    // don't fire while typing single characters into fields, unless the panic key is a function/special key
    const editable = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (editable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
    if (e.key === p.key || e.code === p.key) {
      e.preventDefault();
      e.stopPropagation();
      panicGo();
    }
  }, true);

  function keyLabel(key) {
    if (!key) return '';
    return key.length === 1 ? key.toUpperCase() : key;
  }

  /* ---------------- BroadcastChannel mesh (cross-window live sync) ---------------- */
  const mesh = (() => {
    let ch = null;
    const handlers = new Set();
    try {
      ch = new BroadcastChannel('lunora-mesh');
      ch.onmessage = (e) => handlers.forEach((h) => { try { h(e.data); } catch {} });
    } catch { /* no BC support */ }
    // storage-event fallback for browsers without BroadcastChannel
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith(NS + 'mesh:')) {
        try { const m = JSON.parse(e.newValue); handlers.forEach((h) => { try { h(m); } catch {} }); } catch {}
      }
    });
    return {
      post(msg) {
        if (ch) { try { ch.postMessage(msg); } catch {} }
        else { try { localStorage.setItem(NS + 'mesh:' + uid(), JSON.stringify(msg)); } catch {} }
      },
      on(cb) { handlers.add(cb); return () => handlers.delete(cb); },
    };
  })();

  /* ---------------- engine status probe ---------------- */
  const engine = {
    async uvReady() {
      if (!('serviceWorker' in navigator)) return false;
      try {
        const r = await fetch('/uv/uv.config.js', { method: 'GET' });
        return r.ok;
      } catch { return false; }
    },
    async scramjetReady() {
      try {
        const a = await fetch('/scramjet/scramjet.js', { method: 'HEAD' });
        const b = await fetch('/controller/controller.api.js', { method: 'HEAD' });
        return a.ok && b.ok;
      } catch { return false; }
    },
    async bareReady() {
      try {
        const r = await fetch('/bare/');
        return r.status < 500; // bare servers answer on their endpoint
      } catch { return false; }
    },
  };

  /* ---------------- apps registry ---------------- */
  const I = (paths, sw = 2, fill = 'none') =>
    `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    games: I('<path d="M6 9h4m-2-2v4"/><circle cx="16.5" cy="9.5" r=".8"/><circle cx="18.5" cy="12.5" r=".8"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6c-.24 2.4-.36 4.8-.4 7.2a2.5 2.5 0 0 0 4.35 1.74L8.7 15h6.6l2.05 2.54A2.5 2.5 0 0 0 21.7 15.8c-.04-2.4-.16-4.8-.4-7.2A4 4 0 0 0 17.32 5z"/>'),
    apps: I('<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>'),
    messenger: I('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    browser: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    ai: I('<path d="M12 2l1.9 5.6a2 2 0 0 0 1.24 1.24L20.7 10.7 15.1 12.6a2 2 0 0 0-1.24 1.24L12 19.4l-1.9-5.6a2 2 0 0 0-1.24-1.24L3.3 10.7l5.6-1.9A2 2 0 0 0 10.1 7.6L12 2z"/><path d="M19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z"/>'),
    weather: I('<path d="M17.5 18a4.5 4.5 0 0 0 .42-8.98 6.5 6.5 0 0 0-12.6 1.74A4 4 0 0 0 6 18.9h11.5z"/>'),
    gif: I('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9v6M12 9v6M16 9v4h-3"/>'),
  };

  const APPS = [
    { id: 'home',      name: 'Home',      icon: 'home' },
    { id: 'games',     name: 'Games',     url: 'games.html',     icon: 'games' },
    { id: 'apps',      name: 'Apps',      url: 'apps.html',      icon: 'apps' },
    { id: 'messenger', name: 'Messenger', url: 'messenger.html', icon: 'messenger' },
    { id: 'browser',   name: 'Browser',   url: 'browser.html',   icon: 'browser' },
    { id: 'weather',   name: 'Weather',   url: 'weather.html',   icon: 'weather' },
    { id: 'settings',  name: 'Settings',  url: 'settings.html',  icon: 'settings' },
    { id: 'ai',        name: 'AI',        url: 'ai.html',        icon: 'ai' },
    { id: 'gifstudio', name: 'GIF Studio', url: 'gifstudio.html', icon: 'gif' },
  ]);

  const QUICK_LINKS = [
    { name: 'youtube',   url: 'https://www.youtube.com',  svg: I('<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-1.92 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.33z"/><path d="m9.75 15.02 5.75-3.27-5.75-3.27v6.54z" fill="currentColor" stroke="none"/>') },
    { name: 'github',    url: 'https://github.com',       svg: I('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>') },
    { name: 'discord',   url: 'https://discord.com',      svg: I('<path d="M8.5 17c-3.5 0-5.5-1.6-5.5-1.6C3.6 9.8 6 6.2 6 6.2 7.6 5 9.3 4.6 9.3 4.6l.4 1.2a12 12 0 0 1 4.6 0l.4-1.2s1.7.4 3.3 1.6c0 0 2.4 3.6 3 9.2 0 0-2 1.6-5.5 1.6l-.9-1.4a10 10 0 0 1-4.2 0L8.5 17z"/><circle cx="9.3" cy="11" r="1"/><circle cx="14.7" cy="11" r="1"/>') },
    { name: 'twitter',   url: 'https://x.com',            svg: I('<path d="M4 4l7.2 9.3L4.4 20h2.2l5.6-5.5L16.8 20H20l-7.5-9.7L18.9 4h-2.2l-5 4.9L8.2 4H4z"/>') },
    { name: 'reddit',    url: 'https://reddit.com',       svg: I('<circle cx="12" cy="13.5" r="6.5"/><circle cx="19.5" cy="7.5" r="1.6"/><path d="M12 7l1-4.5 4.5 1.6"/><circle cx="9.5" cy="13" r=".7" fill="currentColor"/><circle cx="14.5" cy="13" r=".7" fill="currentColor"/><path d="M9.5 16.2c1.5 1.2 3.5 1.2 5 0"/>') },
    { name: 'instagram', url: 'https://instagram.com',    svg: I('<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="17.6" cy="6.4" r=".9" fill="currentColor"/>') },
  ];

  /* ---------------- socials ---------------- */
  const SOCIALS = [
    { name: 'discord', label: 'lunora discord', url: 'https://discord.gg/k2wHsPefZ', mode: 'new' },
  ];

  /* ---------------- weather (open-meteo — free, no key) ---------------- */
  async function getWeather(force) {
    const cache = store.get('weather.cache', null);
    if (!force && cache && Date.now() - cache.ts < 15 * 60000) return cache.data;
    let place = store.get('weather.place', null);
    if (!place) {
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (r.ok) {
          const j = await r.json();
          if (j && j.latitude != null) place = { lat: j.latitude, lon: j.longitude, name: j.city || j.region || 'somewhere' };
        }
      } catch {}
      if (!place) place = { lat: 32.75, lon: -97.33, name: 'DFW, TX' };
      store.set('weather.place', place);
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&temperature_unit=fahrenheit&timezone=auto&forecast_days=6';
    const r = await fetch(url);
    if (!r.ok) throw new Error('weather unavailable');
    const j = await r.json();
    const data = {
      place: place.name,
      temp: Math.round(j.current.temperature_2m),
      code: j.current.weather_code,
      isDay: !!j.current.is_day,
      daily: j.daily.time.map((t, i) => ({
        date: t, code: j.daily.weather_code[i],
        hi: Math.round(j.daily.temperature_2m_max[i]),
        lo: Math.round(j.daily.temperature_2m_min[i]),
      })),
    };
    store.set('weather.cache', { ts: Date.now(), data });
    return data;
  }

  const WEATHER_CODES = {
    0: ['clear sky', '☀️'], 1: ['mostly clear', '🌤️'], 2: ['partly cloudy', '⛅'], 3: ['overcast', '☁️'],
    45: ['fog', '🌫️'], 48: ['rime fog', '🌫️'], 51: ['light drizzle', '🌦️'], 53: ['drizzle', '🌦️'],
    55: ['heavy drizzle', '🌧️'], 61: ['light rain', '🌦️'], 63: ['rain', '🌧️'], 65: ['heavy rain', '🌧️'],
    71: ['light snow', '🌨️'], 73: ['snow', '🌨️'], 75: ['heavy snow', '❄️'], 77: ['snow grains', '🌨️'],
    80: ['rain showers', '🌦️'], 81: ['showers', '🌧️'], 82: ['violent showers', '⛈️'], 85: ['snow showers', '🌨️'],
    86: ['snow showers', '🌨️'], 95: ['thunderstorm', '⛈️'], 96: ['storm + hail', '⛈️'], 99: ['storm + hail', '⛈️'],
  };
  const weatherText = (code) => (WEATHER_CODES[code] || ['unknown', '🌡️'])[0];
  const weatherIcon = (code) => (WEATHER_CODES[code] || ['unknown', '🌡️'])[1];

  /* ---------------- export ---------------- */
  window.Velora = {
    MOTTO, VERSION, MOTTO_NS: NS,
    uid, esc, sha256, toast, timeAgo,
    store, getSettings, saveSettings, patchSettings,
    files, IS_TOP, tellShell, openApp,
    applyAccent, applyCloakFromSettings, applyCloak, CLOAKS,
    mesh, engine, keyLabel, panicGo,
    APPS, ICONS, QUICK_LINKS,
    SOCIALS, getWeather, weatherText, weatherIcon,
  };
  applyAccent();
  applyCloakFromSettings();
})();
