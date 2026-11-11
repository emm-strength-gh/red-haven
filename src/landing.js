// Red Haven hub: library filters and a "jump back in" row of recently played games.
const KEY = 'redhaven-hub-recent';
const cards = [...document.querySelectorAll('#grid .card')];
const filters = [...document.querySelectorAll('.filter')];

document.getElementById('count').textContent = `${cards.length} games`;

function applyFilter(f) {
  let shown = 0;
  for (const c of cards) {
    const on = f === 'all' || c.dataset.tags.split(' ').includes(f);
    c.hidden = !on;
    if (on) shown++;
  }
  for (const b of filters) {
    const on = b.dataset.filter === f;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  document.getElementById('empty').hidden = shown > 0;
  try { sessionStorage.setItem(KEY + '-filter', f); } catch { /* storage unavailable */ }
}
for (const b of filters) b.addEventListener('click', () => applyFilter(b.dataset.filter));
try { const f = sessionStorage.getItem(KEY + '-filter'); if (f && filters.some((b) => b.dataset.filter === f)) applyFilter(f); } catch { /* storage unavailable */ }

// remember what was played, newest first
let recent = [];
try { recent = JSON.parse(localStorage.getItem(KEY)) || []; } catch { recent = []; }
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-game]');
  if (!a) return;
  recent = [a.dataset.game, ...recent.filter((g) => g !== a.dataset.game)].slice(0, 4);
  try { localStorage.setItem(KEY, JSON.stringify(recent)); } catch { /* storage unavailable */ }
});

const byGame = new Map(cards.map((c) => [c.dataset.game, c]));
const row = document.getElementById('recentRow');
for (const id of recent) {
  const c = byGame.get(id);
  if (!c) continue;
  const a = document.createElement('a');
  a.className = 'mini';
  a.href = c.getAttribute('href');
  a.dataset.game = id;
  a.style.cssText = c.getAttribute('style');
  a.innerHTML = `<span class="em">${c.querySelector('.em').textContent}</span><span><b></b><small>Continue playing</small></span>`;
  a.querySelector('b').textContent = c.querySelector('.body b').textContent;
  row.appendChild(a);
}
document.getElementById('recent').hidden = !row.children.length;
