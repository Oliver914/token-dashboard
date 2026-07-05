/* =========================================================
   Token 出海看板 · 前端渲染逻辑
   读取 data.json → 填充文字 + ECharts 图表
   ========================================================= */

// 品牌色板
const PALETTE = {
  orange: '#ED7D31',
  orangeSoft: '#f5a25f',
  ink: '#1a1a1a',
  gray: '#6b7280',
  line: '#ececec',
  // 模型用一组柔和的暖色/中性色，避免花哨
  modelColors: ['#ED7D31', '#5B8FF9', '#5AD8A6', '#F6BD16', '#E86452', '#6DC8EC', '#945FB9']
};

// 通用 ECharts 文字/网格风格
const CHART_TEXT = {
  color: PALETTE.gray,
  fontFamily: "'Inter','PingFang SC','Microsoft YaHei',sans-serif"
};
const SPLIT_LINE = { lineStyle: { color: '#f0f0f0' } };

const charts = [];   // 保存所有 ECharts 实例，便于 resize
let lastData = null; // 最近一次数据（用于实时重绘）

document.addEventListener('DOMContentLoaded', async () => {
  await DataStore.init();

  // ===== 看板访问密码门 =====
  const container = document.querySelector('.container');
  if (!DataStore.isViewAuthed()) {
    // 隐藏看板内容，显示密码页
    container.style.display = 'none';
    showViewGate();
    return; // 验证通过后 showViewGate 会重新触发 renderAll
  }

  bootDashboard();
});

// 启动看板（密码验证后调用）
async function bootDashboard() {
  // 导出按钮
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    if (window.exportToExcel && lastData) {
      exportBtn.textContent = '导出中…';
      try { window.exportToExcel(lastData); }
      catch (e) { console.error(e); alert('导出失败：' + e.message); }
      exportBtn.textContent = '导出 Excel';
    }
  });

  // 首次加载
  const data = DataStore.normalizeStructure(await DataStore.load());
  lastData = data;
  renderAll(data);
  // 数据变化时实时重绘（后台编辑/Excel 导入后自动刷新）
  DataStore.onChange(d => {
    if (!d) return;
    lastData = DataStore.normalizeStructure(d);
    // 释放旧图表实例避免内存泄漏
    charts.forEach(c => { try { c.dispose(); } catch(e){} });
    charts.length = 0;
    renderAll(lastData);
  });
  window.addEventListener('resize', () => charts.forEach(c => c && c.resize()));
}

// 显示看板访问密码门
function showViewGate() {
  const gate = document.createElement('div');
  gate.id = 'viewGate';
  gate.innerHTML = `
    <div class="gate-card">
      <div class="logo-mark"><span class="logo-dot"></span><span class="logo-text">T</span></div>
      <h1 class="gate-title">Token 出海数据库</h1>
      <p class="gate-team">【天风计算机 缪欣君/刘鉴团队】</p>
      <p class="gate-sub">请输入访问密码</p>
      <form id="gateForm" class="gate-form">
        <input type="password" id="gatePwd" placeholder="访问密码" autocomplete="off" autofocus />
        <div id="gateError" class="gate-error"></div>
        <button type="submit" class="btn btn-primary btn-block">进 入</button>
      </form>
      <p class="gate-note">密码请询问天风计算机团队成员或对口销售</p>
    </div>`;
  document.body.appendChild(gate);
  document.getElementById('gateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const pwd = document.getElementById('gatePwd').value;
    const err = document.getElementById('gateError');
    err.textContent = '';
    if (DataStore.authView(pwd)) {
      // 移除密码门，显示看板
      gate.remove();
      document.querySelector('.container').style.display = '';
      bootDashboard();
    } else {
      err.textContent = '密码不正确';
      document.getElementById('gatePwd').select();
    }
  });
}

/* ---------- 总入口 ---------- */
function renderAll(d) {
  renderHero(d);
  renderSummary(d.summary || []);
  renderKpi(d.kpi || []);
  renderModules(d.modules || []);
  renderRanks(d.top10 || []);
  renderFooter(d);
  // 图表（用 setTimeout 让容器先布局）
  setTimeout(() => {
    renderChartTotal(d.total_history);
    renderChartDomTotal(d.domestic);
    renderChartShare(d.domestic);
    renderModelGrid(d.domestic);
    revealOnScroll();
  }, 60);
}

