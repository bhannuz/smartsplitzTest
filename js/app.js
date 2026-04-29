import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, get, push, set, update, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const db = getDatabase(initializeApp({
  apiKey:"AIzaSyCqb7gAbpa3UabPU3g_YhNITuPWtWPY4KU",
  authDomain:"ak-events-2016.firebaseapp.com",
  databaseURL:"https://ak-events-2016-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:"ak-events-2016"
}));

/* STATE */
let S = { gid:"", group:{}, expenses:{}, members:{}, settlements:{},
          splitType:"equal", sel:[], pendCode:"", activeTab:"t-exp" };

/* UTILS */
const fmt     = n => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
// Convert YYYY-MM-DD → DDMMYYYY for display everywhere
const fmtDate = d => { if(!d) return ''; const [y,m,day]=d.split('-'); return `${day}-${m}-${y}`; };
const today = () => new Date().toISOString().split('T')[0];
const PAL   = ['#7c5fff','#22d07a','#ff5273','#b8f724','#2dd4d4','#f7a825','#f97316','#e879f9'];
const col   = n => { let h=0; for(const c of(n||'?'))h+=c.charCodeAt(0); return PAL[h%PAL.length]; };
const ns    = () => Object.values(S.members).map(m=>m.name);
const $     = id => document.getElementById(id);
const setT  = (id,t) => { const e=$(id); if(e) e.textContent=t; };

function toast(msg,dur=2600){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),dur);
}
function setErr(id,m){ const e=$(id); if(e) e.textContent=m; }
let loadTimer=null;
function showLoad(msg=''){
  if($('__ld'))return;
  const d=document.createElement('div'); d.id='__ld'; d.className='ldw';
  d.innerHTML=`<div class="ld"></div>${msg?`<div class="ld-t">${msg}</div>`:''}`;
  document.body.appendChild(d);
}
function hideLoad(){ $('__ld')?.remove(); }

/* NAV */
window.go    = id => { document.querySelectorAll('.scr').forEach(s=>s.classList.add('hidden')); $(id).classList.remove('hidden'); };
window.closeM= id => { $(id).classList.remove('on'); };

/* TAB SWITCH — render first, then toggle visibility */
window.switchTab = (id, btn) => {
  S.activeTab = id;
  const exps  = Object.values(S.expenses);
  const total = exps.reduce((s,e) => s+(e.amount||0), 0);
  // Render ALL tab content while everything is still in DOM
  renderExpList(exps,total);
  renderCatList(exps,total);
  renderMemSide(exps);
  renderPeopleTab(exps,total);
  renderSettleTab();
  // Now toggle visibility
  ['t-exp','t-people'].forEach(t => $(t).classList.add('hidden'));
  document.querySelectorAll('.tb').forEach(b => b.classList.remove('on'));
  $(id).classList.remove('hidden');
  btn.classList.add('on');
};

/* ── SESSION CACHE ─────────────────────────────────────────
   Saves trip code + gid to localStorage with a timestamp.
   On next open, if session is < SESSION_DAYS old, skip the
   login screen entirely and go straight into the app.
   To log out / switch trip: clear localStorage manually or
   use the ⚙️ settings modal "Switch Trip" button.
─────────────────────────────────────────────────────────── */
const SESSION_DAYS = 5;           // ← change to 2 for every-2-days
const SESSION_KEY  = 'ss_session';

function saveSession(code, gid){
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    code, gid, ts: Date.now()
  }));
}
function clearSession(){
  localStorage.removeItem(SESSION_KEY);
}
function loadSession(){
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    const age = (Date.now() - s.ts) / (1000 * 60 * 60 * 24); // days
    if(age > SESSION_DAYS){ clearSession(); return null; }
    return s;
  } catch { clearSession(); return null; }
}

/* Auto-restore session on page load, or go straight to code entry for new users */
(async () => {
  const sess = loadSession();
  if(!sess) {
    go('s-login');   // first-time: show code entry immediately
    return;
  }
  // Has session — show nothing (blank) while we verify, then launch
  showLoad('Welcome back…');
  try {
    const snap = await get(ref(db,'smartsplit/groups'));
    hideLoad();
    if(!snap.exists()){ clearSession(); go('s-login'); return; }
    const entry = Object.entries(snap.val()).find(([,g])=>String(g.loginCode)===String(sess.code));
    if(!entry){ clearSession(); go('s-login'); return; }
    S.gid = entry[0]; S.group = entry[1];
    await loadAll();
    launch();
  } catch { hideLoad(); clearSession(); go('s-login'); }
})();

/* AUTH */
$('btn-login').onclick = doLogin;
$('l-code').onkeydown  = e => { if(e.key==='Enter') doLogin(); };

const ADMIN_CODE = '1AKU';   // ← alphanumeric admin code (case-insensitive)

