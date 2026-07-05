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
  const exportImgBtn = document.getElementById('exportImgBtn');
  if (exportImgBtn) exportImgBtn.addEventListener('click', exportDashboardImage);
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
  if (!trs.length) return state.total_history || {dates:[],values:[],wow:[]};
  return {
    dates: Array.from(trs).map(tr => { const el = tr.querySelector('.d-date'); return el ? el.value.trim() : ''; }),
    values: Array.from(trs).map(tr => { const el = tr.querySelector('.d-val'); const v = el ? parseFloat(el.value) : NaN; return isNaN(v)?null:v; }),
    wow: Array.from(trs).map(tr => { const el = tr.querySelector('.d-wow'); const v = el ? parseFloat(el.value) : NaN; return isNaN(v)?null:v; })
  };
}

/* ---------- 国产模型明细 ----------
   设计：
     - 每行 = 周日期 | 各厂商(值) | 各厂商(环比) | 国产总和 | 国产环比 | 全球总和 | 份额 | 操作
     - 「值」「全球总和」是手填输入
     - 「环比」「国产总和」「国产环比」「份额」默认自动计算，但可手动覆盖
     - 自动格子用灰底斜体显示；手动覆盖后变白底正常字（data-manual="1"）
     - 输入任一值列时，重算该行所有「非手动」的下游字段
------------------------------------- */

// 标记某格被手动覆盖（value 列输入不标 manual，因为它本就是手填的）
function markManual(input) {
  input.dataset.manual = '1';
  input.classList.remove('auto');
}
function isManual(input) { return input.dataset.manual === '1'; }

// 计算单行的派生字段（不修改 DOM，返回计算结果）
function calcDerived(tr) {
  const models = Object.keys(state.domestic.models);
  const vals = {};
  models.forEach(m => {
    const inp = tr.querySelector(`.dm-val[data-model="${CSS.escape(m)}"]`);
    const v = parseFloat(inp.value);
    vals[m] = isNaN(v) ? null : v;
  });
  // 国产总和 = 各厂商值之和（忽略 null）
  const sumVals = Object.values(vals).reduce((a,b) => a + (b||0), 0);
  const anyVal = Object.values(vals).some(v => v != null);
  // 该行 index
  const idx = +tr.dataset.idx;
  // 上一周各厂商值（用于算环比）
  const prevVals = {};
  if (idx > 0) {
    const prevTr = document.querySelector(`#domesticBody tr[data-idx="${idx-1}"]`);
    if (prevTr) {
      models.forEach(m => {
        const inp = prevTr.querySelector(`.dm-val[data-model="${CSS.escape(m)}"]`);
        const v = parseFloat(inp.value);
        prevVals[m] = isNaN(v) ? null : v;
      });
    }
  }
  // 各厂商环比
  const wows = {};
  models.forEach(m => {
    if (vals[m] == null || prevVals[m] == null || prevVals[m] === 0) wows[m] = null;
    else wows[m] = Math.round((vals[m] - prevVals[m]) / prevVals[m] * 1000) / 10;
  });
  // 国产总和
  const total = anyVal ? Math.round(sumVals * 1000) / 1000 : null;
  // 国产环比（用总和算）
  let totalWow = null;
  if (idx > 0) {
    const prevTotalInp = document.querySelector(`#domesticBody tr[data-idx="${idx-1}"] .dm-total`);
    if (prevTotalInp) {
      const pt = parseFloat(prevTotalInp.value);
      if (!isNaN(pt) && pt !== 0 && total != null) {
        totalWow = Math.round((total - pt) / pt * 1000) / 10;
      }
    }
  }
  // 份额
  const globalInp = tr.querySelector('.dm-global');
  const g = parseFloat(globalInp.value);
  let share = null;
  if (total != null && !isNaN(g) && g !== 0) {
    share = Math.round(total / g * 1000) / 10;
  }
  return { vals, wows, total, totalWow, global: isNaN(g)?null:g, share };
}

