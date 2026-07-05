# Token 出海数据库 · 看板 + 管理后台

把每周更新的 Excel「看板」自动转成高级感网页，并提供一个**可视化管理后台**在线编辑所有内容。
支持两种工作流：Excel 一键导入 / 后台在线编辑。

---

## 功能总览

**看板页**（公开，客户访问）
- 亮色简约风仪表盘：本周总结、3 个 KPI、4 个图表模块、前 10 排名
- 鼠标悬停图表显示完整周数据
- 右上角「导出 Excel」按钮，一键下载完整数据

**管理后台**（隐藏，访问 `/admin.html`）
- 账号密码登录（初始 `admin / admin`，可改）
- 在线可视化编辑：本周总结（Markdown + 字体颜色高亮）、KPI、模块、前 10 排名、图表数据、标题页脚
- 图表数据支持：① 表格直接编辑 ② Excel 上传批量导入
- 保存后看板**实时自动刷新**（无需刷新页面）

---

## 目录结构

```
coding/
├── Tokens/                          ← 你的 Excel（每周新增一个）
└── token-dashboard/
    ├── index.html                   看板页（公开）
    ├── admin.html                   管理后台（隐藏）
    ├── css/
    │   ├── style.css                看板样式
    │   └── admin.css                后台样式
    ├── js/
    │   ├── firebase-config.js       ★ Firebase 配置（部署时填）
    │   ├── data-store.js            数据抽象层
    │   ├── dashboard.js             看板渲染
    │   ├── admin.js                 后台逻辑
    │   ├── excel-parser.js          后台 Excel 导入解析
    │   └── export-excel.js          看板页导出 Excel
    ├── data.json                    本地兜底数据（update.py 生成）
    ├── update.py                    Excel 解析脚本
    ├── 更新网页.command              每周双击入口
    └── README.md                    本文件
```

---

## 部署方式选哪一种？

| 方式 | 实时编辑 | 多设备同步 | 配置复杂度 |
|---|---|---|---|
| **A. 不配 Firebase**（纯本地） | ✗（仅当前浏览器） | ✗ | ★ 最简单 |
| **B. 配 Firebase**（推荐） | ✓ | ✓ | ★★ 一次配置 |

- **A 方式**：保持现状即可立刻用。后台编辑内容只存在当前浏览器（localStorage）。换台电脑看不到。适合先试用。
- **B 方式**：花 10 分钟配 Firebase 后，后台编辑的内容存云端，任何设备打开看板都看到最新，且支持多人。

---

## 方式 A：立即开始（本地模式）

1. 双击 `更新网页.command` 或运行 `python3 update.py` 生成 `data.json`
2. 终端运行 `python3 -m http.server 8000`，浏览器开 `http://localhost:8000`
3. 访问 `http://localhost:8000/admin.html`，用 `admin / admin` 登录即可编辑

> 部署到 GitHub Pages 的步骤见下文「部署到 GitHub Pages」。

---

## 方式 B：配置 Firebase（解锁云端 + 实时同步）

### 第 1 步：注册 Firebase（用 Google 账号）
访问 https://console.firebase.google.com → 点「添加项目」→ 起个项目名（如 `token-dashboard`）→ 完成。

### 第 2 步：开启 Realtime Database
1. 左侧菜单 → **Build → Realtime Database** → 「创建数据库」
2. 位置选「美国」或「新加坡」均可
3. **安全规则选「测试模式」**（30 天内允许读写，便于先跑通；正式使用见第 6 步加固）

### 第 3 步：开启 Authentication
1. 左侧菜单 → **Build → Authentication** → 「Get Started」
2. 「Sign-in method」标签 → 启用「电子邮件/密码」
3. 「Users」标签 → 「添加用户」→ 邮箱填 `admin@token.local`（任意），密码填 `admin123`（至少 6 位）
   > 这就是你以后的登录账号。后台登录用这个邮箱 + 密码（不再是 admin/admin）。

