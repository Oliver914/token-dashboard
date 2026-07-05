/* =========================================================
   导出 Excel (.xlsx) 模块 · export-excel.js
   =========================================================
   依赖：SheetJS（XLSX）通过 CDN 引入为全局变量 window.XLSX
         在 index.html 中需在 dashboard.js 之前引入本脚本，
         并在此之前引入 XLSX：
           <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
           <script src="js/export-excel.js"></script>

   对外暴露：
     window.exportToExcel(d)   将看板数据 d 导出为 .xlsx 文件

   d 的结构（来自 data.json / data-store.js normalizeStructure）：
     {
       meta:     { week_label, generated_at },
       title:    string,
       summary:  [ {text, color, bold}, ... ],   // 每行可能带颜色/加粗
       kpi:      [ {label, value, trend}, ... ], // 3 项
       modules:  [ {title, comment, visible}, ... ], // 4 项
       top10:    [ {rank, name, tokens, wow_num, up, tokens_text, wow_text}, ... ],
       footer:   string,
       total_history: { dates, values, wow },     // ~68 周
       domestic: {
         dates, total_T, total_wow, global_T, share,
         models: { DeepSeek:{values_T,wow}, Qwen, Kimi, GLM, Minimax, 小米, 腾讯 }
       },
       settings: { updated_at }
     }

   说明：
     - 全量防御性编码：所有数组访问均做空值兜底，数据缺失时只输出表头不报错。
     - 样式（填充/字体/对齐）通过 cell.s 写入；社区版 XLSX 对样式的
       支持有限，但写入 s 对象是无害的——支持样式的查看器/库可正确渲染。
       关键的标题栏、页脚通过 !merges 合并单元格保证在任何查看器都像表头。
   --------------------------------------------------------- */
