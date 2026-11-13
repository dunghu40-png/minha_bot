"""
XAUUSD & Digital Gold Institutional Analysis Engine (SMC + ICT + Supply/Demand + Price Action + Quant).
Implements:
1. Smart Money Concepts (SMC): External/Internal Structure (HH/HL/LH/LL), BOS, CHoCH, MSS,
   BSL/SSL, Equal Highs/Lows (EQH/EQL), Liquidity Sweep, Inducement (IDM),
   Order Block (OB), Breaker Block (BB), Mitigation Block, Rejection Block,
   FVG, IFVG, BPR, Displacement, Premium/Discount & OTE (0.618-0.786).
2. ICT Time & Liquidity: PDH/PDL, PWH/PWL, Asian Range, London/NY Killzones,
   Silver Bullet windows, AMD (Power of Three / Judas Swing), Dealing Range (DST-aware NY time).
3. Price Action: Pin Bar, Engulfing, Rejection, Inside/Outside Bar, Breakout/False Breakout,
   Momentum, Compression & Expansion.
4. Supply & Demand: RBR, DBD, RBD, DBR with Fresh/Tested/Mitigated status & Quality Score (0-100).
5. Quantitative Analysis: ATR, ADX, EMA 20/50/200, RSI, StdDev, RVOL, VWAP, Bollinger Bands,
   Volume Profile (POC, VAH, VAL) with Broker Tick Volume vs Centralized Volume distinction.
6. 10 Institutional Entry Models with causal Event-Chain linking (Sweep -> Displacement -> MSS -> FVG/OB).
"""

import math
from datetime import datetime, timezone, timedelta
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional

try:
    from zoneinfo import ZoneInfo
    NY_TZ = ZoneInfo("America/New_York")
except Exception:
    NY_TZ = timezone(timedelta(hours=-5))


def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate Quantitative Indicators: EMA 20/50/200, RSI (Wilder), ATR (Wilder), ADX, VWAP, Bollinger Bands, StdDev, RVOL."""
    src_attrs = dict(getattr(df, "attrs", {}))
    df = df.copy()
    df.attrs.update(src_attrs)

    # 1. EMAs
    df['ema_20'] = df['close'].ewm(span=20, adjust=False).mean()
    df['ema_50'] = df['close'].ewm(span=50, adjust=False).mean()
    df['ema_200'] = df['close'].ewm(span=200, adjust=False).mean()

    # 2. RSI 14 (Wilder's RMA)
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0.0)).ewm(alpha=1/14, adjust=False).mean()
    loss = (-delta.where(delta < 0, 0.0)).ewm(alpha=1/14, adjust=False).mean()
    rs = gain / loss.replace(0, 0.00001)
    df['rsi'] = (100 - (100 / (1 + rs))).fillna(50)

    # 3. ATR 14 (Wilder's RMA)
    high_low = df['high'] - df['low']
    high_close = (df['high'] - df['close'].shift()).abs()
    low_close = (df['low'] - df['close'].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    df['atr'] = tr.ewm(alpha=1/14, adjust=False).mean().bfill().fillna(df['close'] * 0.004)

    # 4. ADX 14 (+DI / -DI)
    up_move = df['high'].diff()
    down_move = -df['low'].diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr_smooth = tr.ewm(alpha=1/14, adjust=False).mean().replace(0, 0.0001)
    plus_di = 100 * (pd.Series(plus_dm, index=df.index).ewm(alpha=1/14, adjust=False).mean() / tr_smooth)
    minus_di = 100 * (pd.Series(minus_dm, index=df.index).ewm(alpha=1/14, adjust=False).mean() / tr_smooth)
    dx = (100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, 0.0001))
    df['adx'] = dx.ewm(alpha=1/14, adjust=False).mean().fillna(20)
    df['plus_di'] = plus_di.fillna(20)
    df['minus_di'] = minus_di.fillna(20)

    # 5. Bollinger Bands (20, 2) & Standard Deviation
    df['bb_mid'] = df['close'].rolling(window=20).mean().bfill()
    df['std_dev'] = df['close'].rolling(window=20).std().bfill().fillna(df['atr'])
    df['bb_upper'] = df['bb_mid'] + (2.0 * df['std_dev'])
    df['bb_lower'] = df['bb_mid'] - (2.0 * df['std_dev'])
    df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_mid'].replace(0, 1.0)

    # 6. Rolling Session / Anchor VWAP
    typical_price = (df['high'] + df['low'] + df['close']) / 3.0
    vol_safe = df['volume'].replace(0, 1.0)
    df['vwap'] = (typical_price * vol_safe).rolling(window=24, min_periods=1).sum() / vol_safe.rolling(window=24, min_periods=1).sum()

    # 7. Candle Anatomy & Order Flow Delta
    df['body_size'] = (df['close'] - df['open']).abs()
    df['candle_range'] = (df['high'] - df['low']).replace(0, 0.0001)
    df['upper_wick'] = df['high'] - df[['open', 'close']].max(axis=1)
    df['lower_wick'] = df[['open', 'close']].min(axis=1) - df['low']
    df['is_green'] = df['close'] >= df['open']
    df['body_ratio'] = df['body_size'] / df['candle_range']

    buy_pressure = (df['close'] - df['low']) / df['candle_range']
    sell_pressure = (df['high'] - df['close']) / df['candle_range']
    df['vol_delta'] = df['volume'] * (buy_pressure - sell_pressure)
    df['cvd'] = df['vol_delta'].cumsum()
    df['vol_sma20'] = df['volume'].rolling(window=20).mean().bfill().replace(0, 1.0)
    df['rvol'] = df['volume'] / df['vol_sma20']

    # 8. Chandelier Stop
    rolling_high = df['high'].rolling(window=16).max().bfill()
    rolling_low = df['low'].rolling(window=16).min().bfill()
    df['chandelier_long'] = rolling_high - (2.2 * df['atr'])
    df['chandelier_short'] = rolling_low + (2.2 * df['atr'])

    return df


def compute_volume_profile(df: pd.DataFrame, bins: int = 24) -> Dict[str, Any]:
    """
    Calculate Volume Profile: POC (Point of Control), VAH (Value Area High), VAL (Value Area Low)
    over the active dealing range (70% Value Area rule).
    """
    recent = df.iloc[-min(80, len(df)):]
    min_p = float(recent['low'].min())
    max_p = float(recent['high'].max())
    if max_p <= min_p:
        c = float(recent['close'].iloc[-1])
        return {"poc": c, "vah": c + 5, "val": c - 5, "profile": []}

    edges = np.linspace(min_p, max_p, bins + 1)
    vols = np.zeros(bins)
    for _, row in recent.iterrows():
        c_mid = (float(row['high']) + float(row['low']) + float(row['close'])) / 3.0
        v = max(float(row['volume']), 1.0)
        idx = int(np.clip(np.searchsorted(edges, c_mid) - 1, 0, bins - 1))
        vols[idx] += v

    poc_idx = int(np.argmax(vols))
    poc_price = round(float((edges[poc_idx] + edges[poc_idx + 1]) / 2.0), 2)

    # 70% Value Area expansion from POC
    total_v = float(np.sum(vols))
    target_v = total_v * 0.70
    accum_v = float(vols[poc_idx])
    low_i, high_i = poc_idx, poc_idx

    while accum_v < target_v and (low_i > 0 or high_i < bins - 1):
        v_down = vols[low_i - 1] if low_i > 0 else -1.0
        v_up = vols[high_i + 1] if high_i < bins - 1 else -1.0
        if v_up >= v_down and high_i < bins - 1:
            high_i += 1
            accum_v += float(vols[high_i])
        elif low_i > 0:
            low_i -= 1
            accum_v += float(vols[low_i])
        else:
            break

    val_price = round(float(edges[low_i]), 2)
    vah_price = round(float(edges[high_i + 1]), 2)
    max_bin_v = float(np.max(vols)) if np.max(vols) > 0 else 1.0

    profile_bars = []
    for b in range(bins):
        profile_bars.append({
            "price_low": round(float(edges[b]), 2),
            "price_high": round(float(edges[b + 1]), 2),
            "price_mid": round(float((edges[b] + edges[b + 1]) / 2.0), 2),
            "pct": round(float(vols[b] / max_bin_v) * 100, 1),
            "is_poc": (b == poc_idx),
            "in_va": (low_i <= b <= high_i)
        })

    return {
        "poc": poc_price,
        "vah": vah_price,
        "val": val_price,
        "profile": profile_bars
    }


def detect_swings_and_labels(df: pd.DataFrame, window: int = 4, structure_layer: str = "external") -> Dict[str, Any]:
    """
    Detect Swing Highs and Swing Lows and classify each into HH, HL, LH, LL.
    Supports both External Structure (window=4) and Internal Structure (window=2).
    """
    n = len(df)
    swing_highs = []
    swing_lows = []

    prev_high_val = None
    prev_low_val = None

    for i in range(window, n - window):
        ch = float(df['high'].iloc[i])
        cl = float(df['low'].iloc[i])

        is_high = True
        for j in range(1, window + 1):
            if df['high'].iloc[i - j] >= ch or df['high'].iloc[i + j] >= ch:
                is_high = False
                break
        if is_high:
            label = "HH" if (prev_high_val is None or ch >= prev_high_val) else "LH"
            prev_high_val = ch
            swing_highs.append({
                "id": f"{structure_layer}_SH_{i}",
                "index": i,
                "price": round(ch, 2),
                "label": label,
                "layer": structure_layer,
                "datetime": str(df['datetime'].iloc[i]),
                "timestamp": int(df['timestamp'].iloc[i])
            })

        is_low = True
        for j in range(1, window + 1):
            if df['low'].iloc[i - j] <= cl or df['low'].iloc[i + j] <= cl:
                is_low = False
                break
        if is_low:
            label = "HL" if (prev_low_val is None or cl >= prev_low_val) else "LL"
            prev_low_val = cl
            swing_lows.append({
                "id": f"{structure_layer}_SL_{i}",
                "index": i,
                "price": round(cl, 2),
                "label": label,
                "layer": structure_layer,
                "datetime": str(df['datetime'].iloc[i]),
                "timestamp": int(df['timestamp'].iloc[i])
            })

    all_pts = []
    for h in swing_highs:
        all_pts.append({**h, "swing_type": "high"})
    for l in swing_lows:
        all_pts.append({**l, "swing_type": "low"})
    all_pts.sort(key=lambda x: x["index"])

    return {
        "highs": swing_highs,
        "lows": swing_lows,
        "all": all_pts
    }


def detect_equal_highs_lows(swings: Dict[str, Any], avg_atr: float) -> List[Dict[str, Any]]:
    """Detect Equal Highs (EQH) and Equal Lows (EQL) liquidity clusters."""
    eq_pools = []
    tol = max(avg_atr * 0.28, 0.5)

    highs = swings["highs"]
    for i in range(len(highs) - 1):
        h1, h2 = highs[i], highs[i + 1]
        if abs(h1["price"] - h2["price"]) <= tol and (h2["index"] - h1["index"]) <= 35:
            lvl = round((h1["price"] + h2["price"]) / 2.0, 2)
            eq_pools.append({
                "id": f"EQH_{h2['index']}",
                "type": "EQH",
                "direction": "bearish_magnet",
                "price": lvl,
                "start_index": h1["index"],
                "end_index": h2["index"],
                "desc": f"Cụm thanh khoản hai đỉnh bằng nhau (Equal Highs - BSL) tại ${lvl:,.2f}"
            })

    lows = swings["lows"]
    for i in range(len(lows) - 1):
        l1, l2 = lows[i], lows[i + 1]
        if abs(l1["price"] - l2["price"]) <= tol and (l2["index"] - l1["index"]) <= 35:
            lvl = round((l1["price"] + l2["price"]) / 2.0, 2)
            eq_pools.append({
                "id": f"EQL_{l2['index']}",
                "type": "EQL",
                "direction": "bullish_magnet",
                "price": lvl,
                "start_index": l1["index"],
                "end_index": l2["index"],
                "desc": f"Cụm thanh khoản hai đáy bằng nhau (Equal Lows - SSL) tại ${lvl:,.2f}"
            })

    return eq_pools[-6:]


def detect_liquidity_sweeps(df: pd.DataFrame, swings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Detect BSL / SSL Liquidity Sweeps (Stop-Hunts) where price pierces a prior Swing High/Low
    and closes back inside the range.
    """
    n = len(df)
    sweeps = []
    highs = swings["highs"]
    lows = swings["lows"]

    start_scan = max(8, n - 30)
    for i in range(start_scan, n):
        c_high = float(df['high'].iloc[i])
        c_low = float(df['low'].iloc[i])
        c_close = float(df['close'].iloc[i])
        c_atr = float(df['atr'].iloc[i])

        # Bullish SSL Sweep
        prior_lows = [l for l in lows if l["index"] < i - 1 and (i - l["index"]) <= 45]
        for pl in prior_lows:
            lvl = pl["price"]
            if c_low < lvl and c_close > lvl and (lvl - c_low) <= (1.8 * c_atr):
                already_broken = any(df['close'].iloc[k] < lvl for k in range(pl["index"] + 1, i))
                if not already_broken:
                    invalidated_after = any(df['close'].iloc[k] < c_low for k in range(i + 1, n))
                    sweeps.append({
                        "id": f"SWEEP_SSL_{i}",
                        "type": "bullish",
                        "pool_type": "SSL",
                        "name": "Quét Thanh Khoản Đáy (SSL Sweep)",
                        "index": i,
                        "swept_swing_id": pl["id"],
                        "swept_level": round(lvl, 2),
                        "wick_extreme": round(c_low, 2),
                        "close_price": round(c_close, 2),
                        "invalidated": invalidated_after,
                        "is_recent": (n - 1 - i) <= 6 and not invalidated_after,
                        "desc": f"Nến #{i} quét qua đáy SSL ${lvl:,.2f} (xuống ${c_low:,.2f}) rồi rút chân đóng trên ${c_close:,.2f}{' [ĐÃ THỦNG LẠI]' if invalidated_after else ''}."
                    })
                    break

        # Bearish BSL Sweep
        prior_highs = [h for h in highs if h["index"] < i - 1 and (i - h["index"]) <= 45]
        for ph in prior_highs:
            lvl = ph["price"]
            if c_high > lvl and c_close < lvl and (c_high - lvl) <= (1.8 * c_atr):
                already_broken = any(df['close'].iloc[k] > lvl for k in range(ph["index"] + 1, i))
                if not already_broken:
                    invalidated_after = any(df['close'].iloc[k] > c_high for k in range(i + 1, n))
                    sweeps.append({
                        "id": f"SWEEP_BSL_{i}",
                        "type": "bearish",
                        "pool_type": "BSL",
                        "name": "Quét Thanh Khoản Đỉnh (BSL Sweep)",
                        "index": i,
                        "swept_swing_id": ph["id"],
                        "swept_level": round(lvl, 2),
                        "wick_extreme": round(c_high, 2),
                        "close_price": round(c_close, 2),
                        "invalidated": invalidated_after,
                        "is_recent": (n - 1 - i) <= 6 and not invalidated_after,
                        "desc": f"Nến #{i} quét qua đỉnh BSL ${lvl:,.2f} (lên ${c_high:,.2f}) rồi đóng cửa ngược xuống ${c_close:,.2f}{' [ĐÃ VƯỢT LẠI]' if invalidated_after else ''}."
                    })
                    break

    return sweeps[-8:]


