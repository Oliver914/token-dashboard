/* =========================================================
   Token 看板 · Firebase 代理后端
   =========================================================
   作用：国内客户访问你服务器的 /api/* ，本服务转发给 Firebase，
         避免国内直连 Google 不稳定。
   端口：3000（仅本机访问，由 Nginx 反代到 443）
   ---------------------------------------------------------
   接口（与前端 data-store.js 对应）：
     GET  /api/data          读取全部数据（content+charts+settings）
     PUT  /api/content       覆盖写 content（需登录）
     PUT  /api/charts        覆盖写 charts（需登录）
     PATCH /api/settings     合并写 settings（需登录）
     POST /api/login         登录验证（用 Firebase Auth）
   --------------------------------------------------------- */

const http = require('http');
const https = require('https');

// ====== Firebase 配置（从 js/firebase-config.js 同步） ======
const FB = {
  apiKey: "AIzaSyDZQv008hUWsulJLnPHFbnlX1vE9KWPLHE",
  databaseURL: "https://tokenbase-69bd6-default-rtdb.asia-southeast1.firebasedatabase.app",
  authUrl: "https://identitytoolkit.googleapis.com/v1"
};

const PORT = 3000;

// ====== 工具：发起 HTTPS 请求 ======
function fetchHttps(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOpts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    };
    const req = https.request(reqOpts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch (e) { json = body; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

// Firebase REST 需要 null→0 处理（数组前导 null 会被 trim）
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

// 验证登录 token（Firebase Auth REST: verifyToken 不是免费的，这里用 getAccountInfo）
async function verifyToken(idToken) {
  if (!idToken) return null;
  const r = await fetchHttps(`${FB.authUrl}/accounts:lookup?key=${FB.apiKey}`, {
    method: 'POST',
    body: JSON.stringify({ idToken })
  });
  if (r.status === 200 && r.body && r.body.users && r.body.users.length > 0) {
    return r.body.users[0];
  }
  return null;
}

// ====== HTTP 服务 ======
const server = http.createServer(async (req, res) => {
  // CORS（虽然同源不需要，保险起见）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');

  // 收集请求体
  const readBody = () => new Promise((resolve) => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d));
  });

  try {
    // ---- 健康检查 ----
    if (path === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'token-dashboard-proxy', time: new Date().toISOString() }));
      return;
    }

    // ---- 读取全部数据（公开，看板用）----
    if (path === '/api/data' && req.method === 'GET') {
      const r = await fetchHttps(`${FB.databaseURL}/.json`);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
      return;
    }

    // ---- 以下接口需登录 ----
    if (path.startsWith('/api/') && ['PUT', 'PATCH', 'POST'].includes(req.method)) {
      const user = await verifyToken(idToken);
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '未登录或登录已过期' }));
        return;
      }

      const body = await readBody();

      // 登录接口（特殊：不需要预登录，前端用账号密码换 token）
      if (path === '/api/login' && req.method === 'POST') {
        const { email, password } = JSON.parse(body || '{}');
        const r = await fetchHttps(`${FB.authUrl}/accounts:signInWithPassword?key=${FB.apiKey}`, {
          method: 'POST',
          body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
        return;
      }

      // 写 content（覆盖）
      if (path === '/api/content' && req.method === 'PUT') {
        const r = await fetchHttps(`${FB.databaseURL}/content.json`, {
          method: 'PUT', body
        });
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
        return;
      }

      // 写 charts（覆盖，需 null→0 处理）
      if (path === '/api/charts' && req.method === 'PUT') {
        const data = JSON.parse(body || '{}');
        const clean = sanitizeForFirebase(data);
        const r = await fetchHttps(`${FB.databaseURL}/charts.json`, {
          method: 'PUT', body: JSON.stringify(clean)
        });
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
        return;
      }

      // 合并写 settings
      if (path === '/api/settings' && req.method === 'PATCH') {
        const r = await fetchHttps(`${FB.databaseURL}/settings.json`, {
          method: 'PATCH', body
        });
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未知接口: ' + path }));
  } catch (e) {
    console.error('请求处理失败:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '服务器错误: ' + e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ Token 看板代理服务运行中: http://127.0.0.1:${PORT}`);
  console.log(`  Firebase: ${FB.databaseURL}`);
});
