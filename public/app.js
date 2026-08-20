const API = '';
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

let state = { user:null, notifUnread:0, reportTarget:null, currentChallengePage:1 };

function toast(msg){
  const t=$('#toast');
  if(!t) return;
  t.textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2400);
}
async function api(path, opts={}){
  const res = await fetch(API+path, { credentials:'include', headers:{'Content-Type':'application/json', ...(opts.headers||{})}, ...opts });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function escapeHtml(s){
  if(s===null || s===undefined) return '';
  const d=document.createElement('div');
  d.textContent=s;
  return d.innerHTML;
}
function fmtDate(iso){
  if(!iso) return '';
  return new Date(iso).toLocaleDateString(undefined,{ month:'short', day:'numeric', year:'numeric'});
}
function timeAgo(iso){
  if(!iso) return '';
  const sec = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(sec<60) return 'just now';
  if(sec<3600) return Math.floor(sec/60)+'m ago';
  if(sec<86400) return Math.floor(sec/3600)+'h ago';
  if(sec<604800) return Math.floor(sec/86400)+'d ago';
  return fmtDate(iso);
}
function levelProgress(xp){
  let level=1, need=250, rem=xp||0;
  while(rem>=need){ rem-=need; level++; need=Math.floor(need*1.4); }
  const pct = Math.min(100, Math.max(0, Math.round(rem/need*100)));
  return { level, pct, next:need-rem };
}

// NAV config (Home removed - Challenges is the primary home)
const DESKTOP_NAV_ITEMS = [
  { id:'challenges', label:'Challenges', hash:'#/challenges', icon:`<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/>` },
  { id:'battles', label:'Battle Mode', hash:'#/battles', icon:`<path d="M6 18 12 6l6 12"/><path d="M8 14h8"/><path d="M9 18H7a2 2 0 0 1-2-2v-1"/><path d="M15 18h2a2 2 0 0 0 2-2v-1"/>` },
  { id:'stories', label:'Story Chain', hash:'#/stories', icon:`<path d="M4 5a2 2 0 0 1 2-2h8l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z"/><path d="M14 3v4h4"/><path d="M8 13h8M8 17h8M8 9h3"/>` },
  { id:'explore', label:'Explore', hash:'#/explore', icon:`<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>` },
  { id:'random', label:'Random Mode', hash:'#/random', icon:`<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h4v4H8zM12 12h4v4h-4z"/><circle cx="10" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="14" r="1" fill="currentColor"/>` },
  { id:'confessions', label:'Confessions', hash:'#/confessions', icon:`<path d="M12 3a7 7 0 0 0-7 7v3a3 3 0 0 0 3 3h1v2l3-2h2a3 3 0 0 0 3-3v-3a7 7 0 0 0-7-7Z"/><path d="M8 11h8M8 14h5"/>` },
  { id:'profile', label:'Profile', hash:'#/me', icon:`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>` },
];

const MOBILE_NAV_ITEMS = [
  { id:'challenges', label:'Challenges', hash:'#/challenges', icon:`<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/>` },
  { id:'battles', label:'Battles', hash:'#/battles', icon:`<path d="M6 18 12 6l6 12"/><path d="M8 14h8"/><path d="M9 18H7a2 2 0 0 1-2-2v-1"/><path d="M15 18h2a2 2 0 0 0 2-2v-1"/>` },
  { id:'stories', label:'Stories', hash:'#/stories', icon:`<path d="M4 5a2 2 0 0 1 2-2h8l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z"/><path d="M14 3v4h4"/><path d="M8 13h8M8 17h8M8 9h3"/>` },
  { id:'explore', label:'Explore', hash:'#/explore', icon:`<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>` },
  { id:'profile', label:'Profile', hash:'#/me', icon:`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>` },
];

function navHtml(active){
  return DESKTOP_NAV_ITEMS.map(n=>{
    const isActive = active===n.id;
    return `<a href="${n.hash}" class="${isActive?'active':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${n.icon}</svg>${n.label}</a>`;
  }).join('') + (state.user?.role==='admin' ? `<div class="nav-label">Admin</div><a href="#/admin" class="${active==='admin'?'active':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1 2-4Z"/><circle cx="12" cy="12" r="2"/></svg>Dashboard</a>` : '');
}

function mobileNavHtml(active){
  return MOBILE_NAV_ITEMS.map(n=>{
    const isActive = active===n.id;
    return `<a href="${n.hash}" class="${isActive?'active':''}" data-tab="${n.id}" aria-label="${n.label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${isActive?'2.3':'1.8'}">${n.icon}</svg><span>${n.label}</span></a>`;
  }).join('');
}

async function refreshAuth(){
  try{
    const { user } = await api('/api/auth/me');
    state.user = user;
  }catch{ state.user=null; }
  updateAuthUI();
  renderNav();
  fetchNotifications();
}

function updateAuthUI(){
  const xpPill=$('#xpPill'), streakPill=$('#streakPill'), xpText=$('#xpText'), levelText=$('#levelText'), streakText=$('#streakText');
  const authBtns=$('#authButtons'), userMenu=$('#userMenu'), profileBtn=$('#profileBtn'), sidebarUser=$('#sidebarUser');
  if(state.user){
    if(authBtns) authBtns.style.display='none';
    if(userMenu) userMenu.style.display='flex';
    if(profileBtn){
      profileBtn.textContent = (state.user.display_name||state.user.username||'U').slice(0,1).toUpperCase();
      profileBtn.title = state.user.username;
    }
    const prog = levelProgress(state.user.xp||0);
    if(xpPill) xpPill.style.display='flex';
    if(streakPill) streakPill.style.display='flex';
    if(xpText) xpText.textContent = `${state.user.xp||0} XP`;
    if(levelText) levelText.textContent = `Lvl ${state.user.level || prog.level}`;
    if(streakText) streakText.textContent = `${state.user.streak_count||0}`;
    if(sidebarUser){
      sidebarUser.innerHTML = `
        <div class="row" style="gap:10px">
          <div class="avatar">${escapeHtml((state.user.display_name||state.user.username||'U').slice(0,1).toUpperCase())}</div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:800;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(state.user.display_name)}</div>
            <div class="small muted">@${escapeHtml(state.user.username)} • Lvl ${state.user.level||prog.level}</div>
          </div>
        </div>
        <div style="margin-top:10px">
          <div class="row" style="justify-content:space-between"><span class="small">Level progress</span><span class="small" style="font-weight:700">${prog.pct}%</span></div>
          <div class="levelBar" style="margin-top:6px"><div class="levelFill" style="width:${prog.pct}%"></div></div>
          <div class="small muted" style="margin-top:6px">${prog.next} XP to next level • ${state.user.streak_count||0} day streak</div>
        </div>
        <div class="row" style="margin-top:12px;gap:8px">
          <a href="#/me" class="btn small secondary block" style="flex:1">View profile</a>
          <button class="btn small secondary" id="sideLogout" style="padding:7px 10px" title="Logout"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg></button>
        </div>
      `;
      sidebarUser.querySelector('#sideLogout')?.addEventListener('click', logout);
    }
  } else {
    if(authBtns) authBtns.style.display='flex';
    if(userMenu) userMenu.style.display='none';
    if(xpPill) xpPill.style.display='none';
    if(streakPill) streakPill.style.display='none';
    if(sidebarUser){
      sidebarUser.innerHTML = `
        <div style="font-weight:800">Join What If.</div>
        <div class="small muted" style="margin-top:4px;line-height:1.5">Answer one scenario and unlock the community. No ads. No followers.</div>
        <button class="btn small block" style="margin-top:10px" id="sideJoin">Create account</button>
      `;
      sidebarUser.querySelector('#sideJoin')?.addEventListener('click', ()=>openAuth('register'));
    }
  }
}

function renderNav(){
  const hash = location.hash || '#/challenges';
  let active='challenges';
  if(hash.startsWith('#/challenges') || hash.startsWith('#/challenge/') || hash==='#/' || hash==='#') active='challenges';
  else if(hash.startsWith('#/battles') || hash.startsWith('#/battle/')) active='battles';
  else if(hash.startsWith('#/stories')) active='stories';
  else if(hash.startsWith('#/explore') || hash.startsWith('#/search') || hash.startsWith('#/random') || hash.startsWith('#/confessions')) active='explore';
  else if(hash.startsWith('#/me') || hash.startsWith('#/profile/')) active='profile';
  else if(hash.startsWith('#/admin')) active='admin';
  else if(hash.startsWith('#/notifications')) active='challenges';

  const desktop = $('#navDesktop');
  if(desktop) desktop.innerHTML = navHtml(active);
  const mobile = $('#mobileNav');
  if(mobile) mobile.innerHTML = `<div class="nav-mobile">${mobileNavHtml(active==='admin' ? 'profile' : active)}</div>`;
}

// Auth modal
function openAuth(tab='login'){
  $('#authModal').classList.add('open');
  $$('.tab').forEach(t=> t.classList.toggle('active', t.dataset.tab===tab));
  $('#loginForm').style.display = tab==='login'?'block':'none';
  $('#registerForm').style.display = tab==='register'?'block':'none';
  $('#authTitle').textContent = tab==='register' ? 'Create your account' : 'Welcome back';
}
function closeAuth(){ $('#authModal').classList.remove('open'); }

async function logout(){
  await api('/api/auth/logout', { method:'POST' });
  state.user=null;
  updateAuthUI();
  renderNav();
  toast('Logged out');
  location.hash='#/challenges';
  refreshAuth();
}

// Report
function openReport(target_type, target_id){
  if(!state.user){ toast('Log in to report'); openAuth('login'); return; }
  state.reportTarget = { target_type, target_id };
  $('#reportReason').value='';
  $('#reportError').style.display='none';
  $('#reportModal').classList.add('open');
}
function closeReport(){ $('#reportModal').classList.remove('open'); }

// Notifications polling
async function fetchNotifications(){
  if(!state.user){
    const badge=$('#notifBadge');
    if(badge) badge.style.display='none';
    return;
  }
  try{
    const data = await api('/api/notifications');
    state.notifUnread = data.unread;
    const badge=$('#notifBadge');
    if(badge){
      if(data.unread>0){
        badge.textContent=data.unread;
        badge.style.display='block';
      } else {
        badge.style.display='none';
      }
    }
  }catch{}
}

// Router
function router(){
  renderNav();
  window.scrollTo({ top:0, behavior:'instant' });
  const hash = location.hash || '#/challenges';
  if(hash==='#/' || hash==='#' || hash==='' || hash.startsWith('#/challenges')) return renderChallenges();
  if(hash.startsWith('#/challenge/')) return renderChallengeDetail(hash.split('/')[2]);
  if(hash.startsWith('#/explore')) return renderExplore();
  if(hash.startsWith('#/battles')) return renderBattles();
  if(hash.startsWith('#/stories/')) return renderStoryDetail(hash.split('/')[2]);
  if(hash.startsWith('#/stories')) return renderStories();
  if(hash.startsWith('#/random')) return renderRandom();
  if(hash.startsWith('#/confessions')) return renderConfessions();
  if(hash.startsWith('#/profile/')) return renderProfile(hash.split('/')[2]);
  if(hash.startsWith('#/me')) return renderMe();
  if(hash.startsWith('#/notifications')) return renderNotifications();
  if(hash.startsWith('#/admin')) return renderAdmin();
  if(hash.startsWith('#/search')) {
    const q = new URLSearchParams(location.hash.split('?')[1]||'').get('q')||'';
    return renderExplore(q);
  }
  return renderChallenges();
}

// ==========================================================================
// PRIMARY HUB: CHALLENGES & DISCOVERY
// ==========================================================================
let challengesState = { page:1, category:'all', sort:'new', search:'' };
async function renderChallenges(){
  const sort = challengesState.sort;
  $('#app').innerHTML = `
    <div class="feed">
      <!-- Top Actions Bar -->
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
        <div>
          <div class="kicker">Hypothetical Minds</div>
          <div class="h1">Challenges</div>
          <div class="small muted" style="margin-top:2px">Answer first, then unlock the conversation.</div>
        </div>
        <button class="btn small" id="createChallengeBtn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Create challenge</button>
      </div>

      <!-- Quick Game Modes Selector (2x2 Grid) -->
      <div class="home-modes-grid">
        <a href="#/battles" class="home-mode-card">
          <div class="home-mode-icon" style="background:#fef3c7;color:#d97706">⚔️</div>
          <div class="home-mode-title">Battle Mode</div>
          <div class="home-mode-sub">1v1 decision polls</div>
        </a>
        <a href="#/stories" class="home-mode-card">
          <div class="home-mode-icon" style="background:#ede9fe;color:#7c3aed">📖</div>
          <div class="home-mode-title">Story Chain</div>
          <div class="home-mode-sub">Collaborative fiction</div>
        </a>
        <a href="#/confessions" class="home-mode-card">
          <div class="home-mode-icon" style="background:#fce7f3;color:#db2777">🤫</div>
          <div class="home-mode-title">Confessions</div>
          <div class="home-mode-sub">Anonymous thoughts</div>
        </a>
        <a href="#/random" class="home-mode-card">
          <div class="home-mode-icon" style="background:#e0f2fe;color:#0284c7">🎲</div>
          <div class="home-mode-title">Random Prompt</div>
          <div class="home-mode-sub">Shuffle scenarios</div>
        </a>
      </div>

      <!-- Filters & Search Card -->
      <div class="card pad">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <div class="filters" id="catFilters" style="flex:1;min-width:200px"></div>
          <select id="sortSelect" class="select" style="width:auto;min-width:130px;flex:0 0 auto">
            <option value="new">Newest</option>
            <option value="trending">Trending</option>
            <option value="popular">Most answered</option>
          </select>
        </div>
        <div class="row" style="margin-top:10px;gap:8px">
          <input id="challengeSearch" class="input" placeholder="Search hypotheticals…" value="${escapeHtml(challengesState.search)}" style="flex:1;min-width:0">
          <button class="btn secondary small" id="doSearch" style="flex-shrink:0">Search</button>
        </div>
      </div>

      <!-- Scenarios List Stream (Full Width Cards) -->
      <div id="challengesGrid" class="grid" style="gap:10px"></div>

      <!-- Pagination Controls -->
      <div class="row" style="justify-content:center;margin-top:14px;gap:10px;align-items:center">
        <button class="btn secondary small" id="prevPage">Previous</button>
        <span class="small" id="pageInfo" style="font-weight:700"></span>
        <button class="btn secondary small" id="nextPage">Next</button>
      </div>
    </div>

    <!-- Create Challenge Modal -->
    <div id="createChallengeModal" class="modal"><div class="modal-card"><div class="modal-head"><div style="font-weight:800;font-size:16px">Create a challenge</div><button class="icon-btn" id="closeCreate" style="width:32px;height:32px" aria-label="Close modal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6 18 18"/><path d="M18 6 6 18"/></svg></button></div><div class="modal-body">
      <label class="label">Title (10-150)</label><input id="ccTitle" class="input" placeholder="What if…" >
      <label class="label" style="margin-top:10px">Description (20-800)</label><textarea id="ccDesc" class="input" style="min-height:90px" placeholder="Context that makes this scenario intriguing"></textarea>
      <label class="label" style="margin-top:10px">Category</label><select id="ccCat" class="select">
        <option>What If scenarios</option><option>Opinion</option><option>Logic</option><option>Humor</option><option>Debate</option><option>School and everyday life</option><option>Relationships</option><option>Fictional situations</option><option>Random scenarios</option>
      </select>
      <div id="ccError" class="small" style="color:var(--accent);margin-top:8px;display:none;font-weight:700"></div>
      <button class="btn block" style="margin-top:14px" id="submitCreate">Publish challenge</button>
    </div></div></div>
  `;

  const categories = ['all','What If scenarios','Opinion','Logic','Humor','Debate','School and everyday life','Relationships','Fictional situations','Random scenarios'];
  $('#catFilters').innerHTML = categories.map(c=> `<button class="chip ${challengesState.category===c?'active':''}" data-cat="${c}">${c==='all'?'All':c}</button>`).join('');
  $('#sortSelect').value = sort;

  $$('#catFilters .chip').forEach(b=> b.addEventListener('click', ()=>{
    challengesState.category=b.dataset.cat;
    challengesState.page=1;
    renderChallenges();
  }));
  $('#sortSelect').addEventListener('change', e=>{
    challengesState.sort=e.target.value;
    challengesState.page=1;
    renderChallenges();
  });
  $('#doSearch').addEventListener('click', ()=>{
    challengesState.search=$('#challengeSearch').value.trim();
    challengesState.page=1;
    loadChallenges();
  });
  $('#challengeSearch').addEventListener('keydown', e=>{
    if(e.key==='Enter'){
      challengesState.search=e.target.value.trim();
      challengesState.page=1;
      loadChallenges();
    }
  });
  $('#createChallengeBtn').addEventListener('click', ()=>{
    if(!state.user){ openAuth('login'); return; }
    $('#createChallengeModal').classList.add('open');
  });
  $('#closeCreate').addEventListener('click', ()=> $('#createChallengeModal').classList.remove('open'));
  $('#createChallengeModal').addEventListener('click', e=>{
    if(e.target===$('#createChallengeModal')) $('#createChallengeModal').classList.remove('open');
  });
  $('#submitCreate').addEventListener('click', async ()=>{
    const title=$('#ccTitle').value.trim(), description=$('#ccDesc').value.trim(), category=$('#ccCat').value;
    const err=$('#ccError');
    try{
      await api('/api/challenges', { method:'POST', body: JSON.stringify({ title, description, category }) });
      toast('Challenge created • +15 XP');
      $('#createChallengeModal').classList.remove('open');
      challengesState.page=1;
      loadChallenges();
      refreshAuth();
    }catch(e){ err.textContent=e.message; err.style.display='block'; }
  });
  $('#prevPage').addEventListener('click', ()=>{ if(challengesState.page>1){ challengesState.page--; loadChallenges(); }});
  $('#nextPage').addEventListener('click', ()=>{ challengesState.page++; loadChallenges(); });
  loadChallenges();
}

async function loadChallenges(){
  const grid=$('#challengesGrid'), info=$('#pageInfo');
  if(!grid) return;
  grid.innerHTML = `<div class="loading" style="grid-column:1/-1">Loading challenges…</div>`;
  try{
    const params = new URLSearchParams({ page: challengesState.page, limit:12, sort:challengesState.sort, status:'active' });
    if(challengesState.category!=='all') params.set('category', challengesState.category);
    if(challengesState.search) params.set('search', challengesState.search);
    const data = await api('/api/challenges?'+params.toString());
    info.textContent = `Page ${data.page} • ${data.total} challenges`;
    if(data.challenges.length===0){
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No challenges found. Try another filter or create one.</div>`;
      return;
    }
    grid.innerHTML = data.challenges.map(c=>`
      <a href="#/challenge/${c.id}" class="scenario-card">
        <div class="scenario-card-head">
          <span class="chip" style="font-size:10.5px;padding:2px 8px;background:var(--surface-2);border:1px solid var(--line)">${escapeHtml(c.category)}</span>
          <span class="small muted" style="font-size:11.5px">${timeAgo(c.created_at)}</span>
        </div>
        <div class="scenario-card-title">${escapeHtml(c.title)}</div>
        <div class="scenario-card-desc">${escapeHtml(c.description)}</div>
        <div class="scenario-card-footer">
          <span class="small muted" style="font-weight:700;font-size:12px">💬 ${c.participant_count} answers</span>
          <span class="chip" style="font-size:11px;padding:3px 8px;background:${c.hasAnswered?'var(--ink)':'var(--surface)'};color:${c.hasAnswered?'white':'var(--ink)'}">${c.hasAnswered?'Answered':'Answer to unlock'}</span>
        </div>
      </a>
    `).join('');
  }catch(e){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderChallengeDetail(id){
  $('#app').innerHTML = `<div class="loading">Loading scenario…</div>`;
  try{
    const { challenge } = await api('/api/challenges/'+id);
    let answersData;
    try{ answersData = await api(`/api/challenges/${id}/answers?sort=top&limit=10&page=1`); } catch(e){ answersData={answers:[], hasAnswered:false, total:0}; }
    const hasAnswered = answersData.hasAnswered;
    const isOwner = state.user && state.user.id===challenge.created_by;
    $('#app').innerHTML = `
      <div class="feed">
        <a href="#/challenges" class="small" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--ink)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18 9 12l6-6"/></svg>Back to challenges</a>
        <div class="card pad" style="border-radius:18px">
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span class="chip">${escapeHtml(challenge.category)}</span>
            <span class="small muted">${fmtDate(challenge.created_at)} • ${challenge.participant_count} participants</span>
          </div>
          <div class="h2" style="margin-top:12px;font-family:'Fraunces', serif">${escapeHtml(challenge.title)}</div>
          <div class="small" style="margin-top:8px;line-height:1.65;font-size:14.5px">${escapeHtml(challenge.description)}</div>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn secondary small" id="reportChallenge"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l9 8-9 8-9-8 9-8Z"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor"/></svg>Report</button>
            ${isOwner?`<span class="small muted">You created this</span>`:''}
          </div>
          <div id="answerArea" style="margin-top:14px"></div>
        </div>
        <div class="card pad">
          <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
            <div class="h3">Community answers <span class="small muted" style="font-weight:600">(${answersData.total})</span></div>
            <div class="row" style="gap:6px">
              <button class="chip ${answersData.sort==='top'?'active':''}" data-sort="top">Top</button>
              <button class="chip ${answersData.sort==='new'?'active':''}" data-sort="new">New</button>
            </div>
          </div>
          <div id="answersList" class="grid" style="margin-top:12px;gap:10px"></div>
          <div class="row" style="justify-content:center;margin-top:12px">
            <button class="btn secondary small" id="loadMoreAnswers">Load more</button>
          </div>
        </div>
      </div>
    `;
    $('#reportChallenge').addEventListener('click', ()=> openReport('challenge', challenge.id));
    // answer area
    const area=$('#answerArea');
    if(!state.user){
      area.innerHTML = `<div class="empty" style="text-align:left"><div style="font-weight:800">Answer to unlock all responses</div><div class="small" style="margin-top:4px">Log in, share your take, then read how others responded.</div><div class="row" style="margin-top:10px"><button class="btn small" id="detailLogin">Log in to answer</button></div></div>`;
      $('#detailLogin').addEventListener('click', ()=>openAuth('login'));
    } else if(hasAnswered){
      const my = challenge.myAnswer;
      area.innerHTML = `
        <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px">
          <div class="row" style="justify-content:space-between"><span style="font-weight:800;font-size:14px">Your answer</span><span class="small muted">Submitted</span></div>
          <div class="small" style="margin-top:6px;white-space:pre-wrap;line-height:1.5">${escapeHtml(my.body)}</div>
          <div class="row" style="margin-top:10px;gap:6px">
            <button class="btn secondary small" id="editToggle">Edit answer</button>
            <button class="btn ghost small" id="deleteMyAnswer" style="color:var(--accent)">Delete</button>
          </div>
          <div id="editBox" style="display:none;margin-top:10px">
            <textarea id="editInput" class="input" style="min-height:80px">${escapeHtml(my.body)}</textarea>
            <div class="row" style="margin-top:8px;justify-content:flex-end;gap:8px">
              <button class="btn secondary small" id="cancelEdit">Cancel</button>
              <button class="btn small" id="saveEdit">Save</button>
            </div>
          </div>
        </div>
      `;
      let myId = my.id;
      if(!myId && answersData.answers){
        const mineInList = answersData.answers.find(a=>a.user_id===state.user.id);
        if(mineInList) myId=mineInList.id;
      }
      $('#editToggle').addEventListener('click', ()=> $('#editBox').style.display='block');
      $('#cancelEdit').addEventListener('click', ()=> $('#editBox').style.display='none');
      $('#saveEdit').addEventListener('click', async ()=>{
        const body=$('#editInput').value.trim();
        if(body.length<10) return toast('Answer too short');
        try{
          await api('/api/answers/'+myId, { method:'PUT', body: JSON.stringify({ body }) });
          toast('Updated');
          renderChallengeDetail(id);
        }catch(e){ toast(e.message); }
      });
      $('#deleteMyAnswer').addEventListener('click', async ()=>{
        if(!confirm('Delete your answer?')) return;
        try{ await api('/api/answers/'+myId, { method:'DELETE' }); toast('Deleted'); renderChallengeDetail(id); }catch(e){ toast(e.message); }
      });
    } else {
      area.innerHTML = `
        <div style="background:var(--ink);color:white;border-radius:14px;padding:14px">
          <div style="font-weight:800;font-size:15px">Your turn</div>
          <div class="small" style="color:rgba(255,255,255,0.8);margin-top:4px">Share your answer to unlock the community discussion.</div>
          <textarea id="detailAnswer" class="input" style="margin-top:10px;min-height:88px;background:white;color:var(--ink)" placeholder="Type your answer…"></textarea>
          <div class="row" style="margin-top:10px;justify-content:space-between;align-items:center">
            <span class="small" style="color:rgba(255,255,255,0.7);font-size:12px">10-1000 characters • Earn +10 XP</span>
            <button class="btn small" style="background:white;color:var(--ink);border-color:white" id="submitDetailAnswer">Submit</button>
          </div>
          <div id="detailError" class="small" style="color:#fca5a5;margin-top:8px;display:none;font-weight:700"></div>
        </div>
      `;
      $('#submitDetailAnswer').addEventListener('click', async ()=>{
        const body=$('#detailAnswer').value.trim();
        const err=$('#detailError');
        if(body.length<10){ err.textContent='Answer must be at least 10 characters'; err.style.display='block'; return; }
        err.style.display='none';
        try{
          await api('/api/challenges/'+id+'/answers', { method:'POST', body: JSON.stringify({ body }) });
          toast('Answer submitted • +10 XP');
          refreshAuth();
          renderChallengeDetail(id);
        }catch(e){ err.textContent=e.message; err.style.display='block'; }
      });
    }

    // answers list rendering
    let page=1, sort='top';
    async function loadAnswers(reset=false){
      if(reset) page=1;
      const data = await api(`/api/challenges/${id}/answers?sort=${sort}&limit=8&page=${page}`);
      const list=$('#answersList');
      const renderOne = (a)=>{
        const isMine = state.user && a.user_id===state.user.id;
        const masked = a.masked;
        return `
        <div class="card pad" style="padding:12px 14px">
          <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
            <div class="row" style="gap:8px;flex:1;min-width:0">
              <div class="avatar" style="width:32px;height:32px;font-size:13px">${escapeHtml((a.display_name||a.username||'U').slice(0,1).toUpperCase())}</div>
              <div style="min-width:0;flex:1">
                <div style="font-weight:800;font-size:13.5px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.display_name||a.username)} ${a.role==='bot' ? '<span class="chip" style="font-size:9.5px;background:var(--ink);color:white;margin-left:4px;padding:1px 5px">Bot</span>' : ''} <span class="small muted" style="font-size:11.5px">Lvl ${a.level||1} • ${timeAgo(a.created_at)}</span></div>
                <div class="small muted" style="font-size:11.5px">@${escapeHtml(a.username||'user')}</div>
              </div>
            </div>
            <button class="btn secondary small" data-report="${a.id}" style="padding:4px 8px;font-size:11px;min-height:28px">Report</button>
          </div>
          ${masked ? `
            <div class="empty" style="margin-top:8px;text-align:left;padding:12px;background:var(--surface-2)"><div style="font-weight:800">Answer hidden</div><div class="small">Submit your own answer to reveal community responses.</div></div>
          ` : `
            <div class="small" style="margin-top:8px;white-space:pre-wrap;line-height:1.6;font-size:14px;color:var(--ink)">${escapeHtml(a.body)}</div>
            ${isMine ? `<div class="row" style="margin-top:6px;gap:6px"><button class="btn secondary small" data-edit="${a.id}" style="padding:4px 8px;font-size:12px">Edit</button><button class="btn ghost small" data-delete="${a.id}" style="color:var(--accent);padding:4px 8px;font-size:12px">Delete</button></div>` : ''}
            <div class="row" style="margin-top:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <div class="row" style="gap:6px">
                <button class="vote-btn ${a.hasVoted?'active':''}" data-vote="${a.id}">▲ ${a.vote_count} ${a.vote_count===1?'vote':'votes'}</button>
                <button class="btn secondary small" data-reply-toggle="${a.id}">Reply</button>
                <span class="small muted">${a.reply_count||0} replies</span>
              </div>
              <span class="small muted" style="font-size:11px">${a.updated_at!==a.created_at?'edited':''}</span>
            </div>
            <div id="replies-${a.id}" class="grid" style="margin-top:8px;gap:6px;display:none"></div>
            <div id="replyBox-${a.id}" style="display:none;margin-top:8px">
              <div class="row" style="gap:6px">
                <input class="input" id="replyInput-${a.id}" placeholder="Write a reply…" style="flex:1;min-width:0">
                <button class="btn small" data-send-reply="${a.id}" style="flex-shrink:0">Send</button>
              </div>
            </div>
          `}
        </div>
        `;
      };
      if(reset) list.innerHTML = data.answers.map(renderOne).join('') || `<div class="empty">No answers yet. Be the first.</div>`;
      else if(page===1) list.innerHTML = data.answers.map(renderOne).join('') || `<div class="empty">No answers yet</div>`;
      else list.innerHTML += data.answers.map(renderOne).join('');

      list.querySelectorAll('[data-vote]').forEach(b=> b.addEventListener('click', async ()=>{
        if(!state.user) return openAuth('login');
        try{
          const res = await api('/api/answers/'+b.dataset.vote+'/vote', { method:'POST', body: JSON.stringify({ value:1 }) });
          b.textContent = `▲ ${res.vote_count} ${res.vote_count===1?'vote':'votes'}`;
          b.classList.toggle('active', res.voted);
          toast(res.voted?'Voted • +5 XP':'Vote removed');
        }catch(e){ toast(e.message); }
      }));
      list.querySelectorAll('[data-report]').forEach(b=> b.addEventListener('click', ()=> openReport('answer', b.dataset.report)));
      list.querySelectorAll('[data-reply-toggle]').forEach(b=> b.addEventListener('click', async ()=>{
        const aid=b.dataset.replyToggle;
        const box=$(`#replyBox-${aid}`), repliesEl=$(`#replies-${aid}`);
        box.style.display = box.style.display==='none'?'block':'none';
        if(repliesEl.style.display==='none'){
          repliesEl.style.display='grid';
          try{
            const { replies } = await api('/api/answers/'+aid+'/replies');
            repliesEl.innerHTML = replies.length? replies.map(r=>`
              <div style="border-left:2px solid var(--line);padding:6px 10px;margin-left:4px;background:var(--surface-2);border-radius:8px">
                <div style="font-weight:700;font-size:12.5px">${escapeHtml(r.display_name)} ${r.role==='bot' ? '<span class="chip" style="font-size:9px;background:var(--ink);color:white;margin-left:4px;padding:1px 4px">Bot</span>' : ''} <span class="small muted" style="font-size:11px">${timeAgo(r.created_at)}</span></div>
                <div class="small" style="margin-top:3px;white-space:pre-wrap;color:var(--ink)">${escapeHtml(r.body)}</div>
                <button class="small" data-report-reply="${r.id}" style="margin-top:4px;color:var(--muted);border:none;background:transparent;cursor:pointer;font-weight:700;font-size:10.5px;padding:0">Report</button>
              </div>
            `).join('') : `<div class="small muted" style="padding:4px 6px">No replies yet</div>`;
            repliesEl.querySelectorAll('[data-report-reply]').forEach(x=> x.addEventListener('click', ()=> openReport('reply', x.dataset.reportReply)));
          }catch{}
        }
      }));
      list.querySelectorAll('[data-send-reply]').forEach(b=> b.addEventListener('click', async ()=>{
        const aid=b.dataset.sendReply;
        const input=$(`#replyInput-${aid}`);
        const body=input.value.trim();
        if(body.length<2) return toast('Reply too short');
        try{
          await api('/api/answers/'+aid+'/reply', { method:'POST', body: JSON.stringify({ body }) });
          toast('Reply posted • +5 XP');
          input.value='';
          const { replies } = await api('/api/answers/'+aid+'/replies');
          const el=$(`#replies-${aid}`);
          el.innerHTML = replies.map(r=>`
            <div style="border-left:2px solid var(--line);padding:6px 10px;margin-left:4px;background:var(--surface-2);border-radius:8px">
              <div style="font-weight:700;font-size:12.5px">${escapeHtml(r.display_name)} ${r.role==='bot' ? '<span class="chip" style="font-size:9px;background:var(--ink);color:white;margin-left:4px;padding:1px 4px">Bot</span>' : ''} <span class="small muted" style="font-size:11px">${timeAgo(r.created_at)}</span></div>
              <div class="small" style="margin-top:3px;white-space:pre-wrap;color:var(--ink)">${escapeHtml(r.body)}</div>
            </div>
          `).join('');
        }catch(e){ toast(e.message); }
      }));
      list.querySelectorAll('[data-delete]').forEach(b=> b.addEventListener('click', async ()=>{
        if(!confirm('Delete answer?')) return;
        try{ await api('/api/answers/'+b.dataset.delete, { method:'DELETE' }); toast('Deleted'); renderChallengeDetail(id); }catch(e){ toast(e.message); }
      }));
      list.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', async ()=>{
        const newBody = prompt('Edit your answer (10-1000 chars):', '');
        if(newBody===null) return;
        if(newBody.trim().length<10) return toast('Too short');
        try{ await api('/api/answers/'+b.dataset.edit, { method:'PUT', body: JSON.stringify({ body: newBody.trim() }) }); toast('Updated'); renderChallengeDetail(id); }catch(e){ toast(e.message); }
      }));
      const btn=$('#loadMoreAnswers');
      if(btn){
        if(data.answers.length<8) btn.style.display='none'; else btn.style.display='inline-flex';
      }
      if(!data.hasAnswered){
        list.querySelectorAll('.vote-btn, [data-reply-toggle]').forEach(el=>{ el.disabled=true; el.style.opacity='0.5'; el.title='Answer to interact'; });
      }
    }
    await loadAnswers(true);
    const topBtn = document.querySelector('[data-sort="top"]');
    const newBtn = document.querySelector('[data-sort="new"]');
    function setSort(s){
      sort=s;
      topBtn?.classList.toggle('active', s==='top');
      newBtn?.classList.toggle('active', s==='new');
      loadAnswers(true);
    }
    if(topBtn) topBtn.addEventListener('click', ()=> setSort('top'));
    if(newBtn) newBtn.addEventListener('click', ()=> setSort('new'));
    $('#loadMoreAnswers')?.addEventListener('click', async ()=>{ page++; await loadAnswers(false); });
  }catch(e){
    $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderBattles(){
  $('#app').innerHTML = `<div class="loading">Loading battles…</div>`;
  try{
    const { battles } = await api('/api/battles');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
          <div>
            <div class="kicker">Choose sides</div>
            <div class="h1">Battle Mode</div>
            <div class="small muted" style="margin-top:4px">Two answers. One question. Vote once. Win XP.</div>
          </div>
          <button class="btn small" id="createBattleBtn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>New battle</button>
        </div>
        <div id="createBattleForm" class="card pad" style="display:none">
          <label class="label">Question (10-200)</label><input id="battleQ" class="input" placeholder="Which scenario would you pick…?">
          <label class="label" style="margin-top:10px">Option A (5-300)</label><textarea id="battleA" class="input" style="min-height:70px" placeholder="First choice…"></textarea>
          <label class="label" style="margin-top:10px">Option B (5-300)</label><textarea id="battleB" class="input" style="min-height:70px" placeholder="Second choice…"></textarea>
          <div class="row" style="margin-top:12px;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="cancelBattle">Cancel</button><button class="btn small" id="submitBattle">Create battle</button></div>
          <div id="battleError" class="small" style="color:var(--accent);margin-top:8px;display:none;font-weight:700"></div>
        </div>
        <div class="grid" style="gap:12px">
          ${battles.length? battles.map(b=>{
            const total=b.votes_a+b.votes_b;
            const pctA = total ? Math.round(b.votes_a/total*100) : 50;
            const chosen = b.myChoice;
            return `
            <div class="battle" data-id="${b.id}">
              <div style="padding:14px 16px">
                <div class="small muted">${timeAgo(b.created_at)} • ${total} ${total===1?'vote':'votes'}</div>
                <div style="font-weight:800;font-size:17px;margin-top:4px;line-height:1.3">${escapeHtml(b.question)}</div>
              </div>
              <div class="battle-options">
                <div class="battle-opt ${chosen==='A'?'battle-optChosen':''}" data-vote="A" data-id="${b.id}">
                  <div class="small" style="font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:${chosen==='A'?'1':'.7'}">Option A ${chosen==='A'?'• Your vote ✓':''}</div>
                  <div style="margin-top:6px;line-height:1.5;font-size:14px">${escapeHtml(b.answer_a)}</div>
                  <div class="progress" style="margin-top:10px"><div style="width:${pctA}%"></div></div>
                  <div class="small" style="margin-top:6px;font-weight:700">${b.votes_a} votes • ${pctA}%</div>
                </div>
                <div class="battle-opt ${chosen==='B'?'battle-optChosen':''}" data-vote="B" data-id="${b.id}">
                  <div class="small" style="font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:${chosen==='B'?'1':'.7'}">Option B ${chosen==='B'?'• Your vote ✓':''}</div>
                  <div style="margin-top:6px;line-height:1.5;font-size:14px">${escapeHtml(b.answer_b)}</div>
                  <div class="progress" style="margin-top:10px"><div style="width:${100-pctA}%"></div></div>
                  <div class="small" style="margin-top:6px;font-weight:700">${b.votes_b} votes • ${100-pctA}%</div>
                </div>
              </div>
              ${chosen ? `<div class="small" style="padding:10px 16px;background:var(--surface-2);border-top:1px solid var(--line);font-weight:700">You voted ${chosen} • Decision recorded</div>` : `<div class="small muted" style="padding:10px 16px;border-top:1px solid var(--line)">Tap an option to vote — one vote per battle</div>`}
            </div>
          `}).join('') : `<div class="empty">No battles yet. Create the first one.</div>`}
        </div>
      </div>
    `;
    $('#createBattleBtn').addEventListener('click', ()=>{
      if(!state.user) return openAuth('login');
      $('#createBattleForm').style.display='block';
    });
    $('#cancelBattle').addEventListener('click', ()=> $('#createBattleForm').style.display='none');
    $('#submitBattle').addEventListener('click', async ()=>{
      const question=$('#battleQ').value.trim(), answer_a=$('#battleA').value.trim(), answer_b=$('#battleB').value.trim();
      const err=$('#battleError');
      try{
        await api('/api/battles', { method:'POST', body: JSON.stringify({ question, answer_a, answer_b }) });
        toast('Battle created • +10 XP');
        renderBattles();
        refreshAuth();
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
    $$('.battle-opt').forEach(el=> el.addEventListener('click', async ()=>{
      if(!state.user) return openAuth('login');
      const id=el.dataset.id, choice=el.dataset.vote;
      try{
        await api('/api/battles/'+id+'/vote', { method:'POST', body: JSON.stringify({ choice }) });
        toast('Vote counted • +5 XP');
        renderBattles();
        refreshAuth();
      }catch(e){ toast(e.message); }
    }));
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderStories(){
  $('#app').innerHTML = `<div class="loading">Loading story chains…</div>`;
  try{
    const { stories } = await api('/api/stories');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
          <div>
            <div class="kicker">Collaborative fiction</div>
            <div class="h1">Story Chain</div>
            <div class="small muted" style="margin-top:4px">One sentence at a time. Vote for the best continuation.</div>
          </div>
          <button class="btn small" id="newStoryBtn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Start a story</button>
        </div>
        <div id="newStoryForm" class="card pad" style="display:none">
          <label class="label">Title (5-80)</label><input id="storyTitle" class="input" placeholder="e.g. The Night Library">
          <label class="label" style="margin-top:10px">Opening sentence (20-400)</label><textarea id="storyStarter" class="input" style="min-height:80px" placeholder="The library opened only at midnight, and its books rewrote themselves…"></textarea>
          <div class="row" style="margin-top:12px;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="cancelStory">Cancel</button><button class="btn small" id="submitStory">Start story</button></div>
          <div id="storyError" class="small" style="color:var(--accent);margin-top:8px;display:none;font-weight:700"></div>
        </div>
        <div class="grid" style="gap:12px">
          ${stories.map(s=>`
            <a href="#/stories/${s.id}" class="scenario-card">
              <div class="scenario-card-head">
                <span class="chip" style="font-size:11px;padding:2px 8px;background:var(--surface-2);border:1px solid var(--line)">${escapeHtml(s.status)}</span>
                <span class="small muted">${s.entry_count} ${s.entry_count===1?'entry':'entries'}</span>
              </div>
              <div class="scenario-card-title">${escapeHtml(s.title)}</div>
              <div class="scenario-card-desc" style="-webkit-line-clamp:3">${escapeHtml(s.starter)}</div>
              <div class="scenario-card-footer">
                <span class="small muted" style="font-size:12px">${timeAgo(s.created_at)} • by ${escapeHtml(s.author||s.display_name||'Unknown')}</span>
                <span class="small" style="font-weight:800;color:var(--ink);font-size:12px">Read chain →</span>
              </div>
            </a>
          `).join('') || `<div class="empty">No stories yet. Start the first one.</div>`}
        </div>
      </div>
    `;
    $('#newStoryBtn').addEventListener('click', ()=>{ if(!state.user) return openAuth('login'); $('#newStoryForm').style.display='block'; });
    $('#cancelStory').addEventListener('click', ()=> $('#newStoryForm').style.display='none');
    $('#submitStory').addEventListener('click', async ()=>{
      const title=$('#storyTitle').value.trim(), starter=$('#storyStarter').value.trim();
      const err=$('#storyError');
      try{
        const { story } = await api('/api/stories', { method:'POST', body: JSON.stringify({ title, starter }) });
        toast('Story started • +12 XP');
        location.hash='#/stories/'+story.id;
        refreshAuth();
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderStoryDetail(id){
  $('#app').innerHTML = `<div class="loading">Loading story…</div>`;
  try{
    const { story, entries } = await api('/api/stories/'+id);
    const isFinished = story.status==='finished';
    $('#app').innerHTML = `
      <div class="feed">
        <a href="#/stories" class="small" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--ink)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18 9 12l6-6"/></svg>Back to stories</a>
        <div class="card pad" style="border-radius:18px">
          <div class="row" style="justify-content:space-between;gap:6px"><span class="chip">${escapeHtml(story.status)}</span><span class="small muted">${fmtDate(story.created_at)} • by ${escapeHtml(story.display_name||story.username||'Unknown')}</span></div>
          <div class="h1" style="margin-top:10px;font-family:'Fraunces', serif;font-size:26px">${escapeHtml(story.title)}</div>
          <div style="margin-top:12px;padding:14px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;line-height:1.65;font-size:14.5px">${escapeHtml(story.starter)}</div>
          ${!isFinished && state.user ? `<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn secondary small" id="finishStoryBtn">Finish story</button><span class="small muted">Creator or admin can mark finished</span></div>` : ''}
        </div>
        <div class="card pad">
          <div class="h3">Continuations <span class="small muted">(${entries.length})</span></div>
          <div class="small muted" style="margin-top:4px">Read in sequence. Vote for your favorite continuation.</div>
          <div class="grid" style="margin-top:12px;gap:10px">
            ${entries.map((e,i)=>`
              <div class="card pad" style="padding:12px 14px;background:${i%2===0?'var(--surface)':'var(--surface-2)'}">
                <div class="row" style="justify-content:space-between;gap:6px">
                  <div class="row" style="gap:8px"><div class="avatar" style="width:28px;height:28px;font-size:12px">${escapeHtml((e.display_name||e.username||'U').slice(0,1).toUpperCase())}</div><span style="font-weight:700;font-size:13px">${escapeHtml(e.display_name||e.username)} ${e.role==='bot' ? '<span class="chip" style="font-size:9px;background:var(--ink);color:white;margin-left:4px;padding:1px 4px">Bot</span>' : ''}</span><span class="small muted" style="font-size:11.5px">${timeAgo(e.created_at)}</span></div>
                  <span class="chip" style="font-size:11px;padding:2px 7px">#${i+1}</span>
                </div>
                <div class="small" style="margin-top:8px;white-space:pre-wrap;line-height:1.6;font-size:14px;color:var(--ink)">${escapeHtml(e.body)}</div>
                <div class="row" style="margin-top:10px;gap:6px">
                  <button class="vote-btn ${e.hasVoted?'active':''}" data-vote-entry="${e.id}">▲ ${e.vote_count} ${e.vote_count===1?'vote':'votes'}</button>
                  <button class="btn secondary small" data-report-entry="${e.id}" style="padding:4px 8px;font-size:11px;min-height:28px">Report</button>
                </div>
              </div>
            `).join('') || `<div class="empty">No continuations yet. Add the next sentence.</div>`}
          </div>
          ${isFinished ? `<div class="empty" style="margin-top:12px">This story is finished.</div>` : `
            <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
              ${!state.user ? `<div class="empty" style="text-align:left"><div style="font-weight:800">Log in to continue the story</div><button class="btn small" style="margin-top:8px" id="storyLogin">Log in</button></div>` : `
                <label class="label">Add continuation (10-400 chars)</label>
                <textarea id="entryBody" class="input" style="min-height:80px" placeholder="What happens next in the story?"></textarea>
                <div class="row" style="margin-top:10px;justify-content:space-between;align-items:center"><span class="small muted" style="font-size:12px">One continuation per turn • Earn +8 XP</span><button class="btn small" id="submitEntry">Continue story</button></div>
                <div id="entryError" class="small" style="color:var(--accent);margin-top:8px;display:none;font-weight:700"></div>
              `}
            </div>
          `}
        </div>
      </div>
    `;
    $('#storyLogin')?.addEventListener('click', ()=>openAuth('login'));
    $('#finishStoryBtn')?.addEventListener('click', async ()=>{
      try{ await api('/api/stories/'+id+'/finish', { method:'POST' }); toast('Story finished'); renderStoryDetail(id); }catch(e){ toast(e.message); }
    });
    $$('[data-vote-entry]').forEach(b=> b.addEventListener('click', async ()=>{
      if(!state.user) return openAuth('login');
      try{
        await api('/api/stories/entries/'+b.dataset.voteEntry+'/vote', { method:'POST' });
        toast('Voted • +5 XP');
        renderStoryDetail(id);
      }catch(e){ toast(e.message); }
    }));
    $$('[data-report-entry]').forEach(b=> b.addEventListener('click', ()=> openReport('story', b.dataset.reportEntry)));
    $('#submitEntry')?.addEventListener('click', async ()=>{
      const body=$('#entryBody').value.trim();
      const err=$('#entryError');
      if(body.length<10){ err.textContent='Continuation must be at least 10 characters'; err.style.display='block'; return; }
      err.style.display='none';
      try{
        await api('/api/stories/'+id+'/entries', { method:'POST', body: JSON.stringify({ body }) });
        toast('Added continuation • +8 XP');
        refreshAuth();
        renderStoryDetail(id);
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderRandom(){
  if(!state.user){
    $('#app').innerHTML = `<div class="empty" style="text-align:left"><div class="h2">Random Mode</div><div class="small" style="margin-top:6px">Log in to get a random hypothetical challenge you haven't answered yet.</div><button class="btn small" style="margin-top:12px" id="randomLogin">Log in</button></div>`;
    $('#randomLogin').addEventListener('click', ()=>openAuth('login'));
    return;
  }
  $('#app').innerHTML = `<div class="loading">Shuffling hypotheticals…</div>`;
  try{
    const { challenge } = await api('/api/random');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="kicker">Random Mode</div>
        <div class="h1" style="margin-top:4px">Fresh Hypothetical</div>
        <div class="small muted" style="margin-top:4px">Drawn from unanswered community challenges.</div>
        <div class="card pad" style="border-radius:18px">
          <span class="chip">${escapeHtml(challenge.category)}</span>
          <div class="h2" style="margin-top:10px;font-family:'Fraunces', serif">${escapeHtml(challenge.title)}</div>
          <div class="small" style="margin-top:8px;line-height:1.65;font-size:14.5px">${escapeHtml(challenge.description)}</div>
          <div style="margin-top:14px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px">
            <label class="label">Your answer</label>
            <textarea id="randAnswer" class="input" style="min-height:88px;background:white" placeholder="What is your take on this?"></textarea>
            <div class="row" style="margin-top:8px;justify-content:space-between;align-items:center"><span class="small muted" style="font-size:12px">10-1000 chars • Earn +10 XP</span><button class="btn small" id="submitRand">Submit answer</button></div>
            <div id="randError" class="small" style="color:var(--accent);margin-top:8px;display:none;font-weight:700"></div>
          </div>
          <div class="row" style="margin-top:12px;gap:8px"><button class="btn secondary small" id="nextRand">Shuffle again</button><a href="#/challenge/${challenge.id}" class="btn secondary small">Open challenge</a></div>
        </div>
      </div>
    `;
    $('#nextRand').addEventListener('click', ()=> renderRandom());
    $('#submitRand').addEventListener('click', async ()=>{
      const body=$('#randAnswer').value.trim();
      const err=$('#randError');
      if(body.length<10){ err.textContent='Answer must be at least 10 characters'; err.style.display='block'; return; }
      try{
        await api('/api/challenges/'+challenge.id+'/answers', { method:'POST', body: JSON.stringify({ body }) });
        toast('Answer saved • +10 XP');
        refreshAuth();
        renderRandom();
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderConfessions(){
  $('#app').innerHTML = `<div class="loading">Loading confessions…</div>`;
  try{
    const { confessions, total } = await api('/api/confessions?limit=12&page=1');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
          <div>
            <div class="kicker">Anonymous • Moderated</div>
            <div class="h1">Confessions</div>
            <div class="small muted" style="margin-top:4px">Anonymous text confessions. Identity is hidden from readers.</div>
          </div>
        </div>
        <div class="card pad">
          ${!state.user ? `<div class="empty" style="text-align:left"><div style="font-weight:800">Log in to post anonymously</div><div class="small" style="margin-top:4px">Anonymous to the community, audited for safety. Be honest and respectful.</div><button class="btn small" style="margin-top:10px" id="confLogin">Log in</button></div>` : `
            <label class="label">Share anonymously (10-600 chars)</label>
            <textarea id="confBody" class="input" style="min-height:88px" placeholder="I secretly think that…"></textarea>
            <div class="row" style="margin-top:8px;justify-content:space-between;align-items:center"><span class="small muted" style="font-size:12px">Moderated • Earn +5 XP</span><button class="btn small" id="submitConf">Post anonymously</button></div>
            <div id="confError" class="small" style="color:var(--accent);margin-top:8px;display:none;font-weight:700"></div>
          `}
        </div>
        <div class="grid" style="gap:10px">
          ${confessions.map(c=>`
            <div class="scenario-card">
              <div class="scenario-card-head">
                <span class="chip" style="font-size:11px;padding:2px 8px;background:var(--surface-2);border:1px solid var(--line)">Anonymous</span>
                <span class="small muted" style="font-size:11.5px">${timeAgo(c.created_at)}</span>
              </div>
              <div class="small" style="margin-top:8px;white-space:pre-wrap;line-height:1.6;font-size:14.5px;color:var(--ink)">${escapeHtml(c.body)}</div>
              <div class="row" style="margin-top:8px"><button class="btn secondary small" data-report-conf="${c.id}" style="padding:4px 8px;font-size:11px;min-height:28px">Report</button></div>
            </div>
          `).join('') || `<div class="empty">No confessions yet.</div>`}
        </div>
        <div class="small muted" style="margin-top:4px;text-align:center">${total} confessions</div>
      </div>
    `;
    $('#confLogin')?.addEventListener('click', ()=>openAuth('login'));
    $$('[data-report-conf]').forEach(b=> b.addEventListener('click', ()=> openReport('confession', b.dataset.reportConf)));
    $('#submitConf')?.addEventListener('click', async ()=>{
      const body=$('#confBody').value.trim();
      const err=$('#confError');
      if(body.length<10){ err.textContent='Confession must be at least 10 characters'; err.style.display='block'; return; }
      try{
        await api('/api/confessions', { method:'POST', body: JSON.stringify({ body }) });
        toast('Confession posted anonymously • +5 XP');
        refreshAuth();
        renderConfessions();
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderExplore(qOpt=''){
  const q = qOpt || new URLSearchParams(location.hash.split('?')[1]||'').get('q') || '';
  $('#app').innerHTML = `<div class="loading">Exploring hypotheticals…</div>`;
  try{
    const data = await api('/api/explore');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
          <div>
            <div class="kicker">Explore</div>
            <div class="h1">Discover</div>
          </div>
          <div class="row" style="gap:8px;flex:1;min-width:200px">
            <input id="exploreSearch" class="input" placeholder="Search challenges, answers…" value="${escapeHtml(q)}" style="flex:1;min-width:0">
            <button class="btn small" id="exploreDo" style="flex-shrink:0">Search</button>
          </div>
        </div>
        <div class="home-modes-grid">
          <a href="#/confessions" class="home-mode-card">
            <div class="home-mode-icon" style="background:#fce7f3;color:#db2777">🤫</div>
            <div class="home-mode-title">Confessions</div>
            <div class="home-mode-sub">Anonymous text</div>
          </a>
          <a href="#/random" class="home-mode-card">
            <div class="home-mode-icon" style="background:#e0f2fe;color:#0284c7">🎲</div>
            <div class="home-mode-title">Random Mode</div>
            <div class="home-mode-sub">Shuffle prompts</div>
          </a>
        </div>
        <div id="searchResults"></div>
        <div class="card pad">
          <div class="section-title">Trending challenges</div>
          <div class="grid" style="gap:8px">
            ${data.trending.map(c=>`<a href="#/challenge/${c.id}" class="scenario-card" style="padding:12px"><div class="row" style="gap:8px;align-items:center"><span class="chip" style="font-size:10.5px;padding:2px 7px;background:var(--surface-2)">${escapeHtml(c.category)}</span><span style="font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px">${escapeHtml(c.title)}</span><span class="small muted" style="font-size:11.5px">${c.pc} ans</span></div></a>`).join('')}
          </div>
        </div>
        <div class="card pad">
          <div class="section-title">Popular answers</div>
          <div class="grid" style="gap:8px">
            ${data.popularAnswers.map(a=>`<a href="#/challenge/${a.challenge_id}" class="scenario-card" style="padding:12px"><div style="font-weight:800;font-size:13.5px">${escapeHtml(a.challenge_title.slice(0,70))}</div><div class="small" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px">${escapeHtml(a.body.slice(0,110))}</div><div class="small muted" style="margin-top:4px;font-size:11.5px">${escapeHtml(a.display_name)} • ${a.vote_count} votes</div></a>`).join('')}
          </div>
        </div>
        <div class="card pad">
          <div class="section-title">Active battles</div>
          <div class="grid" style="gap:8px">
            ${data.activeBattles.map(b=>`<a href="#/battles" class="scenario-card" style="padding:12px"><div style="font-weight:800;font-size:13.5px">${escapeHtml(b.question.slice(0,80))}</div><div class="small muted" style="margin-top:4px;font-size:11.5px">${b.votes_a+b.votes_b} votes</div></a>`).join('') || `<div class="small muted">No battles</div>`}
          </div>
        </div>
        <div class="card pad">
          <div class="section-title">Popular stories</div>
          <div class="grid" style="gap:8px">
            ${data.popularStories.map(s=>`<a href="#/stories/${s.id}" class="scenario-card" style="padding:12px"><div style="font-weight:800;font-size:13.5px">${escapeHtml(s.title)}</div><div class="small muted" style="margin-top:4px;font-size:11.5px">${s.entries} entries</div></a>`).join('') || `<div class="small muted">No stories</div>`}
          </div>
        </div>
        <div class="card pad">
          <div class="section-title">Categories</div>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${data.categories.map(c=>`<button class="chip" data-explore-cat="${escapeHtml(c.category)}">${escapeHtml(c.category)} • ${c.cnt}</button>`).join('')}
          </div>
        </div>
      </div>
    `;

    $$('[data-explore-cat]').forEach(b=> b.addEventListener('click', ()=>{
      challengesState.category = b.dataset.exploreCat;
      challengesState.page = 1;
      location.hash = '#/challenges';
    }));

    function doSearch(){
      const val=$('#exploreSearch').value.trim();
      if(val.length<2){ $('#searchResults').innerHTML=''; return; }
      api('/api/search?q='+encodeURIComponent(val)).then(res=>{
        if(res.challenges.length===0 && res.answers.length===0){
          $('#searchResults').innerHTML = `<div class="empty">No results for "${escapeHtml(val)}"</div>`;
        } else {
          $('#searchResults').innerHTML = `
            <div class="card pad">
              <div class="h3">Results for "${escapeHtml(val)}"</div>
              <div class="grid" style="margin-top:10px;gap:10px">
                <div>
                  <div class="small" style="font-weight:800;margin-bottom:6px">Challenges (${res.challenges.length})</div>
                  <div class="grid" style="gap:6px">
                    ${res.challenges.map(c=>`<a href="#/challenge/${c.id}" class="scenario-card" style="padding:10px"><div style="font-weight:800;font-size:13.5px">${escapeHtml(c.title)}</div><div class="small muted" style="margin-top:2px;font-size:12px">${escapeHtml(c.description.slice(0,90))}</div></a>`).join('') || `<div class="small muted">No challenges</div>`}
                  </div>
                </div>
                <div>
                  <div class="small" style="font-weight:800;margin-bottom:6px">Answers (${res.answers.length})</div>
                  <div class="grid" style="gap:6px">
                    ${res.answers.map(a=>`<a href="#/challenge/${a.challenge_id}" class="scenario-card" style="padding:10px"><div style="font-weight:700;font-size:13.5px">${escapeHtml(a.challenge_title.slice(0,60))}</div><div class="small" style="margin-top:2px;font-size:12px">${escapeHtml(a.body.slice(0,100))}</div></a>`).join('') || `<div class="small muted">No answers</div>`}
                  </div>
                </div>
              </div>
            </div>
          `;
        }
      });
    }
    if(q) doSearch();
    $('#exploreDo').addEventListener('click', doSearch);
    $('#exploreSearch').addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderProfile(username){
  $('#app').innerHTML = `<div class="loading">Loading profile…</div>`;
  try{
    const { user, stats } = await api('/api/users/'+username);
    const isOwn = state.user && state.user.username.toLowerCase()===username.toLowerCase();
    let personality=null;
    if(isOwn){
      try{ const p=await api('/api/personality/me'); personality=p.personality; }catch{}
    }
    $('#app').innerHTML = `
      <div class="feed">
        <div class="card pad" style="border-radius:18px">
          <div class="row" style="gap:12px;align-items:center">
            <div class="avatar lg">${escapeHtml((user.display_name||user.username||'U').slice(0,1).toUpperCase())}</div>
            <div style="min-width:0;flex:1">
              <div class="h2" style="font-family:'Fraunces', serif">${escapeHtml(user.display_name)}</div>
              <div class="small muted">@${escapeHtml(user.username)} • Joined ${fmtDate(user.created_at)}</div>
              <div class="row" style="margin-top:6px;gap:6px"><span class="chip" style="font-size:11px;padding:3px 8px">Lvl ${user.level} • ${user.xp} XP</span><span class="chip" style="font-size:11px;padding:3px 8px">${user.streak_count||0} day streak</span></div>
            </div>
          </div>
          <div class="small" style="margin-top:12px;line-height:1.6;white-space:pre-wrap;color:var(--ink)">${escapeHtml(user.bio||'No bio yet.')}</div>
          ${isOwn? `
            <div class="row" style="margin-top:12px;gap:8px">
              <button class="btn secondary small" id="editProfileBtn">Edit profile</button>
              <button class="btn ghost small" id="profileLogoutBtn" style="color:var(--accent)">Log out</button>
              ${state.user?.role==='admin' ? `<a href="#/admin" class="btn secondary small">Admin dashboard</a>` : ''}
            </div>
          ` : ''}
          <div id="editBox" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
            <label class="label">Display name</label><input id="editDisplay" class="input" value="${escapeHtml(user.display_name)}">
            <label class="label" style="margin-top:8px">Bio</label><textarea id="editBio" class="input" style="min-height:70px">${escapeHtml(user.bio||'')}</textarea>
            <div class="row" style="margin-top:8px;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="cancelEditProfile">Cancel</button><button class="btn small" id="saveProfile">Save</button></div>
          </div>
          <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:6px;margin-top:14px">
            <div class="card pad" style="padding:10px 4px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:18px">${stats.answers_count}</div><div class="small" style="font-size:11px">Answers</div></div>
            <div class="card pad" style="padding:10px 4px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:18px">${stats.battle_votes}</div><div class="small" style="font-size:11px">Battles</div></div>
            <div class="card pad" style="padding:10px 4px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:18px">${stats.story_entries}</div><div class="small" style="font-size:11px">Stories</div></div>
          </div>
        </div>
        ${personality ? `
          <div class="persona">
            <div class="kicker">Entertainment personality • For fun</div>
            <div class="h3" style="margin-top:6px;font-family:'Fraunces', serif">${escapeHtml(personality.type)}</div>
            <div class="small" style="margin-top:6px;line-height:1.6;color:var(--ink)">${escapeHtml(personality.desc)}</div>
            <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">${personality.traits.map(t=>`<span class="chip" style="font-size:11px">${escapeHtml(t)}</span>`).join('')}</div>
            <div class="small muted" style="margin-top:8px;font-size:12px">Top category: ${escapeHtml(personality.topCategory)} • ${personality.totalAnswers} answers • ${personality.votesReceived} votes received</div>
          </div>
        ` : isOwn ? `<div class="card pad"><div class="h3">Personality Profile</div><div class="small muted" style="margin-top:6px">Answer at least 3 challenges to reveal your entertainment persona profile.</div></div>` : ''}
        <div class="card pad">
          <div class="section-title">Popular answers</div>
          <div class="grid" style="gap:8px">
            ${stats.popular_answers.length ? stats.popular_answers.map(a=>`<a href="#/challenge/${a.challenge_id}" class="scenario-card" style="padding:12px"><div style="font-weight:700;font-size:13.5px">${escapeHtml(a.challenge_title.slice(0,70))}</div><div class="small" style="margin-top:4px;font-size:12.5px">${escapeHtml(a.body.slice(0,140))}</div><div class="small muted" style="margin-top:4px;font-size:11.5px">${a.vote_count} votes</div></a>`).join('') : `<div class="small muted">No answers yet</div>`}
          </div>
        </div>
      </div>
    `;
    $('#editProfileBtn')?.addEventListener('click', ()=> $('#editBox').style.display='block');
    $('#cancelEditProfile')?.addEventListener('click', ()=> $('#editBox').style.display='none');
    $('#profileLogoutBtn')?.addEventListener('click', logout);
    $('#saveProfile')?.addEventListener('click', async ()=>{
      const display_name=$('#editDisplay').value.trim(), bio=$('#editBio').value.trim();
      try{
        await api('/api/users/me', { method:'PUT', body: JSON.stringify({ display_name, bio }) });
        toast('Profile updated');
        renderProfile(username);
        refreshAuth();
      }catch(e){ toast(e.message); }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderMe(){
  if(!state.user){
    openAuth('login');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="card pad" style="text-align:center;padding:36px 16px;border-radius:18px;margin-top:12px">
          <div class="avatar lg" style="margin:0 auto 12px">?</div>
          <div class="h2" style="font-family:'Fraunces', serif">Your Profile</div>
          <div class="small muted" style="margin:6px auto 14px;max-width:320px">Log in or create an account to track your XP, view your entertainment persona, and manage your answers.</div>
          <div class="row" style="justify-content:center;gap:8px">
            <button class="btn small" id="meLoginBtn">Log in</button>
            <button class="btn secondary small" id="meJoinBtn">Create account</button>
          </div>
        </div>
      </div>
    `;
    $('#meLoginBtn')?.addEventListener('click', ()=> openAuth('login'));
    $('#meJoinBtn')?.addEventListener('click', ()=> openAuth('register'));
    return;
  }
  location.hash = '#/profile/'+state.user.username;
  renderProfile(state.user.username);
}

async function renderNotifications(){
  if(!state.user){ openAuth('login'); return; }
  $('#app').innerHTML = `<div class="loading">Loading notifications…</div>`;
  try{
    const { notifications } = await api('/api/notifications');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
          <div class="h1" style="font-size:24px">Notifications</div>
          <button class="btn secondary small" id="markAll">Mark all read</button>
        </div>
        <div class="grid" style="gap:8px">
          ${notifications.length? notifications.map(n=>`
            <div class="card pad" style="padding:12px;display:flex;gap:10px;align-items:flex-start;opacity:${n.is_read?'0.7':'1'};border-color:${n.is_read?'var(--line)':'var(--ink)'}">
              <div style="width:8px;height:8px;background:${n.is_read?'transparent':'var(--accent)'};border-radius:999px;margin-top:6px;flex-shrink:0"></div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:800;font-size:14px">${escapeHtml(n.title)}</div>
                <div class="small" style="margin-top:3px;color:var(--ink)">${escapeHtml(n.body)}</div>
                <div class="small muted" style="margin-top:4px;font-size:11.5px">${timeAgo(n.created_at)} • ${escapeHtml(n.type)}</div>
              </div>
              ${!n.is_read?`<button class="btn secondary small" data-read="${n.id}" style="padding:4px 8px;font-size:11.5px;min-height:28px">Read</button>`:''}
            </div>
          `).join('') : `<div class="empty">No notifications yet. Answer challenges and vote to get updates.</div>`}
        </div>
      </div>
    `;
    $('#markAll').addEventListener('click', async ()=>{ await api('/api/notifications/read-all', { method:'POST' }); toast('All marked read'); renderNotifications(); fetchNotifications(); });
    $$('[data-read]').forEach(b=> b.addEventListener('click', async ()=>{ await api('/api/notifications/'+b.dataset.read+'/read', { method:'POST' }); renderNotifications(); fetchNotifications(); }));
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderAdmin(){
  if(!state.user || state.user.role!=='admin'){
    $('#app').innerHTML = `<div class="empty">Admin only. Log in as <b>admin / admin123</b></div>`;
    return;
  }
  $('#app').innerHTML = `<div class="loading">Loading admin dashboard…</div>`;
  try{
    const stats = await api('/api/admin/stats');
    const reports = await api('/api/admin/reports');
    const users = await api('/api/admin/users');
    const logs = await api('/api/admin/moderation-log');
    $('#app').innerHTML = `
      <div class="feed">
        <div class="h1" style="font-size:26px">Admin Dashboard</div>
        <div class="small muted" style="margin-top:4px">Moderation, reports, and community activity.</div>
        <div class="grid grid-3" style="gap:8px">
          <div class="card pad" style="text-align:center;padding:12px"><div style="font-weight:900;font-size:22px">${stats.users}</div><div class="small" style="font-size:11px">Users (${stats.activeUsers} active)</div></div>
          <div class="card pad" style="text-align:center;padding:12px"><div style="font-weight:900;font-size:22px">${stats.challenges}</div><div class="small" style="font-size:11px">Challenges</div></div>
          <div class="card pad" style="text-align:center;padding:12px"><div style="font-weight:900;font-size:22px">${stats.answers}</div><div class="small" style="font-size:11px">Answers</div></div>
          <div class="card pad" style="text-align:center;padding:12px"><div style="font-weight:900;font-size:22px">${stats.pendingReports}</div><div class="small" style="font-size:11px">Pending reports</div></div>
          <div class="card pad" style="text-align:center;padding:12px"><div style="font-weight:900;font-size:22px">${stats.battles}</div><div class="small" style="font-size:11px">Battles</div></div>
          <div class="card pad" style="text-align:center;padding:12px"><div style="font-weight:900;font-size:22px">${stats.stories}</div><div class="small" style="font-size:11px">Stories</div></div>
        </div>
        <div class="card pad">
          <div class="h3">Reports (${reports.reports.length})</div>
          <div class="grid" style="margin-top:8px;max-height:500px;overflow-y:auto;gap:8px">
            ${reports.reports.map(r=>`
              <div class="card pad" style="padding:10px;background:var(--surface-2)">
                <div class="row" style="justify-content:space-between"><span class="chip" style="font-size:10px;padding:2px 6px">${escapeHtml(r.target_type)} • ${escapeHtml(r.status)}</span><span class="small muted" style="font-size:11px">${timeAgo(r.created_at)}</span></div>
                <div class="small" style="margin-top:4px"><b>Reporter:</b> ${escapeHtml(r.reporter)} • <b>Target:</b> ${escapeHtml(r.target_id.slice(0,8))}</div>
                <div class="small" style="margin-top:4px;white-space:pre-wrap">${escapeHtml(r.reason)}</div>
                ${r.status==='pending'?`
                <div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">
                  <button class="btn secondary small" data-action="dismiss" data-id="${r.id}" style="padding:4px 8px;font-size:11.5px">Dismiss</button>
                  <button class="btn secondary small" data-action="remove" data-id="${r.id}" style="border-color:var(--accent);color:var(--accent);padding:4px 8px;font-size:11.5px">Remove content</button>
                  <button class="btn secondary small" data-action="restore" data-id="${r.id}" style="padding:4px 8px;font-size:11.5px">Restore</button>
                  <button class="btn small" data-action="suspend" data-id="${r.id}" style="padding:4px 8px;font-size:11.5px">Suspend user</button>
                </div>`:`<div class="small muted" style="margin-top:4px;font-size:11px">Reviewed</div>`}
              </div>
            `).join('') || `<div class="small muted">No reports</div>`}
          </div>
        </div>
        <div class="card pad">
          <div class="h3">Users</div>
          <div class="grid" style="margin-top:8px;max-height:240px;overflow-y:auto;gap:6px">
            ${users.users.map(u=>`<div class="row" style="justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--surface-2)"><div><div style="font-weight:700;font-size:13px">${escapeHtml(u.display_name)} <span class="small muted">@${escapeHtml(u.username)} • ${escapeHtml(u.role)}</span></div><div class="small muted" style="font-size:11px">${u.xp} XP • Lvl ${u.level}</div></div><span class="small muted" style="font-size:11px">${fmtDate(u.created_at)}</span></div>`).join('')}
          </div>
        </div>
        <div class="card pad">
          <div class="h3">Moderation log</div>
          <div class="grid" style="margin-top:8px;max-height:220px;overflow-y:auto;gap:6px">
            ${logs.logs.map(l=>`<div class="small" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--surface-2);font-size:12px"><b>${escapeHtml(l.admin)}</b> ${escapeHtml(l.action)} ${escapeHtml(l.target_type)} ${escapeHtml(l.target_id.slice(0,6))} • ${timeAgo(l.created_at)}</div>`).join('') || `<div class="small muted">No actions yet</div>`}
          </div>
        </div>
      </div>
    `;
    $$('[data-action]').forEach(b=> b.addEventListener('click', async ()=>{
      const id=b.dataset.id, action=b.dataset.action;
      if(!confirm(`${action} this report?`)) return;
      try{ await api('/api/admin/reports/'+id+'/action', { method:'POST', body: JSON.stringify({ action, reason: 'Admin action' }) }); toast('Action completed'); renderAdmin(); }catch(e){ toast(e.message); }
    }));
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

// Search topbar
let searchTimer;
$('#searchInput')?.addEventListener('input', e=>{
  clearTimeout(searchTimer);
  const v=e.target.value.trim();
  if(v.length<2) return;
  searchTimer=setTimeout(()=>{ location.hash='#/search?q='+encodeURIComponent(v); }, 400);
});
$('#searchInput')?.addEventListener('keydown', e=>{
  if(e.key==='Enter'){
    const v=e.target.value.trim();
    if(v.length>=2) location.hash='#/search?q='+encodeURIComponent(v);
  }
});

// Auth handlers
$('#loginBtn')?.addEventListener('click', ()=> openAuth('login'));
$('#registerBtn')?.addEventListener('click', ()=> openAuth('register'));
$('#closeAuth')?.addEventListener('click', closeAuth);
$('#authModal')?.addEventListener('click', e=>{ if(e.target===$('#authModal')) closeAuth(); });
$$('.tab').forEach(t=> t.addEventListener('click', ()=>{
  $$('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  const tab=t.dataset.tab;
  $('#loginForm').style.display=tab==='login'?'block':'none';
  $('#registerForm').style.display=tab==='register'?'block':'none';
  $('#authTitle').textContent=tab==='register'?'Create your account':'Welcome back';
}));
$('#loginForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const payload={ username: fd.get('username'), password: fd.get('password') };
  const err=$('#loginError'); err.style.display='none';
  try{
    await api('/api/auth/login', { method:'POST', body: JSON.stringify(payload) });
    closeAuth();
    toast('Welcome back');
    await refreshAuth();
    router();
  }catch(ex){ err.textContent=ex.message; err.style.display='block'; }
});
$('#registerForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const payload={ username: fd.get('username'), display_name: fd.get('display_name'), bio: fd.get('bio'), password: fd.get('password') };
  const err=$('#registerError'); err.style.display='none';
  try{
    await api('/api/auth/register', { method:'POST', body: JSON.stringify(payload) });
    closeAuth();
    toast('Account created • +25 XP');
    await refreshAuth();
    router();
  }catch(ex){ err.textContent=ex.message; err.style.display='block'; }
});
$('#logoutBtn')?.addEventListener('click', logout);
$('#profileBtn')?.addEventListener('click', ()=> location.hash='#/me');
$('#notifBtn')?.addEventListener('click', ()=> {
  if(!state.user) return openAuth('login');
  location.hash='#/notifications';
});
$('#closeReport')?.addEventListener('click', closeReport);
$('#cancelReport')?.addEventListener('click', closeReport);
$('#reportModal')?.addEventListener('click', e=>{ if(e.target===$('#reportModal')) closeReport(); });
$('#submitReport')?.addEventListener('click', async ()=>{
  const reason=$('#reportReason').value.trim();
  const err=$('#reportError');
  if(reason.length<10){ err.textContent='Reason must be 10-500 characters'; err.style.display='block'; return; }
  err.style.display='none';
  try{
    await api('/api/reports', { method:'POST', body: JSON.stringify({ target_type: state.reportTarget.target_type, target_id: state.reportTarget.target_id, reason }) });
    closeReport();
    toast('Report submitted • Thank you');
  }catch(e){ err.textContent=e.message; err.style.display='block'; }
});

window.addEventListener('hashchange', router);
window.addEventListener('load', async ()=>{
  await refreshAuth();
  router();
  setInterval(fetchNotifications, 30000);
});
