/* =========================================================
   Firebase 配置 · 已填入真实项目 tokenbase-69bd6
   =========================================================
   说明：本项目使用 Firebase 兼容版 SDK（firebase-app-compat 等，
   在 index.html / admin.html 里通过 CDN 引入）。
   因此这里只需保留 firebaseConfig 对象，无需 import 语句，
   也无需 Google Analytics（measurementId 已忽略）。
   --------------------------------------------------------- */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDZQv008hUWsulJLnPHFbnlX1vE9KWPLHE",
  authDomain: "tokenbase-69bd6.firebaseapp.com",
  databaseURL: "https://tokenbase-69bd6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tokenbase-69bd6",
  storageBucket: "tokenbase-69bd6.firebasestorage.app",
  messagingSenderId: "563309162372",
  appId: "1:563309162372:web:0c94a97a5ea48c15d1f7d1"
};

// 是否已配置真实 Firebase（占位符未替换时为 false，使用本地存储兜底）
const FIREBASE_CONFIGURED = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");
