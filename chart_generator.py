"""
High-Resolution Chart Image Generator for XAUUSD & Digital Gold Analysis.
Supports 3 Display Modes (Clean Chart, SMC Analysis, Full Analysis) and 8 Modular Layers:
1. structure (HH/HL/LH/LL, BOS, CHoCH, MSS)
2. liquidity (BSL/SSL Sweeps, EQH/EQL, IDM, PDH/PDL, PWH/PWL)
3. order_blocks (Bullish/Bearish OB, Breaker Block)
4. imbalance (FVG, IFVG, BPR)
5. supply_demand (RBR, DBD, RBD, DBR Supply & Demand Zones)
6. ict (Premium/Discount Equilibrium, OTE 0.618-0.786, Asian Range, AMD / Killzone HUD)
7. price_action (Pin Bar, Engulfing, Inside/Outside, Momentum tags)
8. indicators (EMA 20/50/200, VWAP, Bollinger Bands, Volume Profile POC/VAH/VAL)
"""

import os
import io
import glob
import time
import base64

_MPL_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".mplcache")
os.makedirs(_MPL_CACHE, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", _MPL_CACHE)

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.gridspec import GridSpec
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional

matplotlib.rcParams['font.sans-serif'] = ['Segoe UI', 'Arial', 'DejaVu Sans']
matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['axes.unicode_minus'] = False

MODE_DEFAULT_LAYERS = {
    "clean": ["structure", "supply_demand"],
    "smc": ["structure", "liquidity", "order_blocks", "imbalance", "ict"],
    "full": ["structure", "liquidity", "order_blocks", "imbalance", "supply_demand", "ict", "price_action", "indicators"]
}


def cleanup_old_charts(output_dir: str, keep_last: int = 5):
    """Automatically remove older chart PNGs so disk space never fills up."""
    try:
        files = glob.glob(os.path.join(output_dir, "chart_*.png"))
        if len(files) > keep_last:
            files.sort(key=os.path.getmtime)
            for old_f in files[:-keep_last]:
                try:
                    os.remove(old_f)
                except Exception:
                    pass
    except Exception:
        pass


def generate_annotated_chart_image(
    analysis_result: Dict[str, Any],
    output_dir: str,
    mode: str = "smc",
    active_layers: Optional[List[str]] = None
) -> Dict[str, str]:
    """
    Renders a high-resolution PNG chart filtered by display mode (clean / smc / full)
    and active layers, with anti-clutter rules and zero text collisions.
    """
    os.makedirs(output_dir, exist_ok=True)
    cleanup_old_charts(output_dir, keep_last=5)

    mode = (mode or "smc").lower()
    if active_layers is None:
        layers = set(MODE_DEFAULT_LAYERS.get(mode, MODE_DEFAULT_LAYERS["smc"]))
    else:
        layers = set(active_layers)

    df = analysis_result["df"].copy()
    smc = analysis_result["smc"]
    ict = analysis_result.get("ict", {})
    sd_zones = analysis_result.get("supply_demand", [])
    vol_profile = analysis_result.get("volume_profile", {})
    patterns = analysis_result.get("patterns", [])
    symbol = analysis_result["symbol"]
    timeframe = analysis_result["timeframe"]
    action = analysis_result["action"]
    entry = analysis_result["entry"]
    sl = analysis_result["sl"]
    tp1 = analysis_result["tp1"]
    tp2 = analysis_result["tp2"]
    rr_ratio = analysis_result["rr_ratio"]
    confidence = analysis_result["confidence"]
    regime = analysis_result.get("regime", {"name": "TRENDING", "adx": 25.0})
    order_flow = analysis_result.get("order_flow", {"buy_delta_pct": 50.0, "sell_delta_pct": 50.0, "cvd_trend": "CÂN BẰNG"})

    plot_len = min(65, len(df))
    sub_df = df.iloc[-plot_len:].reset_index(drop=True)
    n = len(sub_df)
    start_full_idx = int(df.index[-plot_len])

    plt.style.use('dark_background')
    fig = plt.figure(figsize=(16.0, 9.0), dpi=140, facecolor='#0b0e14')
    gs = GridSpec(4, 1, height_ratios=[3.3, 0.72, 0.02, 0.02], hspace=0.08)

    ax_main = fig.add_subplot(gs[0])
    ax_vol = fig.add_subplot(gs[1], sharex=ax_main)

    ax_main.set_facecolor('#10141d')
    ax_vol.set_facecolor('#10141d')

    ax_main.grid(True, linestyle='--', color='#1c2333', alpha=0.65, zorder=0)
    ax_vol.grid(True, linestyle='--', color='#1c2333', alpha=0.45, zorder=0)

    c_green = '#00c076'
    c_red = '#ff3b57'
    c_entry = '#00f0ff'
    c_sl = '#ff2a55'
    c_tp = '#00ff88'
    c_tp2 = '#ffd700'

    indices = np.arange(n)
    candle_width = 0.64
    wick_width = 1.25

    for i in range(n):
        row = sub_df.iloc[i]
        o, h, l, c = float(row['open']), float(row['high']), float(row['low']), float(row['close'])
        v = float(row['volume'])
        is_up = c >= o
        color = c_green if is_up else c_red

        ax_main.vlines(x=i, ymin=l, ymax=h, color=color, linewidth=wick_width, zorder=3)
        body_bottom = min(o, c)
        body_height = max(abs(c - o), 0.02)
        rect = patches.Rectangle(
            (i - candle_width / 2, body_bottom),
            candle_width, body_height,
            facecolor=color, edgecolor=color,
            alpha=0.92, zorder=4
        )
        ax_main.add_patch(rect)

        rvol_val = float(row.get('rvol', 1.0))
        vol_alpha = 0.78 if rvol_val >= 1.4 else 0.40
        vol_rect = patches.Rectangle(
            (i - candle_width / 2, 0),
            candle_width, v,
            facecolor=color, edgecolor='none',
            alpha=vol_alpha, zorder=3
        )
        ax_vol.add_patch(vol_rect)

    # LAYER 8: INDICATORS (EMA 20/50/200, VWAP, BB, Volume Profile POC/VAH/VAL)
    if "indicators" in layers:
        if 'ema_20' in sub_df.columns:
            ax_main.plot(indices, sub_df['ema_20'], color='#f0b90b', linewidth=1.4, label='EMA 20', alpha=0.85, zorder=5)
        if 'ema_50' in sub_df.columns:
            ax_main.plot(indices, sub_df['ema_50'], color='#3b82f6', linewidth=1.4, label='EMA 50', alpha=0.85, zorder=5)
        if 'ema_200' in sub_df.columns:
            ax_main.plot(indices, sub_df['ema_200'], color='#a855f7', linewidth=1.7, label='EMA 200', alpha=0.85, zorder=5)
        if 'vwap' in sub_df.columns:
            ax_main.plot(indices, sub_df['vwap'], color='#00e5ff', linestyle='-.', linewidth=1.2, label='VWAP', alpha=0.75, zorder=5)
        if mode == "full" and 'bb_upper' in sub_df.columns:
            ax_main.plot(indices, sub_df['bb_upper'], color='#64748b', linestyle=':', linewidth=1.0, alpha=0.6, zorder=4)
            ax_main.plot(indices, sub_df['bb_lower'], color='#64748b', linestyle=':', linewidth=1.0, alpha=0.6, zorder=4)

        # Volume Profile POC / VAH / VAL lines
        if vol_profile and "poc" in vol_profile:
            poc_p = vol_profile["poc"]
            ax_main.axhline(y=poc_p, color='#ffab00', linestyle='-', linewidth=1.3, alpha=0.75, zorder=2)
            ax_main.text(
                n + 0.5, poc_p, f" POC ${poc_p:,.1f}",
                color='#ffab00', fontsize=8, fontweight='bold', va='center', zorder=6, parse_math=False
            )

    # LAYER 6: ICT CONCEPTS (Dealing Range Equilibrium 50%, OTE 0.618-0.786)
    dr = smc.get("dealing_range")
    if "ict" in layers and dr:
        eq_p = dr["equilibrium"]
        ax_main.axhline(y=eq_p, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)
        ax_main.text(
            1, eq_p, f" EQ 50% (Premium / Discount: ${eq_p:,.1f})",
            color='#cbd5e1', fontsize=8, va='bottom', alpha=0.85, zorder=5, parse_math=False
        )
        ote = dr.get("ote")
        if ote and mode in ("smc", "full"):
            ote_bot, ote_top = ote["bottom"], ote["top"]
            ote_rect = patches.Rectangle(
                (max(0, n - 28), ote_bot),
                28, max(ote_top - ote_bot, 0.2),
                facecolor='#f59e0b', edgecolor='#f59e0b',
                linestyle='--', linewidth=1.0, alpha=0.10, zorder=1
            )
            ax_main.add_patch(ote_rect)
            ax_main.text(
                max(0, n - 27), ote_top, f" ICT OTE (0.62-0.79) [${ote_bot:.1f}-${ote_top:.1f}]",
                color='#fbbf24', fontsize=7.8, fontweight='bold', va='bottom', alpha=0.85, zorder=5, parse_math=False
            )

    # LAYER 5: SUPPLY & DEMAND ZONES (Clean Chart & Full Mode)
    if "supply_demand" in layers:
        for sd in sd_zones[-3:]:
            local_idx = max(0, sd["index"] - start_full_idx)
            z_top, z_bot = sd["top"], sd["bottom"]
            is_dem = sd["type"] == "demand"
            z_col = '#10b981' if is_dem else '#f43f5e'
            rect = patches.Rectangle(
                (local_idx, z_bot),
                n - local_idx + 3, max(z_top - z_bot, 0.2),
                facecolor=z_col, edgecolor=z_col,
                linestyle='-', linewidth=1.1, alpha=0.14, zorder=2
            )
            ax_main.add_patch(rect)
            ax_main.text(
                local_idx + 0.5, z_top if is_dem else z_bot,
                f" {sd['pattern']} ({sd['quality_score']}d) [${z_bot:.1f}-${z_top:.1f}]",
                color=z_col, fontsize=8, fontweight='bold',
                va='bottom' if is_dem else 'top', alpha=0.88, zorder=5, parse_math=False
            )

    # LAYER 3: ORDER BLOCKS & BREAKER BLOCKS
    if "order_blocks" in layers:
        for ob in smc.get("order_blocks", [])[-3:]:
            if ob["index"] >= start_full_idx:
                local_idx = ob["index"] - start_full_idx
                ob_top, ob_bot = ob["top"], ob["bottom"]
                is_bull = ob["type"] == "bullish"
                box_color = '#00e676' if is_bull else '#ff3366'
                tag = "BULL OB" if is_bull else "BEAR OB"
                rect = patches.Rectangle(
                    (local_idx, ob_bot),
                    n - local_idx + 4, max(ob_top - ob_bot, 0.2),
                    facecolor=box_color, edgecolor=box_color,
                    linestyle=':', linewidth=1.2, alpha=0.16, zorder=2
                )
                ax_main.add_patch(rect)
                ax_main.text(
                    local_idx + 0.4, ob_top, f" {tag} [${ob_bot:.1f}-${ob_top:.1f}]",
                    color=box_color, fontsize=8, fontweight='bold',
                    va='bottom', alpha=0.88, zorder=5, parse_math=False
                )

        if mode == "full":
            for bb in smc.get("breaker_blocks", [])[-2:]:
                if bb["index"] >= start_full_idx:
                    local_idx = bb["index"] - start_full_idx
                    bb_top, bb_bot = bb["top"], bb["bottom"]
                    is_bull = bb["type"] == "bullish"
                    bb_col = '#38bdf8' if is_bull else '#fb7185'
                    rect = patches.Rectangle(
                        (local_idx, bb_bot),
                        n - local_idx + 2, max(bb_top - bb_bot, 0.2),
                        facecolor=bb_col, edgecolor=bb_col,
                        linestyle='--', linewidth=1.0, alpha=0.12, zorder=2
                    )
                    ax_main.add_patch(rect)
                    ax_main.text(
                        local_idx + 0.4, bb_bot, f" BREAKER ({bb['type'].upper()})",
                        color=bb_col, fontsize=7.5, va='top', alpha=0.85, zorder=5, parse_math=False
                    )

    # LAYER 4: IMBALANCE (FVG / IFVG / BPR)
    if "imbalance" in layers:
        for fvg in smc.get("fvg", [])[-3:]:
            if fvg["index"] >= start_full_idx:
                local_idx = fvg["index"] - start_full_idx
                fvg_top, fvg_bot = fvg["top"], fvg["bottom"]
                is_bull = fvg["type"] == "bullish"
                box_color = '#ff9800' if is_bull else '#e91e63'
                rect = patches.Rectangle(
                    (local_idx, fvg_bot),
                    n - local_idx + 2, max(fvg_top - fvg_bot, 0.2),
                    facecolor=box_color, edgecolor='none',
                    alpha=0.18, zorder=2
                )
                ax_main.add_patch(rect)
                ax_main.text(
                    local_idx + 0.4, fvg_bot, f" FVG ({'Bull' if is_bull else 'Bear'})",
                    color=box_color, fontsize=7.8, va='bottom', alpha=0.80, zorder=5, parse_math=False
                )

    # LAYER 1: MARKET STRUCTURE (HH/HL/LH/LL & BOS / CHoCH / MSS)
    if "structure" in layers:
        ext_pts = smc.get("external_swings", {}).get("all", [])
        for pt in ext_pts[-8:]:
            if pt["index"] >= start_full_idx:
                lx = pt["index"] - start_full_idx
                py = pt["price"]
                lbl = pt["label"]
                is_high = pt["swing_type"] == "high"
                col = '#38bdf8' if lbl in ("HH", "HL") else '#f43f5e'
                ax_main.text(
                    lx, py, lbl,
                    color=col, fontsize=8.5, fontweight='bold',
                    ha='center', va='bottom' if is_high else 'top',
                    bbox=dict(boxstyle='round,pad=0.15', facecolor='#0b0e14', edgecolor=col, alpha=0.82),
                    zorder=7, parse_math=False
                )

        # Draw recent BOS / CHoCH / MSS horizontal break lines
        for ev in smc.get("structure_events", [])[-4:]:
            if ev["index"] >= start_full_idx:
                x1 = max(0, ev["broken_swing_index"] - start_full_idx)
                x2 = ev["index"] - start_full_idx
                py = ev["price"]
                ev_col = '#00e676' if ev["direction"] == "bullish" else '#ff3b57'
                ax_main.hlines(y=py, xmin=x1, xmax=x2, color=ev_col, linestyle='--', linewidth=1.3, alpha=0.85, zorder=5)
                ax_main.text(
                    (x1 + x2) / 2.0, py, f" {ev['event']}",
                    color=ev_col, fontsize=8, fontweight='bold', ha='center', va='bottom',
                    zorder=6, parse_math=False
                )

    # LAYER 2: LIQUIDITY (PDH/PDL, BSL/SSL Sweeps, EQH/EQL)
    if "liquidity" in layers or mode == "clean":
        # Always show PDH/PDL in CleanChart & Liquidity layer as requested
        if ict.get("pdh") and ict.get("pdl"):
            ax_main.axhline(y=ict["pdh"], color='#facc15', linestyle=':', linewidth=1.1, alpha=0.65, zorder=2)
            ax_main.text(n - 1, ict["pdh"], f" PDH ${ict['pdh']:,.1f}", color='#facc15', fontsize=7.8, va='bottom', ha='right', zorder=5, parse_math=False)
            ax_main.axhline(y=ict["pdl"], color='#38bdf8', linestyle=':', linewidth=1.1, alpha=0.65, zorder=2)
            ax_main.text(n - 1, ict["pdl"], f" PDL ${ict['pdl']:,.1f}", color='#38bdf8', fontsize=7.8, va='top', ha='right', zorder=5, parse_math=False)

    if "liquidity" in layers:
        for sw in smc.get("sweeps", [])[-3:]:
            if sw["index"] >= start_full_idx:
                local_idx = sw["index"] - start_full_idx
                is_bull_sw = sw["type"] == "bullish"
                y_pos = sw["wick_extreme"]
                marker_style = '^' if is_bull_sw else 'v'
                sw_color = '#00ffcc' if is_bull_sw else '#ff00ff'
                sw_label = f"SWEEP SSL (${sw['swept_level']:.1f})" if is_bull_sw else f"SWEEP BSL (${sw['swept_level']:.1f})"
                ax_main.scatter([local_idx], [y_pos], color=sw_color, s=95, marker=marker_style, edgecolors='white', linewidth=1.1, zorder=9)
                ax_main.text(
                    local_idx, y_pos, f"  {sw_label}",
                    color=sw_color, fontsize=8, fontweight='bold',
                    va='top' if is_bull_sw else 'bottom', ha='center',
                    bbox=dict(boxstyle='round,pad=0.18', facecolor='#0b0e14', edgecolor=sw_color, alpha=0.85),
                    zorder=9, parse_math=False
                )

    # LAYER 7: PRICE ACTION (Pin Bar, Engulfing, etc.)
    if "price_action" in layers and patterns:
        p_last = patterns[0]
        ax_main.text(
            n - 1, float(sub_df['high'].iloc[-1]),
            f" PA: {p_last['name'].split('(')[0].strip()}",
            color='#fde047', fontsize=8, fontweight='bold',
            va='bottom', ha='right',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='#1e293b', edgecolor='#fde047', alpha=0.88),
            zorder=9, parse_math=False
        )

    # Signal lines (Entry / SL / TP1 / TP2)
    sig_start_x = max(0, n - 20)
    sig_end_x = n + 6
    is_wait = (action == "WAIT")
    entry_prefix = "LIMIT WAIT" if is_wait else "ENTRY"

    ax_main.hlines(y=entry, xmin=sig_start_x, xmax=sig_end_x, color=c_entry, linestyle=':' if is_wait else '--', linewidth=1.9, zorder=6)
    ax_main.text(
        sig_end_x, entry, f"  {entry_prefix}: ${entry:,.2f}",
        color='#ffffff', fontsize=9.5, fontweight='bold',
        va='center', bbox=dict(boxstyle='round,pad=0.28', facecolor='#00838f', edgecolor=c_entry, alpha=0.9),
        zorder=8, parse_math=False
    )

    ax_main.hlines(y=sl, xmin=sig_start_x, xmax=sig_end_x, color=c_sl, linestyle='--', linewidth=1.9, zorder=6)
    sl_dist = abs(entry - sl)
    sl_pct = (sl_dist / entry) * 100
    ax_main.text(
        sig_end_x, sl, f"  SL: ${sl:,.2f} (-${sl_dist:.2f} / -{sl_pct:.2f}%)",
        color='#ffffff', fontsize=9.5, fontweight='bold',
        va='center', bbox=dict(boxstyle='round,pad=0.28', facecolor='#b71c1c', edgecolor=c_sl, alpha=0.9),
        zorder=8, parse_math=False
    )

    tp1_r = abs(tp1 - entry) / max(sl_dist, 0.01)
    ax_main.hlines(y=tp1, xmin=sig_start_x, xmax=sig_end_x, color=c_tp, linestyle='--', linewidth=1.7, zorder=6)
    ax_main.text(
        sig_end_x, tp1, f"  TP 1: ${tp1:,.2f} ({tp1_r:.1f}R)",
        color='#000000', fontsize=9, fontweight='bold',
        va='center', bbox=dict(boxstyle='round,pad=0.25', facecolor=c_tp, edgecolor='white', alpha=0.9),
        zorder=8, parse_math=False
    )

    ax_main.hlines(y=tp2, xmin=sig_start_x, xmax=sig_end_x, color=c_tp2, linestyle='--', linewidth=1.9, zorder=6)
    ax_main.text(
        sig_end_x, tp2, f"  TP 2: ${tp2:,.2f} (R:R 1:{rr_ratio:.1f})",
        color='#000000', fontsize=9, fontweight='bold',
        va='center', bbox=dict(boxstyle='round,pad=0.25', facecolor=c_tp2, edgecolor='white', alpha=0.95),
        zorder=8, parse_math=False
    )

    # Risk/Reward shaded boxes
    rr_box_width = sig_end_x - sig_start_x
    if action == "BUY":
        ax_main.add_patch(patches.Rectangle((sig_start_x, sl), rr_box_width, entry - sl, facecolor='#ff1744', alpha=0.10, zorder=1))
        ax_main.add_patch(patches.Rectangle((sig_start_x, entry), rr_box_width, tp2 - entry, facecolor='#00e676', alpha=0.10, zorder=1))
    elif action == "SELL":
        ax_main.add_patch(patches.Rectangle((sig_start_x, entry), rr_box_width, sl - entry, facecolor='#ff1744', alpha=0.10, zorder=1))
        ax_main.add_patch(patches.Rectangle((sig_start_x, tp2), rr_box_width, entry - tp2, facecolor='#00e676', alpha=0.10, zorder=1))

    all_prices = list(sub_df['low']) + list(sub_df['high']) + [entry, sl, tp1, tp2]
    min_y, max_y = min(all_prices), max(all_prices)
    y_padding = (max_y - min_y) * 0.12
    ax_main.set_ylim(min_y - y_padding, max_y + y_padding)
    ax_main.set_xlim(-1, sig_end_x + 9)

    ax_main.yaxis.set_major_formatter('${x:,.2f}')
    ax_main.tick_params(colors='#8b949e', labelsize=9)
    ax_vol.tick_params(colors='#8b949e', labelsize=8)

    step = max(1, n // 6)
    x_ticks = list(range(0, n, step))
    x_labels = [
        str(sub_df['datetime'].iloc[idx].strftime('%d/%m %H:%M'))
        if hasattr(sub_df['datetime'].iloc[idx], 'strftime')
        else str(sub_df['datetime'].iloc[idx])[-11:-3]
        for idx in x_ticks
    ]
    ax_vol.set_xticks(x_ticks)
    ax_vol.set_xticklabels(x_labels, rotation=0, color='#8b949e', fontsize=8.5)
    plt.setp(ax_main.get_xticklabels(), visible=False)

    # HUD Infographic Card
    is_fallback = bool(analysis_result.get("is_fallback", False))
    action_color = '#00e676' if action == 'BUY' else ('#ff3366' if action == 'SELL' else '#ffd166')
    action_vn = (
        "⚠️ OFFLINE FALLBACK (KHÔNG GIAO DỊCH)"
        if is_fallback
        else ("LỆNH MUA (BUY)" if action == 'BUY' else ("LỆNH BÁN (SELL)" if action == 'SELL' else "WAIT (CHỜ HỒI / LIMIT)"))
    )
    active_model = analysis_result.get("trading_plan", {}).get("active_model", "SMC + ICT Confluence")
    pd_status = dr["zone_status"].split("(")[0].strip() if dr else "EQUILIBRIUM"

    hud_text = (
        f"GOLDVISION AI | CHẾ ĐỘ: {mode.upper()} ({len(layers)}/8 LỚP)\n"
        f"----------------------------------------------------\n"
        f"- Cặp GD: {symbol} | Khung: {timeframe.upper()} | Vị trí: {pd_status}\n"
        f"- Mô hình (Entry Model): {active_model}\n"
        f"- ICT Killzone: {ict.get('active_killzone', 'N/A')}\n"
        f"- TÍN HIỆU: {action_vn} | ĐỘ TIN CẬY: {confidence}%\n"
        f"- ENTRY: ${entry:,.2f} | SL: ${sl:,.2f} (-${sl_dist:.2f})\n"
        f"- TP1: ${tp1:,.2f} | TP2: ${tp2:,.2f} (R:R 1:{rr_ratio:.1f})"
    )

    ax_main.text(
        0.015, 0.96, hud_text,
        transform=ax_main.transAxes,
        color='#f0f6fc', fontsize=8.8, fontfamily='sans-serif',
        verticalalignment='top',
        bbox=dict(boxstyle='round,pad=0.55', facecolor='#161b22', edgecolor=action_color, linewidth=1.8, alpha=0.92),
        zorder=10, parse_math=False
    )

    ax_main.set_title(
        f"BỘ PHÂN TÍCH XAUUSD & VÀNG SỐ: SMC + ICT + SUPPLY/DEMAND ({symbol} - {timeframe.upper()} | MODE: {mode.upper()})",
        color='#e6edf3', fontsize=13, fontweight='bold', pad=12
    )
    if "indicators" in layers:
        ax_main.legend(loc='upper right', facecolor='#161b22', edgecolor='#30363d', fontsize=8.2, labelcolor='#c9d1d9')
    ax_vol.set_ylabel('Volume / RVOL', color='#8b949e', fontsize=8)

    fig.subplots_adjust(top=0.92, bottom=0.08, left=0.06, right=0.88)

    timestamp_str = int(time.time() * 1000)
    clean_sym = symbol.replace('/', '_')
    filename = f"chart_{clean_sym}_{timeframe}_{mode}_{timestamp_str}.png"
    file_path = os.path.join(output_dir, filename)

    fig.savefig(file_path, facecolor=fig.get_facecolor(), edgecolor='none', dpi=140)

    buffer = io.BytesIO()
    fig.savefig(buffer, format='png', facecolor=fig.get_facecolor(), edgecolor='none', dpi=140)
    buffer.seek(0)
    b64_str = base64.b64encode(buffer.read()).decode('utf-8')
    plt.close(fig)

    return {
        "filename": filename,
        "file_path": file_path,
        "base64": f"data:image/png;base64,{b64_str}"
    }
