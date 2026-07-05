/* =========================================================
   管理后台逻辑 · 登录 + 路由 + 各编辑面板
   =========================================================
   工作模型：
     - 一个全局 state 对象，所有编辑都改它
     - 顶部「保存全部」把 state 写入 DataStore → 看板实时刷新
     - 表格编辑：contenteditable-free，用 input 双向绑定
   --------------------------------------------------------- */

// 预设颜色板
const PRESET_COLORS = [
  { v: '#ED7D31', n: '品牌橙' },
  { v: '#e74c3c', n: '红' },
  { v: '#2e7d32', n: '绿' },
  { v: '#1565c0', n: '蓝' },
  { v: '#8e44ad', n: '紫' },
  { v: '#b8860b', n: '金' },
];

// 当前编辑态
let state = null;
let dirty = false;

/* ============ 启动 ============ */
document.addEventListener('DOMContentLoaded', async () => {
  await DataStore.init();
  setupLogin();
  setupNav();
  setupGlobalActions();
  // 监听登录态
  DataStore.onAuth(user => {
    if (user) showApp();
  });
  // 模式徽标
  document.getElementById('modeBadge').textContent = DataStore.isConfigured() ? '已连接云端' : '本地预览';
  document.getElementById('modeBadge').classList.toggle('live', DataStore.isConfigured());
  document.getElementById('loginHint').textContent = DataStore.isConfigured()
    ? '使用账号密码登录（首次为 admin / admin，登录后请尽快修改）。'
    : '本地预览模式（未配置 Firebase）。账号 admin / admin 即可进入，编辑结果保存在当前浏览器。配置 Firebase 后可在多设备同步，详见 README.md。';
});

/* ============ 登录 ============ */
function setupLogin() {
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('loginUser').value.trim();
    const pwd = document.getElementById('loginPwd').value;
    const err = document.getElementById('loginError');
    const btn = document.getElementById('loginSubmit');
    err.textContent = '';
    btn.textContent = '登录中…'; btn.disabled = true;
    try {
      await DataStore.signIn(user, pwd);
      showApp();
    } catch (e) {
      err.textContent = e.message || '登录失败';
    } finally {
      btn.textContent = '登 录'; btn.disabled = false;
    }
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    DataStore.signOut();
    document.getElementById('appView').style.display = 'none';
    document.getElementById('loginView').style.display = 'flex';
    document.getElementById('loginPwd').value = '';
  });
}

async function showApp() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appView').style.display = '';
  // 加载数据到 state
  state = DataStore.normalizeStructure(await DataStore.load());
  document.getElementById('topbarUser').textContent =
    DataStore.isConfigured() ? (state.settings && state.settings.admin_user || 'admin') : 'admin';
  // 渲染所有面板
  renderAllPanes();
  markSaved();
}

/* ============ 导航 ============ */
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const pane = item.dataset.pane;
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      document.getElementById('pane-' + pane).classList.add('active');
    });
  });
}

/* ============ 全局操作 ============ */
function setupGlobalActions() {
  document.getElementById('saveBtn').addEventListener('click', saveAll);
  document.getElementById('reloadBtn').addEventListener('click', async () => {
    if (!confirm('从本地 data.json 重新载入？未保存的修改会丢失。')) return;
    try {
      const res = await fetch('data.json?v=' + Date.now());
      const fresh = await res.json();
      const normalized = DataStore.normalizeStructure(fresh);
      // 只重载图表数据，保留文字编辑（避免覆盖未保存的文字）
      state.total_history = normalized.total_history;
      state.domestic = normalized.domestic;
      state.meta = normalized.meta;
      renderTotalTable();
      renderDomesticTable();
      markDirty();
    } catch (e) { alert('重载失败：' + e.message); }
  });
}

function markDirty() {
  dirty = true;
  const s = document.getElementById('actionStatus');
  s.innerHTML = '<span class="dot dirty"></span><span>有未保存的修改</span>';
}
function markSaved() {
  dirty = false;
  const s = document.getElementById('actionStatus');
  s.innerHTML = '<span class="dot saved"></span><span>已同步</span>';
}
function markSaving() {
  const s = document.getElementById('actionStatus');
  s.innerHTML = '<span class="dot saving"></span><span>保存中…</span>';
}

