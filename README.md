# tcawg-stock-picker

跨專案共用的圖槽與影片槽工具：**內網 NAS**（`192.168.3.3`、`192.168.3.11`）+ 線上三大圖庫 **Shutterstock / Unsplash / Pexels**。

- **NAS**：UNC 路徑複製／掃描（中文關鍵字友善）；見 `templates/nas-config.example.json`、`圖庫下載說明.md` 的「圖片來源總覽」
- **線上 API**：依 `image-slots.json` 的 `query` / `altQueries` 搜圖、下載、授權紀錄

本 repo 為**獨立套件**（資料夾名 `圖庫下載說明`，npm 套件名 `tcawg-stock-picker`），行程專案（如 UIO16A、CAI12A）以 npm `file:` 或 `npm link` 引用，不再把整包複製進各專案。

## 安裝到行程專案

假設目錄結構：

```
GITHUB_2/
├── 圖庫下載說明/                ← 本 repo（tcawg-stock-picker）
└── UIO16A .../                  ← 行程專案
    ├── stock-picker.config.json
    ├── scripts/
    │   ├── package.json
    │   └── image-slots.json
    └── .env
```

在行程專案的 `scripts/package.json`：

```json
{
  "dependencies": {
    "tcawg-stock-picker": "file:../../圖庫下載說明"
  }
}
```

```bash
cd scripts && npm install
```

或直接呼叫 bin（不需 npm install）：

```bash
node ../../圖庫下載說明/bin/stock-find.js --check-keys
```

## 新行程專案設定

1. 複製 `templates/stock-picker.config.example.json` → 專案根 `stock-picker.config.json`
2. 複製 `templates/image-slots.example.json` → `scripts/image-slots.json` 並編輯
3. 共用金鑰放在 `圖庫下載說明/.preview/stock-api.env`（首次從 `templates/stock-api.env.example` 複製並填入，**勿 commit**）
4. 在行程專案執行 `setup-env.ps1` 產生 `.env`：

```powershell
powershell -File D:/GITHUB_2/圖庫下載說明/scripts/setup-env.ps1 -ProjectRoot "D:/GITHUB_2/你的專案"
```

更新 Pexels Key：`powershell -File D:/GITHUB_2/圖庫下載說明/scripts/update-pexels-key.ps1`

5. `node ../../圖庫下載說明/bin/stock-check-keys.js`（在專案根目錄）

## 專案設定檔

### `stock-picker.config.json`（行程專案根目錄）

```json
{
  "slotsFile": "scripts/image-slots.json",
  "archiveDir": "public/images",
  "envFile": ".env"
}
```

## 指令

在**行程專案根目錄**執行：

```bash
node ../../圖庫下載說明/bin/stock-check-keys.js
node ../../圖庫下載說明/bin/stock-find.js --slot hero
node ../../圖庫下載說明/bin/stock-find.js --video "ocean waves aerial drone"
node ../../圖庫下載說明/bin/stock-find.js --slot hero-loop
node ../../圖庫下載說明/bin/stock-fill.js --all --free-only
node ../../圖庫下載說明/bin/stock-sync.js --verify-only
node ../../圖庫下載說明/bin/stock-sstk-search.js "Quito old town"
node ../../圖庫下載說明/bin/stock-sstk-license.js --ids=123456789
```

指定其他專案：

```bash
node bin/stock-fill.js --project "D:/tours/CAI12A" --all --free-only
```

## 資料流

```
image-slots.json
    ↓ 搜圖 API
public/images/{shutterstock,unsplash,pexels}/  + credits.json
public/videos/{shutterstock,pexels}/          + credits.json
    ↓ fill / sync
images/<專案>-shutter/  （HTML 使用的檔名，含 .jpg / .mp4）
    ↓ 選填
圖片授權說明.md、shutter-credits.json
```

## 環境變數（`.env`，勿 commit）

| 變數 | 用途 |
|------|------|
| `UNSPLASH_ACCESS_KEY` | Unsplash |
| `PEXELS_API_KEY` | Pexels |
| `SHUTTERSTOCK_API_TOKEN` | Shutterstock 搜圖＋授權 |
| `SHUTTERSTOCK_SUBSCRIPTION_ID` | Shutterstock 扣張數 |

## 程式化呼叫

```javascript
const path = require("path");
const { createContext, runFill } = require("tcawg-stock-picker");

const ctx = createContext(path.join(__dirname, ".."));
await runFill(["--weak", "--free-only"], ctx);
```

## 一句話用法

新專案複製 `templates/圖庫下載.cursor-rule.mdc` → `.cursor/rules/圖庫下載.mdc`，之後對 AI 說：

**「依照圖庫下載說明」**

完整流程見根目錄 **`圖庫下載說明.md`**（AI 會自動讀取執行）。

## 新專案流程（進階）

詳細 checklist：`templates/新專案流程清單.md`（一般不必看，除非人工對照）