async function doLogin(){
  const code=$('l-code').value.trim().toUpperCase(); setErr('l-err','');
  if(code.length<4){ setErr('l-err','Enter your trip code'); return; }

  // Admin access (case-insensitive)
  if(code === ADMIN_CODE.toUpperCase()){ await launchAdmin(); return; }

  showLoad('Loading trip…');
  try {
    const snap=await get(ref(db,'smartsplit/groups')); hideLoad();
    if(!snap.exists()){ setErr('l-err','No trips found.'); return; }
    const entry=Object.entries(snap.val()).find(([,g])=>String(g.loginCode)===String(code));
    if(!entry){ setErr('l-err','Invalid code. Try again.'); return; }
    S.gid=entry[0]; S.group=entry[1];
    saveSession(code, S.gid);
    await loadAll(); launch();
  } catch(e){ hideLoad(); setErr('l-err','Error: '+e.message); }
}

/* ─── ADMIN ─────────────────────────────────────────────── */
let adminData = { groups:{}, members:{}, expenses:{} };

async function launchAdmin(){
  showLoad('Loading admin…');
  try {
    const [gS,mS,eS] = await Promise.all([
      get(ref(db,'smartsplit/groups')),
      get(ref(db,'smartsplit/members')),
      get(ref(db,'smartsplit/expenses'))
    ]);
    hideLoad();
    adminData.groups   = gS.exists()  ? gS.val()  : {};
    adminData.members  = mS.exists()  ? mS.val()  : {};
    adminData.expenses = eS.exists()  ? eS.val()  : {};
    go('s-admin');
    renderAdmin();
  } catch(e){ hideLoad(); setErr('l-err','Admin error: '+e.message); }
}

window.renderAdmin = () => {
  const q = ($('adm-search')?.value||'').toLowerCase();
  const groups   = adminData.groups;
  const members  = adminData.members;
  const expenses = adminData.expenses;

  // Summary stats
  const allMembers = Object.values(members);
  const allExps    = Object.values(expenses);
  const totalSpend = allExps.reduce((s,e)=>s+(e.amount||0),0);
  setT('adm-trips',   Object.keys(groups).length);
  setT('adm-members', allMembers.length);
  setT('adm-spend',   fmt(totalSpend));

  // Filter
  let groupEntries = Object.entries(groups);
  if(q){
    groupEntries = groupEntries.filter(([gid,g])=>{
      const nameMatch = (g.name||'').toLowerCase().includes(q);
      const codeMatch = String(g.loginCode).includes(q);
      const memMatch  = allMembers.filter(m=>m.groupId===gid).some(m=>(m.name||'').toLowerCase().includes(q));
      return nameMatch||codeMatch||memMatch;
    });
  }

  if(!groupEntries.length){
    $('adm-trips-list').innerHTML='<div class="empty"><div class="ei-ico">🔍</div><p>No trips found</p></div>';
    return;
  }

  $('adm-trips-list').innerHTML = groupEntries
    .sort((a,b)=>(a[1].name||'').localeCompare(b[1].name||''))
    .map(([gid,g])=>{
      const tripMembers = allMembers.filter(m=>m.groupId===gid);
      const tripExps    = allExps.filter(e=>e.groupId===gid);
      const tripSpend   = tripExps.reduce((s,e)=>s+(e.amount||0),0);
      const mc          = tripMembers.length;
      const budget      = g.budget||0;
      const pct         = budget>0?Math.min(100,Math.round((tripSpend/budget)*100)):0;
      const bcolor      = pct>85?'var(--rose)':pct>60?'var(--amber)':'var(--sky)';

      const memRows = tripMembers.length ? tripMembers.map(m=>{
        // per-member spend
        const memPaid = tripExps.filter(e=>e.paidBy===m.name).reduce((s,e)=>s+(e.amount||0),0);
        const memExps = tripExps.filter(e=>e.paidBy===m.name).length;
        const c = ['#7c5fff','#22d07a','#ff5273','#b8f724','#2dd4d4','#f7a825','#f97316','#e879f9'];
        const col = n => { let h=0; for(const ch of(n||'?'))h+=ch.charCodeAt(0); return c[h%c.length]; };
        return `<div class="adm-mem-row">
          <div style="width:30px;height:30px;border-radius:50%;background:${col(m.name)};display:flex;align-items:center;justify-content:center;font-family:'Bricolage Grotesque',sans-serif;font-size:12px;font-weight:800;color:#000;flex-shrink:0">${m.name[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-weight:700;font-size:13px">${m.name}</div><div style="font-size:10px;color:var(--sub2)">${memExps} expense${memExps!==1?'s':''}</div></div>
          <div style="font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:800;color:var(--lime)">${fmt(memPaid)}</div>
        </div>`;
      }).join('') : '<div style="padding:12px 0;font-size:12px;color:var(--sub2)">No members yet</div>';

      return `<div class="trip-card">
        <div class="trip-card-head" onclick="toggleTripCard(this)">
          <div style="min-width:0;flex:1">
            <div class="trip-card-title">${g.name||'Unnamed Trip'}</div>
            <div class="trip-card-meta">${mc} member${mc!==1?'s':''} · ${tripExps.length} expense${tripExps.length!==1?'s':''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <div class="trip-code-tag" onclick="event.stopPropagation();copyAdminCode('${g.loginCode}')" title="Click to copy">${g.loginCode}</div>
            <button class="btn bg bxs" style="color:var(--rose);padding:5px 9px;font-size:12px" onclick="event.stopPropagation();deleteTrip('${gid}','${(g.name||'').replace(/'/g,"&#39;")}')" title="Delete trip">🗑️</button>
            <span class="adm-chevron">▾</span>
          </div>
        </div>
        <div class="trip-card-body hidden">
          <!-- Stats row -->
          <div class="adm-stat-row">
            <div class="adm-stat">
              <div class="adm-stat-l">Total Spend</div>
              <div class="adm-stat-v" style="color:var(--lime)">${fmt(tripSpend)}</div>
            </div>
            ${budget>0?`<div class="adm-stat">
              <div class="adm-stat-l">Budget</div>
              <div class="adm-stat-v" style="color:${bcolor}">${pct}% of ${fmt(budget)}</div>
            </div>`:''}
            <div class="adm-stat">
              <div class="adm-stat-l">Per Person</div>
              <div class="adm-stat-v" style="color:#c0b0ff">${mc?fmt(tripSpend/mc):'—'}</div>
            </div>
          </div>
          <!-- Members -->
          <div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:1.2px;margin:10px 0 4px">Members</div>
          ${memRows}
        </div>
      </div>`;
    }).join('');
};