/* ---------- Hero ---------- */
function renderHero(d) {
  // 标题（去掉团队后缀，团队名单独显示）
  const fullTitle = (d.title || '').trim();
  const teamMatch = fullTitle.match(/【(.+?)】/);
  const mainTitle = fullTitle.replace(/【.+?】/, '').trim() || 'AI模型 Tokens 消耗数据库';
  // 括号里本身已含"天风计算机"，直接用；没有则回退默认
  const team = teamMatch ? teamMatch[1] : '天风计算机';
  document.getElementById('pageTitle').textContent = mainTitle;
  document.getElementById('pageSub').textContent = team;

  // 数据周期：从 KPI 第 3 个或 meta 取
  const periodKpi = (d.kpi && d.kpi[2]) ? d.kpi[2].value : '';
  const week = d.meta && d.meta.week_label ? d.meta.week_label : '';
  let periodText = periodKpi || (week ? `周期 ${week}` : '');
  if (periodText) document.getElementById('periodTag').textContent = periodText;
}

/* ---------- 本周总结 ---------- */
// summary 支持两种格式：纯字符串数组（旧 data.json）/ 对象数组 {text,color,bold}
function renderSummary(lines) {
  const box = document.getElementById('summaryBody');
  if (!lines || !lines.length) { box.innerHTML = '<p>—</p>'; return; }
  box.innerHTML = lines.map((ln, i) => {
    const text = typeof ln === 'string' ? ln : (ln.text || '');
    const color = (typeof ln === 'object' && ln.color) ? ln.color : '';
    const bold = (typeof ln === 'object' && ln.bold) || /^1）|^2）|^3）|^4）|^5）|^总结/.test(text);
    // 支持 Markdown 加粗 **xxx** 和 *斜体*
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    const cls = i === 0 ? 'lead' : '';
    const style = (color || bold) ? ` style="${color?'color:'+color+';':''}${bold?'font-weight:600;':''}"` : '';
    return `<p class="${cls}"${style}>${html}</p>`;
  }).join('');
}

/* ---------- KPI ---------- */
function renderKpi(kpis) {
  kpis.forEach((k, i) => {
    const lab = document.getElementById('kpi' + i + 'Label');
    const val = document.getElementById('kpi' + i + 'Value');
    const tr  = document.getElementById('kpi' + i + 'Trend');
    if (!lab) return;
    lab.textContent = k.label || '—';
    // 大数字动画
    animateText(val, k.value || '—');
    // 趋势：含「⬆」或「+」标橙色
    const trend = k.trend || '';
    tr.textContent = trend;
    tr.className = 'kpi-trend' + (/⬆|\+|增|升/.test(trend) ? ' up' : '');
  });
}

