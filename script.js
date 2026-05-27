document.addEventListener('DOMContentLoaded', () => {
    // State storage for stateless session handling
    let currentSession = {
        params: {},
        cookies: {}
    };

    // UI Elements
    const stockNoInput = document.getElementById('stockNo');
    const captchaCodeInput = document.getElementById('captchaCode');
    const captchaImgContainer = document.getElementById('captchaImgContainer');
    const refreshCaptchaBtn = document.getElementById('refreshCaptcha');
    const startAnalyzeBtn = document.getElementById('startAnalyze');
    const statusConsole = document.getElementById('statusConsole');
    const statusBullet = statusConsole.querySelector('.status-bullet');
    const statusText = statusConsole.querySelector('.status-text');
    const buyersTableBody = document.querySelector('#buyersTable tbody');
    const sellersTableBody = document.querySelector('#sellersTable tbody');
    const tradeDateBadge = document.getElementById('tradeDateBadge');
    const tradeDateSpan = document.getElementById('tradeDate');
    const resultsTitle = document.getElementById('resultsTitle');

    // Helper to log status in UI
    function logStatus(text, type = 'pending') {
        statusText.textContent = `系統狀態: ${text}`;
        statusBullet.className = 'status-bullet'; // reset
        if (type === 'ready') {
            statusBullet.classList.add('ready');
        } else if (type === 'error') {
            statusBullet.classList.add('error');
        }
    }

    // 1. Fetch Captcha from stateless serverless backend
    async function fetchNewCaptcha() {
        logStatus('正在獲取驗證碼與安全憑證...');
        captchaImgContainer.innerHTML = '<span class="placeholder-text"><i class="fa-solid fa-spinner fa-spin"></i> 載入中...</span>';
        captchaCodeInput.value = '';
        
        try {
            const resp = await fetch('/api/captcha');
            const data = await resp.json();
            
            if (data.success) {
                // Save dynamic parameters and cookies for next POST request
                currentSession.params = data.params;
                currentSession.cookies = data.cookies;
                
                // Render image
                captchaImgContainer.innerHTML = `<img src="data:image/png;base64,${data.captcha_b64}" alt="Captcha">`;
                
                // Show OCR result if successful
                if (data.ocr_code) {
                    captchaCodeInput.value = data.ocr_code;
                    logStatus('驗證碼獲取與自動 OCR 辨識成功！', 'ready');
                } else {
                    logStatus('驗證碼獲取成功！請手動輸入驗證碼後分析。');
                }
            } else {
                logStatus(`取得失敗: ${data.error || '未知錯誤'}`, 'error');
                captchaImgContainer.innerHTML = '<span class="placeholder-text" style="color: #ef4444;">下載失敗</span>';
            }
        } catch (e) {
            logStatus(`取得失敗: ${e.message}`, 'error');
            captchaImgContainer.innerHTML = '<span class="placeholder-text" style="color: #ef4444;">下載失敗</span>';
        }
    }

    // 2. Submit verify query and parse CSV in-memory
    async function startAnalysis() {
        const stockNo = stockNoInput.value.trim();
        const captchaCode = captchaCodeInput.value.trim();

        if (!stockNo) {
            logStatus('錯誤: 請輸入正確的股票代碼！', 'error');
            return;
        }
        if (!captchaCode) {
            logStatus('錯誤: 請輸入驗證碼！', 'error');
            return;
        }

        // Add loading state
        startAnalyzeBtn.classList.add('loading');
        startAnalyzeBtn.disabled = true;
        logStatus('正在向證交所發送查詢並下載交易細節...', 'pending');

        try {
            const resp = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    stock_no: stockNo,
                    captcha_code: captchaCode,
                    params: currentSession.params,
                    cookies: currentSession.cookies
                })
            });

            const data = await resp.json();

            if (data.success) {
                logStatus('分析完成！已成功整合分點排行。', 'ready');
                renderResults(data.buyers, data.sellers);
                
                // --- USER REQUEST UPGRADE 1: Show Stock Code and Stock Name ---
                const dispName = data.stock_name ? `${stockNo} ${data.stock_name}` : stockNo;
                resultsTitle.innerHTML = `<i class="fa-solid fa-chart-simple"></i> ${dispName} 分點買賣超排行`;
                
                // Show dynamic trade date badge above the results
                if (data.trade_date) {
                    tradeDateSpan.textContent = data.trade_date;
                    tradeDateBadge.style.display = 'flex';
                }
                
                // Clear the stock entry so the user can easily key in a new one
                stockNoInput.value = '';
                // Automatically fetch and refresh a new captcha
                fetchNewCaptcha();
            } else {
                logStatus(`查詢失敗: ${data.error || '驗證碼錯誤或無交易資料'}`, 'error');
                
                // Clear inputs and auto-refresh captcha even on failed submission
                stockNoInput.value = '';
                logStatus('查詢失敗。正為您自動清空並更新驗證碼...', 'error');
                setTimeout(fetchNewCaptcha, 1500);
            }
        } catch (e) {
            logStatus(`查詢失敗: ${e.message}`, 'error');
            stockNoInput.value = '';
            setTimeout(fetchNewCaptcha, 1500);
        } finally {
            startAnalyzeBtn.classList.remove('loading');
            startAnalyzeBtn.disabled = false;
        }
    }

    // Render results lists in tables
    function renderResults(buyers, sellers) {
        // Clear tables
        buyersTableBody.innerHTML = '';
        sellersTableBody.innerHTML = '';

        if (buyers.length === 0) {
            buyersTableBody.innerHTML = '<tr class="empty-row"><td colspan="3">無任何買超資料</td></tr>';
        } else {
            buyers.forEach((b, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${b.broker}</td>
                    <td style="text-align: right; font-family: 'Outfit'; font-weight: 600;">+${b.val.toFixed(2)}</td>
                `;
                buyersTableBody.appendChild(tr);
            });
        }

        if (sellers.length === 0) {
            sellersTableBody.innerHTML = '<tr class="empty-row"><td colspan="3">無任何賣超資料</td></tr>';
        } else {
            sellers.forEach((s, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${s.broker}</td>
                    <td style="text-align: right; font-family: 'Outfit'; font-weight: 600;">-${s.val.toFixed(2)}</td>
                `;
                sellersTableBody.appendChild(tr);
            });
        }
    }

    // --- USER REQUEST UPGRADE 2: Support Enter Key Press to Trigger Analysis ---
    stockNoInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            startAnalysis();
        }
    });

    captchaCodeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            startAnalysis();
        }
    });

    // Bind event listeners
    refreshCaptchaBtn.addEventListener('click', fetchNewCaptcha);
    startAnalyzeBtn.addEventListener('click', startAnalysis);

    // Initial Fetch on startup
    fetchNewCaptcha();
});
