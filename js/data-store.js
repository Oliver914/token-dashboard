/* =========================================================
   数据抽象层 · 统一接口，屏蔽后端实现
   =========================================================
   对外暴露：
     DataStore.init()         初始化（异步）
     DataStore.load()         读取全部数据（返回完整 content+charts 对象）
     DataStore.save(content)  保存内容（看板文字/KPI/模块/排名/页脚）
     DataStore.saveCharts(charts)  保存图表数据
     DataStore.onChange(cb)   数据变化时回调（看板实时刷新用）
     DataStore.isConfigured() 是否接入了真实 Firebase

   后端优先级：
     1. 真实 Firebase（配置好后）
     2. localStorage 本地存储（mock 模式，用于无 Firebase 时预览/编辑）
   --------------------------------------------------------- */

const DataStore = (() => {
  let db = null;          // firebase.database 实例
  let auth = null;        // firebase.auth
  let firebaseReady = false;
  let listeners = [];
  let cache = null;       // 内存缓存

  const LS_KEY = 'token_dashboard_data_v1';

  /* ---------- 初始化 ---------- */
  async function init() {
    if (FIREBASE_CONFIGURED && window.firebase) {
      try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        auth = firebase.auth();
        firebaseReady = true;
        // 监听数据变化
        db.ref('/').on('value', snap => {
          cache = flattenCloudData(snap.val() || {});
          listeners.forEach(cb => cb(cache));
        });
        return true;
      } catch (e) {
        console.warn('Firebase 初始化失败，回退到本地存储：', e);
        firebaseReady = false;
      }
    }
    // 本地 mock 模式
    cache = loadLocal();
    return false;
  }

  function isConfigured() { return firebaseReady; }

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
    if (firebaseReady) {
      const snap = await db.ref('/').get();
      cache = flattenCloudData(snap.val() || {});
      return cache;
    }
    // 本地：先 localStorage，没有则 fetch data.json（首次访问）
    if (cache) return cache;
    const local = loadLocal();
    if (local) { cache = local; return local; }
    try {
      const res = await fetch('data.json?v=' + Date.now());
      cache = await res.json();
      // 写入标准结构（保证 save 字段齐全）
      cache = normalizeStructure(cache);
      saveLocal(cache);
      return cache;
    } catch (e) {
      return normalizeStructure({});
    }
  }

  /* ---------- 结构归一化 ----------
     Firebase 存的是嵌套结构 {content:{...}, charts:{...}, settings:{...}}，
     前端期望扁平结构 {title, summary, kpi, ..., total_history, domestic, settings}。
     本函数把云端数据摊平成前端可用的形式。data.json 已是扁平的，原样返回。
  --------------------------------------------------------- */
  function flattenCloudData(d) {
    if (!d) return normalizeStructure({});
    // 如果根级就有 title（data.json 扁平结构），直接返回
    if (d.title || d.summary || d.kpi) return d;
    // 否则是云端嵌套结构，把 content 摊到根级
    const content = d.content || {};
    return {
      ...content,
      charts: d.charts,
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
    if (firebaseReady) {
      // 把扁平字段重新打包成 content 节点写入云端
      const contentNode = {
        title: cache.title, summary: cache.summary, kpi: cache.kpi,
        modules: cache.modules, top10: cache.top10, footer: cache.footer, meta: cache.meta
      };
      await db.ref('content').set(contentNode);
      await db.ref('settings').set(cache.settings);
      cache.content = contentNode; // 同步内存，避免下次 flatten 出错
    } else {
      saveLocal(cache);
      listeners.forEach(cb => cb(cache));
    }
  }

  async function saveCharts(charts) {
    if (!cache) cache = {};
    cache = { ...cache, charts, settings: { ...(cache.settings||{}), updated_at: nowStr() } };
    if (firebaseReady) {
      // Firebase 数组会丢弃前导 null，推送前把数值数组里的 null 转成 0
      await db.ref('charts').set(sanitizeForFirebase(charts));
      await db.ref('settings').set(cache.settings);
    } else {
      saveLocal(cache);
      listeners.forEach(cb => cb(cache));
    }
  }

  // Firebase 数组特性：前导 null 会被丢弃导致数组错位。
  // 推送前把数值数组里的 null 转成 0（柱状图里 0 高度 = 视觉无数据）。
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

  /* ---------- 登录（仅 Firebase 模式） ---------- */
  async function signIn(email, password) {
    if (!firebaseReady) {
      // mock：固定 admin/admin
      if (email === 'admin' && password === 'admin') {
        sessionStorage.setItem('mock_admin', '1');
        return true;
      }
      throw new Error('账号或密码错误');
    }
    await auth.signInWithEmailAndPassword(email, password);
    return true;
  }
  function signOut() {
    if (firebaseReady) auth.signOut();
    sessionStorage.removeItem('mock_admin');
  }
  function onAuth(cb) {
    if (firebaseReady) {
      auth.onAuthStateChanged(cb);
    } else {
      cb(sessionStorage.getItem('mock_admin') === '1' ? { email: 'admin' } : null);
    }
  }
  async function changePassword(newPwd) {
    if (!firebaseReady) { sessionStorage.setItem('mock_admin','1'); return true; }
    const user = auth.currentUser;
    if (user) await user.updatePassword(newPwd);
  }

  /* ---------- 工具 ---------- */
  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 把任意输入规整成标准结构（保证所有字段存在，避免渲染时 undefined）
  function normalizeStructure(d) {
    d = d || {};
    const sumRaw = d.summary || [];
    // summary 支持两种格式：纯字符串数组 / 对象数组 {text,color,bold}
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
      settings: Object.assign({ updated_at: nowStr(), view_password: 'token2026' }, d.settings || {})
    };
  }

  /* ---------- 看板访问密码（独立于管理员登录）---------- */
  const VIEW_PWD_KEY = 'view_authed';
  function getViewPassword() {
    return (cache && cache.settings && cache.settings.view_password) || 'token2026';
  }
  function checkViewPassword(pwd) {
    return pwd === getViewPassword();
  }
  function authView(pwd) {
    if (checkViewPassword(pwd)) { sessionStorage.setItem(VIEW_PWD_KEY, '1'); return true; }
    return false;
  }
  function isViewAuthed() {
    return sessionStorage.getItem(VIEW_PWD_KEY) === '1';
  }
  function clearViewAuth() { sessionStorage.removeItem(VIEW_PWD_KEY); }
  async function setViewPassword(newPwd) {
    if (!cache) cache = await load();
    if (!cache.settings) cache.settings = {};
    cache.settings.view_password = newPwd;
    cache.settings.updated_at = nowStr();
    if (firebaseReady) {
      await db.ref('settings/view_password').set(newPwd);
    } else {
      saveLocal(cache);
    }
  }

  return {
    init, load, save, saveCharts, onChange,
    isConfigured, signIn, signOut, onAuth, changePassword,
    normalizeStructure,
    // 看板访问密码
    getViewPassword, checkViewPassword, authView, isViewAuthed, clearViewAuth, setViewPassword
  };
})();
