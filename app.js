// ── Constants ───────────────────────────────────────────────────────
const NUM_DRIVES = 4;
const POLICIES   = ['RAID-1', 'RAID-5', 'RAID-6'];
const NAMES      = ['Web', 'DB', 'App', 'ML', 'FS', 'VDI', 'Cache'];
const MIN_NODES  = { 'RAID-1':3, 'RAID-5':3, 'RAID-6':6 };
const FTT        = { 'RAID-1':1, 'RAID-5':1, 'RAID-6':2 };

const C_PERF  = '#00acc1';
const C_CAP   = '#ef6c00';
const C_PAR   = '#546e7a';
const C_SYNC  = '#7b1fa2';

// ── State ────────────────────────────────────────────────────────────
let numHosts = 3;
let selItem  = null;
let selType  = null;
const vmMap  = {};

// ── DOM ──────────────────────────────────────────────────────────────
const $cl   = document.getElementById('cluster');
const $dp   = document.getElementById('dataPlacement');
const $hc   = document.getElementById('hostCount');
const $tgt  = document.getElementById('failureTarget');
const $stat = document.getElementById('statusBar');

// ── Init ─────────────────────────────────────────────────────────────
function initCluster() {
  $cl.innerHTML = '';
  Object.keys(vmMap).forEach(k => delete vmMap[k]);
  const used = new Set();
  for (let i = 0; i < numHosts; i++) {
    const host = mk('div','host',{'data-id':i});

    const hn = mk('div','host-name'); hn.textContent = `ESXi Host ${i+1}`;
    host.appendChild(hn);

    const vl = mk('div','host-lbl'); vl.textContent = 'Virtual Machines';
    host.appendChild(vl);

    const vms = mk('div','vms');
    for (let k = 0; k < rand(2,3); k++) {
      const name   = genName(used);
      const policy = pickPolicy();
      vms.appendChild(buildVM(name, policy, i));
      vmMap[name] = distribute(policy);
    }
    host.appendChild(vms);
    host.appendChild(mk('div','host-div'));

    const dl = mk('div','host-lbl'); dl.textContent = 'NVMe Drives';
    host.appendChild(dl);

    const drives = mk('div','drives');
    for (let j = 0; j < NUM_DRIVES; j++) drives.appendChild(buildDrive(i,j));
    host.appendChild(drives);

    host.addEventListener('click', () => select(host,'host'));
    $cl.appendChild(host);
  }
  $hc.textContent = numHosts;
  renderDP(null);
  setStatus('');
}

function buildVM(name, policy, hid) {
  const v = mk('div','vm',{'data-policy':policy,'data-host-id':''+hid,'data-name':name});
  v.textContent = name;
  v.addEventListener('click', e => { e.stopPropagation(); select(v,'vm'); });
  return v;
}
function buildDrive(hid, did) {
  const d = mk('div','drive',{'data-host-id':''+hid,'data-drive-id':''+did});
  d.textContent = 'NVMe';
  d.addEventListener('click', e => { e.stopPropagation(); select(d,'drive'); });
  return d;
}

// ── Distribution ─────────────────────────────────────────────────────
function distribute(policy, excl = -1) {
  const hosts = Array.from({length:numHosts},(_,i)=>i).filter(h => {
    if (h === excl) return false;
    const n = document.querySelector(`.host[data-id="${h}"]`);
    return !n || !n.classList.contains('failed');
  });
  const out = {performance:[], capacity:[], parity:[]};
  if (hosts.length < MIN_NODES[policy]) return out;
  const pN = policy==='RAID-6' ? 3 : 2;
  const cN = policy==='RAID-1' ? 2 : policy==='RAID-5' ? (hosts.length>=6?4:2) : 4;
  const rN = policy==='RAID-1' ? 0 : policy==='RAID-5' ? 1 : 2;
  let pool = shuffle([...hosts]);
  const next = () => { if (!pool.length) pool = shuffle([...hosts]); return pool.shift(); };
  for (let i=0;i<pN;i++) out.performance.push({hostId:next(),driveId:rand(0,NUM_DRIVES-1)});
  for (let i=0;i<cN;i++) out.capacity.push({hostId:next(),driveId:rand(0,NUM_DRIVES-1)});
  for (let i=0;i<rN;i++) out.parity.push({hostId:next(),driveId:rand(0,NUM_DRIVES-1)});
  return out;
}

