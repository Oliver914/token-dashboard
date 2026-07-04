#!/bin/bash
# =========================================================
#  Token 出海看板 · 每周更新入口（macOS 双击运行）
#  双击此文件 → 自动找最新 Excel → 解密 → 生成 data.json
#  → 推送到 GitHub Pages → 客户刷新链接即看到最新数据
# =========================================================

# 切到脚本所在目录（不依赖双击时的 pwd）
cd "$(dirname "$0")" || exit 1

# 强制让终端用 UTF-8，避免中文 emoji 乱码
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Token 出海看板 · 每周更新                  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1) 确认 Python3
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 没有找到 python3，请先安装 Python 3（https://www.python.org/downloads/）"
  read -n 1 -s -r -p "按任意键关闭..."
  exit 1
fi

# 2) 确认依赖库（首次运行自动安装）
python3 -c "import openpyxl, msoffcrypto" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "🔧 首次运行，正在安装依赖（openpyxl / msoffcrypto-tool）..."
  python3 -m pip install --user --quiet openpyxl msoffcrypto-tool
  if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败，请手动运行：python3 -m pip install openpyxl msoffcrypto-tool"
    read -n 1 -s -r -p "按任意键关闭..."
    exit 1
  fi
  echo "✅ 依赖安装完成"
  echo ""
fi

# 3) 运行主脚本（带 --push 自动推送到 GitHub）
python3 update.py --push
RC=$?

echo ""
if [ $RC -eq 0 ]; then
  echo "🎉 完成！客户刷新网页链接即可看到最新数据。"
else
  echo "⚠️  更新过程出现问题，请查看上方日志。"
fi
echo ""
read -n 1 -s -r -p "按任意键关闭窗口..."
