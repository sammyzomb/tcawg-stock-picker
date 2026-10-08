# tcawg-stock-picker

跨專案共用的圖槽與影片槽工具：**內網 NAS**（`192.168.3.3`、`192.168.3.11`）+ 線上圖庫 **Shutterstock / Unsplash / Pixabay / Pexels**。

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

## 網頁版搜圖器（本機 Web UI）

```powershell
cd D:/GITHUB_2/圖庫下載說明
npm run web
# 或
node bin/stock-web.js --project "D:/GITHUB_2/你的專案"
```

瀏覽器開啟 http://127.0.0.1:3456 — 輸入中英文關鍵字、選擇圖庫來源、預覽並勾選素材，再以同一個下載按鈕儲存線上圖庫與 NAS 素材到本機 archive。網頁只保留搜圖功能，不顯示專案切換或 slot 設定；進階搜尋選項預設收合，選擇 NAS 時才顯示登入與篩選。

下載區可按「選擇儲存資料夾」，在支援的 Chrome / Edge 透過瀏覽器挑選使用者電腦的資料夾；本次頁面內的批次下載會寫入選定位置，同名檔案自動加編號。未選資料夾或瀏覽器不支援時，檔案交由瀏覽器下載；若要每次指定位置，請在瀏覽器設定啟用「下載前詢問儲存位置」。本機服務仍保留 archive 與授權紀錄，下載過的素材可直接取用，無須重新授權。

輸入中文時會自動顯示可修改的英文搜尋詞。線上搜尋同時保留中文原文與英文對照，依來源選擇適合的語言；NAS 仍以原輸入關鍵字比對檔案路徑。

Wikimedia Commons 不需金鑰：來源可選「僅 Wikimedia Commons」，也會加入全部與免費圖片搜尋。目前支援 JPEG、PNG、WebP、TIFF；只納入能辨識為 CC0、公有領域、CC BY 或 CC BY-SA 的素材。每張結果顯示作者、授權連結、署名與相同授權要求，下載前重新查詢官方 metadata。圖片保留原格式，另附 `.license.txt` 授權紀錄（含原頁、作者、授權與查詢時間），並寫入 archive 的 `credits.json`。署名、改作、人物及商標等條件仍依原頁與適用授權遵守。

### NAS 快速搜尋

`nas_config.json` 設定 `searchService.url` 後，網頁使用 [nas-search](https://github.com/sammyzomb/nas-search) 的全檔案索引 API，不再遍歷 NAS 資料夾；預覽專案已設定為 `http://192.168.3.2:8088`。

- 空白分隔的關鍵字全部匹配**完整路徑**，圖片／影片用 `cat` 分類，預設 `sort=rel`、隱藏重複共用資料夾；可指定 `share`、`ext`。
- 選擇「NAS 內網圖庫」或勾選「同時搜 NAS 圖庫」後，在「NAS 登入與篩選」用原服務的 NAS 帳號登入。帳號密碼不寫入檔案，服務登入憑證僅存於記憶體，依瀏覽器分開；服務重啟或登入逾期後需再登入。
- 縮圖與複製均經過原服務 API，保留原本 NAS 權限檢查。圖庫工具不會在索引服務失敗時改用 Windows 身分掃描 NAS。
- 搜尋涵蓋原服務已建立的索引，最新檔案是否可查取決於該服務的索引更新。

```json
{
  "searchService": {
    "url": "http://192.168.3.2:8088",
    "timeoutMs": 30000
  }
}
```

舊專案未設定 `searchService` 時維持原資料夾搜尋方式。

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
