"""
GoldVision AI — 24/7 Cloud Automatic Telegram Bot (GitHub Actions Runner)
Chạy tự động trên đám mây GitHub Actions (hoặc chạy ngầm trên máy):
1. Tự động lấy giá vàng Live từ 5 nguồn sàn (Binance, Bybit, Bitget, OKX, Yahoo Finance).
2. Chạy bộ phân tích 7 trụ cột (SMC, ICT, Price Action, Supply/Demand, Volume Profile, 10 Entry Models, MTF).
3. Vẽ ảnh biểu đồ HD (.png) kèm các vùng Order Block, FVG, BOS/MSS, Volume Profile.
4. Kiểm tra chống gửi trùng (Anti-Spam State) và tự động bắn Ảnh Biểu Đồ + Kèo Entry/SL/TP về Bot Telegram!
"""

import os
import sys
import html
import json
import time
import requests

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

os.environ.setdefault("MPLCONFIGDIR", os.path.join(CURRENT_DIR, ".mplcache"))

from market_data import fetch_historical_ohlcv, fetch_orderbook_imbalance
from analysis_engine import generate_gold_trade_signal, calculate_indicators, detect_swings_and_labels
from chart_generator import generate_annotated_chart_image

STATE_FILE = os.path.join(CURRENT_DIR, ".last_telegram_signal.json")
CHARTS_OUT_DIR = os.path.join(CURRENT_DIR, "charts_out")
os.makedirs(CHARTS_OUT_DIR, exist_ok=True)


def build_mtf_summary(symbol: str, primary_tf: str, primary_df):
    tf_list = [("D1", "1d"), ("H4", "4h"), ("H1", "1h"), ("M15", "15m"), ("M5", "5m")]
    matrix = []
    for label, code in tf_list:
        try:
            df_tf = primary_df.copy() if code == primary_tf else fetch_historical_ohlcv(symbol=symbol, timeframe=code, limit=80)
            df_ind = calculate_indicators(df_tf)
            sw = detect_swings_and_labels(df_ind)
            last = df_ind.iloc[-1]
            if last["close"] >= last["ema_50"]:
                bias = "BULLISH"
                trend_vn = "Tăng"
            else:
                bias = "BEARISH"
                trend_vn = "Giảm"
            matrix.append({
                "tf": label,
                "code": code,
                "bias": bias,
                "trend_vn": trend_vn,
                "structure": sw.get("trend", "HH / HL"),
                "is_current": code == primary_tf
            })
        except Exception:
            matrix.append({
                "tf": label,
                "code": code,
                "bias": "NEUTRAL",
                "trend_vn": "Chờ",
                "structure": "Neutral",
                "is_current": code == primary_tf
            })
    return matrix


def format_telegram_html_caption(analysis: dict, mtf_matrix: list) -> str:
    raw_action = str(analysis.get("action", "WAIT")).upper()
    smc_trend = str(analysis.get("smc", {}).get("trend", "neutral")).lower()
    dr = analysis.get("smc", {}).get("dealing_range", {})
    pos_pct = dr.get("current_pct", 50)
    zone_tag = "DISCOUNT (Giá Rẻ)" if float(pos_pct) <= 50 else "PREMIUM (Giá Đắt)"

    if raw_action == "BUY":
        icon = "🟢📈"
        action_label = "MUA (BUY ACTIVE)"
        entry_label = "Entry"
    elif raw_action == "SELL":
        icon = "🔴📉"
        action_label = "BÁN (SELL ACTIVE)"
        entry_label = "Entry"
    else:
        icon = "⏳⚠️"
        dir_vn = "Canh Hồi BÁN" if smc_trend == "bearish" else ("Canh Hồi MUA" if smc_trend == "bullish" else "Quan sát")
        action_label = f"WAIT — {dir_vn} (KHÔNG ĐUỔI GIÁ)"
        entry_label = "Entry Limit Chờ Hồi"

    mtf_str = " | ".join(f"{m['tf']}: <b>{html.escape(str(m.get('trend_vn', 'Chờ')))}</b>" for m in mtf_matrix)

    raw_reasons = analysis.get("reasons", [])[:4]
    reasons_str = (
        "\n".join(f"• {html.escape(str(r))}" for r in raw_reasons)
        if raw_reasons
        else "• Hội tụ cấu trúc SMC + ICT + Volume Profile"
    )

    vp_poc = analysis.get("volume_profile", {}).get("poc", "--")
    killzone = html.escape(str(analysis.get("ict", {}).get("active_killzone", "Live Session")))
    symbol_str = html.escape(str(analysis.get("symbol", "PAXG/USDT")))
    tf_str = html.escape(str(analysis.get("timeframe", "1h")).upper())

    roadmap = analysis.get("future_roadmap", [])[:2]
    road_str = (
        "\n".join(
            f"• <b>{html.escape(str(r['trigger_type']))} ${r['trigger_price']}</b> ➔ {r['direction']} Entry <code>${r['entry']}</code> | TP <code>${r['tp1']}</code>"
            for r in roadmap
        )
        if roadmap
        else ""
    )
    road_block = f"🔮 <b>Kèo chờ tương lai (BOS / CHoCH):</b>\n{road_str}\n━━━━━━━━━━━━━━━━━━\n" if road_str else ""

    caption = (
        f"{icon} <b>GOLDVISION AI — TÍN HIỆU TỰ ĐỘNG {symbol_str} ({tf_str})</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"🎯 <b>Tín hiệu:</b> <code>{html.escape(action_label)}</code> (Độ tin cậy: <b>{analysis.get('confidence', 50)}%</b>)\n"
        f"💰 <b>Giá hiện tại:</b> <code>${analysis.get('current_price')}</code> ({pos_pct}% {zone_tag})\n"
        f"📍 <b>{entry_label}:</b> <code>${analysis.get('entry')}</code> | 🛑 <b>SL:</b> <code>${analysis.get('sl')}</code> (-${analysis.get('sl_distance')})\n"
        f"✅ <b>TP1:</b> <code>${analysis.get('tp1')}</code> | 🏆 <b>TP2:</b> <code>${analysis.get('tp2')}</code>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"{road_block}"
        f"🌐 <b>Đa khung (MTF):</b> {mtf_str}\n"
        f"📊 <b>POC:</b> <code>${vp_poc}</code> | <b>RSI:</b> {analysis.get('rsi')} | <b>ADX:</b> {analysis.get('adx')}\n"
        f"🕒 <b>ICT Killzone:</b> {killzone}\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"🔗 <b>Hội tụ & Cảnh báo an toàn:</b>\n{reasons_str}"
    )
    return caption[:1020]


