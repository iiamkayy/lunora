const fs = require('fs');
let s = fs.readFileSync('shared.js', 'utf8');
const must = (c, n) => { if (!c) { console.log('FAIL: ' + n); process.exit(1); } };

/* register the GIF Studio app */
must(s.includes(`    { id: 'ai',        name: 'AI',        url: 'ai.html',        icon: 'ai' },
  ];`), 'apps registry');
s = s.replace(`    { id: 'ai',        name: 'AI',        url: 'ai.html',        icon: 'ai' },
  ];`,
`    { id: 'ai',        name: 'AI',        url: 'ai.html',        icon: 'ai' },
    { id: 'gifstudio', name: 'GIF Studio', url: 'gifstudio.html', icon: 'gif' },
  ];`);

/* icon for it */
must(s.includes(`    weather: I('<path d="M17.5 18a4.5 4.5 0 0 0 .42-8.98 6.5 6.5 0 0 0-12.6 1.74A4 4 0 0 0 6 18.9h11.5z"/>'),`), 'icon anchor');
s = s.replace(`    weather: I('<path d="M17.5 18a4.5 4.5 0 0 0 .42-8.98 6.5 6.5 0 0 0-12.6 1.74A4 4 0 0 0 6 18.9h11.5z"/>'),`,
`    weather: I('<path d="M17.5 18a4.5 4.5 0 0 0 .42-8.98 6.5 6.5 0 0 0-12.6 1.74A4 4 0 0 0 6 18.9h11.5z"/>'),
    gif: I('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9v6M12 9v6M16 9v4h-3"/>'),`);

/* dock color for it */
must(s.includes(`          weather: 'linear-gradient(145deg,#fbbf24,#d97706)',`), 'dock colors');
s = s.replace(`          weather: 'linear-gradient(145deg,#fbbf24,#d97706)',`,
`          weather: 'linear-gradient(145deg,#fbbf24,#d97706)',
          gifstudio: 'linear-gradient(145deg,#f472b6,#7c3aed)',`);

fs.writeFileSync('shared.js', s);
console.log('GIF Studio app registered ✓');

/* ---------- messenger gif picker: favorites tab ---------- */
let m = fs.readFileSync('messenger.html', 'utf8');
const mst = (c, n2) => { if (!c) { console.log('FAIL: ' + n2); process.exit(1); } };

mst(m.includes(`        gifPop.innerHTML = '<div class="etabs"><input placeholder="search tenor…" /></div><div class="ggrid"></div>';`), 'gifpop');
m = m.replace(`        gifPop.innerHTML = '<div class="etabs"><input placeholder="search tenor…" /></div><div class="ggrid"></div>';`,
`        gifPop.innerHTML = '<div class="etabs"><input placeholder="search gifs…" /><button id="gp-fav" title="my favorites" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer">⭐</button></div><div class="ggrid"></div>';`);

mst(m.includes(`        gifBtn.addEventListener('click', () => { gifPop.classList.toggle('open'); emojiPop.classList.remove('open'); if (gifPop.classList.contains('open') && !gifPop.querySelector('.ggrid img')) loadGifs(''); });`), 'gifbtn handler');
m = m.replace(`        gifBtn.addEventListener('click', () => { gifPop.classList.toggle('open'); emojiPop.classList.remove('open'); if (gifPop.classList.contains('open') && !gifPop.querySelector('.ggrid img')) loadGifs(''); });`,
`        gifPop.querySelector('#gp-fav').addEventListener('click', async () => {
          const grid = gifPop.querySelector('.ggrid');
          grid.innerHTML = '<div class="dimtxt" style="padding:10px">loading favorites…</div>';
          try {
            const r = await API.api('/api/favs');
            grid.innerHTML = '';
            if (!(r.favs || []).length) { grid.innerHTML = '<div class="dimtxt" style="padding:10px">no favorites yet — star gifs in the GIF Studio app</div>'; return; }
            for (const g of r.favs) {
              const img = document.createElement('img');
              img.src = g.url; img.loading = 'lazy';
              img.addEventListener('click', () => { gifPop.classList.remove('open'); send(null, null, g.url); });
              grid.appendChild(img);
            }
          } catch { grid.innerHTML = '<div class="dimtxt" style="padding:10px">could not load favorites</div>'; }
        });
        gifBtn.addEventListener('click', () => { gifPop.classList.toggle('open'); emojiPop.classList.remove('open'); if (gifPop.classList.contains('open') && !gifPop.querySelector('.ggrid img')) loadGifs(''); });`);

fs.writeFileSync('messenger.html', m);
console.log('messenger favorites tab ✓');