def detect_smc_full_suite(df: pd.DataFrame, ext_swings: Dict[str, Any], int_swings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Comprehensive SMC Engine with Event-Chain Linking:
    - Displacements
    - BOS / CHoCH / MSS (Market Structure Shift)
    - Inducement (IDM)
    - Order Blocks (OB) -> Breaker Blocks (BB) -> Mitigation Blocks (MB) -> Rejection Blocks (RB)
    - FVG -> IFVG (Inverse FVG) -> BPR (Balanced Price Range)
    - Dealing Range: Premium / Discount / Equilibrium / OTE (0.618 - 0.786)
    """
    n = len(df)
    avg_atr = float(df['atr'].iloc[-1])
    sweeps = detect_liquidity_sweeps(df, ext_swings)
    eq_pools = detect_equal_highs_lows(ext_swings, avg_atr)

    # 1. Detect Displacements
    displacements = []
    for i in range(3, n):
        c_atr = float(df['atr'].iloc[i])
        body = float(df['body_size'].iloc[i])
        b_ratio = float(df['body_ratio'].iloc[i])
        three_bar_move = float(df['close'].iloc[i] - df['open'].iloc[i - 2])

        if (body >= 1.3 * c_atr and b_ratio >= 0.65) or abs(three_bar_move) >= 1.8 * c_atr:
            d_type = "bullish" if df['close'].iloc[i] >= df['open'].iloc[i] else "bearish"
            strength = round(max(body, abs(three_bar_move)) / max(c_atr, 0.01), 2)
            displacements.append({
                "id": f"DISP_{i}",
                "index": i,
                "type": d_type,
                "strength_atr": strength,
                "price_start": round(float(df['open'].iloc[i]), 2),
                "price_end": round(float(df['close'].iloc[i]), 2),
                "desc": f"Displacement {d_type.upper()} mạnh gấp {strength}x ATR tại nến #{i}"
            })

    disp_by_idx = {d["index"]: d for d in displacements}

    # 2. Detect Structure Breaks Chronologically: BOS, CHoCH, and MSS (linked to Sweep & Displacement)
    structure_events = []
    highs = ext_swings["highs"]
    lows = ext_swings["lows"]
    scan_highs = highs[-10:]
    scan_lows = lows[-10:]
    broken_high_ids = set()
    broken_low_ids = set()

    # Initialize running trend from earliest visible swings / EMA (not future last candle!)
    early_idx = min([s["index"] for s in (scan_highs + scan_lows)], default=0)
    early_idx = min(max(early_idx, 0), n - 1)
    trend = "bullish" if float(df['close'].iloc[early_idx]) >= float(df['ema_50'].iloc[early_idx]) else "bearish"

    for k in range(4, n):
        c_close = float(df['close'].iloc[k])

        broken_h_now = [
            h for h in scan_highs
            if h["id"] not in broken_high_ids and h["index"] < k and c_close > h["price"]
        ]
        if broken_h_now:
            for h in broken_h_now:
                broken_high_ids.add(h["id"])
            h_ref = max(broken_h_now, key=lambda x: x["price"])
            near_disp = next((d for d in displacements if abs(d["index"] - k) <= 2 and d["type"] == "bullish"), None)
            prior_sweep = next((s for s in reversed(sweeps) if s["type"] == "bullish" and 0 <= (k - s["index"]) <= 12), None)

            if trend == "bearish":
                ev_type = "MSS" if (near_disp or prior_sweep) else "CHoCH"
            else:
                ev_type = "BOS"
            trend = "bullish"

            causal_chain = f"{ev_type} Tăng phá đỉnh {h_ref['label']} (${h_ref['price']:,.2f})"
            if prior_sweep:
                causal_chain += f" sau khi {prior_sweep['name']} tại ${prior_sweep['swept_level']:,.2f}"
            if near_disp:
                causal_chain += f" với {near_disp['desc']}"

            structure_events.append({
                "id": f"{ev_type}_BULL_{k}",
                "event": ev_type,
                "direction": "bullish",
                "broken_swing_id": h_ref["id"],
                "broken_swing_index": h_ref["index"],
                "index": k,
                "price": h_ref["price"],
                "displacement_id": near_disp["id"] if near_disp else None,
                "sweep_id": prior_sweep["id"] if prior_sweep else None,
                "causal_desc": causal_chain
            })

        broken_l_now = [
            l for l in scan_lows
            if l["id"] not in broken_low_ids and l["index"] < k and c_close < l["price"]
        ]
        if broken_l_now:
            for l in broken_l_now:
                broken_low_ids.add(l["id"])
            l_ref = min(broken_l_now, key=lambda x: x["price"])
            near_disp = next((d for d in displacements if abs(d["index"] - k) <= 2 and d["type"] == "bearish"), None)
            prior_sweep = next((s for s in reversed(sweeps) if s["type"] == "bearish" and 0 <= (k - s["index"]) <= 12), None)

            if trend == "bullish":
                ev_type = "MSS" if (near_disp or prior_sweep) else "CHoCH"
            else:
                ev_type = "BOS"
            trend = "bearish"

            causal_chain = f"{ev_type} Giảm phá đáy {l_ref['label']} (${l_ref['price']:,.2f})"
            if prior_sweep:
                causal_chain += f" sau khi {prior_sweep['name']} tại ${prior_sweep['swept_level']:,.2f}"
            if near_disp:
                causal_chain += f" với {near_disp['desc']}"

            structure_events.append({
                "id": f"{ev_type}_BEAR_{k}",
                "event": ev_type,
                "direction": "bearish",
                "broken_swing_id": l_ref["id"],
                "broken_swing_index": l_ref["index"],
                "index": k,
                "price": l_ref["price"],
                "displacement_id": near_disp["id"] if near_disp else None,
                "sweep_id": prior_sweep["id"] if prior_sweep else None,
                "causal_desc": causal_chain
            })

    if structure_events:
        trend = structure_events[-1]["direction"]
    else:
        trend = "bullish" if float(df['close'].iloc[-1]) >= float(df['ema_50'].iloc[-1]) else "bearish"

    # 3. Detect FVG, IFVG (Inverse FVG), and BPR (Balanced Price Range)
    fvg_list = []
    ifvg_list = []
    for i in range(2, n):
        c_atr = float(df['atr'].iloc[i])
        # Bullish gap
        if float(df['low'].iloc[i]) > float(df['high'].iloc[i - 2]):
            top = round(float(df['low'].iloc[i]), 2)
            bot = round(float(df['high'].iloc[i - 2]), 2)
            if (top - bot) > (c_atr * 0.12):
                mitigated = False
                violated_idx = None
                for k in range(i + 1, n):
                    if float(df['low'].iloc[k]) <= top:
                        mitigated = True
                    if float(df['close'].iloc[k]) < bot:
                        violated_idx = k
                        break

                parent_disp = disp_by_idx.get(i - 1) or disp_by_idx.get(i)
                causal = f"Bullish FVG (${bot:,.2f} - ${top:,.2f}) tạo bởi {parent_disp['desc'] if parent_disp else f'nến đẩy #{i-1}'}"
                if violated_idx is None:
                    fvg_list.append({
                        "id": f"FVG_BULL_{i-1}",
                        "type": "bullish",
                        "subtype": "FVG",
                        "top": top,
                        "bottom": bot,
                        "index": i - 1,
                        "mitigated": mitigated,
                        "displacement_id": parent_disp["id"] if parent_disp else None,
                        "causal_desc": causal
                    })
                else:
                    ifvg_list.append({
                        "id": f"IFVG_BEAR_{i-1}",
                        "type": "bearish",
                        "subtype": "IFVG",
                        "top": top,
                        "bottom": bot,
                        "index": i - 1,
                        "broken_index": violated_idx,
                        "causal_desc": f"Inverse FVG Giảm (${bot:,.2f} - ${top:,.2f}): Bullish FVG bị phá thủng tại nến #{violated_idx}, đảo vai trò thành kháng cự"
                    })

        # Bearish gap
        elif float(df['high'].iloc[i]) < float(df['low'].iloc[i - 2]):
            top = round(float(df['low'].iloc[i - 2]), 2)
            bot = round(float(df['high'].iloc[i]), 2)
            if (top - bot) > (c_atr * 0.12):
                mitigated = False
                violated_idx = None
                for k in range(i + 1, n):
                    if float(df['high'].iloc[k]) >= bot:
                        mitigated = True
                    if float(df['close'].iloc[k]) > top:
                        violated_idx = k
                        break

                parent_disp = disp_by_idx.get(i - 1) or disp_by_idx.get(i)
                causal = f"Bearish FVG (${bot:,.2f} - ${top:,.2f}) tạo bởi {parent_disp['desc'] if parent_disp else f'nến đẩy #{i-1}'}"
                if violated_idx is None:
                    fvg_list.append({
                        "id": f"FVG_BEAR_{i-1}",
                        "type": "bearish",
                        "subtype": "FVG",
                        "top": top,
                        "bottom": bot,
                        "index": i - 1,
                        "mitigated": mitigated,
                        "displacement_id": parent_disp["id"] if parent_disp else None,
                        "causal_desc": causal
                    })
                else:
                    ifvg_list.append({
                        "id": f"IFVG_BULL_{i-1}",
                        "type": "bullish",
                        "subtype": "IFVG",
                        "top": top,
                        "bottom": bot,
                        "index": i - 1,
                        "broken_index": violated_idx,
                        "causal_desc": f"Inverse FVG Tăng (${bot:,.2f} - ${top:,.2f}): Bearish FVG bị phá vượt tại nến #{violated_idx}, đảo vai trò thành hỗ trợ"
                    })

    # Detect BPR (Balanced Price Range: overlap between recent Bullish FVG and Bearish FVG)
    bpr_list = []
    bull_fvgs = [f for f in fvg_list if f["type"] == "bullish"]
    bear_fvgs = [f for f in fvg_list if f["type"] == "bearish"]
    for bf in bull_fvgs[-5:]:
        for rf in bear_fvgs[-5:]:
            if abs(bf["index"] - rf["index"]) <= 18:
                ov_top = min(bf["top"], rf["top"])
                ov_bot = max(bf["bottom"], rf["bottom"])
                if ov_top > ov_bot:
                    bpr_dir = "bullish" if bf["index"] > rf["index"] else "bearish"
                    bpr_list.append({
                        "id": f"BPR_{max(bf['index'], rf['index'])}",
                        "type": bpr_dir,
                        "subtype": "BPR",
                        "top": round(ov_top, 2),
                        "bottom": round(ov_bot, 2),
                        "index": min(bf["index"], rf["index"]),
                        "causal_desc": f"Balanced Price Range - BPR (${ov_bot:,.2f} - ${ov_top:,.2f}): Vùng giao thoa kép giữa FVG tăng và FVG giảm"
                    })

    # 4. Detect Order Blocks (OB), Breaker Blocks (BB), and Rejection Blocks (RB)
    order_blocks = []
    breaker_blocks = []
    rejection_blocks = []

    for d in displacements:
        i = d["index"]
        if i < 4 or i >= n - 1:
            continue
        if d["type"] == "bullish":
            for ob_idx in range(i - 1, max(0, i - 5), -1):
                if df['close'].iloc[ob_idx] < df['open'].iloc[ob_idx]:
                    ob_top = round(float(max(df['open'].iloc[ob_idx], df['close'].iloc[ob_idx])), 2)
                    ob_bot = round(float(df['low'].iloc[ob_idx]), 2)
                    retested = False
                    broken_idx = None
                    for m in range(i + 1, n):
                        if float(df['low'].iloc[m]) <= ob_top:
                            retested = True
                        if float(df['close'].iloc[m]) < ob_bot:
                            broken_idx = m
                            break

                    linked_struct = next((ev for ev in structure_events if abs(ev["index"] - i) <= 3 and ev["direction"] == "bullish"), None)
                    causal = f"Bullish OB (${ob_bot:,.2f} - ${ob_top:,.2f}) khởi nguồn của {d['desc']}"
                    if linked_struct:
                        causal += f", gây ra {linked_struct['causal_desc']}"

                    if broken_idx is None:
                        order_blocks.append({
                            "id": f"OB_BULL_{ob_idx}",
                            "type": "bullish",
                            "subtype": "OB",
                            "index": ob_idx,
                            "top": ob_top,
                            "bottom": ob_bot,
                            "mitigated": False,
                            "retested": retested,
                            "displacement_id": d["id"],
                            "structure_id": linked_struct["id"] if linked_struct else None,
                            "causal_desc": causal
                        })
                    else:
                        breaker_blocks.append({
                            "id": f"BB_BEAR_{ob_idx}",
                            "type": "bearish",
                            "subtype": "Breaker",
                            "index": ob_idx,
                            "broken_index": broken_idx,
                            "top": ob_top,
                            "bottom": ob_bot,
                            "causal_desc": f"Bearish Breaker Block (${ob_bot:,.2f} - ${ob_top:,.2f}): Bullish OB cũ bị phá vỡ dứt khoát tại nến #{broken_idx}, chuyển thành vùng cản bán mạnh"
                        })
                    break

        elif d["type"] == "bearish":
            for ob_idx in range(i - 1, max(0, i - 5), -1):
                if df['close'].iloc[ob_idx] > df['open'].iloc[ob_idx]:
                    ob_top = round(float(df['high'].iloc[ob_idx]), 2)
                    ob_bot = round(float(min(df['open'].iloc[ob_idx], df['close'].iloc[ob_idx])), 2)
                    retested = False
                    broken_idx = None
                    for m in range(i + 1, n):
                        if float(df['high'].iloc[m]) >= ob_bot:
                            retested = True
                        if float(df['close'].iloc[m]) > ob_top:
                            broken_idx = m
                            break

                    linked_struct = next((ev for ev in structure_events if abs(ev["index"] - i) <= 3 and ev["direction"] == "bearish"), None)
                    causal = f"Bearish OB (${ob_bot:,.2f} - ${ob_top:,.2f}) khởi nguồn của {d['desc']}"
                    if linked_struct:
                        causal += f", gây ra {linked_struct['causal_desc']}"

                    if broken_idx is None:
                        order_blocks.append({
                            "id": f"OB_BEAR_{ob_idx}",
                            "type": "bearish",
                            "subtype": "OB",
                            "index": ob_idx,
                            "top": ob_top,
                            "bottom": ob_bot,
                            "mitigated": False,
                            "retested": retested,
                            "displacement_id": d["id"],
                            "structure_id": linked_struct["id"] if linked_struct else None,
                            "causal_desc": causal
                        })
                    else:
                        breaker_blocks.append({
                            "id": f"BB_BULL_{ob_idx}",
                            "type": "bullish",
                            "subtype": "Breaker",
                            "index": ob_idx,
                            "broken_index": broken_idx,
                            "top": ob_top,
                            "bottom": ob_bot,
                            "causal_desc": f"Bullish Breaker Block (${ob_bot:,.2f} - ${ob_top:,.2f}): Bearish OB cũ bị phá vượt tại nến #{broken_idx}, chuyển thành bệ đỡ mua mạnh"
                        })
                    break

    # Detect Rejection Blocks (RB) at recent Swing Highs/Lows with deep wicks
    for sh in highs[-3:]:
        idx = sh["index"]
        uw = float(df['upper_wick'].iloc[idx])
        cr = float(df['candle_range'].iloc[idx])
        if uw >= 0.45 * cr:
            rb_top = round(float(df['high'].iloc[idx]), 2)
            rb_bot = round(float(max(df['open'].iloc[idx], df['close'].iloc[idx])), 2)
            rejection_blocks.append({
                "id": f"RB_BEAR_{idx}",
                "type": "bearish",
                "subtype": "Rejection",
                "index": idx,
                "top": rb_top,
                "bottom": rb_bot,
                "causal_desc": f"Bearish Rejection Block (${rb_bot:,.2f} - ${rb_top:,.2f}): Vùng râu nến từ chối giá đỉnh {sh['label']}"
            })

    for sl_sw in lows[-3:]:
        idx = sl_sw["index"]
        lw = float(df['lower_wick'].iloc[idx])
        cr = float(df['candle_range'].iloc[idx])
        if lw >= 0.45 * cr:
            rb_top = round(float(min(df['open'].iloc[idx], df['close'].iloc[idx])), 2)
            rb_bot = round(float(df['low'].iloc[idx]), 2)
            rejection_blocks.append({
                "id": f"RB_BULL_{idx}",
                "type": "bullish",
                "subtype": "Rejection",
                "index": idx,
                "top": rb_top,
                "bottom": rb_bot,
                "causal_desc": f"Bullish Rejection Block (${rb_bot:,.2f} - ${rb_top:,.2f}): Vùng râu nến từ chối giá đáy {sl_sw['label']}"
            })

    # 5. Inducement (IDM): Internal swing point sitting just ahead of the active Order Block
    inducements = []
    if trend == "bullish" and int_swings["lows"]:
        idm_pt = int_swings["lows"][-1]
        inducements.append({
            "id": f"IDM_BULL_{idm_pt['index']}",
            "type": "bullish_idm",
            "index": idm_pt["index"],
            "price": idm_pt["price"],
            "desc": f"Inducement (IDM) tại ${idm_pt['price']:,.2f} - Vùng bẫy thanh khoản dẫn dụ trước khối Bullish OB"
        })
    elif trend == "bearish" and int_swings["highs"]:
        idm_pt = int_swings["highs"][-1]
        inducements.append({
            "id": f"IDM_BEAR_{idm_pt['index']}",
            "type": "bearish_idm",
            "index": idm_pt["index"],
            "price": idm_pt["price"],
            "desc": f"Inducement (IDM) tại ${idm_pt['price']:,.2f} - Vùng bẫy thanh khoản dẫn dụ trước khối Bearish OB"
        })

    # 6. Dealing Range, Premium / Discount (50% Equilibrium) & OTE (0.618 - 0.786 Fib)
    recent_60 = df.iloc[-min(60, n):]
    dr_high = round(float(recent_60['high'].max()), 2)
    dr_low = round(float(recent_60['low'].min()), 2)
    dr_eq = round((dr_high + dr_low) / 2.0, 2)
    dr_span = max(dr_high - dr_low, 1.0)
    curr_p = float(df['close'].iloc[-1])
    pd_pct = round(((curr_p - dr_low) / dr_span) * 100, 1)
    pd_zone = "PREMIUM (Vùng Đắt > 50% - Ưu tiên Canh Bán)" if curr_p > dr_eq else "DISCOUNT (Vùng Rẻ < 50% - Ưu tiên Canh Mua)"

    if trend == "bullish":
        # Retracement downward from dr_high to dr_low: 0.618 to 0.786 pullback sits in Discount
        ote_top = round(dr_high - 0.618 * dr_span, 2)
        ote_bot = round(dr_high - 0.786 * dr_span, 2)
        ote_dir = "bullish"
    else:
        # Retracement upward from dr_low to dr_high: 0.618 to 0.786 pullback sits in Premium
        ote_bot = round(dr_low + 0.618 * dr_span, 2)
        ote_top = round(dr_low + 0.786 * dr_span, 2)
        ote_dir = "bearish"

    dealing_range = {
        "high": dr_high,
        "low": dr_low,
        "equilibrium": dr_eq,
        "current_pct": pd_pct,
        "zone_status": pd_zone,
        "is_discount": curr_p <= dr_eq,
        "ote": {
            "direction": ote_dir,
            "top": max(ote_top, ote_bot),
            "bottom": min(ote_top, ote_bot),
            "desc": f"Vùng OTE (Optimal Trade Entry 0.618-0.786 Fib): ${min(ote_top, ote_bot):,.2f} - ${max(ote_top, ote_bot):,.2f}"
        }
    }

    bos_only = [e for e in structure_events if e["event"] == "BOS"][-4:]
    choch_only = [e for e in structure_events if e["event"] in ("CHoCH", "MSS")][-4:]
    mss_only = [e for e in structure_events if e["event"] == "MSS"][-4:]

    # Anti-clutter deduplication: keep only recent non-overlapping zones near current price
    def _filter_zones(z_list, max_count=2, max_atr_dist=5.0):
        nearby = [z for z in z_list if abs(((z["top"] + z["bottom"]) / 2.0) - curr_p) <= max_atr_dist * avg_atr]
        src = nearby if nearby else z_list[-max_count:]
        dedup = []
        for z in reversed(src):
            if not any(abs(z["top"] - ex["top"]) < 0.8 * avg_atr or (z["bottom"] <= ex["top"] and z["top"] >= ex["bottom"]) for ex in dedup):
                dedup.append(z)
            if len(dedup) >= max_count:
                break
        return list(reversed(dedup))

    clean_obs = _filter_zones(order_blocks, max_count=2, max_atr_dist=4.5)
    clean_bbs = _filter_zones(breaker_blocks, max_count=1, max_atr_dist=3.5)
    clean_fvgs = _filter_zones(fvg_list, max_count=2, max_atr_dist=4.0)

    return {
        "trend": trend,
        "external_swings": ext_swings,
        "internal_swings": int_swings,
        "structure_events": structure_events[-4:],
        "bos": bos_only,
        "choch": choch_only,
        "mss": mss_only,
        "displacements": displacements[-5:],
        "order_blocks": clean_obs,
        "breaker_blocks": clean_bbs,
        "rejection_blocks": rejection_blocks[-2:],
        "fvg": clean_fvgs,
        "ifvg": ifvg_list[-2:],
        "bpr": bpr_list[-2:],
        "sweeps": sweeps[-2:],
        "equal_highs_lows": eq_pools[-3:],
        "inducements": inducements,
        "dealing_range": dealing_range,
        "recent_high": highs[-1] if highs else None,
        "recent_low": lows[-1] if lows else None
    }


def analyze_ict_time_and_liquidity(df: pd.DataFrame) -> Dict[str, Any]:
    """
    ICT Time & Liquidity Engine (DST-aware America/New_York):
    - Previous Day High/Low (PDH / PDL) & Previous Week High/Low (PWH / PWL)
    - Asian Range, London Killzone, New York Killzone, Silver Bullet Windows
    - AMD (Power of Three: Accumulation, Manipulation / Judas Swing, Distribution)
    """
    now_utc = datetime.now(timezone.utc)
    now_ny = now_utc.astimezone(NY_TZ)
    ny_hour = now_ny.hour + (now_ny.minute / 60.0)

    # Active Killzone & Silver Bullet check (NY Time)
    active_killzone = "Ngoài giờ Killzone chính (Theo dõi cấu trúc)"
    if 20.0 <= ny_hour or ny_hour < 0.0:
        active_killzone = "Asian Session (Phiên Á - Tích lũy / Accumulation)"
    elif 2.0 <= ny_hour < 5.0:
        active_killzone = "London Killzone (02:00-05:00 NY - Dễ xuất hiện Judas Swing)"
    elif 7.0 <= ny_hour < 10.0:
        active_killzone = "New York Killzone (07:00-10:00 NY - Biến động mạnh nhất)"
    elif 10.0 <= ny_hour < 12.0:
        active_killzone = "London Close Killzone (10:00-12:00 NY)"

    silver_bullet_active = False
    sb_window = "Chưa vào khung giờ Silver Bullet (03-04h, 10-11h, 14-15h NY)"
    if 3.0 <= ny_hour < 4.0:
        silver_bullet_active = True
        sb_window = "ACTIVE: London Silver Bullet Window (03:00 - 04:00 NY)"
    elif 10.0 <= ny_hour < 11.0:
        silver_bullet_active = True
        sb_window = "ACTIVE: NY AM Silver Bullet Window (10:00 - 11:00 NY)"
    elif 14.0 <= ny_hour < 15.0:
        silver_bullet_active = True
        sb_window = "ACTIVE: NY PM Silver Bullet Window (14:00 - 15:00 NY)"

    # Compute PDH/PDL and PWH/PWL from candle history
    n = len(df)
    prev_day_slice = df.iloc[max(0, n - 48):max(1, n - 12)]
    pdh = round(float(prev_day_slice['high'].max()), 2)
    pdl = round(float(prev_day_slice['low'].min()), 2)

    prev_week_slice = df.iloc[:max(1, n - 12)]
    pwh = round(float(prev_week_slice['high'].max()), 2)
    pwl = round(float(prev_week_slice['low'].min()), 2)

    # Asian Range & AMD (Power of Three) approximation on recent session bars
    asian_slice = df.iloc[max(0, n - 18):max(1, n - 8)]
    asian_high = round(float(asian_slice['high'].max()), 2)
    asian_low = round(float(asian_slice['low'].min()), 2)

    recent_8 = df.iloc[-min(8, n):]
    r_high = float(recent_8['high'].max())
    r_low = float(recent_8['low'].min())
    curr_c = float(df['close'].iloc[-1])

    amd_phase = "Accumulation (Đang tích lũy trong biên độ)"
    judas_swing = None
    if r_low < asian_low and curr_c > asian_low:
        amd_phase = "Distribution Tăng (Đã xong pha Manipulation quét đáy phiên Á)"
        judas_swing = f"Bullish Judas Swing: Quét giả qua đáy Asian Low (${asian_low:,.2f}) xuống ${r_low:,.2f} rồi đảo chiều tăng!"
    elif r_high > asian_high and curr_c < asian_high:
        amd_phase = "Distribution Giảm (Đã xong pha Manipulation quét đỉnh phiên Á)"
        judas_swing = f"Bearish Judas Swing: Quét giả qua đỉnh Asian High (${asian_high:,.2f}) lên ${r_high:,.2f} rồi đảo chiều giảm!"
    elif curr_c > asian_high:
        amd_phase = "Expansion / Distribution Tăng (Đã bứt phá khỏi biên độ phiên Á)"
    elif curr_c < asian_low:
        amd_phase = "Expansion / Distribution Giảm (Đã phá xuống dưới biên độ phiên Á)"

    return {
        "ny_time": now_ny.strftime("%H:%M %Z"),
        "is_dst": bool(now_ny.dst()),
        "active_killzone": active_killzone,
        "silver_bullet_active": silver_bullet_active,
        "silver_bullet_window": sb_window,
        "pdh": pdh,
        "pdl": pdl,
        "pwh": pwh,
        "pwl": pwl,
        "asian_high": asian_high,
        "asian_low": asian_low,
        "amd_phase": amd_phase,
        "judas_swing": judas_swing
    }


def detect_supply_demand_zones(df: pd.DataFrame, smc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Detect Supply & Demand Zones (RBR, DBD, RBD, DBR) and compute Zone Quality Score (0-100)
    based on departure strength, retest count (Fresh vs Tested), base tightness, and Dealing Range location.
    """
    n = len(df)
    zones = []
    dr_eq = smc["dealing_range"]["equilibrium"]

    for i in range(4, n - 2):
        c_atr = float(df['atr'].iloc[i])
        base_range = float(df['candle_range'].iloc[i - 1])
        # Base candle must be relatively compact
        if base_range > 1.3 * c_atr:
            continue

        leg_in = float(df['close'].iloc[i - 2] - df['open'].iloc[i - 3])
        leg_out = float(df['close'].iloc[i + 1] - df['open'].iloc[i])
        dep_strength = abs(leg_out) / max(c_atr, 0.01)

        if dep_strength < 1.35:
            continue

        z_top = round(float(df['high'].iloc[i - 1]), 2)
        z_bot = round(float(df['low'].iloc[i - 1]), 2)

        if leg_out > 0:
            pattern = "DBR (Drop-Base-Rally)" if leg_in < 0 else "RBR (Rally-Base-Rally)"
            z_type = "demand"
        else:
            pattern = "RBD (Rally-Base-Drop)" if leg_in > 0 else "DBD (Drop-Base-Drop)"
            z_type = "supply"

        # Count retests & check invalidation
        retests = 0
        invalidated = False
        for k in range(i + 2, n):
            if z_type == "demand":
                if float(df['low'].iloc[k]) <= z_top and float(df['close'].iloc[k]) >= z_bot:
                    retests += 1
                if float(df['close'].iloc[k]) < z_bot:
                    invalidated = True
                    break
            else:
                if float(df['high'].iloc[k]) >= z_bot and float(df['close'].iloc[k]) <= z_top:
                    retests += 1
                if float(df['close'].iloc[k]) > z_top:
                    invalidated = True
                    break

        if invalidated:
            continue

        status = "Fresh (Chưa test)" if retests == 0 else (f"Tested ({retests} lần)" if retests <= 2 else "Mitigated (Đã yếu)")
        # Quality Score (0-100)
        score = min(40, int(dep_strength * 16))
        score += 30 if retests == 0 else (18 if retests == 1 else 6)
        if (z_type == "demand" and z_top <= dr_eq) or (z_type == "supply" and z_bot >= dr_eq):
            score += 20  # Aligned with Discount/Premium
        if pattern.startswith("DBR") or pattern.startswith("RBD"):
            score += 10  # Pivot reversal zones have higher institutional weight

        zones.append({
            "id": f"SD_{z_type.upper()}_{i-1}",
            "type": z_type,
            "pattern": pattern,
            "index": i - 1,
            "top": z_top,
            "bottom": z_bot,
            "status": status,
            "retests": retests,
            "quality_score": min(99, score),
            "departure_atr": round(dep_strength, 2),
            "causal_desc": f"Vùng {z_type.upper()} {pattern} (${z_bot:,.2f} - ${z_top:,.2f}) | Trạng thái: {status} | Điểm chất lượng: {min(99, score)}/100 (Lực rời vùng {dep_strength:.1f}x ATR)"
        })

    return zones[-6:]


def detect_candlestick_patterns(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Full Price Action Suite:
    Pin Bar, Engulfing, Rejection Candle, Inside Bar, Outside Bar,
    Momentum Candle, Compression, Expansion.
    """
    patterns = []
    n = len(df)
    if n < 5:
        return patterns

    last = df.iloc[-1]
    prev = df.iloc[-2]
    prev2 = df.iloc[-3]

    # 1. Pin Bar
    if last['lower_wick'] >= (last['candle_range'] * 0.6) and last['body_size'] <= (last['candle_range'] * 0.32):
        patterns.append({
            "name": "Bullish Pin Bar (Từ chối giảm giá)",
            "type": "bullish",
            "index": n - 1,
            "price": float(last['low']),
            "desc": "Rút râu dưới chiếm >60% chiều dài nến, từ chối vùng giá thấp."
        })
    elif last['upper_wick'] >= (last['candle_range'] * 0.6) and last['body_size'] <= (last['candle_range'] * 0.32):
        patterns.append({
            "name": "Bearish Pin Bar (Từ chối tăng giá)",
            "type": "bearish",
            "index": n - 1,
            "price": float(last['high']),
            "desc": "Rút râu trên chiếm >60% chiều dài nến, phe Bán chặn đứng đà tăng."
        })

    # 2. Engulfing
    if not prev['is_green'] and last['is_green'] and (last['close'] > prev['open']) and (last['open'] <= prev['close']):
        patterns.append({
            "name": "Bullish Engulfing (Nến bao phủ tăng)",
            "type": "bullish",
            "index": n - 1,
            "price": float(last['low']),
            "desc": "Nến xanh nuốt trọn thân nến đỏ trước đó với động lượng mạnh."
        })
    elif prev['is_green'] and not last['is_green'] and (last['close'] < prev['open']) and (last['open'] >= prev['close']):
        patterns.append({
            "name": "Bearish Engulfing (Nến bao phủ giảm)",
            "type": "bearish",
            "index": n - 1,
            "price": float(last['high']),
            "desc": "Nến đỏ nuốt trọn thân nến xanh trước đó, áp lực xả áp đảo."
        })

    # 3. Inside Bar & Outside Bar
    if last['high'] < prev['high'] and last['low'] > prev['low']:
        patterns.append({
            "name": "Inside Bar (Nén giá tích lũy)",
            "type": "neutral",
            "index": n - 1,
            "price": float(last['close']),
            "desc": "Biên độ nến nằm gọn trong nến mẹ trước đó, báo hiệu nén lò xo chuẩn bị bùng nổ."
        })
    elif last['high'] > prev['high'] and last['low'] < prev['low']:
        ob_dir = "bullish" if last['is_green'] else "bearish"
        patterns.append({
            "name": f"Outside Bar ({'Tăng' if ob_dir == 'bullish' else 'Giảm'} mở rộng biên độ)",
            "type": ob_dir,
            "index": n - 1,
            "price": float(last['close']),
            "desc": "Nến mở rộng bao trùm cả đỉnh và đáy nến trước."
        })

    # 4. Momentum / Expansion vs Compression
    avg_range = float(df['candle_range'].iloc[-10:-1].mean())
    if float(last['candle_range']) >= 1.65 * avg_range and float(last['body_ratio']) >= 0.7:
        m_dir = "bullish" if last['is_green'] else "bearish"
        patterns.append({
            "name": f"Momentum Expansion ({'Bùng nổ Mua' if m_dir == 'bullish' else 'Bùng nổ Bán'})",
            "type": m_dir,
            "index": n - 1,
            "price": float(last['close']),
            "desc": "Nến thân đặc mở rộng biên độ gấp >1.65x trung bình."
        })
    elif float(df['candle_range'].iloc[-3:].mean()) <= 0.65 * avg_range:
        patterns.append({
            "name": "Compression (Nén biến động tiếp cận vùng cản)",
            "type": "neutral",
            "index": n - 1,
            "price": float(last['close']),
            "desc": "Chuỗi nến thu hẹp biên độ cạn kiệt thanh khoản trước nhịp phóng lớn."
        })

    return patterns


def detect_rsi_divergence(df: pd.DataFrame, swings: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Detect regular bullish or bearish RSI divergence."""
    if len(swings["lows"]) >= 2:
        l1, l2 = swings["lows"][-2], swings["lows"][-1]
        p1, p2 = l1["price"], l2["price"]
        r1 = float(df['rsi'].iloc[l1["index"]])
        r2 = float(df['rsi'].iloc[l2["index"]])
        if p2 < p1 and r2 > (r1 + 2):
            return {
                "type": "bullish",
                "name": "Phân kỳ tăng giá thường (Bullish Divergence)",
                "desc": f"Giá tạo đáy thấp hơn (${p2:.2f} < ${p1:.2f}) nhưng RSI tạo đáy cao hơn ({r2:.1f} > {r1:.1f})"
            }

    if len(swings["highs"]) >= 2:
        h1, h2 = swings["highs"][-2], swings["highs"][-1]
        p1, p2 = h1["price"], h2["price"]
        r1 = float(df['rsi'].iloc[h1["index"]])
        r2 = float(df['rsi'].iloc[h2["index"]])
        if p2 > p1 and r2 < (r1 - 2):
            return {
                "type": "bearish",
                "name": "Phân kỳ giảm giá thường (Bearish Divergence)",
                "desc": f"Giá tạo đỉnh cao hơn (${p2:.2f} > ${p1:.2f}) nhưng RSI tạo đỉnh thấp hơn ({r2:.1f} < {r1:.1f})"
            }

    return None


def analyze_market_regime(df: pd.DataFrame) -> Dict[str, Any]:
    """Market Regime Filter using ADX & Bollinger Width."""
    latest = df.iloc[-1]
    adx = float(latest['adx'])
    plus_di = float(latest['plus_di'])
    minus_di = float(latest['minus_di'])

    if adx >= 25:
        regime_code = "STRONG_TREND"
        direction = "TĂNG (BULL)" if plus_di > minus_di else "GIẢM (BEAR)"
        regime_name = f"CÓ SÓNG MẠNH (TRENDING {direction})"
        strategy_mode = "Ưu tiên Order Block / FVG Continuation thuận xu hướng"
    elif adx >= 20:
        regime_code = "TRANSITION"
        direction = "NGHIÊNG TĂNG" if plus_di > minus_di else "NGHIÊNG GIẢM"
        regime_name = f"CHUYỂN PHA / TẠO SÓNG ({direction})"
        strategy_mode = "Kết hợp BOS/MSS & Retest OTE / Order Block"
    else:
        regime_code = "SIDEWAY_RANGE"
        regime_name = "ĐI NGANG / TÍCH LŨY (MEAN-REVERSION)"
        strategy_mode = "Săn Thanh Khoản 2 Biên (Liquidity Sweep + MSS)"

    return {
        "code": regime_code,
        "name": regime_name,
        "adx": round(adx, 1),
        "plus_di": round(plus_di, 1),
        "minus_di": round(minus_di, 1),
        "strategy_mode": strategy_mode
    }


def analyze_order_flow_footprints(df: pd.DataFrame, orderbook_info: Optional[Dict[str, Any]] = None, symbol: str = "PAXG/USDT") -> Dict[str, Any]:
    """Order Flow Volume Delta, CVD, Absorption & Volume Source Distinction."""
    recent = df.iloc[-10:]
    latest = df.iloc[-1]

    pos_delta = recent[recent['vol_delta'] > 0]['vol_delta'].sum()
    neg_delta = abs(recent[recent['vol_delta'] < 0]['vol_delta'].sum())
    total_delta = pos_delta + neg_delta
    buy_delta_pct = round((pos_delta / total_delta) * 100, 1) if total_delta > 0 else 50.0

    cvd_diff = float(df['cvd'].iloc[-1] - df['cvd'].iloc[-10]) if len(df) >= 10 else 0.0
    rvol = float(latest['rvol'])

    absorption = None
    if rvol >= 1.35 and latest['lower_wick'] >= (latest['candle_range'] * 0.45):
        absorption = {
            "type": "bullish",
            "desc": f"Hấp thụ Cầu (Bullish Absorption): RVOL {rvol:.1f}x kèm rút chân dưới mạnh -> Lực Limit Buy tổ chức chặn đỡ!"
        }
    elif rvol >= 1.35 and latest['upper_wick'] >= (latest['candle_range'] * 0.45):
        absorption = {
            "type": "bearish",
            "desc": f"Hấp thụ Cung (Bearish Absorption): RVOL {rvol:.1f}x kèm râu trên dài -> Lực Limit Sell tổ chức chặn đầu!"
        }

    vol_source_note = (
        "Centralized Exchange Volume (Khối lượng khớp lệnh thực tế trên sổ lệnh tập trung Binance/OKX)"
        if ("PAXG" in symbol or "XAUT" in symbol)
        else "Tick Volume / Futures Feed (Lưu ý: Với XAUUSD CFD, Tick Volume phản ánh tần suất cập nhật giá của broker, không đồng nhất với volume tập trung)"
    )

    return {
        "buy_delta_pct": buy_delta_pct,
        "sell_delta_pct": round(100.0 - buy_delta_pct, 1),
        "cvd_trend": "TÍCH LŨY DƯƠNG (GOM HÀNG)" if cvd_diff > 0 else "PHÂN PHỐI ÂM (XẢ HÀNG)",
        "rvol": round(rvol, 2),
        "absorption": absorption,
        "volume_source_note": vol_source_note,
        "orderbook": orderbook_info
    }


def evaluate_entry_models_and_scenarios(
    df: pd.DataFrame,
    smc: Dict[str, Any],
    ict: Dict[str, Any],
    sd_zones: List[Dict[str, Any]],
    patterns: List[Dict[str, Any]],
    timeframe: str
) -> Dict[str, Any]:
    """
    Evaluates the 10 Institutional Entry Models and builds explicit Bullish & Bearish Scenarios
    with Entry, SL, TP1, TP2, Invalidation, and Expiration rules.
    """
    curr_p = round(float(df['close'].iloc[-1]), 2)
    atr = float(df['atr'].iloc[-1])
    dr = smc["dealing_range"]

    bull_obs = [ob for ob in smc["order_blocks"] if ob["type"] == "bullish"]
    bear_obs = [ob for ob in smc["order_blocks"] if ob["type"] == "bearish"]
    bull_fvgs = [f for f in smc["fvg"] if f["type"] == "bullish"]
    bear_fvgs = [f for f in smc["fvg"] if f["type"] == "bearish"]
    bull_bbs = [b for b in smc["breaker_blocks"] if b["type"] == "bullish"]
    bear_bbs = [b for b in smc["breaker_blocks"] if b["type"] == "bearish"]
    recent_sweeps = [s for s in smc["sweeps"] if s["is_recent"]]

    # Identify active Entry Models
    detected_models = []

    # Model 1 & 2: Liquidity Sweep + MSS / FVG Retest
    if recent_sweeps:
        sw = recent_sweeps[-1]
        has_mss = any(m["direction"] == sw["type"] for m in smc["mss"])
        has_fvg = any(f["type"] == sw["type"] for f in smc["fvg"][-2:])
        if has_mss:
            detected_models.append({
                "id": "MODEL_SWEEP_MSS",
                "name": "Model 1: Liquidity Sweep + MSS",
                "direction": sw["type"].upper(),
                "status": "ACTIVE",
                "conditions": f"Đã quét {sw['pool_type']} tại ${sw['swept_level']:,.2f} + Displacement xác nhận MSS đảo chiều",
                "expiration": "Hết hạn sau 8 cây nến nếu giá không retest vùng FVG/OB"
            })
        elif has_fvg:
            detected_models.append({
                "id": "MODEL_SWEEP_FVG",
                "name": "Model 2: Sweep + FVG Retest",
                "direction": sw["type"].upper(),
                "status": "ACTIVE",
                "conditions": f"Quét thanh khoản tại ${sw['swept_level']:,.2f} kèm tạo khoảng trống FVG",
                "expiration": "Hết hạn nếu giá phá qua đáy/đỉnh râu Sweep"
            })

    # Model 3: Order Block Retest
    if bull_obs and abs(curr_p - bull_obs[-1]["top"]) <= 2.5 * atr:
        ob = bull_obs[-1]
        detected_models.append({
            "id": "MODEL_OB_RETEST_BULL",
            "name": "Model 3: Bullish Order Block Retest",
            "direction": "BUY",
            "status": "ACTIVE",
            "conditions": f"BOS tăng + Giá đang hồi về kiểm tra Bullish OB (${ob['bottom']:,.2f} - ${ob['top']:,.2f})",
            "expiration": "Vô hiệu ngay khi nến đóng cửa dưới đáy OB"
        })
    if bear_obs and abs(bear_obs[-1]["bottom"] - curr_p) <= 2.5 * atr:
        ob = bear_obs[-1]
        detected_models.append({
            "id": "MODEL_OB_RETEST_BEAR",
            "name": "Model 3: Bearish Order Block Retest",
            "direction": "SELL",
            "status": "ACTIVE",
            "conditions": f"BOS giảm + Giá đang hồi lên kiểm tra Bearish OB (${ob['bottom']:,.2f} - ${ob['top']:,.2f})",
            "expiration": "Vô hiệu ngay khi nến đóng cửa trên đỉnh OB"
        })

    # Model 4: Breaker Block Entry
    if bull_bbs:
        bb = bull_bbs[-1]
        detected_models.append({
            "id": "MODEL_BREAKER_BULL",
            "name": "Model 4: Bullish Breaker Block Entry",
            "direction": "BUY",
            "status": "WATCH",
            "conditions": f"Bearish OB cũ bị phá vượt, đổi vai trò làm bệ đỡ tại ${bb['bottom']:,.2f} - ${bb['top']:,.2f}",
            "expiration": "Hết hiệu lực sau 12 nến"
        })
    if bear_bbs:
        bb = bear_bbs[-1]
        detected_models.append({
            "id": "MODEL_BREAKER_BEAR",
            "name": "Model 4: Bearish Breaker Block Entry",
            "direction": "SELL",
            "status": "WATCH",
            "conditions": f"Bullish OB cũ bị phá thủng, đổi vai trò làm cản bán tại ${bb['bottom']:,.2f} - ${bb['top']:,.2f}",
            "expiration": "Hết hiệu lực sau 12 nến"
        })

    # Model 6: OTE Entry (0.618 - 0.786 Fib)
    ote = dr["ote"]
    if ote["bottom"] <= curr_p <= ote["top"]:
        detected_models.append({
            "id": "MODEL_OTE",
            "name": "Model 6: ICT OTE (Optimal Trade Entry 0.62-0.79)",
            "direction": "BUY" if ote["direction"] == "bullish" else "SELL",
            "status": "ACTIVE",
            "conditions": f"Giá đang nằm chính xác trong vùng chiết khấu vàng OTE (${ote['bottom']:,.2f} - ${ote['top']:,.2f})",
            "expiration": "Vô hiệu khi phá qua mốc 100% Dealing Range"
        })

    # Model 7 & 8: Silver Bullet / AMD Judas Swing
    if ict["silver_bullet_active"] and smc["fvg"]:
        f_last = smc["fvg"][-1]
        detected_models.append({
            "id": "MODEL_SILVER_BULLET",
            "name": "Model 7: ICT Silver Bullet Setup",
            "direction": "BUY" if f_last["type"] == "bullish" else "SELL",
            "status": "ACTIVE",
            "conditions": f"{ict['silver_bullet_window']} + Xuất hiện FVG tại ${f_last['bottom']:,.2f} - ${f_last['top']:,.2f}",
            "expiration": "Hết hạn ngay khi kết thúc khung giờ 60 phút Silver Bullet"
        })
    if ict["judas_swing"]:
        detected_models.append({
            "id": "MODEL_AMD_JUDAS",
            "name": "Model 8: ICT AMD / Power of Three (Judas Swing)",
            "direction": "BUY" if "Bullish" in ict["judas_swing"] else "SELL",
            "status": "ACTIVE",
            "conditions": ict["judas_swing"],
            "expiration": "Trong phiên giao dịch hiện tại"
        })

    # Construct Explicit Bullish & Bearish Trading Scenarios (always select POI on the valid side of price)
    bull_pool = [z for z in (bull_obs + bull_fvgs) if z["top"] <= curr_p + 0.15 * atr]
    bear_pool = [z for z in (bear_obs + bear_fvgs) if z["bottom"] >= curr_p - 0.15 * atr]
    bull_zone_ref = max(bull_pool, key=lambda z: z["top"]) if bull_pool else None
    bull_entry = round(bull_zone_ref["top"], 2) if bull_zone_ref else round(curr_p - 0.65 * atr, 2)
    bull_inval = round((bull_zone_ref["bottom"] if bull_zone_ref else curr_p - 1.55 * atr) - 0.55 * atr, 2)
    bull_risk = max(abs(bull_entry - bull_inval), 0.85 * atr)
    bull_tp1 = round(bull_entry + 1.8 * bull_risk, 2)
    bull_tp2 = round(max(bull_entry + 2.8 * bull_risk, dr["high"]), 2)

    bear_zone_ref = min(bear_pool, key=lambda z: z["bottom"]) if bear_pool else None
    bear_entry = round(bear_zone_ref["bottom"], 2) if bear_zone_ref else round(curr_p + 0.65 * atr, 2)
    bear_inval = round((bear_zone_ref["top"] if bear_zone_ref else curr_p + 1.55 * atr) + 0.55 * atr, 2)
    bear_risk = max(abs(bear_inval - bear_entry), 0.85 * atr)
    bear_tp1 = round(bear_entry - 1.8 * bear_risk, 2)
    bear_tp2 = round(min(bear_entry - 2.8 * bear_risk, dr["low"]), 2)

    scenarios = {
        "bullish": {
            "title": "Kịch Bản Tăng (Bullish Scenario)",
            "model": detected_models[0]["name"] if (detected_models and detected_models[0]["direction"] in ("BUY", "BULLISH")) else "Order Block / FVG Retest + MSS",
            "condition": (
                f"Chờ giá phản ứng tại vùng Cầu / Bullish OB (${bull_zone_ref['bottom']:,.2f} - ${bull_zone_ref['top']:,.2f}) kèm nến rút chân hoặc MSS khung nhỏ."
                if bull_zone_ref else f"Chờ giá quét SSL dưới ${dr['low']:,.2f} hoặc xác nhận MSS tăng vượt EMA 20."
            ),
            "entry": bull_entry,
            "sl": bull_inval,
            "tp1": bull_tp1,
            "tp2": bull_tp2,
            "invalidation": f"Đóng nến {timeframe.upper()} thủng dưới ${bull_inval:,.2f} (Phá vỡ cấu trúc tăng)",
            "expiration": "12 cây nến hoặc khi kết thúc phiên New York"
        },
        "bearish": {
            "title": "Kịch Bản Giảm (Bearish Scenario)",
            "model": detected_models[0]["name"] if (detected_models and detected_models[0]["direction"] in ("SELL", "BEARISH")) else "Supply / Bearish OB Retest + MSS",
            "condition": (
                f"Chờ giá hồi lên kiểm tra vùng Cung / Bearish OB (${bear_zone_ref['bottom']:,.2f} - ${bear_zone_ref['top']:,.2f}) trong vùng Premium và xuất hiện từ chối giá."
                if bear_zone_ref else f"Chờ giá quét BSL trên ${dr['high']:,.2f} rồi đóng nến sập gãy cấu trúc."
            ),
            "entry": bear_entry,
            "sl": bear_inval,
            "tp1": bear_tp1,
            "tp2": bear_tp2,
            "invalidation": f"Đóng nến {timeframe.upper()} vượt trên ${bear_inval:,.2f} (Vô hiệu vùng Cung)",
            "expiration": "12 cây nến hoặc khi kết thúc phiên New York"
        }
    }

    return {
        "models": detected_models,
        "scenarios": scenarios
    }


def build_future_conditional_roadmap(
    df: pd.DataFrame,
    smc: Dict[str, Any],
    ict: Dict[str, Any],
    curr_p: float,
    atr: float,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Xây dựng Bản đồ Kịch bản Tương lai dạng IF-THEN (Cây quyết định BOS / CHoCH / Sweep / POI Retest)
    giúp trader nhìn thấy trước các kèo chờ sẵn và đường đi giá dự phóng.
    """
    tf_label = timeframe.upper()
    is_bull_trend = smc.get("trend") == "bullish"
    ext_swings_raw = smc.get("external_swings", {})
    if isinstance(ext_swings_raw, dict):
        ext_highs = ext_swings_raw.get("highs", [])
        ext_lows = ext_swings_raw.get("lows", [])
    else:
        ext_highs = [s for s in ext_swings_raw if isinstance(s, dict) and s.get("swing_type") == "high"]
        ext_lows = [s for s in ext_swings_raw if isinstance(s, dict) and s.get("swing_type") == "low"]

    # Pick realistic visible structural triggers around current price
    high_candidates = [h["price"] for h in ext_highs if h["price"] > curr_p + 0.35 * atr]
    low_candidates = [l["price"] for l in ext_lows if l["price"] < curr_p - 0.35 * atr]

    res_high = round(min(high_candidates), 2) if high_candidates else round(max(curr_p + 1.3 * atr, float(df['high'].iloc[-20:].max())), 2)
    sup_low = round(max(low_candidates), 2) if low_candidates else round(min(curr_p - 1.3 * atr, float(df['low'].iloc[-20:].min())), 2)

    # Bound triggers so they stay actionable and visible on the chart (never collapse onto curr_p)
    if res_high - curr_p > 4.2 * atr:
        win_h = round(float(df['high'].iloc[-18:].max()), 2)
        res_high = win_h if win_h >= curr_p + 0.4 * atr else round(curr_p + 1.5 * atr, 2)
    if res_high < curr_p + 0.35 * atr:
        res_high = round(curr_p + 1.15 * atr, 2)

    if curr_p - sup_low > 4.2 * atr:
        win_l = round(float(df['low'].iloc[-18:].min()), 2)
        sup_low = win_l if win_l <= curr_p - 0.4 * atr else round(curr_p - 1.5 * atr, 2)
    if sup_low > curr_p - 0.35 * atr:
        sup_low = round(curr_p - 1.15 * atr, 2)

    bos_trigger = res_high if is_bull_trend else sup_low
    choch_trigger = sup_low if is_bull_trend else res_high

    bull_obs = [ob for ob in smc.get("order_blocks", []) if ob["type"] == "bullish"]
    bear_obs = [ob for ob in smc.get("order_blocks", []) if ob["type"] == "bearish"]
    bull_fvgs = [f for f in smc.get("fvg", []) if f["type"] == "bullish"]
    bear_fvgs = [f for f in smc.get("fvg", []) if f["type"] == "bearish"]

    roadmap = []

    # 1. KÈO 1: PHÁ BOS TIẾP DIỄN XU HƯỚNG CHÍNH (BOS Continuation)
    if is_bull_trend:
        retest_e = round(bos_trigger - 0.35 * atr, 2)
        sl = round(retest_e - 1.35 * atr, 2)
        risk = max(abs(retest_e - sl), 0.9 * atr)
        tp1 = round(bos_trigger + 1.4 * risk, 2)
        tp2 = round(bos_trigger + 2.4 * risk, 2)
        roadmap.append({
            "id": "ROADMAP_BOS_CONT",
            "tag": "KÈO 1 • PHÁ BOS TĂNG",
            "title": f"Tiếp diễn Tăng nếu phá BOS trên ${bos_trigger:,.2f}",
            "direction": "BUY",
            "trigger_type": "BOS",
            "trigger_price": bos_trigger,
            "condition": f"NẾU nến {tf_label} đóng thân vượt đỉnh ${bos_trigger:,.2f} (xác nhận BOS Tăng) ➔ Giá thường hồi nhẹ test lại vùng FVG/OB mới quanh ${retest_e:,.2f} rồi tăng tiếp.",
            "entry": retest_e,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((tp2 - retest_e) / risk, 2),
            "invalidation": f"Đóng nến thủng ngược dưới ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 2.5, "price": bos_trigger, "label": f"Phá BOS ${bos_trigger:,.0f}"},
                {"slot": 5.0, "price": retest_e, "label": "Hồi test Entry"},
                {"slot": 8.0, "price": tp1, "label": "TP1"},
                {"slot": 10.5, "price": tp2, "label": "TP2"}
            ]
        })
    else:
        retest_e = round(bos_trigger + 0.35 * atr, 2)
        sl = round(retest_e + 1.35 * atr, 2)
        risk = max(abs(sl - retest_e), 0.9 * atr)
        tp1 = round(bos_trigger - 1.4 * risk, 2)
        tp2 = round(bos_trigger - 2.4 * risk, 2)
        roadmap.append({
            "id": "ROADMAP_BOS_CONT",
            "tag": "KÈO 1 • PHÁ BOS GIẢM",
            "title": f"Tiếp diễn Giảm nếu phá BOS dưới ${bos_trigger:,.2f}",
            "direction": "SELL",
            "trigger_type": "BOS",
            "trigger_price": bos_trigger,
            "condition": f"NẾU nến {tf_label} đóng thân thủng đáy ${bos_trigger:,.2f} (xác nhận BOS Giảm) ➔ Canh giá hồi nhẹ lên vùng Supply/FVG quanh ${retest_e:,.2f} để BÁN tiếp diễn.",
            "entry": retest_e,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((retest_e - tp2) / risk, 2),
            "invalidation": f"Đóng nến vượt ngược lên trên ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 2.5, "price": bos_trigger, "label": f"Phá BOS ${bos_trigger:,.0f}"},
                {"slot": 5.0, "price": retest_e, "label": "Hồi test Entry"},
                {"slot": 8.0, "price": tp1, "label": "TP1"},
                {"slot": 10.5, "price": tp2, "label": "TP2"}
            ]
        })

    # 2. KÈO 2: ĐẢO CHIỀU CẤU TRÚC CHOCH / MSS (Kịch bản quay xe ngược xu hướng)
    if not is_bull_trend:
        retest_e = round(choch_trigger - 0.35 * atr, 2)
        sl = round(retest_e - 1.35 * atr, 2)
        risk = max(abs(retest_e - sl), 0.9 * atr)
        tp1 = round(choch_trigger + 1.4 * risk, 2)
        tp2 = round(choch_trigger + 2.4 * risk, 2)
        roadmap.append({
            "id": "ROADMAP_CHOCH_REV",
            "tag": "KÈO 2 • ĐẢO CHIỀU CHoCH TĂNG",
            "title": f"Đổi chiều Đánh Lên nếu phá CHoCH trên ${choch_trigger:,.2f}",
            "direction": "BUY",
            "trigger_type": "CHoCH",
            "trigger_price": choch_trigger,
            "condition": f"NẾU giá không phá được đáy mà bật vượt đóng nến qua đỉnh ${choch_trigger:,.2f} (xác nhận CHoCH / MSS Tăng) ➔ Bỏ phe Bán, canh hồi về Bullish OB quanh ${retest_e:,.2f} để MUA LÊN.",
            "entry": retest_e,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((tp2 - retest_e) / risk, 2),
            "invalidation": f"Giá sập lại thủng dưới ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 2.8, "price": choch_trigger, "label": f"CHoCH ${choch_trigger:,.0f}"},
                {"slot": 5.3, "price": retest_e, "label": "Hồi mua OTE"},
                {"slot": 8.2, "price": tp1, "label": "TP1"},
                {"slot": 10.5, "price": tp2, "label": "TP2"}
            ]
        })
    else:
        retest_e = round(choch_trigger + 0.35 * atr, 2)
        sl = round(retest_e + 1.35 * atr, 2)
        risk = max(abs(sl - retest_e), 0.9 * atr)
        tp1 = round(choch_trigger - 1.4 * risk, 2)
        tp2 = round(choch_trigger - 2.4 * risk, 2)
        roadmap.append({
            "id": "ROADMAP_CHOCH_REV",
            "tag": "KÈO 2 • ĐẢO CHIỀU CHoCH GIẢM",
            "title": f"Đổi chiều Đánh Xuống nếu phá CHoCH dưới ${choch_trigger:,.2f}",
            "direction": "SELL",
            "trigger_type": "CHoCH",
            "trigger_price": choch_trigger,
            "condition": f"NẾU giá quay đầu đóng nến thủng đáy ${choch_trigger:,.2f} (xác nhận CHoCH / MSS Giảm) ➔ Bỏ phe Mua, canh hồi lên Bearish OB quanh ${retest_e:,.2f} để BÁN XUỐNG.",
            "entry": retest_e,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((retest_e - tp2) / risk, 2),
            "invalidation": f"Giá bật ngược đóng nến trên ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 2.8, "price": choch_trigger, "label": f"CHoCH ${choch_trigger:,.0f}"},
                {"slot": 5.3, "price": retest_e, "label": "Hồi bán OTE"},
                {"slot": 8.2, "price": tp1, "label": "TP1"},
                {"slot": 10.5, "price": tp2, "label": "TP2"}
            ]
        })

    # 3. KÈO 3: BẪY QUÉT THANH KHOẢN RÚT RÂU (Liquidity Sweep Trap / False Breakout)
    if not is_bull_trend:
        sweep_wick = round(sup_low - 0.35 * atr, 2)
        trap_entry = round(sup_low + 0.2 * atr, 2)
        sl = round(sweep_wick - 0.9 * atr, 2)
        risk = max(abs(trap_entry - sl), 0.8 * atr)
        tp1 = round(trap_entry + 1.6 * risk, 2)
        tp2 = round(min(res_high, trap_entry + 2.6 * risk), 2)
        roadmap.append({
            "id": "ROADMAP_SWEEP_TRAP",
            "tag": "KÈO 3 • BẪY QUÉT RÂU SSL",
            "title": f"Bắt Đảo Chiều nếu chọc râu quét ${sup_low:,.2f} rồi rút lên",
            "direction": "BUY",
            "trigger_type": "SWEEP",
            "trigger_price": sup_low,
            "condition": f"NẾU giá chọc râu xuống dưới ${sup_low:,.2f} quét Stop-Loss nhưng KHÔNG đóng thân nến qua (rút chân Pin Bar/Engulfing) ➔ Bẫy giảm (Bear Trap), canh MUA hồi lên ${tp1:,.2f}.",
            "entry": trap_entry,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((tp2 - trap_entry) / risk, 2),
            "invalidation": f"Nến {tf_label} đóng thân đặc dưới ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 2.2, "price": sweep_wick, "label": "Quét râu SSL"},
                {"slot": 4.2, "price": trap_entry, "label": "Rút chân Entry"},
                {"slot": 8.5, "price": tp1, "label": "TP1"}
            ]
        })
    else:
        sweep_wick = round(res_high + 0.35 * atr, 2)
        trap_entry = round(res_high - 0.2 * atr, 2)
        sl = round(sweep_wick + 0.9 * atr, 2)
        risk = max(abs(sl - trap_entry), 0.8 * atr)
        tp1 = round(trap_entry - 1.6 * risk, 2)
        tp2 = round(max(sup_low, trap_entry - 2.6 * risk), 2)
        roadmap.append({
            "id": "ROADMAP_SWEEP_TRAP",
            "tag": "KÈO 3 • BẪY QUÉT RÂU BSL",
            "title": f"Bắt Đảo Chiều nếu chọc râu quét ${res_high:,.2f} rồi xả",
            "direction": "SELL",
            "trigger_type": "SWEEP",
            "trigger_price": res_high,
            "condition": f"NẾU giá chọc râu vượt đỉnh ${res_high:,.2f} quét thanh khoản Mua rồi đóng nến rụt đầu mạnh (Bull Trap) ➔ Canh BÁN ăn nhịp điều chỉnh về ${tp1:,.2f}.",
            "entry": trap_entry,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((trap_entry - tp2) / risk, 2),
            "invalidation": f"Nến {tf_label} đóng thân đặc vượt trên ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 2.2, "price": sweep_wick, "label": "Quét râu BSL"},
                {"slot": 4.2, "price": trap_entry, "label": "Rút đầu Entry"},
                {"slot": 8.5, "price": tp1, "label": "TP1"}
            ]
        })

    # 4. KÈO 4: CANH RETEST VÙNG OB / FVG THUẬN CẤU TRÚC HIỆN TẠI (CHỈ CHỌN ĐÚNG PHÍA HỒI)
    bull_pois_below = [z for z in (bull_obs + bull_fvgs) if z["top"] <= curr_p - 0.1 * atr]
    bear_pois_above = [z for z in (bear_obs + bear_fvgs) if z["bottom"] >= curr_p + 0.1 * atr]
    if is_bull_trend:
        zone = max(bull_pois_below, key=lambda z: z["top"]) if bull_pois_below else None
        z_top = zone["top"] if zone else round(curr_p - 0.65 * atr, 2)
        z_bot = zone["bottom"] if zone else round(curr_p - 1.45 * atr, 2)
        sl = round(z_bot - 0.5 * atr, 2)
        risk = max(abs(z_top - sl), 0.85 * atr)
        tp1 = round(z_top + 1.6 * risk, 2)
        tp2 = round(z_top + 2.5 * risk, 2)
        roadmap.append({
            "id": "ROADMAP_POI_RETEST",
            "tag": "KÈO 4 • CANH RETEST CẦU / OB",
            "title": f"Đợi hồi chạm Bullish OB/FVG (${z_bot:,.2f} - ${z_top:,.2f})",
            "direction": "BUY",
            "trigger_type": "POI",
            "trigger_price": round(z_top, 2),
            "condition": f"Không FOMO đuổi giá: NẾU giá lùi về vùng cầu ${z_bot:,.2f} - ${z_top:,.2f} kèm nến từ chối ➔ Vào MUA thuận sóng với SL cực ngắn.",
            "entry": round(z_top, 2),
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((tp2 - z_top) / risk, 2),
            "invalidation": f"Đóng nến thủng vùng cầu ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 3.0, "price": round(z_top, 2), "label": "Chạm Cầu/OB"},
                {"slot": 7.0, "price": tp1, "label": "TP1"},
                {"slot": 10.0, "price": tp2, "label": "TP2"}
            ]
        })
    else:
        zone = min(bear_pois_above, key=lambda z: z["bottom"]) if bear_pois_above else None
        z_bot = zone["bottom"] if zone else round(curr_p + 0.65 * atr, 2)
        z_top = zone["top"] if zone else round(curr_p + 1.45 * atr, 2)
        sl = round(z_top + 0.5 * atr, 2)
        risk = max(abs(sl - z_bot), 0.85 * atr)
        tp1 = round(z_bot - 1.6 * risk, 2)
        tp2 = round(z_bot - 2.5 * risk, 2)
        roadmap.append({
            "id": "ROADMAP_POI_RETEST",
            "tag": "KÈO 4 • CANH RETEST CUNG / OB",
            "title": f"Đợi hồi lên Bearish OB/FVG (${z_bot:,.2f} - ${z_top:,.2f})",
            "direction": "SELL",
            "trigger_type": "POI",
            "trigger_price": round(z_bot, 2),
            "condition": f"Không FOMO bán đuổi: NẾU giá nảy hồi lên vùng cung ${z_bot:,.2f} - ${z_top:,.2f} và rút râu ➔ Vào BÁN thuận xu hướng giảm.",
            "entry": round(z_bot, 2),
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "rr": round((z_bot - tp2) / risk, 2),
            "invalidation": f"Đóng nến vượt vùng cung ${sl:,.2f}",
            "path_points": [
                {"slot": 0, "price": round(curr_p, 2), "label": "Hiện tại"},
                {"slot": 3.0, "price": round(z_bot, 2), "label": "Chạm Cung/OB"},
                {"slot": 7.0, "price": tp1, "label": "TP1"},
                {"slot": 10.0, "price": tp2, "label": "TP2"}
            ]
        })

    return roadmap


def merge_confluence_zones(smc: Dict[str, Any], sd_zones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Anti-Clutter Rule: Merge overlapping FVG, Order Blocks, and Supply/Demand zones
    into high-probability Confluence Zones and create an inspectable interactive catalog.
    """
    inspectable_items = []

    for ob in smc["order_blocks"]:
        inspectable_items.append({
            "id": ob["id"],
            "category": "order_blocks",
            "title": f"{'Bullish' if ob['type'] == 'bullish' else 'Bearish'} Order Block",
            "direction": ob["type"],
            "index": ob["index"],
            "top": ob["top"],
            "bottom": ob["bottom"],
            "detail": ob["causal_desc"]
        })

    for bb in smc["breaker_blocks"]:
        inspectable_items.append({
            "id": bb["id"],
            "category": "order_blocks",
            "title": f"{'Bullish' if bb['type'] == 'bullish' else 'Bearish'} Breaker Block",
            "direction": bb["type"],
            "index": bb["index"],
            "top": bb["top"],
            "bottom": bb["bottom"],
            "detail": bb["causal_desc"]
        })

    for fvg in smc["fvg"]:
        inspectable_items.append({
            "id": fvg["id"],
            "category": "imbalance",
            "title": f"{'Bullish' if fvg['type'] == 'bullish' else 'Bearish'} FVG",
            "direction": fvg["type"],
            "index": fvg["index"],
            "top": fvg["top"],
            "bottom": fvg["bottom"],
            "detail": fvg["causal_desc"]
        })

    for bpr in smc["bpr"]:
        inspectable_items.append({
            "id": bpr["id"],
            "category": "imbalance",
            "title": "Balanced Price Range (BPR)",
            "direction": bpr["type"],
            "index": bpr["index"],
            "top": bpr["top"],
            "bottom": bpr["bottom"],
            "detail": bpr["causal_desc"]
        })

    for sd in sd_zones:
        inspectable_items.append({
            "id": sd["id"],
            "category": "supply_demand",
            "title": f"{sd['pattern']} ({sd['quality_score']}đ)",
            "direction": "bullish" if sd["type"] == "demand" else "bearish",
            "index": sd["index"],
            "top": sd["top"],
            "bottom": sd["bottom"],
            "detail": sd["causal_desc"]
        })

    # Detect overlapping OB + FVG confluences
    confluence_zones = []
    for ob in smc["order_blocks"]:
        for fvg in smc["fvg"]:
            if ob["type"] == fvg["type"]:
                ov_top = min(ob["top"], fvg["top"])
                ov_bot = max(ob["bottom"], fvg["bottom"])
                if ov_top >= ov_bot - 1.5:
                    c_top = max(ob["top"], fvg["top"])
                    c_bot = min(ob["bottom"], fvg["bottom"])
                    confluence_zones.append({
                        "id": f"CONF_{ob['id']}_{fvg['id']}",
                        "type": ob["type"],
                        "top": c_top,
                        "bottom": c_bot,
                        "index": min(ob["index"], fvg["index"]),
                        "desc": f"Vùng Hợp Lưu Cực Mạnh ({ob['type'].upper()} OB + FVG): ${c_bot:,.2f} - ${c_top:,.2f}"
                    })

    return {
        "inspectable": inspectable_items,
        "confluences": confluence_zones[-4:]
    }


def generate_gold_trade_signal(
    df: pd.DataFrame,
    symbol: str = "PAXG/USDT",
    timeframe: str = "1h",
    orderbook_info: Optional[Dict[str, Any]] = None,
    htf_bias: Optional[str] = None,
    mtf_matrix: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Master Pipeline: Runs all 7 pillars (SMC, ICT, Price Action, Supply/Demand,
    Quantitative/Volume Profile, Entry Models, Multi-Timeframe Matrix) and outputs
    both clean chart data and full inspectable causal intelligence.
    """
    is_fallback = bool(getattr(df, "attrs", {}).get("is_fallback", False))
    data_source = str(getattr(df, "attrs", {}).get("data_source", "LIVE"))
    df = calculate_indicators(df)
    ext_swings = detect_swings_and_labels(df, window=4, structure_layer="external")
    int_swings = detect_swings_and_labels(df, window=2, structure_layer="internal")
    smc = detect_smc_full_suite(df, ext_swings, int_swings)
    ict = analyze_ict_time_and_liquidity(df)
    sd_zones = detect_supply_demand_zones(df, smc)
    vol_profile = compute_volume_profile(df, bins=24)
    regime = analyze_market_regime(df)
    order_flow = analyze_order_flow_footprints(df, orderbook_info, symbol=symbol)
    patterns = detect_candlestick_patterns(df)
    divergence = detect_rsi_divergence(df, ext_swings)
    models_and_scenarios = evaluate_entry_models_and_scenarios(df, smc, ict, sd_zones, patterns, timeframe)
    merged_zones = merge_confluence_zones(smc, sd_zones)

    latest = df.iloc[-1]
    current_price = float(latest['close'])
    atr = float(latest['atr'])
    rsi = float(latest['rsi'])
    ema20 = float(latest['ema_20'])
    ema50 = float(latest['ema_50'])
    ema200 = float(latest['ema_200'])
    vwap = float(latest['vwap'])
    bb_upper = float(latest['bb_upper'])
    bb_lower = float(latest['bb_lower'])
    std_dev = float(latest['std_dev'])
    chandelier_long = float(latest['chandelier_long'])
    chandelier_short = float(latest['chandelier_short'])

    # Nearest Directional Order Blocks / FVG (strictly on the right side of price!)
    bullish_obs_below = [ob for ob in smc["order_blocks"] if ob["type"] == "bullish" and ob["top"] <= current_price + 0.15 * atr]
    bearish_obs_above = [ob for ob in smc["order_blocks"] if ob["type"] == "bearish" and ob["bottom"] >= current_price - 0.15 * atr]
    bullish_fvgs_below = [f for f in smc["fvg"] if f["type"] == "bullish" and f["top"] <= current_price + 0.15 * atr]
    bearish_fvgs_above = [f for f in smc["fvg"] if f["type"] == "bearish" and f["bottom"] >= current_price - 0.15 * atr]

    nearest_bullish_ob = (
        max(bullish_obs_below, key=lambda z: z["top"])
        if bullish_obs_below
        else (max(bullish_fvgs_below, key=lambda z: z["top"]) if bullish_fvgs_below else None)
    )
    nearest_bearish_ob = (
        min(bearish_obs_above, key=lambda z: z["bottom"])
        if bearish_obs_above
        else (min(bearish_fvgs_above, key=lambda z: z["bottom"]) if bearish_fvgs_above else None)
    )

    # Scoring & Confluence
    buy_score = 0
    sell_score = 0
    confluence_reasons = []
    is_trending = (regime["code"] == "STRONG_TREND")
    is_sideway = (regime["code"] == "SIDEWAY_RANGE")

    if is_fallback:
        confluence_reasons.append("⚠️ CẢNH BÁO: Mất kết nối API sàn — Đang hiển thị dữ liệu giả lập offline, KHÔNG vào lệnh!")

    # 1. Trend & EMA Alignment (skip trend-EMA bonus in dead sideways chop)
    if not is_sideway:
        if current_price > ema20 > ema50:
            buy_score += (26 if is_trending else 16)
            confluence_reasons.append(f"[{regime['name']}] Giá > EMA 20 > EMA 50 (Xu hướng tăng)")
        elif current_price < ema20 < ema50:
            sell_score += (26 if is_trending else 16)
            confluence_reasons.append(f"[{regime['name']}] Giá < EMA 20 < EMA 50 (Xu hướng giảm)")
    else:
        confluence_reasons.append(f"⚠️ Thị trường đi ngang (ADX {regime['adx']} < 20) — Hạn chế vào giữa biên độ, chỉ săn Sweep 2 đầu.")

    # 1b. Chronological SMC Structure & HTF MTF Confluence (D1 + H4)
    if smc["trend"] == "bullish":
        buy_score += 18
    elif smc["trend"] == "bearish":
        sell_score += 18

    htf_bull_cnt = 0
    htf_bear_cnt = 0
    if mtf_matrix:
        for row in mtf_matrix:
            if row.get("tf") in ("D1", "H4"):
                b = str(row.get("bias", "NEUTRAL")).upper()
                if b == "BULLISH":
                    htf_bull_cnt += 1
                elif b == "BEARISH":
                    htf_bear_cnt += 1
    elif htf_bias:
        hb = str(htf_bias).upper()
        if hb == "BULLISH":
            htf_bull_cnt = 1
        elif hb == "BEARISH":
            htf_bear_cnt = 1

    if htf_bull_cnt == 2 and htf_bear_cnt == 0:
        buy_score += 20
        confluence_reasons.append("🌐 Đa khung D1 & H4 đồng thuận TĂNG (HTF Bullish)")
    elif htf_bear_cnt == 2 and htf_bull_cnt == 0:
        sell_score += 20
        confluence_reasons.append("🌐 Đa khung D1 & H4 đồng thuận GIẢM (HTF Bearish)")
    elif htf_bull_cnt >= 1 and htf_bear_cnt == 0:
        buy_score += 10
    elif htf_bear_cnt >= 1 and htf_bull_cnt == 0:
        sell_score += 10

    if htf_bear_cnt >= 2:
        buy_score = max(0, buy_score - 18)
        confluence_reasons.append("⚠️ Cảnh báo ngược xu hướng lớn D1 & H4 (đang Giảm) nếu canh MUA")
    if htf_bull_cnt >= 2:
        sell_score = max(0, sell_score - 18)
        confluence_reasons.append("⚠️ Cảnh báo ngược xu hướng lớn D1 & H4 (đang Tăng) nếu canh BÁN")

    # 2. Dealing Range Premium / Discount & OTE
    dr = smc["dealing_range"]
    if dr["is_discount"]:
        buy_score += 15
        confluence_reasons.append(f"Vị trí giá: Vùng DISCOUNT ({dr['current_pct']}% < 50% Equilibrium ${dr['equilibrium']:,.2f})")
    else:
        sell_score += 15
        confluence_reasons.append(f"Vị trí giá: Vùng PREMIUM ({dr['current_pct']}% > 50% Equilibrium ${dr['equilibrium']:,.2f})")

    if dr["ote"]["bottom"] <= current_price <= dr["ote"]["top"]:
        if dr["ote"]["direction"] == "bullish":
            buy_score += 18
            confluence_reasons.append(dr["ote"]["desc"])
        else:
            sell_score += 18
            confluence_reasons.append(dr["ote"]["desc"])

    # 3. Valid Liquidity Sweep (non-invalidated only!)
    recent_sweeps = [s for s in smc["sweeps"] if s.get("is_recent") and not s.get("invalidated")]
    if recent_sweeps:
        sw = recent_sweeps[-1]
        if sw["type"] == "bullish":
            buy_score += 28
            confluence_reasons.append(f"⚡ {sw['name']} tại ${sw['swept_level']:,.2f}")
        else:
            sell_score += 28
            confluence_reasons.append(f"⚡ {sw['name']} tại ${sw['swept_level']:,.2f}")

    # 4. Order Blocks & Supply/Demand (proximity gated)
    if nearest_bullish_ob and abs(current_price - nearest_bullish_ob["top"]) <= 2.8 * atr:
        buy_score += 20
        confluence_reasons.append(nearest_bullish_ob["causal_desc"])
    if nearest_bearish_ob and abs(nearest_bearish_ob["bottom"] - current_price) <= 2.8 * atr:
        sell_score += 20
        confluence_reasons.append(nearest_bearish_ob["causal_desc"])

    # 5. ICT AMD / Judas Swing & Killzone
    if ict["judas_swing"]:
        if "Bullish" in ict["judas_swing"]:
            buy_score += 18
            confluence_reasons.append(f"🕒 ICT AMD: {ict['judas_swing']}")
        else:
            sell_score += 18
            confluence_reasons.append(f"🕒 ICT AMD: {ict['judas_swing']}")

    # 6. Order Flow & Volume Profile POC (only count orderbook if live!)
    if current_price >= vol_profile["poc"]:
        buy_score += 8
        confluence_reasons.append(f"Giá giữ trên Volume Profile POC (${vol_profile['poc']:,.2f})")
    else:
        sell_score += 8
        confluence_reasons.append(f"Giá nằm dưới Volume Profile POC (${vol_profile['poc']:,.2f})")

    ob_available = bool(orderbook_info is None or orderbook_info.get("available", True))
    if ob_available:
        if order_flow["buy_delta_pct"] >= 56:
            buy_score += 12
            confluence_reasons.append(f"Order Flow Mua chủ động chiếm {order_flow['buy_delta_pct']}%")
        elif order_flow["sell_delta_pct"] >= 56:
            sell_score += 12
            confluence_reasons.append(f"Order Flow Bán chủ động chiếm {order_flow['sell_delta_pct']}%")

    # 7. Price Action & Divergence & RSI Exhaustion
    for p in patterns:
        if p["type"] == "bullish":
            buy_score += 14
            confluence_reasons.append(f"Price Action: {p['name']}")
        elif p["type"] == "bearish":
            sell_score += 14
            confluence_reasons.append(f"Price Action: {p['name']}")

    if divergence:
        if divergence["type"] == "bullish":
            buy_score += 20
            confluence_reasons.append(divergence["name"])
        else:
            sell_score += 20
            confluence_reasons.append(divergence["name"])

    # Honest Net-Edge Confidence (conflicting buy & sell scores lower confidence!)
    dominant_score = max(buy_score, sell_score)
    net_edge = abs(buy_score - sell_score)
    fighting_htf = (buy_score > sell_score and htf_bear_cnt >= 2) or (sell_score > buy_score and htf_bull_cnt >= 2)

    if is_fallback:
        confidence_pct = 0
    else:
        conf_raw = 36.0 + (net_edge * 0.58) + (dominant_score * 0.16)
        if is_sideway:
            conf_raw -= 10.0
        if fighting_htf:
            conf_raw -= 12.0
        confidence_pct = int(min(94, max(35, round(conf_raw))))

    recent_swing_high = smc["recent_high"]["price"] if smc["recent_high"] else current_price + 2 * atr
    recent_swing_low = smc["recent_low"]["price"] if smc["recent_low"] else current_price - 2 * atr

    pos_pct = float(dr.get("current_pct", 50.0))
    min_edge_req = 22 if (is_sideway or fighting_htf) else 16
    min_dom_req = 56 if is_sideway else 46
    sideway_bull_ok = (not is_sideway) or any(s["type"] == "bullish" for s in recent_sweeps) or any(p["type"] == "bullish" for p in patterns)
    sideway_bear_ok = (not is_sideway) or any(s["type"] == "bearish" for s in recent_sweeps) or any(p["type"] == "bearish" for p in patterns)

    preferred_wait_dir = smc["trend"] if smc["trend"] in ("bullish", "bearish") else ("bullish" if buy_score >= sell_score else "bearish")

    # Identify structural obstacles between entry and TP1 before greenlighting Market Entry
    bull_barriers = [z["bottom"] for z in smc["order_blocks"] if z["type"] == "bearish" and z["bottom"] > current_price + 0.15 * atr]
    bull_barriers += [h["price"] for h in ext_swings["highs"][-6:] if h["price"] > current_price + 0.25 * atr]
    nearest_res_barrier = min(bull_barriers) if bull_barriers else None

    bear_barriers = [z["top"] for z in smc["order_blocks"] if z["type"] == "bullish" and z["top"] < current_price - 0.15 * atr]
    bear_barriers += [l["price"] for l in ext_swings["lows"][-6:] if l["price"] < current_price - 0.25 * atr]
    nearest_sup_barrier = max(bear_barriers) if bear_barriers else None

    blocked_reason = None

    if (
        not is_fallback
        and buy_score >= min_dom_req
        and (buy_score - sell_score) >= min_edge_req
        and pos_pct <= 62.0
        and rsi < 72.0
        and sideway_bull_ok
    ):
        action = "BUY"
        entry_price = round(current_price, 2)
        local_low = float(df['low'].iloc[-8:].min())
        inval_point = local_low
        if nearest_bullish_ob and abs(entry_price - nearest_bullish_ob["bottom"]) <= 2.0 * atr:
            inval_point = min(inval_point, nearest_bullish_ob["bottom"])
        raw_dist = (entry_price - inval_point) + (0.4 * atr)
        risk_dist = min(max(raw_dist, 1.0 * atr), 2.1 * atr)
        if nearest_res_barrier is not None and (nearest_res_barrier - entry_price) < 1.05 * risk_dist:
            blocked_reason = f"⚠️ Cản kháng cự ngay trên đầu (${nearest_res_barrier:,.2f}) làm R:R thực tế < 1.1:1 — Không vào đuổi!"
        else:
            sl_price = round(entry_price - risk_dist, 2)
            tp1_price = round(entry_price + 1.6 * risk_dist, 2)
            tp2_price = round(entry_price + 2.5 * risk_dist, 2)
            tp3_price = round(entry_price + 3.5 * risk_dist, 2)
            rr_ratio = round((tp2_price - entry_price) / max(risk_dist, 0.01), 2)

    elif (
        not is_fallback
        and sell_score >= min_dom_req
        and (sell_score - buy_score) >= min_edge_req
        and pos_pct >= 38.0
        and rsi > 28.0
        and sideway_bear_ok
    ):
        action = "SELL"
        entry_price = round(current_price, 2)
        local_high = float(df['high'].iloc[-8:].max())
        inval_point = local_high
        if nearest_bearish_ob and abs(nearest_bearish_ob["top"] - entry_price) <= 2.0 * atr:
            inval_point = max(inval_point, nearest_bearish_ob["top"])
        raw_dist = (inval_point - entry_price) + (0.4 * atr)
        risk_dist = min(max(raw_dist, 1.0 * atr), 2.1 * atr)
        if nearest_sup_barrier is not None and (entry_price - nearest_sup_barrier) < 1.05 * risk_dist:
            blocked_reason = f"⚠️ Đỡ hỗ trợ ngay dưới chân (${nearest_sup_barrier:,.2f}) làm R:R thực tế < 1.1:1 — Không bán đâm đầu vào hỗ trợ!"
        else:
            sl_price = round(entry_price + risk_dist, 2)
            tp1_price = round(entry_price - 1.6 * risk_dist, 2)
            tp2_price = round(entry_price - 2.5 * risk_dist, 2)
            tp3_price = round(entry_price - 3.5 * risk_dist, 2)
            rr_ratio = round((entry_price - tp2_price) / max(risk_dist, 0.01), 2)
    else:
        action = "WAIT"

    if action == "WAIT":
        if blocked_reason:
            confluence_reasons.insert(0, blocked_reason)
        if not is_fallback and ((smc["trend"] == "bearish" and pos_pct < 38.0) or rsi <= 28.0):
            confluence_reasons.insert(0, f"🛡️ Chống bán đuổi đáy (Vị trí {pos_pct}% | RSI {rsi:.1f}) — Đợi hồi lên vùng Cung/OB mới canh Bán!")
        elif not is_fallback and ((smc["trend"] == "bullish" and pos_pct > 62.0) or rsi >= 72.0):
            confluence_reasons.insert(0, f"🛡️ Chống mua đuổi đỉnh (Vị trí {pos_pct}% | RSI {rsi:.1f}) — Đợi hồi về vùng Cầu/OB mới canh Mua!")

        if preferred_wait_dir == "bearish":
            target_pull = nearest_bearish_ob["bottom"] if nearest_bearish_ob else (current_price + 1.15 * atr)
            entry_price = round(min(max(target_pull, current_price + 0.65 * atr), current_price + 2.1 * atr), 2)
            risk_dist = round(1.45 * atr, 2)
            sl_price = round(entry_price + risk_dist, 2)
            tp1_price = round(entry_price - 1.6 * risk_dist, 2)
            tp2_price = round(entry_price - 2.5 * risk_dist, 2)
            tp3_price = round(entry_price - 3.5 * risk_dist, 2)
        else:
            target_pull = nearest_bullish_ob["top"] if nearest_bullish_ob else (current_price - 1.15 * atr)
            entry_price = round(max(min(target_pull, current_price - 0.65 * atr), current_price - 2.1 * atr), 2)
            risk_dist = round(1.45 * atr, 2)
            sl_price = round(entry_price - risk_dist, 2)
            tp1_price = round(entry_price + 1.6 * risk_dist, 2)
            tp2_price = round(entry_price + 2.5 * risk_dist, 2)
            tp3_price = round(entry_price + 3.5 * risk_dist, 2)
        rr_ratio = round(abs(tp2_price - entry_price) / max(risk_dist, 0.01), 2)

    sl_distance = abs(round(entry_price - sl_price, 2))
    sl_percent = round((sl_distance / entry_price) * 100, 2)
    trailing_stop_ref = round(chandelier_long if (action == "BUY" or (action == "WAIT" and preferred_wait_dir == "bullish")) else chandelier_short, 2)

    active_model_name = (
        models_and_scenarios["models"][0]["name"]
        if models_and_scenarios["models"]
        else ("Order Block Retest + SMC" if action != "WAIT" else "WAIT - Chờ hồi POI / Xác nhận MSS")
    )

    # Causal Narrative Summary
    causal_events_log = []
    for sw in smc["sweeps"][-3:]:
        causal_events_log.append({"type": "SWEEP", "index": sw["index"], "text": sw["desc"]})
    for ev in smc["structure_events"][-4:]:
        causal_events_log.append({"type": ev["event"], "index": ev["index"], "text": ev["causal_desc"]})
    for ob in smc["order_blocks"][-3:]:
        causal_events_log.append({"type": "OB", "index": ob["index"], "text": ob["causal_desc"]})
    causal_events_log.sort(key=lambda x: x["index"], reverse=True)

    if is_fallback:
        entry_reason_txt = "⚠️ DỮ LIỆU GIẢ LẬP OFFLINE — Tuyệt đối không dùng thông số này để vào lệnh thật!"
    elif action == "WAIT":
        entry_reason_txt = (
            f"⏳ WAIT (CHƯA VÀO NGAY) — Không đuổi giá tại ${current_price:,.2f} ({dr['zone_status']}). "
            f"Kịch bản Limit chờ hồi về ${entry_price:,.2f} hoặc theo dõi 4 Kèo Tương Lai."
        )
    else:
        entry_reason_txt = f"[{active_model_name}] Vào lệnh {action} tại ${entry_price:,.2f}. Vị trí hiện tại: {dr['zone_status']}."

    trading_plan_vi = {
        "market_bias": f"{smc['trend'].upper()} | {regime['name']}",
        "active_model": active_model_name,
        "entry_reason": entry_reason_txt,
        "sl_reason": f"Stop Loss tại ${sl_price:,.2f} (-${sl_distance:.2f} ~ {sl_percent}%), đặt sau vùng Invalidation + đệm ATR. Chandelier Stop: ${trailing_stop_ref:,.2f}.",
        "tp_reason": f"TP1: ${tp1_price:,.2f} (1.6R - Chốt 50% & dời SL về BE), TP2: ${tp2_price:,.2f} (R:R 1:{rr_ratio} - Thanh khoản đối diện), TP3: ${tp3_price:,.2f}.",
        "risk_management": "Quản lý vốn cố định 1-2% rủi ro/lệnh. Chỉ vào lệnh khi giá nằm đúng vùng Discount (cho BUY) hoặc Premium (cho SELL) kèm xác nhận cấu trúc.",
        "confluence_list": confluence_reasons[:7]
    }

    future_roadmap = build_future_conditional_roadmap(df, smc, ict, current_price, atr, timeframe)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "is_fallback": is_fallback,
        "data_source": data_source,
        "current_price": current_price,
        "action": action,
        "confidence": confidence_pct,
        "buy_score": buy_score,
        "sell_score": sell_score,
        "net_edge": net_edge,
        "entry": entry_price,
        "sl": sl_price,
        "sl_distance": sl_distance,
        "sl_percent": sl_percent,
        "tp1": tp1_price,
        "tp2": tp2_price,
        "tp3": tp3_price,
        "rr_ratio": rr_ratio,
        "reasons": confluence_reasons,
        "atr": round(atr, 2),
        "rsi": round(rsi, 2),
        "adx": regime["adx"],
        "std_dev": round(std_dev, 2),
        "vwap": round(vwap, 2),
        "bb_upper": round(bb_upper, 2),
        "bb_lower": round(bb_lower, 2),
        "ema20": round(ema20, 2),
        "ema50": round(ema50, 2),
        "ema200": round(ema200, 2),
        "chandelier_stop": trailing_stop_ref,
        "structure": smc["trend"],
        "regime": regime,
        "order_flow": order_flow,
        "volume_profile": vol_profile,
        "ict": ict,
        "supply_demand": sd_zones,
        "entry_models": models_and_scenarios["models"],
        "scenarios": models_and_scenarios["scenarios"],
        "future_roadmap": future_roadmap,
        "causal_chain": causal_events_log[:8],
        "inspectable_zones": merged_zones["inspectable"],
        "confluence_zones": merged_zones["confluences"],
        "sweeps": smc["sweeps"],
        "htf_bias": htf_bias or smc["trend"].upper(),
        "mtf_matrix": mtf_matrix or [],
        "order_blocks_count": len(smc["order_blocks"]),
        "fvg_count": len(smc["fvg"]),
        "patterns": patterns,
        "divergence": divergence["name"] if divergence else None,
        "trading_plan": trading_plan_vi,
        "df": df,
        "smc": smc
    }
