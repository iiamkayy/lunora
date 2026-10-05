/* ============================================================
   lunora — client API + live socket (talks to server.js)
   ============================================================ */
(() => {
  'use strict';

  const auth = {
    // per-tab session first (sessionStorage) — lets two tabs be two different users,
    // which is what makes cross-account calls/DMs work on one computer
    get() {
      try { const t = sessionStorage.getItem('lunora.auth'); if (t) return JSON.parse(t); } catch {}
      try { return JSON.parse(localStorage.getItem('lunora.auth') || 'null'); } catch { return null; }
    },
    set(v) {
      try {
        if (v) { sessionStorage.setItem('lunora.auth', JSON.stringify(v)); localStorage.setItem('lunora.auth', JSON.stringify(v)); }
        else { sessionStorage.removeItem('lunora.auth'); localStorage.removeItem('lunora.auth'); }
      } catch {}
    },
    token() { return auth.get()?.token || null; },
    username() { return auth.get()?.user?.u || null; },
    logout() { auth.set(null); },
  };

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const t = auth.token();
    if (t) headers.Authorization = 'Bearer ' + t;
    let body = opts.body;
    if (body && !(body instanceof Blob) && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const r = await fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j?.error || 'request failed (' + r.status + ')'); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  async function upload(file) {
    const r = await api('/api/upload?name=' + encodeURIComponent(file.name || 'file'), { method: 'POST', body: file });
    return r; // {id, url, mime}
  }

  /* ---------- live socket with auto-reconnect ---------- */
  const listeners = new Set();
  let ws = null, wsTimer = null, authed = false;
  const online = new Set();

  function connect() {
    if (!auth.token() || ws) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: auth.token() }));
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'auth-ok') { authed = true; online.clear(); (m.online || []).forEach((u) => online.add(u)); emit({ type: 'presence', online: [...online] }); return; }
        if (m.type === 'auth-fail') { auth.logout(); close(); return; }
        if (m.type === 'presence') { online.clear(); (m.online || []).forEach((u) => online.add(u)); }
        emit(m);
      };
      ws.onclose = () => { ws = null; authed = false; setTimeout(connect, 2500); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch { wsTimer = setTimeout(connect, 3000); }
  }
  function close() { try { ws && ws.close(); } catch {} ws = null; }
  function sendRaw(obj) { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} }
  function emit(m) { listeners.forEach((h) => { try { h(m); } catch {} }); }

  function onLive(cb) { listeners.add(cb); connect(); return () => listeners.delete(cb); }
  function isOnline(u) { return online.has(u); }

  window.LunoraAPI = { auth, api, upload, onLive, isLiveAuthed: () => authed, sendRaw, connect, onlineList: () => [...online], isOnline };
})();
