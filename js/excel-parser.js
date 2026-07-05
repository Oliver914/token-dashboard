/* =========================================================
   Excel 导入解析模块 · excel-parser.js
   =========================================================
   作用：在管理后台（admin.html）里，把用户上传的 Excel 文件
        解析成看板图表所需的数据结构，无需经过 Python 脚本。

   依赖：SheetJS（全局 window.XLSX），在 admin.html 中已引入：
           <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
         本脚本需在 XLSX 之后、admin.js 之前引入。

   对外暴露：
     window.parseTokenExcel(file)      解析 Excel File 对象，返回 Promise
     window.downloadTemplateExcel()    生成并下载空白模板 .xlsx

   关于「密码保护」的说明（重要）：
     SheetJS 社区版「不支持」解密密码保护的 xlsx（Agile Encryption 需要的
     SHA/带密钥派生的流式解密在纯浏览器环境里实现复杂且不稳定）。本模块
     采取「尽力而为 + 优雅降级」的策略：
       1. 先用密码 ainb 调用 XLSX.read 尝试解析（兼容少数仅包级加密的老文件）；
       2. 失败再退回「不带密码」直接解析（绝大多数手动另存的未加密文件走这里）；
       3. 仍失败 → 抛出友好的中文错误，引导用户：
            (a) 另存为时不勾选密码；或
            (b) 使用命令行 `python3 update.py --firebase` 路径，原生支持密码解密。

   返回数据结构（与看板图表数据形状一致）：
     {
       total_history: { dates:[], values:[], wow:[] },
       domestic: {
         dates:[], total_T:[], total_wow:[], global_T:[], share:[],
         models: {
           "DeepSeek":{ values_T:[], wow:[] },
           "Qwen":{...}, "Kimi":{...}, "GLM":{...},
           "Minimax":{...}, "小米":{...}, "腾讯":{...}
         }
       },
       meta: { source_file:"xxx.xlsx", week_label:"20260628" }
     }
   --------------------------------------------------------- */
