/* =========================================================
   Firebase 配置 · 部署时填入你的项目配置
   =========================================================
   获取步骤（README.md 有详细图文）：
   1. 访问 https://console.firebase.google.com 用 Google 账号登录
   2. 新建项目 → 进入项目
   3. 左下角 ⚙️ → 项目设置 → 滚动到「Web 应用」→ 注册一个 web 应用
   4. 复制这里的 firebaseConfig 内容，替换下面的占位
   5. 左侧 Realtime Database → 创建数据库（测试模式）
   6. 左侧 Authentication → Get Started → 启用「邮箱/密码」
   --------------------------------------------------------- */

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 是否已配置真实 Firebase（占位符未替换时为 false，使用本地 mock）
const FIREBASE_CONFIGURED = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");
