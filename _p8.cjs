const fs = require('fs');
let s = fs.readFileSync('messenger.html', 'utf8');
let n = 0;
const rep = (from, to, name) => {
  if (!s.includes(from)) { console.log('MISSING: ' + name); process.exit(1); }
  s = s.split(from).join(to);
  n++;
};

/* 1. deleted messages vanish completely (no tombstone) */
rep(`        const d = document.createElement('div');
        d.className = 'msg' + (cont ? ' cont' : '') + (m.deleted ? ' deleted' : '');`,
`        if (m.deleted) { prev = m; return; }
        const d = document.createElement('div');
        d.className = 'msg' + (cont ? ' cont' : '');`, 'no tombstone');

/* 2. (edited) marker + left-click action menu */
rep(`        d.querySelectorAll('.mhead b').forEach((b) => b.addEventListener('click', () => openProfile(m.from)));
        msgsEl.appendChild(d);`,
`        if (m.edited) body.querySelector('.mhead').insertAdjacentHTML('beforeend', '<i class="edittag">(edited)</i>');
        /* left-click opens the message menu (edit / delete) */
        d.addEventListener('click', (e) => {
          if (e.target.closest('button, a, img, video, .media, .macts, .mhead b, input, textarea')) return;
          if (m.deleted) return;
          msgMenu(e, m, conv);
        });
        d.querySelectorAll('.mhead b').forEach((b) => b.addEventListener('click', () => openProfile(m.from)));
        msgsEl.appendChild(d);`, 'click menu + edited');

/* 3. msgMenu + edit UI (anchor: exact comment text) */
rep(`      /* =================== profile panel =================== */`,
`      /* ---- left-click message menu: edit / delete ---- */
      function closeMsgMenu() { $('#msgmenu')?.remove(); }
      function msgMenu(e, m, conv0) {
        closeMsgMenu();
        const canEdit = m.from === ME && m.text && !m.deleted;
        const canDelete = isMod() || m.from === ME;
        if (!canEdit && !canDelete) return;
        const menu = document.createElement('div');
        menu.id = 'msgmenu';
        menu.style.cssText = 'position:fixed;z-index:70;min-width:150px;padding:5px;border-radius:11px;border:1px solid var(--line2);background:rgba(12,16,17,.97);box-shadow:var(--shadow)';
        const add = (label, fn, danger) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:transparent;color:' + (danger ? 'var(--danger)' : 'var(--text)') + ';font-size:12.5px;font-weight:700;padding:8px 11px;border-radius:8px;cursor:pointer';
          b.addEventListener('click', () => { closeMsgMenu(); fn(); });
          menu.appendChild(b);
        };
        if (canEdit) add('✏️ edit message', () => startEdit(m, conv0));
        if (canDelete) add('🗑 delete message', async () => {
          const url = conv0.kind === 'channel' ? '/api/channel/' + conv0.id + '/delete/' + m.id
            : conv0.kind === 'dm' ? '/api/dm/' + conv0.id + '/delete/' + m.id
            : '/api/groups/' + conv0.id + '/delete/' + m.id;
          try { await API.api(url, { body: {} }); renderChat(); } catch (err) { toast(err.message); }
        }, true);
        document.body.appendChild(menu);
        menu.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
        menu.style.top = Math.min(e.clientY, innerHeight - 110) + 'px';
      }
      document.addEventListener('click', (e) => { if (!e.target.closest('#msgmenu')) closeMsgMenu(); });

      function startEdit(m, conv0) {
        const row = [...$('#msgs').querySelectorAll('.msg')].find((x) => x.querySelector('.mtext') && x.querySelector('.mtext').textContent === m.text);
        const target = row ? row.querySelector('.mtext') : null;
        if (!target) return;
        const old = m.text;
        target.innerHTML = '';
        const inp = document.createElement('input');
        inp.value = old;
        inp.style.cssText = 'width:100%;height:30px;border-radius:8px;border:1px solid var(--acc-line);background:rgba(0,0,0,.4);color:var(--text);padding:0 10px;outline:0;font-size:13px';
        target.appendChild(inp);
        inp.focus();
        const save = async () => {
          const text = inp.value.trim();
          if (!text || text === old) { target.textContent = old; return; }
          const url = conv0.kind === 'channel' ? '/api/channel/' + conv0.id + '/edit/' + m.id
            : conv0.kind === 'dm' ? '/api/dm/' + conv0.id + '/edit/' + m.id
            : '/api/groups/' + conv0.id + '/edit/' + m.id;
          try { await API.api(url, { body: { text } }); renderChat(); } catch (err) { toast(err.message); target.textContent = old; }
        };
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); save(); }
          if (ev.key === 'Escape') { target.textContent = old; }
        });
      }

      /* =================== profile panel =================== */`, 'msg menu');

/* 4. edited live handling */
rep(`        } else if (m.type === 'message:deleted') {
          const conv = currentConv();
          if (conv && (conv.kind === 'channel' ? conv.id : conv.kind === 'dm' ? [ME, conv.id].sort().join('|') : conv.id) === m.key) renderChat();
        } else if (m.type === 'friend:request') {`,
`        } else if (m.type === 'message:deleted' || m.type === 'message:edited') {
          const conv = currentConv();
          if (conv && (conv.kind === 'channel' ? conv.id : conv.kind === 'dm' ? [ME, conv.id].sort().join('|') : conv.id) === m.key) renderChat();
        } else if (m.type === 'friend:request') {`, 'edited handling');

/* 5. css */
rep(`    .blocked{display:flex;`,
`    .edittag{font-size:9px;color:var(--dim);font-style:italic;font-weight:600;margin-left:5px}
    .blocked{display:flex;`, 'edit css');

fs.writeFileSync('messenger.html', s);
console.log('messenger patched, ' + n + ' changes');