(function () {
  'use strict';

  /* 品牌橙色 */
  const ORANGE = 'ED7D31';

  /* 厂商顺序：优先用 models-config.js 的配置；动态合并 data 里实际存在的厂商
     （保证新加的厂商即使没及时更新配置也能被导出） */
  const MODEL_ORDER = (() => {
    const configured = (typeof getModelNames === 'function') ? getModelNames() : [];
    const actual = (data && data.domestic && data.domestic.models) ? Object.keys(data.domestic.models) : [];
    const merged = [...configured];
    actual.forEach(m => { if (!merged.includes(m)) merged.push(m); });
    return merged.length ? merged : ['DeepSeek', 'Qwen', 'Kimi', 'GLM', 'Minimax', '小米', '腾讯'];
  })();

  /* ---------- 小工具 ---------- */

  // (行, 列) -> Excel 单元格地址（均从 0 开始）
  function cellAddr(r, c) {
    let col = c;
    let addr = '';
    do {
      addr = String.fromCharCode(65 + (col % 26)) + addr;
      col = Math.floor(col / 26) - 1;
    } while (col >= 0);
    return addr + (r + 1);
  }

  // 把 "#ED7D31" / "ED7D31" 统一成无 # 的 6 位大写 hex；非法则返回 ''
  function cleanHex(c) {
    if (!c || typeof c !== 'string') return '';
    let s = c.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return s.toUpperCase().slice(2); // AARRGGBB -> RRGGBB
    return '';
  }

  // 安全取数组第 i 项，越界/空数组返回 fallback
  function at(arr, i, fallback) {
    if (Array.isArray(arr) && i >= 0 && i < arr.length) {
      const v = arr[i];
      return v === undefined || v === null ? fallback : v;
    }
    return fallback;
  }

  /* ---------- 样式工厂 ---------- */

  // 橙色表头栏：白字、加粗、居中、填充
  function barStyle() {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 },
      fill: { fgColor: { rgb: ORANGE } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    };
  }

  // 标题栏样式：大字、白字、加粗、居中、橙色填充、自动换行
  function titleStyle() {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 18 },
      fill: { fgColor: { rgb: ORANGE } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    };
  }

  // 普通单元格样式
  function cellStyle(opts) {
    opts = opts || {};
    const s = { alignment: { vertical: 'center', wrapText: true } };
    if (opts.align) s.alignment.horizontal = opts.align;
    if (opts.bold) s.font = Object.assign({}, s.font, { bold: true });
    if (opts.color) {
      const hex = cleanHex(opts.color);
      if (hex) {
        s.font = Object.assign({}, s.font, { color: { rgb: hex } });
      }
    }
    if (opts.sz) s.font = Object.assign({}, s.font, { sz: opts.sz });
    return s;
  }

  // 表头行样式：加粗、居中
  function headStyle() {
    return {
      font: { bold: true, sz: 11 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    };
  }

  /* ---------- Sheet 1：看板（视觉摘要） ---------- */
  function buildOverviewSheet(d) {
    const ws = {};
    const merges = [];
    // 列数固定为 4（A 看板主列较宽，B/C/D 辅助）。标题/页脚合并 A:D
    const COLS = 4;
    let r = 0; // 当前行（0-based）

    const setCell = (rr, cc, v, style, type) => {
      const addr = cellAddr(rr, cc);
      const cell = { t: type || 's', v: v == null ? '' : v };
      if (style) cell.s = style;
      ws[addr] = cell;
    };

    /* 1) 标题栏（合并 A1:D1，较高行高） */
    merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
    setCell(r, 0, d.title || 'AI模型 Tokens 消耗数据库', titleStyle());
    r += 1;

    /* 2) 摘要行：每条 summary 一行，合并 A:D，保留颜色/加粗 */
    const summary = Array.isArray(d.summary) ? d.summary : [];
    summary.forEach(item => {
      const text = typeof item === 'string' ? item : (item && item.text) || '';
      merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
      setCell(r, 0, text, cellStyle({
        align: 'left',
        color: typeof item === 'object' && item ? item.color : '',
        bold: typeof item === 'object' && item ? !!item.bold : false
      }));
      r += 1;
    });

    /* 3) "本周KPI" 区块标题（橙色栏） */
    merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
    setCell(r, 0, '本周KPI', barStyle());
    r += 1;

    const kpis = Array.isArray(d.kpi) ? d.kpi.slice(0, 3) : [];
    kpis.forEach(k => {
      const label = (k && k.label) || '';
      const value = (k && k.value) || '';
      const trend = (k && k.trend) || '';
      // 标签 | 值（加粗）| 趋势（合并到末列）
      setCell(r, 0, label, cellStyle({ align: 'left' }));
      setCell(r, 1, value, cellStyle({ align: 'center', bold: true, color: '#ED7D31' }));
      merges.push({ s: { r: r, c: 2 }, e: { r: r, c: COLS - 1 } });
      setCell(r, 2, trend, cellStyle({ align: 'left' }));
      r += 1;
    });

    /* 4) "本周前10" 区块标题（橙色栏） */
    merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
    setCell(r, 0, '本周前10', barStyle());
    r += 1;

    // 表头：排名 | 模型 | Tokens | 环比（末列合并）
    setCell(r, 0, '排名', headStyle());
    setCell(r, 1, '模型', headStyle());
    setCell(r, 2, 'Tokens', headStyle());
    merges.push({ s: { r: r, c: 3 }, e: { r: r, c: COLS - 1 } });
    setCell(r, 3, '环比', headStyle());
    r += 1;

    const top10 = Array.isArray(d.top10) ? d.top10 : [];
    const maxTop = Math.min(top10.length, 10);
    for (let i = 0; i < maxTop; i++) {
      const t = top10[i] || {};
      setCell(r, 0, t.rank != null ? t.rank : (i + 1), cellStyle({ align: 'center' }), 'n');
      setCell(r, 1, t.name || '', cellStyle({ align: 'left' }));
      setCell(r, 2, t.tokens_text || (t.tokens != null ? t.tokens + 'T Tokens' : ''), cellStyle({ align: 'center' }));
      merges.push({ s: { r: r, c: 3 }, e: { r: r, c: COLS - 1 } });
      setCell(r, 3, t.wow_text || (t.wow_num != null ? '环比' + (t.wow_num >= 0 ? '+' : '') + t.wow_num + '%' : ''), cellStyle({ align: 'center' }));
      r += 1;
    }
    // 若 top10 为空，也保留表头（不补行）

    /* 5) 模块标题 + 评论（每个模块两行：标题行 + 评论行，均合并） */
    if (kpis.length > 0 || true) {
      merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
      setCell(r, 0, '本周模块', barStyle());
      r += 1;
    }
    const modules = Array.isArray(d.modules) ? d.modules : [];
    modules.forEach(m => {
      const visible = !m || m.visible !== false;
      if (!visible) return;
      merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
      setCell(r, 0, (m && m.title) || '', cellStyle({ align: 'left', bold: true }));
      r += 1;
      if (m && m.comment) {
        merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
        setCell(r, 0, m.comment, cellStyle({ align: 'left', color: '#808080' }));
        r += 1;
      }
    });

    /* 6) 页脚（橙色栏，合并 A:D） */
    merges.push({ s: { r: r, c: 0 }, e: { r: r, c: COLS - 1 } });
    setCell(r, 0, d.footer || '来源：Openrouter · 欢迎交流', barStyle());
    r += 1;

    /* 列宽：A 宽，其余适中 */
    ws['!cols'] = [
      { wch: 40 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 }
    ];

    /* 行高：标题行更高（支持有限，无害） */
    ws['!rows'] = [{ hpt: 38 }];

    ws['!merges'] = merges;
    // 范围（行数-1, 列数-1）；至少 1 行 4 列
    ws['!ref'] = 'A1:' + cellAddr(Math.max(r, 1) - 1, COLS - 1);
    return ws;
  }

  /* ---------- Sheet 2：【原始数据】消耗量统计 ---------- */
  function buildTotalSheet(d) {
    const ws = {};
    const headers = ['周起始时间', '大模型总调用量（单位：T）', '周环比'];
    const th = d.total_history || {};
    const dates = Array.isArray(th.dates) ? th.dates : [];
    const values = Array.isArray(th.values) ? th.values : [];
    const wows = Array.isArray(th.wow) ? th.wow : [];
    const n = dates.length;

    // 表头
    headers.forEach((h, c) => {
      ws[cellAddr(0, c)] = { t: 's', v: h, s: headStyle() };
    });

    // 数据行
    for (let i = 0; i < n; i++) {
      const rr = i + 1;
      ws[cellAddr(rr, 0)] = { t: 's', v: String(at(dates, i, '')), s: cellStyle({ align: 'center' }) };
      const val = at(values, i, null);
      ws[cellAddr(rr, 1)] = { t: typeof val === 'number' ? 'n' : 's', v: val == null ? '' : val, s: cellStyle({ align: 'center' }) };
      const wv = at(wows, i, null);
      // wow 可能是 null（首周）或数字
      ws[cellAddr(rr, 2)] = {
        t: typeof wv === 'number' ? 'n' : 's',
        v: wv == null ? '' : wv,
        s: cellStyle({ align: 'center' })
      };
    }

    ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 14 }];
    ws['!ref'] = 'A1:' + cellAddr(Math.max(n, 0), headers.length - 1);
    return ws;
  }

  /* ---------- Sheet 3：【国内】每天消耗量统计（按周聚合） ---------- */
  function buildDomesticSheet(d) {
    const ws = {};
    const dom = d.domestic || {};
    const dates = Array.isArray(dom.dates) ? dom.dates : [];
    const n = dates.length;
    const models = (dom.models && typeof dom.models === 'object') ? dom.models : {};
    const totalT = Array.isArray(dom.total_T) ? dom.total_T : [];
    const totalWow = Array.isArray(dom.total_wow) ? dom.total_wow : [];
    const globalT = Array.isArray(dom.global_T) ? dom.global_T : [];
    const share = Array.isArray(dom.share) ? dom.share : [];

    // 列布局：
    // 0: 周日期
    // 对每个模型两列（值 + 环比）
    // 之后：国产总和, 国产环比, 全球总和, 份额%
    const cols = ['周日期'];
    MODEL_ORDER.forEach(m => {
      cols.push(m + '（单位 T）');
      cols.push(m + ' 环比%');
    });
    cols.push('国产总和', '国产环比', '全球总和', '份额%');

    // 表头
    cols.forEach((h, c) => {
      ws[cellAddr(0, c)] = { t: 's', v: h, s: headStyle() };
    });

    // 数据行
    for (let i = 0; i < n; i++) {
      const rr = i + 1;
      let c = 0;
      // 周日期
      ws[cellAddr(rr, c++)] = { t: 's', v: String(at(dates, i, '')), s: cellStyle({ align: 'center' }) };
      // 每个模型两列
      MODEL_ORDER.forEach(m => {
        const md = models[m] || {};
        const vals = Array.isArray(md.values_T) ? md.values_T : [];
        const ws_ = Array.isArray(md.wow) ? md.wow : [];
        const vv = at(vals, i, null);
        ws[cellAddr(rr, c++)] = {
          t: typeof vv === 'number' ? 'n' : 's',
          v: vv == null ? '' : vv,
          s: cellStyle({ align: 'center' })
        };
        const ww = at(ws_, i, null);
        ws[cellAddr(rr, c++)] = {
          t: typeof ww === 'number' ? 'n' : 's',
          v: ww == null ? '' : ww,
          s: cellStyle({ align: 'center' })
        };
      });
      // 国产总和
      const st = at(totalT, i, null);
      ws[cellAddr(rr, c++)] = {
        t: typeof st === 'number' ? 'n' : 's',
        v: st == null ? '' : st,
        s: cellStyle({ align: 'center', bold: true })
      };
      // 国产环比
      const sw = at(totalWow, i, null);
      ws[cellAddr(rr, c++)] = {
        t: typeof sw === 'number' ? 'n' : 's',
        v: sw == null ? '' : sw,
        s: cellStyle({ align: 'center', bold: true })
      };
      // 全球总和
      const gt = at(globalT, i, null);
      ws[cellAddr(rr, c++)] = {
        t: typeof gt === 'number' ? 'n' : 's',
        v: gt == null ? '' : gt,
        s: cellStyle({ align: 'center', bold: true })
      };
      // 份额%
      const sh = at(share, i, null);
      ws[cellAddr(rr, c++)] = {
        t: typeof sh === 'number' ? 'n' : 's',
        v: sh == null ? '' : sh,
        s: cellStyle({ align: 'center', bold: true })
      };
    }

    // 列宽：首列较宽，其余统一
    const colWidths = [{ wch: 14 }];
    for (let i = 1; i < cols.length; i++) colWidths.push({ wch: 15 });
    ws['!cols'] = colWidths;

    ws['!ref'] = 'A1:' + cellAddr(Math.max(n, 0), cols.length - 1);
    return ws;
  }

  /* ---------- 主入口 ---------- */
  function exportToExcel(d) {
    try {
      if (typeof XLSX === 'undefined') {
        alert('XLSX 库未加载，无法导出 Excel。请检查网络或 CDN 引入。');
        return;
      }
      d = d || {};

      const wb = XLSX.utils.book_new();
      wb.Props = {
        Title: d.title || 'AI模型 Tokens 消耗数据库',
        CreatedDate: new Date()
      };

      const ws1 = buildOverviewSheet(d);
      const ws2 = buildTotalSheet(d);
      const ws3 = buildDomesticSheet(d);

      XLSX.utils.book_append_sheet(wb, ws1, '看板');
      XLSX.utils.book_append_sheet(wb, ws2, '【原始数据】消耗量统计');
      XLSX.utils.book_append_sheet(wb, ws3, '【国内】每天消耗量统计');

      // 文件名日期：优先用最新一周的实际日期（动态），回退到 meta.week_label
      const latestDate = (() => {
        const cands = [
          d.total_history && d.total_history.dates && d.total_history.dates.slice(-1)[0],
          d.domestic && d.domestic.dates && d.domestic.dates.slice(-1)[0]
        ].filter(Boolean);
        if (!cands.length) return '';
        // 取最大的日期，并规整成 YYYYMMDD（去掉分隔符）
        const latest = cands.sort().pop();
        return String(latest).replace(/[-/年月日\s]/g, '').slice(0, 8);
      })();
      const label = latestDate || (d.meta && d.meta.week_label) || 'export';
      const filename = `Token出海数据库_${label}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (e) {
      console.error('exportToExcel 失败：', e);
      alert('导出 Excel 失败：' + (e && e.message ? e.message : e));
    }
  }

  // 暴露为全局函数
  window.exportToExcel = exportToExcel;
})();
