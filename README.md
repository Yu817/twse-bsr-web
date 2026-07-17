# 📈 台灣證券交易所 (TWSE) 個股分點買賣超分析工具

一個輕量、現代化的網頁應用程式，專為查詢台灣股市個股當日**券商分點買賣超排行榜**設計。透過整合自動驗證碼辨識 (OCR) 與 Vercel Serverless 後端架構，讓使用者能快速取得並分析證交所籌碼資料。

---

## 🌟 主要功能特色

* ⚡ **自動驗證碼辨識 (OCR)**：自動擷取證交所 5 位數驗證碼圖片並發送辨識，免去繁瑣的人工輸入流程。
* 📊 **買賣超分點排行統計**：即時解析證交所原始交易資料 CSV，依據買賣張數（千股）自動統計並輸出**買超 Top 榜**與**賣超 Top 榜**。
* 🔍 **快速個股名稱導引**：輸入股票代號（如 `2330`）即可自動連結上市個股名稱與當日交易日期標籤。
* 🚀 **Serverless 無狀態架構**：基於 Flask Serverless API 設計，完美支援部署至 Vercel 雲端平台。
* 🎨 **深色質感 UI/UX 介面**：使用純 Vanilla CSS 設計 Glassmorphism 現代科技感介面，支援動態進度條、狀態主控台與 Enter 鍵快捷送出。

---

## 🛠️ 技術棧 (Tech Stack)

* **前端 (Frontend)**：HTML5, Vanilla CSS3 (Custom Design System), JavaScript (Async/Await, Fetch API)
* **後端 (Backend)**：Python 3, Flask (Serverless API Handler), Requests, BeautifulSoup4, ThreadPoolExecutor
* **部署平台 (Deployment)**：Vercel (Serverless Functions)

---

## 🚀 本地開發與運行 (Local Development)

### 1. 克隆專案與安裝依賴套件

```bash
git clone https://github.com/YourUsername/twse-bsr-web.git
cd twse-bsr-web

# 安裝 Python 依賴
pip install -r requirements.txt
```

### 2. 設定環境變數 (選用)

複製 `.env.example` 為 `.env`，可自訂驗證碼 OCR API 伺服器網址：

```bash
# .env
OCR_API_URL=http://yustudio.xyz:40010/ocr
```

### 3. 啟動開發伺服器

```bash
python api/index.py
```
啟動後在瀏覽器開啟 `http://127.0.0.1:5000` 即可進行測試與開發。

---

## ☁️ 部署說明 (Deployment)

本專案配置有 `vercel.json`，支援直接連結 GitHub 儲存庫至 **Vercel** 託管：

1. 將本專案推送到您的 GitHub 帳號。
2. 開啟 [Vercel Dashboard](https://vercel.com/)，點擊 **Add New Project** 並匯入此 Repository。
3. （選用）在 Vercel 專案設定中的 **Environment Variables** 新增 `OCR_API_URL`。
4. 點擊 **Deploy** 即可在一分鐘內完成全自動化部署。

---

## ⚠️ 免責聲明 (Disclaimer)

1. 本專案資料來源為 [臺灣證券交易所 (TWSE)](https://www.twse.com.tw/)，所有資料之著作權與智慧財產權均屬證交所所有。
2. 本工具僅供程式開發、個人研究與學術探討使用，不構成任何投資建議與買賣參考。
3. 嚴禁將本工具用於大規模自動化高頻爬取，以免對證交所伺服器造成連線負擔或導致 IP 被封鎖。

---

## 📜 授權協議 (License)

[MIT License](LICENSE)