window.toggleTripCard = el => {
  const body    = el.nextElementSibling;
  const chevron = el.querySelector('.adm-chevron');
  body.classList.toggle('hidden');
  chevron.classList.toggle('open');
};

window.copyAdminCode = code => {
  navigator.clipboard?.writeText(String(code)).then(()=>toast('Code '+code+' copied! 📋'));
};

window.deleteTrip = async (gid, name) => {
  if(!confirm(`Delete trip "${name}"?\n\nThis will permanently delete the trip, all its expenses, members, and settlements. This cannot be undone.`)) return;
  showLoad('Deleting trip…');
  try {
    // Delete group
    await remove(ref(db, `smartsplit/groups/${gid}`));
    // Delete all expenses for this group
    const eSnap = await get(ref(db, 'smartsplit/expenses'));
    if(eSnap.exists()){
      const toDelete = Object.entries(eSnap.val()).filter(([,e])=>e.groupId===gid);
      await Promise.all(toDelete.map(([id])=>remove(ref(db,`smartsplit/expenses/${id}`))));
    }
    // Delete all members for this group
    const mSnap = await get(ref(db, 'smartsplit/members'));
    if(mSnap.exists()){
      const toDelete = Object.entries(mSnap.val()).filter(([,m])=>m.groupId===gid);
      await Promise.all(toDelete.map(([id])=>remove(ref(db,`smartsplit/members/${id}`))));
    }
    // Delete settlements
    await remove(ref(db, `smartsplit/settlements/${gid}`));
    // Reload admin data
    const [gS,mS,eS] = await Promise.all([
      get(ref(db,'smartsplit/groups')),
      get(ref(db,'smartsplit/members')),
      get(ref(db,'smartsplit/expenses'))
    ]);
    adminData.groups   = gS.exists() ? gS.val() : {};
    adminData.members  = mS.exists() ? mS.val() : {};
    adminData.expenses = eS.exists() ? eS.val() : {};
    hideLoad();
    renderAdmin();
    toast(`"${name}" deleted ✓`);
  } catch(e){ hideLoad(); toast('Error: '+e.message); }
};

$('btn-reg').onclick = async () => {
  const code=$('r-code').value.trim(); setErr('r-err','');
  if(code.length!==4||isNaN(code)){ setErr('r-err','Must be 4 digits'); return; }
  showLoad();
  try {
    const snap=await get(ref(db,'smartsplit/groups')); hideLoad();
    const taken=snap.exists()&&Object.values(snap.val()).some(g=>String(g.loginCode)===code);
    if(taken){ setErr('r-err','Code taken — try another'); return; }
    S.pendCode=code; go('s-setup');
  } catch(e){ hideLoad(); setErr('r-err','Error: '+e.message); }
};

$('btn-setup').onclick = async () => {
  const name=$('sn').value.trim(), budget=parseFloat($('sb').value)||0;
  setErr('se-err',''); if(!name){ setErr('se-err','Enter a trip name'); return; }
  showLoad();
  try {
    const gr=push(ref(db,'smartsplit/groups'));
    S.gid=gr.key; S.group={ name, loginCode:S.pendCode, budget };
    await set(gr, S.group);
    S.expenses={}; S.members={}; S.settlements={};
    saveSession(S.pendCode, S.gid);   // ← persist session
    hideLoad(); launch();
    toast('Trip created! Share code '+S.pendCode+' 🎉',3500);
    openMem();
  } catch(e){ hideLoad(); setErr('se-err','Error: '+e.message); }
};