def send_photo_to_telegram(bot_token: str, chat_id: str, image_path: str, caption: str) -> bool:
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
    with open(image_path, "rb") as img_file:
        resp = requests.post(
            url,
            data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
            files={"photo": img_file},
            timeout=25
        )
    res_json = resp.json()
    if not res_json.get("ok"):
        raise RuntimeError(f"Telegram API Error: {res_json.get('description')}")
    return True


def run_once(
    bot_token: str,
    chat_id: str,
    symbol: str = "PAXG/USDT",
    timeframe: str = "1h",
    min_confidence: int = 70,
    force_send: bool = False
) -> bool:
    print(f"[*] Đang phân tích {symbol} ({timeframe})...")
    df = fetch_historical_ohlcv(symbol=symbol, timeframe=timeframe, limit=110)
    ob_info = fetch_orderbook_imbalance(symbol=symbol, limit=50)
    mtf_matrix = build_mtf_summary(symbol=symbol, primary_tf=timeframe, primary_df=df)
    htf_bias = next((m["bias"] for m in mtf_matrix if m["tf"] in ("D1", "H4") and m["bias"] != "NEUTRAL"), "NEUTRAL")

    analysis = generate_gold_trade_signal(
        df,
        symbol=symbol,
        timeframe=timeframe,
        orderbook_info=ob_info,
        htf_bias=htf_bias,
        mtf_matrix=mtf_matrix
    )

    if analysis.get("is_fallback"):
        print("[!] CẢNH BÁO: Mất kết nối API sàn — Đang rơi vào dữ liệu giả lập fallback! Hủy gửi Telegram để bảo vệ vốn.")
        return False

    conf = int(analysis.get("confidence", 0))
    sig_hash = f"{symbol}_{timeframe}_{analysis['action']}_{round(float(analysis['entry']) / 4)}"

    if not force_send and conf < min_confidence:
        print(f"[-] Bỏ qua: Độ tin cậy ({conf}%) < mức tối thiểu ({min_confidence}%).")
        return False

    if not force_send and os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                last_state = json.load(f)
            if last_state.get("sig_hash") == sig_hash:
                print(f"[-] Kèo {sig_hash} đã được gửi trước đó, bỏ qua để chống spam.")
                return False
        except Exception:
            pass

    chart_res = generate_annotated_chart_image(analysis, CHARTS_OUT_DIR, mode="smc")
    image_path = chart_res.get("file_path") or chart_res.get("filepath")
    caption = format_telegram_html_caption(analysis, mtf_matrix)

    send_photo_to_telegram(bot_token, chat_id, image_path, caption)
    print(f"[+] Đã gửi thành công Ảnh Chart + Tín hiệu {symbol} ({timeframe}) về Telegram!")

    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"sig_hash": sig_hash, "timestamp": int(time.time()), "entry": analysis["entry"]}, f)
    except Exception:
        pass
    return True


def auto_detect_chat_id(bot_token: str) -> str:
    try:
        resp = requests.get(f"https://api.telegram.org/bot{bot_token}/getUpdates?limit=25", timeout=10).json()
        for u in reversed(resp.get("result", [])):
            chat = (
                u.get("message", {}).get("chat")
                or u.get("channel_post", {}).get("chat")
                or u.get("my_chat_member", {}).get("chat")
            )
            if chat and chat.get("id"):
                return str(chat["id"])
    except Exception:
        pass
    return ""


if __name__ == "__main__":
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    sym = os.environ.get("GOLD_SYMBOL", "PAXG/USDT").strip()
    tf = os.environ.get("GOLD_TIMEFRAME", "1h").strip()
    min_conf = int(os.environ.get("MIN_CONFIDENCE", "70"))
    force = os.environ.get("FORCE_SEND", "false").lower() == "true"
    loop_sec = int(os.environ.get("LOOP_SECONDS", "0"))

    if token and not chat:
        chat = auto_detect_chat_id(token)
        if chat:
            print(f"[+] Đã tự động nhận diện Chat ID từ Bot Token: {chat}")

    if not token or not chat:
        print("⚠️ Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc chưa tìm thấy Chat ID (hãy nhắn 'alo' vào Bot trên Telegram).")
        sys.exit(0)

    if loop_sec > 0:
        print(f"🚀 Khởi động Bot Telegram chạy ngầm tự động mỗi {loop_sec} giây...")
        while True:
            try:
                run_once(token, chat, sym, tf, min_conf, force)
            except Exception as e:
                print(f"[!] Lỗi chu kỳ quét: {e}")
            time.sleep(loop_sec)
    else:
        run_once(token, chat, sym, tf, min_conf, force)
