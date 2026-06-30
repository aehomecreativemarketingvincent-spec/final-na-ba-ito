/* =============================================
   AE HOME POS SYSTEM - app.js
   ============================================= */

// ─── CONFIG ───────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycbzbdiqn_2POqByVcw_vTRS4wqhVj_4BsmHE9K55OOHxpTvbpP0F-y9CHTmRHv2eonsSJg/exec";

// ─── SAFE LOCALSTORAGE HELPERS ───────────────
function lsGet(key, fallback) {
  if (fallback === undefined) fallback = null;
  try {
    var v = localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    return JSON.parse(v);
  } catch (e) { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('[POS] localStorage full, cannot save key:', key); return false; }
}

function lsDel(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}



// ─── GLOBAL ERROR HANDLERS ───────────────────
window.onerror = function(msg, src, line, col, err) {
  // Silently log — don't alert users in production
  console.error('[POS Error]', msg, 'at', src + ':' + line + ':' + col, err || '');
  return false; // allow default browser handling
};

window.addEventListener('unhandledrejection', function(e) {
  console.error('[POS UnhandledPromise]', e.reason);
  // Prevent silent failures from crashing the app
  e.preventDefault();
});

// ─── STATE ────────────────────────────────────
let currentUser = null; // { id, name, role, username }
let currentPage = 'dashboard';
let cart = [];
let activeUsers = {};   // { sessionId: { name, role, loginTime } }
let mySessionId = null;

// ─── ROLE CONFIG ──────────────────────────────
const ROLE_NAV = {
  admin: [
    { id: 'dashboard',   icon: '', label: 'Dashboard' },
    { id: 'pos',         icon: '', label: 'Point of Sale' },
    { id: 'inventory',   icon: '', label: 'Inventory' },
    { id: 'finance',     icon: '', label: 'Finance' },
    { id: 'cashiers',    icon: '', label: 'Users' },
    { id: 'receipts',    icon: '', label: 'Receipts' },
    { id: 'summary',     icon: '', label: 'Sales Summary' },
    { id: 'logs',        icon: '', label: 'Analytics' },
    { id: 'salesExport', icon: '', label: 'Sales Export' },
    { id: 'wholesalers', icon: '', label: 'Wholesalers' },
  ],
  cashier: [
    { id: 'pos',         icon: '', label: 'Point of Sale' },
    { id: 'summary',     icon: '', label: 'Sales Summary' },
    { id: 'receipts',    icon: '', label: 'Receipts' },
    { id: 'wholesalers', icon: '', label: 'Wholesalers' },
  ],
  clerk: [
    { id: 'inventory',   icon: '', label: 'Inventory' },
    { id: 'summary',     icon: '', label: 'Sales Summary' },
    { id: 'pos',         icon: '', label: 'Point of Sale' },
    { id: 'logs',        icon: '', label: 'Analytics' },
    { id: 'salesExport', icon: '', label: 'Sales Export' },
    { id: 'wholesalers', icon: '', label: 'Wholesalers' },
  ],
  viewer: [
    { id: 'dashboard', icon: '', label: 'Dashboard' },
    { id: 'receipts', icon: '', label: 'Receipts' },
  ]
};


// ─── DATE HELPERS ────────────────────────────
function parseDate(val, fallbackTxId) {
  if (!val && !fallbackTxId) return null;
  const s = String(val || '').trim();

  if (s) {
    // ISO string — most common from GAS
    let d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

    // M/D/YYYY or M/D/YYYY H:MM:SS (Sheets locale format)
    const parts = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (parts) {
      return new Date(
        parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]),
        parseInt(parts[4] || 0), parseInt(parts[5] || 0), parseInt(parts[6] || 0)
      );
    }

    // "Thu Jun 19 2026 09:23:45 GMT+0800 (PST)" — GAS locale string fallback
    d = new Date(s.replace(/\s*\(.*\)$/, ''));
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  }

  // Last resort: extract timestamp from TX/SI number (e.g. TX1781944845247)
  // These are Date.now() values embedded in the ID
  if (fallbackTxId) {
    const m = String(fallbackTxId).match(/(\d{13,})/);
    if (m) {
      const ts = parseInt(m[1]);
      if (ts > 1000000000000) {
        const d2 = new Date(ts);
        if (!isNaN(d2.getTime()) && d2.getFullYear() > 2000) return d2;
      }
    }
  }

  return null;
}

function localDateStr(d) {
  const dt = (d instanceof Date) ? d : parseDate(d);
  if (!dt || isNaN(dt.getTime())) return '';
  // Use LOCAL time methods — correct for PH (UTC+8) regardless of how date was parsed
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Safe date formatter — never returns "Invalid Date".
 * Uses parseDate() for robustness, returns fallback string if date is invalid.
 */
function safeFormatDate(val, options, fallback = 'N/A') {
  if (!val) return fallback;
  const d = val instanceof Date ? val : parseDate(val);
  if (!d || isNaN(d.getTime())) return fallback;
  try {
    return d.toLocaleString('en-PH', options);
  } catch(e) {
    return fallback;
  }
}

function safeFormatDateOnly(val, fallback = 'N/A') {
  return safeFormatDate(val, { dateStyle: 'medium' }, fallback);
}

function safeFormatDateTime(val, fallback = 'N/A') {
  return safeFormatDate(val, { dateStyle: 'short', timeStyle: 'short' }, fallback);
}

function safeFormatDateLong(val, fallback = 'N/A') {
  return safeFormatDate(val, { dateStyle: 'long', timeStyle: 'short' }, fallback);
}

/** Returns start (00:00:00) and end (23:59:59.999) of a local calendar day */
function dayRange(date) {
  const d   = date instanceof Date ? date : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function formatPHP(amount) {
  return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

// ─── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadCartFromStorage();
  const saved = lsGet('ae_session', null);
  if (saved) {
    try {
      currentUser = saved;
      initApp();
    } catch(e) { showLogin(); }
  } else {
    showLogin();
  }
  registerSW();
});

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => {
      // Check for SW updates on page focus (catches deployments)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      }, { once: false });
    })
    .catch(e => console.warn('[POS] SW registration failed:', e.message));
}

let _clockInterval = null;
function startClock() {
  if (_clockInterval) return; // prevent duplicate intervals on re-init
  const tick = () => {
    const el = document.getElementById('liveClock');
    if (el) el.textContent = new Date().toLocaleString('en-PH', {
      hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short', month: 'short', day: 'numeric'
    });
  };
  tick();
  _clockInterval = setInterval(tick, 1000);
}

// ─── LOGIN ────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('appScreen').classList.add('hidden');
}

async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!u || !p) { showLoginErr('Please enter username and password.'); return; }

  // Admin hardcoded
  if (u === 'admin' && p === 'admin123') {
    currentUser = { id: 'admin', name: 'Administrator', role: 'admin', username: 'admin' };
    finishLogin();
    return;
  }

  showLoginErr('Checking credentials...');
  try {
    const res = await gasRequest({ action: 'login', username: u, password: p });
    if (res.success) {
      currentUser = { id: res.id, name: res.name, role: res.role, username: u };
      finishLogin();
    } else {
      showLoginErr(res.message || 'Invalid username or password.');
    }
  } catch(e) {
    showLoginErr('Connection error. Check GAS URL or network.');
  }
}

function showLoginErr(msg) {
  const el = document.getElementById('loginError');
 el.textContent = msg;
  el.classList.remove('hidden');
}

function enterViewerMode() {
  currentUser = { id: 'viewer', name: 'Viewer', role: 'viewer', username: 'viewer' };
  finishLogin();
}

function finishLogin() {
  mySessionId = 'sess_' + Date.now();
  lsSet('ae_session', currentUser);
  lsSet('ae_session_id', mySessionId);
  trackActiveUser(true);
  // Register session in GAS (for cross-device single session)
  if (currentUser.role !== 'viewer') {
    gasPost({
      action: 'registerSession',
      userId: currentUser.id || currentUser.username,
      sessionId: mySessionId,
      username: currentUser.username,
      name: currentUser.name,
      role: currentUser.role,
      device: navigator.userAgent.substring(0, 80)
    }).catch(() => {}); // silent fail
  }
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('appScreen').classList.remove('hidden');
  initApp();
  // Start session polling — check every 15 seconds if session is still valid
  startSessionPoller();
}

function doLogout(showConfirm = true) {
  if (showConfirm && !confirm('Are you sure you want to logout?')) return;
  stopSessionPoller();
  trackActiveUser(false);
  // Unregister session from GAS
  if (currentUser && currentUser.role !== 'viewer' && mySessionId) {
    gasPost({ action: 'unregisterSession', userId: currentUser.id || currentUser.username, sessionId: mySessionId }).catch(() => {});
  }
  currentUser = null;
  mySessionId = null;
  lsDel('ae_session'); lsDel('ae_session_id');
  cart = [];
  saveCartToStorage();
  document.getElementById('appScreen').classList.add('hidden');
  showLogin();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').classList.add('hidden');
}

// ── SESSION POLLER ─────────────────────────────
let sessionPollInterval = null;

function startSessionPoller() {
  stopSessionPoller();
  if (!currentUser || currentUser.role === 'viewer') return;
  sessionPollInterval = setInterval(async () => {
    if (!currentUser || !mySessionId) return;
    try {
      const res = await gasRequest({
        action: 'checkSession',
        userId: currentUser.id || currentUser.username,
        sessionId: mySessionId
      });
      if (res.valid === false) {
        // Session was invalidated — another device logged in!
        stopSessionPoller();
        showSessionKicked();
      }
    } catch(e) {} // silent fail — don't logout on network error
  }, 15000); // check every 15 seconds
}

function stopSessionPoller() {
  if (sessionPollInterval) {
    clearInterval(sessionPollInterval);
    sessionPollInterval = null;
  }
}

function showSessionKicked() {
  // Force logout with notification
  trackActiveUser(false);
  currentUser = null;
  mySessionId = null;
  lsDel('ae_session'); lsDel('ae_session_id');
  cart = [];
  saveCartToStorage();
  document.getElementById('appScreen').classList.add('hidden');
  showLogin();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  // Show kicked message
  const errEl = document.getElementById('loginError');
  if (errEl) {
    errEl.textContent = '⚠️ You were logged out because this account was used on another device.';
    errEl.classList.remove('hidden');
    errEl.style.background = '#fff7e0';
    errEl.style.borderColor = '#f59e0b';
    errEl.style.color = '#92400e';
  }
}

// ─── ACTIVE USER TRACKING ─────────────────────
function trackActiveUser(add) {
  var users = lsGet('ae_active_users', {});
  if (add && currentUser) {
    users[mySessionId] = {
      name: currentUser.name,
      role: currentUser.role,
      loginTime: new Date().toISOString()
    };
  } else if (mySessionId) {
    delete users[mySessionId];
  }
  lsSet('ae_active_users', users);
}

function showActiveUsers() {
  const users = lsGet('ae_active_users', {});
  const panel = document.getElementById('activeUsersPanel');
  const list  = document.getElementById('activeUsersList');
  if (!panel || !list) return;
  list.innerHTML = '';
  const entries = Object.entries(users);
  if (!entries.length) {
    const p = document.createElement('p');
    p.className   = 'text-muted text-center mt-10';
    p.textContent = 'No active users tracked.';
    list.appendChild(p);
  } else {
    entries.forEach(([, u]) => {
      const item = document.createElement('div');
      item.className = 'aup-item';
      const dot  = document.createElement('div');
      dot.className = 'aup-dot';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className   = 'aup-name';
      name.textContent = u.name || 'Unknown';
      const role = document.createElement('div');
      role.className   = 'aup-role';
      role.textContent = u.role || '';
      info.appendChild(name);
      info.appendChild(role);
      const time = document.createElement('div');
      time.className   = 'aup-time';
      time.textContent = u.loginTime ? new Date(u.loginTime).toLocaleTimeString('en-PH', { hour12: true }) : '';
      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(time);
      list.appendChild(item);
    });
  }
  panel.classList.remove('hidden');
}

function hideActiveUsers() {
  document.getElementById('activeUsersPanel').classList.add('hidden');
}

// ─── APP INIT ─────────────────────────────────
function initApp() {
  const role = currentUser.role;

  // User badge
 document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
 document.getElementById('userNameDisplay').textContent = currentUser.name;
 document.getElementById('userRoleDisplay').textContent = role;

  // Build nav
  buildNav(role);

  // Default page
  const defaultPages = { admin: 'dashboard', cashier: 'pos', clerk: 'inventory', viewer: 'dashboard' };
  navigateTo(defaultPages[role] || 'dashboard');
}

function buildNav(role) {
  const items = ROLE_NAV[role] || ROLE_NAV.viewer;
  const nav = document.getElementById('navMenu');
 nav.innerHTML = items.map(it =>`
    <button class="nav-item" id="nav_${it.id}" onclick="navigateTo('${it.id}')">
      
      <span>${it.label}</span>
    </button>
  `).join('');
}

function navigateTo(page) {
  currentPage = page;
  // highlight nav
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const ni = document.getElementById('nav_' + page);
  if (ni) ni.classList.add('active');
  // title
  const titles = {
    dashboard: 'Dashboard', pos: 'Point of Sale',
    inventory: 'Inventory Management', finance: 'Finance',
    cashiers: 'User Management', receipts: 'Receipts',
    summary: 'Sales Summary', logs: 'Analytics & Insights',
    salesExport: 'Sales Export',
    wholesalers: 'Wholesalers Information'
  };
 document.getElementById('topbarTitle').textContent = titles[page] || page;
  // render
  const pc = document.getElementById('pageContent');
 pc.innerHTML = `<div class="loading-spinner"><div class="spinner"></div> Loading...</div>`;
  setTimeout(() => renderPage(page), 150);
  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sideOverlay')?.classList.remove('show');
}

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  s.classList.toggle('open');
  let ov = document.getElementById('sideOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'sideOverlay';
    ov.className = 'sidebar-overlay';
    ov.onclick = () => { s.classList.remove('open'); ov.classList.remove('show'); };
    document.body.appendChild(ov);
  }
  ov.classList.toggle('show');
}

// ─── PAGE RENDERER ────────────────────────────
function renderPage(page) {
  const pages = {
    dashboard: renderDashboard,
    pos: renderPOS,
    inventory: renderInventory,
    finance: renderFinance,
    cashiers: renderCashiers,
    receipts: renderReceipts,
    summary: renderSummary,
    logs: renderLogs,
    salesExport: renderSalesExport,
    wholesalers: renderWholesalers,
  };
  if (pages[page]) pages[page]();
  else {
    const pc = document.getElementById('pageContent');
    if (pc) pc.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Page not available.</div></div>';
  }
}

// ─── GAS REQUEST ─────────────────────────────
async function gasRequest(params, timeoutMs = 30000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url  = GAS_URL + '?' + new URLSearchParams(params);
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    clearTimeout(timer);
    try { return JSON.parse(text); }
    catch (e) { throw new Error('Invalid server response'); }
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
    throw e;
  }
}

async function gasPost(payload, timeoutMs = 45000) {
  // GAS CORS rule: only GET with no custom headers works cross-origin.
  // POST is blocked by CORS. Solution: GET + base64 payload in URL param.
  // We check for e.parameter.data (not e.parameter.method) in doGet
  // so it works even if params survive the redirect.
  const json = JSON.stringify(payload);
  let encoded;
  try {
    encoded = btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    const bytes  = new TextEncoder().encode(json);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    encoded = btoa(binary);
  }
  const url   = GAS_URL + '?data=' + encodeURIComponent(encoded);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!text || !text.trim()) return { success: true };
    try { return JSON.parse(text); }
    catch (e) { return { success: true }; }
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Save timed out. Please try again.');
    throw new Error('Network error: ' + e.message);
  }
}

// gasPostWithResult removed (unused)

