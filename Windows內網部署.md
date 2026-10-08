# Windows Server 2012 R2：192.168.3.2 部署紀錄

## 已完成

新網站版本位於 `D:\stock-picker\releases\stock-picker-20261001-105410`。設定、金鑰及下載素材獨立位於 `D:\stock-picker-data`；部署包沒有金鑰、既有設定或 NAS 索引。

獨立開機排程 `TcawgStockPicker-LAN` 以 SYSTEM 執行、每分鐘重試失敗、無執行時限。新網站使用 TCP 3456；既有 `NAS Search` 與 TCP 8088 保持執行。

使用隔離的官方 Node.js 16.20.2，下載時核對官方 SHA256；HTTP 相容層使用固定版本 node-fetch 2.7.0，新增套件的 npm audit 為零漏洞。Node 16 已停止維護，這是舊系統限定內網的相容方案，不應對外開放。一般版本仍使用現代 Node 執行，npm engines 維持 >=18；Node 16 僅用於這個網站部署包。

本機原有與相容層模式各 37 項自動測試通過。Node 16 實際執行網站啟動、NAS 模擬服務登入、多重 cookie、搜尋、縮圖及下載測試通過；同一整合測試亦在目標 Server 2012 R2 通過。

伺服器本機首頁及 `/api/status` 均回應 HTTP 200。既有 NAS `/api/meta` 回應 HTTP 401，表示服務可連線、仍要求登入；沒有使用真实 NAS 密碼進行測試。辦公室電腦連入新網站 3456 逾時，需由使用者確認及開放網路連線。防火牆與 UAC 未更動。主機重開機後的啟動仍未實測。

## 使用者剩餘操作

1. 用 `mstsc /admin` 登入主機，帳號 administrator，密碼僅在 Windows 提示中輸入。
2. 確認辦公室網段為 192.168.3.0/24，在伺服器系統管理員命令提示字元自行開埠：

```cmd
netsh advfirewall firewall add rule name="Stock Picker LAN 3456" dir=in action=allow protocol=TCP localport=3456 remoteip=192.168.3.0/24 profile=domain,private
```

若主機網卡為 Public 設定檔，請先由管理員確認實際網路政策；不要直接關閉防火牆或 UAC。

3. 從辦公室電腦開啟 `http://192.168.3.2:3456`。Wikimedia Commons 不需金鑰。NAS 使用每位使用者自己的帳號登入。
4. 四家線上圖庫已依使用者授權啟用。若日後更新金鑰，在伺服器本機編輯 `D:\stock-picker-data\.env`，只填需要的金鑰，不要傳到聊天或程式包：

```dotenv
PEXELS_API_KEY=
UNSPLASH_ACCESS_KEY=
PIXABAY_API_KEY=
SHUTTERSTOCK_CONSUMER_KEY=
SHUTTERSTOCK_CONSUMER_SECRET=
SHUTTERSTOCK_API_TOKEN=
SHUTTERSTOCK_SUBSCRIPTION_ID=
```

填好後在伺服器本機重新啟動新網站排程：

```cmd
schtasks /end /tn "TcawgStockPicker-LAN"
schtasks /run /tn "TcawgStockPicker-LAN"
```

不要操作 `NAS Search`。若程序退出有延遲，先確認舊實例已停止後再啟動。不要使用遠端 taskkill /s。

HTTP 內網網站使用一般瀏覽器下載；選擇儲存資料夾功能需瀏覽器信任的 HTTPS。網站尚無自己的使用者登入，只可限定受信任內網使用，線上圖庫共用 API 額度。

## 維護規則

- 不更動全域 Node 或其他專案；Node 執行檔在版本資料夾的 runtime 內。
- 新版本先以新版本資料夾傳到 D$，伺服器本機停新網站排程、切換路徑，再啟動；不得直接覆蓋執行中的 exe。
- 設定與下載資料保留在外部 data 資料夾；密碼、設定檔及 NAS 索引不包入程式或上傳。
- 防火牆與 UAC 由使用者自行處理。
- 既有 NAS 搜尋位於 `D:\NAS-index\2026-09-25-full\search`，排程為 `NAS Search`。
- 若使用 Go 必須為 1.20；LibreOffice 為 25.2，ffmpeg 為 7.0 essentials。目前圖庫網站不需要這三項工具。

網站 log 在版本資料夾的 `logs\web-YYYY-MM-DD.log`。`server-check.log` 為目標主機 HTTP 驗證結果，`validation.log` 為整合測試結果。

## 摩洛哥搜尋修正

已修正 Commons 授權網址無結尾斜線時被誤排除的問題，精準模式改取完整候選頁後再篩選。目標主機實測摩洛哥：精準模式 8 筆，一般模式 19 筆；其他圖庫若缺少 API 金鑰會顯示原因。

