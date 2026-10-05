/* ============================================================
   lunora — server
   ------------------------------------------------------------
   • static site + wisp + bare (proxy engines)
   • REAL backend: JSON-file database (data/db.json) that saves
   • REST API  /api/*  — auth, profiles, friends, dms, groups,
     global channels, uploads, AI (Z.ai GLM via server-side SDK)
   • WebSocket /ws — live messages, presence, call signaling
   ============================================================ */
import http from 'node:http';
import crypto from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3000;

// never let a stray error kill the whole OS
process.on('uncaughtException', (e) => console.error('[uncaught]', e?.message || e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message || e));
const DATA = join(ROOT, 'data');
const FILES = join(DATA, 'files');
mkdirSync(FILES, { recursive: true });

/* ================= database (JSON file, saves to disk) ================= */
const DB_FILE = join(DATA, 'db.json');
const db = existsSync(DB_FILE)
  ? JSON.parse(readFileSync(DB_FILE, 'utf8'))
  : { users: [], tokens: {}, friendRequests: [], friends: [], dms: {}, groups: [], channels: { announcements: [], general: [], links: [], media: [] }, files: {} };
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = DB_FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(db));
      renameSync(tmp, DB_FILE);
    } catch (e) { console.error('[db] save failed:', e.message); }
  }, 250);
}
const uid = () => crypto.randomBytes(9).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const findUser = (u) => db.users.find((x) => x.u === u);
const publicUser = (u) => u && ({ u: u.u, display: u.display, about: u.about || '', avatarId: u.avatarId || null, bannerId: u.bannerId || null, bannerVideo: !!u.bannerVideo, role: u.role, badges: u.badges || [], joined: u.joined, msgCount: u.msgCount || 0 });
const dmKey = (a, b) => [a, b].sort().join('|');

/* ================= Z.ai GLM (server-side AI) ================= */
let zaiClient = null;
let zaiClientTried = false;
async function getZai() {
  if (zaiClientTried) return zaiClient;
  zaiClientTried = true;
  try {
    const mod = await import('z-ai-web-dev-sdk');
    const ZAI = mod.default || mod;
    zaiClient = await ZAI.create();
    console.log('[ai] Z.ai SDK ready (GLM models)');
  } catch (e) {
    zaiClient = null;
    console.warn('[ai] Z.ai SDK not configured — create .z-ai-config (see .z-ai-config.example) or set ZAI_API_KEY');
  }
  return zaiClient;
}
const AI_MODEL = process.env.ZAI_MODEL || 'glm-4.5-flash';
async function aiChat(messages, maxTokens = 800) {
  const zai = await getZai();
  if (zai) {
    const res = await zai.chat.completions.create({ model: AI_MODEL, messages, max_tokens: maxTokens });
    const text = res?.choices?.[0]?.message?.content;
    if (text) return text;
    throw new Error('empty GLM response');
  }
  // env fallback: direct OpenAI-compatible call to the Z.ai open platform
  const key = process.env.ZAI_API_KEY, base = process.env.ZAI_API_BASE || 'https://api.z.ai/api/paas/v4';
  if (key) {
    const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens }),
    });
    if (!r.ok) throw new Error('GLM api error ' + r.status);
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content;
    if (text) return text;
    throw new Error('empty GLM response');
  }
  const err = new Error('AI_NOT_CONFIGURED');
  err.code = 'AI_NOT_CONFIGURED';
  throw err;
}

const AI_SYSTEM = `You are Lunora AI, the assistant inside "lunora", a web desktop made for students, running on GLM. You are a real AI — answer ANY question well: math (show steps for word problems), reading & writing, science, history, tech help, advice, coding, creative writing. Keep it school-appropriate. Friendly, concise, light emoji use.

Facts: lunora's motto is "For MISD X AISD students by MISD X AISD students". The creators are students who stay anonymous — never invent names, schools, or personal info about them. Apps: Games (huge library + Figure + Lumin), Apps (youtube, spotify, geforce now, anime via anigato.lol, VM, weather), Messenger (global channels with AI moderation, contacts, group chats, audio & video calls), Browser (Scramjet v2 default, Ultraviolet, Direct; DuckDuckGo search), Settings (live wallpapers, tab cloaks, panic key). You always identify as an AI if asked.`;

