# Token 出海数据库 · 自动更新看板

把每周更新的 Excel「看板」sheet 自动转成高级感网页，部署到 GitHub Pages。
客户访问固定链接即可看到最新数据，**每周双击一下脚本即可，不再发图片**。

---

## 目录结构

```
coding/
├── Tokens/                          ← 你现有的 Excel（每周新增一个）
└── token-dashboard/                 ← 网页项目
    ├── index.html                   网页
    ├── css/style.css                亮色简约风样式
    ├── js/dashboard.js              图表渲染
    ├── data.json                    脚本自动生成（网页读它）
    ├── update.py                    核心：解密+抽取+生成+推送
    ├── 更新网页.command              ← 每周双击它即可
    └── README.md                    本文件
```

---

## 一、首次部署（只需做一次）

### 第 1 步：确认本地能生成数据
在终端运行（验证脚本正常）：
```bash
cd ~/Desktop/zcode/coding/token-dashboard
python3 update.py
```
看到 `🎉 完成！` 且生成了 `data.json` 即可。

### 第 2 步：本地预览网页效果
```bash
python3 -m http.server 8000
```
浏览器打开 http://localhost:8000 查看效果。确认满意后按 `Ctrl+C` 停止。

### 第 3 步：注册 GitHub 账号（已有可跳过）
访问 https://github.com 注册（免费）。

### 第 4 步：在 GitHub 新建仓库
1. 登录后点右上角 **+** → **New repository**
2. Repository name 填：`token-dashboard`
3. 选 **Public**（公开，Pages 才免费）
4. 勾选 **Add a README file**
5. 点 **Create repository**

### 第 5 步：本地连接到 GitHub 仓库
在终端运行（把 `你的用户名` 换成你的 GitHub 用户名）：
```bash
cd ~/Desktop/zcode/coding/token-dashboard
git init
git add .
git commit -m "初始化 Token 看板"
git branch -M main
git remote add origin https://github.com/你的用户名/token-dashboard.git
git push -u origin main
```
> 首次推送时 Git 会弹窗要求登录 GitHub，按提示授权即可。

### 第 6 步：开启 GitHub Pages
1. 打开你的仓库网页 → **Settings** → 左侧 **Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main` / 文件夹选 `/ (root)` → **Save**
4. 等约 1 分钟，刷新该页面，顶部会出现你的网址：
   `https://你的用户名.github.io/token-dashboard/`

🎉 把这个链接发给客户，搞定！

---

## 二、每周更新（每周做一次）

1. **周六**：照常制作新的 Excel，存成
   `【天风计算机】Token出海数据库YYYYMMDD.xlsx`（文件名里要含 8 位日期）
2. 把新 Excel 拖进 `Tokens/` 文件夹
3. **双击 `更新网页.command`**
   - 脚本会自动找到最新的 Excel（按文件名日期判断）
   - 解密、抽取数据、生成 data.json
   - 自动推送到 GitHub
4. 约 1 分钟后，客户刷新链接就看到最新看板 ✅

> 如果 `.command` 双击没反应（macOS 安全限制）：
> 右键 → 打开 → 仍要打开。或在 终端 里运行 `chmod +x 更新网页.command`。

---

## 三、网页里会自动同步的内容

每周你在 Excel「看板」sheet 里手写的内容，网页会**原样自动同步**：

| Excel 位置 | 网页对应 |
|---|---|
| 标题栏（W2） | 顶部标题 |
| 本周总结（W3） | 总结卡片 |
| 3 个 KPI 卡片（W6/AB6/AG6） | 3 个 KPI |
| 模块 1-4 标题与点评（W11/41/55/117） | 各模块标题 |
| 前 10 排名（W45…AI50） | 排名卡片网格 |
| 页脚（W179） | 页脚 |

> ⚠️ **重要**：每周做新 Excel 时，请保持这些单元格位置不变（脚本按位置读取）。
> 模块内容/文字随便改，但别挪动单元格的行列位置。

---

## 四、常见问题

**Q：双击 `.command` 提示「无法打开」？**
A：macOS 安全限制。右键该文件 → 打开 → 仍要打开。一次即可。

**Q：推送时报错 `git push` 失败？**
A：通常是没登录 GitHub。终端运行 `git push` 会触发登录弹窗；或在 系统设置 → 通用 → 关于本机 确认网络正常。

**Q：想换 GitHub 用户名/仓库名怎么办？**
A：改 `update.py` 不用动（它用 `git push` 推到已配置的 remote）。重新 `git remote set-url origin 新地址` 即可。

**Q：Excel 密码改了？**
A：打开 `update.py`，把第 21 行的 `EXCEL_PASSWORD = "ainb"` 改成新密码。

**Q：数据安全吗？会上传敏感信息吗？**
A：**不会**。Excel 原文件永远留在你本地，只有脱敏后的 `data.json`（即给客户看的看板数据）会上传公网。
