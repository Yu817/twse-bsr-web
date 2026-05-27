import os
import re
import io
import csv
import base64
import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request
import concurrent.futures

app = Flask(__name__)

# Helper to fetch both official trading date and stock name from TWSE STOCK_DAY API
def get_twse_details(stock_no):
    try:
        url = f"https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&stockNo={stock_no}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        r = requests.get(url, headers=headers, timeout=12) # generous timeout for slow TWSE API
        data = r.json()
        if data.get("stat") == "OK" and data.get("data"):
            trade_date = data["data"][-1][0]
            parts = data.get("title", "").split()
            stock_name = parts[2] if len(parts) >= 3 else "個股"
            return trade_date, stock_name
    except Exception:
        pass
    # Fallback to local Taiwan time and default name if TWSE API fails or rate-limits
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone(timedelta(hours=8)))
    return now.strftime("%Y/%m/%d"), "個股"

# Background worker to handle BSR submit and download
def download_bsr_data(session, params, captcha_code, stock_no):
    try:
        params['CaptchaControl1'] = captcha_code
        params['TextBox_Stkno'] = stock_no
        
        # Submit verification query
        resp = session.post('https://bsr.twse.com.tw/bshtm/bsMenu.aspx', data=params, timeout=15)
        if resp.status_code != 200:
            return False, f"送出查詢失敗 (HTTP {resp.status_code})"
            
        soup = BeautifulSoup(resp.text, 'html.parser')
        download_links = soup.select('#HyperLink_DownloadCSV')
        
        if not download_links:
            return False, "驗證錯誤！驗證碼輸入有誤或今日查無此股票交易資料。"
            
        # Fetch the CSV transaction details
        csv_resp = session.get('https://bsr.twse.com.tw/bshtm/bsContent.aspx', timeout=20)
        if csv_resp.status_code != 200:
            return False, f"下載 CSV 失敗 (HTTP {csv_resp.status_code})"
            
        return True, csv_resp.text
    except Exception as e:
        return False, f"下載發生連線錯誤: {str(e)}"

# Route to fetch new captcha, session cookies, and form parameters from TWSE
@app.route('/api/captcha', methods=['GET'])
def get_captcha():
    try:
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
        })
        
        resp = session.get('https://bsr.twse.com.tw/bshtm/bsMenu.aspx', timeout=15)
        if resp.status_code != 200:
            return jsonify({"success": False, "error": f"無法連線至證交所 (HTTP {resp.status_code})"}), 500
            
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Extract dynamic __VIEWSTATE, __EVENTVALIDATION etc.
        nodes = soup.select('form input')
        params = {}
        for node in nodes:
            name = node.attrs.get('name')
            if not name or name in ('RadioButton_Excd', 'Button_Reset'):
                continue
            params[name] = node.attrs.get('value', '')
            
        # Get captcha image source
        images = soup.select('#Panel_bshtm img')
        if not images:
            return jsonify({"success": False, "error": "無法在證交所頁面定位驗證碼圖片"}), 500
            
        captcha_image_src = images[0]['src']
        
        # Download captcha image
        captcha_url = 'https://bsr.twse.com.tw/bshtm/' + captcha_image_src
        captcha_resp = session.get(captcha_url, timeout=10)
        if captcha_resp.status_code != 200:
            return jsonify({"success": False, "error": "無法下載驗證碼圖片"}), 500
            
        captcha_bytes = captcha_resp.content
        captcha_b64 = base64.b64encode(captcha_bytes).decode('utf-8')
        
        # Call the user's custom OCR server to automate recognition
        ocr_code = ""
        try:
            ocr_url = "http://yustudio.xyz:40010/ocr"
            ocr_resp = requests.post(ocr_url, json={"image": captcha_b64}, timeout=8)
            if ocr_resp.status_code == 200:
                res_json = ocr_resp.json()
                if res_json.get("success"):
                    ocr_code = res_json.get("result", "").strip()
        except Exception:
            pass
            
        # Serialize cookies to pass back to stateless frontend
        cookies = session.cookies.get_dict()
        
        return jsonify({
            "success": True,
            "captcha_b64": captcha_b64,
            "ocr_code": ocr_code,
            "params": params,
            "cookies": cookies
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": f"伺服器錯誤: {str(e)}"}), 500

# Route to analyze stock data by submitting captcha and fetching CSV in memory
@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:
        req_data = request.json
        if not req_data:
            return jsonify({"success": False, "error": "缺少請求資料"}), 400
            
        stock_no = req_data.get("stock_no", "").strip()
        captcha_code = req_data.get("captcha_code", "").strip()
        params = req_data.get("params")
        cookies = req_data.get("cookies")
        
        if not stock_no or not captcha_code or not params or not cookies:
            return jsonify({"success": False, "error": "請求欄位不完整"}), 400
            
        # Setup session with serialized cookies
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })
        session.cookies.update(cookies)
        
        # --- PARALLEL PERFORMANCE OPTIMIZATION ---
        # Run BSR download and TWSE details fetch in parallel threads
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_bsr = executor.submit(download_bsr_data, session, params, captcha_code, stock_no)
            future_details = executor.submit(get_twse_details, stock_no)
            
            # Gather results
            bsr_success, bsr_result = future_bsr.result()
            trade_date, stock_name = future_details.result()
            
        if not bsr_success:
            return jsonify({"success": False, "error": bsr_result}), 400
            
        # Parse CSV content in-memory
        lines = bsr_result.splitlines()
        if len(lines) < 4:
            return jsonify({"success": False, "error": "證交所傳回之資料行數不足，無效內容"}), 400
            
        brokers_data = {}
        reader = csv.reader(lines[3:])
        for row in reader:
            if not row:
                continue
                
            def process_entry(broker_col_idx, buy_col_idx, sell_col_idx):
                if len(row) <= max(broker_col_idx, buy_col_idx, sell_col_idx):
                    return
                broker = row[broker_col_idx].strip()
                if not broker or broker in ("券商", "序號", "價格", "買進股數", "賣出股數"):
                    return
                
                try:
                    buy_val = int(float(row[buy_col_idx].replace(',', '')))
                except ValueError:
                    buy_val = 0
                    
                try:
                    sell_val = int(float(row[sell_col_idx].replace(',', '')))
                except ValueError:
                    sell_val = 0
                
                if broker not in brokers_data:
                    brokers_data[broker] = {'buy': 0, 'sell': 0}
                
                brokers_data[broker]['buy'] += buy_val
                brokers_data[broker]['sell'] += sell_val

            process_entry(1, 3, 4)
            process_entry(7, 9, 10)
            
        if not brokers_data:
            return jsonify({"success": False, "error": "無有效交易分點數據"}), 400
            
        # Compute sheet ranks (張數)
        net_buyers = []
        net_sellers = []
        
        for broker, info in brokers_data.items():
            buy_sheets = info['buy'] / 1000.0
            sell_sheets = info['sell'] / 1000.0
            net = buy_sheets - sell_sheets
            
            if net > 0:
                net_buyers.append({"broker": broker, "val": round(net, 2)})
            elif net < 0:
                net_sellers.append({"broker": broker, "val": round(-net, 2)})
                
        # Sort desc
        net_buyers.sort(key=lambda x: x["val"], reverse=True)
        net_sellers.sort(key=lambda x: x["val"], reverse=True)
        
        return jsonify({
            "success": True,
            "buyers": net_buyers,
            "sellers": net_sellers,
            "trade_date": trade_date,
            "stock_name": stock_name
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": f"解析過程出錯: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True)