/* AI moderation for GLOBAL channels only — DMs/groups stay uncensored */
async function aiModerate(text) {
  if (!text || !text.trim()) return { ok: true, unmoderated: true };
  try {
    const raw = await aiChat([
      { role: 'system', content: 'You are a chat moderation filter. Decide if a chat message contains profanity, slurs, harassment, sexual content, or drug/violent-crime solicitation. Reply with ONLY compact JSON: {"flagged":true,"reason":"short reason"} or {"flagged":false}. No other text.' },
      { role: 'user', content: text.slice(0, 500) },
    ], 200);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ok: true, unmoderated: true };
    const j = JSON.parse(m[0]);
    return j.flagged ? { ok: false, reason: j.reason || 'inappropriate content' } : { ok: true, moderated: true };
  } catch (e) {
    return { ok: true, unmoderated: true }; // never break chat because the AI is down
  }
}

/* ================= optional backends for the proxy engines ================= */
let wisp = null, bareServer = null;
try {
  const mod = await import('@mercuryworkshop/wisp-js/server');
  wisp = mod.server;
  console.log('[proxy] wisp server: ready');
} catch { console.warn('[proxy] wisp: not installed (npm i @mercuryworkshop/wisp-js)'); }
try {
  const mod = await import('@nebula-services/bare-server-node');
  const createBareServer = mod.createBareServer || mod.default?.createBareServer;
  if (createBareServer) { bareServer = createBareServer('/bare/'); console.log('[proxy] bare server: ready'); }
} catch { console.warn('[proxy] bare: not installed'); }

/* ================= websocket (live sync + call signaling) ================= */
let WS = null;
try {
  const mod = await import('ws');
  WS = mod.WebSocketServer || mod.default?.WebSocketServer || mod.default; // the SERVER class, not the client
} catch {}
const sockets = new Map(); // username -> Set<ws>
function wsSend(user, obj) {
  for (const s of sockets.get(user) || []) { try { s.send(JSON.stringify(obj)); } catch {} }
}
function wsBroadcast(obj, exceptUser = null) {
  for (const [u, set] of sockets) {
    if (u === exceptUser) continue;
    for (const s of set) { try { s.send(JSON.stringify(obj)); } catch {} }
  }
}
const presenceList = () => [...sockets.keys()];
const pendingCalls = {}; // username -> {from, mode, sdp, ts} — re-delivered when their messenger connects
function handleUpgrade(req, socket, head) {
  try {
    if (bareServer && bareServer.shouldRoute(req)) return bareServer.routeUpgrade(req, socket, head);
    if (req.url.startsWith('/ws') && WS) {
      const wss = new WS({ noServer: true });
      wss.handleUpgrade(req, socket, head, (ws) => {
        let user = null;
        ws.on('message', (raw) => {
          let m; try { m = JSON.parse(raw); } catch { return; }
          if (m.type === 'auth') {
            const u = db.tokens[m.token];
            if (u) {
              user = u;
              if (!sockets.has(u)) sockets.set(u, new Set());
              sockets.get(u).add(ws);
              wsBroadcast({ type: 'presence', online: presenceList() });
              ws.send(JSON.stringify({ type: 'auth-ok', user: u, online: presenceList() }));
              const pcall = pendingCalls[u];
              if (pcall) {
                if (Date.now() - pcall.ts < 45000) ws.send(JSON.stringify({ type: 'call', from: pcall.from, kind: 'offer', mode: pcall.mode, sdp: pcall.sdp }));
                else delete pendingCalls[u];
              }
            } else ws.send(JSON.stringify({ type: 'auth-fail' }));
            return;
          }
          if (!user) return;
          if (m.type === 'call' && m.to && findUser(m.to)) {
            if (m.kind === 'offer') pendingCalls[m.to] = { from: user, mode: m.mode || 'audio', sdp: m.sdp, ts: Date.now() };
            if (m.kind === 'answer' || m.kind === 'end') {
              for (const k of Object.keys(pendingCalls)) if (pendingCalls[k].from === user || k === user) delete pendingCalls[k];
            }
            wsSend(m.to, { type: 'call', from: user, kind: m.kind, mode: m.mode, sdp: m.sdp, cand: m.cand, reason: m.reason });
          }
        });
        ws.on('close', () => {
          if (user && sockets.get(user)) {
            sockets.get(user).delete(ws);
            if (!sockets.get(user).size) { sockets.delete(user); wsBroadcast({ type: 'presence', online: presenceList() }); }
          }
        });
        ws.on('error', () => {});
      });
      return;
    }
    if (wisp) return wisp.routeRequest(req, socket, head);
    socket.destroy();
  } catch (e) {
    console.error('[ws] upgrade error:', e.message);
    try { socket.destroy(); } catch {}
  }
}