async function loadAll(){
  showLoad('Syncing…');
  try {
    const [eS,mS,sS,gS]=await Promise.all([
      get(ref(db,'smartsplit/expenses')),
      get(ref(db,'smartsplit/members')),
      get(ref(db,`smartsplit/settlements/${S.gid}`)),
      get(ref(db,`smartsplit/groups/${S.gid}`))
    ]);
    const ae=eS.exists()?eS.val():{};
    S.expenses=Object.fromEntries(Object.entries(ae).filter(([,e])=>e.groupId===S.gid));
    const am=mS.exists()?mS.val():{};
    S.members=Object.fromEntries(Object.entries(am).filter(([,m])=>m.groupId===S.gid));
    S.settlements=sS.exists()?sS.val():{};
    if(gS.exists()) S.group=gS.val();
  } finally { hideLoad(); }
}

function launch(){
  document.querySelectorAll('.scr').forEach(s=>s.classList.add('hidden'));
  $('app').style.display='flex'; renderUI();
}

/* COPY CODE */
window.copyCode = () => {
  navigator.clipboard?.writeText(String(S.group.loginCode))
    .then(()=>toast('Code copied! 📋')).catch(()=>toast('Code: '+S.group.loginCode));
};

/* SETTINGS */
window.openBudgetEdit = () => {
  $('b-name').value=S.group.name||''; $('b-budget').value=S.group.budget||'';
  $('m-budget').classList.add('on');
};
window.saveBudget = async () => {
  const name=$('b-name').value.trim()||S.group.name;
  const budget=parseFloat($('b-budget').value)||0;
  await update(ref(db,`smartsplit/groups/${S.gid}`),{ name, budget });
  S.group.name=name; S.group.budget=budget;
  closeM('m-budget'); renderUI(); toast('Saved ✓');
};

window.switchTrip = () => {
  if(!confirm('Switch to a different trip? You can re-enter the code anytime.')) return;
  clearSession();
  closeM('m-budget');
  $('app').style.display='none';
  go('s-start');
  // Reset state
  S.gid=''; S.group={}; S.expenses={}; S.members={}; S.settlements={};
  S.activeTab='t-exp';
  $('l-code').value='';
};

/* EXPORT CSV */
window.exportCSV = () => {
  const rows=[['Date','Name','Category','Amount','Paid By','Notes','Split Between']];
  Object.values(S.expenses).sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(e=>{
    rows.push([fmtDate(e.date)||'',e.name||'',e.category||'',e.amount||0,e.paidBy||'',e.notes||'',(e.splitBetween||[]).join('|')]);
  });
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`${(S.group.name||'Trip').replace(/\s/g,'_')}_expenses.csv`;
  a.click(); toast('CSV exported 📄');
};

/* MEMBERS */
window.openMem = () => { renderMemModal(); $('m-mem').classList.add('on'); };
window.addMem  = () => doAddMem($('new-mem'));
window.addMem2 = () => doAddMem($('new-mem2'));
async function doAddMem(inp){
  const name=inp.value.trim(); if(!name){ toast('Enter a name'); return; }
  if(ns().some(n=>n.toLowerCase()===name.toLowerCase())){ toast('Already in group'); return; }
  await set(push(ref(db,'smartsplit/members')),{ name, groupId:S.gid });
  await loadAll(); inp.value=''; renderMemModal(); renderUI(); toast(name+' added 👋');
}
window.removeMem = async id => {
  if(!confirm('Remove member?')) return;
  await remove(ref(db,`smartsplit/members/${id}`));
  await loadAll(); renderMemModal(); renderUI(); toast('Removed');
};
function renderMemModal(){
  $('m-mem-list').innerHTML=Object.entries(S.members).map(([id,m])=>`
    <div class="mr">
      <div class="mav" style="background:${col(m.name)};width:32px;height:32px;font-size:12px">${m.name[0].toUpperCase()}</div>
      <div style="flex:1"><div class="mname">${m.name}</div></div>
      <button class="btn bg bxs" style="color:var(--rose)" onclick="removeMem('${id}')">✕</button>
    </div>`).join('')||'<div class="empty"><p>No members yet</p></div>';
}

