"""
Market Data Feed for Digital Gold (PAXG/USDT, XAUT/USDT, XAU/USD)
Enhanced with Multi-Exchange Direct REST APIs inspired by klinechart-ui-core:
- Binance Spot v3 (https://api.binance.com/api/v3/klines)
- Bybit Spot v5 (https://api.bybit.com/v5/market/kline)
- Bitget Spot v2 (https://api.bitget.com/api/v2/spot/market/candles)
- OKX Spot v5 (https://www.okx.com/api/v5/market/candles)
- Yahoo Finance (GC=F Gold Futures / XAUUSD)
100% pure Python stdlib + pandas/ccxt with zero third-party untrusted code.
"""

import json
import time
import urllib.request
import urllib.parse
import ccxt
import numpy as np
import pandas as pd
import yfinance as yf
from typing import Dict, Any, Optional, List

_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 25

_binance_client: Optional[ccxt.binance] = None
_okx_client: Optional[ccxt.okx] = None


def get_binance():
    global _binance_client
    if _binance_client is None:
        _binance_client = ccxt.binance({'enableRateLimit': True, 'timeout': 4000})
    return _binance_client


def get_okx():
    global _okx_client
    if _okx_client is None:
        _okx_client = ccxt.okx({'enableRateLimit': True, 'timeout': 4000})
    return _okx_client


AVAILABLE_SYMBOLS = [
    {
        "id": "PAXG/USDT",
        "name": "PAX Gold (PAXG/USDT)",
        "source": "Binance / Bybit / Bitget",
        "description": "Vàng số bảo chứng 1:1 bằng vàng thô thật (London Good Delivery) của Paxos, stream trực tiếp từ Binance & Bybit.",
        "icon": "🪙"
    },
    {
        "id": "XAUT/USDT",
        "name": "Tether Gold (XAUT/USDT)",
        "source": "OKX / Bybit / Bitget",
        "description": "Token vàng số của Tether bảo chứng bằng vàng vật chất tại Thụy Sĩ, stream trực tiếp từ OKX & Bitget.",
        "icon": "🥇"
    },
    {
        "id": "XAU/USD",
        "name": "Gold Spot (XAU/USD)",
        "source": "Forex / COMEX Futures",
        "description": "Giá vàng giao ngay thế giới (Spot Gold / GC=F), chuẩn định giá quốc tế.",
        "icon": "🏆"
    }
]

TIMEFRAME_MAPPING = {
    "5m": {
        "ccxt": "5m", "binance": "5m", "bybit": "5", "bitget": "5min", "okx": "5m",
        "yf_interval": "5m", "yf_period": "3d", "limit": 120, "step_ms": 300000
    },
    "15m": {
        "ccxt": "15m", "binance": "15m", "bybit": "15", "bitget": "15min", "okx": "15m",
        "yf_interval": "15m", "yf_period": "5d", "limit": 120, "step_ms": 900000
    },
    "1h": {
        "ccxt": "1h", "binance": "1h", "bybit": "60", "bitget": "1h", "okx": "1H",
        "yf_interval": "1h", "yf_period": "1mo", "limit": 120, "step_ms": 3600000
    },
    "4h": {
        "ccxt": "4h", "binance": "4h", "bybit": "240", "bitget": "4h", "okx": "4H",
        "yf_interval": "1h", "yf_period": "2mo", "limit": 120, "step_ms": 14400000
    },
    "1d": {
        "ccxt": "1d", "binance": "1d", "bybit": "D", "bitget": "1day", "okx": "1D",
        "yf_interval": "1d", "yf_period": "1y", "limit": 120, "step_ms": 86400000
    },
    "1w": {
        "ccxt": "1w", "binance": "1w", "bybit": "W", "bitget": "1week", "okx": "1W",
        "yf_interval": "1wk", "yf_period": "3y", "limit": 100, "step_ms": 604800000
    },
}


def _http_get_json(url: str, timeout: float = 3.8) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 GoldVisionAI/3.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_from_binance_rest(ticker: str, interval: str, limit: int = 120) -> Optional[pd.DataFrame]:
    """Direct Binance v3 klines endpoint (from klinechart-ui-core/binance.ts)."""
    url = f"https://api.binance.com/api/v3/klines?symbol={ticker}&interval={interval}&limit={limit}"
    data = _http_get_json(url)
    if not isinstance(data, list) or len(data) < 20:
        return None
    rows = [{
        "timestamp": int(k[0]),
        "open": float(k[1]),
        "high": float(k[2]),
        "low": float(k[3]),
        "close": float(k[4]),
        "volume": float(k[5]),
    } for k in data]
    df = pd.DataFrame(rows)
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df