// 数字滚动动画：仅当 value 形如 "42.4T"（数字开头+短后缀）时才动画，
// 含中文/日期/过长文本的值（如 "GLM 5.2"、"2026年6月22日-..."）直接显示。
// 用 CSS 计数动画兼容性最好，这里直接用 rAF；动画结束后兜底设最终值。
function animateText(el, text) {
  const m = String(text).match(/^(-?\d+\.?\d*)([A-Za-z%]{0,3})$/);
  if (!m) { el.textContent = text; return; }
  const target = parseFloat(m[1]);
  const suffix = m[2] || '';
  const isFloat = m[1].includes('.');
  const decimals = isFloat ? (m[1].split('.')[1].length) : 0;
  const finalText = (isFloat ? target.toFixed(decimals) : Math.round(target)) + suffix;
  const dur = 900;
  const start = performance.now();
  let finished = false;
  // 兜底：1.2s 后无论如何显示最终值（应对虚拟时钟/后台标签等场景）
  setTimeout(() => { if (!finished) { finished = true; el.textContent = finalText; } }, 1300);
  function tick(now) {
    if (finished) return;
    const p = Math.min(1, (now - start) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    const cur = target * ease;
    el.textContent = (isFloat ? cur.toFixed(decimals) : Math.round(cur)) + suffix;
    if (p >= 1) { finished = true; el.textContent = finalText; return; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- 模块标题 + 显隐 ---------- */
function renderModules(modules) {
  modules.forEach((m, i) => {
    const t = document.getElementById('m' + i + 'Title');
    const c = document.getElementById('m' + i + 'Comment');
    const sec = document.getElementById('module' + i);
    if (t) t.textContent = m.title || ('模块' + (i + 1));
    if (c) c.textContent = m.comment || '';
    if (sec) sec.style.display = m.visible === false ? 'none' : '';
  });
}

/* ---------- 前 10 排名 ---------- */
function renderRanks(top10) {
  const grid = document.getElementById('rankGrid');
  // 找最大值用于横条比例
  const maxT = Math.max(...top10.map(t => t.tokens || 0), 0.0001);
  grid.innerHTML = top10.map(t => {
    const isUp = t.up;
    const wowCls = isUp ? 'up' : 'down';
    const arrow = isUp ? '▲' : '▼';
    const wowNum = (t.wow_num != null) ? (isUp ? '+' : '') + t.wow_num + '%' : '';
    const tokens = (t.tokens != null) ? t.tokens.toFixed(2) : '—';
    const barW = Math.max(8, (t.tokens / maxT) * 100);
    return `
      <div class="rank-card ${t.rank <= 3 ? 'top3' : ''}">
        <div class="rank-no">No.${String(t.rank).padStart(2,'0')}</div>
        <div class="rank-name">${escapeHtml(t.name)}</div>
        <div class="rank-tokens">${tokens}<span class="unit">T</span></div>
        <div class="rank-wow ${wowCls}">${arrow} ${wowNum}</div>
        <div class="rank-bar" style="width:${barW}%"></div>
      </div>`;
  }).join('');
}

/* ---------- 页脚 ---------- */
function renderFooter(d) {
  document.getElementById('footerText').textContent = d.footer || '来源：Openrouter';
  if (d.meta && d.meta.generated_at) {
    document.getElementById('genMeta').textContent =
      '数据自动更新 · 最近生成于 ' + d.meta.generated_at;
  }
}

/* =========================================================
   ECharts 图表
   ========================================================= */

// 通用 tooltip 样式（所有图表共用，鼠标悬停显示完整周数据）
function makeTooltip(extraFormatter) {
  return {
    trigger: 'axis',
    backgroundColor: '#fff',
    borderColor: '#eee',
    borderWidth: 1,
    padding: [10, 14],
    textStyle: { color: PALETTE.ink, fontSize: 13 },
    extraCssText: 'box-shadow: 0 6px 24px rgba(20,25,35,.10); border-radius: 8px;',
    axisPointer: {
      type: 'shadow',
      shadowStyle: { color: 'rgba(237,125,49,.06)' },
      label: { backgroundColor: PALETTE.orange }
    },
    formatter: extraFormatter || null
  };
}

// 模块1：大模型总消耗曲线（柱+折线）
function renderChartTotal(h) {
  if (!h || !h.dates || !h.dates.length) return;
  const el = document.getElementById('chartTotal');
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    grid: { left: 52, right: 58, top: 44, bottom: 64 },
    tooltip: makeTooltip(function (params) {
      const date = params[0].axisValueLabel || params[0].name;
      const tot = params.find(p => p.seriesName.includes('总调用')) || {};
      const wow = params.find(p => p.seriesName.includes('环比')) || {};
      return `<div style="font-weight:600;margin-bottom:6px">${date}</div>
              <div style="color:${PALETTE.gray}">总调用量：<b style="color:${PALETTE.ink}">${tot.value == null ? '-' : tot.value + ' T'}</b></div>
              <div style="color:${PALETTE.gray}">周环比：<b style="color:${wow.value >= 0 ? PALETTE.orange : PALETTE.gray}">${wow.value == null ? '-' : (wow.value >= 0 ? '+' : '') + wow.value + '%'}</b></div>`;
    }),
    legend: {
      data: ['大模型总调用量（T）', '周环比'],
      top: 6, right: 12, icon: 'roundRect', itemWidth: 12, itemHeight: 8,
      textStyle: CHART_TEXT
    },
    xAxis: {
      type: 'category',
      data: h.dates,
      axisLine: { lineStyle: { color: PALETTE.line } },
      axisTick: { show: false },
      axisLabel: { ...CHART_TEXT, fontSize: 11, rotate: 35, hideOverlap: true },
      axisPointer: { type: 'shadow' }
    },
    yAxis: [
      { type: 'value', name: '调用量 (T)',
        nameTextStyle: { ...CHART_TEXT, fontSize: 11, padding: [0, 0, 0, -20] },
        splitLine: SPLIT_LINE, axisLabel: { ...CHART_TEXT, fontSize: 11 } },
      { type: 'value',
        nameTextStyle: { ...CHART_TEXT, fontSize: 11 },
        splitLine: { show: false },
        axisLabel: { ...CHART_TEXT, fontSize: 11, formatter: '{value}%' } }
    ],
    series: [
      {
        name: '大模型总调用量（T）',
        type: 'bar',
        data: h.values,
        barWidth: '60%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: PALETTE.orange },
              { offset: 1, color: '#f7c9ad' }
            ]
          }
        }
      },
      {
        name: '周环比',
        type: 'line',
        yAxisIndex: 1,
        data: h.wow,
        smooth: true,
        symbol: 'circle', symbolSize: 6,
        lineStyle: { color: '#3d3d3d', width: 2 },
        itemStyle: { color: '#3d3d3d' }
      }
    ]
  });
}