// ── Selection ─────────────────────────────────────────────────────────
function select(item, type) {
  clearSel();
  item.classList.add('selected');
  selItem = item; selType = type;
  if (type === 'vm') {
    hlDrives(item);
    const bad = item.classList.contains('impacted')||item.classList.contains('resync')||item.classList.contains('unrecoverable');
    renderDP(item.dataset.policy, bad);
    setStatus(`VM <strong>${item.dataset.name}</strong> &mdash; Policy: <strong>${item.dataset.policy}</strong>`,'info');
  } else if (type === 'host') {
    setStatus(`Selected <strong>ESXi Host ${parseInt(item.dataset.id)+1}</strong> as failure target`,'info');
    renderDP(null);
  } else {
    setStatus(`Selected <strong>NVMe Drive ${parseInt(item.dataset.driveId)+1}</strong> on Host ${parseInt(item.dataset.hostId)+1}`,'info');
    renderDP(null);
  }
}
function clearSel() {
  document.querySelectorAll('.selected').forEach(e=>e.classList.remove('selected'));
  document.querySelectorAll('.drive:not(.failed)').forEach(d=>{
    d.classList.remove('performance','capacity'); d.textContent='NVMe';
  });
  selItem=null; selType=null;
}
function hlDrives(vm) {
  const c = vmMap[vm.dataset.name]; if (!c) return;
  c.performance.forEach(x=>{ const d=getDrive(x.hostId,x.driveId); if(d&&!d.classList.contains('failed')) d.classList.add('performance'); });
  c.capacity.forEach(x=>{ const d=getDrive(x.hostId,x.driveId); if(d&&!d.classList.contains('failed')) d.classList.add('capacity'); });
  c.parity.forEach((x,i)=>{ const d=getDrive(x.hostId,x.driveId); if(d&&!d.classList.contains('failed')) d.textContent=`P${i+1}`; });
}

// ── Failure ───────────────────────────────────────────────────────────
function simulateFailure() {
  if (!selItem) { setStatus('&#9888; Please select a host or drive first.','danger'); return; }
  if ($tgt.value==='host' && selType==='host') doHostFail(selItem);
  else if ($tgt.value==='drive' && selType==='drive') doDriveFail(selItem);
  else { setStatus('&#9888; Selected item does not match the failure target.','danger'); return; }
  checkRecov();
  const fh=document.querySelectorAll('.host.failed').length;
  const fd=document.querySelectorAll('.drive.failed').length;
  const un=document.querySelectorAll('.vm.unrecoverable').length;
  let m=`&#9888; ${fh} host failure(s) &bull; ${fd} drive failure(s).`;
  if (un) m+=` <strong>${un} VM(s) unrecoverable</strong> &mdash; FTT budget exceeded.`;
  setStatus(m,'danger');
}
function doHostFail(host) {
  host.classList.add('failed');
  if (!host.querySelector('.host-failed-badge')) {
    const b=mk('div','host-failed-badge'); b.textContent='FAILED'; host.appendChild(b);
  }
  const fid = parseInt(host.dataset.id,10);
  host.querySelectorAll('.vm').forEach(vm => {
    vm.classList.add('impacted','resync');
    const t = freeHost(fid);
    if (t) { t.querySelector('.vms').appendChild(vm); vm.dataset.hostId=t.dataset.id; }
    vmMap[vm.dataset.name] = distribute(vm.dataset.policy, fid);
  });
  Object.keys(vmMap).forEach(name => {
    const c = vmMap[name];
    if (![...c.performance,...c.capacity,...c.parity].some(x=>x.hostId===fid)) return;
    const vm = document.querySelector(`.vm[data-name="${name}"]`);
    if (vm && !vm.classList.contains('impacted')) {
      vm.classList.add('impacted');
      if (!vm.classList.contains('resync')) vmMap[name]=distribute(vm.dataset.policy,fid);
    }
  });
  renderDP(null);
}
function doDriveFail(drive) {
  drive.classList.add('failed'); drive.textContent='FAIL';
  const hid=parseInt(drive.dataset.hostId,10), did=parseInt(drive.dataset.driveId,10);
  Object.keys(vmMap).forEach(name => {
    const c=vmMap[name];
    if (![...c.performance,...c.capacity,...c.parity].some(x=>x.hostId===hid&&x.driveId===did)) return;
    const vm=document.querySelector(`.vm[data-name="${name}"]`);
    if (vm) { vm.classList.add('impacted','resync'); vmMap[name]=distribute(vm.dataset.policy,hid); }
  });
}
function checkRecov() {
  Object.keys(vmMap).forEach(name => {
    const vm=document.querySelector(`.vm[data-name="${name}"]`); if (!vm) return;
    const ftt=FTT[vm.dataset.policy], c=vmMap[name];
    const fh=new Set(), fd=new Set();
    [...c.performance,...c.capacity,...c.parity].forEach(x=>{
      const h=document.querySelector(`.host[data-id="${x.hostId}"]`);
      const d=getDrive(x.hostId,x.driveId);
      if(h&&h.classList.contains('failed')) fh.add(x.hostId);
      if(d&&d.classList.contains('failed')) fd.add(`${x.hostId}:${x.driveId}`);
    });
    if (fh.size+fd.size > ftt) { vm.classList.remove('impacted','resync'); vm.classList.add('unrecoverable'); }
  });
}
function freeHost(excl) {
  const l=[...document.querySelectorAll('.host:not(.failed)')].filter(h=>parseInt(h.dataset.id,10)!==excl);
  return l.length ? l[rand(0,l.length-1)] : null;
}