def fetch_from_bybit_rest(ticker: str, interval: str, limit: int = 120) -> Optional[pd.DataFrame]:
    """Direct Bybit v5 spot kline endpoint (from klinechart-ui-core/bybit.ts)."""
    url = f"https://api.bybit.com/v5/market/kline?category=spot&symbol={ticker}&interval={interval}&limit={limit}"
    data = _http_get_json(url)
    raw_list: List[List[str]] = (data.get("result") or {}).get("list") or []
    if len(raw_list) < 20:
        return None
    # Bybit returns newest-first; reverse to oldest-first
    raw_list = list(reversed(raw_list))
    rows = [{
        "timestamp": int(k[0]),
        "open": float(k[1]),
        "high": float(k[2]),
        "low": float(k[3]),
        "close": float(k[4]),
        "volume": float(k[5]),
    } for k in raw_list]
    df = pd.DataFrame(rows)
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df


def fetch_from_bitget_rest(ticker: str, granularity: str, limit: int = 120) -> Optional[pd.DataFrame]:
    """Direct Bitget v2 spot candles endpoint (from klinechart-ui-core/bitget.ts)."""
    url = f"https://api.bitget.com/api/v2/spot/market/candles?symbol={ticker}&granularity={granularity}&limit={limit}"
    data = _http_get_json(url)
    raw_list: List[List[str]] = data.get("data") or []
    if len(raw_list) < 20:
        return None
    rows = [{
        "timestamp": int(k[0]),
        "open": float(k[1]),
        "high": float(k[2]),
        "low": float(k[3]),
        "close": float(k[4]),
        "volume": float(k[5]),
    } for k in raw_list]
    df = pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df


def fetch_from_okx_rest(inst_id: str, bar: str, limit: int = 120) -> Optional[pd.DataFrame]:
    """Direct OKX v5 market candles endpoint (from klinechart-ui-core/okx.ts)."""
    url = f"https://www.okx.com/api/v5/market/candles?instId={inst_id}&bar={bar}&limit={limit}"
    data = _http_get_json(url)
    raw_list: List[List[str]] = data.get("data") or []
    if len(raw_list) < 20:
        return None
    # OKX returns newest-first; reverse to oldest-first
    raw_list = list(reversed(raw_list))
    rows = [{
        "timestamp": int(k[0]),
        "open": float(k[1]),
        "high": float(k[2]),
        "low": float(k[3]),
        "close": float(k[4]),
        "volume": float(k[5]),
    } for k in raw_list]
    df = pd.DataFrame(rows)
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df


def generate_fallback_gold_ohlcv(symbol: str = "PAXG/USDT", timeframe: str = "1h", limit: int = 110) -> pd.DataFrame:
    """
    Generates realistic institutional XAUUSD / PAXG candlestick series if external APIs
    are blocked by firewall/offline, ensuring the platform always loads smoothly.
    """
    tf_info = TIMEFRAME_MAPPING.get(timeframe, TIMEFRAME_MAPPING["1h"])
    seed_val = abs(hash(f"{symbol}_{timeframe}")) % 10000
    rng = np.random.default_rng(seed_val)

    base_price = 4145.0 if "PAXG" in symbol else (4142.0 if "XAUT" in symbol else 4148.0)
    vol_scale = 1.8 if timeframe in ("5m", "15m") else (4.2 if timeframe in ("1h", "4h") else 11.5)

    steps = rng.normal(0.08, vol_scale, limit)
    if limit >= 30:
        steps[-14] = -vol_scale * 2.1
        steps[-13] = vol_scale * 2.6
        steps[-12] = vol_scale * 2.2
        steps[-11] = vol_scale * 1.5
        steps[-6] = -vol_scale * 0.9
        steps[-5] = -vol_scale * 0.8
        steps[-2] = vol_scale * 1.4
        steps[-1] = vol_scale * 1.1

    closes = base_price + np.cumsum(steps)
    opens = np.roll(closes, 1)
    opens[0] = closes[0] - 1.5

    wick_up = np.abs(rng.normal(0, vol_scale * 0.75, limit))
    wick_dn = np.abs(rng.normal(0, vol_scale * 0.75, limit))
    if limit >= 15:
        wick_dn[-14] = vol_scale * 2.8

    highs = np.maximum(opens, closes) + wick_up
    lows = np.minimum(opens, closes) - wick_dn
    volumes = rng.uniform(140.0, 880.0, limit)
    if limit >= 15:
        volumes[-13] *= 2.2
        volumes[-12] *= 1.9

    now_ms = int(time.time() * 1000)
    step_ms = tf_info.get("step_ms", 3600000)
    timestamps = [now_ms - (limit - 1 - i) * step_ms for i in range(limit)]
    datetimes = pd.to_datetime(timestamps, unit='ms')

    out_df = pd.DataFrame({
        'timestamp': timestamps,
        'datetime': datetimes,
        'open': np.round(opens, 2),
        'high': np.round(highs, 2),
        'low': np.round(lows, 2),
        'close': np.round(closes, 2),
        'volume': np.round(volumes, 2)
    })
    out_df.attrs["is_fallback"] = True
    out_df.attrs["data_source"] = "SIMULATED_FALLBACK"
    return out_df


