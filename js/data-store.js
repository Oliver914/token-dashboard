/* =========================================================
   数据抽象层 · 统一接口，屏蔽后端实现
   =========================================================
   对外暴露：
     DataStore.init()         初始化（异步）
     DataStore.load()         读取全部数据
     DataStore.save(content)  保存内容（看板文字/KPI/模块/排名/页脚）
     DataStore.saveCharts(charts)  保存图表数据
     DataStore.onChange(cb)   数据变化时回调（看板实时刷新用）
     DataStore.isConfigured() 是否接入了真实后端

   三种模式（自动选择）：
     1. PROXY 模式：运行在自部署服务器（如 token.xxx.com），走 /api/*
        - 国内可访问，后端转发 Firebase
     2. FIREBASE 模式：直连 Firebase（github.io 部署时用，需能访问 Google）
     3. LOCAL 模式：localStorage 兜底（本地预览/编辑，无后端）
   --------------------------------------------------------- */

const DataStore = (() => {
  let db = null, auth = null;
  let firebaseReady = false;
  let proxyReady = false;
  let listeners = [];
  let cache = null;
  let authToken = null;       // 代理模式登录 token

  const LS_KEY = 'token_dashboard_data_v1';
  const AUTH_KEY = 'token_admin_token';
  const VIEW_KEY = 'view_authed';

  // 判断是否运行在自部署服务器（启用代理模式）
  // 规则：非 localhost、非 github.io、非 file://，且 /api/health 可达
  function detectProxyMode() {
    const h = location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.github.io') || location.protocol === 'file:') {
      return false;
    }
    return true; // 自部署域名，尝试代理模式
  }
  const PROXY_CANDIDATE = detectProxyMode();

  /* ---------- 初始化 ---------- */
  async function init() {
    // 优先尝试 PROXY 模式（自部署服务器）
    if (PROXY_CANDIDATE) {
      try {
        const r = await fetch('/api/health');
        if (r.ok) {
          proxyReady = true;
          // 关键：立即拉取数据填充 cache，否则密码门读不到 view_password
          await load();
          return 'proxy';
        }
      } catch (e) {
        console.warn('代理后端不可达，回退到其他模式');
      }
    }
    // 其次 FIREBASE 模式
    if (FIREBASE_CONFIGURED && window.firebase) {
      try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        auth = firebase.auth();
        firebaseReady = true;
        db.ref('/').on('value', snap => {
          cache = flattenCloudData(snap.val() || {});
          listeners.forEach(cb => cb(cache));
        });
        return 'firebase';
      } catch (e) {
        console.warn('Firebase 初始化失败：', e);
        firebaseReady = false;
      }
    }
    // 最后 LOCAL 模式
    cache = loadLocal();
    return 'local';
  }

  function isConfigured() { return proxyReady || firebaseReady; }
  function getMode() {
    if (proxyReady) return 'proxy';
    if (firebaseReady) return 'firebase';
    return 'local';
  }

  /* ---------- localStorage 兜底 ---------- */
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }
  function saveLocal(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* ---------- 读取 ---------- */
  async function load() {
    if (proxyReady) {
      const r = await fetch('/api/data');
      const d = await r.json();
      cache = flattenCloudData(d || {});
      return cache;
    }
    if (firebaseReady) {
      const snap = await db.ref('/').get();
      cache = flattenCloudData(snap.val() || {});
      return cache;
    }
    // 本地
    if (cache) return cache;
    const local = loadLocal();
    if (local) { cache = local; return local; }
    try {
      const res = await fetch('data.json?v=' + Date.now());
      cache = normalizeStructure(await res.json());
      saveLocal(cache);
      return cache;
    } catch (e) {
      return normalizeStructure({});
    }
  }

  /* ---------- 结构归一化 ---------- */
  function flattenCloudData(d) {
    if (!d) return normalizeStructure({});
    if (d.title || d.summary || d.kpi) return d;
    const content = d.content || {};
    return {
      ...content,
      total_history: d.charts && d.charts.total_history,
      domestic: d.charts && d.charts.domestic,
      settings: d.settings || { updated_at: nowStr() },
      meta: content.meta || { updated_at: nowStr() }
    };
  }

  /* ---------- 保存 ---------- */
  async function save(content) {
    if (!cache) cache = {};
    cache = { ...cache, ...content, settings: { ...(cache.settings||{}), updated_at: nowStr() } };
    const contentNode = {
      title: cache.title, summary: cache.summary, kpi: cache.kpi,
      modules: cache.modules, top10: cache.top10, footer: cache.footer, meta: cache.meta
    };
    if (proxyReady) {
      await apiFetch('/api/content', 'PUT', contentNode);
      cache.content = contentNode;
    } else if (firebaseReady) {
      await db.ref('content').set(contentNode);
      await db.ref('settings').set(cache.settings);
      cache.content = contentNode;
    } else {
      saveLocal(cache);
      listeners.forEach(cb => cb(cache));
    }
  }

  async function saveCharts(charts) {
    if (!cache) cache = {};
    cache = { ...cache, charts, settings: { ...(cache.settings||{}), updated_at: nowStr() } };
    if (proxyReady) {
      await apiFetch('/api/charts', 'PUT', charts);
    } else if (firebaseReady) {
      await db.ref('charts').set(sanitizeForFirebase(charts));
      await db.ref('settings').set(cache.settings);
    } else {
      saveLocal(cache);
      listeners.forEach(cb => cb(cache));
    }
  }

  // PROXY 模式的 fetch 封装（带 auth token）
  async function apiFetch(path, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const r = await fetch(path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(e.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  // Firebase 数组 null→0 处理
  function sanitizeForFirebase(obj) {
    if (Array.isArray(obj)) {
      const isNumeric = obj.some(v => typeof v === 'number');
      return obj.map(v => (v == null && isNumeric) ? 0 : sanitizeForFirebase(v));
    }
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k in obj) out[k] = sanitizeForFirebase(obj[k]);
      return out;
    }
    return obj;
  }

  /* ---------- 变化监听 ---------- */
  function onChange(cb) {
    listeners.push(cb);
    if (cache) cb(cache);
  }
  // PROXY 模式定期轮询（无实时推送，5 秒一次平衡实时性和负载）
  setInterval(async () => {
    if (proxyReady && listeners.length > 0) {
      try {
        const r = await fetch('/api/data');
        const d = await r.json();
        const newData = flattenCloudData(d || {});
        // 简单判断数据变化（更新时间戳）
        const newTs = newData.settings && newData.settings.updated_at;
        const oldTs = cache && cache.settings && cache.settings.updated_at;
        if (newTs !== oldTs) {
          cache = newData;
          listeners.forEach(cb => cb(cache));
        }
      } catch (e) {}
    }
  }, 5000);

  /* ---------- 登录 ---------- */
  async function signIn(email, password) {
    if (proxyReady) {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error && data.error.message || '登录失败');
      authToken = data.idToken;
      localStorage.setItem(AUTH_KEY, authToken);
      return true;
    }
    if (firebaseReady) {
      await auth.signInWithEmailAndPassword(email, password);
      return true;
    }
    // 本地 mock
    if (email === 'admin' && password === 'admin') {
      sessionStorage.setItem('mock_admin', '1');
      return true;
    }
    throw new Error('账号或密码错误');
  }

  function signOut() {
    if (firebaseReady) auth.signOut();
    authToken = null;
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem('mock_admin');
  }

  function onAuth(cb) {
    if (proxyReady) {
      // 恢复已保存的 token
      const saved = localStorage.getItem(AUTH_KEY);
      if (saved) {
        authToken = saved;
        // 验证 token 是否有效（通过读取一个需登录的接口）
        apiFetch('/api/settings', 'PATCH', { _check: 1 }).then(() => cb({ email: 'admin' }))
          .catch(() => { authToken = null; localStorage.removeItem(AUTH_KEY); cb(null); });
      } else {
        cb(null);
      }
      return;
    }
    if (firebaseReady) {
      auth.onAuthStateChanged(cb);
    } else {
      cb(sessionStorage.getItem('mock_admin') === '1' ? { email: 'admin' } : null);
    }
  }

  async function changePassword(newPwd) {
    // PROXY/Firebase 模式都用 Firebase Auth 的更新接口（这里简化，提示用控制台改）
    throw new Error('请在 Firebase 控制台修改密码，或联系管理员');
  }

  /* ---------- 看板访问密码（仅读取 settings.view_password）---------- */
  function getViewPassword() {
    return (cache && cache.settings && cache.settings.view_password) || '';
  }
  function checkViewPassword(pwd) { return pwd === getViewPassword(); }
  function authView(pwd) {
    if (checkViewPassword(pwd)) { sessionStorage.setItem(VIEW_KEY, '1'); return true; }
    return false;
  }
  function isViewAuthed() { return sessionStorage.getItem(VIEW_KEY) === '1'; }
  function clearViewAuth() { sessionStorage.removeItem(VIEW_KEY); }
  async function setViewPassword(newPwd) {
    if (!cache) cache = await load();
    if (!cache.settings) cache.settings = {};
    cache.settings.view_password = newPwd;
    cache.settings.updated_at = nowStr();
    if (proxyReady) {
      await apiFetch('/api/settings', 'PATCH', { view_password: newPwd, updated_at: cache.settings.updated_at });
    } else if (firebaseReady) {
      await db.ref('settings/view_password').set(newPwd);
    } else {
      saveLocal(cache);
    }
  }

  /* ---------- 工具 ---------- */
  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function normalizeStructure(d) {
    d = d || {};
    const sumRaw = d.summary || [];
    const summary = sumRaw.map(s => {
      if (typeof s === 'string') return { text: s, color: '', bold: false };
      return { text: s.text || '', color: s.color || '', bold: !!s.bold };
    });
    return {
      meta: d.meta || { week_label: '', generated_at: nowStr() },
      title: d.title || 'AI模型 Tokens 消耗数据库',
      summary,
      kpi: d.kpi && d.kpi.length ? d.kpi : [
        { label: '本周总消耗', value: '—', trend: '' },
        { label: '增速最快模型', value: '—', trend: '' },
        { label: '数据周期', value: '—', trend: '每周更新' }
      ],
      modules: (d.modules || []).map(m => ({
        title: m.title || '', comment: m.comment || '', visible: m.visible !== false
      })),
      top10: (d.top10 || []).map(t => ({
        rank: t.rank, name: t.name || '', tokens: t.tokens || 0,
        wow_num: t.wow_num != null ? t.wow_num : null, up: !!t.up,
        tokens_text: t.tokens_text || (t.tokens != null ? t.tokens + 'T Tokens' : ''),
        wow_text: t.wow_text || (t.wow_num != null ? '环比'+(t.wow_num>=0?'+':'')+t.wow_num+'%' : '')
      })),
      footer: d.footer || '来源：Openrouter · 欢迎交流',
      total_history: d.total_history || { dates: [], values: [], wow: [] },
      domestic: d.domestic || { dates: [], total_T: [], total_wow: [], global_T: [], share: [], models: {} },
      settings: Object.assign({ updated_at: nowStr(), view_password: '' }, d.settings || {})
    };
  }

  return {
    init, load, save, saveCharts, onChange,
    isConfigured, getMode, signIn, signOut, onAuth, changePassword,
    getViewPassword, checkViewPassword, authView, isViewAuthed, clearViewAuth, setViewPassword,
    normalizeStructure
  };
})();