### 第 4 步：拿到 Web 配置
1. 左下角 ⚙️ → **项目设置**
2. 滚动到「您的应用」→ 点 `</>` 图标注册一个 Web 应用，起个昵称
3. 复制弹出的 `firebaseConfig` 内容（类似下面）：
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "token-dashboard.firebaseapp.com",
     databaseURL: "https://token-dashboard-default-rtdb.firebaseio.com",
     projectId: "token-dashboard",
     storageBucket: "token-dashboard.appspot.com",
     messagingSenderId: "123...",
     appId: "1:123...:web:abc..."
   };
   ```

### 第 5 步：填入本项目
打开 `js/firebase-config.js`，把上面的值替换掉里面的占位符（`YOUR_API_KEY` 等）。保存即可，无需重启。

### 第 6 步：（可选）加固数据库规则
跑通后，回到 Realtime Database → 「规则」，改成只允许登录用户写、所有人可读：
```json
{
  "rules": {
    ".read": true,
    ".write": "auth != null"
  }
}
```

### 第 7 步：首次写入数据
后台登录后点「保存全部」，或本地运行 `python3 update.py --firebase`，数据就会进云端。
看板页和后台从此**多设备实时同步**。

---

## 部署到 GitHub Pages（让客户访问）

1. 注册 GitHub 账号 → 新建公开仓库 `token-dashboard`
2. 在本目录运行（替换 `你的用户名`）：
   ```bash
   git init
   git add .
   git commit -m "Token 看板 + 后台"
   git branch -M main
   git remote add origin https://github.com/你的用户名/token-dashboard.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Branch 选 main → Save**
4. 约 1 分钟后得到固定链接：`https://你的用户名.github.io/token-dashboard/`
5. 管理后台在：`https://你的用户名.github.io/token-dashboard/admin.html`（客户不知道这个地址就进不去）

---

## 每周工作流（二选一）

### Excel 派（适合批量数据更新）
1. 周六照常做 Excel（文件名带 8 位日期 `YYYYMMDD`）
2. 放进 `Tokens/` 文件夹
3. **双击 `更新网页.command`**
   - 已配 Firebase：自动写入云端，看板秒级刷新
   - 未配 Firebase：自动 git 推送到 GitHub Pages

### 后台派（适合文字微调 / 不想开 Excel）
1. 浏览器打开 `admin.html` 登录
2. 改总结/KPI/模块/排名/数据 → 「保存全部」
3. 看板自动刷新

---

## 各功能怎么用

| 功能 | 操作 |
|---|---|
| 高亮某段文字 | 后台「本周总结」→ 选中文字 → 点工具栏加粗 `B` 或选颜色色板 |
| 隐藏某模块 | 后台「模块管理」→ 关掉该模块的开关 |
| 调整模块顺序 | 后台「模块管理」→ 点 ▲▼ 上下移动 |
| 改排名 | 后台「前 10 排名」→ 直接改表格，可增删行 |
| 批量更新数据 | 后台「图表数据」→ 「Excel 导入」→ 上传 Excel（或下载模板填写） |
| 导出给客户 | 看板右上角「导出 Excel」→ 下载完整 .xlsx |
| 改密码 | 后台「账号设置」→ 输入新密码 |

---

## 常见问题

**Q：后台地址是什么？**
A：`你的网址/admin.html`。主页没有任何入口链接，必须手动输入地址。

**Q：忘了 admin 密码？**
A：本地模式——浏览器清除 localStorage 即重置为 admin/admin。
Firebase 模式——去 Firebase 控制台 Authentication → Users 改密码。

**Q：Firebase 测试模式 30 天到期了怎么办？**
A：到期前到 Realtime Database → 规则，改第 6 步那条（登录才能写）。不影响客户读看板。

**Q：Excel 上传报「无法解密」？**
A：浏览器端 SheetJS 不支持加密 Excel。两个办法：① 在 Excel 里另存为不加密版本再传；② 用命令行 `python3 update.py --firebase`（支持密码 ainb 自动解密）。

**Q：想同时用 Excel 和后台编辑会冲突吗？**
A：不会，但「后保存的覆盖先保存的」。建议：批量数据用 Excel 导入，文字微调用后台，两者交替使用。

**Q：数据安全吗？**
A：Excel 原文件永远在你本地，只有脱敏的看板数据（本就给客户看的）才上传云端。