/* ================= helpers ================= */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function readBody(req, limit = 1024 * 1024) {
  return new Promise((res, rej) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { rej(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { return {}; }
}
function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const u = token && db.tokens[token];
  return u ? { user: findUser(u), token } : {};
}
const isMod = (u) => u && (u.role === 'owner' || u.role === 'mod');

/* ================= api router ================= */
async function handleApi(req, res, pathname) {
  const send = (code, obj) => json(res, code, obj);
  const parts = pathname.split('/').filter(Boolean);

  function validGif(u) {
    try { const x = new URL(u); return x.protocol === 'https:' && ['.tenor.com', '.giphy.com', '.imgflip.com'].some((h) => x.hostname.endsWith(h)) ? x.href : null; } catch { return null; }
  }
  if (pathname === '/api/favs' && req.method === 'GET') {
    return send(200, { favs: (db.favs || []).filter((f) => f.by === user.u) });
  }
  if (pathname === '/api/favs' && req.method === 'POST') {
    const b = await readJson(req);
    const url = validGif(b.url);
    if (!url) return send(400, { error: 'invalid gif url' });
    db.favs = db.favs || [];
    if (!db.favs.some((f) => f.url === url && f.by === user.u)) {
      db.favs.push({ id: uid(), url, desc: String(b.desc || '').slice(0, 100), by: user.u, ts: Date.now() });
      saveDb();
    }
    return send(200, { ok: true });
  }
  if (pathname === '/api/favs/delete' && req.method === 'POST') {
    const b = await readJson(req);
    db.favs = (db.favs || []).filter((f) => !(f.id === b.id && f.by === user.u));
    saveDb();
    return send(200, { ok: true });
  }

  if (pathname === '/api/gifs' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    const out = [];
    try {
      // 1. tenor v2 (if the host owner set TENOR_KEY)
      if (process.env.TENOR_KEY) {
        const url = 'https://g.tenor.com/v2/' + (q.trim() ? 'search?q=' + encodeURIComponent(q) : 'featured') + '?key=' + process.env.TENOR_KEY + '&limit=24&media_filter=tinygif';
        const j = await (await fetch(url)).json();
        for (const x of j.results || []) {
          const u = x.media_formats?.tinygif?.url;
          if (u) out.push({ id: x.id, url: u, desc: x.content_description || '' });
        }
      }
      // 2. giphy public key — real gif search, no account needed
      if (!out.length) {
        const gk = process.env.GIPHY_KEY || 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';
        const url = 'https://api.giphy.com/v1/gifs/' + (q.trim() ? 'search?api_key=' + gk + '&q=' + encodeURIComponent(q) : 'trending?api_key=' + gk) + '&limit=24&rating=pg-13';
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          for (const x of j.data || []) {
            const u = x.images?.fixed_height?.url || x.images?.original?.url;
            if (u) out.push({ id: x.id, url: u, desc: x.title || '' });
          }
        }
      }
      // 3. imgflip memes — fully keyless last resort
      if (!out.length) {
        const j = await (await fetch('https://api.imgflip.com/get_memes')).json();
        const q2 = q.trim().toLowerCase();
        for (const x of (j.data?.memes || [])) {
          if (!q2 || x.name.toLowerCase().includes(q2)) out.push({ id: x.id, url: x.url, desc: x.name });
          if (out.length >= 24) break;
        }
      }
      return send(200, { gifs: out });
    } catch (e) { return send(502, { error: 'gif service unavailable' }); }
  }

  if (pathname === '/api/ai/status') {
    const zai = await getZai();
    return send(200, { configured: !!zai || !!process.env.ZAI_API_KEY, model: AI_MODEL });
  }

  /* ---- auth ---- */
  if (pathname === '/api/register' && req.method === 'POST') {
    const b = await readJson(req);
    const u = String(b.username || '').trim().toLowerCase();
    const display = String(b.display || '').trim().slice(0, 32) || u;
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return send(400, { error: 'username: 3-20 chars, a-z 0-9 _' });
    if (String(b.password || '').length < 4) return send(400, { error: 'password: at least 4 characters' });
    if (findUser(u)) return send(400, { error: 'username taken' });
    const first = db.users.length === 0;
    const user = {
      u, display, hash: sha256(String(b.password)), about: '',
      joined: Date.now(), role: first ? 'owner' : 'member', banned: false, mutedUntil: 0,
      badges: first ? ['owner', 'og'] : [], msgCount: 0, avatarId: null, bannerId: null, bannerVideo: false,
    };
    db.users.push(user);
    const token = uid() + uid();
    db.tokens[token] = u;
    saveDb();
    return send(200, { token, user: publicUser(user) });
  }
  if (pathname === '/api/login' && req.method === 'POST') {
    const b = await readJson(req);
    const user = findUser(String(b.username || '').trim().toLowerCase());
    if (!user) return send(400, { error: 'no account with that username' });
    if (user.banned) return send(403, { error: 'this account is banned' });
    if (user.hash !== sha256(String(b.password || ''))) return send(400, { error: 'wrong password' });
    const token = uid() + uid();
    db.tokens[token] = user.u;
    saveDb();
    return send(200, { token, user: publicUser(user) });
  }

  /* ---- everything below needs auth ---- */
  const { user } = authUser(req);
  if (!user) return send(401, { error: 'not signed in' });

  if (pathname === '/api/me' && req.method === 'GET') return send(200, { user: publicUser(user) });

  if (pathname === '/api/profile' && req.method === 'POST') {
    const b = await readJson(req);
    if (b.display !== undefined) user.display = String(b.display).trim().slice(0, 32) || user.u;
    if (b.about !== undefined) user.about = String(b.about).slice(0, 400);
    if (b.avatarId !== undefined) user.avatarId = b.avatarId;
    if (b.bannerId !== undefined) { user.bannerId = b.bannerId; user.bannerVideo = !!b.bannerVideo; }
    saveDb();
    const pub = publicUser(user);
    wsBroadcast({ type: 'profile', user: pub });
    return send(200, { user: pub });
  }
  if (parts[1] === 'user' && parts[2] && req.method === 'GET') return send(200, { user: publicUser(findUser(parts[2])) || null });
  if (pathname === '/api/users' && req.method === 'GET') return send(200, { users: db.users.map(publicUser) });
  if (parts[1] === 'user' && parts[2] && parts[3] === 'role' && req.method === 'POST') {
    if (user.role !== 'owner') return send(403, { error: 'only the owner can change roles' });
    const target = findUser(parts[2]);
    if (!target) return send(404, { error: 'no such user' });
    const b = await readJson(req);
    if (!['mod', 'member'].includes(b.role)) return send(400, { error: 'bad role' });
    if (target.role === 'owner') return send(400, { error: "can't change the owner" });
    target.role = b.role;
    target.badges = (target.badges || []).filter((x) => x !== 'mod').concat(b.role === 'mod' ? ['mod'] : []);
    saveDb();
    wsSend(target.u, { type: 'profile', user: publicUser(target) });
    return send(200, { user: publicUser(target) });
  }

  /* ---- uploads (avatars, banners, chat media) ---- */
  if (pathname === '/api/upload' && req.method === 'POST') {
    try {
      const buf = await readBody(req, 30 * 1024 * 1024);
      const id = uid();
      const mime = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];
      writeFileSync(join(FILES, id), buf);
      db.files[id] = { mime, name: decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('name') || 'file'), size: buf.length, by: user.u, ts: Date.now() };
      saveDb();
      return send(200, { id, url: '/files/' + id, mime });
    } catch (e) { return send(400, { error: e.message }); }
  }

  /* ---- friends (real requests, stored server-side) ---- */
  if (pathname === '/api/friends' && req.method === 'GET') {
    const accepted = db.friends.filter((f) => f.a === user.u || f.b === user.u)
      .map((f) => publicUser(findUser(f.a === user.u ? f.b : f.a))).filter(Boolean);
    const incoming = db.friendRequests.filter((r) => r.to === user.u)
      .map((r) => ({ user: publicUser(findUser(r.from)), ts: r.ts })).filter((x) => x.user);
    const outgoing = db.friendRequests.filter((r) => r.from === user.u)
      .map((r) => ({ user: publicUser(findUser(r.to)), ts: r.ts })).filter((x) => x.user);
    return send(200, { accepted, incoming, outgoing });
  }
  if (pathname === '/api/friends/request' && req.method === 'POST') {
    const b = await readJson(req);
    const target = findUser(String(b.username || '').trim().toLowerCase());
    if (!target) return send(404, { error: 'no account with that username yet — they need to sign up on this server first' });
    if (target.u === user.u) return send(400, { error: "that's you" });
    if (db.friends.some((f) => (f.a === user.u && f.b === target.u) || (f.a === target.u && f.b === user.u))) return send(400, { error: 'already contacts' });
    const reverse = db.friendRequests.findIndex((r) => r.from === target.u && r.to === user.u);
    if (reverse !== -1) {
      db.friendRequests.splice(reverse, 1);
      db.friends.push({ a: user.u, b: target.u, since: Date.now() });
      saveDb();
      wsSend(target.u, { type: 'friend:accepted', user: publicUser(user) });
      return send(200, { ok: true, accepted: true });
    }
    if (db.friendRequests.some((r) => r.from === user.u && r.to === target.u)) return send(400, { error: 'request already sent' });
    const reqObj = { id: uid(), from: user.u, to: target.u, ts: Date.now() };
    db.friendRequests.push(reqObj);
    saveDb();
    wsSend(target.u, { type: 'friend:request', from: publicUser(user), ts: reqObj.ts });
    return send(200, { ok: true, sent: true });
  }
  if (pathname === '/api/friends/respond' && req.method === 'POST') {
    const b = await readJson(req);
    const i = db.friendRequests.findIndex((r) => r.from === b.username && r.to === user.u);
    if (i === -1) return send(404, { error: 'no request from that user' });
    const from = db.friendRequests[i].from;
    db.friendRequests.splice(i, 1);
    if (b.accept) {
      db.friends.push({ a: user.u, b: from, since: Date.now() });
      wsSend(from, { type: 'friend:accepted', user: publicUser(user) });
    }
    saveDb();
    return send(200, { ok: true });
  }
  if (pathname === '/api/friends/remove' && req.method === 'POST') {
    const b = await readJson(req);
    db.friends = db.friends.filter((f) => !((f.a === user.u && f.b === b.username) || (f.a === b.username && f.b === user.u)));
    saveDb();
    return send(200, { ok: true });
  }

  /* ---- direct messages (uncensored) ---- */
  if (parts[1] === 'dm' && parts[2]) {
    const other = findUser(parts[2]);
    if (!other) return send(404, { error: 'no such user' });
    const key = dmKey(user.u, other.u);
    if (req.method === 'GET') return send(200, { msgs: db.dms[key] || [] });
    if (parts[3] === 'edit' && parts[4] && req.method === 'POST') {
      const msg = (db.dms[key] || []).find((m) => m.id === parts[4]);
      if (!msg) return send(404, { error: 'message not found' });
      if (msg.from !== user.u) return send(403, { error: 'you can only edit your own messages' });
      msg.text = String((await readJson(req)).text || '').slice(0, 2000);
      msg.edited = true;
      saveDb();
      const payload = { type: 'message:edited', scope: 'dm', key, id: msg.id, text: msg.text };
      wsSend(user.u, payload); wsSend(other.u, payload);
      return send(200, { ok: true, text: msg.text });
    }
    if (parts[3] === 'delete' && parts[4] && req.method === 'POST') {
      const msg = (db.dms[key] || []).find((m) => m.id === parts[4]);
      if (!msg) return send(404, { error: 'message not found' });
      if (msg.from !== user.u) return send(403, { error: 'you can only delete your own messages' });
      db.dms[key].splice(db.dms[key].indexOf(msg), 1);
      saveDb();
      const payload = { type: 'message:deleted', scope: 'dm', key, id: msg.id };
      wsSend(user.u, payload); wsSend(other.u, payload);
      return send(200, { ok: true });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const msg = { id: uid(), from: user.u, ts: Date.now(), text: String(b.text || '').slice(0, 2000), gif: validGif(b.gif), mediaId: b.mediaId || null, mediaMime: b.mediaMime || null, mediaName: b.mediaName || null, deleted: false };
      (db.dms[key] = db.dms[key] || []).push(msg);
      user.msgCount = (user.msgCount || 0) + 1;
      saveDb();
      const payload = { type: 'message', scope: 'dm', key, msg: { ...msg, mediaUrl: msg.mediaId ? '/files/' + msg.mediaId : null } };
      wsSend(user.u, payload); wsSend(other.u, payload);
      return send(200, { msg: payload.msg });
    }

  }

  /* ---- group chats (uncensored) ---- */
  if (pathname === '/api/groups' && req.method === 'GET') return send(200, { groups: db.groups.filter((g) => g.members.includes(user.u)) });
  if (pathname === '/api/groups' && req.method === 'POST') {
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) return send(400, { error: 'name required' });
    const members = [...new Set([user.u, ...(b.members || []).filter((m) => findUser(m))])];
    const g = { id: uid(), name, owner: user.u, members, msgs: [] };
    db.groups.push(g);
    saveDb();
    return send(200, { group: g });
  }
  if (parts[1] === 'groups' && parts[2]) {
    const g = db.groups.find((x) => x.id === parts[2] && x.members.includes(user.u));
    if (!g) return send(404, { error: 'group not found' });
    if (req.method === 'GET') return send(200, { group: g });
    if (parts[3] === 'edit' && parts[4] && req.method === 'POST') {
      const msg = g.msgs.find((m) => m.id === parts[4]);
      if (!msg) return send(404, { error: 'message not found' });
      if (msg.from !== user.u) return send(403, { error: 'you can only edit your own messages' });
      msg.text = String((await readJson(req)).text || '').slice(0, 2000);
      msg.edited = true;
      saveDb();
      for (const m of g.members) wsSend(m, { type: 'message:edited', scope: 'group', key: g.id, id: msg.id, text: msg.text });
      return send(200, { ok: true, text: msg.text });
    }
    if (parts[3] === 'delete' && parts[4] && req.method === 'POST') {
      const msg = g.msgs.find((m) => m.id === parts[4]);
      if (!msg) return send(404, { error: 'message not found' });
      if (msg.from !== user.u && g.owner !== user.u) return send(403, { error: 'only the group owner can delete other people\'s messages' });
      g.msgs.splice(g.msgs.indexOf(msg), 1);
      saveDb();
      for (const m of g.members) wsSend(m, { type: 'message:deleted', scope: 'group', key: g.id, id: msg.id });
      return send(200, { ok: true });
    }
    if (parts[3] === 'message' && req.method === 'POST') {
      const b = await readJson(req);
      const msg = { id: uid(), from: user.u, ts: Date.now(), text: String(b.text || '').slice(0, 2000), gif: validGif(b.gif), mediaId: b.mediaId || null, mediaMime: b.mediaMime || null, mediaName: b.mediaName || null, deleted: false };
      g.msgs.push(msg);
      user.msgCount = (user.msgCount || 0) + 1;
      saveDb();
      for (const m of g.members) wsSend(m, { type: 'message', scope: 'group', key: g.id, msg: { ...msg, mediaUrl: msg.mediaId ? '/files/' + msg.mediaId : null } });
      return send(200, { msg: payload_msg(msg) });
    }

    if (parts[3] === 'members' && req.method === 'POST' && g.owner === user.u) {
      const b = await readJson(req);
      for (const m of b.usernames || []) if (findUser(m) && !g.members.includes(m)) g.members.push(m);
      saveDb();
      return send(200, { group: g });
    }
  }

  /* ---- global channels (AI-moderated) ---- */
  if (parts[1] === 'channel' && parts[2]) {
    const name = parts[2];
    if (!db.channels[name]) return send(404, { error: 'no such channel' });
    if (req.method === 'GET') return send(200, { msgs: db.channels[name].slice(-200) });
    if (parts[3] === 'edit' && parts[4] && req.method === 'POST') {
      const msg = (db.channels[name] || []).find((m) => m.id === parts[4]);
      if (!msg) return send(404, { error: 'message not found' });
      if (msg.from !== user.u) return send(403, { error: 'you can only edit your own messages' });
      msg.text = String((await readJson(req)).text || '').slice(0, 2000);
      msg.edited = true;
      saveDb();
      wsBroadcast({ type: 'message:edited', scope: 'channel', key: name, id: msg.id, text: msg.text });
      return send(200, { ok: true, text: msg.text });
    }
    if (parts[3] === 'delete' && parts[4] && req.method === 'POST') {
      const msg = (db.channels[name] || []).find((m) => m.id === parts[4]);
      if (!msg) return send(404, { error: 'message not found' });
      if (!isMod(user) && msg.from !== user.u) return send(403, { error: 'only mods can delete other people\'s messages' });
      db.channels[name].splice(db.channels[name].indexOf(msg), 1);
      saveDb();
      wsBroadcast({ type: 'message:deleted', scope: 'channel', key: name, id: msg.id });
      return send(200, { ok: true });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      if (name === 'announcements' && !isMod(user)) return send(403, { error: 'only mods can post in announcements' });
      const text = String(b.text || '').slice(0, 2000);
      const gif = validGif(b.gif);
      const mod = await aiModerate(text);
      if (!mod.ok) {
        return send(422, { moderated: true, reason: mod.reason, ai: true });
      }
      const msg = { id: uid(), from: user.u, ts: Date.now(), text, gif, mediaId: b.mediaId || null, mediaMime: b.mediaMime || null, mediaName: b.mediaName || null, deleted: false, unmoderated: !!mod.unmoderated };
      db.channels[name].push(msg);
      user.msgCount = (user.msgCount || 0) + 1;
      saveDb();
      const payload = { type: 'message', scope: 'channel', key: name, msg: { ...msg, mediaUrl: msg.mediaId ? '/files/' + msg.mediaId : null } };
      wsBroadcast(payload);
      return send(200, { msg: payload.msg });
    }

  }

  /* ---- AI (GLM via Z.ai SDK — server-side, no keys in the browser) ---- */
  if (pathname === '/api/ai/chat' && req.method === 'POST') {
    const b = await readJson(req);
    const msgs = (b.messages || []).slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));
    try {
      const text = await aiChat([{ role: 'system', content: AI_SYSTEM }, ...msgs]);
      return send(200, { text, ai: true, model: 'GLM' });
    } catch (e) {
      if (String(e.message).includes('AI_NOT_CONFIGURED') || e.code === 'AI_NOT_CONFIGURED') {
        return send(503, { error: 'AI is not configured on this server yet. Add your Z.ai key: create a .z-ai-config file (see .z-ai-config.example) or set ZAI_API_KEY, then restart server.js.', code: 'AI_NOT_CONFIGURED', ai: true });
      }
      return send(502, { error: 'GLM request failed: ' + e.message, ai: true });
    }
  }

  return send(404, { error: 'unknown api route' });
}
const payload_msg = (m) => ({ ...m, mediaUrl: m.mediaId ? '/files/' + m.mediaId : null });

