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

    function refreshCaptchaAfterFailure(delay = 900) {
        window.setTimeout(() => {
            fetchNewCaptcha();
        }, delay);
    }

    function getFailureStatus(data, fallbackMessage) {
        const message = data.error || fallbackMessage;
        const code = data.code || 'unknown_error';

        if (code === 'captcha_invalid') {
            return `${message} 已保留股票代碼，並準備更新驗證碼。`;
        }

        if (data.clear_stock) {
            return `${message} 股票代碼已清空，並準備更新驗證碼。`;
        }

        if (code === 'download_link_missing') {
            return `${message} 已保留股票代碼，請用新的驗證碼再試一次。`;
        }

        return `${message} 已保留股票代碼，稍後會更新驗證碼。`;
    }

    // 1. Fetch Captcha from stateless serverless backend
    async function fetchNewCaptcha() {
        logStatus('正在連線證交所取得驗證碼、表單安全參數與 Cookie...');
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
                    logStatus(`驗證碼已更新，OCR 辨識為 ${data.ocr_code}。請確認後送出查詢。`, 'ready');
                } else {
                    logStatus('驗證碼已更新，但 OCR 未辨識成功。請手動輸入圖片中的 5 位數驗證碼。');
                }
            } else {
                logStatus(`驗證碼取得失敗: ${data.error || '未知錯誤'}。請稍後再重新整理驗證碼。`, 'error');
                captchaImgContainer.innerHTML = '<span class="placeholder-text" style="color: #ef4444;">下載失敗</span>';
            }
        } catch (e) {
            logStatus(`驗證碼取得失敗: ${e.message}。可能是網路或證交所連線暫時異常。`, 'error');
            captchaImgContainer.innerHTML = '<span class="placeholder-text" style="color: #ef4444;">下載失敗</span>';
        }
    }

    // 2. Submit verify query and parse CSV in-memory
    async function startAnalysis() {
        const stockNo = stockNoInput.value.trim();
        const captchaCode = captchaCodeInput.value.trim();

        if (!stockNo) {
            logStatus('輸入錯誤：股票代碼是空的，請輸入上市股票代碼後再查詢。', 'error');
            return;
        }
        if (!captchaCode) {
            logStatus('輸入錯誤：驗證碼是空的，請輸入圖片中的 5 位數驗證碼。', 'error');
            return;
        }

        // Add loading state
        startAnalyzeBtn.classList.add('loading');
        startAnalyzeBtn.disabled = true;
        logStatus(`已送出 ${stockNo}，正在驗證驗證碼並下載證交所分點 CSV...`, 'pending');

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
                logStatus(`分析完成：已下載 ${stockNo} 的分點 CSV，並完成買賣超排行整理。`, 'ready');
                renderResults(data.buyers, data.sellers);
                
                // --- USER REQUEST UPGRADE 1: Show Stock Code and Stock Name ---
                const dispName = data.stock_name ? `${stockNo} ${data.stock_name}` : stockNo;
                resultsTitle.innerHTML = `<i class="fa-solid fa-chart-simple"></i> ${dispName} 分點買賣超排行`;
                
                // Show dynamic trade date badge above the results
                if (data.trade_date) {
                    tradeDateSpan.textContent = data.trade_date;
                    tradeDateBadge.style.display = 'flex';
                }
                
                // Clear the stock entry after a completed lookup.
                stockNoInput.value = '';
                // Automatically fetch and refresh a new captcha
                fetchNewCaptcha();
            } else {
                if (data.clear_stock) {
                    stockNoInput.value = '';
                }
                logStatus(getFailureStatus(data, '查詢失敗：證交所沒有回傳可分析資料。'), 'error');
                refreshCaptchaAfterFailure();
            }
        } catch (e) {
            logStatus(`查詢失敗：${e.message}。可能是網路中斷或伺服器暫時無回應；股票代碼已保留，稍後會更新驗證碼。`, 'error');
            refreshCaptchaAfterFailure();
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
