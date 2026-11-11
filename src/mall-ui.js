// Little Cup Plaza — DOM interface: directory title, lease picker, HUD, build drawers, inspector, reports.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const starStr = (s) => { const f = Math.round(s); let o = ''; for (let i = 1; i <= 5; i++) o += f >= i ? '★' : '☆'; return o; };
const pct = (n) => Math.round(n) + '%';
const bar = (v, cls = '') => `<div class="bar ${cls || (v < 30 ? 'bad' : v < 60 ? 'warn' : '')}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
const fmtTime = (m) => { const h = Math.floor(m / 60) % 24, mm = Math.floor(m % 60); return `${h}:${String(mm).padStart(2, '0')}`; };
const CAT_COLOR = { food: '#e9a46b', fashion: '#c58fd9', essentials: '#6f9a7a', leisure: '#c9a27a', tech: '#5a86c5', fun: '#e0674f', service: '#8fb3d9' };
const LEASE_COLORS = { normal: '#2f7a6a', challenge: '#d08a3a', expert: '#b4432f', sandbox: '#5a86c5' };
const COMPLAINT_TEXT = { parking: '🅿️ Couldn’t park', toilet: '🚻 No restroom', food: '🍽️ Nowhere to eat', seats: '🪑 Nowhere to sit', crowded: '😤 Queues too long', closed: '⛔ Shop closed', broken: '🔧 Broken shop', stock: '📦 Sold out', pricey: '💸 Too pricey', litter: '🗑️ Litter', lost: '🧭 Couldn’t get there', leak: '💧 Leak' };

export function createUI(api) {
  const { L, money } = api;
  const act = api.act;
  const S = () => api.S, R = () => api.R;
  let panel = null, inspected = null, hoverDrawer = false, hoverInsp = false, modalKind = null;

  // ------------------------------------------------------------ toast
  let toastT = null;
  function toast(msg, kind = '', ms = 3200) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast ' + (kind === 'tip' ? '' : kind); t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------ title
  function showTitle() {
    for (const id of ['hud', 'dock', 'drawer', 'inspector', 'toolHint', 'goalTicker', 'openDay']) $(id).hidden = true;
    closeModal(true);
    $('title').hidden = false; $('leases').hidden = true; $('howto').hidden = true;
    const last = api.save.last && api.save.slots[api.save.last];
    $('tContinue').hidden = !last;
    if (last) $('tContinueSub').textContent = `${L.DIFFICULTY[last.diff].name} · Day ${last.day} · ${last.sandbox ? 'Sandbox' : money(last.cash)}`;
    $('tSoundSub').textContent = api.save.sound ? (api.save.music ? 'On · music on' : 'On · music off') : 'Off';
  }
  function leaseCards(ids) {
    $('leaseRow').innerHTML = ids.map((id) => {
      const d = L.DIFFICULTY[id], slot = api.save.slots[id];
      return `<div class="lease" style="--c:${LEASE_COLORS[id]}">
        <span class="clause">LEASE AGREEMENT · ${id === 'sandbox' ? 'FREEHOLD' : 'CLAUSE ' + (['normal', 'challenge', 'expert'].indexOf(id) + 1)}</span>
        <h3>${d.name}</h3><p>${d.desc}</p>
        <dl><dt>Starting funds</dt><dd>${d.cash === Infinity ? 'Unlimited' : money(d.cash)}</dd>
        <dt>Build costs</dt><dd>${d.costMul === 1 ? 'Standard' : '+' + Math.round((d.costMul - 1) * 100) + '%'}</dd>
        <dt>Shoppers</dt><dd>${d.pickiness === 1 ? 'Easy-going' : d.pickiness < 1.3 ? 'Picky' : 'Very picky'}</dd>
        <dt>Trouble</dt><dd>${d.events < 1 ? 'Rare' : d.events === 1 ? 'Normal' : d.events < 1.5 ? 'Frequent' : 'Constant'}</dd></dl>
        ${slot ? `<span class="exists">Saved mall · Day ${slot.day}</span>` : ''}
        <div class="sign"><i>x&nbsp;${id === 'sandbox' ? 'freehold' : 'sign here'}</i>
          <div class="row">${slot ? `<button class="btn ghost sm" data-new="${id}">Start over</button><button class="btn sm" data-cont="${id}" style="background:${LEASE_COLORS[id]}">Continue</button>` : `<button class="btn" data-new="${id}" style="background:${LEASE_COLORS[id]}">Sign &amp; open</button>`}</div></div>
      </div>`;
    }).join('');
    $('leases').hidden = false;
  }
  $('leaseRow').addEventListener('click', (e) => {
    const n = e.target.closest('[data-new]'), c = e.target.closest('[data-cont]');
    if (c) act.continueGame(c.dataset.cont);
    else if (n) {
      const id = n.dataset.new;
      if (api.save.slots[id] && !confirm('Start over? Your saved mall for this mode will be replaced.')) return;
      act.newGame(id);
    }
  });
  $('tNew').onclick = () => leaseCards(['normal', 'challenge', 'expert']);
  $('tSandbox').onclick = () => leaseCards(['sandbox']);
  $('tContinue').onclick = () => act.continueGame(api.save.last);
  $('tHow').onclick = () => { $('howto').hidden = false; };
  $('howClose').onclick = () => { $('howto').hidden = true; };
  $('leasesClose').onclick = () => { $('leases').hidden = true; };
  $('tSound').onclick = () => {
    if (api.save.sound && api.save.music) api.save.music = false;
    else if (api.save.sound) api.save.sound = false;
    else { api.save.sound = true; api.save.music = true; }
    api.persist(); showTitle();
  };

  function showGame() {
    $('title').hidden = true;
    for (const id of ['hud', 'dock']) $(id).hidden = false;
    $('drawer').hidden = true; panel = null; inspect(null);
    closeModal(true);
    refresh(); hud(); toolHint();
  }

  // ------------------------------------------------------------ HUD
  function hud() {
    const s = S(); if (!s || R().screen !== 'game') return;
    $('hName').textContent = 'Little Cup Plaza';
    $('hDay').textContent = `Day ${s.day} · ${L.DIFFICULTY[s.diff].name}`;
    $('hClock').textContent = s.phase === 'night' ? '🌙 Night' : fmtTime(s.time);
    $('hPhase').textContent = s.phase === 'open' ? (s.time >= L.LAST_ENTRY * 60 ? 'Last entry' : 'Open') : s.phase === 'closing' ? 'Closing' : 'Planning';
    $('hud').classList.toggle('night', s.phase !== 'open');
    $('hCash').textContent = s.sandbox ? '∞' : money(s.cash);
    $('hCash').parentElement.classList.toggle('neg', !s.sandbox && s.cash < 0);
    const t = s.today, todayNet = t.revenue - t.costs.stock;
    $('hCashSub').textContent = s.loan ? `loan ${money(s.loan)}` : `today ${todayNet >= 0 ? '+' : ''}${money(todayNet)}`;
    const st = act.stars();
    $('hStars').textContent = starStr(st);
    $('hScore').textContent = `${st.toFixed(1)} stars`;
    $('hVisitors').textContent = R().shoppers.length;
    $('hToday').textContent = t.visitors;
    const c = act.cleanliness();
    $('hClean').textContent = pct(c);
    $('hClean').parentElement.classList.toggle('bad', c < 60);
    for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('on', +b.dataset.speed === R().speed);
    $('openDay').hidden = !(s.phase === 'night' && !modalKind);
    $('openDay').textContent = `☀️ Open the doors · Day ${s.day}`;
    $('resDot').hidden = s.sandbox || !!s.research.current || !Object.keys(L.RESEARCH).some((id) => L.researchAvailable(id, s.research.done));
    goalTicker();
    if (inspected && !hoverInsp) renderInspector();
    if (panel && !hoverDrawer && ['finance', 'research', 'staff', 'reports'].includes(panel)) renderPanel();
  }
  for (const b of document.querySelectorAll('.speed button')) b.onclick = () => act.setSpeed(+b.dataset.speed);
  $('openDay').onclick = () => act.openDay();
  $('menuBtn').onclick = () => openMenu();
  $('camL').onclick = () => act.camRotate(-1);
  $('camR').onclick = () => act.camRotate(1);
  $('drawer').addEventListener('pointerenter', () => { hoverDrawer = true; });
  $('drawer').addEventListener('pointerleave', () => { hoverDrawer = false; });
  $('inspector').addEventListener('pointerenter', () => { hoverInsp = true; });
  $('inspector').addEventListener('pointerleave', () => { hoverInsp = false; });

  function goalTicker() {
    const s = S();
    const open = L.GOALS.filter((g) => !s.goalsDone.includes(g.id)).slice(0, 3);
    const el = $('goalTicker');
    el.hidden = !open.length || !!panel || !!inspected;
    const html = `<h5>NEXT GOALS</h5>${open.map((g) => `<div class="g">${esc(g.text)}</div>`).join('')}`;
    if (el.innerHTML !== html) el.innerHTML = html;
    $('goalDot').hidden = true;
  }
  $('goalTicker').onclick = () => openPanel('goals');

  // ------------------------------------------------------------ dock & drawers
  const TITLES = { build: 'Build', shops: 'Shops', services: 'Services', decor: 'Décor', staff: 'Mall Staff', research: 'Research', finance: 'Finance', reports: 'Reports', goals: 'Goals' };
  for (const b of document.querySelectorAll('.dock [data-panel]')) b.onclick = () => openPanel(panel === b.dataset.panel ? null : b.dataset.panel);
  $('drawerClose').onclick = () => openPanel(null);
  function openPanel(p) {
    panel = p;
    for (const b of document.querySelectorAll('.dock [data-panel]')) b.classList.toggle('on', b.dataset.panel === p);
    $('drawer').hidden = !p;
    if (p) { inspect(null); $('drawerTitle').textContent = TITLES[p]; renderPanel(); }
    if (!p || !['build', 'shops', 'services', 'decor'].includes(p)) { if (R().tool) act.setTool(null); }
    hoverDrawer = false;
    goalTicker();
  }
  const toolBtn = (tool, arg, ic, name, sub, opts = {}) => `<button class="tool ${opts.wide ? 'wide' : ''} ${opts.locked ? 'locked' : ''} ${R().tool === tool && R().toolArg === arg ? 'on' : ''}" data-tool="${tool}" data-arg="${arg ?? ''}" ${opts.title ? `title="${esc(opts.title)}"` : ''}>${opts.stripe ? `<i class="stripe" style="background:${opts.stripe}"></i>` : ''}<span class="ic">${ic}</span><b>${esc(name)}</b><small>${sub}</small></button>`;
  function renderPanel() {
    const s = S(), body = $('drawerBody');
    const cm = L.DIFFICULTY[s.diff].costMul;
    let h = '';
    switch (panel) {
      case 'build': {
        h += `<p class="note">Drag across the plot to paint. Walls go up around the mall floor on their own. Right-click or <kbd>Esc</kbd> to stop building.</p><div class="tiles">`;
        for (const [id, g] of Object.entries(L.GROUND)) {
          const sub = id === 'demolish' ? '50% refund' : id === 'entrance' ? money(g.cost * cm) : `${money(g.cost * cm)} / tile`;
          h += toolBtn(id, '', g.icon, g.name, sub, { title: g.desc });
        }
        h += `</div><p class="note"><b>Tip:</b> shoppers come in from the sidewalk by the road. Link your <b>car park</b> to the sidewalk, then add <b>footpaths</b> to an <b>entrance</b>.</p>`;
        h += `<div class="kv"><dt>Parking spaces</dt><dd>${R().parking.length}</dd><dt>Entrances</dt><dd>${s.world.entrances.length}</dd><dt>Mall floor</dt><dd>${s.world.kind.filter((k) => k === L.T.FLOOR).length} tiles</dd></div>`;
        break;
      }
      case 'shops': {
        h += `<p class="note">Click a shop, then click the floor to place it. <kbd>R</kbd> rotates. The arrow shows the door, which must face the concourse.</p>`;
        for (const c of L.UNIT_CATS.filter((c) => c.id !== 'service')) {
          const list = Object.entries(L.UNITS).filter(([, u]) => u.cat === c.id);
          if (!list.length) continue;
          h += `<div class="sec-title">${c.icon} ${c.name}</div><div class="tiles">`;
          for (const [id, u] of list) {
            const locked = !L.unitUnlocked(id, s.research.done);
            h += toolBtn('unit', id, u.icon, u.name, locked ? `🔬 ${L.RESEARCH[u.research].name}` : `${money(u.cost * cm)} · ${u.w}×${u.d}`, { locked, stripe: CAT_COLOR[u.cat], title: `Draws ${u.attract} · avg spend ${money(u.spend)} · ${u.staff} staff` });
          }
          h += '</div>';
        }
        break;
      }
      case 'services': {
        h += `<p class="note">Restrooms keep shoppers comfortable. The <b>office</b> speeds research, the <b>security post</b> lets you hire guards and the <b>workshop</b> lets you hire technicians.</p><div class="tiles">`;
        for (const [id, u] of Object.entries(L.UNITS).filter(([, u]) => u.cat === 'service')) h += toolBtn('unit', id, u.icon, u.name, `${money(u.cost * cm)} · ${money(u.upkeep)}/day`, { stripe: CAT_COLOR.service });
        h += '</div>';
        break;
      }
      case 'decor': {
        h += `<p class="note">Décor makes shoppers happier and lifts the rating. Bins cut litter, benches let tired shoppers rest. <kbd>R</kbd> rotates.</p><div class="tiles">`;
        for (const [id, d] of Object.entries(L.DECOR)) {
          const locked = !L.decorUnlocked(id, s.research.done);
          h += toolBtn('decor', id, d.icon, d.name, locked ? `🔬 ${L.RESEARCH[d.research].name}` : `${money(d.cost)}${d.comfort ? ` · +${d.comfort} comfort` : ''}`, { locked });
        }
        h += '</div>';
        break;
      }
      case 'staff': {
        for (const [id, st] of Object.entries(L.STAFF)) {
          const need = st.needs && !s.world.units.some((u) => L.UNITS[u.type].service === st.needs);
          h += `<div class="card"><div class="row between"><h4>${st.icon} ${st.name}</h4><div class="step"><button data-hire="${id}" data-d="-1">−</button><span>${s.staff[id] || 0}</span><button data-hire="${id}" data-d="1" ${need ? 'disabled' : ''}>+</button></div></div>
            <p>${st.desc}</p><p>${money(st.wage * s.wageMul)}/day each${need ? ` · <b>Needs a ${L.UNITS[st.needs].name}</b>` : ''}</p></div>`;
        }
        const shopStaff = s.world.units.filter((u) => !L.UNITS[u.type].service && !u.lease).reduce((a, u) => a + u.staff, 0);
        h += `<p class="note">Shop staff are set per shop. Click a shop to change them. You employ <b>${shopStaff}</b> shop staff right now.</p>`;
        const busy = R().staffAgents.filter((a) => a.job).length;
        h += `<div class="kv"><dt>On a job right now</dt><dd>${busy} / ${R().staffAgents.length}</dd><dt>Litter on the floor</dt><dd>${R().litter.length}</dd><dt>Broken shops</dt><dd>${s.world.units.filter((u) => u.broken).length}</dd></div>`;
        break;
      }
      case 'research': {
        if (s.sandbox) { h += `<p class="note">Sandbox: every licence and upgrade is already unlocked.</p>`; }
        const offices = s.world.units.filter((u) => L.UNITS[u.type].service === 'research').length;
        const rate = 0.7 + offices * 2.6;
        if (!s.sandbox) {
          const cur = s.research.current && L.RESEARCH[s.research.current];
          h += `<div class="card"><h4>${cur ? '🔬 ' + esc(cur.name) : 'Nothing being researched'}</h4>${cur ? bar((s.research.progress / cur.cost) * 100, ' ') + `<p>${s.research.progress.toFixed(0)} / ${cur.cost} points · ${Math.ceil((cur.cost - s.research.progress) / rate)} open hours left</p>` : '<p>Pick a project below.</p>'}
            <p>${rate.toFixed(1)} points per open hour · ${offices ? offices + ' office' + (offices > 1 ? 's' : '') : 'build a <b>Management Office</b> to speed this up'}</p></div>`;
        }
        for (const tier of [1, 2, 3, 4]) {
          h += `<div class="sec-title">Tier ${tier}</div><div class="tier">`;
          for (const [id, r] of Object.entries(L.RESEARCH).filter(([, r]) => r.tier === tier)) {
            const isDone = s.research.done.includes(id), avail = L.researchAvailable(id, s.research.done), active = s.research.current === id;
            const unit = Object.values(L.UNITS).find((u) => u.research === id), dec = Object.values(L.DECOR).find((d) => d.research === id);
            const ic = unit?.icon || dec?.icon || '⚙️';
            const sub = r.desc || (unit ? `Unlocks the ${unit.name}` : dec ? `Unlocks the ${dec.name}` : '');
            const needs = (r.needs || []).filter((n) => !s.research.done.includes(n)).map((n) => L.RESEARCH[n].name);
            h += `<button class="res ${isDone ? 'done' : avail ? '' : 'locked'} ${active ? 'active' : ''}" data-res="${id}" ${isDone || !avail || s.sandbox ? 'disabled' : ''}><span class="ic">${ic}</span><span><b>${esc(r.name)}</b><small>${esc(sub)}${needs.length ? ` · needs ${esc(needs.join(', '))}` : ''}</small></span><span class="pts">${isDone ? '✓' : r.cost + ' pts'}</span>${active ? bar((s.research.progress / r.cost) * 100, ' ') : ''}</button>`;
          }
          h += '</div>';
        }
        break;
      }
      case 'finance': {
        const t = s.today;
        const proj = projectedCosts(s);
        h += `<div class="card"><div class="row between"><h4>Cash</h4><b class="big-num ${s.cash < 0 ? 'neg' : 'pos'}" style="font-size:26px">${s.sandbox ? '∞' : money(s.cash)}</b></div><p>Loan balance ${money(s.loan)} · interest ${money(L.loanInterest(s.loan))}/day</p></div>`;
        if (!s.sandbox) {
          h += `<div class="sec-title">Bank</div><div class="row" style="flex-wrap:wrap">${L.LOANS.map((a) => `<button class="btn ghost sm" data-loan="${a}">Borrow ${money(a)}</button>`).join('')}</div>`;
          h += `<div class="row" style="flex-wrap:wrap"><button class="btn sm" data-repay="1000" ${s.loan <= 0 ? 'disabled' : ''}>Repay $1,000</button><button class="btn sm" data-repay="999999" ${s.loan <= 0 ? 'disabled' : ''}>Repay all</button></div>`;
        }
        h += `<div class="sec-title">Marketing</div><div class="seg" style="flex-wrap:wrap">${['None', 'Flyers · $150', 'Radio · $400', 'TV · $900'].map((n, i) => `<button class="${s.marketing === i ? 'on' : ''}" data-mkt="${i}">${n}</button>`).join('')}</div><p class="note">Per day. Brings ${['no extra', '+15%', '+35%', '+60%'][s.marketing]} visitors.</p>`;
        h += `<div class="sec-title">Today so far</div><dl class="kv"><dt>Sales</dt><dd class="pos">${money(t.revenue)}</dd><dt>Stock bought</dt><dd class="neg">-${money(t.costs.stock)}</dd><dt>Building</dt><dd class="neg">-${money(t.costs.build)}</dd><dt>Events &amp; repairs</dt><dd class="neg">-${money(t.costs.events || 0)}</dd><dt>Stolen goods</dt><dd class="neg">${money(t.stolen)}</dd></dl>`;
        h += `<div class="sec-title">Paid at closing</div><dl class="kv"><dt>Rent from tenants</dt><dd class="pos">+${money(proj.rent)}</dd><dt>Wages</dt><dd class="neg">-${money(proj.wages)}</dd><dt>Upkeep</dt><dd class="neg">-${money(proj.upkeep)}</dd><dt>Loan interest</dt><dd class="neg">-${money(proj.interest)}</dd><dt>Marketing</dt><dd class="neg">-${money(proj.marketing)}</dd><dt class="total">Net at closing</dt><dd class="total ${proj.net >= 0 ? 'pos' : 'neg'}">${money(proj.net)}</dd></dl>`;
        break;
      }
      case 'reports': {
        const hist = s.history.slice(-12);
        if (!hist.length) { h += `<p class="note">Finish your first day to see reports here.</p>`; break; }
        const max = Math.max(1, ...hist.map((x) => Math.abs(x.profit)));
        h += `<div class="sec-title">Profit per day</div><div class="chart">${hist.map((x) => `<div class="col" title="Day ${x.day}: ${money(x.profit)}"><i class="${x.profit < 0 ? 'neg' : ''}" style="height:${(Math.abs(x.profit) / max) * 90}%"></i><small>${x.day}</small></div>`).join('')}</div>`;
        const vmax = Math.max(1, ...hist.map((x) => x.visitors));
        h += `<div class="sec-title">Shoppers per day</div><div class="chart">${hist.map((x) => `<div class="col" title="Day ${x.day}: ${x.visitors}"><i style="height:${(x.visitors / vmax) * 90}%;background:var(--butter)"></i><small>${x.visitors}</small></div>`).join('')}</div>`;
        const rep = s.lastReport;
        if (rep) {
          h += `<div class="sec-title">Shoppers wanted (day ${rep.day})</div>` + (rep.wishes.length ? `<div class="list">${rep.wishes.slice(0, 6).map(([k, n]) => `<div class="li"><span>${L.UNITS[k].icon} ${L.UNITS[k].name}${L.unitUnlocked(k, s.research.done) ? '' : ' 🔒'}</span><b>${n}</b></div>`).join('')}</div>` : '<p class="note">Nobody went looking for a shop you don’t have.</p>');
          h += `<div class="sec-title">Complaints</div>` + (rep.complaints.length ? `<div class="list">${rep.complaints.slice(0, 6).map(([k, n]) => `<div class="li"><span>${COMPLAINT_TEXT[k] || k}</span><b>${n}</b></div>`).join('')}</div>` : '<p class="note">No complaints. Lovely!</p>');
          h += `<div class="sec-title">Best shops</div><div class="list">${rep.units.slice(0, 6).map((x) => { const u = act.unitById(x.id); return u ? `<div class="li"><span>${L.UNITS[u.type].icon} ${L.UNITS[u.type].name}</span><b>${money(x.rev)} · ${x.visits}</b></div>` : ''; }).join('')}</div>`;
        }
        break;
      }
      case 'goals': {
        h += `<p class="note">Complete milestones to earn bonus cash${s.sandbox ? ' (no cash in Sandbox)' : ''}.</p>`;
        for (const g of L.GOALS) { const d = s.goalsDone.includes(g.id); h += `<div class="goal ${d ? 'done' : ''}"><span>${d ? '✅' : '🎯'}</span><span>${esc(g.text)}</span><span class="rw">${s.sandbox ? '' : '+' + money(g.reward)}</span></div>`; }
        break;
      }
      default: break;
    }
    body.innerHTML = h;
  }
  function projectedCosts(s) {
    let wages = 0, upkeep = 0, rent = 0;
    for (const u of s.world.units) {
      const d = L.UNITS[u.type];
      if (d.service) upkeep += d.upkeep || 0;
      else if (u.lease) rent += L.leaseRent(d, act.stars());
      else wages += u.staff * d.wage;
    }
    for (const [k, n] of Object.entries(s.staff)) wages += n * L.STAFF[k].wage * s.wageMul;
    upkeep += s.world.kind.filter((k) => k === L.T.FLOOR).length * 1 + R().parking.length * 0.15 + s.world.decor.length * 0.8;
    if (s.research.done.includes('led')) upkeep *= 0.7;
    const interest = L.loanInterest(s.loan), marketing = [0, 150, 400, 900][s.marketing];
    wages = Math.round(wages); upkeep = Math.round(upkeep);
    return { wages, upkeep, rent, interest, marketing, net: rent - wages - upkeep - interest - marketing };
  }
  $('drawerBody').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) {
      const tool = t.dataset.tool, arg = t.dataset.arg || null;
      if (t.classList.contains('locked')) { toast('🔬 Research this in the Research panel first.', 'bad'); return; }
      if (R().tool === tool && (R().toolArg || null) === arg) act.setTool(null); else act.setTool(tool, arg);
      renderPanel();
      return;
    }
    const hire = e.target.closest('[data-hire]'); if (hire) { act.hire(hire.dataset.hire, +hire.dataset.d); return; }
    const res = e.target.closest('[data-res]'); if (res && !res.disabled) { act.research(res.dataset.res); return; }
    const loan = e.target.closest('[data-loan]'); if (loan) { act.loan(+loan.dataset.loan); return; }
    const rep = e.target.closest('[data-repay]'); if (rep) { act.repay(+rep.dataset.repay); return; }
    const mk = e.target.closest('[data-mkt]'); if (mk) { act.marketing(+mk.dataset.mkt); }
  });

  // ------------------------------------------------------------ tool hint
  function toolHint() {
    const r = R(), el = $('toolHint');
    if (!r.tool || r.screen !== 'game') { el.hidden = true; return; }
    let txt = '';
    const cm = L.DIFFICULTY[S().diff].costMul;
    if (r.tool === 'unit') { const u = L.UNITS[r.toolArg]; txt = `${u.icon} <b>${u.name}</b> · ${money(u.cost * cm)} · click the floor to place`; }
    else if (r.tool === 'decor') { const d = L.DECOR[r.toolArg]; txt = `${d.icon} <b>${d.name}</b> · ${money(d.cost)} · click to place`; }
    else { const g = L.GROUND[r.tool]; txt = `${g.icon} <b>${g.name}</b> · ${r.tool === 'demolish' ? 'drag or click to clear' : r.tool === 'entrance' ? 'click an outer edge tile of the mall floor' : 'drag to paint'}`; }
    const rot = r.tool === 'unit' || r.tool === 'decor';
    el.innerHTML = `<span>${txt}</span>${rot ? '<button class="btn sm" id="hintRot">⟳ Rotate</button>' : ''}<button class="btn sm" id="hintX">✕ Done</button>`;
    el.hidden = false;
    if (rot) $('hintRot').onclick = () => act.rotate();
    $('hintX').onclick = () => { act.setTool(null); if (panel) renderPanel(); };
  }

  // ------------------------------------------------------------ inspector
  function inspect(target) {
    inspected = target;
    if (target) { if (panel) { panel = null; $('drawer').hidden = true; for (const b of document.querySelectorAll('.dock [data-panel]')) b.classList.remove('on'); } }
    hoverInsp = false;
    renderInspector();
    goalTicker();
  }
  function renderInspector() {
    const el = $('inspector');
    if (!inspected) { el.hidden = true; return; }
    const s = S(), r = R();
    let h = '';
    if (inspected.kind === 'unit') {
      const u = act.unitById(inspected.id);
      if (!u) { inspected = null; el.hidden = true; return; }
      const d = L.UNITS[u.type];
      const st = act.unitOpenState(u);
      const cap = act.capacity(u);
      const today = s.today.units[u.id] || { rev: 0, visits: 0, stolen: 0 };
      const cm = L.DIFFICULTY[s.diff].costMul;
      h += `<div class="insp-head" style="--c:${d.color}"><span class="ic">${d.icon}</span><div><h3>${d.name}</h3><small>${d.service ? 'Service' : L.UNIT_CATS.find((c) => c.id === d.cat).name} · Level ${u.level}</small></div><button class="x" data-x>✕</button></div><div class="insp-body">`;
      h += `<div class="row" style="flex-wrap:wrap">${st.ok ? `<span class="pill ok">Open</span>` : `<span class="pill bad">${st.icon} ${st.text}</span>`}${st.warn ? `<span class="pill warn">${st.icon} ${st.text}</span>` : ''}${u.lease ? '<span class="pill warn">Leased</span>' : ''}</div>`;
      if (!d.staffOnly) h += `<dl class="kv"><dt>Inside / capacity</dt><dd>${u._in || 0} / ${Math.round(cap)}</dd><dt>Queue</dt><dd>${(u._q || []).length}</dd><dt>Visits today</dt><dd>${today.visits}</dd>${d.service ? '' : `<dt>Sales today</dt><dd class="pos">${money(today.rev)}</dd>`}${today.stolen ? `<dt>Stolen</dt><dd class="neg">${money(today.stolen)}</dd>` : ''}</dl>`;
      if (!d.service) {
        h += `<div class="sec-title">Management</div><div class="seg"><button data-lease="0" class="${u.lease ? '' : 'on'}">Run it myself</button><button data-lease="1" class="${u.lease ? 'on' : ''}">Lease · ${money(L.leaseRent(d, act.stars()))}/day</button></div>`;
        if (!u.lease) {
          h += `<div class="row between"><span>Staff <small>(${money(d.wage)}/day each)</small></span><div class="step"><button data-staff="-1">−</button><span>${u.staff}</span><button data-staff="1">+</button></div></div>`;
          h += `<div class="row between"><span>Prices</span><div class="seg">${L.PRICE_LEVELS.map((p) => `<button data-price="${p.id}" class="${u.price === p.id ? 'on' : ''}">${p.name}</button>`).join('')}</div></div>`;
          const max = L.stockMax(d, u);
          h += `<div><div class="row between"><span>Stock</span><small>${Math.floor(u.stock)} / ${max}</small></div>${bar((u.stock / max) * 100)}</div><button class="btn ghost sm" data-restock ${u.stock >= max ? 'disabled' : ''}>🚚 Rush delivery · $60</button>`;
          h += `<p class="note">Avg spend ${money(d.spend * L.PRICE_LEVELS.find((p) => p.id === u.price).mult)} · stock costs ${Math.round(L.stockCostRatio * 100)}% of sales. Busy shops need more staff.</p>`;
        } else h += `<p class="note">A tenant runs this shop and pays rent every evening. Rent rises with your mall rating.</p>`;
      } else if (d.service === 'research') h += `<p class="note">Adds research points every open hour. Open <b>Research</b> to choose a project.</p>`;
      else if (d.service === 'security') h += `<p class="note">Lets you hire Security Guards in the Staff panel. Guards: ${s.staff.security}.</p>`;
      else if (d.service === 'maintenance') h += `<p class="note">Lets you hire Technicians in the Staff panel. Technicians: ${s.staff.technician}.</p>`;
      h += `<div><div class="row between"><span>Condition</span><small>${Math.round(u.cond ?? 100)}%</small></div>${bar(u.cond ?? 100)}</div>`;
      if (u.broken) h += u.contractorAt ? `<p class="note">🔧 Contractor arriving at ${fmtTime(u.contractorAt % 1440)}.</p>` : `<button class="btn coral" data-contractor>🔧 Call a contractor · ${money(d.cost * 0.08 + 80)}</button>`;
      if (u.level < 3 && !d.staffOnly) h += `<button class="btn butter" data-upgrade>⬆ Upgrade to level ${u.level + 1} · ${money(L.upgradeCost(d, u.level) * cm)}</button>`;
      h += `<div class="row" style="flex-wrap:wrap"><button class="btn ghost sm" data-toggle>${u.open ? '⛔ Close shop' : '✅ Reopen'}</button><button class="btn ghost sm" data-demolish>🧨 Demolish · +${money(d.cost * 0.5 * cm)}</button></div></div>`;
    } else if (inspected.kind === 'shopper') {
      const sh = r.shoppers.find((x) => x.id === inspected.id);
      if (!sh) { h += `<div class="insp-head"><span class="ic">🚶</span><div><h3>Gone home</h3><small>This shopper has left</small></div><button class="x" data-x>✕</button></div>`; }
      else {
        const state = sh.state === 'inside' ? `Inside ${L.UNITS[act.unitById(sh.unit)?.type]?.name || 'a shop'}` : sh.state === 'queue' ? 'Waiting in a queue' : sh.state === 'sit' ? 'Resting on a bench' : sh.leaving ? 'Heading home' : sh.target?.kind === 'unit' ? `Walking to ${L.UNITS[act.unitById(sh.target.id)?.type]?.name || 'a shop'}` : 'Looking around';
        h += `<div class="insp-head" style="--c:${sh.look.shirt}"><span class="ic">${sh.mood > 70 ? '😊' : sh.mood > 45 ? '🙂' : sh.mood > 25 ? '😕' : '😠'}</span><div><h3>${esc(sh.name)}</h3><small>${state} · came by ${sh.mode}</small></div><button class="x" data-x>✕</button></div><div class="insp-body">`;
        h += `<div class="needs"><span>Mood</span>${bar(sh.mood)}<span>Energy</span>${bar(sh.needs.energy)}<span>Hunger</span>${bar(100 - sh.needs.hunger)}<span>Restroom</span>${bar(100 - sh.needs.bladder)}</div>`;
        h += `<dl class="kv"><dt>Budget left</dt><dd>${money(sh.budget)}</dd><dt>Spent</dt><dd class="pos">${money(sh.spent)}</dd><dt>Shops visited</dt><dd>${sh.visited.length}</dd></dl>`;
        if (sh.wishes.length) h += `<div class="sec-title">Still wants</div><div class="row" style="flex-wrap:wrap">${sh.wishes.map((w) => `<span class="pill">${L.UNITS[w].icon} ${L.UNITS[w].name}</span>`).join('')}</div>`;
        h += `<div class="sec-title">Thoughts</div><div class="thoughts">${sh.thoughts.length ? sh.thoughts.map((t) => `<p>${esc(t)}</p>`).join('') : '<p>Just browsing…</p>'}</div></div>`;
      }
    } else if (inspected.kind === 'staff') {
      const a = r.staffAgents.find((x) => x.id === inspected.id);
      if (!a) { inspected = null; el.hidden = true; return; }
      const st = L.STAFF[a.kind];
      const job = a.state === 'work' ? 'Working' : a.job?.litter ? 'Heading to some litter' : a.job?.unit ? `Going to fix the ${L.UNITS[a.job.unit.type].name}` : a.job?.puddle != null ? 'Going to mop a leak' : a.kind === 'security' ? 'On patrol' : 'Looking for work';
      h += `<div class="insp-head" style="--c:${a.look.shirt}"><span class="ic">${st.icon}</span><div><h3>${esc(a.name)}</h3><small>${st.name} · ${money(st.wage * s.wageMul)}/day</small></div><button class="x" data-x>✕</button></div><div class="insp-body"><dl class="kv"><dt>Doing</dt><dd>${job}</dd><dt>Jobs done</dt><dd>${a.done}</dd></dl><p class="note">${st.desc}</p><button class="btn ghost sm" data-fire="${a.kind}">Let one ${st.name.toLowerCase()} go</button></div>`;
    } else if (inspected.kind === 'decor') {
      const d = s.world.decor.find((x) => x.id === inspected.id);
      if (!d) { inspected = null; el.hidden = true; return; }
      const dd = L.DECOR[d.type];
      h += `<div class="insp-head" style="--c:#6f9a7a"><span class="ic">${dd.icon}</span><div><h3>${dd.name}</h3><small>Décor${dd.comfort ? ' · +' + dd.comfort + ' comfort' : ''}</small></div><button class="x" data-x>✕</button></div><div class="insp-body"><p class="note">${dd.seat ? 'Tired shoppers rest here.' : dd.bin ? 'Shoppers nearby drop much less litter.' : dd.atm ? 'Shoppers can top up their spending money.' : dd.info ? 'Helps shoppers find their way and handles lost-child calls.' : 'Makes the mall nicer to walk through.'}</p><button class="btn ghost sm" data-remove>🧨 Remove · +${money(dd.cost * 0.5)}</button></div>`;
    }
    el.innerHTML = h;
    el.hidden = false;
  }
  $('inspector').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || !inspected) return;
    const id = inspected.id;
    if (t.hasAttribute('data-x')) { inspect(null); return; }
    if (t.dataset.lease != null) { const u = act.unitById(id); if (!!u.lease !== (t.dataset.lease === '1')) act.unitLease(id); }
    else if (t.dataset.staff) act.unitStaff(id, +t.dataset.staff);
    else if (t.dataset.price) act.unitPrice(id, t.dataset.price);
    else if (t.hasAttribute('data-restock')) act.unitRestock(id);
    else if (t.hasAttribute('data-upgrade')) act.unitUpgrade(id);
    else if (t.hasAttribute('data-toggle')) act.unitToggle(id);
    else if (t.hasAttribute('data-contractor')) act.unitContractor(id);
    else if (t.hasAttribute('data-demolish')) { if (confirm('Demolish this unit? You get half the build cost back.')) { act.unitDemolish(id); inspect(null); } return; }
    else if (t.hasAttribute('data-remove')) { act.decorRemove(id); return; }
    else if (t.dataset.fire) { act.hire(t.dataset.fire, -1); inspect(null); return; }
    renderInspector();
  });

  // ------------------------------------------------------------ modals
  function openModal(html, kind, wide = false) {
    modalKind = kind;
    $('modalCard').className = 'modal-card' + (wide ? ' wide' : '');
    $('modalCard').innerHTML = html;
    $('modal').hidden = false;
    act.setModal?.(true);
    $('openDay').hidden = true;
  }
  function closeModal(silent = false) {
    $('modal').hidden = true; modalKind = null;
    if (!silent) act.setModal?.(false);
    else if (act.setModal) act.setModal(false);
  }
  function card({ icon, title, text, options, good }) {
    const s = S();
    const html = `<div class="mc-head" style="--c:${good ? '#2f7a6a' : '#b4432f'}"><span class="ic">${icon}</span><div><small>${good ? 'GOOD NEWS' : 'PROBLEM'} · ${fmtTime(s.time)}</small><h2>${esc(title)}</h2></div></div>
      <div class="mc-body"><p>${esc(text)}</p><div class="choices">${options.map((o, i) => {
        const cant = o.disabled || (o.cost && !s.sandbox && s.cash < o.cost);
        return `<button class="choice" data-opt="${i}" ${cant ? 'disabled' : ''}><b>${esc(o.label)}</b><span class="cost ${o.cost ? '' : 'free'}">${o.cost ? money(o.cost) : 'Free'}</span><small>${esc(o.sub || '')}</small></button>`;
      }).join('')}</div></div>`;
    openModal(html, 'card');
    $('modalCard').querySelectorAll('[data-opt]').forEach((b) => {
      b.onclick = () => { if (act.chooseOption(options[+b.dataset.opt])) { closeModal(); api.sfx.play('tap'); } };
    });
  }
  function report(rep) {
    const c = rep.costs;
    const lines = [['Sales', rep.revenue, 1], ['Rent from tenants', rep.rent, 1], ['Stock', -c.stock], ['Wages', -c.wages], ['Upkeep', -c.upkeep], ['Loan interest', -c.interest], ['Marketing', -c.marketing], ['Events & repairs', -(c.events || 0)]].filter((l) => l[1]);
    const html = `<div class="mc-head" style="--c:#1f4e5a"><span class="ic">🧾</span><div><small>END OF DAY ${rep.day}</small><h2>Daily report</h2></div></div>
      <div class="mc-body">
        <div class="report-grid">
          <div><h4>Operating profit</h4><div class="big-num ${rep.profit >= 0 ? 'pos' : 'neg'}">${money(rep.profit)}</div><small>Building spend: ${money(c.build)} · cash now ${S().sandbox ? '∞' : money(rep.cash)}</small></div>
          <div><h4>Shoppers</h4><div class="big-num">${rep.visitors}</div><small>${rep.lost ? `${rep.lost} turned away (no parking) · ` : ''}${rep.cars} cars</small></div>
          <div><h4>Satisfaction</h4>${bar(rep.sat)}<small>${Math.round(rep.sat)}% happy · ${Math.round(rep.clean)}% clean</small></div>
          <div><h4>Mall rating</h4><div style="font-size:24px;color:#e9a21b">${starStr(rep.stars)}</div><small>${rep.stars.toFixed(2)} stars</small></div>
        </div>
        <div class="report-grid">
          <div><h4>Money</h4><dl class="kv">${lines.map(([n, v]) => `<dt>${n}</dt><dd class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${money(v)}</dd>`).join('')}</dl></div>
          <div><h4>Top shops</h4><div class="list">${rep.units.slice(0, 5).map((x) => `<div class="li"><span>${L.UNITS[x.u.type].icon} ${L.UNITS[x.u.type].name}</span><b>${L.UNITS[x.u.type].service ? x.visits + ' visits' : money(x.rev)}</b></div>`).join('') || '<p class="note">No sales today.</p>'}</div></div>
          <div><h4>Shoppers asked for</h4><div class="list">${rep.wishes.slice(0, 4).map(([k, n]) => `<div class="li"><span>${L.UNITS[k].icon} ${L.UNITS[k].name}</span><b>${n}</b></div>`).join('') || '<p class="note">Nothing missing!</p>'}</div></div>
          <div><h4>Complaints</h4><div class="list">${rep.complaints.slice(0, 4).map(([k, n]) => `<div class="li"><span>${COMPLAINT_TEXT[k] || k}</span><b>${n}</b></div>`).join('') || '<p class="note">None. Lovely!</p>'}</div></div>
        </div>
        ${rep.caught || rep.stolen ? `<p>🛡️ ${rep.caught} shoplifters caught · ${money(rep.stolen)} of stock stolen.</p>` : ''}
        <div class="row" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" id="repPlan">🌙 Plan overnight</button><button class="btn butter" id="repOpen">☀️ Open day ${rep.day + 1}</button></div>
      </div>`;
    openModal(html, 'report', true);
    $('repPlan').onclick = () => { closeModal(); hud(); };
    $('repOpen').onclick = () => { closeModal(); act.openDay(); };
  }
  function gameOver(rep) {
    const html = `<div class="mc-head" style="--c:#b4432f"><span class="ic">🏦</span><div><small>DAY ${rep.day}</small><h2>The bank took the keys</h2></div></div>
      <div class="mc-body"><p>Your mall fell too far into debt. You still welcomed ${S().stats.totalVisitors.toLocaleString()} shoppers and reached ${starStr(rep.stars)}.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="goTitle">Main menu</button><button class="btn coral" id="goAgain">Try again</button></div></div>`;
    openModal(html, 'over');
    $('goTitle').onclick = () => { delete api.save.slots[S().diff]; api.save.last = null; api.persist(); closeModal(); act.toTitle(); };
    $('goAgain').onclick = () => { closeModal(); act.restart(); };
  }
  function openMenu() {
    const sv = api.save;
    const html = `<div class="mc-head"><span class="ic">☰</span><div><small>LITTLE CUP PLAZA</small><h2>Paused</h2></div></div>
      <div class="mc-body"><div class="menu-list">
        <button class="choice" id="mResume"><b>▶ Resume</b><span class="cost free"></span><small>Back to your mall</small></button>
        <button class="choice" id="mSound"><b>🔊 Sound: ${sv.sound ? 'On' : 'Off'}</b><span class="cost free"></span><small>Effects</small></button>
        <button class="choice" id="mMusic"><b>🎵 Music: ${sv.music ? 'On' : 'Off'}</b><span class="cost free"></span><small>Elevator jazz</small></button>
        <button class="choice" id="mHints"><b>💡 Hints: ${sv.hints ? 'On' : 'Off'}</b><span class="cost free"></span><small>Tips for new managers</small></button>
        <button class="choice" id="mHow"><b>📖 Visitor guide</b><span class="cost free"></span><small>How everything works</small></button>
        <button class="choice" id="mQuit"><b>💾 Save &amp; quit to menu</b><span class="cost free"></span><small>Your mall is saved automatically</small></button>
      </div></div>`;
    openModal(html, 'menu');
    $('mResume').onclick = () => closeModal();
    $('mSound').onclick = () => { sv.sound = !sv.sound; api.persist(); openMenu(); };
    $('mMusic').onclick = () => { sv.music = !sv.music; api.persist(); openMenu(); };
    $('mHints').onclick = () => { sv.hints = !sv.hints; api.persist(); openMenu(); };
    $('mHow').onclick = () => { closeModal(); $('title').hidden = false; $('howto').hidden = false; $('howClose').onclick = () => { $('howto').hidden = true; if (R().screen === 'game') $('title').hidden = true; }; };
    $('mQuit').onclick = () => { closeModal(); act.toTitle(); };
  }
  function escape() {
    if (modalKind === 'menu') closeModal();
    else if (modalKind) return;
    else if (panel) openPanel(null);
    else if (inspected) inspect(null);
    else openMenu();
  }
  function refresh() {
    if (panel) renderPanel();
    if (inspected) renderInspector();
    toolHint();
    hud();
  }

  const ui = { api, toast, card, report, gameOver, inspect, refresh, hud, toolHint, showTitle, showGame, escape, openPanel };
  return ui;
}