// 重算单行未被手动覆盖的格子
function recalcRow(tr) {
  const d = calcDerived(tr);
  const models = Object.keys(state.domestic.models);
  // 各厂商环比
  models.forEach(m => {
    const inp = tr.querySelector(`.dm-wow[data-model="${CSS.escape(m)}"]`);
    if (inp && !isManual(inp)) {
      inp.value = d.wows[m] == null ? '' : d.wows[m];
    }
  });
  // 国产总和
  const totInp = tr.querySelector('.dm-total');
  if (totInp && !isManual(totInp)) totInp.value = d.total == null ? '' : d.total;
  // 国产环比
  const twInp = tr.querySelector('.dm-totalwow');
  if (twInp && !isManual(twInp)) twInp.value = d.totalWow == null ? '' : d.totalWow;
  // 份额
  const shInp = tr.querySelector('.dm-share');
  if (shInp && !isManual(shInp)) shInp.value = d.share == null ? '' : d.share;
  // 修改了本周，下一行的环比/总和环比也要重算（因为依赖本周）
  const nextTr = document.querySelector(`#domesticBody tr[data-idx="${+tr.dataset.idx + 1}"]`);
  if (nextTr) recalcRow(nextTr);
}

function renderDomesticTable() {
  const dom = state.domestic;
  const models = Object.keys(dom.models || {});
  const head = document.getElementById('domesticHead');
  // 表头：周日期 | 各模型(值) | 各模型(环比) | 国产总和 | 国产环比 | 全球总和 | 份额
  let th = '<tr><th>周日期</th>';
  models.forEach(m => {
    th += `<th class="th-model" data-model="${escapeAttr(m)}" title="点击 ✕ 删除该厂商列">${escapeHtml(m)} (T) <button class="col-del" data-model="${escapeAttr(m)}" title="删除厂商">✕</button></th>`;
    th += `<th>${escapeHtml(m)} 环比%</th>`;
  });
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
      // 值列：手填
      html += `<td><input type="number" step="0.001" class="dm-val" data-model="${escapeAttr(m)}" value="${v!=null?v:''}" /></td>`;
      // 环比列：默认自动（auto），用户手动改过才转 manual；初始值先空，下面 recalcRow 统一填充
      html += `<td><input type="number" step="0.1" class="dm-wow auto" data-model="${escapeAttr(m)}" data-manual="" value="" title="默认自动计算，可手动覆盖" /></td>`;
    });
    // 国产总和 / 国产环比 / 份额：默认 auto，初始空，recalcRow 填充
    html += `<td><input type="number" step="0.001" class="dm-total auto" data-manual="" value="" title="默认=各厂商之和，可手动覆盖" /></td>`;
    html += `<td><input type="number" step="0.1" class="dm-totalwow auto" data-manual="" value="" title="默认自动计算，可手动覆盖" /></td>`;
    // 全球总和：手填
    html += `<td><input type="number" step="0.001" class="dm-global" value="${dom.global_T[i]!=null?dom.global_T[i]:''}" /></td>`;
    html += `<td><input type="number" step="0.1" class="dm-share auto" data-manual="" value="" title="默认=国产/全球，可手动覆盖" /></td>`;
    html += `<td><button class="row-del">✕</button></td></tr>`;
  }
  body.innerHTML = html;
  // 渲染后用计算值填充所有 auto 格子（从第一行起，因为环比依赖上一行，必须顺序算）
  document.querySelectorAll('#domesticBody tr').forEach(tr => recalcRow(tr));
}