/* EXPENSE FORM */
function resetForm(){
  $('eid').value=''; $('e-name').value=''; $('e-amt').value='';
  $('e-cat').value='🍔 Food'; $('e-date').value=today(); $('e-notes').value='';
  $('m-exp-title').textContent='💸 Add Expense'; $('btn-save').textContent='Save';
  fillPaidBy(''); S.splitType='equal'; S.sel=[...ns()];
  renderSplitList(); setSplit('equal');
}
function fillPaidBy(sel){
  $('e-paid').innerHTML=ns().map(n=>`<option ${n===sel?'selected':''}>${n}</option>`).join('');
  if(!ns().length) $('e-paid').innerHTML='<option>— add members first —</option>';
}
window.selAll = () => { S.sel=[...ns()]; renderSplitList(); };
window.onAmtChg = () => { if(S.splitType!=='equal') renderCustomArea(); };
function renderSplitList(){
  $('split-list').innerHTML=ns().map(n=>`
    <div class="mck ${S.sel.includes(n)?'on':''}" onclick="togMem('${n}',this)">
      <div class="mck-cb"></div>
      <div class="mck-av" style="background:${col(n)}">${n[0].toUpperCase()}</div>
      <span style="font-size:13px;font-weight:600">${n}</span>
    </div>`).join('')||'<div style="padding:12px;color:var(--sub2);font-size:13px">Add members first</div>';
}
window.togMem = (name,el) => {
  if(S.sel.includes(name)){
    if(S.sel.length<=1){ toast('Need at least 1'); return; }
    S.sel=S.sel.filter(n=>n!==name); el.classList.remove('on');
  } else { S.sel.push(name); el.classList.add('on'); }
  if(S.splitType!=='equal') renderCustomArea();
};
window.setSplit = type => {
  S.splitType=type;
  ['eq','cu','pc'].forEach((k,i)=>{ const t=['equal','custom','percent'][i]; $('sp-'+k).classList.toggle('on',t===type); });
  const ca=$('custom-area');
  type==='equal'?ca.classList.add('hidden'):(ca.classList.remove('hidden'),renderCustomArea());
};
function renderCustomArea(){
  const amt=parseFloat($('e-amt').value)||0;
  if(S.splitType==='custom'){
    const sh=S.sel.length?Math.round(amt/S.sel.length):0;
    $('custom-area').innerHTML=S.sel.map(n=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <div style="flex:1;font-size:13px;font-weight:600">${n}</div>
        <input type="number" id="cs-${n.replace(/\s/g,'_')}" class="fi" value="${sh}" inputmode="numeric" style="margin:0;width:95px;padding:7px 10px;font-size:13px">
      </div>`).join('')+'<p style="font-size:10px;color:var(--sub);margin-top:3px">Must total the amount</p>';
  } else {
    const pct=S.sel.length?Math.round(100/S.sel.length):0;
    $('custom-area').innerHTML=S.sel.map((n,i)=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <div style="flex:1;font-size:13px;font-weight:600">${n}</div>
        <input type="number" id="cs-${n.replace(/\s/g,'_')}" class="fi" value="${i===S.sel.length-1?100-(pct*(S.sel.length-1)):pct}" inputmode="numeric" max="100" style="margin:0;width:70px;padding:7px 10px;font-size:13px">
        <span style="font-size:12px;color:var(--sub2)">%</span>
      </div>`).join('')+'<p style="font-size:10px;color:var(--sub);margin-top:3px">Must total 100%</p>';
  }
}

/* SAVE EXPENSE */
$('btn-save').onclick = async () => {
  const editId=$('eid').value;
  const name=$('e-name').value.trim(), amt=parseFloat($('e-amt').value);
  const cat=$('e-cat').value, paidBy=$('e-paid').value;
  const date=$('e-date').value||today(), notes=$('e-notes').value.trim();
  if(!name)        return toast('Add a description');
  if(!amt||amt<=0) return toast('Enter a valid amount');
  if(!paidBy)      return toast('Select who paid');
  if(!S.sel.length)return toast('Select at least one member');

  let splits={};
  if(S.splitType==='equal'){
    const sh=amt/S.sel.length;
    S.sel.forEach(n=>splits[n.replace(/\s/g,'_')]={ name:n, share:+sh.toFixed(2) });
  } else if(S.splitType==='custom'){
    let tot=0;
    for(const n of S.sel){ const v=parseFloat($('cs-'+n.replace(/\s/g,'_'))?.value)||0; splits[n.replace(/\s/g,'_')]={ name:n, share:v }; tot+=v; }
    if(Math.abs(tot-amt)>1) return toast(`Total ₹${Math.round(tot)} ≠ ₹${amt}`);
  } else {
    let tot=0;
    for(const n of S.sel){ const p=parseFloat($('cs-'+n.replace(/\s/g,'_'))?.value)||0; splits[n.replace(/\s/g,'_')]={ name:n, share:+(amt*p/100).toFixed(2) }; tot+=p; }
    if(Math.abs(tot-100)>0.5) return toast(`Percentages = ${Math.round(tot)}%, need 100%`);
  }

  const data={ name, amount:amt, category:cat, paidBy, date, notes, splits, splitType:S.splitType, splitBetween:S.sel, groupId:S.gid };
  showLoad();
  try {
    editId ? await update(ref(db,`smartsplit/expenses/${editId}`),data) : await set(push(ref(db,'smartsplit/expenses')),data);
    toast(editId?'Updated ✓':'Added ✓'); closeM('m-exp'); await loadAll(); renderUI();
  } catch(e){ toast('Error: '+e.message); }
  finally { hideLoad(); }
};