(function () {
  'use strict';

  /* Excel 文件的固定密码（与 update.py 保持一致） */
  var EXCEL_PASSWORD = 'ainb';

  /* 国产模型的固定名称与读取顺序（与数据生成顺序一致） */
  var MODEL_ORDER = ['DeepSeek', 'Qwen', 'Kimi', 'GLM', 'Minimax', '小米', '腾讯'];

  /* 国产明细 sheet 中各模型对应的列位置（1-based，M=13）。
     每个模型占相邻两列：值列 + 环比列。列定义参照 update.py：
       M(13)=周日期；N/O=DeepSeek；P/Q=Qwen；R/S=Kimi；T/U=GLM；
       V/W=Minimax；X/Y=小米；Z/AA=腾讯；
       AB(28)=国产总和；AC(29)=国产环比；AD(30)=全球总和；AE(31)=份额 */
  var MODEL_COL_MAP = [
    { name: 'DeepSeek', vcol: 14, wcol: 15 },
    { name: 'Qwen',     vcol: 16, wcol: 17 },
    { name: 'Kimi',     vcol: 18, wcol: 19 },
    { name: 'GLM',      vcol: 20, wcol: 21 },
    { name: 'Minimax',  vcol: 22, wcol: 23 },
    { name: '小米',      vcol: 24, wcol: 25 },
    { name: '腾讯',      vcol: 26, wcol: 27 }
  ];
  var DOM_DATE_COL = 13;   // M 列：周日期
  var DOM_TOTAL_COL = 28;  // AB 列：国产总和（单位：十亿 token）
  var DOM_TOTAL_WOW_COL = 29; // AC 列：国产环比
  var DOM_GLOBAL_COL = 30;   // AD 列：全球总和（单位：十亿 token）
  var DOM_SHARE_COL = 31;    // AE 列：份额

  /* 单位换算系数：原始模型/总和/全球值为「十亿 token」，÷1000 转 T */
  var UNIT_TO_T = 1000;

  /* 连续空行的容许上限：超过此值则停止扫描，避免误读尾部空白 */
  var MAX_EMPTY_RUN = 5;

  /* ===========================================================
     小工具函数
     =========================================================== */

  /* 把任意单元格值转成数字。容忍逗号、百分号、前后空白、空单元格；
     无法解析时返回 null（绝不抛异常）。 */
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      // 排除 NaN / Infinity
      return isFinite(v) ? v : null;
    }
    if (typeof v === 'boolean') return v ? 1 : 0;
    var s = String(v).trim();
    if (!s) return null;
    // 去掉千分位逗号与百分号（百分号稍后由 normalizeWow / share 单独处理）
    s = s.replace(/,/g, '').replace(/%/g, '').trim();
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /* 把环比值规整为「百分比数值」（如 0.18 → 18，"18%" → 18，18 → 18）。
     规则：先 toNum；若结果为 null 则返回 null；若 |值| <= 1 视作小数比例 ×100；
     否则原样保留。保留两位小数。 */
  function normalizeWow(v) {
    var n = toNum(v);
    if (n === null) return null;
    if (Math.abs(n) <= 1) n = n * 100;
    return Math.round(n * 100) / 100;
  }

  /* 份额值规整：0.546 → 54.6（百分比数值）；已是百分数（>1）则原样保留；
     无法解析返回 null。 */
  function normalizeShare(v) {
    var n = toNum(v);
    if (n === null) return null;
    if (Math.abs(n) <= 1) n = n * 100;
    return Math.round(n * 100) / 100;
  }

  /* 把「十亿 token」原始值换算成 T。null 原样返回。保留 3 位小数。 */
  function toT(raw) {
    var n = toNum(raw);
    if (n === null) return null;
    return Math.round((n / UNIT_TO_T) * 1000) / 1000;
  }

  /* 把单元格的日期值格式化成 'YYYY-MM-DD'。
     - Date 实例：直接取年月日补零
     - 数字：当作 Excel 序列号，按 epoch(1899-12-30) 换算（优先用 XLSX.SSF）
     - 字符串：trim 后原样返回（已形如 '2026-06-28'）
     任何异常都兜底为 String(v)，绝不抛错。 */
  function formatDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) {
      return padDate(v);
    }
    if (typeof v === 'number') {
      // Excel 序列号 → 日期
      try {
        if (typeof XLSX !== 'undefined' && XLSX.SSF && typeof XLSX.SSF.parse_date === 'function') {
          var pd = XLSX.SSF.parse_date(v);
          if (pd && pd.y && pd.m && pd.d) {
            return pd.y + '-' + pad2(pd.m) + '-' + pad2(pd.d);
          }
        }
      } catch (e) { /* 兜底手动计算 */ }
      return excelSerialToDateStr(v);
    }
    return String(v).trim();
  }

  /* Date → 'YYYY-MM-DD' */
  function padDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Excel 序列号 → 'YYYY-MM-DD'（epoch = 1899-12-30，规避 1900 闰年 bug） */
  function excelSerialToDateStr(serial) {
    try {
      // 整数部分为天数；忽略小数（时间）部分
      var days = Math.floor(serial);
      var epoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
      var ms = epoch.getTime() + days * 86400000;
      var d = new Date(ms);
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    } catch (e) {
      return String(serial);
    }
  }

  /* 从文件名里抽取 8 位数字作为周标签（如 '...20260628.xlsx' → '20260628'）；
     抽不到返回空字符串。 */
  function extractWeekLabel(filename) {
    if (!filename) return '';
    var m = String(filename).match(/(\d{8})/);
    return m ? m[1] : '';
  }

  /* 判断一行数据是否「全空」（所有指定列都为 null/空字符串） */
  function rowIsEmpty(cells) {
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c !== null && c !== undefined && String(c).trim() !== '') return false;
    }
    return true;
  }

  /* ===========================================================
     步骤 1：读取 File 为 ArrayBuffer
     =========================================================== */
  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () {
        reject(new Error('读取文件失败，请重试或更换文件。'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ===========================================================
     步骤 2：尝试用 SheetJS 解析工作簿（含密码降级）
     -----------------------------------------------------------
     返回 XLSX workbook；失败抛 Error（带中文说明）。 */
  function readWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('XLSX 库未加载，无法解析 Excel。请检查网络或 CDN 引入。');
    }

    var data = new Uint8Array(arrayBuffer);
    var wb = null;

    // —— 策略 A：带密码尝试（兼容少数仅包级加密的老格式）——
    try {
      wb = XLSX.read(data, { type: 'array', password: EXCEL_PASSWORD });
    } catch (eA) {
      wb = null;
    }
    if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
      // —— 策略 B：不带密码直接读（绝大多数手动另存的未加密文件走这里）——
      try {
        wb = XLSX.read(data, { type: 'array' });
      } catch (eB) {
        wb = null;
      }
    }

    // —— 策略 C：两种都失败 —— 说明很可能是真正的密码保护（Agile Encryption），
    //    社区版 SheetJS 无法解密，给出清晰引导。
    if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
      throw new Error(
        '无法解析该 Excel 文件：很可能是带密码保护的版本（SheetJS 社区版不支持解密）。\n' +
        '请选择以下任一方式：\n' +
        '  1) 在 Excel 中「另存为」，不勾选密码保护后重新上传；或\n' +
        '  2) 使用命令行：python3 update.py --firebase（原生支持 ainb 密码解密）。'
      );
    }

    return wb;
  }

  /* ===========================================================
     步骤 3：按名称定位 sheet（找不到则按索引兜底）
     =========================================================== */
  function pickSheet(wb, keywords, fallbackIndex) {
    var names = wb.SheetNames || [];
    // 按关键字模糊匹配
    for (var i = 0; i < names.length; i++) {
      for (var k = 0; k < keywords.length; k++) {
        if (names[i].indexOf(keywords[k]) !== -1) return wb.Sheets[names[i]];
      }
    }
    // 兜底：按索引
    if (typeof fallbackIndex === 'number' && fallbackIndex < names.length) {
      return wb.Sheets[names[fallbackIndex]];
    }
    return null;
  }

  /* ===========================================================
     步骤 5：解析【原始数据】消耗量统计 → total_history
     -----------------------------------------------------------
     列：A(0)=周起始时间；B(1)=大模型总调用量(单位T)；C(2)=周环比
     从第 2 行开始（跳过表头），遇到连续空行超过阈值则停止。 */
  function parseTotalHistory(ws) {
    var result = { dates: [], values: [], wow: [] };
    if (!ws) return result;

    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!rows || !rows.length) return result;

    var emptyRun = 0;
    // i=0 是表头，从 i=1 开始读数据
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var dCell = row[0];
      var vCell = row[1];
      var wCell = row[2];

      // 全空行：计入空行计数，超过阈值则停止
      if (rowIsEmpty([dCell, vCell, wCell])) {
        emptyRun++;
        if (emptyRun >= MAX_EMPTY_RUN) break;
        continue;
      }
      emptyRun = 0;

      result.dates.push(formatDate(dCell));
      result.values.push(toNum(vCell));
      result.wow.push(normalizeWow(wCell));
    }
    return result;
  }

  /* ===========================================================
     步骤 6：解析【国内】每天消耗量统计 → domestic
     -----------------------------------------------------------
     周聚合块位于 M:AE，从第 2 行起：
       M(0-based 12)=周日期；模型值/环比成对（N..AA）；
       AB(0-based 27)=国产总和；AC(28)=国产环比；
       AD(29)=全球总和；AE(30)=份额。
     模型/总和/全球的原始单位为「十亿 token」，需 ÷1000 转 T。 */
  function parseDomestic(ws) {
    var result = {
      dates: [],
      total_T: [],
      total_wow: [],
      global_T: [],
      share: [],
      models: {}
    };
    MODEL_ORDER.forEach(function (m) {
      result.models[m] = { values_T: [], wow: [] };
    });
    if (!ws) return result;

    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!rows || !rows.length) return result;

    var emptyRun = 0;
    // i=0 为表头，从 i=1 开始
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var dateCell = row[DOM_DATE_COL - 1]; // 0-based 索引

      // 日期列为空：判定为空行，计入空行计数
      if (dateCell === null || dateCell === undefined || String(dateCell).trim() === '') {
        emptyRun++;
        if (emptyRun >= MAX_EMPTY_RUN) break;
        continue;
      }
      emptyRun = 0;

      result.dates.push(formatDate(dateCell));

      // 各模型：值 ÷1000 转 T，环比规整为百分比
      MODEL_COL_MAP.forEach(function (mc) {
        var rawVal = row[mc.vcol - 1];
        var rawWow = row[mc.wcol - 1];
        result.models[mc.name].values_T.push(toT(rawVal));
        result.models[mc.name].wow.push(normalizeWow(rawWow));
      });

      // 国产总和 / 国产环比 / 全球总和 / 份额
      result.total_T.push(toT(row[DOM_TOTAL_COL - 1]));
      result.total_wow.push(normalizeWow(row[DOM_TOTAL_WOW_COL - 1]));
      result.global_T.push(toT(row[DOM_GLOBAL_COL - 1]));
      result.share.push(normalizeShare(row[DOM_SHARE_COL - 1]));
    }
    return result;
  }

  /* ===========================================================
     主入口：window.parseTokenExcel(file)
     -----------------------------------------------------------
     file: 浏览器 File 对象（来自 <input type="file">）
     返回: Promise，resolve 上述结构化对象；reject 带 Error（中文 message） */
  function parseTokenExcel(file) {
    if (!file) {
      return Promise.reject(new Error('未选择文件。'));
    }
    var filename = file.name || 'unknown.xlsx';

    return readArrayBuffer(file)
      .then(function (buf) {
        // 1) 解析工作簿（含密码降级）
        var wb = readWorkbook(buf);

        // 2) 定位两个 sheet
        var wsTotal = pickSheet(wb, ['原始数据'], 1);
        var wsDomestic = pickSheet(wb, ['国内'], 2);

        // 两个都找不到 → 直接报错
        if (!wsTotal && !wsDomestic) {
          throw new Error(
            '未在文件中找到数据工作表（应包含「原始数据」与「国内」两个 sheet）。\n' +
            '请确认上传的是【天风计算机】Token出海数据库 格式的文件，' +
            '或点击「下载模板」按模板填写后上传。'
          );
        }

        // 3) 分别解析
        var total_history = parseTotalHistory(wsTotal);
        var domestic = parseDomestic(wsDomestic);

        // 4) 组装 meta
        var meta = {
          source_file: filename,
          week_label: extractWeekLabel(filename)
        };

        return {
          total_history: total_history,
          domestic: domestic,
          meta: meta
        };
      });
  }

  /* ===========================================================
     模板下载：window.downloadTemplateExcel()
     -----------------------------------------------------------
     生成包含两个 sheet 正确表头的空白模板，文件名
     「Token看板数据模板.xlsx」，立即触发浏览器下载。 */
  function downloadTemplateExcel() {
    try {
      if (typeof XLSX === 'undefined') {
        alert('XLSX 库未加载，无法生成模板。请检查网络或 CDN 引入。');
        return;
      }

      var wb = XLSX.utils.book_new();
      wb.Props = {
        Title: 'Token 看板数据模板',
        CreatedDate: new Date()
      };

      /* —— Sheet 1：【原始数据】消耗量统计 —— */
      var headers1 = ['周起始时间', '大模型总调用量（单位：T）', '周环比'];
      var ws1 = XLSX.utils.aoa_to_sheet([headers1]);
      ws1['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws1, '【原始数据】消耗量统计');

      /* —— Sheet 2：【国内】每天消耗量统计 ——
         列顺序：周日期 | 7 个模型（值+环比成对）| 国产总和 | 国产环比 | 全球总和 | 份额 */
      var headers2 = ['周日期'];
      MODEL_ORDER.forEach(function (m) {
        headers2.push(m, m + '环比');
      });
      headers2.push('国产总和', '国产环比', '全球总和', '份额');

      var ws2 = XLSX.utils.aoa_to_sheet([headers2]);
      // 列宽：首列稍宽，其余统一
      var cols2 = [{ wch: 14 }];
      for (var i = 1; i < headers2.length; i++) cols2.push({ wch: 14 });
      ws2['!cols'] = cols2;
      XLSX.utils.book_append_sheet(wb, ws2, '【国内】每天消耗量统计');

      /* —— 触发下载 —— */
      XLSX.writeFile(wb, 'Token看板数据模板.xlsx');
    } catch (e) {
      console.error('downloadTemplateExcel 失败：', e);
      alert('生成模板失败：' + (e && e.message ? e.message : e));
    }
  }

  /* ===========================================================
     暴露为全局函数
     =========================================================== */
  window.parseTokenExcel = parseTokenExcel;
  window.downloadTemplateExcel = downloadTemplateExcel;
})();