function setupDomesticEvents() {
  const body = document.getElementById('domesticBody');
  const head = document.getElementById('domesticHead');
  // input：值列改变 → 重算；自动列被手改 → 标 manual
  body.addEventListener('input', (e) => {
    const inp = e.target;
    const tr = inp.closest('tr');
    if (!tr) return;
    if (inp.classList.contains('dm-val') || inp.classList.contains('dm-global')) {
      recalcRow(tr);
    } else if (inp.classList.contains('dm-wow') || inp.classList.contains('dm-total') ||
               inp.classList.contains('dm-totalwow') || inp.classList.contains('dm-share')) {
      // 手动覆盖自动格子
      if (inp.value.trim() !== '') markManual(inp);
      else { inp.dataset.manual = ''; inp.classList.add('auto'); recalcRow(tr); }
    }
    markDirty();
  });
  // 删除行
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
      const vInp = tr.querySelector(`.dm-val[data-model="${CSS.escape(m)}"]`);
      const wInp = tr.querySelector(`.dm-wow[data-model="${CSS.escape(m)}"]`);
      const v = parseFloat(vInp.value);
      const w = parseFloat(wInp.value);
      modelData[m].values_T.push(isNaN(v)?null:v);
      modelData[m].wow.push(isNaN(w)?null:w);
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
  // 看板访问密码
  const vInfo = document.getElementById('viewPwdInfo');
  if (vInfo) vInfo.innerHTML = `当前看板访问密码：<b>${escapeHtml(DataStore.getViewPassword())}</b>`;
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
  // 看板访问密码
  document.getElementById('changeViewPwdBtn').addEventListener('click', async () => {
    const np = document.getElementById('newViewPwd').value.trim();
    const msg = document.getElementById('viewPwdMsg');
    msg.textContent = '';
    if (!np) { msg.textContent = '请输入新密码'; return; }
    try {
      await DataStore.setViewPassword(np);
      msg.style.color = '#2e7d32';
      msg.textContent = '✓ 看板密码已更新';
      document.getElementById('newViewPwd').value = '';
      renderAccount();
    } catch (e) { msg.textContent = '更新失败：' + e.message; }
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

/* ---------- 导出为图片（手机适配高清晰长图）---------- */
async function exportDashboardImage() {
  const btn = document.getElementById('exportImgBtn');
  const origText = btn.textContent;
  btn.textContent = '生成中…'; btn.disabled = true;
  try {
    // 先把当前编辑同步到 state，保证图片是最新内容
    syncFormsToState();
    const snapshot = JSON.parse(JSON.stringify(state)); // 深拷贝快照

    // 打开预览窗口
    const w = window.open('', '_blank');
    if (!w) { alert('请允许弹窗以预览图片'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>导出图片 · Token 看板</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body{margin:0;background:#f0f2f5;font-family:'Inter','PingFang SC','Microsoft YaHei',sans-serif;padding:20px}
        .toolbar{max-width:820px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;background:#fff;padding:14px 18px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
        .toolbar h2{margin:0;font-size:15px}
        .tb-btns button{margin-left:8px;padding:8px 16px;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit}
        .tb-btns .dl{background:#ED7D31;color:#fff}
        .tb-btns .dl:hover{background:#e06d20}
        .tb-btns .ld{background:#fff;color:#666;border:1px solid #ddd}
        .hint{color:#888;font-size:12px}
        #previewArea{max-width:820px;margin:0 auto}
        #snapshot{width:750px;background:#fff;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,.08);border-radius:8px;overflow:hidden}
        .loader{text-align:center;padding:60px;color:#888}
      </style></head><body>
      <div class="toolbar">
        <h2>📱 手机适配长图预览</h2>
        <div class="tb-btns">
          <button class="ld" onclick="window.close()">关闭</button>
          <button class="dl" id="dlBtn" disabled>下载 PNG</button>
        </div>
      </div>
      <div class="hint" style="max-width:820px;margin:0 auto 12px;text-align:center">高清版本（750×N，2倍像素密度），适合微信/钉钉发送。</div>
      <div id="previewArea"><div class="loader">正在生成看板快照…</div></div>
      <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>
      <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
      <script>
        window.__SNAPSHOT__ = ${JSON.stringify(snapshot)};
      <\/script>
      </body></html>`);
    w.document.close();

    // 等新窗口加载完依赖，再注入渲染逻辑
    await new Promise(r => setTimeout(r, 800));
    renderSnapshotInWindow(w);
  } catch (e) {
    console.error(e);
    alert('导出图片失败：' + e.message);
  } finally {
    btn.textContent = origText; btn.disabled = false;
  }
}

// 在预览窗口里渲染看板快照并截图
function renderSnapshotInWindow(w) {
  const d = w.__SNAPSHOT__;
  // 用与 dashboard.js 一致的渲染逻辑，但渲染到新窗口的 #snapshot 里
  const area = w.document.getElementById('previewArea');
  area.innerHTML = '<div id="snapshot"></div>';
  const snap = w.document.getElementById('snapshot');
  // 复制看板 HTML 结构
  snap.innerHTML = buildSnapshotHTML(d);
  // 调整为手机宽度适配样式（强制单列）
  snap.style.fontFamily = "'Inter','PingFang SC','Microsoft YaHei',sans-serif";
  applySnapshotStyles(w);

  // 渲染图表
  setTimeout(() => {
    drawSnapshotCharts(w, d);
    // 图表渲染后再截图
    setTimeout(() => captureSnapshot(w), 800);
  }, 200);
}

function buildSnapshotHTML(d) {
  const summaryHTML = (d.summary||[]).map((ln,i) => {
    const text = typeof ln === 'string' ? ln : (ln.text||'');
    const color = (typeof ln === 'object' && ln.color) ? ln.color : '';
    const bold = (typeof ln === 'object' && ln.bold);
    let html = escapeHtmlSnap(text);
    html = html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
    const style = (color||bold)?` style="${color?'color:'+color+';':''}${bold?'font-weight:600;':''}"`:'';
    return `<p${style}>${html}</p>`;
  }).join('');
  const kpiHTML = (d.kpi||[]).map(k => `
    <div class="sk-kpi">
      <div class="sk-kpi-label">${escapeHtmlSnap(k.label||'')}</div>
      <div class="sk-kpi-value" ${k.value&&/^\d/.test(k.value)?'style="color:#ED7D31"':''}>${escapeHtmlSnap(k.value||'')}</div>
      <div class="sk-kpi-trend">${escapeHtmlSnap(k.trend||'')}</div>
    </div>`).join('');
  const top10HTML = (d.top10||[]).map(t => {
    const up = t.up; const arrow = up?'▲':'▼';
    const wow = (t.wow_num!=null)?(up?'+':'')+t.wow_num+'%':'';
    const tokens = (t.tokens!=null)?t.tokens.toFixed(2):'—';
    return `<div class="sk-rank ${t.rank<=3?'top3':''}">
      <div class="sk-rank-no">No.${String(t.rank).padStart(2,'0')}</div>
      <div class="sk-rank-name">${escapeHtmlSnap(t.name||'')}</div>
      <div class="sk-rank-tokens">${tokens}<span>T</span></div>
      <div class="sk-rank-wow ${up?'up':'down'}">${arrow} ${wow}</div>
    </div>`;
  }).join('');
  const visibleModules = (d.modules||[]).filter(m => m.visible !== false);
  const moduleHead = (idx, origIdx) => {
    const m = d.modules[origIdx];
    return `<div class="sk-mod-head"><h3>${escapeHtmlSnap(m.title||'')}</h3>${m.comment?`<p>${escapeHtmlSnap(m.comment)}</p>`:''}</div>`;
  };

  return `
    <div class="sk-hero">
      <div class="sk-logo">T</div>
      <div>
        <div class="sk-title">${escapeHtmlSnap((d.title||'').replace(/【.+?】/,'').trim()||'AI模型 Tokens 消耗数据库')}</div>
        <div class="sk-team">${escapeHtmlSnap((d.title||'').match(/【(.+?)】/)?.[1] || '天风计算机')}</div>
      </div>
    </div>
    <div class="sk-section">
      <div class="sk-section-label">本周总结</div>
      <div class="sk-summary">${summaryHTML}</div>
    </div>
    <div class="sk-kpi-row">${kpiHTML}</div>
    ${visibleModules.map((m,dispIdx)=>{const origIdx=d.modules.indexOf(m);return `
    <div class="sk-section">
      ${moduleHead(dispIdx, origIdx)}
      ${origIdx===0?'<div class="sk-chart" id="snap_chart_total" style="height:240px"></div>':''}
      ${origIdx===1?'<div class="sk-rank-grid">'+top10HTML+'</div>':''}
      ${origIdx===2?'<div class="sk-chart" id="snap_chart_domtotal" style="height:200px"></div><div class="sk-chart" id="snap_chart_share" style="height:200px"></div>':''}
      ${origIdx===3?(Object.keys(d.domestic.models||{}).map((mn,i)=>`<div class="sk-modmodel"><div class="sk-mn">${escapeHtmlSnap(mn)}</div><div class="sk-chart" id="snap_chart_model_${i}" style="height:130px"></div></div>`).join('')):''}
    </div>`;}).join('')}
    <div class="sk-footer">${escapeHtmlSnap(d.footer||'')}</div>
  `;
}

function drawSnapshotCharts(w, d) {
  const E = w.echarts;
  const baseAxis = {
    axisLine:{lineStyle:{color:'#eee'}}, axisTick:{show:false},
    axisLabel:{color:'#999',fontSize:9,rotate:30,hideOverlap:true}
  };
  // 快照图表统一关闭动画：setOption 后数据立即是最终状态，
  // 避免 html2canvas 在动画进行中截图导致折线/柱子不完整。
  const NO_ANIM = { animation: false, animationDuration: 0, animationDurationUpdate: 0 };
  // 在新窗口里初始化图表（关闭动画），返回实例
  function initChart(id) {
    const el = w.document.getElementById(id);
    if (!el) return null;
    return E.init(el);
  }

  // 模块1 总消耗
  if (d.total_history && d.total_history.dates.length) {
    const c = initChart('snap_chart_total');
    if (c) c.setOption(Object.assign({
      grid:{left:35,right:40,top:24,bottom:50},
      tooltip:{trigger:'axis'},
      xAxis:{type:'category',data:d.total_history.dates,...baseAxis},
      yAxis:[{type:'value',splitLine:{lineStyle:{color:'#f0f0f0'}},axisLabel:{color:'#999',fontSize:9}},
             {type:'value',splitLine:{show:false},axisLabel:{show:false}}],
      series:[{type:'bar',data:d.total_history.values,barWidth:'55%',
        itemStyle:{borderRadius:[3,3,0,0],color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'#ED7D31'},{offset:1,color:'#f7c9ad'}]}}},
        {type:'line',yAxisIndex:1,data:d.total_history.wow,smooth:true,symbol:'none',lineStyle:{color:'#333'}}]
    }, NO_ANIM));
  }
  // 模块3 国产总量 + 份额
  const dom = d.domestic;
  if (dom && dom.dates.length) {
    const c1 = initChart('snap_chart_domtotal');
    if (c1) c1.setOption(Object.assign({
      grid:{left:35,right:40,top:20,bottom:50},tooltip:{trigger:'axis'},
      xAxis:{type:'category',data:dom.dates,...baseAxis},
      yAxis:[{type:'value',splitLine:{lineStyle:{color:'#f0f0f0'}},axisLabel:{color:'#999',fontSize:9}},{type:'value',splitLine:{show:false},axisLabel:{show:false}}],
      series:[{type:'bar',data:dom.total_T,barWidth:'55%',itemStyle:{borderRadius:[3,3,0,0],color:'#5AD8A6'}},
              {type:'line',yAxisIndex:1,data:dom.total_wow,smooth:true,symbol:'none',lineStyle:{color:'#ED7D31'}}]
    }, NO_ANIM));

    const c2 = initChart('snap_chart_share');
    if (c2) c2.setOption(Object.assign({
      grid:{left:35,right:20,top:20,bottom:50},tooltip:{trigger:'axis'},
      xAxis:{type:'category',data:dom.dates,...baseAxis},
      yAxis:{type:'value',axisLabel:{color:'#999',fontSize:9,formatter:'{value}%'},splitLine:{lineStyle:{color:'#f0f0f0'}}},
      series:[{type:'line',data:dom.share,smooth:true,symbol:'none',lineStyle:{color:'#ED7D31',width:2.5},
        areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(237,125,49,.2)'},{offset:1,color:'rgba(237,125,49,0)'}]}},
        markLine:{symbol:'none',silent:true,data:[{yAxis:50,lineStyle:{color:'#bbb',type:'dashed'},label:{formatter:'50%',color:'#999',fontSize:9}}]}}]
    }, NO_ANIM));
  }
  // 模块4 各厂商
  if (dom && dom.models) {
    const palette = ['#ED7D31','#5B8FF9','#5AD8A6','#F6BD16','#E86452','#6DC8EC','#945FB9','#3FB8AF'];
    Object.keys(dom.models).forEach((m,i) => {
      const c = initChart('snap_chart_model_'+i);
      if (!c) return;
      const md = dom.models[m];
      c.setOption(Object.assign({
        grid:{left:32,right:32,top:10,bottom:30},tooltip:{trigger:'axis'},
        xAxis:{type:'category',data:dom.dates,axisLine:{lineStyle:{color:'#eee'}},axisTick:{show:false},axisLabel:{show:false}},
        yAxis:[{type:'value',splitLine:{lineStyle:{color:'#f4f4f4'}},axisLabel:{color:'#aaa',fontSize:8}},{type:'value',splitLine:{show:false},axisLabel:{show:false}}],
        series:[{type:'bar',data:md.values_T,barWidth:'55%',itemStyle:{borderRadius:[3,3,0,0],color:palette[i%palette.length]}},
                {type:'line',yAxisIndex:1,data:md.wow,smooth:true,symbol:'none',lineStyle:{color:'#bbb',width:1.5,type:'dashed'}}]
      }, NO_ANIM));
    });
  }
}

function applySnapshotStyles(w) {
  const st = w.document.createElement('style');
  st.textContent = `
    *{box-sizing:border-box}
    #snapshot{color:#1a1a1a;line-height:1.6}
    .sk-hero{display:flex;align-items:center;gap:12px;padding:24px 22px 18px;border-bottom:1px solid #f0f0f0}
    .sk-logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#ED7D31,#f59e57);color:#fff;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(237,125,49,.25)}
    .sk-title{font-size:17px;font-weight:600}
    .sk-team{font-size:11px;color:#888;margin-top:2px}
    .sk-section{padding:18px 22px;border-bottom:1px solid #f5f5f5}
    .sk-section-label{font-size:10px;font-weight:600;letter-spacing:.08em;color:#ED7D31;text-transform:uppercase;margin-bottom:10px}
    .sk-summary{font-size:13px;color:#3d3d3d;line-height:1.85}
    .sk-summary p{margin:0 0 4px}
    .sk-kpi-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:16px 22px;border-bottom:1px solid #f5f5f5}
    .sk-kpi{background:#fafafa;border-radius:8px;padding:12px;border-left:3px solid #ED7D31}
    .sk-kpi-label{font-size:10px;color:#888;line-height:1.3;min-height:26px}
    .sk-kpi-value{font-size:22px;font-weight:300;margin:6px 0 4px;letter-spacing:-.02em}
    .sk-kpi-trend{font-size:11px;color:#888}
    .sk-mod-head h3{margin:0;font-size:14px;font-weight:600}
    .sk-mod-head p{margin:4px 0 12px;font-size:11.5px;color:#888;line-height:1.6}
    .sk-rank-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .sk-rank{background:#fafafa;border-radius:8px;padding:10px 11px;position:relative;overflow:hidden}
    .sk-rank.top3{border:1px solid #f3c9ad}
    .sk-rank-no{font-size:9px;color:#aaa;font-weight:600}
    .sk-rank.top3 .sk-rank-no{color:#ED7D31}
    .sk-rank-name{font-size:12px;font-weight:600;margin:3px 0 8px;line-height:1.3;min-height:16px}
    .sk-rank-tokens{font-size:17px;font-weight:300}
    .sk-rank-tokens span{font-size:10px;color:#888}
    .sk-rank-wow{font-size:10px;margin-top:3px}
    .sk-rank-wow.up{color:#ED7D31}
    .sk-rank-wow.down{color:#999}
    .sk-chart{margin:6px 0}
    .sk-modmodel{margin-bottom:10px}
    .sk-mn{font-size:11px;font-weight:600;padding:2px 2px 4px}
    .sk-footer{padding:16px 22px;font-size:11px;color:#888;background:linear-gradient(90deg,#ED7D31 2px,transparent 2px) top left/100% 2px no-repeat #fafafa}
  `;
  w.document.head.appendChild(st);
}

function captureSnapshot(w) {
  const node = w.document.getElementById('snapshot');
  const dlBtn = w.document.getElementById('dlBtn');
  // 先等字体加载完成（中文字体从 CDN 加载较慢，避免截图时字形未就绪）
  const fontsReady = (w.document.fonts && w.document.fonts.ready) ? w.document.fonts.ready : Promise.resolve();
  fontsReady.then(() => {
    // 再额外等一帧，确保 ECharts 无动画渲染 + 字形完全绘制
    return new Promise(r => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
  }).then(() => {
    return html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  }).then(canvas => {
    const img = canvas.toDataURL('image/png');
    // 显示预览
    const area = w.document.getElementById('previewArea');
    area.innerHTML = `<img src="${img}" style="width:100%;max-width:820px;display:block;margin:0 auto;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.1)"/>`;
    // 启用下载
    dlBtn.disabled = false;
    dlBtn.onclick = () => {
      const a = w.document.createElement('a');
      const label = (w.__SNAPSHOT__.total_history && w.__SNAPSHOT__.total_history.dates.slice(-1)[0] || 'export').replace(/-/g,'');
      a.href = img; a.download = `Token看板_${label}.png`;
      w.document.body.appendChild(a); a.click(); a.remove();
    };
  }).catch(e => {
    w.document.getElementById('previewArea').innerHTML =
      `<div style="text-align:center;padding:40px;color:#c0392b">生成失败：${e.message}</div>`;
  });
}
function escapeHtmlSnap(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}


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
