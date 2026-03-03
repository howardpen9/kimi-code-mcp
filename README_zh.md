# kimi-code-mcp

**[English](README.md)** | 中文

---

MCP 伺服器，將 [Kimi Code](https://www.kimi.com/code)（K2.5，256K 上下文）與 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 串接——Claude 當指揮家，Kimi 負責大量閱讀。

<div align="center">
  <img src="assets/llm-cost-vs-intelligence.png" alt="LLM 成本 vs 智能 — Kimi K2.5 以極低成本提供前沿級智能" width="720" />
  <br />
  <sub>Kimi K2.5 位於效率前沿——接近 Claude 的智能水準，成本僅 1/10。 <a href="https://www.kimi.com/code">kimi.com/code</a></sub>
</div>

> [!TIP]
> **別再花 Claude 的錢讀檔了。** Kimi K2.5 以極低成本提供前沿級程式碼智能（見上圖）。把批量程式碼掃描交給 Kimi（256K 上下文，幾乎零成本），讓 Claude 專注它最擅長的——推理、決策、精準改碼。一次 `kimi_analyze` 呼叫可以取代 50+ 次檔案讀取，**分析密集型任務省下 60-80% 的 Claude token 成本。**

## 什麼是 Kimi Code？

[**Kimi Code**](https://www.kimi.com/code/en) 是 Moonshot AI 推出的 AI 程式碼代理，搭載 **Kimi K2.5** 模型（1T MoE，256K 上下文）。支援終端機、IDE、CLI 多平台——自主撰寫、除錯、重構、分析程式碼。

核心規格：
- **256K token 上下文** — 一次讀完整個 codebase
- **平行 Agent 派生** — 同時處理多個任務
- **Shell、檔案、網路存取** — 完整開發工具鏈
- **安裝**：`curl -L code.kimi.com/install.sh | bash`

> [!WARNING]
> **需要 Kimi Code 會員。** 本 MCP 伺服器底層呼叫 Kimi CLI，需要有效的 [Kimi Code 訂閱方案](https://www.kimi.com/code/en)。使用前請確保已訂閱並執行過 `kimi login`。
>
> | 方案 | 價格 | 說明 |
> |------|------|------|
> | **Moderato** | **$0**（7 天免費試用） | 之後 $19/月，適合先體驗 |
> | **Allegretto** | $39/月 | 推薦 — 更高每週額度 + 並發上限 |
> | **Allegro** | $99/月 | 日常高強度開發 |
> | **Vivace** | $199/月 | 最大額度，適合大型程式碼庫 |
>
> 連續包年最高立省 $480。所有方案皆包含 [Kimi 會員權益](https://www.kimi.com/code/en)。

## 快速開始

```bash
# 1. 安裝 Kimi CLI
uv tool install kimi-cli && kimi login

# 2. 克隆並構建
git clone https://github.com/howardpen9/kimi-code-mcp.git
cd kimi-code-mcp && npm install && npm run build
```

在 `.mcp.json`（專案目錄或 `~/.claude/mcp.json` 全域）加入：

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "node",
      "args": ["/你的路徑/kimi-code-mcp/dist/index.js"]
    }
  }
}
```

在 Claude Code 中執行 `/mcp` 驗證，應該看到 `kimi-code` 和 4 個工具。

## 你可以做什麼

直接告訴 Claude 你需要什麼，它會自動委派給 Kimi：

| 你的 Prompt | 實際發生什麼 |
|------------|------------|
| 「分析這個 codebase 的架構」 | Kimi 讀取全部檔案（256K），Claude 根據報告行動 |
| 「掃描安全漏洞，然後審閱 Kimi 的發現」 | Kimi 審計，Claude 交叉審查——AI 結對審查 |
| 「映射 auth 模組的所有依賴，然後規劃重構」 | Kimi 建構依賴圖，Claude 規劃修改 |
| 「審閱最近的改動，檢查回歸和邊界情況」 | Kimi 審閱完整上下文（不只是 diff），Claude 整合 |
| 「恢復上次的 Kimi session，繼續問 API 設計」 | Kimi 跨 session 保留 256K token 上下文 |

## 為什麼需要這個？

Claude Code 很強大，但每次讀檔都消耗 token。很多工作——預審大型程式碼庫、跨檔案掃描、生成審計報告——屬於**確定性高的尾部任務**，不需要 Claude 的完整推理能力。

> [!IMPORTANT]
> **成本算術：** Claude 讀 50 個檔案理解架構 = 昂貴。Kimi 透過 `kimi_analyze` 讀 50 個檔案 = 幾乎免費。Claude 再根據 Kimi 的結構化報告行動 = 最少 token。**分析密集型任務總共省下 60-80% 的 Claude token。**

### 如何省 Token

```
                      ┌─────────────────────────────┐
                      │   你（開發者）                │
                      └──────────┬──────────────────┘
                                 │ prompt
                                 ▼
                      ┌─────────────────────────────┐
                      │   Claude Code（指揮家）       │
                      │   - 編排工作流                │
                      │   - 做決策                    │
                      │   - 精準編輯程式碼             │
                      └──────┬──────────────┬───────┘
                  精準        │              │  委派
                  編輯        │              │  批量閱讀
                  (token)    │              │  (免費)
                             ▼              ▼
                      ┌──────────┐   ┌──────────────┐
                      │ 你的     │   │  Kimi Code   │
                      │ 程式碼庫 │   │  (K2.5)      │
                      └──────────┘   │  - 256K 上下文│
                                     │  - 通讀全部   │
                                     │  - 回傳報告   │
                                     └──────────────┘
```

1. **Claude** 收到你的任務 → 判斷需要理解 codebase
2. **Claude** 透過 MCP 呼叫 `kimi_analyze` → Kimi 讀取整個程式碼庫（256K 上下文，近零成本）
3. **Kimi** 回傳結構化分析
4. **Claude** 根據分析做精準的程式碼修改

**結果：Claude 只花 token 在決策和寫碼，不浪費在讀檔上。**

### 基於 K2.5 的雙向程式碼審計

Kimi Code 搭載 K2.5——1T MoE 模型，專為深度程式碼理解而設計。這讓 **AI 結對審查** 成為可能：

1. **Kimi 預審** — 256K 上下文一次看完整個 codebase：安全問題、反模式、死代碼、架構問題
2. **Claude 交叉審查** — 審閱 Kimi 的發現，質疑可疑項目，補充自己的洞察
3. **雙重視角** — 不同模型捕捉不同問題。一個遺漏的，另一個能發現

## 用 Kimi 做程式碼審查

除了即時分析，你可以將 Kimi 作為工作流中的**專職 Reviewer**：

### PR 審查流程

```
┌──────────────┐   diff    ┌──────────────┐  結構化發現  ┌──────────────┐
│   你的 PR    │ ────────► │  Kimi Code   │ ──────────► │  Claude Code │
│  (改動)      │           │  (審查者)    │             │  (決策)      │
└──────────────┘           └──────────────┘              └──────────────┘
```

### 持續審計模式

| 時機 | 做什麼 | 為什麼 |
|------|--------|--------|
| 合併前 | Kimi 掃描 diff + 受影響的模組 | 及早發現回歸 |
| 每週 | 全 codebase 掃描 | 累積的技術債 |
| 發版前 | 安全導向的全面審計 | 安心發版 |

每次審查 session 都可以**恢復**（`kimi_resume`）—— Kimi 跨 session 保留最多 256K token 的上下文，隨時間累積理解。

## 功能

| 工具 | 說明 | 超時 |
|------|------|------|
| `kimi_analyze` | 深度程式碼分析（架構、審計、重構建議） | 10 分鐘 |
| `kimi_query` | 快速問答，不需要 codebase 上下文 | 2 分鐘 |
| `kimi_list_sessions` | 列出現有的 Kimi 分析 session | 即時 |
| `kimi_resume` | 恢復之前的 session（保留最多 256K token 上下文） | 10 分鐘 |

### 輸出控制參數

`kimi_analyze` 和 `kimi_resume` 支援以下參數控制輸出大小：

| 參數 | 值 | 預設 | 效果 |
|------|---|------|------|
| `detail_level` | `summary` / `normal` / `detailed` | `normal` | 控制 Kimi 輸出的詳細程度 |
| `max_output_tokens` | 數字 | `15000` | 硬上限——超過時在乾淨的段落邊界截斷 |
| `include_thinking` | boolean | `false` | 包含 Kimi 的內部推理鏈（額外 10-30K tokens） |

`kimi_query` 也支援 `max_output_tokens` 和 `include_thinking`。

## Token 經濟學

> [!NOTE]
> 節省來自**壓縮比**，不是免費閱讀。Kimi 仍需訂閱費用，但關鍵價值是減少昂貴的 Claude Code token 消耗。

```
                    不用 kimi-code-mcp            用 kimi-code-mcp (normal)
                    ────────────────              ─────────────────────────
Raw source:         50 檔 × ~4K = 200K tokens    Kimi 讀取（訂閱費用）
Claude 讀取:        200K tokens                  5-15K token 報告
Claude token 成本:  $$$                          $
```

**`detail_level` 壓縮比：**

| 級別 | 壓縮比 | 輸出大小 | 適用場景 |
|------|--------|---------|---------|
| `summary` | 40-100x | ~2-5K tokens | 快速了解、檔案清單 |
| `normal` | 15-40x | ~5-15K tokens | 架構審查、依賴分析 |
| `detailed` | 5-15x | ~15-40K tokens | 含代碼片段的安全審計 |

**省 token 的場景：**
- 大型 codebase（50+ 檔案）— 架構理解、跨檔案掃描
- 安全審計、死代碼偵測、API 一致性檢查
- 重構前預審（先掃描 → 再改特定檔案）

**不如直接讓 Claude 讀的場景：**
- 小型 codebase（<10 檔案）— 直接讀更快
- 單檔案修改 — Claude 內建讀檔就夠
- 需要每行代碼 — `detailed` 輸出接近直讀成本

## 運作原理

```
┌──────────────┐  stdio/MCP   ┌──────────────┐  subprocess   ┌──────────────┐
│  Claude Code │ ◄──────────► │ kimi-code-mcp│ ────────────► │ Kimi CLI     │
│  (指揮家)    │              │ (MCP 伺服器) │               │ (K2.5, 256K) │
└──────────────┘              └──────────────┘               └──────────────┘
```

## 進階配置

開發模式（自動重編譯）：

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "npx",
      "args": ["tsx", "/你的路徑/kimi-code-mcp/src/index.ts"]
    }
  }
}
```

## 專案結構

```
src/
├── index.ts           # MCP 伺服器設定、工具定義
├── kimi-runner.ts     # 生成 Kimi CLI 子行程、解析輸出、超時處理
└── session-reader.ts  # 讀取 Kimi session 元資料 (~/.kimi/)
```

## 貢獻

請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 變更日誌

請參閱 [CHANGELOG.md](CHANGELOG.md)。

## 授權

MIT
