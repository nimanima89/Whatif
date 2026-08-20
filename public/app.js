const API = '';
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

let state = { user:null, notifUnread:0, reportTarget:null, currentChallengePage:1 };

function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2400);
}
async function api(path, opts={}){
  const res = await fetch(API+path, { credentials:'include', headers:{'Content-Type':'application/json', ...(opts.headers||{})}, ...opts });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function fmtDate(iso){ return new Date(iso).toLocaleDateString(undefined,{ month:'short', day:'numeric', year:'numeric'}); }
function timeAgo(iso){
  const sec = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(sec<60) return 'now';
  if(sec<3600) return Math.floor(sec/60)+'m ago';
  if(sec<86400) return Math.floor(sec/3600)+'h ago';
  if(sec<604800) return Math.floor(sec/86400)+'d ago';
  return fmtDate(iso);
}
function levelProgress(xp){
  let level=1, need=250, rem=xp;
  while(rem>=need){ rem-=need; level++; need=Math.floor(need*1.4); }
  const pct = Math.round(rem/need*100);
  return { level, pct, next:need-rem };
}

// NAV config
const NAV_ITEMS = [
  { id:'home', label:'Home', hash:'#/', icon:`<path d="M3 10L12 3l9 7"/><path d="M6 9v10a1 1 0 0 0 1 1h4v-5h2v5h4a1 1 0 0 0 1-1V9"/>` },
  { id:'challenges', label:'Challenges', hash:'#/challenges', icon:`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>` },
  { id:'explore', label:'Explore', hash:'#/explore', icon:`<circle cx="11" cy="11" r="6"/><path d="M20 20L16 16"/><path d="M11 8v6M8 11h6"/>` },
  { id:'battles', label:'Battle Mode', hash:'#/battles', icon:`<path d="M6 18 12 6l6 12"/><path d="M8 14h8"/><path d="M9 18H7a2 2 0 0 1-2-2v-1"/><path d="M15 18h2a2 2 0 0 0 2-2v-1"/>` },
  { id:'stories', label:'Story Chain', hash:'#/stories', icon:`<path d="M4 5a2 2 0 0 1 2-2h8l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z"/><path d="M14 3v4h4"/><path d="M8 13h8M8 17h8M8 9h3"/>` },
  { id:'random', label:'Random', hash:'#/random', icon:`<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h4v4H8zM12 12h4v4h-4z"/><circle cx="10" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="14" r="1" fill="currentColor"/>` },
  { id:'confessions', label:'Confessions', hash:'#/confessions', icon:`<path d="M12 3a7 7 0 0 0-7 7v3a3 3 0 0 0 3 3h1v2l3-2h2a3 3 0 0 0 3-3v-3a7 7 0 0 0-7-7Z"/><path d="M8 11h8M8 14h5"/>` },
  { id:'profile', label:'Profile', hash:'#/me', icon:`<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>` },
];
function navHtml(active){
  return NAV_ITEMS.map(n=>{
    const isActive = active===n.id;
    return `<a href="${n.hash}" class="${isActive?'active':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${n.icon}</svg>${n.label}</a>`;
  }).join('') + (state.user?.role==='admin' ? `<div class="nav-label">Admin</div><a href="#/admin" class="${active==='admin'?'active':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1 2-4Z"/><circle cx="12" cy="12" r="2"/></svg>Dashboard</a>` : '');
}
function mobileNavHtml(active){
  const items = NAV_ITEMS.slice(0,6); // limit for mobile
  // ensure include profile and maybe battles/explore
  const mobileItems = [
    NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[3], NAV_ITEMS[4], NAV_ITEMS[6], NAV_ITEMS[7]
  ];
  return mobileItems.map(n=>{
    const isActive = active===n.id;
    return `<a href="${n.hash}" class="${isActive?'active':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${n.icon}</svg><span>${n.label.split(' ')[0]}</span></a>`;
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
    authBtns.style.display='none';
    userMenu.style.display='flex';
    profileBtn.textContent = (state.user.display_name||state.user.username).slice(0,1).toUpperCase();
    profileBtn.title = state.user.username;
    const prog = levelProgress(state.user.xp||0);
    xpPill.style.display='flex'; streakPill.style.display='flex';
    xpText.textContent = `${state.user.xp} XP`;
    levelText.textContent = `Lvl ${state.user.level || prog.level}`;
    streakText.textContent = `${state.user.streak_count||0} days`;
    sidebarUser.innerHTML = `
      <div class="row" style="gap:10px">
        <div class="avatar">${escapeHtml((state.user.display_name||state.user.username).slice(0,1).toUpperCase())}</div>
        <div style="min-width:0">
          <div style="font-weight:800;line-height:1">${escapeHtml(state.user.display_name)}</div>
          <div class="small muted">@${escapeHtml(state.user.username)} • Lvl ${state.user.level}</div>
        </div>
      </div>
      <div style="margin-top:10px">
        <div class="row" style="justify-content:space-between"><span class="small">Progress</span><span class="small">${prog.pct}%</span></div>
        <div class="levelBar" style="margin-top:6px"><div class="levelFill" style="width:${prog.pct}%"></div></div>
        <div class="small muted" style="margin-top:6px">${prog.next} XP to next level • ${state.user.streak_count||0} day streak</div>
      </div>
      <div class="row" style="margin-top:12px">
        <a href="#/me" class="btn small secondary block" style="flex:1">View profile</a>
        <button class="btn small secondary" id="sideLogout" style="padding:7px 10px" title="Logout"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg></button>
      </div>
    `;
    sidebarUser.querySelector('#sideLogout')?.addEventListener('click', logout);
  } else {
    authBtns.style.display='flex';
    userMenu.style.display='none';
    xpPill.style.display='none'; streakPill.style.display='none';
    sidebarUser.innerHTML = `
      <div style="font-weight:800">Join What If.</div>
      <div class="small muted" style="margin-top:4px;line-height:1.5">Answer one scenario and unlock the community. No ads. No followers.</div>
      <button class="btn small block" style="margin-top:10px" id="sideJoin">Create account</button>
    `;
    sidebarUser.querySelector('#sideJoin')?.addEventListener('click', ()=>openAuth('register'));
  }
}
function renderNav(){
  const hash = location.hash || '#/';
  let active='home';
  if(hash.startsWith('#/challenges')||hash.startsWith('#/challenge/')) active='challenges';
  else if(hash.startsWith('#/explore')||hash.startsWith('#/search')) active='explore';
  else if(hash.startsWith('#/battles')||hash.startsWith('#/battle/')) active='battles';
  else if(hash.startsWith('#/stories')) active='stories';
  else if(hash.startsWith('#/random')) active='random';
  else if(hash.startsWith('#/confessions')) active='confessions';
  else if(hash.startsWith('#/me')||hash.startsWith('#/profile')) active='profile';
  else if(hash.startsWith('#/admin')) active='admin';
  else if(hash.startsWith('#/notifications')) active='home';
  $('#navDesktop').innerHTML = navHtml(active);
  $('#mobileNav').innerHTML = `<div class="nav-mobile">${mobileNavHtml(active)}</div>`;
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
  updateAuthUI(); renderNav();
  toast('Logged out');
  location.hash='#/';
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
  if(!state.user){ $('#notifBadge').style.display='none'; return; }
  try{
    const data = await api('/api/notifications');
    state.notifUnread = data.unread;
    const badge=$('#notifBadge');
    if(data.unread>0){ badge.textContent=data.unread; badge.style.display='block'; } else badge.style.display='none';
  }catch{}
}

// Router
function router(){
  renderNav();
  const hash = location.hash || '#/';
  if(hash==='#/' || hash==='#') return renderHome();
  if(hash.startsWith('#/challenges')) return renderChallenges();
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
  $('#app').innerHTML = `<div class="empty">Page not found</div>`;
}

async function renderHome(){
  $('#app').innerHTML = `<div class="loading">Loading your daily prompt…</div>`;
  try{
    const data = await api('/api/home');
    const today = data.today;
    const trending = data.trending||[];
    const recent = data.recentDiscussions||[];
    const userStats = data.userStats;
    if(!today){
      $('#app').innerHTML = `<div class="empty">No challenges yet. Create the first one.</div>`;
      return;
    }
    // Check if answered
    let hasAnswered=false, myAnswer=null;
    if(state.user){
      try{
        const ch = await api('/api/challenges/'+today.id);
        myAnswer = ch.challenge.myAnswer;
        hasAnswered = !!myAnswer;
      }catch{}
    }
    const levelInfo = state.user ? levelProgress(state.user.xp) : null;
    $('#app').innerHTML = `
      <div class="grid grid-2">
        <div>
          <div class="hero">
            <div class="eyebrow">Today's challenge • ${escapeHtml(today.category)}</div>
            <h1>${escapeHtml(today.title)}</h1>
            <p>${escapeHtml(today.description)}</p>
            <div class="hero-meta">
              <span class="chip">${today.participant_count} participants</span>
              <span class="chip">${fmtDate(today.created_at)}</span>
              <span class="chip">${escapeHtml(today.status)}</span>
            </div>
            <div class="answer-box" id="homeAnswerBox">
              ${!state.user ? `
                <div style="background:white;color:var(--ink);border-radius:12px;padding:14px;border:1px solid var(--line)">
                  <div style="font-weight:800">Log in to answer and unlock community answers</div>
                  <div class="small" style="margin-top:4px">Read the scenario, think, then see how others responded.</div>
                  <div class="row" style="margin-top:10px">
                    <button class="btn small" id="homeLogin">Log in</button>
                    <button class="btn secondary small" id="homeJoin">Create account</button>
                  </div>
                </div>
              ` : hasAnswered ? `
                <div style="background:white;color:var(--ink);border-radius:12px;padding:12px;border:1px solid var(--line)">
                  <div style="font-weight:800;display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;background:#22c55e;border-radius:999px;display:inline-block"></span> You answered</div>
                  <div class="small" style="margin-top:6px;white-space:pre-wrap">${escapeHtml(myAnswer.body)}</div>
                  <div class="row" style="margin-top:10px"><a href="#/challenge/${today.id}" class="btn small">View community answers</a></div>
                </div>
              ` : `
                <div class="small" style="font-weight:700;margin-bottom:8px;opacity:.9">Your answer — be thoughtful, be original (10-1000 chars)</div>
                <textarea id="homeAnswerInput" placeholder="Type your answer here…"></textarea>
                <div class="row" style="margin-top:10px;justify-content:space-between;align-items:center">
                  <span class="hint" id="homeHint">You will unlock all answers after submitting.</span>
                  <button class="btn small" id="submitHomeAnswer">Submit answer</button>
                </div>
                <div id="homeAnswerError" class="small" style="color:#fecaca;margin-top:8px;display:none"></div>
              `}
            </div>
          </div>

          <div class="card pad" style="margin-top:14px" id="communityPreview"></div>
        </div>

        <div style="display:flex;flex-direction:column;gap:14px">
          ${state.user ? `
          <div class="card pad">
            <div class="row" style="justify-content:space-between"><span class="kicker">Your progress</span><span class="chip">${state.user.xp} XP • Lvl ${state.user.level}</span></div>
            <div style="margin-top:10px"><div class="levelBar"><div class="levelFill" style="width:${levelInfo.pct}%"></div></div></div>
            <div class="small muted" style="margin-top:8px">${levelInfo.next} XP to level ${levelInfo.level+1} • ${state.user.streak_count||0} day streak</div>
            <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
              <div class="card pad" style="padding:12px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:20px">${userStats? '—' : '0'}</div><div class="small">Today</div></div>
              <a href="#/random" class="btn secondary small" style="justify-content:center">Try Random</a>
            </div>
          </div>
          ` : `
          <div class="card pad">
            <div class="h3">How it works</div>
            <div class="small" style="margin-top:8px;line-height:1.6">Read the scenario → answer → discover community answers → vote, reply, battle, and continue stories. Earn XP without chasing followers.</div>
            <div class="row" style="margin-top:12px"><button class="btn small" id="howJoin">Join What If.</button><a href="#/explore" class="btn secondary small">Explore</a></div>
          </div>
          `}
          <div class="card pad">
            <div class="section-title">Trending challenges</div>
            <div class="grid" id="trendingList">${trending.map(c=>`
              <a href="#/challenge/${c.id}" class="card pad" style="padding:12px;display:block">
                <div class="chip" style="font-size:11px">${escapeHtml(c.category)}</div>
                <div style="font-weight:800;margin-top:8px;line-height:1.2">${escapeHtml(c.title)}</div>
                <div class="small" style="margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(c.description)}</div>
                <div class="small muted" style="margin-top:8px">${c.pc ?? c.participant_count} answers • ${timeAgo(c.created_at)}</div>
              </a>
            `).join('')}</div>
          </div>
          <div class="card pad" id="botLiveCard">
            <div class="section-title">Live discussants • automated participants always active</div>
            <div class="small muted" style="margin-top:-8px;margin-bottom:8px">Six bots that answer, vote, and reply within seconds to keep every thread alive.</div>
            <div id="botLiveList" class="grid" style="gap:8px"></div>
          </div>
          <div class="card pad">
            <div class="section-title">Recently active discussions</div>
            <div class="grid" style="gap:10px">
              ${recent.map(r=>`
                <a href="#/challenge/${r.challenge_id}" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)">
                  <div style="font-weight:700;line-height:1.3">${escapeHtml(r.challenge_title)}</div>
                  <div class="small" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.body.slice(0,120))}</div>
                  <div class="small muted" style="margin-top:6px">${escapeHtml(r.display_name)} • ${r.vote_count} votes</div>
                </a>
              `).join('') || `<div class="empty">No discussions yet</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
    // bind home events
    $('#homeLogin')?.addEventListener('click', ()=>openAuth('login'));
    $('#homeJoin')?.addEventListener('click', ()=>openAuth('register'));
    $('#howJoin')?.addEventListener('click', ()=>openAuth('register'));
    $('#submitHomeAnswer')?.addEventListener('click', async ()=>{
      const body = $('#homeAnswerInput').value.trim();
      const err=$('#homeAnswerError');
      if(body.length<10){ err.textContent='Answer must be at least 10 characters'; err.style.display='block'; return; }
      err.style.display='none';
      try{
        await api('/api/challenges/'+today.id+'/answers', { method:'POST', body: JSON.stringify({ body }) });
        toast('Answer saved • +10 XP');
        refreshAuth();
        renderHome();
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
    // community preview (if answered or not hide)
    const preview = $('#communityPreview');
    try{
      const ansData = await api(`/api/challenges/${today.id}/answers?limit=3&sort=top`);
      if(!ansData.hasAnswered){
        preview.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5a5 5 0 0 1 10 0v2"/><circle cx="12" cy="13" r="2"/></svg><span style="font-weight:800">Community answers are locked</span></div>
          <div class="small muted" style="margin-top:6px">Answer the challenge above to reveal how others think, vote, and reply. You are ${today.participant_count} thinkers away from the best takes.</div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <span class="chip">${today.participant_count} answers hidden</span>
            <a href="#/challenge/${today.id}" class="btn secondary small">Go to challenge</a>
          </div>
        `;
      } else {
        preview.innerHTML = `
          <div class="row" style="justify-content:space-between"><span class="section-title" style="margin:0">Top community answers</span><a href="#/challenge/${today.id}" class="small" style="font-weight:700;text-decoration:underline">View all</a></div>
          <div class="grid" style="margin-top:10px">
            ${ansData.answers.slice(0,3).map(a=>`
              <div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)">
                <div class="row" style="gap:8px"><div class="avatar" style="width:28px;height:28px;font-size:12px">${escapeHtml((a.display_name||a.username).slice(0,1).toUpperCase())}</div><span style="font-weight:700;font-size:13px">${escapeHtml(a.display_name)}</span><span class="small">• ${a.vote_count} votes</span></div>
                <div class="small" style="margin-top:8px;white-space:pre-wrap">${escapeHtml((a.body||'').slice(0,180))}</div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }catch{ preview.style.display='none'; }
    // load live bots
    try{
      const botData = await api('/api/bots/status');
      const botList = $('#botLiveList');
      if(botList && botData.bots){
        botList.innerHTML = botData.bots.map(b=>`
          <div style="display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:8px 10px;background:var(--surface-2)">
            <div class="avatar" style="width:28px;height:28px;font-size:12px">${escapeHtml(b.display_name.slice(0,1))}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:800;font-size:13px">${escapeHtml(b.display_name)} <span class="chip" style="font-size:10px;background:var(--ink);color:white;padding:1px 5px">bot</span> <span class="small muted">Lvl ${b.level}</span></div>
              <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(b.bio.slice(0,60))}</div>
            </div>
            <div style="width:8px;height:8px;background:#22c55e;border-radius:999px;flex-shrink:0" title="online"></div>
          </div>
        `).join('');
      }
    }catch{}
  }catch(e){
    $('#app').innerHTML = `<div class="empty">Failed to load home: ${escapeHtml(e.message)}</div>`;
  }
}

let challengesState = { page:1, category:'all', sort:'new', search:'', q:'' };
async function renderChallenges(){
  const cat = challengesState.category;
  const sort = challengesState.sort;
  $('#app').innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
      <div>
        <div class="kicker">Discover</div>
        <div class="h1">Challenges</div>
        <div class="small muted" style="margin-top:6px">Answer first, then unlock the conversation.</div>
      </div>
      <button class="btn" id="createChallengeBtn"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M5 12h14"/></svg>Create challenge</button>
    </div>
    <div class="card pad" style="margin-top:14px">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <div class="filters" id="catFilters" style="flex:1"></div>
        <select id="sortSelect" class="select" style="width:160px">
          <option value="new">Newest</option>
          <option value="trending">Trending</option>
          <option value="popular">Most answered</option>
        </select>
      </div>
      <div class="row" style="margin-top:10px">
        <input id="challengeSearch" class="input" placeholder="Search hypotheticals…" value="${escapeHtml(challengesState.search)}" style="flex:1">
        <button class="btn secondary" id="doSearch">Search</button>
      </div>
    </div>
    <div id="challengesGrid" class="grid grid-3" style="margin-top:14px"></div>
    <div class="row" style="justify-content:center;margin-top:14px;gap:8px">
      <button class="btn secondary small" id="prevPage">Previous</button>
      <span class="small" id="pageInfo"></span>
      <button class="btn secondary small" id="nextPage">Next</button>
    </div>
    <div id="createChallengeModal" class="modal"><div class="modal-card"><div class="modal-head"><div style="font-weight:800">Create a challenge</div><button class="icon-btn" id="closeCreate" style="width:32px;height:32px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6 18 18"/><path d="M18 6 6 18"/></svg></button></div><div class="modal-body">
      <label class="label">Title (10-150)</label><input id="ccTitle" class="input" placeholder="What if…" >
      <label class="label" style="margin-top:10px">Description (20-800)</label><textarea id="ccDesc" class="input" style="min-height:90px" placeholder="Context that makes it interesting"></textarea>
      <label class="label" style="margin-top:10px">Category</label><select id="ccCat" class="select">
        <option>What If scenarios</option><option>Opinion</option><option>Logic</option><option>Humor</option><option>Debate</option><option>School and everyday life</option><option>Relationships</option><option>Fictional situations</option><option>Random scenarios</option>
      </select>
      <div id="ccError" class="small" style="color:var(--accent);margin-top:8px;display:none"></div>
      <button class="btn block" style="margin-top:12px" id="submitCreate">Publish challenge</button>
    </div></div></div>
  `;
  const categories = ['all','What If scenarios','Opinion','Logic','Humor','Debate','School and everyday life','Relationships','Fictional situations','Random scenarios'];
  $('#catFilters').innerHTML = categories.map(c=> `<button class="chip ${challengesState.category===c?'active':''}" data-cat="${c}">${c==='all'?'All':c}</button>`).join('');
  $('#sortSelect').value = sort;
  // bind
  $$('#catFilters .chip').forEach(b=> b.addEventListener('click', ()=>{ challengesState.category=b.dataset.cat; challengesState.page=1; renderChallenges(); }));
  $('#sortSelect').addEventListener('change', e=>{ challengesState.sort=e.target.value; challengesState.page=1; renderChallenges(); });
  $('#doSearch').addEventListener('click', ()=>{ challengesState.search=$('#challengeSearch').value.trim(); challengesState.page=1; loadChallenges(); });
  $('#challengeSearch').addEventListener('keydown', e=>{ if(e.key==='Enter'){ challengesState.search=e.target.value.trim(); challengesState.page=1; loadChallenges(); }});
  $('#createChallengeBtn').addEventListener('click', ()=>{
    if(!state.user){ openAuth('login'); return; }
    $('#createChallengeModal').classList.add('open');
  });
  $('#closeCreate').addEventListener('click', ()=> $('#createChallengeModal').classList.remove('open'));
  $('#createChallengeModal').addEventListener('click', e=>{ if(e.target===$('#createChallengeModal')) $('#createChallengeModal').classList.remove('open'); });
  $('#submitCreate').addEventListener('click', async ()=>{
    const title=$('#ccTitle').value.trim(), description=$('#ccDesc').value.trim(), category=$('#ccCat').value;
    const err=$('#ccError');
    try{
      await api('/api/challenges', { method:'POST', body: JSON.stringify({ title, description, category }) });
      toast('Challenge created');
      $('#createChallengeModal').classList.remove('open');
      challengesState.page=1;
      loadChallenges();
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
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No challenges found. Try a different filter or create one.</div>`;
      return;
    }
    grid.innerHTML = data.challenges.map(c=>`
      <a href="#/challenge/${c.id}" class="card pad" style="display:flex;flex-direction:column;gap:10px">
        <div class="row" style="justify-content:space-between">
          <span class="chip" style="font-size:11px">${escapeHtml(c.category)}</span>
          <span class="small muted">${timeAgo(c.created_at)}</span>
        </div>
        <div style="font-weight:800;line-height:1.2;font-size:16px;min-height:38px">${escapeHtml(c.title)}</div>
        <div class="small muted" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:54px">${escapeHtml(c.description)}</div>
        <div class="row" style="margin-top:auto;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px">
          <span class="small" style="font-weight:700">${c.participant_count} answers</span>
          <span class="chip" style="background:${c.hasAnswered?'var(--ink)':'var(--surface-2)'};color:${c.hasAnswered?'white':'var(--ink)'}">${c.hasAnswered?'Answered':'Answer to unlock'}</span>
        </div>
      </a>
    `).join('');
  }catch(e){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderChallengeDetail(id){
  $('#app').innerHTML = `<div class="loading">Loading challenge…</div>`;
  try{
    const { challenge } = await api('/api/challenges/'+id);
    let answersData;
    try{ answersData = await api(`/api/challenges/${id}/answers?sort=top&limit=10&page=1`); } catch(e){ answersData={answers:[], hasAnswered:false, total:0}; }
    const hasAnswered = answersData.hasAnswered;
    const isOwner = state.user && state.user.id===challenge.created_by;
    $('#app').innerHTML = `
      <a href="#/challenges" class="small" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;margin-bottom:10px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18 9 12l6-6"/></svg>Back to challenges</a>
      <div class="card pad" style="border-radius:20px">
        <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span class="chip">${escapeHtml(challenge.category)}</span>
          <span class="small muted">${fmtDate(challenge.created_at)} • ${challenge.participant_count} participants</span>
        </div>
        <div class="h2" style="margin-top:12px;font-family:'Fraunces', serif">${escapeHtml(challenge.title)}</div>
        <div class="small" style="margin-top:8px;line-height:1.7;font-size:15px">${escapeHtml(challenge.description)}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn secondary small" id="reportChallenge"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l9 8-9 8-9-8 9-8Z"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor"/></svg>Report</button>
          ${isOwner?`<span class="small muted">You created this</span>`:''}
        </div>
        <div id="answerArea" style="margin-top:16px"></div>
      </div>
      <div class="card pad" style="margin-top:14px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div class="h3">Community answers <span class="small muted" style="font-weight:600">(${answersData.total})</span></div>
          <div class="row" style="gap:6px">
            <button class="chip ${answersData.sort==='top'?'active':''}" data-sort="top">Top</button>
            <button class="chip ${answersData.sort==='new'?'active':''}" data-sort="new">New</button>
          </div>
        </div>
        <div id="answersList" class="grid" style="margin-top:12px"></div>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn secondary small" id="loadMoreAnswers">Load more</button>
        </div>
      </div>
    `;
    $('#reportChallenge').addEventListener('click', ()=> openReport('challenge', challenge.id));
    // answer area
    const area=$('#answerArea');
    if(!state.user){
      area.innerHTML = `<div class="empty" style="text-align:left"><div style="font-weight:800">Answer to unlock all responses</div><div class="small" style="margin-top:4px">Log in, share your take, then read how others answered.</div><div class="row" style="margin-top:10px"><button class="btn small" id="detailLogin">Log in to answer</button></div></div>`;
      $('#detailLogin').addEventListener('click', ()=>openAuth('login'));
    } else if(hasAnswered){
      const my = challenge.myAnswer;
      area.innerHTML = `
        <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px">
          <div class="row" style="justify-content:space-between"><span style="font-weight:800">Your answer</span><span class="small muted">You can edit below</span></div>
          <div class="small" style="margin-top:8px;white-space:pre-wrap">${escapeHtml(my.body)}</div>
          <div class="row" style="margin-top:10px">
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
      // need answer id - fetch my answer id via answersData? we have myAnswer.id? Actually challenge.myAnswer may be {id, body}. Check API returns only id, body? We'll fetch answers to find mine
      let myId = my.id;
      if(!myId){
        // try find in answersData
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
          <div style="font-weight:800">Your turn</div>
          <div class="small" style="opacity:.8;margin-top:4px">Share your answer to unlock the community. No right answer, just your reasoning.</div>
          <textarea id="detailAnswer" class="input" style="margin-top:10px;min-height:90px" placeholder="Type your answer…"></textarea>
          <div class="row" style="margin-top:10px;justify-content:space-between">
            <span class="small" style="opacity:.7">10-1000 characters • Earn +10 XP</span>
            <button class="btn small" style="background:white;color:var(--ink);border-color:white" id="submitDetailAnswer">Submit</button>
          </div>
          <div id="detailError" class="small" style="color:#fecaca;margin-top:8px;display:none"></div>
        </div>
      `;
      $('#submitDetailAnswer').addEventListener('click', async ()=>{
        const body=$('#detailAnswer').value.trim();
        const err=$('#detailError');
        if(body.length<10){ err.textContent='Answer too short'; err.style.display='block'; return; }
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
        <div class="card pad" style="padding:14px">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div class="row" style="gap:10px">
              <div class="avatar">${escapeHtml((a.display_name||a.username||'?').slice(0,1).toUpperCase())}</div>
              <div>
                <div style="font-weight:800;font-size:14px">${escapeHtml(a.display_name||a.username)} ${a.role==='bot' ? '<span class="chip" style="font-size:10px;background:var(--ink);color:white;margin-left:6px;padding:2px 6px">Automated</span>' : ''} <span class="small muted">Lvl ${a.level||1} • ${timeAgo(a.created_at)}</span></div>
                <div class="small muted">@${escapeHtml(a.username||'user')} ${a.role==='bot' ? '• bot' : ''}</div>
              </div>
            </div>
            <button class="btn secondary small" data-report="${a.id}" style="padding:6px 8px;font-size:12px">Report</button>
          </div>
          ${masked ? `
            <div class="empty" style="margin-top:10px;text-align:left;padding:14px;background:var(--surface-2)"><div style="font-weight:800">Answer hidden</div><div class="small">Answer the challenge to reveal this response.</div></div>
          ` : `
            <div class="small" style="margin-top:10px;white-space:pre-wrap;line-height:1.7;font-size:14px">${escapeHtml(a.body)}</div>
            ${isMine ? `<div class="row" style="margin-top:8px"><button class="btn secondary small" data-edit="${a.id}">Edit</button><button class="btn ghost small" data-delete="${a.id}" style="color:var(--accent)">Delete</button></div>` : ''}
            <div class="row" style="margin-top:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div class="row" style="gap:6px">
                <button class="vote-btn ${a.hasVoted?'active':''}" data-vote="${a.id}">▲ ${a.vote_count} ${a.vote_count===1?'vote':'votes'}</button>
                <button class="btn secondary small" data-reply-toggle="${a.id}">Reply</button>
                <span class="small muted">${a.reply_count||0} replies</span>
              </div>
              <span class="small muted">${a.updated_at!==a.created_at?'edited':''}</span>
            </div>
            <div id="replies-${a.id}" class="grid" style="margin-top:10px;display:none"></div>
            <div id="replyBox-${a.id}" style="display:none;margin-top:10px">
              <div class="row" style="gap:8px">
                <input class="input" id="replyInput-${a.id}" placeholder="Write a reply…" style="flex:1">
                <button class="btn small" data-send-reply="${a.id}">Send</button>
              </div>
            </div>
          `}
        </div>
        `;
      };
      if(reset) list.innerHTML = data.answers.map(renderOne).join('') || `<div class="empty">No answers yet. Be the first.</div>`;
      else if(page===1) list.innerHTML = data.answers.map(renderOne).join('') || `<div class="empty">No answers yet</div>`;
      else list.innerHTML += data.answers.map(renderOne).join('');
      // bind events for new elements
      list.querySelectorAll('[data-vote]').forEach(b=> b.addEventListener('click', async ()=>{
        if(!state.user) return openAuth('login');
        if(b.textContent.includes('own') ) return;
        try{
          const res = await api('/api/answers/'+b.dataset.vote+'/vote', { method:'POST', body: JSON.stringify({ value:1 }) });
          b.textContent = `▲ ${res.vote_count} votes`;
          b.classList.toggle('active', res.voted);
          toast(res.voted?'Voted':'Vote removed');
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
              <div style="border-left:2px solid var(--line);padding:8px 12px;margin-left:6px;background:var(--surface-2);border-radius:8px">
                <div style="font-weight:700;font-size:13px">${escapeHtml(r.display_name)} ${r.role==='bot' ? '<span class="chip" style="font-size:10px;background:var(--ink);color:white;margin-left:4px;padding:1px 5px">Automated</span>' : ''} <span class="small muted">${timeAgo(r.created_at)}</span></div>
                <div class="small" style="margin-top:4px;white-space:pre-wrap">${escapeHtml(r.body)}</div>
                <button class="small" data-report-reply="${r.id}" style="margin-top:6px;color:var(--muted);border:none;background:transparent;cursor:pointer;font-weight:700;font-size:11px">Report</button>
              </div>
            `).join('') : `<div class="small muted" style="padding:6px">No replies yet</div>`;
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
          toast('Reply posted');
          input.value='';
          // reload replies
          const { replies } = await api('/api/answers/'+aid+'/replies');
          const el=$(`#replies-${aid}`);
          el.innerHTML = replies.map(r=>`
            <div style="border-left:2px solid var(--line);padding:8px 12px;margin-left:6px;background:var(--surface-2);border-radius:8px">
              <div style="font-weight:700;font-size:13px">${escapeHtml(r.display_name)} ${r.role==='bot' ? '<span class="chip" style="font-size:10px;background:var(--ink);color:white;margin-left:4px;padding:1px 5px">Automated</span>' : ''} <span class="small muted">${timeAgo(r.created_at)}</span></div>
              <div class="small" style="margin-top:4px;white-space:pre-wrap">${escapeHtml(r.body)}</div>
            </div>
          `).join('');
        }catch(e){ toast(e.message); }
      }));
      list.querySelectorAll('[data-delete]').forEach(b=> b.addEventListener('click', async ()=>{
        if(!confirm('Delete answer?')) return;
        try{ await api('/api/answers/'+b.dataset.delete, { method:'DELETE' }); toast('Deleted'); renderChallengeDetail(id); }catch(e){ toast(e.message); }
      }));
      // edit inline not fully
      list.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', async ()=>{
        const newBody = prompt('Edit your answer (10-1000 chars):', '');
        if(newBody===null) return;
        if(newBody.trim().length<10) return toast('Too short');
        try{ await api('/api/answers/'+b.dataset.edit, { method:'PUT', body: JSON.stringify({ body: newBody.trim() }) }); toast('Updated'); renderChallengeDetail(id); }catch(e){ toast(e.message); }
      }));
      // hide load more if no more
      const btn=$('#loadMoreAnswers');
      if(data.answers.length<8) btn.style.display='none'; else btn.style.display='inline-flex';
      if(!data.hasAnswered){
        list.querySelectorAll('.vote-btn, [data-reply-toggle]').forEach(el=>{ el.disabled=true; el.style.opacity='0.5'; el.title='Answer to interact'; });
      }
    }
    await loadAnswers(true);
    // sort handlers
    const topBtn = document.querySelector('[data-sort="top"]');
    const newBtn = document.querySelector('[data-sort="new"]');
    function setSort(s){
      sort=s;
      topBtn.classList.toggle('active', s==='top');
      newBtn.classList.toggle('active', s==='new');
      loadAnswers(true);
    }
    if(topBtn) topBtn.addEventListener('click', ()=> setSort('top'));
    if(newBtn) newBtn.addEventListener('click', ()=> setSort('new'));
    $('#loadMoreAnswers').addEventListener('click', async ()=>{ page++; await loadAnswers(false); });
  }catch(e){
    $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderBattles(){
  $('#app').innerHTML = `<div class="loading">Loading battles…</div>`;
  try{
    const { battles } = await api('/api/battles');
    $('#app').innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
        <div>
          <div class="kicker">Choose sides</div>
          <div class="h1">Battle Mode</div>
          <div class="small muted" style="margin-top:6px">Two answers. One question. Vote once. Win XP.</div>
        </div>
        <button class="btn" id="createBattleBtn">New battle</button>
      </div>
      <div id="createBattleForm" class="card pad" style="display:none;margin-top:14px">
        <label class="label">Question (10-200)</label><input id="battleQ" class="input" placeholder="Which is more…?">
        <label class="label" style="margin-top:10px">Option A (5-300)</label><textarea id="battleA" class="input" style="min-height:70px"></textarea>
        <label class="label" style="margin-top:10px">Option B (5-300)</label><textarea id="battleB" class="input" style="min-height:70px"></textarea>
        <div class="row" style="margin-top:10px;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="cancelBattle">Cancel</button><button class="btn small" id="submitBattle">Create battle</button></div>
        <div id="battleError" class="small" style="color:var(--accent);margin-top:8px;display:none"></div>
      </div>
      <div class="grid" style="margin-top:14px">
        ${battles.length? battles.map(b=>{
          const total=b.votes_a+b.votes_b;
          const pctA = total ? Math.round(b.votes_a/total*100) : 50;
          const chosen = b.myChoice;
          return `
          <div class="battle" data-id="${b.id}">
            <div style="padding:16px">
              <div class="small muted">${timeAgo(b.created_at)} • ${total} votes</div>
              <div style="font-weight:800;font-size:18px;margin-top:6px;line-height:1.2">${escapeHtml(b.question)}</div>
            </div>
            <div style="display:flex;flex-wrap:wrap">
              <div class="battle-opt ${chosen==='A'?'battle-optChosen':''}" data-vote="A" data-id="${b.id}" style="border-right:1px solid var(--line)">
                <div class="small" style="font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:${chosen==='A'?'.9':'.6'}">Option A ${chosen==='A'?'• Your vote':''}</div>
                <div style="margin-top:8px;line-height:1.5">${escapeHtml(b.answer_a)}</div>
                <div class="progress" style="margin-top:12px"><div style="width:${pctA}%"></div></div>
                <div class="small" style="margin-top:6px;font-weight:700">${b.votes_a} votes • ${pctA}%</div>
              </div>
              <div class="battle-opt ${chosen==='B'?'battle-optChosen':''}" data-vote="B" data-id="${b.id}">
                <div class="small" style="font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:${chosen==='B'?'.9':'.6'}">Option B ${chosen==='B'?'• Your vote':''}</div>
                <div style="margin-top:8px;line-height:1.5">${escapeHtml(b.answer_b)}</div>
                <div class="progress" style="margin-top:12px"><div style="width:${100-pctA}%"></div></div>
                <div class="small" style="margin-top:6px;font-weight:700">${b.votes_b} votes • ${100-pctA}%</div>
              </div>
            </div>
            ${chosen ? `<div class="small" style="padding:10px 16px;background:var(--surface-2);border-top:1px solid var(--line);font-weight:700">You voted ${chosen} • Thanks for deciding</div>` : `<div class="small muted" style="padding:10px 16px;border-top:1px solid var(--line)">Tap an option to vote — one vote per battle</div>`}
          </div>
        `}).join('') : `<div class="empty">No battles yet. Create the first.</div>`}
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
        toast('Battle created • +10 XP'); renderBattles(); refreshAuth();
      }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
    $$('.battle-opt').forEach(el=> el.addEventListener('click', async ()=>{
      if(!state.user) return openAuth('login');
      const id=el.dataset.id, choice=el.dataset.vote;
      // already voted? check parent battle has chosen
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
  $('#app').innerHTML = `<div class="loading">Loading stories…</div>`;
  try{
    const { stories } = await api('/api/stories');
    $('#app').innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
        <div>
          <div class="kicker">Collaborative fiction</div>
          <div class="h1">Story Chain</div>
          <div class="small muted" style="margin-top:6px">One sentence at a time. Vote for the best continuation.</div>
        </div>
        <button class="btn" id="newStoryBtn">Start a story</button>
      </div>
      <div id="newStoryForm" class="card pad" style="display:none;margin-top:14px">
        <label class="label">Title (5-80)</label><input id="storyTitle" class="input" placeholder="The Night Library">
        <label class="label" style="margin-top:10px">Opening sentence (20-400)</label><textarea id="storyStarter" class="input" style="min-height:80px" placeholder="The library opened only at midnight…"></textarea>
        <div class="row" style="margin-top:10px;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="cancelStory">Cancel</button><button class="btn small" id="submitStory">Start story</button></div>
        <div id="storyError" class="small" style="color:var(--accent);margin-top:8px;display:none"></div>
      </div>
      <div class="grid grid-2" style="margin-top:14px">
        ${stories.map(s=>`
          <a href="#/stories/${s.id}" class="card pad" style="display:block">
            <div class="row" style="justify-content:space-between"><span class="chip">${escapeHtml(s.status)}</span><span class="small muted">${s.entry_count} entries</span></div>
            <div style="font-weight:800;margin-top:10px;font-size:18px;line-height:1.2">${escapeHtml(s.title)}</div>
            <div class="small" style="margin-top:6px;line-height:1.5">${escapeHtml(s.starter.slice(0,140))}</div>
            <div class="small muted" style="margin-top:10px">${timeAgo(s.created_at)} • by ${escapeHtml(s.author||s.display_name||'Unknown')}</div>
          </a>
        `).join('') || `<div class="empty" style="grid-column:1/-1">No stories yet. Start one.</div>`}
      </div>
    `;
    $('#newStoryBtn').addEventListener('click', ()=>{ if(!state.user) return openAuth('login'); $('#newStoryForm').style.display='block'; });
    $('#cancelStory').addEventListener('click', ()=> $('#newStoryForm').style.display='none');
    $('#submitStory').addEventListener('click', async ()=>{
      const title=$('#storyTitle').value.trim(), starter=$('#storyStarter').value.trim();
      const err=$('#storyError');
      try{
        const { story } = await api('/api/stories', { method:'POST', body: JSON.stringify({ title, starter }) });
        toast('Story started • +12 XP'); location.hash='#/stories/'+story.id; refreshAuth();
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
      <a href="#/stories" class="small" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;margin-bottom:10px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18 9 12l6-6"/></svg>Back to stories</a>
      <div class="card pad" style="border-radius:20px">
        <div class="row" style="justify-content:space-between"><span class="chip">${escapeHtml(story.status)}</span><span class="small muted">${fmtDate(story.created_at)} • by ${escapeHtml(story.display_name||story.username||'Unknown')}</span></div>
        <div class="h1" style="margin-top:10px;font-family:'Fraunces', serif">${escapeHtml(story.title)}</div>
        <div style="margin-top:12px;padding:14px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;line-height:1.7">${escapeHtml(story.starter)}</div>
        ${!isFinished && state.user ? `<div style="margin-top:12px;display:flex;gap:8px"><button class="btn secondary small" id="finishStoryBtn">Finish story</button><span class="small muted" style="align-self:center">Creator or admin can mark as finished</span></div>` : ''}
      </div>
      <div class="card pad" style="margin-top:14px">
        <div class="h3">Continuations <span class="small muted">(${entries.length})</span></div>
        <div class="small muted" style="margin-top:4px">Read in order. Vote for your favorite. Each entry stands alone.</div>
        <div class="grid" style="margin-top:12px">
          ${entries.map((e,i)=>`
            <div class="card pad" style="padding:14px;background:${i%2===0?'var(--surface)':'var(--surface-2)'}">
              <div class="row" style="justify-content:space-between">
                <div class="row" style="gap:8px"><div class="avatar" style="width:28px;height:28px;font-size:12px">${escapeHtml((e.display_name||e.username).slice(0,1).toUpperCase())}</div><span style="font-weight:700;font-size:13px">${escapeHtml(e.display_name||e.username)} ${e.role==='bot' ? '<span class="chip" style="font-size:10px;background:var(--ink);color:white;margin-left:4px;padding:1px 5px">Automated</span>' : ''}</span><span class="small muted">${timeAgo(e.created_at)}</span></div>
                <span class="small muted">#${i+1}</span>
              </div>
              <div class="small" style="margin-top:8px;white-space:pre-wrap;line-height:1.6">${escapeHtml(e.body)}</div>
              <div class="row" style="margin-top:10px;gap:6px">
                <button class="vote-btn ${e.hasVoted?'active':''}" data-vote-entry="${e.id}">▲ ${e.vote_count} votes</button>
                <button class="btn secondary small" data-report-entry="${e.id}" style="padding:6px 8px;font-size:12px">Report</button>
              </div>
            </div>
          `).join('') || `<div class="empty">No continuations yet. Be the first to continue.</div>`}
        </div>
        ${isFinished ? `<div class="empty" style="margin-top:12px">This story is finished. No new entries.</div>` : `
          <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
            ${!state.user ? `<div class="empty" style="text-align:left"><div style="font-weight:800">Log in to continue the story</div><button class="btn small" style="margin-top:8px" id="storyLogin">Log in</button></div>` : `
              <label class="label">Add your continuation (10-400 chars)</label>
              <textarea id="entryBody" class="input" style="min-height:80px" placeholder="What happens next?"></textarea>
              <div class="row" style="margin-top:8px;justify-content:space-between"><span class="small muted">One entry per turn • Earn +8 XP</span><button class="btn small" id="submitEntry">Continue story</button></div>
              <div id="entryError" class="small" style="color:var(--accent);margin-top:8px;display:none"></div>
            `}
          </div>
        `}
      </div>
    `;
    $('#storyLogin')?.addEventListener('click', ()=>openAuth('login'));
    $('#finishStoryBtn')?.addEventListener('click', async ()=>{
      try{ await api('/api/stories/'+id+'/finish', { method:'POST' }); toast('Story finished'); renderStoryDetail(id); }catch(e){ toast(e.message); }
    });
    $$('[data-vote-entry]').forEach(b=> b.addEventListener('click', async ()=>{
      if(!state.user) return openAuth('login');
      try{
        const res = await api('/api/stories/entries/'+b.dataset.voteEntry+'/vote', { method:'POST' });
        toast('Voted');
        renderStoryDetail(id);
      }catch(e){ toast(e.message); }
    }));
    $$('[data-report-entry]').forEach(b=> b.addEventListener('click', ()=> openReport('story', b.dataset.reportEntry)));
    $('#submitEntry')?.addEventListener('click', async ()=>{
      const body=$('#entryBody').value.trim();
      const err=$('#entryError');
      if(body.length<10){ err.textContent='Too short'; err.style.display='block'; return; }
      err.style.display='none';
      try{ await api('/api/stories/'+id+'/entries', { method:'POST', body: JSON.stringify({ body }) }); toast('Added • +8 XP'); refreshAuth(); renderStoryDetail(id); }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderRandom(){
  if(!state.user){ $('#app').innerHTML = `<div class="empty" style="text-align:left"><div class="h2">Random Mode</div><div class="small" style="margin-top:6px">Log in to get a random challenge you have not seen recently.</div><button class="btn small" style="margin-top:10px" id="randomLogin">Log in</button></div>`; $('#randomLogin').addEventListener('click', ()=>openAuth('login')); return; }
  $('#app').innerHTML = `<div class="loading">Shuffling possibilities…</div>`;
  try{
    const { challenge } = await api('/api/random');
    $('#app').innerHTML = `
      <div class="kicker">Random Mode</div>
      <div class="h1" style="margin-top:6px">You got a fresh one</div>
      <div class="small muted" style="margin-top:6px">Pulled from challenges you have not answered recently.</div>
      <div class="card pad" style="margin-top:14px;border-radius:20px">
        <div class="chip">${escapeHtml(challenge.category)}</div>
        <div class="h2" style="margin-top:10px;font-family:'Fraunces', serif">${escapeHtml(challenge.title)}</div>
        <div class="small" style="margin-top:8px;line-height:1.6">${escapeHtml(challenge.description)}</div>
        <div style="margin-top:14px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px">
          <label class="label">Your answer</label>
          <textarea id="randAnswer" class="input" style="min-height:90px" placeholder="Type your answer…"></textarea>
          <div class="row" style="margin-top:8px;justify-content:space-between"><span class="small muted">10-1000 chars</span><button class="btn small" id="submitRand">Submit</button></div>
          <div id="randError" class="small" style="color:var(--accent);margin-top:8px;display:none"></div>
        </div>
        <div class="row" style="margin-top:12px;gap:8px"><button class="btn secondary small" id="nextRand">Shuffle again</button><a href="#/challenge/${challenge.id}" class="btn secondary small">Open challenge page</a></div>
      </div>
    `;
    $('#nextRand').addEventListener('click', ()=> renderRandom());
    $('#submitRand').addEventListener('click', async ()=>{
      const body=$('#randAnswer').value.trim();
      const err=$('#randError');
      if(body.length<10){ err.textContent='Answer too short'; err.style.display='block'; return; }
      try{ await api('/api/challenges/'+challenge.id+'/answers', { method:'POST', body: JSON.stringify({ body }) }); toast('Answer saved • +10 XP'); refreshAuth(); renderRandom(); }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderConfessions(){
  $('#app').innerHTML = `<div class="loading">Loading confessions…</div>`;
  try{
    const { confessions, total } = await api('/api/confessions?limit=12&page=1');
    $('#app').innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
        <div>
          <div class="kicker">Anonymous • Moderated</div>
          <div class="h1">Confessions</div>
          <div class="small muted" style="margin-top:6px">Anonymous text confessions. Your identity is hidden publicly, stored privately for moderation only.</div>
        </div>
      </div>
      <div class="card pad" style="margin-top:14px">
        ${!state.user ? `<div class="empty" style="text-align:left"><div style="font-weight:800">Log in to confess</div><div class="small" style="margin-top:4px">Anonymous to the community, not invisible to moderators. Be kind, be honest.</div><button class="btn small" style="margin-top:8px" id="confLogin">Log in</button></div>` : `
          <label class="label">Share anonymously (10-600 chars)</label>
          <textarea id="confBody" class="input" style="min-height:90px" placeholder="I pretend to…"></textarea>
          <div class="row" style="margin-top:8px;justify-content:space-between"><span class="small muted">Moderated • Earn +5 XP</span><button class="btn small" id="submitConf">Post anonymously</button></div>
          <div id="confError" class="small" style="color:var(--accent);margin-top:8px;display:none"></div>
        `}
        <div class="small muted" style="margin-top:10px">Reporting is available on every confession. Abuse is removed quickly.</div>
      </div>
      <div class="grid" style="margin-top:14px">
        ${confessions.map(c=>`
          <div class="card pad" style="padding:14px">
            <div class="row" style="justify-content:space-between"><span class="chip">Anonymous</span><span class="small muted">${timeAgo(c.created_at)}</span></div>
            <div class="small" style="margin-top:10px;white-space:pre-wrap;line-height:1.6;font-size:15px">${escapeHtml(c.body)}</div>
            <div class="row" style="margin-top:10px"><button class="btn secondary small" data-report-conf="${c.id}" style="padding:6px 10px;font-size:12px">Report</button></div>
          </div>
        `).join('') || `<div class="empty">No confessions yet.</div>`}
      </div>
      <div class="small muted" style="margin-top:10px;text-align:center">${total} confessions • anonymous to readers, traceable to moderators</div>
    `;
    $('#confLogin')?.addEventListener('click', ()=>openAuth('login'));
    $$('[data-report-conf]').forEach(b=> b.addEventListener('click', ()=> openReport('confession', b.dataset.reportConf)));
    $('#submitConf')?.addEventListener('click', async ()=>{
      const body=$('#confBody').value.trim();
      const err=$('#confError');
      if(body.length<10){ err.textContent='Too short'; err.style.display='block'; return; }
      try{ await api('/api/confessions', { method:'POST', body: JSON.stringify({ body }) }); toast('Confession posted anonymously'); refreshAuth(); renderConfessions(); }catch(e){ err.textContent=e.message; err.style.display='block'; }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}

async function renderExplore(qOpt=''){
  const q = qOpt || new URLSearchParams(location.hash.split('?')[1]||'').get('q') || '';
  $('#app').innerHTML = `<div class="loading">Exploring…</div>`;
  try{
    const data = await api('/api/explore');
    $('#app').innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
        <div>
          <div class="kicker">Explore</div>
          <div class="h1">Discover</div>
        </div>
        <div class="row" style="gap:8px;flex:1;max-width:420px">
          <input id="exploreSearch" class="input" placeholder="Search challenges, answers…" value="${escapeHtml(q)}" style="flex:1">
          <button class="btn small" id="exploreDo">Search</button>
        </div>
      </div>
      <div id="searchResults" style="margin-top:14px"></div>
      <div class="grid grid-2" style="margin-top:14px">
        <div class="card pad">
          <div class="section-title">Trending challenges</div>
          <div class="grid">
            ${data.trending.map(c=>`<a href="#/challenge/${c.id}" class="row" style="gap:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)"><span class="chip" style="font-size:11px">${escapeHtml(c.category)}</span><span style="font-weight:700;flex:1">${escapeHtml(c.title.slice(0,60))}</span><span class="small muted">${c.pc} answers</span></a>`).join('')}
          </div>
        </div>
        <div class="card pad">
          <div class="section-title">Popular answers</div>
          <div class="grid">
            ${data.popularAnswers.map(a=>`<a href="#/challenge/${a.challenge_id}" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface)"><div style="font-weight:800">${escapeHtml(a.challenge_title.slice(0,70))}</div><div class="small" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.body.slice(0,110))}</div><div class="small muted" style="margin-top:6px">${escapeHtml(a.display_name)} • ${a.vote_count} votes</div></a>`).join('')}
          </div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:14px">
        <div class="card pad">
          <div class="section-title">Active battles</div>
          <div class="grid">
            ${data.activeBattles.map(b=>`<a href="#/battles" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)"><div style="font-weight:800">${escapeHtml(b.question.slice(0,80))}</div><div class="small muted" style="margin-top:6px">${b.votes_a+b.votes_b} votes</div></a>`).join('') || `<div class="small muted">No battles</div>`}
          </div>
        </div>
        <div class="card pad">
          <div class="section-title">Popular stories</div>
          <div class="grid">
            ${data.popularStories.map(s=>`<a href="#/stories/${s.id}" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface)"><div style="font-weight:800">${escapeHtml(s.title)}</div><div class="small muted" style="margin-top:6px">${s.entries} entries</div></a>`).join('') || `<div class="small muted">No stories</div>`}
          </div>
        </div>
      </div>
      <div class="card pad" style="margin-top:14px">
        <div class="section-title">Categories</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${data.categories.map(c=>`<a href="#/challenges" class="chip" data-cat="${c.category}">${escapeHtml(c.category)} • ${c.cnt}</a>`).join('')}
        </div>
      </div>
    `;
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
              <div class="grid grid-2" style="margin-top:12px">
                <div>
                  <div class="small" style="font-weight:800">Challenges (${res.challenges.length})</div>
                  <div class="grid" style="margin-top:8px">
                    ${res.challenges.map(c=>`<a href="#/challenge/${c.id}" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)"><div style="font-weight:800">${escapeHtml(c.title)}</div><div class="small muted" style="margin-top:4px">${escapeHtml(c.description.slice(0,100))}</div></a>`).join('') || `<div class="small muted">No challenges</div>`}
                  </div>
                </div>
                <div>
                  <div class="small" style="font-weight:800">Answers (${res.answers.length})</div>
                  <div class="grid" style="margin-top:8px">
                    ${res.answers.map(a=>`<a href="#/challenge/${a.challenge_id}" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface)"><div style="font-weight:700">${escapeHtml(a.challenge_title.slice(0,60))}</div><div class="small" style="margin-top:4px">${escapeHtml(a.body.slice(0,120))}</div></a>`).join('') || `<div class="small muted">No answers</div>`}
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
    // fetch personality if own
    let personality=null;
    if(isOwn){
      try{ const p=await api('/api/personality/me'); personality=p.personality; }catch{}
    }
    $('#app').innerHTML = `
      <div class="grid grid-2">
        <div class="card pad" style="border-radius:20px">
          <div class="row" style="gap:14px">
            <div class="avatar lg">${escapeHtml((user.display_name||user.username).slice(0,1).toUpperCase())}</div>
            <div style="min-width:0">
              <div class="h2" style="font-family:'Fraunces', serif">${escapeHtml(user.display_name)}</div>
              <div class="small muted">@${escapeHtml(user.username)} • Joined ${fmtDate(user.created_at)}</div>
              <div class="row" style="margin-top:8px;gap:6px"><span class="chip">Lvl ${user.level} • ${user.xp} XP</span><span class="chip">${user.streak_count||0} day streak</span></div>
            </div>
          </div>
          <div class="small" style="margin-top:12px;line-height:1.6;white-space:pre-wrap">${escapeHtml(user.bio||'No bio yet.')}</div>
          ${isOwn? `<button class="btn secondary small" style="margin-top:12px" id="editProfileBtn">Edit profile</button>` : ''}
          <div id="editBox" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
            <label class="label">Display name</label><input id="editDisplay" class="input" value="${escapeHtml(user.display_name)}">
            <label class="label" style="margin-top:8px">Bio</label><textarea id="editBio" class="input" style="min-height:70px">${escapeHtml(user.bio||'')}</textarea>
            <div class="row" style="margin-top:8px;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="cancelEditProfile">Cancel</button><button class="btn small" id="saveProfile">Save</button></div>
          </div>
          <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px">
            <div class="card pad" style="padding:12px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:22px">${stats.answers_count}</div><div class="small">Answers</div></div>
            <div class="card pad" style="padding:12px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:22px">${stats.battle_votes}</div><div class="small">Battles</div></div>
            <div class="card pad" style="padding:12px;text-align:center;background:var(--surface-2)"><div style="font-weight:900;font-size:22px">${stats.story_entries}</div><div class="small">Story entries</div></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${personality ? `
            <div class="persona">
              <div class="kicker">Entertainment personality • Not a diagnosis</div>
              <div class="h3" style="margin-top:6px;font-family:'Fraunces', serif">${escapeHtml(personality.type)}</div>
              <div class="small" style="margin-top:6px;line-height:1.6">${escapeHtml(personality.desc)}</div>
              <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">${personality.traits.map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>
              <div class="small muted" style="margin-top:8px">Top category: ${escapeHtml(personality.topCategory)} • ${personality.totalAnswers} answers • ${personality.votesReceived} votes received</div>
              <div class="small muted" style="margin-top:6px;font-size:11px">This is entertainment only and not a psychological assessment.</div>
            </div>
          ` : isOwn ? `<div class="card pad"><div class="h3">Personality</div><div class="small muted" style="margin-top:6px">Answer at least 3 challenges to reveal your entertainment profile. It is just for fun.</div></div>` : ''}
          <div class="card pad">
            <div class="section-title">Popular answers</div>
            <div class="grid">
              ${stats.popular_answers.length ? stats.popular_answers.map(a=>`<a href="#/challenge/${a.challenge_id}" style="display:block;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)"><div style="font-weight:700">${escapeHtml(a.challenge_title.slice(0,70))}</div><div class="small" style="margin-top:6px">${escapeHtml(a.body.slice(0,140))}</div><div class="small muted" style="margin-top:6px">${a.vote_count} votes</div></a>`).join('') : `<div class="small muted">No popular answers yet</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
    $('#editProfileBtn')?.addEventListener('click', ()=> $('#editBox').style.display='block');
    $('#cancelEditProfile')?.addEventListener('click', ()=> $('#editBox').style.display='none');
    $('#saveProfile')?.addEventListener('click', async ()=>{
      const display_name=$('#editDisplay').value.trim(), bio=$('#editBio').value.trim();
      try{ await api('/api/users/me', { method:'PUT', body: JSON.stringify({ display_name, bio }) }); toast('Profile updated'); renderProfile(username); refreshAuth(); }catch(e){ toast(e.message); }
    });
  }catch(e){ $('#app').innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; }
}
async function renderMe(){
  if(!state.user){ openAuth('login'); $('#app').innerHTML = `<div class="empty">Log in to see your profile</div>`; return; }
  location.hash = '#/profile/'+state.user.username;
  renderProfile(state.user.username);
}

async function renderNotifications(){
  if(!state.user){ openAuth('login'); return; }
  $('#app').innerHTML = `<div class="loading">Loading notifications…</div>`;
  try{
    const { notifications } = await api('/api/notifications');
    $('#app').innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="h1" style="font-size:28px">Notifications</div>
        <button class="btn secondary small" id="markAll">Mark all read</button>
      </div>
      <div class="grid" style="margin-top:14px">
        ${notifications.length? notifications.map(n=>`
          <div class="card pad" style="padding:12px;display:flex;gap:12px;align-items:flex-start;opacity:${n.is_read?'0.7':'1'};border-color:${n.is_read?'var(--line)':'var(--ink)'}">
            <div style="width:8px;height:8px;background:${n.is_read?'transparent':'var(--accent)'};border-radius:999px;margin-top:8px;flex-shrink:0"></div>
            <div style="flex:1">
              <div style="font-weight:800">${escapeHtml(n.title)}</div>
              <div class="small" style="margin-top:4px">${escapeHtml(n.body)}</div>
              <div class="small muted" style="margin-top:6px">${timeAgo(n.created_at)} • ${escapeHtml(n.type)}</div>
            </div>
            ${!n.is_read?`<button class="btn secondary small" data-read="${n.id}">Mark read</button>`:''}
          </div>
        `).join('') : `<div class="empty">No notifications yet. Answer, battle, and continue stories to get updates.</div>`}
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
  $('#app').innerHTML = `<div class="loading">Loading admin…</div>`;
  try{
    const stats = await api('/api/admin/stats');
    const reports = await api('/api/admin/reports');
    const users = await api('/api/admin/users');
    const logs = await api('/api/admin/moderation-log');
    $('#app').innerHTML = `
      <div class="h1">Admin dashboard</div>
      <div class="small muted" style="margin-top:6px">Moderation, reports, and platform health.</div>
      <div class="grid grid-3" style="margin-top:14px">
        <div class="card pad" style="text-align:center"><div style="font-weight:900;font-size:26px">${stats.users}</div><div class="small">Users</div><div class="small muted">${stats.activeUsers} active (7d)</div></div>
        <div class="card pad" style="text-align:center"><div style="font-weight:900;font-size:26px">${stats.challenges}</div><div class="small">Challenges</div></div>
        <div class="card pad" style="text-align:center"><div style="font-weight:900;font-size:26px">${stats.answers}</div><div class="small">Answers</div></div>
        <div class="card pad" style="text-align:center"><div style="font-weight:900;font-size:26px">${stats.pendingReports}</div><div class="small">Pending reports</div></div>
        <div class="card pad" style="text-align:center"><div style="font-weight:900;font-size:26px">${stats.battles}</div><div class="small">Battles</div></div>
        <div class="card pad" style="text-align:center"><div style="font-weight:900;font-size:26px">${stats.stories}</div><div class="small">Stories</div></div>
      </div>
      <div class="grid grid-2" style="margin-top:14px">
        <div class="card pad">
          <div class="h3">Reports (${reports.reports.length})</div>
          <div class="grid" style="margin-top:10px;max-height:520px;overflow:auto">
            ${reports.reports.map(r=>`
              <div class="card pad" style="padding:10px;background:var(--surface-2)">
                <div class="row" style="justify-content:space-between"><span class="chip">${escapeHtml(r.target_type)} • ${escapeHtml(r.status)}</span><span class="small muted">${timeAgo(r.created_at)}</span></div>
                <div class="small" style="margin-top:6px"><b>Reporter:</b> ${escapeHtml(r.reporter)} • <b>Target:</b> ${escapeHtml(r.target_id.slice(0,8))}</div>
                <div class="small" style="margin-top:6px;white-space:pre-wrap">${escapeHtml(r.reason)}</div>
                ${r.status==='pending'?`
                <div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">
                  <button class="btn secondary small" data-action="dismiss" data-id="${r.id}">Dismiss</button>
                  <button class="btn secondary small" data-action="remove" data-id="${r.id}" style="border-color:var(--accent);color:var(--accent)">Remove content</button>
                  <button class="btn secondary small" data-action="restore" data-id="${r.id}">Restore</button>
                  <button class="btn small" data-action="suspend" data-id="${r.id}">Suspend user</button>
                </div>`:`<div class="small muted" style="margin-top:6px">Reviewed</div>`}
              </div>
            `).join('') || `<div class="small muted">No reports</div>`}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card pad">
            <div class="h3">Users</div>
            <div class="grid" style="margin-top:10px;max-height:240px;overflow:auto">
              ${users.users.map(u=>`<div class="row" style="justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--surface-2)"><div><div style="font-weight:700">${escapeHtml(u.display_name)} <span class="small muted">@${escapeHtml(u.username)} • ${escapeHtml(u.role)}</span></div><div class="small muted">${u.xp} XP • Lvl ${u.level}</div></div><span class="small muted">${fmtDate(u.created_at)}</span></div>`).join('')}
            </div>
          </div>
          <div class="card pad">
            <div class="h3">Moderation log</div>
            <div class="grid" style="margin-top:10px;max-height:220px;overflow:auto">
              ${logs.logs.map(l=>`<div class="small" style="border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--surface-2)"><b>${escapeHtml(l.admin)}</b> ${escapeHtml(l.action)} ${escapeHtml(l.target_type)} ${escapeHtml(l.target_id.slice(0,6))} • ${timeAgo(l.created_at)}</div>`).join('') || `<div class="small muted">No actions yet</div>`}
            </div>
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
$('#searchInput').addEventListener('input', e=>{
  clearTimeout(searchTimer);
  const v=e.target.value.trim();
  if(v.length<2) return;
  searchTimer=setTimeout(()=>{ location.hash='#/search?q='+encodeURIComponent(v); }, 500);
});
$('#searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ const v=e.target.value.trim(); if(v.length>=2) location.hash='#/search?q='+encodeURIComponent(v); }});

// Auth handlers
$('#loginBtn').addEventListener('click', ()=> openAuth('login'));
$('#registerBtn').addEventListener('click', ()=> openAuth('register'));
$('#closeAuth').addEventListener('click', closeAuth);
$('#authModal').addEventListener('click', e=>{ if(e.target===$('#authModal')) closeAuth(); });
$$('.tab').forEach(t=> t.addEventListener('click', ()=>{
  $$('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
  const tab=t.dataset.tab;
  $('#loginForm').style.display=tab==='login'?'block':'none';
  $('#registerForm').style.display=tab==='register'?'block':'none';
  $('#authTitle').textContent=tab==='register'?'Create your account':'Welcome back';
}));
$('#loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const payload={ username: fd.get('username'), password: fd.get('password') };
  const err=$('#loginError'); err.style.display='none';
  try{
    await api('/api/auth/login', { method:'POST', body: JSON.stringify(payload) });
    closeAuth(); toast('Welcome back');
    await refreshAuth(); router();
  }catch(ex){ err.textContent=ex.message; err.style.display='block'; }
});
$('#registerForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const payload={ username: fd.get('username'), display_name: fd.get('display_name'), bio: fd.get('bio'), password: fd.get('password') };
  const err=$('#registerError'); err.style.display='none';
  try{
    await api('/api/auth/register', { method:'POST', body: JSON.stringify(payload) });
    closeAuth(); toast('Account created • +25 XP');
    await refreshAuth(); router();
  }catch(ex){ err.textContent=ex.message; err.style.display='block'; }
});
$('#logoutBtn').addEventListener('click', logout);
$('#profileBtn').addEventListener('click', ()=> location.hash='#/me');
$('#notifBtn').addEventListener('click', ()=> {
  if(!state.user) return openAuth('login');
  location.hash='#/notifications';
});
$('#closeReport').addEventListener('click', closeReport);
$('#cancelReport').addEventListener('click', closeReport);
$('#reportModal').addEventListener('click', e=>{ if(e.target===$('#reportModal')) closeReport(); });
$('#submitReport').addEventListener('click', async ()=>{
  const reason=$('#reportReason').value.trim();
  const err=$('#reportError');
  if(reason.length<10){ err.textContent='Reason must be 10-500 characters'; err.style.display='block'; return; }
  err.style.display='none';
  try{
    await api('/api/reports', { method:'POST', body: JSON.stringify({ target_type: state.reportTarget.target_type, target_id: state.reportTarget.target_id, reason }) });
    closeReport(); toast('Report submitted • Thank you');
  }catch(e){ err.textContent=e.message; err.style.display='block'; }
});

// Mobile drawer
const sidebar = $('#sidebar');
const overlay = $('#sidebarOverlay');
const openBtn = $('#openSidebar');
const closeBtn = $('#closeSidebar');
function openDrawer(){
  sidebar.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
  if(closeBtn) closeBtn.style.display='grid';
}
function closeDrawer(){
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
  document.body.style.overflow='';
  if(closeBtn) closeBtn.style.display='none';
}
openBtn?.addEventListener('click', openDrawer);
closeBtn?.addEventListener('click', closeDrawer);
overlay?.addEventListener('click', closeDrawer);
// close drawer when nav link clicked or hash changes on mobile
document.addEventListener('click', (e)=>{
  if(window.innerWidth<=900 && e.target.closest('#navDesktop a')){
    closeDrawer();
  }
});
window.addEventListener('resize', ()=>{
  if(window.innerWidth>900) closeDrawer();
});

window.addEventListener('hashchange', router);
window.addEventListener('load', async ()=>{
  await refreshAuth();
  router();
  // poll notifications
  setInterval(fetchNotifications, 30000);
});