// 模块3-1：国产大模型周总调用量（柱+折线）
function renderChartDomTotal(dom) {
  if (!dom || !dom.dates || !dom.dates.length) return;
  const el = document.getElementById('chartDomTotal');
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    grid: { left: 52, right: 58, top: 44, bottom: 64 },
    tooltip: makeTooltip(function (params) {
      const date = params[0].axisValueLabel || params[0].name;
      const tot = params.find(p => p.seriesName.includes('调用量')) || {};
      const wow = params.find(p => p.seriesName.includes('环比')) || {};
      return `<div style="font-weight:600;margin-bottom:6px">${date}</div>
              <div style="color:${PALETTE.gray}">国产调用量：<b style="color:${PALETTE.ink}">${tot.value == null ? '-' : tot.value + ' T'}</b></div>
              <div style="color:${PALETTE.gray}">周环比：<b style="color:${wow.value >= 0 ? PALETTE.orange : PALETTE.gray}">${wow.value == null ? '-' : (wow.value >= 0 ? '+' : '') + wow.value + '%'}</b></div>`;
    }),
    legend: { data: ['国产调用量（T）', '周环比'], top: 6, right: 12, icon: 'roundRect',
              itemWidth: 12, itemHeight: 8, textStyle: CHART_TEXT },
    xAxis: { type: 'category', data: dom.dates,
             axisLine: { lineStyle: { color: PALETTE.line } }, axisTick: { show: false },
             axisLabel: { ...CHART_TEXT, fontSize: 11, rotate: 35, hideOverlap: true },
             axisPointer: { type: 'shadow' } },
    yAxis: [
      { type: 'value', name: '调用量 (T)',
        nameTextStyle: { ...CHART_TEXT, fontSize: 11, padding: [0, 0, 0, -20] },
        splitLine: SPLIT_LINE, axisLabel: { ...CHART_TEXT, fontSize: 11 } },
      { type: 'value',
        nameTextStyle: { ...CHART_TEXT, fontSize: 11 },
        splitLine: { show: false },
        axisLabel: { ...CHART_TEXT, fontSize: 11, formatter: '{value}%' } }
    ],
    series: [
      { name: '国产调用量（T）', type: 'bar', data: dom.total_T, barWidth: '60%',
        itemStyle: { borderRadius: [4,4,0,0], color: PALETTE.modelColors[2] } },
      { name: '周环比', type: 'line', yAxisIndex: 1, data: dom.total_wow, smooth: true,
        symbol: 'circle', symbolSize: 5, lineStyle: { color: PALETTE.orange, width: 2 },
        itemStyle: { color: PALETTE.orange } }
    ]
  });
}

