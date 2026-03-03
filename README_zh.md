# kimi-code-mcp

**[English](README.md)** | 中文

---

MCP 伺服器，將 [Kimi Code](https://www.kimi.com/code)（K2.5，256K 上下文）與 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 串接——Claude 當指揮家，Kimi 負責大量閱讀。

## 為什麼需要這個？

Claude Code 很強大，但每次讀檔、掃描 codebase 都會消耗 token。很多工作——預審大型程式碼庫、跨檔案掃描模式、生成審計報告——屬於**確定性高的尾部任務**，不需要 Claude 的完整推理能力。

### 核心概念：Claude Code 當指揮家，Kimi Code 當專業讀者

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
                  編輯        │              │  批量分析
                             ▼              ▼
                      ┌──────────┐   ┌──────────────┐
                      │ 你的     │   │  Kimi Code   │
                      │ 程式碼庫 │   │  (K2.5)      │
                      └──────────┘   │  - 256K 上下文│
                                     │  - 通讀全部   │
                                     │  - 回傳報告   │
                                     └──────────────┘
```

### 節省 Claude Code Token 成本

1. **Claude** 收到你的任務 → 判斷需要理解 codebase
2. **Claude** 透過 MCP 呼叫 `kimi_analyze` → Kimi 讀取整個程式碼庫（256K 上下文，近零成本）
3. **Kimi** 回傳結構化分析
4. **Claude** 根據分析做精準的程式碼修改

結果：Claude 只花 token 在**決策和寫碼**，不浪費在讀檔上。

### 基於 K2.5 的雙向程式碼審計

Kimi Code 搭載 K2.5 模型，專為深度程式碼理解而設計：

1. **Kimi 預審** — 用 256K 上下文掃描整個 codebase，找出安全問題、反模式、死代碼、架構問題
2. **Claude 交叉審查** — 審閱 Kimi 的發現，質疑可疑項目，補充自己的洞察
3. **雙重視角** — 不同模型捕捉不同問題。一個遺漏的，另一個能發現

這不只是委派工作——而是 **AI 結對審查**。

## 功能

| 工具 | 說明 | 超時 |
|------|------|------|
| `kimi_analyze` | 深度程式碼分析（架構、審計、重構建議） | 10 分鐘 |
| `kimi_query` | 快速問答，不需要 codebase 上下文 | 2 分鐘 |
| `kimi_list_sessions` | 列出現有的 Kimi 分析 session | 即時 |
| `kimi_resume` | 恢復之前的 session（保留最多 256K token 上下文） | 10 分鐘 |

## 前置需求

1. **Kimi CLI**：`uv tool install kimi-cli`
2. **登入 Kimi**：`kimi login`
3. **Node.js** >= 18

## 安裝

```bash
git clone https://github.com/howardpen9/kimi-code-mcp.git
cd kimi-code-mcp
npm install
npm run build
```

## 配置 Claude Code

在專案的 `.mcp.json`（或 `~/.claude/mcp.json` 全域設定）加入：

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

### 驗證

在 Claude Code 中執行 `/mcp`，確認 `kimi-code` 伺服器已連線，應該看到 4 個工具。

## 使用範例

**委派分析（省 token）：**
> 「用 kimi_analyze 分析這個 codebase 的架構，告訴我需要重構什麼」

**雙向安全審計：**
> 「讓 Kimi 掃描 codebase 的安全漏洞，然後審閱它的發現，補充它遺漏的」

**重構前預審：**
> 「請 Kimi 映射 auth 模組的所有依賴，然後根據分析規劃重構」

**恢復上次分析：**
> 「列出這個專案的 Kimi sessions，然後恢復上一次的分析繼續問」

## 運作原理

```
┌──────────────┐  stdio/MCP   ┌──────────────┐  subprocess   ┌──────────────┐
│  Claude Code │ ◄──────────► │ kimi-code-mcp│ ────────────► │ Kimi CLI     │
│  (指揮家)    │              │ (MCP 伺服器) │               │ (K2.5, 256K) │
└──────────────┘              └──────────────┘               └──────────────┘
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

## 授權

MIT