// ── Data Placement ────────────────────────────────────────────────────
function renderDP(policy, imp=false) {
  if (!policy) {
    $dp.innerHTML=`<div class="dp-empty"><svg width="36" height="36" viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="15" stroke="#b3c4d0" stroke-width="1.5"/><path d="M18 11v8" stroke="#b3c4d0" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="24" r="1.3" fill="#b3c4d0"/></svg><p>Select a VM to view its<br/>ESA data placement diagram</p></div>`;
    return;
  }
  const bCls  = imp ? 'impacted' : 'normal';
  const bTxt  = imp ? 'Impacted &mdash; rebuild in progress' : 'Normal &mdash; fully protected';
  const comp  = (lbl,type) => {
    const c = imp ? 'c-rsync' : type==='perf'?'c-perf':type==='cap'?'c-cap':'c-par';
    return `<div class="dp-c ${c}">${lbl}</div>`;
  };
  const dCol  = imp ? C_SYNC : null;
  const leg   = (col,title,inner) =>
    `<div class="dp-lg-grp"><div class="dp-lg-lbl"><span class="dp-dot" style="background:${dCol||col}"></span>${title}</div><div class="dp-leg">${inner}</div></div>`;

  let h = `<div class="dp-bar ${bCls}"><span class="dp-policy">${policy}</span><span class="dp-state">${bTxt}</span></div>`;

  if (policy==='RAID-1') {
    h += leg(C_PERF,'Performance Leg &mdash; RAID-1 mirror', comp('C1','perf')+comp('C2','perf'));
    h += leg(C_CAP, 'Capacity Leg &mdash; RAID-1 mirror',   comp('C1','cap') +comp('C2','cap'));
  } else if (policy==='RAID-5') {
    const wide = numHosts>=6;
    h += leg(C_PERF,'Performance Leg &mdash; RAID-1 mirror', comp('C1','perf')+comp('C2','perf'));
    h += wide
      ? leg(C_CAP,'Capacity Leg &mdash; RAID-5 Adaptive (4+1)', comp('D1','cap')+comp('D2','cap')+comp('D3','cap')+comp('D4','cap')+comp('P','par'))
      : leg(C_CAP,'Capacity Leg &mdash; RAID-5 (2+1)',          comp('D1','cap')+comp('D2','cap')+comp('P','par'));
    h += `<div class="dp-note">&#8505;&ensp;Adaptive RAID-5 upgrades 2+1 &rarr; 4+1 automatically at &ge;6 hosts</div>`;
  } else if (policy==='RAID-6') {
    const w = numHosts>=6;
    h += leg(C_PERF,'Performance Leg &mdash; RAID-1 mirror', comp('C1','perf')+comp('C2','perf')+(w?comp('C3','perf'):''));
    h += leg(C_CAP, 'Capacity Leg &mdash; RAID-6 (4+2)',    comp('D1','cap')+comp('D2','cap')+comp('D3','cap')+comp('D4','cap')+comp('P1','par')+comp('P2','par'));
  }
  const ki = (c,l) => `<div class="dp-ki"><div class="dp-ksw" style="background:${c}"></div>${l}</div>`;
  h += `<div class="dp-key">${ki(C_PERF,'Performance')}${ki(C_CAP,'Capacity data')}${ki(C_PAR,'Parity')}${imp?ki(C_SYNC,'Resyncing'):''}</div>`;
  $dp.innerHTML = h;
}

// ── Utils ─────────────────────────────────────────────────────────────
function changeHosts(d) { numHosts=Math.max(3,Math.min(8,numHosts+d)); resetSim(); }
function resetSim() { clearSel(); initCluster(); }
function mk(t,c,a={}) { const e=document.createElement(t); if(c) e.className=c; Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v)); return e; }
function getDrive(h,d) { return document.querySelector(`.drive[data-host-id="${h}"][data-drive-id="${d}"]`); }
function rand(a,b) { return a+Math.floor(Math.random()*(b-a+1)); }
function shuffle(a) { return a.sort(()=>Math.random()-.5); }
function pickPolicy() { let p,t=0; do{p=POLICIES[rand(0,POLICIES.length-1)];t++;}while(numHosts<MIN_NODES[p]&&t<30); return p; }
function genName(used) { const b=NAMES[rand(0,NAMES.length-1)]; let n=`vm-${b}`,i=1; while(used.has(n)&&i<20)n=`vm-${b.slice(0,3)}${i++}`; used.add(n); return n; }
function setStatus(msg,type='') { $stat.innerHTML=msg; $stat.className=`vc-status${type?' is-'+type:''}`; }

// ── Wire ──────────────────────────────────────────────────────────────
document.getElementById('btnDecrease').addEventListener('click',()=>changeHosts(-1));
document.getElementById('btnIncrease').addEventListener('click',()=>changeHosts(+1));
document.getElementById('btnSimulate').addEventListener('click',simulateFailure);
document.getElementById('btnReset').addEventListener('click',resetSim);

// ── Boot ──────────────────────────────────────────────────────────────
initCluster();
