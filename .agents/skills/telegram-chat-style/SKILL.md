---
name: telegram-chat-style
description: >-
  Formats AI responses specifically for Telegram and mobile chat applications.
  Use whenever replying to queries originating from Telegram (/agy), mobile chats,
  or when the user asks for chat-friendly, easy-to-read mobile messages.
  Eliminates wide markdown tables and verbose terminal dumps in favor of clean
  bullet points, visual emoji markers, short readable paragraphs, and clear hierarchy.
---

# Telegram Mobile Chat Style Guide

When generating messages for Telegram or mobile chat, formatting must be optimized
for narrow mobile viewports (~360px width) and quick scanning on phone screens.

## Core Formatting Rules

### 1. Structure & Visual Hierarchy (3-Part Layout)
1. **Headline / Direct Answer (1–2 sentences)**:
   - State the bottom-line result immediately (Success, In-Progress, or Error).
   - Use bold status tags like **[THÀNH CÔNG]**, **[ĐANG XỬ LÝ]**, or **[CẢNH BÁO]**.
2. **Key Details / Data Breakdown**:
   - Use clean, single-level bullet points (`•` or `-`).
   - 1 metric or fact per line.
3. **Next Action / Guidance**:
   - Provide concrete next steps or commands to run (e.g. `/status`, `/lenh`).

---

### 2. Strict Mobile Display Constraints

* 🚫 **NO WIDE MARKDOWN TABLES**:
  - Tables with 3+ columns break completely on phone screens, causing ugly text wrapping.
  - **Convert tables to key-value card blocks**:
    ```text
    📌 *AIOTUSDT*:
    • Vị thế: Mua 138 (Entry 0.0883)
    • Hiện tại: 0.0905 (Lãi +0.31 USDT)
    • Dừng lỗ sàn: 0.0777 (-12%)
    ```

* 🚫 **NO WALL OF TEXT**:
  - Keep paragraphs strictly under 3 sentences.
  - Insert blank lines between logical sections to give the message visual breathing room.

* 🚫 **NO GIANT LOG / TERMINAL DUMPS**:
  - Never dump 20+ lines of raw console logs or raw JSON.
  - Extract only the critical 2–3 lines (error code, message, or key outcome) and wrap in inline code `` `code` `` or a concise 3-line code block.

---

### 3. Visual Anchors & Semantic Emojis
Use recognizable emojis at the start of lines to help the user's eyes scan in 2 seconds:
- 🟢 / 🔴 : Profit / Loss or Online / Offline
- 💰 : Equity, Wallet, Margin, Balance
- 📊 : Positions, Orders, Fills
- 🛡️ : Stop Loss, Ratchet Profit Guard, Risk Breaker
- ⚡ : Volatility Grid, Execution Speed
- 🌐 : Dynamic Universe, Market Overview
- ✅ : Successfully completed / Verified
- ⚠️ : Warning, Attention needed
- ❌ : Failed / Error
- 💡 / 📌 : Tip, Note, Summary

---

### 4. Code & Monospace Formatting
- Telegram supports Markdown formatting: `*bold*`, `_italic_`, `` `code` ``, and triple-backtick code blocks.
- Wrap symbols, prices, numbers, and command shortcuts in backticks or bold for readability:
  - Ví dụ: `/lenh`, `0.0883 USDT`, `BTCUSDT`.