// ─── TOAST ────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
  const el    = document.createElement('div');
  el.className = 'toast ' + type;
  const iconSpan = document.createElement('span');
  iconSpan.className   = 'toast-icon';
  iconSpan.textContent = icons[type] || 'i';
  const msgSpan = document.createElement('span');
  msgSpan.textContent  = String(msg || '');
  el.appendChild(iconSpan);
  el.appendChild(msgSpan);
  const container = document.getElementById('toastContainer');
  if (!container) return;
  container.appendChild(el);
  // Limit toasts to prevent DOM flooding
  const allToasts = container.querySelectorAll('.toast');
  if (allToasts.length > 5) allToasts[0].remove();
  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function showLoading(msg = 'Processing...') {
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.className = 'loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="loading-overlay-box">
      <div class="loading-ring"><div></div><div></div><div></div><div></div></div>
      <div class="loading-overlay-msg">${msg}</div>
    </div>`;
  el.style.display = 'flex';
  el.style.opacity = '0';
  setTimeout(() => { el.style.opacity = '1'; el.style.transition = 'opacity 0.2s'; }, 10);
}

function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => { el.style.display = 'none'; }, 200);
  }
}

// ─── MODAL ────────────────────────────────────
function openModal(html) {
 document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

// ─── RESET TEST DATA ──────────────────────────
function resetTestData() {
  if (!confirm('⚠️ This will clear your cart and cached data. Google Sheets data will NOT be deleted. Continue?')) return;
  cart = [];
  saveCartToStorage();
  lsDel('ae_receipt_gallery');
  lsDel('ae_active_users');
 toast('Test data cleared! Cart and local cache reset.', 'success');
  navigateTo('dashboard');
}

// ─── CART STORAGE ─────────────────────────────
function saveCartToStorage() {
  lsSet('ae_cart', cart);
}
function loadCartFromStorage() {
  try { cart = lsGet('ae_cart', []); } catch(e) { cart = []; }
}

// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════
async function renderDashboard() {
 document.getElementById('pageContent').innerHTML = `
    ${currentUser.role === 'admin' ? `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
<button class="btn btn-danger btn-sm" onclick="resetTestData()">️ Reset Test Data</button>
    </div>` : ''}
<div class="kpi-grid" id="kpiGrid">
      ${['Today Sales','Weekly Sales','Monthly Sales','Total Products','Total Transactions','Low Stock'].map((k,i) => `
<div class="kpi-card ${['kpi-blue','kpi-green','kpi-grad','kpi-blue','kpi-green','kpi-orange'][i]}">
<div class="kpi-label">${k}</div>
<div class="kpi-value" id="kpi_${i}">—</div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<div class="card">
<div class="card-title">Recent Transactions</div>
 <div id="recentTx"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
<div class="card">
<div class="card-title">️ Low Stock Items</div>
 <div id="lowStockList"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  try {
    const [salesRes, productsRes] = await Promise.all([
      gasRequest({ action: 'getSales' }),
      gasRequest({ action: 'getProducts' })
    ]);
    const sales = salesRes.data || [];
    const products = productsRes.data || [];

    const now = new Date();
    const { start: dashTodayStart, end: dashTodayEnd } = dayRange(now);
    const weekAgo  = new Date(now - 7  * 86400000);
    const monthAgo = new Date(now - 30 * 86400000);

    const todaySales = sales.filter(s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= dashTodayStart && d <= dashTodayEnd; });
    const weekSales  = sales.filter(s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= weekAgo; });
    const monthSales = sales.filter(s => { const d = parseDate(s.date); return d && d >= monthAgo; });

    const sumSales = arr => arr.reduce((a, s) => a + parseFloat(s.total || 0), 0);
    const lowStock = products.filter(p => parseInt(p.qtyPcs || 0) <= 5);

 document.getElementById('kpi_0').textContent = '₱' + sumSales(todaySales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_1').textContent = '₱' + sumSales(weekSales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_2').textContent = '₱' + sumSales(monthSales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_3').textContent = products.length;
 document.getElementById('kpi_4').textContent = sales.length;
 document.getElementById('kpi_5').textContent = lowStock.length;

    // Recent Tx
    const recentEl = document.getElementById('recentTx');
    if (!recentEl) return;
    const recent = [...sales].reverse().slice(0, 8);
 recentEl.innerHTML = recent.length ? `
 <div class="tbl-wrap"><table>
        <thead><tr><th>Tx#</th><th>Cashier</th><th>Total</th><th>Date</th></tr></thead>
        <tbody>${recent.map(s => `<tr>
          <td><span style="font-family:var(--font-mono);font-size:0.8rem">${s.transactionId || ''}</span></td>
          <td>${s.cashierName || ''}</td>
          <td class="text-green fw-700">₱${parseFloat(s.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
          <td class="text-muted" style="font-size:0.8rem">${safeFormatDateOnly(s.date)}</td>
        </tr>`).join('')}</tbody>
 </table></div>` : '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No transactions yet.</div></div>';

    const lsEl = document.getElementById('lowStockList');
    if (lsEl) lsEl.innerHTML = lowStock.length ? `
 <div class="tbl-wrap"><table>
        <thead><tr><th>Product</th><th>Qty</th></tr></thead>
        <tbody>${lowStock.map(p => `<tr>
          <td>${p.name}</td>
          <td><span class="${parseInt(p.qtyPcs||0)===0?'badge-out':'badge-low'}">${p.qtyPcs} pcs</span></td>
        </tr>`).join('')}</tbody>
 </table></div>` : '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">All items well-stocked.</div></div>';

  } catch(e) {
 toast('Failed to load dashboard data.', 'error');
  }
}

// ═══════════════════════════════════════════════
// POS
// ═══════════════════════════════════════════════
let allProducts = [];
let searchTimeout = null;

async function renderPOS() {
 document.getElementById('pageContent').innerHTML = `
<div class="pos-layout">
<div class="pos-left">
<div class="barcode-scanner-bar" id="barcodeBar" onclick="document.getElementById('barcodeInput').focus()">
          <span class="bc-label">BARCODE</span>
          <input type="text" id="barcodeInput"
            placeholder="Scan or type barcode..."
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            onkeydown="handleBarcodeKey(event,this)"
            onfocus="document.getElementById('barcodeBar').style.borderLeftColor='var(--blue)'"
            onblur="document.getElementById('barcodeBar').style.borderLeftColor=''">
          <span class="bc-status" id="bcStatus">●</span>
          <button class="bc-cam-btn" onclick="openCameraScanner()" title="Use Camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
<div class="search-wrap" style="flex:1;margin-bottom:0">
            <span class="search-icon">🔍</span>
<input type="text" id="posSearch" placeholder="Search product name..." oninput="onPosSearch(this.value)" autocomplete="off">
 <div class="search-dropdown hidden" id="searchDropdown"></div>
          </div>
 ${currentUser.role === 'admin' ? `<button class="btn btn-ghost btn-sm" onclick="openReceiptSettings()" title="Receipt Settings">️ Receipt</button>` : ''}
        </div>
<div class="product-grid" id="productGrid">
 <div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div> Loading products...</div>
        </div>
      </div>
<div class="pos-right">
<div class="cart-header">
          <span>🛒 Cart</span>
<button class="btn btn-ghost btn-sm" onclick="clearCart()">Clear</button>
        </div>
 <div class="cart-items" id="cartItems"></div>
<div class="cart-footer">
 <div class="cart-total-row"><span class="ct-label">Items</span><span class="ct-value" id="cartItemCount">0</span></div>
 <div class="cart-total-row"><span class="ct-label">Subtotal</span><span class="ct-value" id="cartSubtotal">₱0.00</span></div>
 <div class="cart-total-row"><span class="ct-label fw-700">TOTAL</span><span class="ct-value ct-grand" id="cartTotal">₱0.00</span></div>
          <button class="btn-checkout" id="checkoutBtn" onclick="openCheckout()" disabled>💳 CHECKOUT</button>
        </div>
      </div>
    </div>`;

  try {
    await loadProducts();
  } catch(e) {
    const grid = document.getElementById('productGrid');
    if (grid) grid.innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div>Failed to load products. Check connection.</div></div>';
    toast('Could not load products. Pull to refresh.', 'error');
  }
  renderCart();
  focusBarcodeInput();
}

async function loadProducts() {
  try {
    const res = await gasRequest({ action: 'getProducts' });
    allProducts = res.data || [];
    // Build barcode lookup map for fast scanning
    buildBarcodeMap();
    renderProductGrid(allProducts);
  } catch(e) {
 document.getElementById('productGrid').innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div>Failed to load products. Check GAS URL.</div></div>';
  }
}

function renderProductGrid(products) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  if (!products.length) {
 grid.innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div class="no-data-text">No products found.</div></div>';
    return;
  }
 grid.innerHTML = products.map(p =>{
    const qty = parseInt(p.qtyPcs || 0);
    const qtyPk = parseInt(p.qtyPacks || 0);
    const hasPack = parseFloat(p.pricePack || 0) > 0;
    const oos = qty <= 0 && (!hasPack || qtyPk <= 0);
    const pcImg = getProductImage(p.id);
    return `
<div class="product-card ${oos ? 'out-of-stock' : ''}">
${pcImg ? `<img src="${pcImg}" class="pc-img">` : ''}
<div class="pc-name">${p.name}</div>
 ${p.barcode ? `<div class="pc-barcode">${p.barcode}</div>` : ''}
<div class="pc-stock ${oos ? 'text-red' : qty<= 5 ? 'text-orange' : 'text-muted'}" style="margin-bottom:6px">
        ${oos ? '❌ Out of stock' : `📦 ${qty} pcs${qtyPk ? ' | '+qtyPk+' pks':''}`}
      </div>
      ${oos ? '' : `
<div class="pc-unit-btns">
 ${qty >0 ? `<button class="pc-unit-btn btn-piece" onclick="addToCart('${p.id}','piece')">
          <span class="pc-unit-label">Per Piece</span>
          <span class="pc-unit-price">₱${parseFloat(p.pricePer||0).toFixed(2)}</span>
        </button>` : ''}
 ${hasPack && qtyPk >0 ? `<button class="pc-unit-btn btn-pack" onclick="addToCart('${p.id}','pack')">
          <span class="pc-unit-label">Per Pack</span>
          <span class="pc-unit-price">₱${parseFloat(p.pricePack||0).toFixed(2)}</span>
        </button>` : ''}
      </div>`}
    </div>`;
  }).join('');
}

function handleBarcodeKey(e, input) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = (input.value || '').trim();
    input.value = '';
    input.focus();
    if (val) processBarcodeValue(val);
  }
}

// Global keypress listener — auto-route to barcode input on POS page
document.addEventListener('keydown', function(e) {
  // Login: Enter submits (no extra listener needed at bottom)
  if (e.key === 'Enter' && document.getElementById('loginScreen')?.classList.contains('active')) {
    doLogin(); return;
  }
  // POS: any key focuses barcode input
  if (currentPage !== 'pos') return;
  const active  = document.activeElement;
  const bcInput = document.getElementById('barcodeInput');
  if (!bcInput) return;
  if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
    if (e.key.length === 1 || e.key === 'Enter') bcInput.focus();
  }
});


function focusBarcodeInput() {
  setTimeout(() => {
    const el = document.getElementById('barcodeInput');
    if (el) el.focus();
  }, 300);
}

// ── CAMERA BARCODE SCANNER (BarcodeDetector + ZXing fallback) ──
let cameraStream = null;
let cameraFacingMode = 'environment';
let isScanning = false;
let scanRafId = null;

async function openCameraScanner() {
  const modal = document.getElementById('cameraScannerModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  startCamera();
}

async function startCamera() {
  const video = document.getElementById('cameraFeed');
  const status = document.getElementById('cameraStatus');
  if (!video) return;
  stopCamera();

  try {
    if (status) status.textContent = 'Starting camera...';

    // Request camera — optimized for barcode scanning
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    video.srcObject = cameraStream;
    video.setAttribute('playsinline', true);
    await video.play();

    if (status) status.textContent = 'Point camera at barcode...';
    isScanning = true;

    // Use native BarcodeDetector if available (Android Chrome 83+, fast!)
    if ('BarcodeDetector' in window) {
      if (status) status.textContent = 'Ready (Native Scanner)';
      startNativeScanner(video, status);
    } else {
      // Load ZXing as fallback
      if (typeof ZXing === 'undefined') {
        if (status) status.textContent = 'Loading scanner...';
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js');
        } catch(e) {
          await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
        }
      }
      if (typeof ZXing !== 'undefined') {
        if (status) status.textContent = 'Ready (ZXing Scanner)';
        startZXingStream(video, status);
      } else {
        if (status) status.textContent = 'Ready (jsQR Scanner)';
        startJsQRStream(video, status);
      }
    }
  } catch(e) {
    if (!status) return;
    if (e.name === 'NotAllowedError') status.textContent = 'Camera denied. Allow camera access in browser settings.';
    else if (e.name === 'NotFoundError') status.textContent = 'No camera found.';
    else if (e.name === 'OverconstrainedError') {
      // Retry with simpler constraints
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode } });
      video.srcObject = cameraStream;
      await video.play();
      isScanning = true;
      startNativeScanner(video, status);
    } else status.textContent = 'Camera error: ' + e.message;
  }
}

// ── NATIVE BarcodeDetector (fastest on Android Chrome) ──
async function startNativeScanner(video, status) {
  const detector = new BarcodeDetector({
    formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','data_matrix','itf','codabar']
  });

  async function detect() {
    if (!isScanning) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const val = barcodes[0].rawValue.trim();
        if (status) {
          status.textContent = 'Found: ' + val;
          status.style.color = 'var(--green)';
        }
        showScanConfirm(val);
        return;
      }
    } catch(e) {}
    scanRafId = requestAnimationFrame(detect);
  }
  detect();
}

// ── ZXing stream scanner ──
function startZXingStream(video, status) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let reader;
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.QR_CODE,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    reader = new ZXing.BrowserMultiFormatReader(hints);
  } catch(e) { startJsQRStream(video, status); return; }

  function scan() {
    if (!isScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
        const result = reader.decodeBitmap(bmp);
        if (result) {
          const val = result.getText().trim();
          if (status) {
            status.textContent = 'Found: ' + val;
            status.style.color = 'var(--green)';
          }
          showScanConfirm(val);
          return;
        }
      } catch(e) {} // NotFoundException is normal
    }
    scanRafId = requestAnimationFrame(scan);
  }
  scan();
}

// ── jsQR fallback ──
function startJsQRStream(video, status) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function scan() {
    if (!isScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          const val = code.data.trim();
          if (status) {
            status.textContent = 'Found: ' + val;
            status.style.color = 'var(--green)';
          }
          showScanConfirm(val);
          return;
        }
      }
    }
    scanRafId = requestAnimationFrame(scan);
  }
  scan();
}

function stopCamera() {
  isScanning = false;
  if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  const video = document.getElementById('cameraFeed');
  if (video) video.srcObject = null;
}

function switchCamera() {
  cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

function closeCameraScanner() {
  const modal = document.getElementById('cameraScannerModal');
  if (modal) modal.classList.add('hidden');
  stopCamera();
}

function showScanConfirm(val) {
  // Pause scanning while confirming
  isScanning = false;
  if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }

  const status = document.getElementById('cameraStatus');
  const confirmDiv = document.getElementById('scanConfirmDiv');

  // Find product match
  // Fast barcode lookup using prebuilt map
  const productId = barcodeMap[val] || barcodeMap[val.toLowerCase()] ||
    barcodeMap[val.replace(/^0+/, '')] || barcodeMap['name:' + val.toLowerCase()];
  const match = productId ? allProducts.find(p => p.id === productId) : null;

  if (confirmDiv) {
    if (match) {
      confirmDiv.innerHTML = `
        <div style="background:rgba(0,200,83,0.15);border:1px solid var(--green);border-radius:8px;padding:10px;margin:8px 16px;text-align:center">
          <div style="color:white;font-weight:700;font-size:0.9rem">${match.name}</div>
          <div style="color:rgba(255,255,255,0.7);font-size:0.78rem">₱${parseFloat(match.pricePer||0).toFixed(2)} • ${match.qtyPcs||0} pcs</div>
          <div style="display:flex;gap:8px;margin-top:8px;justify-content:center">
            <button class="btn btn-success btn-sm" onclick="confirmScan('${val}')"> Add to Cart</button>
            <button class="btn btn-ghost btn-sm" style="color:white;border-color:rgba(255,255,255,0.3)" onclick="resumeScanning()"> Rescan</button>
          </div>
        </div>`;
    } else {
      confirmDiv.innerHTML = `
        <div style="background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:8px;padding:10px;margin:8px 16px;text-align:center">
          <div style="color:#fca5a5;font-size:0.82rem">No product found for:</div>
          <div style="color:white;font-weight:700;font-family:var(--font-mono);font-size:0.85rem">${val}</div>
          <button class="btn btn-ghost btn-sm" style="color:white;border-color:rgba(255,255,255,0.3);margin-top:8px" onclick="resumeScanning()"> Try Again</button>
        </div>`;
    }
    confirmDiv.style.display = 'block';
  }
}

function confirmScan(val) {
  const confirmDiv = document.getElementById('scanConfirmDiv');
  if (confirmDiv) { confirmDiv.innerHTML = ''; confirmDiv.style.display = 'none'; }
  closeCameraScanner();
  processBarcodeValue(val);
}

function resumeScanning() {
  const confirmDiv = document.getElementById('scanConfirmDiv');
  if (confirmDiv) { confirmDiv.innerHTML = ''; confirmDiv.style.display = 'none'; }
  const status = document.getElementById('cameraStatus');
  if (status) { status.textContent = 'Point camera at barcode...'; status.style.color = ''; }
  isScanning = true;
  // Restart scan loop
  const video = document.getElementById('cameraFeed');
  if (video && video.srcObject) {
    if ('BarcodeDetector' in window) {
      startNativeScanner(video, status);
    } else if (typeof ZXing !== 'undefined') {
      startZXingStream(video, status);
    } else {
      startJsQRStream(video, status);
    }
  }
}

// Barcode lookup map for fast O(1) scanning
let barcodeMap = {};
function buildBarcodeMap() {
  barcodeMap = {};
  allProducts.forEach(p => {
    const codes = (p.barcode || '').split(',').map(b => b.trim()).filter(Boolean);
    codes.forEach(c => {
      barcodeMap[c] = p.id;
      barcodeMap[c.toLowerCase()] = p.id;
      barcodeMap[c.replace(/^0+/, '')] = p.id;
    });
    // Also map by name
    if (p.name) barcodeMap['name:' + p.name.toLowerCase()] = p.id;
  });
}

function processBarcodeValue(val) {
  if (!val || val.length < 1) return;
  const bcStatus = document.getElementById('bcStatus');
  const bar = document.getElementById('barcodeBar');

  // Normalize: trim only, preserve leading zeros
  // Try exact match first, then case-insensitive, then strip leading zeros as last resort
  // Fast barcode lookup using prebuilt map
  const productId = barcodeMap[val] || barcodeMap[val.toLowerCase()] ||
    barcodeMap[val.replace(/^0+/, '')] || barcodeMap['name:' + val.toLowerCase()];
  const match = productId ? allProducts.find(p => p.id === productId) : null;

  if (match) {
    const qty = parseInt(match.qtyPcs || 0);
    if (qty <= 0) {
      toast(match.name + ' — Out of stock!', 'error');
      if (bcStatus) { bcStatus.style.color = '#ef4444'; setTimeout(() => { bcStatus.style.color = 'var(--green)'; }, 1000); }
      return;
    }
    addToCart(match.id, 'piece');
    toast(match.name + ' added!', 'success');
    if (bcStatus) { bcStatus.style.color = 'var(--green)'; }
    if (bar) {
      bar.style.background = 'rgba(0,200,83,0.06)';
      setTimeout(() => { bar.style.background = ''; }, 500);
    }
  } else {
    toast('No product: ' + val, 'error');
    if (bcStatus) { bcStatus.style.color = '#ef4444'; setTimeout(() => { bcStatus.style.color = 'var(--green)'; }, 1200); }
  }
}


function onPosSearch(val) {
  clearTimeout(searchTimeout);
  const dd = document.getElementById('searchDropdown');
  if (!val || val.length < 2) { dd.classList.add('hidden'); renderProductGrid(allProducts); return; }
  searchTimeout = setTimeout(() => {
    const q = val.toLowerCase();
    const matched = allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
    renderProductGrid(matched);
    if (matched.length > 0) {
 dd.innerHTML = matched.slice(0, 8).map(p =>{
        const hasPack = parseFloat(p.pricePack||0) > 0 && parseInt(p.qtyPacks||0) > 0;
 return `<div class="search-item">
          <div style="flex:1">
<div class="search-item-name">${p.name}</div>
<div class="search-item-stock">${p.qtyPcs||0} pcs${p.qtyPacks ? ' | '+p.qtyPacks+' pks' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
<button class="pc-unit-btn btn-piece" style="padding:4px 8px;font-size:0.75rem" onclick="addToCart('${p.id}','piece');document.getElementById('searchDropdown').classList.add('hidden')">
              Piece<br><b>₱${parseFloat(p.pricePer||0).toFixed(2)}</b>
            </button>
 ${hasPack ? `<button class="pc-unit-btn btn-pack" style="padding:4px 8px;font-size:0.75rem" onclick="addToCart('${p.id}','pack');document.getElementById('searchDropdown').classList.add('hidden')">
              Pack<br><b>₱${parseFloat(p.pricePack||0).toFixed(2)}</b>
            </button>` : ''}
          </div>
        </div>`;
      }).join('');
      dd.classList.remove('hidden');
    } else {
      dd.classList.add('hidden');
    }
  }, 200);
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('searchDropdown');
  if (dd && !dd.contains(e.target) && e.target.id !== 'posSearch') dd.classList.add('hidden');
});

function addToCart(productId, unit) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  const existing = cart.find(c => c.productId === productId && c.unit === unit);
  if (existing) {
    // Guard: never exceed available stock
    const maxQ = existing.maxQty || 9999;
    if (existing.qty >= maxQ) {
      toast(existing.name + ' — max stock reached (' + maxQ + ' available)', 'warning');
      return;
    }
    existing.qty++;
    existing.total = existing.qty * existing.price;
  } else {
    const price  = unit === 'pack' ? parseFloat(p.pricePack || 0) : parseFloat(p.pricePer || 0);
    const maxQty = unit === 'pack' ? parseInt(p.qtyPacks || 0) : parseInt(p.qtyPcs || 0);
    if (maxQty <= 0) {
      toast(p.name + ' is out of stock.', 'error');
      return;
    }
    cart.push({
      productId, unit,
      name:    p.name,
      barcode: p.barcode || '',
      price,
      qty:     1,
      total:   price,
      maxQty,
    });
  }
  saveCartToStorage();
  renderCart();
 toast(`${p.name} added to cart`, 'success');
}

function renderCart() {
  const itemsEl = document.getElementById('cartItems');
  const countEl = document.getElementById('cartItemCount');
  const subtEl = document.getElementById('cartSubtotal');
  const totalEl = document.getElementById('cartTotal');
  if (!itemsEl) return;

  if (cart.length === 0) {
 itemsEl.innerHTML = `<div class="empty-cart"><div class="empty-cart-icon"></div><div class="empty-cart-text">Cart is empty.<br>Tap a product to add.</div></div>`;
  } else {
 itemsEl.innerHTML = cart.map((item, idx) =>{
      const prod = allProducts.find(p => p.id === item.productId);
      const hasPack = prod && parseFloat(prod.pricePack||0) > 0;
      return `
<div class="cart-item">
<div class="ci-info">
<div class="ci-name">${item.name}</div>
<div class="ci-price">₱${parseFloat(item.price||0).toFixed(2)} / ${item.unit}</div>
 ${hasPack ? `<div class="ci-unit-toggle">
            <button class="${item.unit==='piece'?'active-piece':''}" onclick="switchCartUnit(${idx},'piece')">Piece ₱${parseFloat(prod.pricePer||0).toFixed(2)}</button>
            <button class="${item.unit==='pack'?'active-pack':''}" onclick="switchCartUnit(${idx},'pack')">Pack ₱${parseFloat(prod.pricePack||0).toFixed(2)}</button>
</div>` : `<div class="ci-unit">${item.unit === 'pack' ? '️ Pack' : ' Piece'}</div>`}
        </div>
<div class="ci-controls">
          <button class="ci-qty-btn" onclick="changeCartQty(${idx}, -1)">−</button>
          <input class="ci-qty-input" type="number" name="qty_${idx}" min="1" value="${item.qty}" onchange="setCartQty(${idx}, this.value)">
          <button class="ci-qty-btn" onclick="changeCartQty(${idx}, 1)">+</button>
        </div>
<div class="ci-total">₱${parseFloat(item.total||0).toFixed(2)}</div>
        <button class="ci-remove" onclick="removeFromCart(${idx})">✕</button>
      </div>`;
    }).join('');
  }

  const total = cart.reduce((s, c) => s + c.total, 0);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
 if (countEl) countEl.textContent = itemCount;
 if (subtEl) subtEl.textContent = '₱' + total.toLocaleString('en-PH', { minimumFractionDigits: 2 });
 if (totalEl) totalEl.textContent = '₱' + total.toLocaleString('en-PH', { minimumFractionDigits: 2 });
 const btn = document.getElementById('checkoutBtn');
  if (btn) btn.disabled = cart.length === 0;
}

function switchCartUnit(idx, unit) {
  const prod = allProducts.find(p => p.id === cart[idx].productId);
  if (!prod) return;
  cart[idx].unit = unit;
  cart[idx].price = unit === 'pack' ? parseFloat(prod.pricePack||0) : parseFloat(prod.pricePer||0);
  cart[idx].total = cart[idx].qty * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function changeCartQty(idx, delta) {
  cart[idx].qty = Math.max(1, cart[idx].qty + delta);
  cart[idx].total = cart[idx].qty * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function setCartQty(idx, val) {
  const q = Math.max(1, parseInt(val) || 1);
  cart[idx].qty = q;
  cart[idx].total = q * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCartToStorage();
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('Clear all items from cart?')) return;
  cart = [];
  saveCartToStorage();
  renderCart();
}

// ─── CHECKOUT ─────────────────────────────────
function openCheckout() {
 if (cart.length === 0) { toast('Cart is empty!', 'warning'); return; }
  const total = cart.reduce((s, c) => s + c.total, 0);
  openModal(`
<div class="modal-title">Checkout</div>
<div class="checkout-form">
<div class="checkout-summary">
 ${cart.map(c => `<div class="checkout-item-line"><span>${c.name} (${c.unit}) x${c.qty}</span><span>₱${parseFloat(c.total||0).toFixed(2)}</span></div>`).join('')}
 <div class="checkout-total-line"><span>TOTAL</span><span>₱${total.toFixed(2)}</span></div>
      </div>
<div class="field">
<label for="paymentMethod">Payment Method</label>
<select id="paymentMethod" name="paymentMethod" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:var(--font-main);font-size:0.9rem;background:white">
  <option value="Cash Sale">Cash Sale</option>
  <option value="GCash">GCash</option>
  <option value="Card">Card</option>
  <option value="Charge Sale">Charge Sale</option>
  <option value="Receivable">Receivable</option>
</select>
</div>
<div class="field">
<label for="cashInput">Cash Received (₱)</label>
<input type="number" id="cashInput" name="cashInput" placeholder="0.00" min="0" step="0.01" oninput="updateChange(${total})">
</div>
<div class="change-display" id="changeDisplay">
<div class="change-label">Change</div>
<div class="change-amount" id="changeAmt">₱0.00</div>
</div>
<button class="btn btn-primary btn-lg" style="width:100%" onclick="processCheckout(${total})">Confirm & Save Transaction</button>
    </div>`);
  setTimeout(() => document.getElementById('cashInput')?.focus(), 200);
}

function updateChange(total) {
  const cash = parseFloat(document.getElementById('cashInput')?.value || 0);
  const change = cash - total;
  const cd = document.getElementById('changeDisplay');
  const ca = document.getElementById('changeAmt');
 if (ca) ca.textContent = '₱' + Math.abs(change).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  if (cd) { cd.classList.toggle('negative', change < 0); }
}

let _checkoutInProgress = false;
async function processCheckout(total) {
  // ── Guard: prevent duplicate submissions (button + flag)
  if (_checkoutInProgress) return;
  _checkoutInProgress = true;
  const confirmBtn = document.querySelector('#modalBox .btn-primary');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving...'; }

  const paymentMethod = document.getElementById('paymentMethod')?.value || 'Cash Sale';
  const isNonCash     = ['GCash','Card','Charge Sale','Receivable'].includes(paymentMethod);
  const cash          = parseFloat(document.getElementById('cashInput')?.value || 0);
  const change        = isNonCash ? 0 : cash - total;

  // Validate cash for cash payments
  if (!isNonCash && (!cash || cash < total)) {
    toast('Cash received is insufficient!', 'error');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
    return;
  }

  // BUG 1 FIX: snapshot cart HERE before anything else —
  // was declared inside try block AFTER payload was already built, causing ReferenceError
  const cartSnapshot = [...cart];
  if (!cartSnapshot.length) { toast('Cart is empty!', 'warning'); return; }

  const txId  = 'TX' + Date.now();
  const siNum = 'SI' + Date.now();
  const now   = new Date();

  const payload = {
    action:        'saveSale',
    transactionId: txId,
    siNumber:      siNum,
    cashierName:   currentUser.name || currentUser.username || 'Unknown',
    cashierId:     currentUser.id   || currentUser.username || '',
    date:          now.toISOString(),
    items:         JSON.stringify(cartSnapshot),
    total,
    cash:   isNonCash ? total : cash,
    change,
  };

  // Close modal ONLY after validation passes
  closeModalDirect();
  showLoading('Saving transaction...');

  try {
    const res = await gasPost(payload);

    if (res.success) {
      // Clear cart immediately after confirmed save
      cart = [];
      saveCartToStorage();

      // Save receipt data locally for reprint
      saveReceiptToLocal({
        txId, siNum,
        cashier: currentUser.name || currentUser.username,
        date:    now.toISOString(),
        total,
      });
      saveFullReceiptToLocal({
        txId, siNum,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        total,
        cash:    isNonCash ? total : cash,
        change,
      });

      // Save export rows locally + push to GAS (non-blocking)
      saveSalesExportLocal({
        txId,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        paymentMethod,
      });
      pushSalesExportToGAS({
        txId,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        paymentMethod,
      }).catch(() => {});

      _checkoutInProgress = false;
      hideLoading();
      toast('Transaction saved!', 'success');

      // Show receipt immediately after successful save
      generateAndShowReceipt({
        txId, siNum,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        total,
        cash:    isNonCash ? total : cash,
        change,
        paymentMethod,
      });

    } else {
      _checkoutInProgress = false;
      hideLoading();
      toast('Save failed: ' + (res.message || 'Unknown error. Try again.'), 'error');
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
    }

  } catch(e) {
    _checkoutInProgress = false;
    hideLoading();
    toast('Network error. Check connection and try again.', 'error');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
  }
}

// ─── SALES EXPORT ────────────────────────────
function buildExportRows({ txId, cashier, date, items, paymentMethod }) {
  const txDate   = date instanceof Date ? date : new Date(date);
  const dateStr  = localDateStr(txDate);
  const timeStr  = txDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  return items.map((item, i) => ({
    transactionId:   txId,
    transactionDate: dateStr,
    transactionTime: timeStr,
    cashier:         cashier,
    paymentMethod:   paymentMethod || 'Cash Sale',
    barcode:         item.barcode  || '',
    stockNo:         String(i + 1).padStart(4, '0'),
    productName:     item.name     || '',
    quantity:        item.qty,
    uomCode:         item.unit === 'pack' ? 'PK' : 'PC',
    discount1:       '',
    discount2:       '',
    discount3:       '',
    discount4:       '',
    price:           parseFloat(item.price  || 0).toFixed(2),
    amount:          parseFloat(item.total  || 0).toFixed(2),
    remarks:         paymentMethod || 'Cash Sale',
  }));
}

function saveSalesExportLocal(data) {
  try {
    const rows     = buildExportRows(data);
    const existing = lsGet('ae_sales_export', []);
    const updated  = [...rows, ...existing];
    if (updated.length > 5000) updated.length = 5000;
    // If storage full, trim to 500 recent rows and retry once
    if (!lsSet('ae_sales_export', updated)) {
      const trimmed = updated.slice(0, 500);
      lsSet('ae_sales_export', trimmed);
      console.warn('[POS] Sales export trimmed to 500 rows — storage limit reached');
    }
  } catch(e) {
    console.warn('[POS] saveSalesExportLocal failed:', e.message);
  }
}

async function pushSalesExportToGAS(data) {
  try {
    const rows = buildExportRows(data);
    return await gasPost({ action: 'saveSalesExport', rows: JSON.stringify(rows) });
  } catch(e) {
    console.warn('[POS] Sales export push failed (non-critical):', e.message);
    return { success: false };
  }
}

function getSalesExportLocal(filters) {
  let rows = lsGet('ae_sales_export', []);
  if (!filters) return rows;

  const { from, to } = filters;
  return rows.filter(r => {
    if (!r.transactionDate) return false;
    const d = parseDate(r.transactionDate);
    if (!d) return false;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

// ─── RECEIPT ──────────────────────────────────
let currentReceiptData = null;

function generateAndShowReceipt(data) {
  currentReceiptData = data;
  const { txId, siNum, cashier, date, items, total, cash, change } = data;
  const dateStr = safeFormatDateLong(date);
  const vatRate = 0.12;
  const vatAmount = total * vatRate / (1 + vatRate);
  const netAmount = total - vatAmount;

  const itemRows = items.map(it => {
    const lineTotal = parseFloat(it.total || 0);
    const linePrice = parseFloat(it.price || 0);
    // Recalculate if total is missing or zero but price+qty exist
    const displayTotal = lineTotal || (linePrice * parseInt(it.qty || 1));
    return `<div class="receipt-item-row">
      <span class="desc">${it.name || 'Item'} (${it.unit || 'pc'})</span>
      <span class="qty">${it.qty || 1}</span>
      <span class="amt">₱${displayTotal.toFixed(2)}</span>
    </div>`;
  }).join('');

  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  const rs = getReceiptSettings();
  const receiptContent = document.getElementById('receiptContent');
  if (!receiptContent) { console.error('receiptContent element missing'); return; }
  receiptContent.innerHTML = `
<div class="receipt-head">
<div class="receipt-store">${rs.storeName}</div>
 ${rs.ownedBy ? `<div class="receipt-owned">Owned by: ${rs.ownedBy}</div>` : ''}
 ${rs.vatTin ? `<div class="receipt-vat">VAT Reg TIN: ${rs.vatTin}</div>` : ''}
 ${rs.address ? `<div class="receipt-addr">${rs.address}</div>` : ''}
    </div>
<div class="receipt-body">
<div class="receipt-meta">
        <div><b>SI #:</b> ${siNum}</div>
        <div><b>Transaction #:</b> ${txId}</div>
        <div><b>Cashier:</b> ${cashier}</div>
        <div><b>Date & Time:</b> ${dateStr}</div>
      </div>
      <hr class="receipt-divider">
<div class="receipt-items-header">
        <span>DESCRIPTION</span><span>QTY</span><span style="text-align:right">AMOUNT</span>
      </div>
      ${itemRows}
      <hr class="receipt-divider">
 <div class="receipt-meta" style="text-align:right"><b>Total Qty:</b> ${totalQty}</div>
<div class="receipt-totals">
 <div class="receipt-total-row"><span>Amount Due</span><span>₱${parseFloat(total||0).toFixed(2)}</span></div>
 <div class="receipt-total-row"><span>Cash</span><span>₱${parseFloat(cash||0).toFixed(2)}</span></div>
 <div class="receipt-total-row grand"><span>CHANGE</span><span>₱${parseFloat(change||0).toFixed(2)}</span></div>
 <div class="receipt-total-row vat-row"><span>VAT (12% incl.)</span><span>₱${vatAmount.toFixed(2)}</span></div>
      </div>
    </div>
<div class="receipt-footer">
      ${rs.footer || 'This serves as Sales Invoice for Inventory Only'}<br>
      Thank you for shopping at ${rs.storeName}!
    </div>`;

  const receiptModal = document.getElementById('receiptModal');
  if (!receiptModal) {
    console.error('receiptModal element not found in DOM');
    toast('Receipt could not be displayed. Check index.html for #receiptModal.', 'error');
    return;
  }
  receiptModal.classList.remove('hidden');
  // Scroll receipt into view on mobile
  receiptModal.scrollTop = 0;
}

function closeReceiptModal() {
  const receiptModal = document.getElementById('receiptModal');
  if (receiptModal) receiptModal.classList.add('hidden');
  currentReceiptData = null;
  navigateTo('pos');
}

async function downloadReceipt() {
  if (!currentReceiptData) return;
  try {
    const el = document.getElementById('receiptContent');
    if (typeof html2canvas === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `receipt_${currentReceiptData.txId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch(e) {
 toast('Download failed. Try again.', 'error');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function saveReceiptToLocal(meta) {
  let gallery = lsGet('ae_receipt_gallery', []);
  gallery.unshift(meta);
  if (gallery.length > 200) gallery = gallery.slice(0, 200);
  lsSet('ae_receipt_gallery', gallery);
}

function saveFullReceiptToLocal(data) {
  // Save full receipt data for reprinting
  try {
    let full = lsGet('ae_receipt_full', {});
    full[data.txId] = {
      txId: data.txId,
      siNum: data.siNum,
      cashier: data.cashier,
      date: data.date instanceof Date ? data.date.toISOString() : data.date,
      items: data.items,
      total: data.total,
      cash: data.cash,
      change: data.change
    };
    // Keep only last 100 full receipts
    const keys = Object.keys(full);
    if (keys.length > 100) {
      keys.slice(0, keys.length - 100).forEach(k => delete full[k]);
    }
    lsSet('ae_receipt_full', full);
  } catch(e) {}
}

// ═══════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════
let invProducts = [];

async function renderInventory() {
  const isReadOnly = currentUser.role === 'viewer';
 document.getElementById('pageContent').innerHTML = `
<div class="inv-toolbar">
<div class="search-wrap" style="flex:1;min-width:200px;margin-bottom:0">
        <span class="search-icon">🔍</span>
<input type="text" id="invSearch" placeholder="Search products..." oninput="filterInventory(this.value)">
      </div>
      ${!isReadOnly ? `
<button class="btn btn-primary" onclick="openAddProductModal()">Add Product</button>
<button class="btn btn-ghost" onclick="openImportModal()">Import CSV/Excel</button>
      ` : ''}
    </div>
<div class="card">
 <div id="inventoryTable"><div class="loading-spinner"><div class="spinner"></div> Loading...</div></div>
    </div>`;
  await loadInventory();
}

async function loadInventory() {
  try {
    const res = await gasRequest({ action: 'getProducts' });
    invProducts = res.data || [];
    renderInventoryTable(invProducts);
  } catch(e) {
    const el = document.getElementById('inventoryTable');
 if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load inventory.</div></div>';
  }
}


// ── PRODUCT IMAGES (base64 in localStorage) ──
// Product image cache — avoid repeated localStorage reads
let _imgCache = null;
function _getImgStore() {
  if (!_imgCache) {
    try { _imgCache = lsGet('ae_product_images', {}); }
    catch(e) { _imgCache = {}; }
  }
  return _imgCache;
}
function _saveImgStore(imgs) {
  _imgCache = imgs;
  try { lsSet('ae_product_images', imgs); }
  catch(e) { toast('Image too large or storage full.', 'error'); }
}

function getProductImage(productId) {
  return _getImgStore()[productId] || null;
}
function saveProductImage(productId, base64) {
  const imgs = _getImgStore();
  imgs[productId] = base64;
  _saveImgStore(imgs);
}
function deleteProductImage(productId) {
  const imgs = _getImgStore();
  delete imgs[productId];
  _saveImgStore(imgs);
}

function openImageUpload(productId, productName) {
  openModal(`
    <div class="modal-title">Product Image — ${productName}</div>
    <p style="color:var(--text3);font-size:0.82rem;margin-bottom:16px">
      Images are stored on this device only. Max recommended size: 1MB.
    </p>
    <div class="img-upload-area" id="imgUploadArea" onclick="document.getElementById('imgFileInput').click()">
      <div id="imgPreviewWrap">
        ${getProductImage(productId)
          ? `<img src="${getProductImage(productId)}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain">`
          : `<div style="text-align:center;color:var(--text3);padding:32px">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 10px;display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <div style="font-size:0.85rem">Click to upload image</div>
              <div style="font-size:0.75rem;margin-top:4px">JPG, PNG, WEBP</div>
            </div>`
        }
      </div>
    </div>
    <input type="file" id="imgFileInput" accept="image/*" style="display:none" onchange="handleImageUpload(this,'${productId}')">
    <div style="display:flex;gap:10px;margin-top:14px">
      ${getProductImage(productId) ? `<button class="btn btn-danger btn-sm" onclick="deleteProductImage('${productId}');closeModalDirect();loadInventory()">Remove Image</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
    </div>`);
}

function handleImageUpload(input, productId) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Image too large! Max 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    // Resize image before saving
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX = 300;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const resized = canvas.toDataURL('image/jpeg', 0.75);
      saveProductImage(productId, resized);
      toast('Image saved!', 'success');
      closeModalDirect();
      loadInventory();
    };
    img.src = base64;
  };
  reader.readAsDataURL(file);
}

function viewProductImage(productId, productName) {
  const img = getProductImage(productId);
  if (!img) { openImageUpload(productId, productName); return; }
  openModal(`
    <div class="modal-title">${productName}</div>
    <div style="text-align:center">
      <img src="${img}" style="max-width:100%;max-height:360px;border-radius:10px;object-fit:contain;box-shadow:var(--shadow)">
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost btn-sm" onclick="openImageUpload('${productId}','${productName}');closeModalDirect()">Change Image</button>
      <button class="btn btn-danger btn-sm" onclick="deleteProductImage('${productId}');closeModalDirect();loadInventory()">Remove</button>
      <button class="btn btn-primary" style="flex:1" onclick="closeModalDirect()">Close</button>
    </div>`);
}

function renderInventoryTable(products) {
  const el = document.getElementById('inventoryTable');
  if (!el) return;
  const isReadOnly = currentUser.role === 'viewer';
  const canDelete = ['admin','clerk'].includes(currentUser.role);
  const canEdit = ['admin','clerk'].includes(currentUser.role);
  const adminOnly = currentUser.role === 'admin';

  if (!products.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No products yet.</div></div>';
    return;
  }

  const chkCol = canDelete ? '<th style="width:36px"><input type="checkbox" id="selectAll" name="selectAll" onchange="toggleSelectAll(this)"></th>' : '';
  const actCol = canEdit ? '<th>Actions</th>' : '';
  const imgCol = '<th style="width:52px">Image</th>';

  let rows = products.map(p => {
    const qty = parseInt(p.qtyPcs || 0);
    const badge = qty === 0 ? '<span class="badge-out">Out</span>' : qty <= 5 ? '<span class="badge-low">Low</span>' : '<span class="badge-in-stock">In Stock</span>';
    const chk = canDelete ? `<td><input type="checkbox" class="row-select" name="row_select_${p.id}" value="${p.id}" onchange="updateBulkBar()"></td>` : '';
    const img = getProductImage(p.id);
    const thumb = img ? `<img src="${img}" class="prod-thumb" onclick="viewProductImage('${p.id}','${p.name}')">` : `<div class="prod-thumb-empty" onclick="openImageUpload('${p.id}','${p.name}')">+</div>`;
    const acts = canEdit ? `<td><div class="inv-btn-group">
      <button class="inv-btn inv-btn-edit" onclick="openEditProductModal('${p.id}')" title="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>
      <button class="inv-btn inv-btn-in" onclick="openStockModal('${p.id}','in')" title="Stock In"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> In</button>
      <button class="inv-btn inv-btn-out" onclick="openStockModal('${p.id}','out')" title="Stock Out"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="8 8 12 12 16 8"/><line x1="12" y1="12" x2="12" y2="3"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> Out</button>
      <button class="inv-btn inv-btn-del" onclick="deleteProduct('${p.id}')" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
    </div></td>` : '';
    return `<tr>${chk}
      <td>${thumb}</td>
      <td style="font-family:var(--font-mono);font-size:0.8rem">${p.barcode||'—'}</td>
      <td><b>${p.name}</b></td>
      <td>${p.qtyPcs||0}</td><td>${p.qtyPacks||0}</td>
      <td>₱${parseFloat(p.pricePer||0).toFixed(2)}</td>
      <td>₱${parseFloat(p.pricePack||0).toFixed(2)}</td>
      <td>${badge}</td>${acts}
    </tr>`;
  }).join('');

  el.innerHTML = `
    ${canDelete ? '<div class="bulk-action-bar" id="bulkActionBar" style="display:none"><span id="selectedCount">0 selected</span><button class="btn btn-danger btn-sm" onclick="bulkDeleteSelected()">Delete Selected</button><button class="btn btn-ghost btn-sm" onclick="clearSelection()">Clear</button></div>' : ''}
    <div class="tbl-wrap"><table>
      <thead><tr>${chkCol}${imgCol}<th>Barcode</th><th>Name</th><th>Qty Pcs</th><th>Qty Packs</th><th>Price/Pc</th><th>Price/Pack</th><th>Status</th>${actCol}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.row-select').forEach(c => c.checked = cb.checked);
  updateBulkBar();
}

function updateBulkBar() {
  const selected = document.querySelectorAll('.row-select:checked');
  const bar = document.getElementById('bulkActionBar');
  const count = document.getElementById('selectedCount');
  if (bar) bar.style.display = selected.length > 0 ? 'flex' : 'none';
  if (count) count.textContent = selected.length + ' selected';
  const selAll = document.getElementById('selectAll');
  const all = document.querySelectorAll('.row-select');
  if (selAll) selAll.checked = all.length > 0 && selected.length === all.length;
}

function clearSelection() {
  document.querySelectorAll('.row-select').forEach(c => c.checked = false);
  const selAll = document.getElementById('selectAll');
  if (selAll) selAll.checked = false;
  updateBulkBar();
}

async function bulkDeleteSelected() {
  const selected = [...document.querySelectorAll('.row-select:checked')].map(c => c.value);
  if (!selected.length) return;
  if (!confirm('Delete ' + selected.length + ' product(s)? Cannot be undone.')) return;
  toast('Deleting ' + selected.length + ' products...', 'info');
  let done = 0;
  for (const id of selected) {
    try { const res = await gasPost({ action: 'deleteProduct', id }); if (res.success) done++; } catch(e) {}
  }
  toast('Deleted ' + done + ' of ' + selected.length + ' products.', 'success');
  loadInventory();
}

function filterInventory(val) {
  const q = val.toLowerCase();
  const filtered = invProducts.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.barcode || '').toLowerCase().includes(q)
  );
  renderInventoryTable(filtered);
}

// ── PRODUCT BARCODES STATE ──
let productBarcodes = []; // up to 3 barcodes
let productPhotoData = null; // base64 photo
let productScannerActive = false;

function openAddProductModal() {
  productBarcodes = [];
  productPhotoData = null;
  productScannerActive = false;
  openModal(buildProductModal(null));
  setTimeout(() => initProductModalListeners(), 200);
}

function openEditProductModal(id) {
  const p = invProducts.find(x => x.id === id);
  if (!p) return;
  // Parse existing barcodes (comma separated)
  productBarcodes = (p.barcode || '').split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);
  productPhotoData = getProductImage(id) || null;
  productScannerActive = false;
  openModal(buildProductModal(p));
  setTimeout(() => initProductModalListeners(), 200);
}

function buildProductModal(p) {
  const isEdit = !!p;
  const existingPhoto = p ? getProductImage(p.id) : null;
  return `
    <div class="modal-title">${isEdit ? 'Edit Product' : 'Add New Product'}</div>

    <!-- PHOTO SECTION -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Product Photo</div>
      <div class="prod-photo-area">
        <div class="prod-photo-preview" id="prodPhotoPreview">
          ${existingPhoto
            ? `<img src="${existingPhoto}" id="prodPhotoImg" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`
            : `<div class="prod-photo-placeholder" id="prodPhotoPlaceholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>No photo</span>
              </div>`}
        </div>
        <div class="prod-photo-btns">
          <button class="inv-btn inv-btn-edit" onclick="openProductCamera()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Take Photo
          </button>
          <button class="inv-btn inv-btn-in" onclick="document.getElementById('prodPhotoFile').click()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </button>
          ${existingPhoto || productPhotoData ? `<button class="inv-btn inv-btn-del" onclick="removeProductPhoto()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>` : ''}
        </div>
        <input type="file" id="prodPhotoFile" accept="image/*" style="display:none" onchange="handleProductPhoto(this)">
      </div>
      <!-- Camera for photo -->
      <div id="prodPhotoCameraWrap" style="display:none;margin-top:10px">
        <video id="prodPhotoVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:200px;object-fit:cover;background:#000"></video>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="captureProductPhoto()">Capture</button>
          <button class="btn btn-ghost btn-sm" onclick="closeProductCamera()">Cancel</button>
        </div>
      </div>
    </div>

    <!-- BARCODES SECTION -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Barcodes <span style="color:var(--text3);font-weight:400">(up to 3)</span></div>
      <div id="barcodeList" class="barcode-list"></div>
      ${productBarcodes.length < 3 ? `
      <div class="barcode-add-row">
        <input type="text" id="barcodeManualInput" name="barcodeManualInput" placeholder="Type barcode + Enter or scan..."
          autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addBarcodeManual()}">
        <button class="inv-btn inv-btn-edit" onclick="openProductBarcodeScanner()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Scan
        </button>
        <button class="inv-btn inv-btn-in" onclick="addBarcodeManual()">Add</button>
      </div>` : `<p style="color:var(--text3);font-size:0.78rem">Maximum 3 barcodes reached.</p>`}
      <!-- Inline barcode scanner -->
      <div id="prodBarcodeScannerWrap" style="display:none;margin-top:10px">
        <video id="prodBarcodeVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:180px;object-fit:cover;background:#000"></video>
        <div class="camera-status" id="prodBarcodeScanStatus" style="color:var(--text2);background:var(--bg);border-radius:6px;margin-top:4px">Point at barcode...</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:6px;width:100%" onclick="closeProductBarcodeScanner()">Cancel</button>
      </div>
    </div>

    <!-- PRODUCT DETAILS -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Product Details</div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label for="f_name">Product Name *</label>
          <input id="f_name" value="${p?.name || ''}" placeholder="e.g. Coca-Cola 1.5L">
        </div>
      </div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label for="f_desc">Description</label>
          <input id="f_desc" value="${p?.description || ''}" placeholder="Optional description">
        </div>
      </div>
      <div class="input-row">
        <div class="field">
          <label for="f_variants">Variants</label>
          <input id="f_variants" value="${p?.variants || ''}" placeholder="e.g. Red, Blue, Large">
        </div>
        <div class="field">
          <label for="f_category">Category</label>
          <input id="f_category" value="${p?.category || ''}" placeholder="e.g. Beverages">
        </div>
      </div>
    </div>

    <!-- STOCK & PRICE -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Stock & Pricing</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label for="f_qtyPcs">Qty (Pcs)</label>
          <input id="f_qtyPcs" type="number" min="0" value="${p?.qtyPcs || 0}">
        </div>
        <div class="field">
          <label for="f_qtyPacks">Qty (Packs)</label>
          <input id="f_qtyPacks" type="number" min="0" value="${p?.qtyPacks || 0}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label for="f_pricePer">Price per Piece (₱)</label>
          <input id="f_pricePer" type="number" min="0" step="0.01" value="${p?.pricePer || 0}" placeholder="0.00">
        </div>
        <div class="field">
          <label for="f_pricePack">Price per Pack (₱)</label>
          <input id="f_pricePack" type="number" min="0" step="0.01" value="${p?.pricePack || 0}" placeholder="0.00">
        </div>
      </div>
    </div>

    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveProduct(${p ? "'"+p.id+"'" : ''})">
      ${isEdit ? 'Update Product' : 'Save Product'}
    </button>`;
}

function initProductModalListeners() {
  renderBarcodeList();
  if (productPhotoData) {
    const img = document.getElementById('prodPhotoImg');
    if (!img) {
      const preview = document.getElementById('prodPhotoPreview');
      if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    }
  }
}

function renderBarcodeList() {
  const el = document.getElementById('barcodeList');
  if (!el) return;
  if (!productBarcodes.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:0.78rem;margin-bottom:6px">No barcodes added yet.</p>';
    return;
  }
  el.innerHTML = productBarcodes.map((b, i) => `
    <div class="barcode-pill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="2" height="16"/><rect x="5" y="4" width="1" height="16"/><rect x="8" y="4" width="2" height="16"/><rect x="12" y="4" width="1" height="16"/><rect x="15" y="4" width="2" height="16"/><rect x="19" y="4" width="1" height="16"/><rect x="22" y="4" width="1" height="16"/></svg>
      <span style="font-family:var(--font-mono);font-size:0.82rem">${b}</span>
      <span style="font-size:0.7rem;color:var(--text3)">BC${i+1}</span>
      <button onclick="removeBarcode(${i})" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:0.85rem;padding:0 2px">✕</button>
    </div>`).join('');
}

function addBarcodeManual() {
  const input = document.getElementById('barcodeManualInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) { toast('Enter a barcode value.', 'warning'); return; }
  addBarcodeToList(val);
  input.value = '';
  input.focus();
}

function addBarcodeToList(val) {
  if (productBarcodes.length >= 3) { toast('Maximum 3 barcodes only.', 'warning'); return; }
  if (productBarcodes.includes(val)) { toast('Barcode already added.', 'warning'); return; }
  productBarcodes.push(val);
  renderBarcodeList();
  toast('Barcode added: ' + val, 'success');
  // Hide scanner if open
  closeProductBarcodeScanner();
}

function removeBarcode(idx) {
  productBarcodes.splice(idx, 1);
  renderBarcodeList();
}

// ── PRODUCT BARCODE SCANNER (inline) ──
let prodBarcodeStream = null;
let prodBarcodeScanId = null;
let prodBarcodeScanning = false;

async function openProductBarcodeScanner() {
  const wrap = document.getElementById('prodBarcodeScannerWrap');
  const video = document.getElementById('prodBarcodeVideo');
  const status = document.getElementById('prodBarcodeScanStatus');
  if (!wrap || !video) return;
  wrap.style.display = 'block';
  prodBarcodeScanning = true;

  try {
    prodBarcodeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = prodBarcodeStream;
    await video.play();
    if (status) status.textContent = 'Point at barcode...';

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
      const prodDetect = async () => {
        if (!prodBarcodeScanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            const val = codes[0].rawValue.trim();
            if (status) status.textContent = 'Found: ' + val;
            addBarcodeToList(val);
            return;
          }
        } catch(e) {}
        prodBarcodeScanId = requestAnimationFrame(prodDetect);
      };
      prodDetect();
    } else {
      if (typeof ZXing === 'undefined' && typeof jsQR === 'undefined') {
        await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const prodScan = () => {
        if (!prodBarcodeScanning) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          if (typeof jsQR !== 'undefined') {
            const code = jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height);
            if (code && code.data) {
              if (status) status.textContent = 'Found: ' + code.data;
              addBarcodeToList(code.data.trim());
              return;
            }
          }
        }
        prodBarcodeScanId = requestAnimationFrame(prodScan);
      };
      prodScan();
    }
  } catch(e) {
    if (status) status.textContent = e.name === 'NotAllowedError' ? 'Camera denied.' : 'Camera error.';
  }
}

function closeProductBarcodeScanner() {
  prodBarcodeScanning = false;
  if (prodBarcodeScanId) { cancelAnimationFrame(prodBarcodeScanId); prodBarcodeScanId = null; }
  if (prodBarcodeStream) { prodBarcodeStream.getTracks().forEach(t => t.stop()); prodBarcodeStream = null; }
  const wrap = document.getElementById('prodBarcodeScannerWrap');
  const video = document.getElementById('prodBarcodeVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}

// ── PRODUCT PHOTO CAMERA ──
let prodPhotoStream = null;

async function openProductCamera() {
  const wrap = document.getElementById('prodPhotoCameraWrap');
  const video = document.getElementById('prodPhotoVideo');
  if (!wrap || !video) return;
  wrap.style.display = 'block';
  try {
    prodPhotoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = prodPhotoStream;
    await video.play();
  } catch(e) {
    toast(e.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera error.', 'error');
    wrap.style.display = 'none';
  }
}

function captureProductPhoto() {
  const video = document.getElementById('prodPhotoVideo');
  if (!video) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // Resize to max 400px
  const MAX = 400;
  const resizeCanvas = document.createElement('canvas');
  let w = canvas.width, h = canvas.height;
  if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
  else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
  resizeCanvas.width = w; resizeCanvas.height = h;
  resizeCanvas.getContext('2d').drawImage(canvas, 0, 0, w, h);
  productPhotoData = resizeCanvas.toDataURL('image/jpeg', 0.8);
  // Update preview
  const preview = document.getElementById('prodPhotoPreview');
  if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  closeProductCamera();
  toast('Photo captured!', 'success');
}

function closeProductCamera() {
  if (prodPhotoStream) { prodPhotoStream.getTracks().forEach(t => t.stop()); prodPhotoStream = null; }
  const wrap = document.getElementById('prodPhotoCameraWrap');
  const video = document.getElementById('prodPhotoVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}

function handleProductPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image too large! Max 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const MAX = 400;
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      productPhotoData = canvas.toDataURL('image/jpeg', 0.8);
      const preview = document.getElementById('prodPhotoPreview');
      if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
      toast('Photo uploaded!', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeProductPhoto() {
  productPhotoData = null;
  const preview = document.getElementById('prodPhotoPreview');
  if (preview) preview.innerHTML = `<div class="prod-photo-placeholder" id="prodPhotoPlaceholder">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    <span>No photo</span>
  </div>`;
}

async function saveProduct(id = null) {
  const name = document.getElementById('f_name')?.value.trim();
  if (!name) { toast('Product name is required.', 'error'); return; }
  if (!productBarcodes.length) {
    if (!confirm('No barcode added. Save product without barcode?')) return;
  }
  // Stop any open cameras
  closeProductCamera();
  closeProductBarcodeScanner();

  const payload = {
    action: id ? 'updateProduct' : 'addProduct',
    id, name,
    barcode: productBarcodes.join(','),
    description: document.getElementById('f_desc')?.value.trim() || '',
    variants: document.getElementById('f_variants')?.value.trim() || '',
    category: document.getElementById('f_category')?.value.trim() || '',
    qtyPcs: parseInt(document.getElementById('f_qtyPcs')?.value || 0),
    qtyPacks: parseInt(document.getElementById('f_qtyPacks')?.value || 0),
    pricePer: parseFloat(document.getElementById('f_pricePer')?.value || 0),
    pricePack: parseFloat(document.getElementById('f_pricePack')?.value || 0),
  };

  showLoading(id ? 'Updating product...' : 'Saving product...');
  try {
    const res = await gasPost(payload);
    hideLoading();
    if (res.success) {
      const productId = id || res.id;
      if (productPhotoData && productId) {
        saveProductImage(productId, productPhotoData);
      } else if (!productPhotoData && productId && id) {
        deleteProductImage(productId);
      }
      toast(id ? 'Product updated!' : 'Product added!', 'success');
      closeModalDirect();
      loadInventory();
    } else {
      toast(res.message || 'Error saving product.', 'error');
    }
  } catch(e) { hideLoading(); toast('Network error.', 'error'); }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteProduct', id });
 if (res.success) { toast('Product deleted.', 'success'); loadInventory(); }
 else toast(res.message || 'Error deleting.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

function openStockModal(id, direction) {
  const p = invProducts.find(x => x.id === id);
  if (!p) return;
  openModal(`
<div class="modal-title">${direction === 'in' ? ' Stock In' : ' Stock Out'} — ${p.name}</div>
<div class="input-row">
 <div class="field"><label for="stockQty">Quantity</label><input id="stockQty" name="stockQty" type="number" min="1" value="1" placeholder="Enter qty"></div>
 <div class="field"><label for="stockUnit">Unit</label>
        <select id="stockUnit" name="stockUnit">
          <option value="pcs">Pieces (pcs)</option>
          <option value="packs">Packs</option>
        </select>
      </div>
    </div>
 <div class="field"><label for="stockNote">Notes / Reason</label><input id="stockNote" name="stockNote" placeholder="Optional notes"></div>
<button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveStock('${id}','${direction}')">Save</button>`);
}

async function saveStock(id, direction) {
  const qty = parseInt(document.getElementById('stockQty')?.value || 0);
  const unit = document.getElementById('stockUnit')?.value;
  const note = document.getElementById('stockNote')?.value.trim();
 if (!qty || qty< 1) { toast('Enter a valid quantity.', 'error'); return; }
  try {
    const res = await gasPost({
      action: 'stockAdjust', id, direction, qty, unit, note,
      adjustedBy: currentUser.name, date: new Date().toISOString()
    });
 if (res.success) { toast(`Stock ${direction} saved!`, 'success'); closeModalDirect(); loadInventory(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ── RECEIPT SETTINGS ─────────────────────────
function getReceiptSettings() {
  const defaults = {
    storeName: 'AE HOME',
    ownedBy: 'AE Home Trade Corp.',
    vatTin: '010-948-69500000',
    address: 'Alcantara Street, Brgy VIII, City of Vigan',
    footer: 'This serves as Sales Invoice for Inventory Only'
  };
  try {
    const saved = lsGet('ae_receipt_settings', {});
    return { ...defaults, ...saved };
  } catch(e) { return defaults; }
}

function saveReceiptSettings() {
  const s = {
    storeName: document.getElementById('rs_storeName')?.value.trim() || 'AE HOME',
    ownedBy: document.getElementById('rs_ownedBy')?.value.trim() || '',
    vatTin: document.getElementById('rs_vatTin')?.value.trim() || '',
    address: document.getElementById('rs_address')?.value.trim() || '',
    footer: document.getElementById('rs_footer')?.value.trim() || '',
  };
  lsSet('ae_receipt_settings', s);
 toast('Receipt settings saved!', 'success');
  closeModalDirect();
}

function openReceiptSettings() {
  const s = getReceiptSettings();
  openModal(`
<div class="modal-title">Receipt / Company Settings</div>
    <p style="color:var(--text3);font-size:0.82rem;margin-bottom:16px">These details will appear on every receipt.</p>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_storeName">Store Name</label>
 <input id="rs_storeName" value="${s.storeName}" placeholder="AE HOME"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_ownedBy">Owned By</label>
 <input id="rs_ownedBy" value="${s.ownedBy}" placeholder="AE Home Trade Corp."></div>
    </div>
<div class="input-row">
 <div class="field"><label for="rs_vatTin">VAT Reg TIN</label>
 <input id="rs_vatTin" value="${s.vatTin}" placeholder="000-000-000-000"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_address">Address</label>
 <input id="rs_address" value="${s.address}" placeholder="Street, Barangay, City"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_footer">Receipt Footer Note</label>
 <input id="rs_footer" value="${s.footer}" placeholder="e.g. This serves as Sales Invoice..."></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
<button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
<button class="btn btn-primary" style="flex:2" onclick="saveReceiptSettings()">Save Settings</button>
    </div>`);
}

// Store parsed rows globally for import confirmation
let pendingImportRows = [];

function openImportModal() {
  pendingImportRows = [];
  openModal(`
<div class="modal-title">Import Products from CSV/Excel</div>
    <p style="color:var(--text2);font-size:0.88rem;margin-bottom:12px">
      Required column: <b>name</b>. Optional: barcode, qtyPcs, qtyPacks, pricePer, pricePack.<br>
      <span style="color:var(--text3);font-size:0.8rem">Tip: Use comma-separated CSV or Excel (.xlsx/.xls)</span>
    </p>
<div class="import-area" id="importArea" onclick="document.getElementById('importFile').click()">
 <div class="import-icon"></div>
<div class="import-text">Click to select file</div>
<div class="import-sub">.csv, .xlsx, .xls accepted</div>
    </div>
    <input type="file" id="importFile" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleImportFile(this)">
    <div id="importPreview" style="margin-top:16px"></div>`);
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Show parsing indicator
  const preview = document.getElementById('importPreview');
 if (preview) preview.innerHTML = `
    <div style="text-align:center;padding:20px;color:var(--text2)">
 <div class="spinner" style="margin:0 auto 10px"></div>
      <div>Reading file: <b>${file.name}</b>...</div>
    </div>`;

  const importArea = document.getElementById('importArea');
  if (importArea) importArea.style.opacity = '0.5';

  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'csv') {
      const text = await file.text();
      processImportCSV(text, file.name);
    } else {
      if (typeof XLSX === 'undefined') {
 if (preview) preview.innerHTML += '<div style="text-align:center;color:var(--text3);font-size:0.8rem">Loading Excel parser...</div>';
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(ws);
      processImportCSV(csv, file.name);
    }
  } catch(e) {
 if (preview) preview.innerHTML = `<div class="no-data"><div class="no-data-icon"></div><div>Failed to read file. Make sure it's a valid CSV or Excel file.</div></div>`;
    if (importArea) importArea.style.opacity = '1';
  }
}

function processImportCSV(csvText, filename) {
  const preview = document.getElementById('importPreview');
  const importArea = document.getElementById('importArea');
  if (importArea) importArea.style.opacity = '1';

  const lines = csvText.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) {
 if (preview) preview.innerHTML = '<div class="no-data"><div class="no-data-icon">️</div><div>File is empty or has no data rows.</div></div>';
 toast('File has no data rows!', 'error');
    return;
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, '').replace(/\r/g, '').replace(/\s+/g, ''));
  const rows = lines.slice(1).map(line => {
    // Handle quoted values with commas inside
    const vals = [];
    let cur = '', inQuote = false;
    for (let ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim().replace(/\r/g, ''));
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] || '').replace(/"/g, ''));
    return obj;
  }).filter(r => r.name && r.name.trim());

  if (!rows.length) {
 if (preview) preview.innerHTML = '<div class="no-data"><div class="no-data-icon">️</div><div>No valid products found. Make sure you have a "name" column.</div></div>';
 toast('No valid products found in file!', 'error');
    return;
  }

  // Validate rows — check for issues
  const issues = [];
  rows.forEach((r, i) => {
    if (!r.name.trim()) issues.push(`Row ${i+2}: Missing name`);
    const price = parseFloat(r.priceper || r.pricePer || 0);
    if (isNaN(price)) issues.push(`Row ${i+2}: Invalid price`);
  });

  // Store globally
  pendingImportRows = rows;

  if (!preview) return;
 preview.innerHTML = `
    <div style="background:var(--bg2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:700;font-size:0.9rem">📄 ${filename}</span>
        <span style="background:var(--green);color:white;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:700">${rows.length} products found</span>
      </div>
      ${issues.length ? `<div style="color:#f59e0b;font-size:0.78rem;margin-top:4px">⚠️ ${issues.length} row(s) may have issues — will still be imported if name is present.</div>` : '<div style="color:var(--green);font-size:0.78rem">✅ All rows look valid!</div>'}
    </div>

    <div style="font-size:0.82rem;font-weight:700;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Preview (first 10 rows)</div>
<div class="tbl-wrap" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:10px">
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Barcode</th><th>Qty Pcs</th><th>Qty Packs</th><th>Price/Pc</th><th>Price/Pack</th></tr></thead>
        <tbody>
          ${rows.slice(0, 10).map((r, i) => `<tr>
            <td class="text-muted">${i+1}</td>
            <td><b>${r.name}</b></td>
            <td>${r.barcode || '—'}</td>
            <td>${r.qtypcs || r.qtyPcs || r['qty(pcs)'] || 0}</td>
            <td>${r.qtypacks || r.qtyPacks || r['qty(packs)'] || 0}</td>
            <td>₱${parseFloat(r.priceper || r.pricePer || r['price/pc'] || 0).toFixed(2)}</td>
            <td>₱${parseFloat(r.pricepack || r.pricePack || r['price/pack'] || 0).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${rows.length > 10 ? `<p style="color:var(--text3);font-size:0.78rem;margin-top:6px;text-align:center">...and <b>${rows.length - 10}</b> more rows</p>` : ''}

    <div style="display:flex;gap:10px;margin-top:14px">
<button class="btn btn-ghost" style="flex:1" onclick="openImportModal()">↩ Choose Different File</button>
<button class="btn btn-primary" style="flex:2" id="confirmImportBtn" onclick="confirmImport()">
        ✅ Confirm & Import ${rows.length} Products
      </button>
    </div>`;
}

// Special bulk import via GET — splits product data into URL-safe chunks
async function gasBulkImport(batch) {
  // Normalize column name variants from Excel/CSV headers
  const products = batch.map(p => ({
    name:      String(p.name      || p.Name      || p.NAME      || '').trim(),
    barcode:   String(p.barcode   || p.Barcode   || p.BARCODE   || p['Barcode']    || '').trim(),
    qtyPcs:    String(p.qtypcs    || p.qtyPcs    || p['qty(pcs)']   || p['Qty Pcs']   || p['QTY PCS']   || '0'),
    qtyPacks:  String(p.qtypacks  || p.qtyPacks  || p['qty(packs)'] || p['Qty Packs'] || p['QTY PACKS'] || '0'),
    pricePer:  String(p.priceper  || p.pricePer  || p['price/pc']   || p['Price/Pc']  || p['PRICE/PC']  || '0'),
    pricePack: String(p.pricepack || p.pricePack || p['price/pack'] || p['Price/Pack']|| p['PRICE/PACK']|| '0'),
  })).filter(p => p.name);

  // Use GET + base64 payload (same as gasPost) — avoids CORS block
  const payload = { action: 'bulkAddProducts', products: JSON.stringify(products) };
  const json    = JSON.stringify(payload);
  let encoded;
  try {
    encoded = btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    const bytes  = new TextEncoder().encode(json);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    encoded = btoa(binary);
  }
  const url   = GAS_URL + '?data=' + encodeURIComponent(encoded);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!text || !text.trim()) return { success: true, count: products.length };
    try { return JSON.parse(text); }
    catch(e) { return { success: true, count: products.length }; }
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Import timed out. Try a smaller batch.');
    throw new Error('Import error: ' + e.message);
  }
}

async function confirmImport() {
  const rows = pendingImportRows;
 if (!rows || !rows.length) { toast('No data to import.', 'warning'); return; }

 const btn = document.getElementById('confirmImportBtn');
  if (btn) {
    btn.disabled = true;
 btn.innerHTML = '<div class="spinner" style="display:inline-block;width:16px;height:16px;margin-right:8px;vertical-align:middle"></div> Starting import...';
  }

  // Show status element
  const preview = document.getElementById('importPreview');
  let statusEl = document.getElementById('importStatus');
  if (!statusEl && preview) {
    statusEl = document.createElement('div');
    statusEl.id = 'importStatus';
    statusEl.style.cssText = 'margin-top:12px;padding:14px;background:var(--bg2);border-radius:10px;font-size:0.85rem;text-align:center;color:var(--text2)';
    preview.appendChild(statusEl);
  }

  // ── BATCH IMPORT (15 per batch — URL-safe size) ──
  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  let totalImported = 0;
  let failed = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchNum = b + 1;
    const progress = Math.round((b / batches.length) * 100);

    // Update status
    if (statusEl) {
 statusEl.innerHTML = `
 <div class="spinner" style="margin:0 auto 10px"></div>
        <div style="font-weight:600;margin-bottom:6px">Importing batch ${batchNum} of ${batches.length}...</div>
        <div style="background:var(--border);border-radius:20px;height:8px;overflow:hidden;margin:8px 0">
          <div style="background:var(--grad);height:100%;width:${progress}%;border-radius:20px;transition:width 0.3s"></div>
        </div>
        <div style="font-size:0.78rem;color:var(--text3)">${totalImported} of ${rows.length} products saved so far...</div>`;
    }
 if (btn) btn.innerHTML = `⏳ ${progress}% (${batchNum}/${batches.length} batches)`;

    try {
      const res = await gasBulkImport(batch);
      if (res.success) {
        totalImported += res.count || batch.length;
      } else {
        failed += batch.length;
        console.warn('Batch ' + batchNum + ' failed:', res.message);
      }
    } catch(e) {
      // Retry once after 2s
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res2 = await gasBulkImport(batch);
        if (res2.success) totalImported += res2.count || batch.length;
        else failed += batch.length;
      } catch(e2) {
        failed += batch.length;
        console.warn('Batch ' + batchNum + ' retry also failed:', e2.message);
      }
    }

    // Small pause between batches to avoid GAS rate limit
    if (b < batches.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  // ── FINAL RESULT ─────────────────────────────
  if (failed === 0) {
 if (statusEl) statusEl.innerHTML = `<div style="color:var(--green);font-size:1rem;font-weight:700">All ${totalImported} products imported successfully!</div>`;
 toast(` Imported ${totalImported} products!`, 'success');
    pendingImportRows = [];
    setTimeout(() => { closeModalDirect(); loadInventory(); }, 1500);
  } else if (totalImported > 0) {
 if (statusEl) statusEl.innerHTML = `<div style="color:#f59e0b;font-weight:700">️ Imported ${totalImported} products. ${failed} failed — try importing the rest again.</div>`;
 toast(`Partial import: ${totalImported} saved, ${failed} failed.`, 'warning');
 if (btn) { btn.disabled = false; btn.innerHTML = ' Retry Failed'; }
  } else {
 if (statusEl) statusEl.innerHTML = '<div style="color:#ef4444;font-weight:700">Import failed. Check your connection and try again.</div>';
 toast('Import failed. Try again.', 'error');
 if (btn) { btn.disabled = false; btn.innerHTML = ' Retry Import'; }
  }
}

// ═══════════════════════════════════════════════
// FINANCE
// ═══════════════════════════════════════════════
async function renderFinance() {
 document.getElementById('pageContent').innerHTML = `
<div class="finance-tabs">
      <button class="finance-tab active" onclick="switchFinanceTab('expenses',this)">💸 Expenses</button>
      <button class="finance-tab" onclick="switchFinanceTab('allowance',this)">💰 Allowance</button>
    </div>
    <div id="financeContent"></div>`;
  loadExpenses();
}

function switchFinanceTab(tab, btn) {
  document.querySelectorAll('.finance-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'expenses') loadExpenses();
  else loadAllowance();
}

async function loadExpenses() {
  const el = document.getElementById('financeContent');
 el.innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Add Expense</div>
<div class="input-row">
 <div class="field"><label for="exp_desc">Description</label><input id="exp_desc" name="exp_desc" placeholder="Expense description"></div>
 <div class="field"><label for="exp_amount">Amount (₱)</label><input id="exp_amount" name="exp_amount" type="number" min="0" step="0.01" placeholder="0.00"></div>
 <div class="field"><label for="exp_date">Date</label><input id="exp_date" name="exp_date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
<button class="btn btn-primary" onclick="saveExpense()">Add Expense</button>
    </div>
<div class="card">
<div class="card-title">Expense Records</div>
 <div id="expenseList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  try {
    const res = await gasRequest({ action: 'getExpenses' });
    const data = res.data || [];
    const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const el2 = document.getElementById('expenseList');
    if (!el2) return;
 if (!data.length) { el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No expenses recorded.</div></div>'; return; }
 el2.innerHTML = `
      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">Total Expenses</span>
        <span style="font-family:var(--font-head);font-size:1.2rem;font-weight:800;color:#ef4444">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
      </div>
 <div class="tbl-wrap"><table>
        <thead><tr><th>Description</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${data.map(e => `<tr>
          <td>${e.description}</td>
          <td class="text-red fw-700">₱${parseFloat(e.amount||0).toFixed(2)}</td>
          <td class="text-muted">${safeFormatDateOnly(e.date)}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">️</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
 } catch(e) { const el3 = document.getElementById('expenseList'); if (el3) el3.innerHTML = '<div class="no-data">Failed to load expenses.</div>'; }
}

async function saveExpense() {
  const desc = document.getElementById('exp_desc')?.value.trim();
  const amount = parseFloat(document.getElementById('exp_amount')?.value || 0);
  const date = document.getElementById('exp_date')?.value;
 if (!desc || !amount) { toast('Fill in description and amount.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'addExpense', description: desc, amount, date, addedBy: currentUser.name });
 if (res.success) { toast('Expense saved!', 'success'); loadExpenses(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    const res = await gasPost({ action: 'deleteExpense', id });
 if (res.success) { toast('Deleted.', 'success'); loadExpenses(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function loadAllowance() {
  const el = document.getElementById('financeContent');
 el.innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Add Allowance Record</div>
<div class="input-row">
 <div class="field"><label for="alw_for">For</label><input id="alw_for" name="alw_for" placeholder="Person / purpose"></div>
 <div class="field"><label for="alw_amount">Amount (₱)</label><input id="alw_amount" name="alw_amount" type="number" min="0" step="0.01"></div>
 <div class="field"><label for="alw_date">Date</label><input id="alw_date" name="alw_date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
<button class="btn btn-primary" onclick="saveAllowance()">Save</button>
    </div>
<div class="card">
<div class="card-title">Allowance Records</div>
 <div id="allowanceList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  try {
    const res = await gasRequest({ action: 'getAllowances' });
    const data = res.data || [];
    const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const el2 = document.getElementById('allowanceList');
    if (!el2) return;
 if (!data.length) { el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No allowance records.</div></div>'; return; }
 el2.innerHTML = `
      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">Total Allowance</span>
        <span style="font-family:var(--font-head);font-size:1.2rem;font-weight:800;color:var(--green)">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
      </div>
 <div class="tbl-wrap"><table>
        <thead><tr><th>For</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${data.map(e => `<tr>
          <td>${e.forPerson || e.for || ''}</td>
          <td class="text-green fw-700">₱${parseFloat(e.amount||0).toFixed(2)}</td>
          <td class="text-muted">${safeFormatDateOnly(e.date)}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteAllowance('${e.id}')">️</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
 } catch(e) { const el3 = document.getElementById('allowanceList'); if (el3) el3.innerHTML = '<div class="no-data">Failed to load.</div>'; }
}

async function saveAllowance() {
  const forP = document.getElementById('alw_for')?.value.trim();
  const amount = parseFloat(document.getElementById('alw_amount')?.value || 0);
  const date = document.getElementById('alw_date')?.value;
 if (!forP || !amount) { toast('Fill all fields.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'addAllowance', forPerson: forP, amount, date, addedBy: currentUser.name });
 if (res.success) { toast('Saved!', 'success'); loadAllowance(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteAllowance(id) {
  if (!confirm('Delete this record?')) return;
  try {
    const res = await gasPost({ action: 'deleteAllowance', id });
 if (res.success) { toast('Deleted.', 'success'); loadAllowance(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ═══════════════════════════════════════════════
// CASHIERS
// ═══════════════════════════════════════════════
async function renderCashiers() {
 document.getElementById('pageContent').innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Manage System Users</div>
<button class="btn btn-primary" onclick="openAddCashierModal()">Add User</button>
    </div>
<div class="card">
 <div id="cashierList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  loadCashiers();
}

async function loadCashiers() {
  try {
    const res = await gasRequest({ action: 'getCashiers' });
    const data = res.data || [];
    const el = document.getElementById('cashierList');
    if (!el) return;
 if (!data.length) { el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No users yet. Add your first cashier!</div></div>'; return; }
 el.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.map(c => `<tr>
        <td><b>${c.name}</b></td>
        <td><span style="font-family:var(--font-mono);font-size:0.85rem">${c.username}</span></td>
        <td><span class="role-badge role-${c.role}">${c.role}</span></td>
        <td><span class="${c.active !== 'false' ? 'badge-in-stock' : 'badge-out'}">${c.active !== 'false' ? 'Active' : 'Inactive'}</span></td>
        <td>
<div class="gap-10">
<button class="btn btn-ghost btn-sm" onclick="openEditCashierModal('${c.id}')">️ Edit</button>
<button class="btn btn-danger btn-sm" onclick="deleteCashier('${c.id}')">️</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) {
    const el2 = document.getElementById('cashierList'); if (el2) el2.innerHTML = '<div class="no-data">Failed to load users.</div>';
  }
}

function openAddCashierModal() {
  openModal(`
<div class="modal-title">Add New User</div>
<div class="input-row">
 <div class="field"><label for="c_name">Full Name *</label><input id="c_name" placeholder="Full name"></div>
 <div class="field"><label for="c_username">Username *</label><input id="c_username" placeholder="Login username"></div>
    </div>
<div class="input-row">
 <div class="field"><label for="c_password">Password *</label><input id="c_password" type="password" placeholder="Password"></div>
 <div class="field"><label for="c_role">Role *</label>
        <select id="c_role" name="c_role">
          <option value="cashier">Cashier</option>
          <option value="clerk">Inventory Clerk</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </div>
<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveCashier()">Save User</button>`);
}

function openEditCashierModal(id) {
  gasRequest({ action: 'getCashiers' }).then(res => {
    const c = (res.data || []).find(x => x.id === id);
    if (!c) return;
    openModal(`
<div class="modal-title">️ Edit User — ${c.name}</div>
<div class="input-row">
 <div class="field"><label for="c_name">Full Name</label><input id="c_name" name="c_name" value="${c.name}"></div>
 <div class="field"><label for="c_username">Username</label><input id="c_username" name="c_username" value="${c.username}"></div>
      </div>
<div class="input-row">
 <div class="field"><label for="c_password">New Password (leave blank to keep)</label><input id="c_password" name="c_password" type="password" placeholder="New password"></div>
 <div class="field"><label for="c_role">Role</label>
          <select id="c_role">
            <option value="cashier" ${c.role==='cashier'?'selected':''}>Cashier</option>
            <option value="clerk" ${c.role==='clerk'?'selected':''}>Inventory Clerk</option>
            <option value="admin" ${c.role==='admin'?'selected':''}>Admin</option>
          </select>
        </div>
      </div>
<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveCashier('${id}')">Update User</button>`);
  });
}

async function saveCashier(id = null) {
  const name = document.getElementById('c_name')?.value.trim();
  const username = document.getElementById('c_username')?.value.trim();
  const password = document.getElementById('c_password')?.value.trim();
  const role = document.getElementById('c_role')?.value;
 if (!name || !username) { toast('Name and username are required.', 'error'); return; }
 if (!id && !password) { toast('Password is required for new users.', 'error'); return; }
  try {
    const res = await gasPost({ action: id ? 'updateCashier' : 'addCashier', id, name, username, password, role });
 if (res.success) { toast(id ? 'User updated!' : 'User added!', 'success'); closeModalDirect(); loadCashiers(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteCashier(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteCashier', id });
 if (res.success) { toast('User deleted.', 'success'); loadCashiers(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ═══════════════════════════════════════════════
// RECEIPTS
// ═══════════════════════════════════════════════
async function renderReceipts() {
  document.getElementById('pageContent').innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn active" onclick="showLocalReceipts(this)">This Device</button>
      <button class="tab-btn" onclick="showGASReceipts(this)">All Receipts (Sheets)</button>
    </div>
    <div id="receiptsContent"><div class="loading-spinner"><div class="spinner"></div></div></div>`;
  showLocalReceipts(document.querySelector('.tab-btn'));
}

function showLocalReceipts(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  let gallery = [], fullData = {};
  try { gallery = lsGet('ae_receipt_gallery', []); } catch(e) {}
  try { fullData = lsGet('ae_receipt_full', {}); } catch(e) {}
  const el = document.getElementById('receiptsContent');
  if (!el) return;
  if (!gallery.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No receipts on this device yet.</div></div>';
    return;
  }
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Receipts — This Device</div>
      <p style="color:var(--text3);font-size:0.82rem;margin-bottom:14px">Click View to reprint any receipt.</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>SI #</th><th>TX #</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>${gallery.map(r => {
          const hasFullData = !!fullData[r.txId];
          return `<tr>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${r.siNum||'—'}</td>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${r.txId}</td>
            <td>${r.cashier}</td>
            <td class="text-green fw-700">₱${parseFloat(r.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
            <td style="font-size:0.78rem">${safeFormatDateTime(r.date)}</td>
            <td>${hasFullData
              ? `<button class="btn btn-primary btn-sm" onclick="reprintReceipt('${r.txId}')">View / Print</button>`
              : `<span style="color:var(--text3);font-size:0.78rem">No data</span>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}

async function showGASReceipts(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('receiptsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading from Google Sheets...</div>';
  try {
    const res = await gasRequest({ action: 'getSales' });
    const sales = (res.data || []).reverse();
    if (!sales.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No sales records yet.</div></div>';
      return;
    }
    const fullData = lsGet('ae_receipt_full', {});
    el.innerHTML = `
      <div class="card">
        <div class="card-title">All Receipts — Google Sheets (${sales.length} total)</div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>SI #</th><th>TX #</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>${sales.map(s => {
            const hasLocal = !!fullData[s.transactionId];
            return `<tr>
              <td style="font-family:var(--font-mono);font-size:0.78rem">${s.siNumber||'—'}</td>
              <td style="font-family:var(--font-mono);font-size:0.78rem">${s.transactionId||''}</td>
              <td>${s.cashierName||''}</td>
              <td class="text-green fw-700">₱${parseFloat(s.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
              <td style="font-size:0.78rem">${safeFormatDateTime(s.date)}</td>
              <td>${hasLocal
                ? `<button class="btn btn-primary btn-sm" onclick="reprintReceipt('${s.transactionId}')">View / Print</button>`
                : `<button class="btn btn-ghost btn-sm" onclick="reprintFromSheets('${s.transactionId}')">Reprint</button>`}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
  } catch(e) {
    el.innerHTML = '<div class="no-data">Failed to load. Check connection.</div>';
  }
}

function reprintReceipt(txId) {
  const fullData = lsGet('ae_receipt_full', {});
  const data = fullData[txId];
  if (!data) { toast('Receipt data not available on this device.', 'warning'); return; }
  const reprintDate = parseDate(data.date) || new Date();
  generateAndShowReceipt({
    txId: data.txId, siNum: data.siNum, cashier: data.cashier,
    date: reprintDate, items: data.items,
    total: data.total, cash: data.cash, change: data.change
  });
}

async function reprintFromSheets(txId) {
  toast('Loading receipt from Sheets...', 'info');
  try {
    const res = await gasRequest({ action: 'getSales' });
    const sale = (res.data || []).find(s => s.transactionId === txId);
    if (!sale) { toast('Receipt not found.', 'error'); return; }
    const items = JSON.parse(sale.items || '[]');
    // Use parseDate() with TX fallback — safe against corrupted date values
    const saleDate = parseDate(sale.date, sale.transactionId || sale.siNumber) || new Date();
    generateAndShowReceipt({
      txId: sale.transactionId, siNum: sale.siNumber || '',
      cashier: sale.cashierName, date: saleDate,
      items, total: parseFloat(sale.total||0),
      cash: parseFloat(sale.cash||0), change: parseFloat(sale.change||0)
    });
  } catch(e) { toast('Failed to load receipt.', 'error'); }
}

// ═══════════════════════════════════════════════
// SALES SUMMARY
// ═══════════════════════════════════════════════
async function renderSummary() {
  document.getElementById('pageContent').innerHTML = `
    <div class="tab-bar" id="summaryTabBar">
      <button class="tab-btn active" id="sumTab_today"  onclick="loadSummary('today',this)">Today</button>
      <button class="tab-btn"        id="sumTab_week"   onclick="loadSummary('week',this)">This Week</button>
      <button class="tab-btn"        id="sumTab_month"  onclick="loadSummary('month',this)">This Month</button>
      <button class="tab-btn"        id="sumTab_all"    onclick="loadSummary('all',this)">All Time</button>
    </div>
    <div id="summaryContent"><div class="loading-spinner"><div class="spinner"></div></div></div>`;
  // Use the specific element ID to avoid querySelector finding wrong tab-btn
  loadSummary('today', document.getElementById('sumTab_today'));
}

async function loadSummary(period, btn) {
  const _stb = document.getElementById('summaryTabBar');
  if (_stb) _stb.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('summaryContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await gasRequest({ action: 'getSales' });
    const all = res.data || [];
    const now = new Date();

    const { start: todayStart, end: todayEnd } = dayRange(now);
    const weekAgo2  = new Date(now - 7  * 86400000);
    const monthAgo2 = new Date(now - 30 * 86400000);
    const periodFilters = {
      today: s => {
        const d = parseDate(s.date, s.transactionId || s.siNumber);
        return d && d >= todayStart && d <= todayEnd;
      },
      week:  s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= weekAgo2; },
      month: s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= monthAgo2; },
      all:   () => true,
    };
    const filtered = all.filter(periodFilters[period] || (() => true));
    // Store for export buttons
    window.summaryExportData = { filtered, validTx: filtered.filter(t => t.status !== 'VOID'), period, periodLabel: '' };
    const voidTx   = filtered.filter(t => t.status === 'VOID');
    const validTx  = filtered.filter(t => t.status !== 'VOID');

    if (!filtered.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No transactions for this period.</div></div>';
      return;
    }

    const grandTotal    = validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
    const vatAmount     = grandTotal * 0.12 / 1.12;
    const netAmount     = grandTotal - vatAmount;
    const cashierTotals = {};
    const allItemTotals = {};
    let   totalQty      = 0;

    validTx.forEach(t => {
      cashierTotals[t.cashierName] = (cashierTotals[t.cashierName] || 0) + parseFloat(t.total || 0);
      try {
        JSON.parse(t.items || '[]').forEach(it => {
          if (!allItemTotals[it.name]) allItemTotals[it.name] = { qty: 0, total: 0 };
          allItemTotals[it.name].qty   += it.qty;
          allItemTotals[it.name].total += it.total;
          totalQty += it.qty;
        });
      } catch(e) {}
    });

    const periodLabel = { today: "Today's", week: "This Week's", month: "This Month's", all: "All-Time" }[period];

    // ── 24hr reset tracking
    const resetKey  = 'ae_summary_reset_' + period;
    let   lastReset = null;
    try { lastReset = localStorage.getItem(resetKey); } catch(e) {}
    const lastResetStr = lastReset
      ? 'Last reset: ' + safeFormatDateTime(lastReset)
      : 'Not yet reset today';

    el.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="generateAndDownloadSummary('${period}')">
          📄 Image Receipt
        </button>
        <button class="btn btn-success" onclick="downloadSummaryExcel('${period}', summaryExportData)">
          📊 Download Excel
        </button>
        <button class="btn btn-ghost" onclick="downloadSummaryCSV('${period}', summaryExportData)">
          📋 Download CSV
        </button>
        <button class="btn btn-ghost btn-sm" onclick="markSummaryReset('${period}')">
          ✅ Mark Reset
        </button>
        <button class="btn btn-ghost btn-sm" onclick="loadSummary('${period}',document.getElementById('sumTab_${period}'))">↺ Refresh</button>
        <span style="font-size:0.78rem;color:var(--text3);margin-left:auto">${lastResetStr}</span>
      </div>

      <div class="summary-receipt" id="summaryReceiptEl">
        <div class="summary-header">
          <div style="font-size:1.5rem">🏪</div>
          <h2>AE HOME — ${periodLabel} Sales Summary</h2>
          <div style="font-size:0.8rem;color:var(--text3)">Generated: ${new Date().toLocaleString('en-PH')}</div>
          <div style="font-size:0.8rem;color:var(--text3)">${validTx.length} transactions${voidTx.length > 0 ? ' <span style="color:#ef4444">(' + voidTx.length + ' voided)</span>' : ''}</div>
          ${lastReset ? '<div style="font-size:0.78rem;color:var(--green);margin-top:4px">✅ ' + lastResetStr + '</div>' : ''}
        </div>

        <div class="summary-section-title">Items Sold</div>
        ${Object.entries(allItemTotals).length
          ? Object.entries(allItemTotals).sort((a,b) => b[1].qty - a[1].qty).map(([name, d]) => `
            <div class="summary-row">
              <span>${name}</span>
              <span>${d.qty} pcs — ${formatPHP(d.total)}</span>
            </div>`).join('')
          : '<div style="color:var(--text3);font-size:0.82rem;padding:8px 0">No items data.</div>'
        }
        <div class="summary-row" style="font-weight:700;border-top:2px solid var(--border);margin-top:4px">
          <span>Total Qty Sold</span><span>${totalQty} pcs</span>
        </div>

        <div class="summary-section-title">Cashier Performance</div>
        ${Object.entries(cashierTotals).map(([name, total]) => `
          <div class="summary-row">
            <span>${name}</span>
            <span class="text-green fw-700">${formatPHP(total)}</span>
          </div>`).join('')}

        <div class="summary-section-title">Financials</div>
        <div class="summary-row"><span>Gross Sales</span><span>${formatPHP(grandTotal)}</span></div>
        <div class="summary-row"><span>VAT (12% incl.)</span><span>${formatPHP(vatAmount)}</span></div>
        <div class="summary-grand">
          <span>NET AMOUNT DUE</span>
          <span>${formatPHP(netAmount)}</span>
        </div>

        <div class="summary-section-title" style="margin-top:20px">Transaction Details</div>
        <div class="tbl-wrap" style="max-height:360px;overflow-y:auto">
          <table>
            <thead><tr><th>TX#</th><th>Cashier</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>${filtered.map(t => {
              const isVoid = t.status === 'VOID';
              return `<tr style="${isVoid ? 'opacity:0.5;background:#fff5f5' : ''}">
                <td style="font-family:var(--font-mono);font-size:0.78rem">${t.transactionId || ''}${isVoid ? ' <span style="background:#ef4444;color:white;padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:700">VOID</span>' : ''}</td>
                <td>${t.cashierName || ''}</td>
                <td class="${isVoid ? 'text-red' : 'text-green fw-700'}" style="${isVoid ? 'text-decoration:line-through' : ''}">${formatPHP(t.total)}</td>
                <td style="font-size:0.78rem">${safeFormatDateTime(t.date)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;

  } catch(e) {
    const el2 = document.getElementById('summaryContent');
    if (el2) el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load summary. Check connection.</div></div>';
  }
}

// ─── SUMMARY EXPORT ──────────────────────────
function buildSummaryRows(exportData) {
  const { validTx } = exportData || {};
  if (!validTx || !validTx.length) return [];

  // Aggregate sold items keyed by productId+unit so each variant is its own row
  const itemMap = {};
  validTx.forEach(t => {
    try {
      JSON.parse(t.items || '[]').forEach(it => {
        const key = (it.productId || it.name) + '|' + (it.unit || 'piece');
        if (!itemMap[key]) {
          itemMap[key] = {
            barcode: it.barcode || '',
            name:    it.name    || '',
            unit:    it.unit    || 'piece',
            qty:     0,
            price:   parseFloat(it.price || 0),
            total:   0,
          };
        }
        itemMap[key].qty   += parseInt(it.qty   || 0);
        itemMap[key].total += parseFloat(it.total || 0);
        // Fill barcode if it was missing on earlier sales but found now
        if (!itemMap[key].barcode && it.barcode) itemMap[key].barcode = it.barcode;
      });
    } catch(e) {}
  });

  // Sort by qty sold descending, then name ascending
  const rows = Object.values(itemMap).sort((a, b) =>
    b.qty !== a.qty ? b.qty - a.qty : a.name.localeCompare(b.name)
  );

  return rows.map((r, i) => ({
    stockNo:   String(i + 1).padStart(4, '0'),
    barcode:   r.barcode,
    name:      r.name,
    qty:       r.qty,
    uom:       r.unit === 'pack' ? 'PK' : 'PC',
    price:     parseFloat(r.price||0).toFixed(2),
    amount:    parseFloat(r.total||0).toFixed(2),
    discount1: '',
    discount2: '',
    discount3: '',
    discount4: '',
    remarks:   '',
  }));
}

async function downloadSummaryExcel(period, exportData) {
  if (!exportData || !exportData.validTx || !exportData.validTx.length) {
    toast('No data to export.', 'warning'); return;
  }
  toast('Preparing Excel file...', 'info');
  try {
    if (typeof XLSX === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    }

    const rows  = buildSummaryRows(exportData);
    const now   = new Date();
    const label = { today: 'Today', week: 'This-Week', month: 'This-Month', all: 'All-Time' }[period] || period;
    const grandTotal = exportData.validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
    const vatAmount  = grandTotal * 0.12 / 1.12;

    // ── Header columns (matches your screenshot exactly + added Name & Amount)
    const HEADER = [
      'Stock No.', 'Barcode', 'Product Name', 'Quantity', 'UOM Code',
      'Price', 'Amount', 'Discount 1', 'Discount 2', 'Discount 3', 'Discount 4', 'Remarks'
    ];

    const dataRows = rows.map(r => [
      r.stockNo, r.barcode, r.name, r.qty, r.uom,
      r.price, r.amount, r.discount1, r.discount2, r.discount3, r.discount4, r.remarks
    ]);

    // ── Totals row
    const totalRow = [
      '', '', 'TOTAL', rows.reduce((s, r) => s + r.qty, 0), '',
      '', grandTotal.toFixed(2), '', '', '', '', ''
    ];

    // ── Build sheet: info block + blank + header + data + blank + totals
    const sheetData = [
      ['AE HOME — Sales Summary Report'],
      ['Period:',       label],
      ['Generated:',    now.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })],
      ['Transactions:', exportData.validTx.length],
      ['Total Items:',  rows.length],
      [],
      HEADER,
      ...dataRows,
      [],
      totalRow,
      [],
      ['', '', 'Gross Sales',    '', '', '', grandTotal.toFixed(2)],
      ['', '', 'VAT (12% incl.)', '', '', '', vatAmount.toFixed(2)],
      ['', '', 'Net Sales',      '', '', '', (grandTotal - vatAmount).toFixed(2)],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // ── Apply bold + yellow background to header row (row index 6)
    const HEADER_ROW_IDX = 6;
    for (let c = 0; c < HEADER.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: HEADER_ROW_IDX, c });
      if (!ws[addr]) ws[addr] = { v: HEADER[c] };
      ws[addr].s = {
        font:      { bold: true, color: { rgb: '000000' } },
        fill:      { patternType: 'solid', fgColor: { rgb: 'FFD966' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          bottom: { style: 'medium', color: { rgb: '000000' } },
          top:    { style: 'thin',   color: { rgb: '888888' } },
        }
      };
    }

    // ── Style title row bold
    const titleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
    if (ws[titleAddr]) ws[titleAddr].s = { font: { bold: true, sz: 14 } };

    // ── Style totals row bold + yellow
    const totalRowIdx = HEADER_ROW_IDX + dataRows.length + 2;
    for (let c = 0; c < HEADER.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: totalRowIdx, c });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } } };
    }

    // ── Column widths
    ws['!cols'] = [
      { wch: 10 }, // Stock No.
      { wch: 18 }, // Barcode
      { wch: 32 }, // Product Name
      { wch: 10 }, // Quantity
      { wch: 10 }, // UOM Code
      { wch: 12 }, // Price
      { wch: 14 }, // Amount
      { wch: 12 }, // Discount 1
      { wch: 12 }, // Discount 2
      { wch: 12 }, // Discount 3
      { wch: 12 }, // Discount 4
      { wch: 20 }, // Remarks
    ];

    // ── Freeze header row
    ws['!freeze'] = { xSplit: 0, ySplit: HEADER_ROW_IDX + 1 };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Summary');

    // ── Second sheet: raw transactions
    const txHeader = ['TX#', 'SI#', 'Cashier', 'Total', 'Cash', 'Change', 'Date', 'Status'];
    const txRows   = exportData.validTx.map(t => [
      t.transactionId || '', t.siNumber || '',
      t.cashierName   || '', parseFloat(t.total  || 0),
      parseFloat(t.cash   || 0), parseFloat(t.change || 0),
      safeFormatDateTime(t.date, ''),
      t.status || 'ACTIVE'
    ]);
    const txSheet = XLSX.utils.aoa_to_sheet([txHeader, ...txRows]);
    txSheet['!cols'] = [{ wch: 20 },{ wch: 14 },{ wch: 18 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 22 },{ wch: 10 }];
    XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');

    const filename = `AE-HOME-Sales-${label}-${now.toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast('Excel downloaded!', 'success');
  } catch(e) {
    toast('Excel export failed: ' + e.message, 'error');
  }
}

function downloadSummaryCSV(period, exportData) {
  if (!exportData || !exportData.validTx || !exportData.validTx.length) {
    toast('No data to export.', 'warning'); return;
  }
  const rows  = buildSummaryRows(exportData);
  const label = { today: 'Today', week: 'This-Week', month: 'This-Month', all: 'All-Time' }[period] || period;
  const now   = new Date();
  const grandTotal = exportData.validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
  const vatAmount  = grandTotal * 0.12 / 1.12;

  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('\"') || s.indexOf('\n') >= 0)
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const row = cols => cols.map(esc).join(',');

  const lines = [
    row(['AE HOME — Sales Summary Report']),
    row(['Period:', label]),
    row(['Generated:', now.toLocaleString('en-PH')]),
    row(['Transactions:', exportData.validTx.length]),
    row(['Total Items:', rows.length]),
    '',
    row(['Stock No.','Barcode','Product Name','Quantity','UOM Code','Price','Amount','Discount 1','Discount 2','Discount 3','Discount 4','Remarks']),
    ...rows.map(r => row([r.stockNo, r.barcode, r.name, r.qty, r.uom, r.price, r.amount, r.discount1, r.discount2, r.discount3, r.discount4, r.remarks])),
    '',
    row(['','','TOTAL', rows.reduce((s,r) => s + r.qty, 0), '', '', grandTotal.toFixed(2)]),
    '',
    row(['','','Gross Sales','','','', grandTotal.toFixed(2)]),
    row(['','','VAT (12% incl.)','','','', vatAmount.toFixed(2)]),
    row(['','','Net Sales','','','', (grandTotal - vatAmount).toFixed(2)]),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = `AE-HOME-Sales-${label}-${now.toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast('CSV downloaded!', 'success');
}


function markSummaryReset(period) {
  if (!confirm('Mark this summary as reset? This records the current time as the last reset.')) return;
  lsSet('ae_summary_reset_' + period, new Date().toISOString());
  toast('Reset timestamp saved!', 'success');
  loadSummary(period, null);
}

async function generateAndDownloadSummary(period) {
  const el = document.getElementById('summaryReceiptEl');
  if (!el) { toast('No summary to generate.', 'warning'); return; }
  toast('Generating summary image...', 'info');
  try {
    if (typeof html2canvas === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const link   = document.createElement('a');
    link.download = 'AE-HOME-Summary-' + period + '-' + new Date().toISOString().slice(0,10) + '.png';
    link.href     = canvas.toDataURL('image/png');
    link.click();
    toast('Summary downloaded!', 'success');
  } catch(e) {
    toast('Failed to generate image. Try again.', 'error');
  }
}

async function generateSummaryReceipt(period) {
  return generateAndDownloadSummary(period);
}



// ═══════════════════════════════════════════════
// ANALYTICS & INSIGHTS (replaces Inv. Logs)
// ═══════════════════════════════════════════════
async function renderLogs() {
 document.getElementById('pageContent').innerHTML = `
<div class="analytics-grid" id="analyticsCards">
      ${['Gross Revenue Today','This Week Revenue','Total SKUs','Low Stock Items','Transactions Today','All-Time Revenue'].map((l,i) =>
 `<div class="analytics-card ${['','green','','orange','green','purple'][i]}">
<div class="ac-label">${l}</div>
<div class="ac-value" id="ac_${i}">—</div>
 <div class="ac-sub" id="ac_sub_${i}"></div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<div class="card">
<div class="card-title">Top Products</div>
 <div id="topProducts"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
<div class="card">
<div class="card-title">Recent Stock Movements</div>
 <div id="recentLogs"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  try {
    const [salesRes, productsRes, logsRes] = await Promise.all([
      gasRequest({ action: 'getSales' }),
      gasRequest({ action: 'getProducts' }),
      gasRequest({ action: 'getInventoryLogs' }),
    ]);
    const sales = salesRes.data || [];
    const products = productsRes.data || [];
    const logs = (logsRes.data || []).reverse();
    const now = new Date();
    const { start: logStart, end: logEnd } = dayRange(now);
    const weekAgo  = new Date(now - 7 * 86400000);

    const todaySales = sales.filter(s => { const d = parseDate(s.date); return d && d >= logStart && d <= logEnd; });
    const weekSales  = sales.filter(s => { const d = parseDate(s.date); return d && d >= weekAgo; });
    const lowStock = products.filter(p => parseInt(p.qtyPcs||0) <= 5);
    const sum = arr => arr.reduce((a,s) => a + parseFloat(s.total||0), 0);
    const allTotal = sum(sales);

 document.getElementById('ac_0').textContent = '₱' + sum(todaySales).toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_0').textContent = todaySales.length + ' transactions';
 document.getElementById('ac_1').textContent = '₱' + sum(weekSales).toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_1').textContent = weekSales.length + ' transactions';
 document.getElementById('ac_2').textContent = products.length;
 document.getElementById('ac_sub_2').textContent = 'products in system';
 document.getElementById('ac_3').textContent = lowStock.length;
 document.getElementById('ac_sub_3').textContent = 'items need restocking';
 document.getElementById('ac_4').textContent = todaySales.length;
 document.getElementById('ac_sub_4').textContent = 'completed today';
 document.getElementById('ac_5').textContent = '₱' + allTotal.toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_5').textContent = sales.length + ' total transactions';

    // Top products from sales
    const itemTotals = {};
    sales.forEach(s => {
      try {
        JSON.parse(s.items||'[]').forEach(it => {
          itemTotals[it.name] = (itemTotals[it.name]||0) + it.qty;
        });
      } catch(e) {}
    });
    const topItems = Object.entries(itemTotals).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const tpEl = document.getElementById('topProducts');
 if (tpEl) tpEl.innerHTML = topItems.length ? topItems.map(([name,qty],i) =>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem">
        <span>${['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'][i]} ${name}</span>
        <span class="text-green fw-700">${qty} sold</span>
      </div>`).join('') :
 '<div class="no-data"><div class="no-data-icon"></div><div>No sales data yet.</div></div>';

    // Recent logs
    const rlEl = document.getElementById('recentLogs');
 if (rlEl) rlEl.innerHTML = logs.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Product</th><th>Type</th><th>Qty</th><th>By</th></tr></thead>
      <tbody>${logs.slice(0,8).map(l=>`<tr>
        <td style="font-size:0.82rem">${l.productName||''}</td>
        <td><span class="${l.type==='in'?'log-in':l.type==='sale'?'log-sale':'log-out'}">${(l.type||'').toUpperCase()}</span></td>
        <td>${l.qty}</td>
        <td style="font-size:0.78rem">${l.adjustedBy||''}</td>
      </tr>`).join('')}</tbody>
    </table></div>` :
 '<div class="no-data"><div class="no-data-icon"></div><div>No logs yet.</div></div>';

  } catch(e) {
 toast('Failed to load analytics.', 'error');
  }
}





// ═══════════════════════════════════════════════
// SALES EXPORT PAGE
// ═══════════════════════════════════════════════
async function renderSalesExport() {
  const todayStr = localDateStr(new Date());
  const pc = document.getElementById('pageContent');
  if (!pc) return;
  pc.innerHTML =
    '<div class="inv-toolbar" style="flex-wrap:wrap;gap:10px">' +
      '<div class="field" style="margin-bottom:0">' +
        '<label style="font-size:0.75rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">From</label>' +
        '<input type="date" id="seFrom" value="' + todayStr + '" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--font-main);background:white">' +
      '</div>' +
      '<div class="field" style="margin-bottom:0">' +
        '<label style="font-size:0.75rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">To</label>' +
        '<input type="date" id="seTo" value="' + todayStr + '" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--font-main);background:white">' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'today\')">Today</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'yesterday\')">Yesterday</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'week\')">This Week</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'month\')">This Month</button>' +
        '<button class="btn btn-primary btn-sm" onclick="loadSalesExport()">Filter</button>' +
      '</div>' +
      '<div style="margin-left:auto;display:flex;gap:8px">' +
        '<button class="btn btn-success btn-sm" id="seExcelBtn" onclick="exportSalesExcelFromPage()" disabled>Export Excel</button>' +
        '<button class="btn btn-ghost btn-sm" id="seCSVBtn" onclick="exportSalesCSVFromPage()" disabled>Export CSV</button>' +
        '<button class="btn btn-danger btn-sm" onclick="clearSalesExportData()" title="Clear all local export records">Clear Data</button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:0">' +
      '<div id="seTable"><div class="loading-spinner"><div class="spinner"></div></div></div>' +
    '</div>';

  loadSalesExport().catch(e => {
    console.error('[POS] renderSalesExport error:', e);
    const el = document.getElementById('seTable');
    if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load export data.</div></div>';
  });
}

function setSEPeriod(period) {
  var now = new Date();
  var todayStr = localDateStr(now);
  var from = todayStr, to = todayStr;
  if (period === 'yesterday') {
    var y = new Date(now - 86400000);
    from = to = localDateStr(y);
  } else if (period === 'week') {
    from = localDateStr(new Date(now - 6 * 86400000));
    to   = todayStr;
  } else if (period === 'month') {
    from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    to   = todayStr;
  }
  var fe = document.getElementById('seFrom');
  var te = document.getElementById('seTo');
  if (fe) fe.value = from;
  if (te) te.value = to;
  loadSalesExport();
}

var _seCurrentData = [];

async function loadSalesExport() {
  var fromVal = document.getElementById('seFrom') ? document.getElementById('seFrom').value : '';
  var toVal   = document.getElementById('seTo')   ? document.getElementById('seTo').value   : '';
  var el      = document.getElementById('seTable');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  var from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  var to   = toVal   ? new Date(toVal   + 'T23:59:59') : null;

  // Try local storage first
  var rows = getSalesExportLocal((from && to) ? { from: from, to: to } : null);

  // If empty, try GAS
  if (!rows.length) {
    try {
      var params = { action: 'getSalesExport' };
      if (fromVal) params.from = fromVal + 'T00:00:00';
      if (toVal)   params.to   = toVal   + 'T23:59:59';
      var res = await gasRequest(params);
      if (res.success) rows = res.data || [];
    } catch(e) {}
  }

  _seCurrentData = rows;

  var eb = document.getElementById('seExcelBtn');
  var cb = document.getElementById('seCSVBtn');
  if (eb) eb.disabled = !rows.length;
  if (cb) cb.disabled = !rows.length;

  if (!rows.length) {
    el.innerHTML =
      '<div class="no-data">' +
        '<div class="no-data-icon"></div>' +
        '<div class="no-data-text">No export records for this period.<br>' +
          '<span style="font-size:0.8rem;color:var(--text3)">Records are auto-generated after each checkout.</span>' +
        '</div>' +
      '</div>';
    return;
  }

  var totalAmt = rows.reduce(function(s, r) { return s + parseFloat(r.amount || 0); }, 0);
  var totalQty = rows.reduce(function(s, r) { return s + parseInt(r.quantity || 0); }, 0);

  var rowsHtml = rows.map(function(r, i) {
    return '<tr>' +
      '<td class="text-muted" style="font-size:0.75rem">' + (i + 1) + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:0.72rem">' + (r.transactionId || '') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.transactionDate || '') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.transactionTime || '') + '</td>' +
      '<td style="font-size:0.8rem">' + (r.cashier || '') + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:0.75rem">' + (r.barcode || '—') + '</td>' +
      '<td style="font-size:0.82rem"><b>' + (r.productName || '') + '</b></td>' +
      '<td class="fw-700">' + (r.quantity || 0) + '</td>' +
      '<td><span class="badge-in-stock" style="font-size:0.7rem">' + (r.uomCode || 'PC') + '</span></td>' +
      '<td class="fw-700">\u20b1' + parseFloat(r.price || 0).toFixed(2) + '</td>' +
      '<td class="text-green fw-700">\u20b1' + parseFloat(r.amount || 0).toFixed(2) + '</td>' +
      '<td>' + (r.discount1 || '') + '</td>' +
      '<td>' + (r.discount2 || '') + '</td>' +
      '<td>' + (r.discount3 || '') + '</td>' +
      '<td>' + (r.discount4 || '') + '</td>' +
      '<td><span class="role-badge role-cashier" style="font-size:0.7rem">' + (r.paymentMethod || r.remarks || 'Cash Sale') + '</span></td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
      '<span style="font-size:0.85rem;font-weight:700;color:var(--text2)">' + rows.length + ' record' + (rows.length !== 1 ? 's' : '') + ' found</span>' +
      '<span style="font-size:0.85rem;color:var(--text2)">Total Qty: <b>' + totalQty + '</b> &nbsp;|&nbsp; Total Amount: <b class=\'text-green\'>\u20b1' + totalAmt.toFixed(2) + '</b></span>' +
    '</div>' +
    '<div class="tbl-wrap" style="max-height:60vh;overflow-y:auto">' +
      '<table>' +
        '<thead><tr>' +
          '<th>#</th><th>TX ID</th><th>Date</th><th>Time</th><th>Cashier</th>' +
          '<th>Barcode</th><th>Product Name</th><th>Qty</th><th>UOM</th>' +
          '<th>Price</th><th>Amount</th><th>Disc 1</th><th>Disc 2</th>' +
          '<th>Disc 3</th><th>Disc 4</th><th>Payment</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
    '</div>';
}

function clearSalesExportData() {
  if (!confirm('Clear all local Sales Export records from this device?\nThis only removes the local copy — Google Sheets data is not affected.')) return;
  lsDel('ae_sales_export');
  _seCurrentData = [];
  toast('Sales Export data cleared.', 'success');
  loadSalesExport();
}

async function exportSalesExcelFromPage() {
  if (!_seCurrentData.length) { toast('No data to export.', 'warning'); return; }
  var fromVal = document.getElementById('seFrom') ? document.getElementById('seFrom').value : localDateStr(new Date());
  var toVal   = document.getElementById('seTo')   ? document.getElementById('seTo').value   : fromVal;
  var label   = fromVal === toVal ? fromVal : (fromVal + '_to_' + toVal);
  await exportSalesExcel(_seCurrentData, label);
}

function exportSalesCSVFromPage() {
  if (!_seCurrentData.length) { toast('No data to export.', 'warning'); return; }
  var fromVal = document.getElementById('seFrom') ? document.getElementById('seFrom').value : localDateStr(new Date());
  var toVal   = document.getElementById('seTo')   ? document.getElementById('seTo').value   : fromVal;
  var label   = fromVal === toVal ? fromVal : (fromVal + '_to_' + toVal);
  exportSalesCSV(_seCurrentData, label);
}

async function exportSalesExcel(rows, label) {
  toast('Preparing Excel...', 'info');
  try {
    if (typeof XLSX === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    }
    var HEADER = [
      '#', 'Transaction ID', 'Date', 'Time', 'Cashier',
      'Barcode', 'Stock No.', 'Product Name',
      'Quantity', 'UOM Code',
      'Discount 1', 'Discount 2', 'Discount 3', 'Discount 4',
      'Price', 'Amount', 'Payment Method'
    ];
    var data = [HEADER].concat(rows.map(function(r, i) {
      return [
        i + 1, r.transactionId, r.transactionDate, r.transactionTime,
        r.cashier, r.barcode, r.stockNo, r.productName,
        parseInt(r.quantity || 0), r.uomCode,
        r.discount1, r.discount2, r.discount3, r.discount4,
        parseFloat(r.price || 0), parseFloat(r.amount || 0),
        r.paymentMethod || r.remarks || 'Cash Sale'
      ];
    }));
    var ws = XLSX.utils.aoa_to_sheet(data);
    for (var c = 0; c < HEADER.length; c++) {
      var addr = XLSX.utils.encode_cell({ r: 0, c: c });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFD966' } } };
    }
    ws['!cols'] = [
      {wch:5},{wch:20},{wch:12},{wch:10},{wch:16},
      {wch:18},{wch:10},{wch:32},
      {wch:10},{wch:10},
      {wch:12},{wch:12},{wch:12},{wch:12},
      {wch:12},{wch:14},{wch:16}
    ];
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Export');
    XLSX.writeFile(wb, 'SalesExport_' + label + '.xlsx');
    toast('Excel downloaded!', 'success');
  } catch(e) {
    toast('Export failed: ' + e.message, 'error');
  }
}

function exportSalesCSV(rows, label) {
  var esc = function(v) {
    var s = String(v != null ? v : '');
    return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var r1 = function(cols) { return cols.map(esc).join(','); };
  var lines = [
    r1(['#','Transaction ID','Date','Time','Cashier',
        'Barcode','Stock No.','Product Name',
        'Quantity','UOM Code',
        'Discount 1','Discount 2','Discount 3','Discount 4',
        'Price','Amount','Payment Method'])
  ].concat(rows.map(function(r, i) {
    return r1([
      i + 1, r.transactionId, r.transactionDate, r.transactionTime,
      r.cashier, r.barcode, r.stockNo, r.productName,
      r.quantity, r.uomCode,
      r.discount1, r.discount2, r.discount3, r.discount4,
      r.price, r.amount, r.paymentMethod || r.remarks || 'Cash Sale'
    ]);
  }));
  var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = 'SalesExport_' + label + '.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  toast('CSV downloaded!', 'success');
}


// Enter key for login handled in the global keydown listener above

// ═══════════════════════════════════════════════
// WHOLESALERS INFORMATION MODULE
// Permissions: Admin=full, Cashier=view+add, Clerk=view+search
// ═══════════════════════════════════════════════

let _wholesalersCache = []; // in-memory cache for search
let _wsSearchTimeout  = null;

// ── RENDER PAGE ───────────────────────────────
async function renderWholesalers() {
  const role    = currentUser.role;
  const canAdd  = ['admin', 'cashier'].includes(role);
  const canEdit = role === 'admin';
  const canDel  = role === 'admin';

  document.getElementById('pageContent').innerHTML =
    '<div class="inv-toolbar" style="flex-wrap:wrap;gap:10px;margin-bottom:16px">' +
      '<div class="search-wrap" style="flex:1;min-width:220px;margin-bottom:0">' +
        '<span class="search-icon">🔍</span>' +
        '<input type="text" id="wsSearch" placeholder="Search by name, store, contact, category..." ' +
               'oninput="onWsSearch(this.value)" autocomplete="off">' +
      '</div>' +
      (canAdd ? '<button class="btn btn-primary" onclick="openAddWholesalerModal()">+ Add Wholesaler</button>' : '') +
    '</div>' +
    '<div class="card">' +
      '<div id="wholesalerTable"><div class="loading-spinner"><div class="spinner"></div> Loading...</div></div>' +
    '</div>';

  await loadWholesalers();
}

// ── LOAD & RENDER TABLE ───────────────────────
async function loadWholesalers() {
  try {
    const res = await gasRequest({ action: 'getWholesalers' });
    _wholesalersCache = res.data || [];
    renderWholesalerTable(_wholesalersCache);
  } catch(e) {
    const el = document.getElementById('wholesalerTable');
    if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load wholesalers. Check connection.</div></div>';
    toast('Could not load wholesalers.', 'error');
  }
}

function renderWholesalerTable(data) {
  const el = document.getElementById('wholesalerTable');
  if (!el) return;

  const role    = currentUser.role;
  const canEdit = role === 'admin';
  const canDel  = role === 'admin';
  const showAct = canEdit || canDel;

  if (!data.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No wholesalers found.<br><span style="font-size:0.8rem;color:var(--text3)">Add your first wholesaler to get started.</span></div></div>';
    return;
  }

  const rows = data.map(w => {
    const phone    = (w.contact_number || '').replace(/[^0-9+]/g, '');
    const phoneNum = w.contact_number || '—';
    const createdAt = safeFormatDateTime(w.created_at, '—');

    const phoneCell =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span style="font-family:var(--font-mono);font-size:0.82rem">' + phoneNum + '</span>' +
        (phone ? (
          '<a href="tel:' + phone + '" class="ws-call-btn" title="Call" aria-label="Call ' + phoneNum + '">📞</a>' +
          '<button class="ws-copy-btn" onclick="wsClipboard(\'' + (w.contact_number||'').replace(/'/g,"\\'") + '\')" title="Copy number">Copy</button>'
        ) : '') +
      '</div>';

    const actCell = showAct
      ? '<td><div style="display:flex;gap:5px;flex-wrap:wrap">' +
          (canEdit ? '<button class="inv-btn inv-btn-edit" onclick="openEditWholesalerModal(\'' + w.id + '\')">Edit</button>' : '') +
          (canDel  ? '<button class="inv-btn inv-btn-del"  onclick="deleteWholesaler(\'' + w.id + '\')">Del</button>' : '') +
        '</div></td>'
      : '';

    return '<tr>' +
      '<td><b>' + esc(w.wholesaler_name || '') + '</b></td>' +
      '<td>' + esc(w.store_name || '—') + '</td>' +
      '<td>' + esc(w.contact_person || '—') + '</td>' +
      '<td>' + (w.product_category ? '<span class="badge-in-stock" style="font-size:0.72rem">' + esc(w.product_category) + '</span>' : '—') + '</td>' +
      '<td style="font-size:0.8rem;max-width:160px">' + esc(w.address || '—') + '</td>' +
      '<td>' + phoneCell + '</td>' +
      '<td style="font-size:0.78rem;color:var(--text3)">' + esc(w.created_by || '—') + '</td>' +
      '<td style="font-size:0.78rem;color:var(--text3)">' + createdAt + '</td>' +
      actCell +
    '</tr>';
  }).join('');

  const actHeader = showAct ? '<th>Actions</th>' : '';
  el.innerHTML =
    '<div class="tbl-wrap"><table>' +
      '<thead><tr>' +
        '<th>Wholesaler Name</th><th>Store Name</th><th>Contact Person</th>' +
        '<th>Category</th><th>Address</th><th>Contact Number</th>' +
        '<th>Created By</th><th>Date Created</th>' + actHeader +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

// ── SEARCH ────────────────────────────────────
function onWsSearch(val) {
  clearTimeout(_wsSearchTimeout);
  _wsSearchTimeout = setTimeout(() => {
    const q = (val || '').toLowerCase().trim();
    if (!q) { renderWholesalerTable(_wholesalersCache); return; }
    const filtered = _wholesalersCache.filter(w =>
      (w.wholesaler_name  || '').toLowerCase().includes(q) ||
      (w.store_name       || '').toLowerCase().includes(q) ||
      (w.contact_number   || '').toLowerCase().includes(q) ||
      (w.contact_person   || '').toLowerCase().includes(q) ||
      (w.product_category || '').toLowerCase().includes(q)
    );
    renderWholesalerTable(filtered);
  }, 200);
}

// ── UTILITY ───────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wsClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Number copied!', 'success'))
      .catch(() => wsFallbackCopy(text));
  } else {
    wsFallbackCopy(text);
  }
}
function wsFallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Number copied!', 'success'); }
  catch(e) { toast('Could not copy.', 'warning'); }
  document.body.removeChild(ta);
}

// ── ADD MODAL ─────────────────────────────────
function openAddWholesalerModal() {
  openModal(
    '<div class="modal-title">Add Wholesaler</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_name">Wholesaler Name *</label>' +
        '<input id="ws_name" name="ws_name" placeholder="e.g. Juan Santos Trading">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_store">Store Name *</label>' +
        '<input id="ws_store" name="ws_store" placeholder="e.g. Santos General Merchandise">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_contact">Contact Number *</label>' +
        '<input id="ws_contact" name="ws_contact" type="tel" placeholder="e.g. 09171234567">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_person">Contact Person</label>' +
        '<input id="ws_person" name="ws_person" placeholder="e.g. Juan Santos">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_category">Product Category</label>' +
        '<input id="ws_category" name="ws_category" placeholder="e.g. Beverages, Snacks">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_address">Complete Address</label>' +
        '<input id="ws_address" name="ws_address" placeholder="e.g. 123 Rizal St., Brgy. 1, Vigan City">' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveWholesaler()">Save Wholesaler</button>'
  );
  setTimeout(() => document.getElementById('ws_name')?.focus(), 200);
}

// ── EDIT MODAL ────────────────────────────────
function openEditWholesalerModal(id) {
  const w = _wholesalersCache.find(x => x.id === id);
  if (!w) { toast('Wholesaler not found.', 'error'); return; }
  openModal(
    '<div class="modal-title">Edit Wholesaler</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_name">Wholesaler Name *</label>' +
        '<input id="ws_name" name="ws_name" value="' + esc(w.wholesaler_name) + '">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_store">Store Name *</label>' +
        '<input id="ws_store" name="ws_store" value="' + esc(w.store_name) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_contact">Contact Number *</label>' +
        '<input id="ws_contact" name="ws_contact" type="tel" value="' + esc(w.contact_number) + '">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_person">Contact Person</label>' +
        '<input id="ws_person" name="ws_person" value="' + esc(w.contact_person) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_category">Product Category</label>' +
        '<input id="ws_category" name="ws_category" value="' + esc(w.product_category) + '">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_address">Complete Address</label>' +
        '<input id="ws_address" name="ws_address" value="' + esc(w.address) + '">' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveWholesaler(\'' + id + '\')">Update Wholesaler</button>'
  );
}

// ── SAVE (ADD / EDIT) ─────────────────────────
// ── Contact number validator ──────────────────
function wsValidateContact(val) {
  if (!val) return { ok: false, msg: 'Contact Number is required.' };
  // Allow: digits, spaces, +, -, (, )
  if (/[^0-9\s+\-()]/.test(val)) {
    return { ok: false, msg: 'Contact Number contains invalid characters. Only digits, spaces, +, -, and () are allowed.' };
  }
  const digits = val.replace(/\D/g, '');
  if (digits.length < 7) {
    return { ok: false, msg: 'Contact Number must have at least 7 digits.' };
  }
  return { ok: true };
}

// ── Normalize spaces in a string ──────────────
function wsNormalize(str) {
  return (str || '').trim().replace(/\s{2,}/g, ' ');
}

async function saveWholesaler(id = null) {
  // ── Sanitize inputs ──────────────────────────
  const name    = wsNormalize(document.getElementById('ws_name')?.value);
  const store   = wsNormalize(document.getElementById('ws_store')?.value);
  const contact = wsNormalize(document.getElementById('ws_contact')?.value);
  const person  = wsNormalize(document.getElementById('ws_person')?.value);
  const cat     = wsNormalize(document.getElementById('ws_category')?.value);
  const addr    = wsNormalize(document.getElementById('ws_address')?.value);

  // ── Required field validation ──────────────────
  if (!name) {
    toast('Wholesaler Name is required.', 'error');
    document.getElementById('ws_name')?.focus(); return;
  }
  if (!store) {
    toast('Store Name is required.', 'error');
    document.getElementById('ws_store')?.focus(); return;
  }

  // ── Contact number validation ──────────────────
  const contactCheck = wsValidateContact(contact);
  if (!contactCheck.ok) {
    toast(contactCheck.msg, 'error');
    document.getElementById('ws_contact')?.focus(); return;
  }

  // ── Duplicate prevention (store name + contact number) ──
  if (!id) {
    const storeLower   = store.toLowerCase();
    const contactDigits = contact.replace(/\D/g, '');
    const duplicate = _wholesalersCache.find(w =>
      w.store_name.toLowerCase() === storeLower &&
      w.contact_number.replace(/\D/g, '') === contactDigits
    );
    if (duplicate) {
      toast(
        'Duplicate record: "' + duplicate.store_name + '" with this contact number already exists.',
        'error', 5000
      );
      return;
    }
  }

  // ── Build payload with full audit trail ────────
  const now = new Date().toISOString();
  const payload = {
    action:           id ? 'updateWholesaler' : 'addWholesaler',
    id,
    wholesaler_name:  name,
    store_name:       store,
    contact_number:   contact,
    contact_person:   person,
    product_category: cat,
    address:          addr,
    caller_role:      currentUser.role,
    created_by:       currentUser.name || currentUser.username,
    updated_at:       now,
  };
  if (!id) payload.created_at = now;

  // ── Disable button to prevent double submit ────
  const btn = document.querySelector('#modalBox .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const res = await gasPost(payload);
    if (res.success) {
      toast(id ? 'Wholesaler updated!' : 'Wholesaler added!', 'success');
      closeModalDirect();
      await loadWholesalers();
    } else {
      toast(res.message || 'Error saving wholesaler.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = id ? 'Update Wholesaler' : 'Save Wholesaler'; }
    }
  } catch(e) {
    toast('Network error. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = id ? 'Update Wholesaler' : 'Save Wholesaler'; }
  }
}

// ── DELETE ────────────────────────────────────
async function deleteWholesaler(id) {
  const w = _wholesalersCache.find(x => x.id === id);
  const name = w ? w.wholesaler_name : 'this wholesaler';
  if (!confirm('Delete "' + name + '"?\nThis cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteWholesaler', id, caller_role: currentUser.role });
    if (res.success) { toast('Wholesaler deleted.', 'success'); await loadWholesalers(); }
    else toast(res.message || 'Error deleting.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}