/* ================= static files ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  if (!existsSync(join(ROOT, normalize(path))) && existsSync(join(ROOT, normalize(path) + '.html'))) path += '.html';
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  let stat; try { stat = statSync(file); } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('404 — not found');
  }
  if (stat.isDirectory()) return serveStatic({ ...req, url: path + '/index.html' }, res);
  const ext = extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' };
  if (ext === '.js' || ext === '.mjs') headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/* ================= http server ================= */
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (bareServer && bareServer.shouldRoute(req)) return bareServer.routeRequest(req, res);
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (pathname.startsWith('/files/')) {
      const id = pathname.slice(7).replace(/[^a-z0-9]/g, '');
      const meta = db.files[id];
      const file = join(FILES, id);
      if (!meta || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': meta.mime, 'Cache-Control': 'public, max-age=604800', 'Content-Length': statSync(file).size });
      return createReadStream(file).pipe(res);
    }
    return serveStatic(req, res);
  } catch (e) {
    console.error('[server]', e);
    try { json(res, 500, { error: 'server error' }); } catch {}
  }
});

server.on('upgrade', handleUpgrade);

server.listen(PORT, () => {
  console.log('');
  console.log('  lunora is live ✨  →  http://localhost:' + PORT);
  console.log('  database : data/db.json (saves automatically)');
  console.log(`  ai       : ${AI_MODEL} ${zaiClient || process.env.ZAI_API_KEY ? '(Z.ai key found ✓)' : '— NOT configured (create .z-ai-config, see .z-ai-config.example)'}`);
  console.log(`  engines  : wisp ${wisp ? '✓' : '✗'} · bare ${bareServer ? '✓' : '✗'}`);
  console.log('');
});