Server 2012 R2 的 Stop-ScheduledTask 可能留下 Node 子程序；本次更新在伺服器本機核對執行檔路徑、網站命令及資料目錄後才對特定 PID 執行 taskkill /f。後續更新也應保留此核對，不能使用遠端 taskkill /s 或按名稱終止所有 Node 程序。

## 四家圖庫啟用驗證

使用者已明確授權直接將现有金鑰寫入伺服器獨立設定；設定寫入 D:\stock-picker-data\.env，未放入任何版本部署包，並保留其他設定。網站已重新啟動，Pexels、Unsplash、Pixabay、Shutterstock 與 Shutterstock 授權設定狀態均已啟用。伺服器實際逐家搜尋摩洛哥：Pexels 20 筆、Unsplash 20 筆、Pixabay 20 筆、Shutterstock 22 筆，皆回應 HTTP 200 且沒有搜尋錯誤。沒有執行素材下載或扣張授權；NAS Search 仍在執行。

## 全部來源與精準模式修正

預設精準模式現在搜尋所有選定圖庫，不再按中文只挑 Pixabay 與 Commons。各來源取樣 20 筆，保留精準篩選，最後輪流分配 8 個顯示名額。目標主機摩洛哥實測：全部模式顯示 Shutterstock 2、Unsplash 2、Pixabay 2、Pexels 1、Commons 1；免費模式四家各 2 筆，無搜尋錯誤。

## NAS 登入視窗更新

網頁靜態檔案已更新。勾選同時搜 NAS 或選擇 NAS 來源時會檢查瀏覽器登入狀態，尚未登入會自動顯示登入視窗；登入有效則不重複提示。取消會取消 NAS 勾選，登入完成或關閉視窗會清空頁面密碼欄。帳號保留在目前頁面，不寫入程式或本機儲存。登入表單提供 username 與 current-password 自動填寫標記，帳密僅由各人瀏覽器密碼管理員管理；首次必須由使用者登入並自行選擇儲存，瀏覽器能否自動填入依其設定。已用真實瀏覽器驗證勾選開啟視窗、取消恢復未勾選。舊網頁檔保存在目前版本 web\before-nas-dialog。

## 圖庫來源分頁更新

網站新增全部、Shutterstock、Unsplash、Pixabay、Pexels、Wikimedia Commons、NAS 來源分頁與筆數。分頁只篩選本次結果，切換保留其他分頁已勾選的素材；全選與清除僅作用目前分頁。未搜尋、搜尋錯誤或無匹配結果会在來源分頁顯示原因。預設改為一般搜尋，精準篩選保留於更多搜尋選項。35 項測試在原有及舊版 HTTP 相容模式均通過。實際瀏覽器搜尋摩洛哥：共 99 筆，Shutterstock 21、Unsplash 20、Pixabay 20、Pexels 20、Commons 18，已確認 Unsplash 分頁相片正常顯示。網站靜態檔案已更新，前一版保存在 web\before-source-tabs。

## 西班牙／Shutterstock 搜尋修正

新增西班牙及常見國名固定英文對照，避免翻譯服務將西班牙錯譯為 Espaillat。自動英文欄不再強制覆蓋伺服器對照，僅使用者手動修改時作為 override；搜尋完成後會更新自動英文顯示。未知詞的機器翻譯有 10 秒逾時。靜態網頁現在回應 Cache-Control: no-store，資產 URL 亦更新版本，使用者首次仍需強制重新整理清除之前的快取。37 項測試在原有及舊版 HTTP 相容模式皆通過。目標主機翻譯西班牙為 Spain，僅 Shutterstock 一般搜尋 23 筆、精準搜尋 3 筆；實際瀏覽器已看到相片。未執行素材下載或授權扣款。

### 2026-10-01 全面複查
- 一般及舊版 HTTP 相容模式各 38 項測試通過；Node 16 整合測試通過。
- 伺服器單獨搜尋西班牙：Shutterstock 23、Unsplash 20、Pixabay 20、Pexels 20、Commons 16，無圖庫錯誤。
- 修正空白來源分頁在其他來源已有結果時，NAS 搜尋失敗仍停留搜尋中的狀態；已備份並更新線上 app.js。
- 兩個既有排程均 Running；bin/lib/server/web 與本機逐檔雜湊一致。
- 實際 NAS 帳密登入及 Shutterstock 扣張下載未於本次執行。

### 2026-10-01 可用額度顯示
- 目前版本：D:\stock-picker\releases\stock-picker-20261001-123001。
- 首頁載入各家查詢額度與設定訂閱的 Shutterstock 下載張數，可按更新額度；伺服器合併同時查詢並快取 60 秒，單家錯誤不影響其他圖庫。
- Pexels 按月、Unsplash 按小時、Pixabay 按回傳時間窗顯示；Commons/NAS 標示無下載張數額度。
- 一般與舊版 HTTP 相容模式各 41 項測試通過，伺服器 Node 16 整合檢查及瀏覽器顯示/更新按鈕驗證通過。
