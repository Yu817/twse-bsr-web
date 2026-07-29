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
    const progressBarFill = document.getElementById('progressBarFill');
    const statusPercent = document.getElementById('statusPercent');
    const buyersTableBody = document.querySelector('#buyersTable tbody');
    const sellersTableBody = document.querySelector('#sellersTable tbody');
    const tradeDateBadge = document.getElementById('tradeDateBadge');
    const tradeDateSpan = document.getElementById('tradeDate');
    const resultsTitle = document.getElementById('resultsTitle');

    let progressInterval = null;
    let currentPercent = 0;

    // Set progress bar width and style based on state
    function setProgress(percent, type = 'pending') {
        currentPercent = percent;
        if (progressBarFill) {
            progressBarFill.style.width = `${percent}%`;
            progressBarFill.className = 'progress-bar-fill';
            progressBarFill.classList.add(type);
        }
        if (statusPercent) {
            statusPercent.textContent = `${Math.round(percent)}%`;
            if (type === 'ready') {
                statusPercent.style.color = 'var(--green-accent)';
            } else if (type === 'error') {
                statusPercent.style.color = 'var(--red-accent)';
            } else {
                statusPercent.style.color = 'var(--text-secondary)';
            }
        }
    }

    // Start a simulated progress bar animation up to a target max percent
    function startSimulatedProgress(duration, maxPercent = 90, onProgressUpdate = null) {
        if (progressInterval) clearInterval(progressInterval);
        setProgress(0, 'pending');
        
        const startTime = Date.now();
        progressInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            let percent = (elapsed / duration) * maxPercent;
            if (percent > maxPercent) {
                percent = maxPercent;
                clearInterval(progressInterval);
            }
            setProgress(percent, 'pending');
            if (onProgressUpdate) {
                onProgressUpdate(percent);
            }
        }, 80);
    }

    // Instantly complete progress to 100% (ready) or highlight errors
    function stopProgress(success = true, message = '') {
        if (progressInterval) clearInterval(progressInterval);
        if (success) {
            setProgress(100, 'ready');
            if (message) {
                statusText.textContent = `系統狀態: ${message}`;
                statusBullet.className = 'status-bullet ready';
            }
        } else {
            setProgress(currentPercent === 0 ? 100 : currentPercent, 'error');
            if (message) {
                statusText.textContent = `系統狀態: ${message}`;
                statusBullet.className = 'status-bullet error';
            }
        }
    }

    // Helper to log status in UI (maintained for compatibility)
    function logStatus(text, type = 'pending') {
        statusText.textContent = `系統狀態: ${text}`;
        statusBullet.className = 'status-bullet'; // reset
        if (type === 'ready') {
            statusBullet.classList.add('ready');
            setProgress(100, 'ready');
        } else if (type === 'error') {
            statusBullet.classList.add('error');
            setProgress(currentPercent === 0 ? 100 : currentPercent, 'error');
        } else {
            setProgress(currentPercent, 'pending');
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
        startSimulatedProgress(1200, 90, (percent) => {
            if (percent < 40) {
                statusText.textContent = '系統狀態: 正在連線證交所取得安全參數...';
            } else {
                statusText.textContent = '系統狀態: 正在下載驗證碼圖片...';
            }
            statusBullet.className = 'status-bullet';
        });
        
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
                    stopProgress(true, `驗證碼已更新，OCR 辨識為 ${data.ocr_code}。請確認後送出查詢。`);
                } else {
                    stopProgress(true, '驗證碼已更新，但 OCR 未辨識成功。請手動輸入圖片中的 5 位數驗證碼。');
                }
            } else {
                captchaImgContainer.innerHTML = '<span class="placeholder-text" style="color: #ef4444;">下載失敗</span>';
                stopProgress(false, `驗證碼取得失敗: ${data.error || '未知錯誤'}。請稍後再重新整理驗證碼。`);
            }
        } catch (e) {
            captchaImgContainer.innerHTML = '<span class="placeholder-text" style="color: #ef4444;">下載失敗</span>';
            stopProgress(false, `驗證碼取得失敗: ${e.message}。可能是網路或證交所連線暫時異常。`);
        }
    }

    // 2. Submit verify query and parse CSV in-memory
    async function startAnalysis() {
        const stockNo = stockNoInput.value.trim();
        const captchaCode = captchaCodeInput.value.trim();

        if (!stockNo) {
            stopProgress(false, '輸入錯誤：股票代碼是空的，請輸入上市股票代碼後再查詢。');
            return;
        }
        if (!captchaCode) {
            stopProgress(false, '輸入錯誤：驗證碼是空的，請輸入圖片中的 5 位數驗證碼。');
            return;
        }

        // Add loading state
        startAnalyzeBtn.classList.add('loading');
        startAnalyzeBtn.disabled = true;
        
        // Start simulated progress for download/analyze (takes ~4-8 seconds usually)
        startSimulatedProgress(5000, 92, (percent) => {
            if (percent < 30) {
                statusText.textContent = `系統狀態: 已送出 ${stockNo}，正在向證交所進行查詢安全認證...`;
            } else if (percent < 75) {
                statusText.textContent = `系統狀態: 正在下載分點交易明細 CSV...`;
            } else {
                statusText.textContent = `系統狀態: 正在整理並統計分點買賣超排行榜...`;
            }
            statusBullet.className = 'status-bullet';
        });

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
                stopProgress(true, `分析完成：已下載 ${stockNo} 的分點 CSV，並完成買賣超排行整理。`);
                
                // Wait 2 seconds so the user can see the 100% bar before fetching new captcha
                window.setTimeout(() => {
                    fetchNewCaptcha();
                }, 2000);
            } else {
                if (data.clear_stock) {
                    stockNoInput.value = '';
                }
                stopProgress(false, getFailureStatus(data, '查詢失敗：證交所沒有回傳可分析資料。'));
                refreshCaptchaAfterFailure(2500);
            }
        } catch (e) {
            stopProgress(false, `查詢失敗：${e.message}。可能是網路中斷或伺服器暫時無回應。`);
            refreshCaptchaAfterFailure(2500);
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
            buyersTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">無任何買超資料</td></tr>';
        } else {
            buyers.forEach((b, index) => {
                const tr = document.createElement('tr');
                const priceStr = (b.price !== undefined && b.price !== null) ? b.price.toFixed(2) : '-';
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${b.broker}</td>
                    <td style="text-align: right; font-family: 'Outfit'; font-weight: 600;">+${b.val.toFixed(2)}</td>
                    <td style="text-align: right; font-family: 'Outfit'; font-weight: 500;">${priceStr}</td>
                `;
                buyersTableBody.appendChild(tr);
            });
        }

        if (sellers.length === 0) {
            sellersTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">無任何賣超資料</td></tr>';
        } else {
            sellers.forEach((s, index) => {
                const tr = document.createElement('tr');
                const priceStr = (s.price !== undefined && s.price !== null) ? s.price.toFixed(2) : '-';
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${s.broker}</td>
                    <td style="text-align: right; font-family: 'Outfit'; font-weight: 600;">-${s.val.toFixed(2)}</td>
                    <td style="text-align: right; font-family: 'Outfit'; font-weight: 500;">${priceStr}</td>
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
