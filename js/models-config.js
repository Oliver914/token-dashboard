/* =========================================================
   国产大模型厂商配置 · 全项目唯一真相源
   =========================================================
   想新增厂商？只需在下面 MODELS 数组里加一项即可，
   全项目（看板图表、后台表格、Excel 导入导出）自动生效。

   字段说明：
     name    : 显示名（看板和导出里用这个名字）
     aliases : Excel 表头的别名列表（导入时按表头匹配，大小写不敏感；
               只要表头命中任一别名，就认作这个厂商）
     color   : 看板明细小图的颜色（不填则自动按顺序分配）

   ★ 新增厂商示例（假设要加「字节豆包」）：
   { name: '字节', aliases: ['字节','豆包','Doubao','doubao','bytedance'] }

   顺序就是看板「模块4 国产模型明细」里小图的排列顺序，可随意调整。
   --------------------------------------------------------- */

const MODELS_CONFIG = {
  // 厂商顺序 = 看板小图顺序
  models: [
    { name: 'DeepSeek', aliases: ['deepseek', 'ds'] },
    { name: 'Qwen',     aliases: ['qwen', '通义', '通义千问'] },
    { name: 'Kimi',     aliases: ['kimi', 'moonshot'] },
    { name: 'GLM',      aliases: ['glm', '智谱', 'zhipu', 'chatglm'] },
    { name: 'Minimax',  aliases: ['minimax', 'mini-max'] },
    { name: '小米',      aliases: ['小米', 'mimo', 'mi-mo', 'redmi'] },
    { name: '腾讯',      aliases: ['腾讯', 'hy', 'hunyuan', '混元'] },
    // ↓↓↓ 在这里追加新厂商 ↓↓↓
    // { name: '字节', aliases: ['字节','豆包','doubao','bytedance'] },
    // { name: '百度', aliases: ['百度','ernie','文心'] },
  ],

  // 看板小图配色（按顺序循环使用；厂商自定义 color 优先）
  palette: ['#ED7D31', '#5B8FF9', '#5AD8A6', '#F6BD16', '#E86452', '#6DC8EC', '#945FB9',
            '#3FB8AF', '#FF9D4D', '#7E9BE8']
};

/* ============ 工具方法（供各模块复用）============ */
// 返回显示名数组
function getModelNames() {
  return MODELS_CONFIG.models.map(m => m.name);
}
// 按显示名取索引
function getModelIndex(name) {
  return MODELS_CONFIG.models.findIndex(m => m.name === name);
}
// 按显示名取颜色
function getModelColor(name) {
  const i = getModelIndex(name);
  const m = MODELS_CONFIG.models[i];
  if (m && m.color) return m.color;
  return MODELS_CONFIG.palette[i % MODELS_CONFIG.palette.length];
}
// 用 Excel 表头文字匹配厂商，返回显示名；匹配不到返回 null
// header 不区分大小写、去空格
function matchModelByHeader(header) {
  if (!header) return null;
  const h = String(header).trim().toLowerCase();
  for (const m of MODELS_CONFIG.models) {
    const cands = [m.name.toLowerCase(), ...(m.aliases || []).map(a => a.toLowerCase())];
    if (cands.includes(h)) return m.name;
  }
  return null;
}