async function saveAll() {
  if (!state) return;
  markSaving();
  // 同步 KPI/模块/排名等表单 → state
  syncFormsToState();
  try {
    await DataStore.save({
      title: state.title, summary: state.summary, kpi: state.kpi,
      modules: state.modules, top10: state.top10, footer: state.footer,
      meta: state.meta
    });
    if (state.total_history || state.domestic) {
      await DataStore.saveCharts({ total_history: state.total_history, domestic: state.domestic });
    }
    markSaved();
  } catch (e) {
    alert('保存失败：' + e.message);
    markDirty();
  }
}

// 表单值 → state（编辑器即时改 DOM，保存前同步）
function syncFormsToState() {
  // summary
  const lines = document.querySelectorAll('#mdLines .md-line');
  state.summary = Array.from(lines).map(line => {
    const ta = line.querySelector('textarea');
    const colorIn = line.querySelector('.line-color');
    return {
      text: ta ? ta.value : '',
      color: colorIn && colorIn.value && colorIn.value !== '#000000' ? colorIn.value : '',
      bold: line.dataset.bold === '1'
    };
  });
  // kpi
  state.kpi = Array.from(document.querySelectorAll('.kpi-edit-card')).map(card => ({
    label: card.querySelector('.ke-label').value,
    value: card.querySelector('.ke-value').value,
    trend: card.querySelector('.ke-trend').value
  }));
  // modules
  state.modules = Array.from(document.querySelectorAll('.module-edit-card')).map(card => ({
    title: card.querySelector('.me-title').value,
    comment: card.querySelector('.me-comment').value,
    visible: card.querySelector('.switch input').checked
  }));
  // top10
  state.top10 = readTop10FromTable();
  // total / domestic
  state.total_history = readTotalFromTable();
  state.domestic = readDomesticFromTable();
  // misc
  state.title = document.getElementById('titleInput').value;
  state.footer = document.getElementById('footerInput').value;
  if (document.getElementById('periodInput')) {
    // 数据周期写入 kpi[2].value
    if (state.kpi[2]) state.kpi[2].value = document.getElementById('periodInput').value;
  }
}

/* =========================================================
   渲染各面板
   ========================================================= */
function renderAllPanes() {
  renderSummaryEditor();
  renderKpiEditor();
  renderModuleEditor();
  renderTop10Table();
  renderTotalTable();
  renderDomesticTable();
  renderMisc();
  renderAccount();
  setupSummaryEditorEvents();
  setupKpiEvents();
  setupModuleEvents();
  setupTop10Events();
  setupTotalEvents();
  setupDomesticEvents();
  setupMiscEvents();
  setupChartsImportEvents();
  setupAccountEvents();
}