def fetch_historical_ohlcv(symbol: str = "PAXG/USDT", timeframe: str = "1h", limit: int = 110) -> pd.DataFrame:
    """
    Multi-Exchange Waterfall Datafeed:
    1. PAXG/USDT -> Binance REST -> Bybit v5 -> Bitget v2 -> OKX v5
    2. XAUT/USDT -> OKX v5 -> Bybit v5 -> Bitget v2
    3. XAU/USD   -> Yahoo Finance (GC=F, resampled for 4h) -> Binance PAXG/USDT proxy -> Synthetic fallback (flagged)
    """
    cache_key = f"{symbol}_{timeframe}"
    now = time.time()

    if cache_key in _CACHE:
        cached = _CACHE[cache_key]
        if now - cached["time"] < CACHE_TTL_SECONDS and len(cached["df"]) >= min(limit, 50):
            res_df = cached["df"].iloc[-limit:].reset_index(drop=True).copy()
            res_df.attrs["is_fallback"] = bool(cached.get("is_fallback", False))
            res_df.attrs["data_source"] = str(cached.get("data_source", "LIVE"))
            return res_df

    df = None
    data_source = "LIVE"
    is_fallback = False
    tf_info = TIMEFRAME_MAPPING.get(timeframe, TIMEFRAME_MAPPING["1h"])
    fetch_limit = max(limit, 110)

    if symbol == "PAXG/USDT":
        providers = [
            ("BINANCE_SPOT", lambda: fetch_from_binance_rest("PAXGUSDT", tf_info["binance"], fetch_limit)),
            ("BYBIT_SPOT", lambda: fetch_from_bybit_rest("PAXGUSDT", tf_info["bybit"], fetch_limit)),
            ("BITGET_SPOT", lambda: fetch_from_bitget_rest("PAXGUSDT", tf_info["bitget"], fetch_limit)),
            ("OKX_SPOT", lambda: fetch_from_okx_rest("PAXG-USDT", tf_info["okx"], fetch_limit)),
        ]
        for src_name, p in providers:
            try:
                cand_df = p()
                if cand_df is not None and len(cand_df) >= 20:
                    df = cand_df
                    data_source = src_name
                    break
            except Exception:
                continue

    elif symbol == "XAUT/USDT":
        providers = [
            ("OKX_SPOT", lambda: fetch_from_okx_rest("XAUT-USDT", tf_info["okx"], fetch_limit)),
            ("BYBIT_SPOT", lambda: fetch_from_bybit_rest("XAUTUSDT", tf_info["bybit"], fetch_limit)),
            ("BITGET_SPOT", lambda: fetch_from_bitget_rest("XAUTUSDT", tf_info["bitget"], fetch_limit)),
        ]
        for src_name, p in providers:
            try:
                cand_df = p()
                if cand_df is not None and len(cand_df) >= 20:
                    df = cand_df
                    data_source = src_name
                    break
            except Exception:
                continue

    elif symbol == "XAU/USD":
        try:
            ticker = yf.Ticker("GC=F")
            raw_df = ticker.history(period=tf_info["yf_period"], interval=tf_info["yf_interval"])
            if not raw_df.empty:
                raw_df = raw_df.reset_index()
                dt_col = 'Datetime' if 'Datetime' in raw_df.columns else ('Date' if 'Date' in raw_df.columns else raw_df.columns[0])
                yf_df = pd.DataFrame({
                    'timestamp': (raw_df[dt_col].astype('int64') // 10**6),
                    'datetime': pd.to_datetime(raw_df[dt_col]).dt.tz_localize(None),
                    'open': raw_df['Open'].astype(float),
                    'high': raw_df['High'].astype(float),
                    'low': raw_df['Low'].astype(float),
                    'close': raw_df['Close'].astype(float),
                    'volume': raw_df['Volume'].replace(0, 250).astype(float),
                })
                if timeframe == "4h" and len(yf_df) >= 8:
                    yf_df = yf_df.set_index("datetime").resample("4h").agg({
                        "timestamp": "first",
                        "open": "first",
                        "high": "max",
                        "low": "min",
                        "close": "last",
                        "volume": "sum"
                    }).dropna(subset=["open", "high", "low", "close"]).reset_index()
                    yf_df["timestamp"] = (yf_df["datetime"].astype("int64") // 10**6)
                if len(yf_df) > fetch_limit:
                    yf_df = yf_df.iloc[-fetch_limit:].reset_index(drop=True)
                if len(yf_df) >= 20:
                    df = yf_df
                    data_source = "YAHOO_GC_FUTURES"
        except Exception:
            pass

    if df is None or len(df) < 20:
        try:
            cand_df = fetch_from_binance_rest("PAXGUSDT", tf_info["binance"], fetch_limit)
            if cand_df is not None and len(cand_df) >= 20:
                df = cand_df
                data_source = "BINANCE_PAXG_PROXY" if symbol != "PAXG/USDT" else "BINANCE_SPOT"
        except Exception:
            pass

    if df is None or len(df) < 20:
        df = generate_fallback_gold_ohlcv(symbol=symbol, timeframe=timeframe, limit=fetch_limit)
        data_source = "SIMULATED_FALLBACK"
        is_fallback = True

    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.dropna().reset_index(drop=True)
    df.attrs["is_fallback"] = is_fallback
    df.attrs["data_source"] = data_source

    _CACHE[cache_key] = {
        "time": now,
        "df": df,
        "is_fallback": is_fallback,
        "data_source": data_source
    }
    res_df = df.iloc[-limit:].reset_index(drop=True).copy()
    res_df.attrs["is_fallback"] = is_fallback
    res_df.attrs["data_source"] = data_source
    return res_df


def fetch_orderbook_imbalance(symbol: str = "PAXG/USDT", limit: int = 50) -> Dict[str, Any]:
    """
    Fetches live Level-2 Orderbook depth from Binance / OKX / Bybit REST endpoints.
    """
    cache_key = f"ob_depth_{symbol}"
    now = time.time()
    if cache_key in _CACHE and (now - _CACHE[cache_key]["time"] < 15):
        return _CACHE[cache_key]["data"]

    result = {
        "available": False,
        "bid_volume": 0.0,
        "ask_volume": 0.0,
        "bid_pct": 50.0,
        "ask_pct": 50.0,
        "largest_bid_wall": None,
        "largest_ask_wall": None,
        "pressure": "NEUTRAL",
        "summary": "Tạm mất kết nối Orderbook Depth — Đưa về cân bằng (50% / 50%)"
    }

    try:
        bids, asks = [], []
        if symbol == "XAUT/USDT":
            data = _http_get_json(f"https://www.okx.com/api/v5/market/books?instId=XAUT-USDT&sz={limit}")
            book_list = data.get("data") or []
            if book_list:
                bids = book_list[0].get("bids", [])
                asks = book_list[0].get("asks", [])
        else:
            data = _http_get_json(f"https://api.binance.com/api/v3/depth?symbol=PAXGUSDT&limit={limit}")
            bids = data.get("bids", [])
            asks = data.get("asks", [])

        if bids and asks:
            bid_vol = sum(float(b[1]) for b in bids)
            ask_vol = sum(float(a[1]) for a in asks)
            total_vol = bid_vol + ask_vol

            bid_pct = round((bid_vol / total_vol) * 100, 1) if total_vol > 0 else 50.0
            ask_pct = round(100.0 - bid_pct, 1)

            max_bid = max(bids, key=lambda x: float(x[1]))
            max_ask = max(asks, key=lambda x: float(x[1]))

            pressure = "BULLISH" if bid_pct >= 55 else ("BEARISH" if ask_pct >= 55 else "NEUTRAL")
            if bid_pct >= 58:
                summary = f"Tường Mua (Bid) áp đảo {bid_pct}% - Tường đỡ lớn tại ${float(max_bid[0]):,.2f}"
            elif ask_pct >= 58:
                summary = f"Tường Bán (Ask) đè giá {ask_pct}% - Tường cản lớn tại ${float(max_ask[0]):,.2f}"
            else:
                summary = f"Thanh khoản Bid/Ask giằng co ({bid_pct}% Mua / {ask_pct}% Bán) | Đỡ: ${float(max_bid[0]):,.2f} - Cản: ${float(max_ask[0]):,.2f}"

            result = {
                "available": True,
                "bid_volume": round(bid_vol, 2),
                "ask_volume": round(ask_vol, 2),
                "bid_pct": bid_pct,
                "ask_pct": ask_pct,
                "largest_bid_wall": round(float(max_bid[0]), 2),
                "largest_ask_wall": round(float(max_ask[0]), 2),
                "pressure": pressure,
                "summary": summary
            }
            _CACHE[cache_key] = {"time": now, "data": result}
    except Exception:
        pass

    return result