window.openAdd = () => { resetForm(); $('m-exp').classList.add('on'); };

window.editExp = async id => {
  const e=S.expenses[id]; if(!e) return;
  resetForm(); $('eid').value=id; $('e-name').value=e.name; $('e-amt').value=e.amount;
  $('e-cat').value=e.category; $('e-date').value=e.date||today(); $('e-notes').value=e.notes||'';
  fillPaidBy(e.paidBy); S.sel=e.splitBetween||[...ns()]; renderSplitList();
  setSplit(e.splitType||'equal'); $('m-exp-title').textContent='✏️ Edit Expense'; $('btn-save').textContent='Update';
  $('m-exp').classList.add('on');
};
window.delExp = async id => {
  if(!confirm('Delete?')) return;
  showLoad(); await remove(ref(db,`smartsplit/expenses/${id}`));
  await loadAll(); renderUI(); hideLoad(); toast('Deleted');
};

/* SETTLE */
window.markSettled = async key => {
  const done=S.settlements[key]?.settled;
  await set(ref(db,`smartsplit/settlements/${S.gid}/${key}`),{ settled:!done });
  await loadAll(); renderUI();
};
function calcBal(){
  const exps=Object.values(S.expenses), bal={};
  ns().forEach(n=>bal[n]=0);
  exps.forEach(e=>{
    if(e.paidBy) bal[e.paidBy]=(bal[e.paidBy]||0)+(e.amount||0);
    if(e.splits) Object.values(e.splits).forEach(s=>bal[s.name]=(bal[s.name]||0)-(s.share||0));
    else if(e.splitBetween?.length){ const sh=(e.amount||0)/e.splitBetween.length; e.splitBetween.forEach(n=>bal[n]=(bal[n]||0)-sh); }
  });
  return bal;
}
function calcSettle(){
  const bal=calcBal();
  const cred=[],debt=[];
  Object.entries(bal).forEach(([n,v])=>{ if(v>0.5)cred.push({name:n,amt:v}); else if(v<-0.5)debt.push({name:n,amt:-v}); });
  cred.sort((a,b)=>b.amt-a.amt); debt.sort((a,b)=>b.amt-a.amt);
  const txns=[]; let ci=0,di=0;
  while(ci<cred.length&&di<debt.length){
    const c=cred[ci],d=debt[di],pay=Math.min(c.amt,d.amt);
    txns.push({from:d.name,to:c.name,amount:pay});
    c.amt-=pay; d.amt-=pay; if(c.amt<0.5)ci++; if(d.amt<0.5)di++;
  }
  return txns;
}

/* ══════════════ MAIN RENDER ══════════════ */
window.renderUI = () => {
  const exps=Object.values(S.expenses);
  const total=exps.reduce((s,e)=>s+(e.amount||0),0);
  const mc=Math.max(ns().length,1);
  const todayStr=today();
  const todayAmt=exps.filter(e=>e.date===todayStr).reduce((s,e)=>s+(e.amount||0),0);
  const txns=calcSettle();
  const pend=txns.filter(t=>!S.settlements[`${t.from}_${t.to}`.replace(/\s/g,'_')]?.settled).length;

  setT('pg-title',S.group.name||'Trip');
  setT('pg-meta',`${mc} member${mc!==1?'s':''} · ${exps.length} expense${exps.length!==1?'s':''}`);

  // Today card
  const todayCount = exps.filter(e=>e.date===todayStr).length;
  setT('sv-today', fmt(todayAmt));
  setT('sv-txns',  todayCount + ' expense' + (todayCount!==1?'s':'') + ' today');

  // Total card + budget progress
  setT('sv-total', fmt(total));
  const budget=S.group.budget||0;
  if(budget>0){
    const pct=Math.min(100,Math.round((total/budget)*100));
    const left=budget-total;
    const bcolor=pct>85?'var(--rose)':pct>60?'var(--amber)':'var(--sky)';
    setT('sv-bleft', left>=0 ? fmt(left)+' left of '+fmt(budget) : 'Over by '+fmt(-left));
    const f=$('sv-bfill'); f.style.width=pct+'%'; f.style.background=bcolor;
    $('sv-total').style.color=bcolor;
  } else {
    setT('sv-bleft','no budget set');
    $('sv-total').style.color='var(--sky)';
    $('sv-bfill').style.width='0%';
  }

  // Per-person inline row
  setT('sv-per', fmt(total/mc));

  // Repopulate member filter but preserve current selection
  const _fpaid=$('fpaid'), _prev=_fpaid.value;
  _fpaid.innerHTML='<option value="">All Members</option>'+ns().map(n=>`<option>${n}</option>`).join('');
  if(_prev) _fpaid.value=_prev;   // restore selection after repopulate
  setT('mem-ct-s',mc+' people');

  // Render ALL content before any visibility toggling
  renderExpList(exps, total);
  renderCatList(exps, total);
  renderMemSide(exps);
  renderPeopleTab(exps, total);
  renderSettleTab();
  // Ensure only active tab is visible
  ['t-exp','t-people'].forEach(t => $(t).classList.add('hidden'));
  $(S.activeTab).classList.remove('hidden');
};