/* ---------- 本周总结 ---------- */
function renderSummaryEditor() {
  const box = document.getElementById('mdLines');
  // 颜色色板
  const sw = document.getElementById('colorSwatches');
  sw.innerHTML = `<label class="swatch-none" title="默认色"><input type="radio" name="mdColor" value="" checked /><span>A</span></label>` +
    PRESET_COLORS.map(c =>
      `<label title="${c.n}" style="background:${c.v}"><input type="radio" name="mdColor" value="${c.v}" /><span style="visibility:hidden">A</span></label>`
    ).join('');

  box.innerHTML = state.summary.map((s, i) => summaryLineHtml(s, i)).join('');
  updateSummaryPreview();
}
function summaryLineHtml(s, i) {
  const color = (s && s.color) || '#000000';
  return `<div class="md-line" data-idx="${i}" data-bold="${(s&&s.bold)?'1':'0'}">
    <span class="line-no">${i+1}</span>
    <textarea placeholder="输入这一行内容…支持 **加粗** 和 *斜体*">${escapeAttr((s&&s.text)||'')}</textarea>
    <input type="color" class="line-color" value="${color}" title="这一行的颜色" />
  </div>`;
}
function setupSummaryEditorEvents() {
  const box = document.getElementById('mdLines');
  box.addEventListener('input', () => { markDirty(); updateSummaryPreview(); });
  // 工具栏
  document.querySelector('.md-toolbar').addEventListener('click', async (e) => {
    const btn = e.target.closest('.md-tool');
    if (!btn) return;
    const act = btn.dataset.act;
    // 找当前焦点的 textarea
    const ta = document.activeElement;
    if (act === 'addLine') {
      const newIdx = state.summary.length;
      state.summary.push({ text: '', color: '', bold: false });
      document.getElementById('mdLines').insertAdjacentHTML('beforeend',
        summaryLineHtml(state.summary[newIdx], newIdx));
      markDirty();
      return;
    }
    if (act === 'delLine') {
      // 删掉焦点所在行
      const line = ta.closest('.md-line');
      if (!line) return;
      const idx = +line.dataset.idx;
      state.summary.splice(idx, 1);
      renderSummaryEditor();
      markDirty();
      return;
    }
    if (!ta || ta.tagName !== 'TEXTAREA') { alert('请先把光标点进文本框'); return; }
    if (act === 'bold') wrapSel(ta, '**', '**');
    if (act === 'italic') wrapSel(ta, '*', '*');
    ta.dispatchEvent(new Event('input'));
  });
  // 应用色板到当前行
  document.getElementById('colorSwatches').addEventListener('change', (e) => {
    if (e.target.name !== 'mdColor') return;
    const ta = document.activeElement;
    const line = ta && ta.closest && ta.closest('.md-line');
    if (!line) return;
    line.querySelector('.line-color').value = e.target.value || '#000000';
    line.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.getElementById('customColor').addEventListener('input', (e) => {
    const ta = document.activeElement;
    const line = ta && ta.closest && ta.closest('.md-line');
    if (!line) return;
    line.querySelector('.line-color').value = e.target.value;
    line.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function wrapSel(ta, before, after) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const val = ta.value;
  ta.value = val.slice(0, s) + before + val.slice(s, e) + after + val.slice(e);
  ta.selectionStart = s + before.length;
  ta.selectionEnd = e + before.length;
  ta.focus();
}
function updateSummaryPreview() {
  syncSummaryToState();
  const box = document.getElementById('summaryPreview');
  box.innerHTML = state.summary.map((ln, i) => {
    let html = escapeHtml(ln.text || '');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    const style = (ln.color || ln.bold) ? ` style="${ln.color?'color:'+ln.color+';':''}${ln.bold?'font-weight:600;':''}"` : '';
    return `<p${style}>${html || '&nbsp;'}</p>`;
  }).join('');
}
function syncSummaryToState() {
  state.summary = Array.from(document.querySelectorAll('#mdLines .md-line')).map(line => ({
    text: line.querySelector('textarea').value,
    color: (() => {
      const v = line.querySelector('.line-color').value;
      return v && v !== '#000000' ? v : '';
    })(),
    bold: line.dataset.bold === '1'
  }));
}

/* ---------- KPI ---------- */
function renderKpiEditor() {
  const box = document.getElementById('kpiEditor');
  box.innerHTML = state.kpi.map((k, i) => `
    <div class="kpi-edit-card" data-idx="${i}">
      <div class="ke-title">KPI ${i+1}</div>
      <div class="ke-grid">
        <label class="field" style="margin:0">
          <span class="field-label">标签</span>
          <input type="text" class="ke-label" value="${escapeAttr(k.label||'')}" />
        </label>
        <label class="field" style="margin:0">
          <span class="field-label">主值</span>
          <input type="text" class="ke-value" value="${escapeAttr(k.value||'')}" />
        </label>
        <label class="field" style="margin:0">
          <span class="field-label">趋势/说明</span>
          <input type="text" class="ke-trend" value="${escapeAttr(k.trend||'')}" />
        </label>
      </div>
    </div>`).join('');
}
function setupKpiEvents() {
  document.getElementById('kpiEditor').addEventListener('input', markDirty);
}

/* ---------- 模块 ---------- */
function renderModuleEditor() {
  const box = document.getElementById('moduleEditor');
  box.innerHTML = state.modules.map((m, i) => `
    <div class="module-edit-card" data-idx="${i}">
      <div class="me-order">
        <button class="me-up" title="上移" ${i===0?'disabled':''}>▲</button>
        <button class="me-down" title="下移" ${i===state.modules.length-1?'disabled':''}>▼</button>
      </div>
      <div class="me-body">
        <label class="field" style="margin-bottom:10px">
          <span class="field-label">模块标题</span>
          <input type="text" class="me-title" value="${escapeAttr(m.title||'')}" />
        </label>
        <label class="field" style="margin:0">
          <span class="field-label">一句话点评</span>
          <input type="text" class="me-comment" value="${escapeAttr(m.comment||'')}" />
        </label>
      </div>
      <div class="me-actions">
        <label class="switch" title="显示/隐藏">
          <input type="checkbox" ${m.visible!==false?'checked':''} />
          <span class="slider"></span>
        </label>
        <button class="row-del me-del" title="删除">✕</button>
      </div>
    </div>`).join('');
}
function setupModuleEvents() {
  const box = document.getElementById('moduleEditor');
  box.addEventListener('input', markDirty);
  box.addEventListener('change', markDirty);
  box.addEventListener('click', async (e) => {
    const card = e.target.closest('.module-edit-card');
    if (!card) return;
    const idx = +card.dataset.idx;
    if (e.target.closest('.me-up') && idx > 0) {
      // 先同步表单，再交换
      state.modules = Array.from(document.querySelectorAll('.module-edit-card')).map(c => ({
        title: c.querySelector('.me-title').value,
        comment: c.querySelector('.me-comment').value,
        visible: c.querySelector('.switch input').checked
      }));
      [state.modules[idx-1], state.modules[idx]] = [state.modules[idx], state.modules[idx-1]];
      renderModuleEditor(); markDirty();
    }
    if (e.target.closest('.me-down') && idx < state.modules.length-1) {
      state.modules = Array.from(document.querySelectorAll('.module-edit-card')).map(c => ({
        title: c.querySelector('.me-title').value,
        comment: c.querySelector('.me-comment').value,
        visible: c.querySelector('.switch input').checked
      }));
      [state.modules[idx+1], state.modules[idx]] = [state.modules[idx], state.modules[idx+1]];
      renderModuleEditor(); markDirty();
    }
    if (e.target.closest('.me-del')) {
      if (!confirm('删除该模块？')) return;
      state.modules = Array.from(document.querySelectorAll('.module-edit-card')).map(c => ({
        title: c.querySelector('.me-title').value,
        comment: c.querySelector('.me-comment').value,
        visible: c.querySelector('.switch input').checked
      }));
      state.modules.splice(idx, 1);
      renderModuleEditor(); markDirty();
    }
  });
  document.getElementById('addModuleBtn').addEventListener('click', () => {
    state.modules.push({ title: '新模块', comment: '', visible: true });
    renderModuleEditor(); markDirty();
  });
}

/* ---------- 前 10 排名 ---------- */
function renderTop10Table() {
  const body = document.getElementById('top10Body');
  body.innerHTML = state.top10.map((t, i) => `
    <tr data-idx="${i}">
      <td><span class="line-no" style="color:var(--gray-2);font-size:12px">${i+1}</span></td>
      <td><input type="text" class="t-name" value="${escapeAttr(t.name||'')}" /></td>
      <td><input type="number" step="0.01" class="t-tokens" value="${t.tokens!=null?t.tokens:''}" /></td>
      <td><input type="number" step="0.1" class="t-wow" value="${t.wow_num!=null?t.wow_num:''}" /></td>
      <td><button class="row-del" title="删除">✕</button></td>
    </tr>`).join('');
}
function setupTop10Events() {
  const body = document.getElementById('top10Body');
  body.addEventListener('input', markDirty);
  body.addEventListener('click', (e) => {
    if (!e.target.closest('.row-del')) return;
    const tr = e.target.closest('tr');
    const idx = +tr.dataset.idx;
    state.top10 = readTop10FromTable();
    state.top10.splice(idx, 1);
    state.top10.forEach((t, i) => t.rank = i + 1);
    renderTop10Table(); markDirty();
  });
  document.getElementById('addRankBtn').addEventListener('click', () => {
    state.top10 = readTop10FromTable();
    state.top10.push({ rank: state.top10.length+1, name: '', tokens: 0, wow_num: 0, up: false });
    renderTop10Table(); markDirty();
  });
}
function readTop10FromTable() {
  return Array.from(document.querySelectorAll('#top10Body tr')).map((tr, i) => {
    const tokens = parseFloat(tr.querySelector('.t-tokens').value);
    const wow = parseFloat(tr.querySelector('.t-wow').value);
    return {
      rank: i + 1,
      name: tr.querySelector('.t-name').value.trim(),
      tokens: isNaN(tokens) ? 0 : tokens,
      wow_num: isNaN(wow) ? null : wow,
      up: wow != null && wow >= 0,
      tokens_text: (isNaN(tokens)?'':tokens + 'T Tokens'),
      wow_text: isNaN(wow) ? '' : '环比' + (wow>=0?'+':'') + wow + '%'
    };
  });
}

/* ---------- 总消耗曲线 ---------- */
function renderTotalTable() {
  const body = document.getElementById('totalBody');
  const th = state.total_history;
  const rows = Math.max(th.dates.length, 0);
  let html = '';
  for (let i = 0; i < rows; i++) {
    html += `<tr data-idx="${i}">
      <td><input type="text" class="d-date" value="${escapeAttr(th.dates[i]||'')}" /></td>
      <td><input type="number" step="0.01" class="d-val" value="${th.values[i]!=null?th.values[i]:''}" /></td>
      <td><input type="number" step="0.1" class="d-wow" value="${th.wow[i]!=null?th.wow[i]:''}" /></td>
      <td><button class="row-del">✕</button></td>
    </tr>`;
  }
  body.innerHTML = html;
  // 总表加一列删除
  if (!document.querySelector('#totalTable th.del')) {
    document.querySelector('#totalTable thead tr').insertAdjacentHTML('beforeend', '<th class="del" style="width:60px">操作</th>');
  }
}
function setupTotalEvents() {
  const body = document.getElementById('totalBody');
  body.addEventListener('input', markDirty);
  body.addEventListener('click', (e) => {
    if (!e.target.closest('.row-del')) return;
    const idx = +e.target.closest('tr').dataset.idx;
    state.total_history = readTotalFromTable();
    ['dates','values','wow'].forEach(k => state.total_history[k].splice(idx,1));
    renderTotalTable(); markDirty();
  });
  document.getElementById('addTotalRowBtn').addEventListener('click', () => {
    state.total_history = readTotalFromTable();
    state.total_history.dates.push('');
    state.total_history.values.push(null);
    state.total_history.wow.push(null);
    renderTotalTable(); markDirty();
  });
}
function readTotalFromTable() {
  const trs = document.querySelectorAll('#totalBody tr');
  return {
    dates: Array.from(trs).map(tr => tr.querySelector('.d-date').value.trim()),
    values: Array.from(trs).map(tr => { const v = parseFloat(tr.querySelector('.d-val').value); return isNaN(v)?null:v; }),
    wow: Array.from(trs).map(tr => { const v = parseFloat(tr.querySelector('.d-wow').value); return isNaN(v)?null:v; })
  };
}

/* ---------- 国产模型明细 ---------- */
function renderDomesticTable() {
  const dom = state.domestic;
  const models = Object.keys(dom.models || {});
  const head = document.getElementById('domesticHead');
  // 表头：周日期 | 各模型值(可删) | 国产总和 | 国产环比 | 全球总和 | 份额
  let th = '<tr><th>周日期</th>';
  models.forEach(m => th += `<th class="th-model" data-model="${escapeAttr(m)}" title="点击 ✕ 删除该厂商列">${escapeHtml(m)}(T) <button class="col-del" data-model="${escapeAttr(m)}" title="删除厂商">✕</button></th>`);
  th += '<th>国产总和</th><th>国产环比%</th><th>全球总和</th><th>份额%</th><th>操作</th></tr>';
  head.innerHTML = th;
  // 行
  const body = document.getElementById('domesticBody');
  const n = dom.dates.length;
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<tr data-idx="${i}"><td><input type="text" class="dm-date" value="${escapeAttr(dom.dates[i]||'')}" /></td>`;
    models.forEach(m => {
      const v = dom.models[m].values_T[i];
      html += `<td><input type="number" step="0.001" class="dm-val" data-model="${escapeAttr(m)}" value="${v!=null?v:''}" /></td>`;
    });
    html += `<td><input type="number" step="0.001" class="dm-total" value="${dom.total_T[i]!=null?dom.total_T[i]:''}" /></td>`;
    html += `<td><input type="number" step="0.1" class="dm-totalwow" value="${dom.total_wow[i]!=null?dom.total_wow[i]:''}" /></td>`;
    html += `<td><input type="number" step="0.001" class="dm-global" value="${dom.global_T[i]!=null?dom.global_T[i]:''}" /></td>`;
    html += `<td><input type="number" step="0.1" class="dm-share" value="${dom.share[i]!=null?dom.share[i]:''}" /></td>`;
    html += `<td><button class="row-del">✕</button></td></tr>`;
  }
  body.innerHTML = html;
}
function setupDomesticEvents() {
  const body = document.getElementById('domesticBody');
  const head = document.getElementById('domesticHead');
  body.addEventListener('input', markDirty);
  body.addEventListener('click', (e) => {
    if (!e.target.closest('.row-del')) return;
    const idx = +e.target.closest('tr').dataset.idx;
    state.domestic = readDomesticFromTable();
    ['dates','total_T','total_wow','global_T','share'].forEach(k => state.domestic[k].splice(idx,1));
    Object.keys(state.domestic.models).forEach(m => {
      state.domestic.models[m].values_T.splice(idx,1);
      state.domestic.models[m].wow.splice(idx,1);
    });
    renderDomesticTable(); markDirty();
  });
  // 删除厂商列（点表头的 ✕）
  head.addEventListener('click', (e) => {
    const btn = e.target.closest('.col-del');
    if (!btn) return;
    const m = btn.dataset.model;
    if (!confirm(`删除厂商「${m}」及其所有数据？`)) return;
    state.domestic = readDomesticFromTable();
    delete state.domestic.models[m];
    renderDomesticTable(); markDirty();
  });
  document.getElementById('addDomRowBtn').addEventListener('click', () => {
    state.domestic = readDomesticFromTable();
    state.domestic.dates.push('');
    state.domestic.total_T.push(null);
    state.domestic.total_wow.push(null);
    state.domestic.global_T.push(null);
    state.domestic.share.push(null);
    Object.keys(state.domestic.models).forEach(m => {
      state.domestic.models[m].values_T.push(null);
      state.domestic.models[m].wow.push(null);
    });
    renderDomesticTable(); markDirty();
  });
  // + 厂商：弹框输入名字，新增一列
  const addModelBtn = document.getElementById('addModelBtn');
  if (addModelBtn) addModelBtn.addEventListener('click', () => {
    // 用配置里的预设 + 自定义
    const configured = (typeof getModelNames === 'function') ? getModelNames() : [];
    const existing = Object.keys(state.domestic.models);
    const suggestions = configured.filter(m => !existing.includes(m));
    let hint = suggestions.length ? `（建议：${suggestions.slice(0,5).join(' / ')}）` : '';
    const name = prompt('输入新厂商名称' + hint + '\n注意：名称将作为看板小图标题和导出列名。', suggestions[0] || '');
    if (!name || !name.trim()) return;
    const nm = name.trim();
    if (state.domestic.models[nm]) { alert('该厂商已存在'); return; }
    state.domestic = readDomesticFromTable();
    const n = state.domestic.dates.length;
    state.domestic.models[nm] = { values_T: new Array(n).fill(null), wow: new Array(n).fill(null) };
    renderDomesticTable(); markDirty();
  });
}
function readDomesticFromTable() {
  const trs = document.querySelectorAll('#domesticBody tr');
  const models = Object.keys(state.domestic.models);
  const dates = [], total_T = [], total_wow = [], global_T = [], share = [];
  const modelData = {};
  models.forEach(m => modelData[m] = { values_T: [], wow: [] });
  trs.forEach(tr => {
    dates.push(tr.querySelector('.dm-date').value.trim());
    models.forEach(m => {
      const inp = tr.querySelector(`.dm-val[data-model="${CSS.escape(m)}"]`);
      const v = parseFloat(inp.value);
      modelData[m].values_T.push(isNaN(v)?null:v);
      // wow 列在国产明细表格里没有单独列，保留原值或 null
      modelData[m].wow.push(null);
    });
    const tot = parseFloat(tr.querySelector('.dm-total').value); total_T.push(isNaN(tot)?null:tot);
    const tw = parseFloat(tr.querySelector('.dm-totalwow').value); total_wow.push(isNaN(tw)?null:tw);
    const g = parseFloat(tr.querySelector('.dm-global').value); global_T.push(isNaN(g)?null:g);
    const sh = parseFloat(tr.querySelector('.dm-share').value); share.push(isNaN(sh)?null:sh);
  });
  return { dates, total_T, total_wow, global_T, share, models: modelData };
}

/* ---------- 标题/页脚 ---------- */
function renderMisc() {
  document.getElementById('titleInput').value = state.title || '';
  document.getElementById('footerInput').value = state.footer || '';
  document.getElementById('periodInput').value = (state.kpi[2] && state.kpi[2].value) || '';
}
function setupMiscEvents() {
  ['titleInput','footerInput','periodInput'].forEach(id =>
    document.getElementById(id).addEventListener('input', markDirty));
}

/* ---------- 账号 ---------- */
function renderAccount() {
  const info = document.getElementById('accountInfo');
  info.innerHTML = DataStore.isConfigured()
    ? `当前登录方式：<b>Firebase 账号密码</b>。账号：${escapeHtml(state.settings?.admin_user || 'admin')}。修改密码将作用于云端账号。`
    : `当前为 <b>本地预览模式</b>，账号密码仅保存在本浏览器。配置 Firebase 后才可在云端生效。`;
}
function setupAccountEvents() {
  document.getElementById('changePwdBtn').addEventListener('click', async () => {
    const p1 = document.getElementById('newPwd').value;
    const p2 = document.getElementById('newPwd2').value;
    const msg = document.getElementById('pwdMsg');
    msg.textContent = '';
    if (p1.length < 6) { msg.textContent = '密码至少 6 位'; return; }
    if (p1 !== p2) { msg.textContent = '两次输入不一致'; return; }
    try {
      await DataStore.changePassword(p1);
      msg.style.color = '#2e7d32';
      msg.textContent = '✓ 密码已修改';
      document.getElementById('newPwd').value = '';
      document.getElementById('newPwd2').value = '';
    } catch (e) { msg.textContent = '修改失败：' + e.message; }
  });
}

/* ---------- 图表数据 Tab ---------- */
function setupChartsImportEvents() {
  document.querySelectorAll('#pane-charts .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#pane-charts .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('#pane-charts .tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById('tp-' + tab.dataset.tab).classList.add('active');
    });
  });
  // Excel 上传
  document.getElementById('excelPickBtn').addEventListener('click', () =>
    document.getElementById('excelFile').click());
  document.getElementById('excelFile').addEventListener('change', handleExcelUpload);
  document.getElementById('downloadTplBtn').addEventListener('click', () => {
    if (window.downloadTemplateExcel) window.downloadTemplateExcel();
  });
  document.getElementById('excelConfirmBtn').addEventListener('click', confirmExcelImport);
}

let pendingImport = null;
async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('excelFileName').textContent = file.name;
  const preview = document.getElementById('excelPreview');
  const actions = document.getElementById('excelActions');
  preview.innerHTML = '<div style="color:var(--gray);padding:20px">解析中…</div>';
  actions.style.display = 'none';
  try {
    const parsed = await window.parseTokenExcel(file);
    pendingImport = parsed;
    // 预览
    let html = '<div style="margin-bottom:14px;font-weight:600">总消耗曲线（前 5 行）</div>';
    html += miniTable(['周起始','总量(T)','环比%'],
      parsed.total_history.dates.slice(0,5).map((d,i)=>[d, parsed.total_history.values[i], parsed.total_history.wow[i]]));
    html += '<div style="margin:18px 0 14px;font-weight:600">国产模型（前 5 行）</div>';
    const dm = parsed.domestic;
    html += miniTable(['周日期','国产总和','全球总和','份额%'],
      dm.dates.slice(0,5).map((d,i)=>[d, dm.total_T[i], dm.global_T[i], dm.share[i]]));
    preview.innerHTML = html;
    document.getElementById('excelParseInfo').textContent =
      `解析成功：${parsed.total_history.dates.length} 周总量数据，${parsed.domestic.dates.length} 周国产数据`;
    actions.style.display = 'flex';
  } catch (err) {
    preview.innerHTML = `<div style="color:#e74c3c;padding:20px;line-height:1.7">${escapeHtml(err.message||err)}</div>`;
    actions.style.display = 'none';
  }
}
function confirmExcelImport() {
  if (!pendingImport) return;
  state.total_history = pendingImport.total_history;
  state.domestic = pendingImport.domestic;
  if (pendingImport.meta) state.meta = { ...state.meta, ...pendingImport.meta };
  renderTotalTable();
  renderDomesticTable();
  markDirty();
  document.getElementById('excelParseInfo').textContent = '✓ 已导入，请点击「保存全部」生效';
}
function miniTable(headers, rows) {
  let h = '<table><thead><tr>' + headers.map(x=>`<th>${escapeHtml(x)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(r => { h += '<tr>' + r.map(c => `<td>${c==null||c===''?'<span style="color:#ccc">—</span>':escapeHtml(String(c))}</td>`).join('') + '</tr>'; });
  return h + '</tbody></table>';
}

/* ---------- 离开提醒 ---------- */
window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) {
  return String(s==null?'':s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