// 模块3-2：份额变化曲线
function renderChartShare(dom) {
  if (!dom || !dom.dates || !dom.dates.length) return;
  const el = document.getElementById('chartShare');
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    grid: { left: 52, right: 30, top: 30, bottom: 64 },
    tooltip: makeTooltip(function (params) {
      const date = params[0].axisValueLabel || params[0].name;
      const v = params[0].value;
      return `<div style="font-weight:600;margin-bottom:6px">${date}</div>
              <div style="color:${PALETTE.gray}">国产份额：<b style="color:${PALETTE.orange}">${v == null ? '-' : v + '%'}</b></div>`;
    }),
    xAxis: { type: 'category', data: dom.dates,
             axisLine: { lineStyle: { color: PALETTE.line } }, axisTick: { show: false },
             axisLabel: { ...CHART_TEXT, fontSize: 11, rotate: 35, hideOverlap: true },
             axisPointer: { type: 'shadow' } },
    yAxis: { type: 'value', axisLabel: { ...CHART_TEXT, fontSize: 11, formatter: '{value}%' },
             splitLine: SPLIT_LINE, max: 70 },
    series: [{
      name: '国产份额', type: 'line', data: dom.share, smooth: true,
      symbol: 'none',
      lineStyle: { color: PALETTE.orange, width: 2.5 },
      areaStyle: {
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: 'rgba(237,125,49,.22)' },
          { offset: 1, color: 'rgba(237,125,49,0)' }
        ]}
      },
      markLine: {
        symbol: 'none', silent: true,
        data: [{ yAxis: 50, lineStyle: { color: '#bbb', type: 'dashed' },
                 label: { formatter: '50%', color: '#999', fontSize: 10 } }]
      }
    }]
  });
}

// 模块4：各国产模型明细（动态生成网格）
function renderModelGrid(dom) {
  if (!dom || !dom.models) return;
  const grid = document.getElementById('modelGrid');
  const modelNames = Object.keys(dom.models);
  grid.innerHTML = modelNames.map((m, i) => `
    <div class="chart-wrap">
      <div class="model-title">${escapeHtml(m)}</div>
      <div id="modelChart_${i}" style="height:200px"></div>
    </div>`).join('');
  modelNames.forEach((m, i) => {
    const el = document.getElementById('modelChart_' + i);
    if (!el) return;
    const chart = echarts.init(el);
    charts.push(chart);
    const color = PALETTE.modelColors[i % PALETTE.modelColors.length];
    const md = dom.models[m];
    chart.setOption({
      grid: { left: 44, right: 44, top: 16, bottom: 36 },
      tooltip: makeTooltip(function (params) {
        const date = params[0].axisValueLabel || params[0].name;
        const val = params.find(p => p.seriesName.includes('（T）')) || {};
        const wow = params.find(p => p.seriesName === '环比') || {};
        return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(m)} · ${date}</div>
                <div style="color:${PALETTE.gray}">调用量：<b style="color:${PALETTE.ink}">${val.value == null ? '-' : val.value + ' T'}</b></div>
                <div style="color:${PALETTE.gray}">环比：<b style="color:${wow.value >= 0 ? PALETTE.orange : PALETTE.gray}">${wow.value == null ? '-' : (wow.value >= 0 ? '+' : '') + wow.value + '%'}</b></div>`;
      }),
      xAxis: { type: 'category', data: dom.dates, axisLine: { lineStyle: { color: PALETTE.line } },
               axisTick: { show: false }, axisLabel: { show: false },
               axisPointer: { type: 'shadow' } },
      yAxis: [
        { type: 'value', splitLine: { lineStyle: { color: '#f4f4f4' } },
          axisLabel: { ...CHART_TEXT, fontSize: 10 } },
        { type: 'value', splitLine: { show: false },
          axisLabel: { show: false } }
      ],
      series: [
        { name: m + '（T）', type: 'bar', data: md.values_T, barWidth: '55%',
          itemStyle: { borderRadius: [3,3,0,0], color: color } },
        { name: '环比', type: 'line', yAxisIndex: 1, data: md.wow, smooth: true,
          symbol: 'none', lineStyle: { color: '#9aa1ab', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#9aa1ab' } }
      ]
    });
  });
}

/* ---------- 滚动进入动画 ---------- */
function revealOnScroll() {
  const els = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });
  els.forEach(el => io.observe(el));
}

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