function renderExpList(exps,total){
  const filter=$('fcat').value, paidF=$('fpaid').value;
  const search=($('esearch').value||'').toLowerCase();
  const sort=$('fsort').value;
  let list=[...exps];
  if(filter) list=list.filter(e=>e.category===filter);
  if(paidF)  list=list.filter(e=>e.paidBy===paidF);
  if(search) list=list.filter(e=>[(e.name||''),(e.notes||''),(e.paidBy||'')].some(f=>f.toLowerCase().includes(search)));
  list.sort((a,b)=>sort==='date-d'?(b.date||'').localeCompare(a.date||''):sort==='date-a'?(a.date||'').localeCompare(b.date||''):sort==='amt-d'?(b.amount||0)-(a.amount||0):(a.amount||0)-(b.amount||0));
  const el=$('exp-list');
  if(!list.length){ el.innerHTML='<div class="empty"><div class="ei-ico">💸</div><p>No expenses found</p></div>'; return; }
  el.innerHTML=list.map(e=>{
    const id=Object.keys(S.expenses).find(k=>S.expenses[k]===e)||'';
    const perP=e.splitBetween?.length?fmt(e.amount/e.splitBetween.length)+'/person':'';
    return `<div class="ei">
      <div class="eico">${e.category?.split(' ')[0]||'📦'}</div>
      <div style="flex:1;min-width:0">
        <div class="en" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.name}</div>
        <div class="em">${e.category?.split(' ')[1]||''} · ${fmtDate(e.date)} · <strong style="color:var(--txt)">${e.paidBy||'?'}</strong>${perP?` · <span style="color:#b8a8ff">${perP}</span>`:''}</div>
        ${e.notes?`<div class="em" style="font-style:italic;opacity:.7">${e.notes}</div>`:''}
      </div>
      <div style="flex-shrink:0;text-align:right;min-width:60px">
        <div class="ea">${fmt(e.amount)}</div>
        <div class="ebtns">
          <button class="btn bg bxs" onclick="editExp('${id}')">✏️</button>
          <button class="btn bg bxs" style="color:var(--rose)" onclick="delExp('${id}')">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderCatList(exps,total){
  const cats={}; exps.forEach(e=>cats[e.category]=(cats[e.category]||0)+(e.amount||0));
  $('cat-list').innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`
    <div class="catrow">
      <div class="cattop"><span>${c}</span><b>${fmt(v)} <span style="color:var(--sub);font-size:10px">${total?Math.round(v/total*100):0}%</span></b></div>
      <div class="catbar"><div class="catfill" style="width:${total?Math.min(100,(v/total)*100):0}%"></div></div>
    </div>`).join('')||'<div class="empty" style="padding:16px"><p>No data yet</p></div>';
}

function renderMemSide(exps){
  const names=ns(); const paid={},owes={};
  names.forEach(n=>{ paid[n]=0; owes[n]=0; });
  exps.forEach(e=>{
    if(e.paidBy) paid[e.paidBy]=(paid[e.paidBy]||0)+(e.amount||0);
    if(e.splits) Object.values(e.splits).forEach(s=>owes[s.name]=(owes[s.name]||0)+(s.share||0));
    else if(e.splitBetween?.length){ const sh=(e.amount||0)/e.splitBetween.length; e.splitBetween.forEach(n=>owes[n]=(owes[n]||0)+sh); }
  });
  $('mem-side').innerHTML=names.map(n=>{
    const net=(paid[n]||0)-(owes[n]||0);
    return `<div class="mr">
      <div class="mav" style="background:${col(n)};width:32px;height:32px;font-size:12px">${n[0].toUpperCase()}</div>
      <div style="flex:1"><div class="mname">${n}</div><div class="msub">paid ${fmt(paid[n]||0)}</div></div>
      <div class="${net>=0?'pos':'neg'}" style="font-size:13px">${net>=0?'+':'-'}${fmt(net)}</div>
    </div>`;
  }).join('')||'<div class="empty" style="padding:16px"><p>No members</p></div>';
}

function renderPeopleTab(exps,total){
  const names=ns(); const paid={},owes={},cnt={};
  names.forEach(n=>{ paid[n]=0; owes[n]=0; cnt[n]=0; });
  exps.forEach(e=>{
    if(e.paidBy){ paid[e.paidBy]=(paid[e.paidBy]||0)+(e.amount||0); cnt[e.paidBy]=(cnt[e.paidBy]||0)+1; }
    if(e.splits) Object.values(e.splits).forEach(s=>owes[s.name]=(owes[s.name]||0)+(s.share||0));
    else if(e.splitBetween?.length){ const sh=(e.amount||0)/e.splitBetween.length; e.splitBetween.forEach(n=>owes[n]=(owes[n]||0)+sh); }
  });

  // Member list with net balance
  setT('mem-full-ct', names.length+' people');
  $('mem-full-list').innerHTML = Object.entries(S.members).map(([id,m])=>{
    const net=(paid[m.name]||0)-(owes[m.name]||0);
    return `<div class="mr">
      <div class="mav" style="background:${col(m.name)};width:34px;height:34px;font-size:13px">${m.name[0].toUpperCase()}</div>
      <div style="flex:1">
        <div class="mname">${m.name}</div>
        <div class="msub">Paid ${fmt(paid[m.name]||0)} · ${cnt[m.name]||0} expense${cnt[m.name]!==1?'s':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="badge ${net>=0?'bg-g':'bg-r'}">${net>=0?'+':'-'}${fmt(net)}</span>
        <button class="btn bg bxs" style="color:var(--rose)" onclick="removeMem('${id}')">✕</button>
      </div>
    </div>`;
  }).join('')||'<div class="empty"><p>No members yet. Add members above.</p></div>';

  // Who paid most ranking
  const el=$('mem-rank');
  if(el) el.innerHTML = [...names].sort((a,b)=>(paid[b]||0)-(paid[a]||0)).map((n,i)=>{
    const pct=total?Math.round((paid[n]||0)/total*100):0;
    return `<div style="margin-bottom:11px">
      <div class="cattop">
        <span style="display:flex;align-items:center;gap:7px">
          <span>${['🥇','🥈','🥉'][i]||'•'}</span>
          <span class="mav" style="background:${col(n)};width:22px;height:22px;font-size:10px">${n[0].toUpperCase()}</span>
          <span>${n}</span>
        </span>
        <b style="color:var(--lime)">${fmt(paid[n]||0)} <span style="color:var(--sub);font-size:10px">${pct}%</span></b>
      </div>
      <div class="catbar" style="margin-top:4px"><div class="catfill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('')||'<div class="empty" style="padding:16px"><p>No expenses yet</p></div>';
}

function renderSettleTab(){
  const txns=calcSettle();
  const pend=txns.filter(t=>!S.settlements[`${t.from}_${t.to}`.replace(/\s/g,'_')]?.settled).length;
  setT('settle-sum',pend+' payment'+(pend!==1?'s':'')+' needed');
  const el=$('settle-list');
  if(!txns.length){ el.innerHTML='<div class="empty"><div class="ei-ico">🎉</div><p>All settled up!</p></div>'; }
  else el.innerHTML=txns.map(t=>{
    const key=`${t.from}_${t.to}`.replace(/\s/g,'_');
    const done=S.settlements[key]?.settled;
    return `<div class="stlc ${done?'done':''}">
      <div class="stlarr">
        <div class="mav" style="background:${col(t.from)};width:28px;height:28px;font-size:11px">${t.from[0].toUpperCase()}</div>
        <div style="min-width:0"><div style="font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px">${t.from}</div><div style="font-size:10px;color:var(--sub)">pays</div></div>
        <div class="aline"></div>
        <div style="min-width:0"><div style="font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px">${t.to}</div><div style="font-size:10px;color:var(--sub)">gets</div></div>
        <div class="mav" style="background:${col(t.to)};width:28px;height:28px;font-size:11px">${t.to[0].toUpperCase()}</div>
      </div>
      <div style="display:flex;align-items:center;gap:7px;flex-shrink:0">
        <div class="stlamt">${fmt(t.amount)}</div>
        <button class="btn bsm ${done?'bg':'bl'}" onclick="markSettled('${key}')">${done?'↩':'✓'}</button>
      </div>
    </div>`;
  }).join('');
  const bal=calcBal();
  $('balance-sheet').innerHTML=Object.entries(bal).map(([n,v])=>`
    <div class="row"><span class="rl" style="display:flex;align-items:center;gap:6px"><span class="mav" style="background:${col(n)};width:20px;height:20px;font-size:9px">${n[0].toUpperCase()}</span>${n}</span>
    <span class="${v>=0?'pos':'neg'}" style="font-size:13px">${v>=0?'+':'-'}${fmt(v)}</span></div>`).join('')||'<div class="empty" style="padding:16px"><p>No data</p></div>';
  // settle-progress panel removed from HTML — no write needed
}
