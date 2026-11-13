/**
 * GoldVision AI — Standalone Client-Side 7-Pillar SMC / ICT / Quant Analysis Engine & Telegram Bot Sender
 * Designed for 100% Free GitHub Pages Hosting (Zero Backend Server Required)
 *
 * Multi-Exchange Public CORS Datafeed:
 *  1. Binance Spot v3 (https://api.binance.com/api/v3/klines)
 *  2. Bybit Spot v5   (https://api.bybit.com/v5/market/kline)
 *  3. Bitget Spot v2  (https://api.bitget.com/api/v2/spot/market/candles)
 *  4. OKX Spot v5     (https://www.okx.com/api/v5/market/candles)
 */

(function (global) {
  "use strict";

  const TF_MAP = {
    "5m":  { binance: "5m",  bybit: "5",   bitget: "5min",  okx: "5m",  stepMs: 300000,    label: "M5"  },
    "15m": { binance: "15m", bybit: "15",  bitget: "15min", okx: "15m", stepMs: 900000,    label: "M15" },
    "1h":  { binance: "1h",  bybit: "60",  bitget: "1h",    okx: "1H",  stepMs: 3600000,   label: "H1"  },
    "4h":  { binance: "4h",  bybit: "240", bitget: "4h",    okx: "4H",  stepMs: 14400000,  label: "H4"  },
    "1d":  { binance: "1d",  bybit: "D",   bitget: "1day",  okx: "1D",  stepMs: 86400000,  label: "D1"  },
    "1w":  { binance: "1w",  bybit: "W",   bitget: "1week", okx: "1W",  stepMs: 604800000, label: "1W"  },
  };

  const _candleCache = {};

  function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  function formatDt(tsMs) {
    const d = new Date(tsMs);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm} ${hh}:${mi}`;
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchBinance(symbol, tf, limit = 110) {
    const tfInfo = TF_MAP[tf] || TF_MAP["1h"];
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tfInfo.binance}&limit=${limit}`;
    const data = await fetchJsonWithTimeout(url);
    if (!Array.isArray(data) || data.length < 20) return null;
    return data.map((k, idx) => ({
      full_index: idx,
      timestamp: Number(k[0]),
      time: Math.floor(Number(k[0]) / 1000),
      datetime: formatDt(Number(k[0])),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async function fetchBybit(symbol, tf, limit = 110) {
    const tfInfo = TF_MAP[tf] || TF_MAP["1h"];
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${tfInfo.bybit}&limit=${limit}`;
    const data = await fetchJsonWithTimeout(url);
    const list = data?.result?.list;
    if (!Array.isArray(list) || list.length < 20) return null;
    const rev = [...list].reverse();
    return rev.map((k, idx) => ({
      full_index: idx,
      timestamp: Number(k[0]),
      time: Math.floor(Number(k[0]) / 1000),
      datetime: formatDt(Number(k[0])),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async function fetchOkx(instId, tf, limit = 110) {
    const tfInfo = TF_MAP[tf] || TF_MAP["1h"];
    const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${tfInfo.okx}&limit=${limit}`;
    const data = await fetchJsonWithTimeout(url);
    const list = data?.data;
    if (!Array.isArray(list) || list.length < 20) return null;
    const rev = [...list].reverse();
    return rev.map((k, idx) => ({
      full_index: idx,
      timestamp: Number(k[0]),
      time: Math.floor(Number(k[0]) / 1000),
      datetime: formatDt(Number(k[0])),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async function fetchBitget(symbol, tf, limit = 110) {
    const tfInfo = TF_MAP[tf] || TF_MAP["1h"];
    const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol}&granularity=${tfInfo.bitget}&limit=${limit}`;
    const data = await fetchJsonWithTimeout(url);
    const list = data?.data;
    if (!Array.isArray(list) || list.length < 20) return null;
    const sorted = [...list].sort((a, b) => Number(a[0]) - Number(b[0]));
    return sorted.map((k, idx) => ({
      full_index: idx,
      timestamp: Number(k[0]),
      time: Math.floor(Number(k[0]) / 1000),
      datetime: formatDt(Number(k[0])),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async function fetchLiveCandles(symbol = "PAXG/USDT", timeframe = "1h", limit = 110) {
    const key = `${symbol}_${timeframe}`;
    const now = Date.now();
    if (_candleCache[key] && now - _candleCache[key].ts < 18000) {
      return _candleCache[key].candles.map((c) => ({ ...c }));
    }

    let providers = [];
    if (symbol === "XAUT/USDT") {
      providers = [
        () => fetchOkx("XAUT-USDT", timeframe, limit),
        () => fetchBybit("XAUTUSDT", timeframe, limit),
        () => fetchBitget("XAUTUSDT", timeframe, limit),
        () => fetchBinance("PAXGUSDT", timeframe, limit),
      ];
    } else {
      providers = [
        () => fetchBinance("PAXGUSDT", timeframe, limit),
        () => fetchBybit("PAXGUSDT", timeframe, limit),
        () => fetchBitget("PAXGUSDT", timeframe, limit),
        () => fetchOkx("PAXG-USDT", timeframe, limit),
      ];
    }

    for (const fn of providers) {
      try {
        const rows = await fn();
        if (rows && rows.length >= 25) {
          _candleCache[key] = { ts: now, candles: rows };
          return rows.map((c) => ({ ...c }));
        }
      } catch (_) {}
    }

    return null;
  }

  async function fetchLiveOrderbook(symbol = "PAXG/USDT") {
    try {
      let bids = [], asks = [];
      if (symbol === "XAUT/USDT") {
        const res = await fetchJsonWithTimeout("https://www.okx.com/api/v5/market/books?instId=XAUT-USDT&sz=50", 3500);
        const b0 = res?.data?.[0];
        if (b0) {
          bids = b0.bids || [];
          asks = b0.asks || [];
        }
      } else {
        const res = await fetchJsonWithTimeout("https://api.binance.com/api/v3/depth?symbol=PAXGUSDT&limit=50", 3500);
        bids = res?.bids || [];
        asks = res?.asks || [];
      }
      if (bids.length && asks.length) {
        const bidVol = bids.reduce((s, b) => s + parseFloat(b[1]), 0);
        const askVol = asks.reduce((s, a) => s + parseFloat(a[1]), 0);
        const total = bidVol + askVol || 1;
        const bidPct = round2((bidVol / total) * 100);
        const askPct = round2(100 - bidPct);
        const maxBid = bids.reduce((m, x) => (parseFloat(x[1]) > parseFloat(m[1]) ? x : m), bids[0]);
        const maxAsk = asks.reduce((m, x) => (parseFloat(x[1]) > parseFloat(m[1]) ? x : m), asks[0]);
        const bidWall = round2(parseFloat(maxBid[0]));
        const askWall = round2(parseFloat(maxAsk[0]));
        return {
          available: true,
          bid_volume: round2(bidVol),
          ask_volume: round2(askVol),
          bid_pct: bidPct,
          ask_pct: askPct,
          largest_bid_wall: bidWall,
          largest_ask_wall: askWall,
        };
      }
    } catch (_) {}
    return {
      available: false,
      bid_volume: 0,
      ask_volume: 0,
      bid_pct: 50,
      ask_pct: 50,
      largest_bid_wall: null,
      largest_ask_wall: null,
    };
  }

  function calcEMA(values, period) {
    const k = 2 / (period + 1);
    const out = new Array(values.length).fill(0);
    let ema = values[0] || 0;
    for (let i = 0; i < values.length; i++) {
      ema = i === 0 ? values[i] : values[i] * k + ema * (1 - k);
      out[i] = ema;
    }
    return out;
  }

  function calcRMA(values, period) {
    const alpha = 1 / period;
    const out = new Array(values.length).fill(0);
    let rma = values[0] || 0;
    for (let i = 0; i < values.length; i++) {
      rma = i === 0 ? values[i] : values[i] * alpha + rma * (1 - alpha);
      out[i] = rma;
    }
    return out;
  }

  function enrichIndicators(candles) {
    const n = candles.length;
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const vols = candles.map((c) => c.volume || 1);

    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, 100);

    const tr = new Array(n).fill(0);
    const plusDM = new Array(n).fill(0);
    const minusDM = new Array(n).fill(0);
    const gains = new Array(n).fill(0);
    const losses = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
      if (i === 0) {
        tr[i] = highs[i] - lows[i];
      } else {
        tr[i] = Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1])
        );
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
        const diff = closes[i] - closes[i - 1];
        gains[i] = diff > 0 ? diff : 0;
        losses[i] = diff < 0 ? -diff : 0;
      }
    }

    const atrArr = calcRMA(tr, 14);
    const avgGain = calcRMA(gains, 14);
    const avgLoss = calcRMA(losses, 14);
    const smPlus = calcRMA(plusDM, 14);
    const smMinus = calcRMA(minusDM, 14);
    const dxArr = new Array(n).fill(20);

    for (let i = 0; i < n; i++) {
      const atrVal = Math.max(atrArr[i], 0.01);
      const pDI = (smPlus[i] / atrVal) * 100;
      const mDI = (smMinus[i] / atrVal) * 100;
      const sumDI = pDI + mDI || 1;
      dxArr[i] = (Math.abs(pDI - mDI) / sumDI) * 100;
    }
    const adxArr = calcRMA(dxArr, 14);

    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tp = (c.high + c.low + c.close) / 3;
      const v = Math.max(c.volume, 0.01);
      cumPV += tp * v;
      cumV += v;
      const vwap = cumPV / cumV;

      const slice = closes.slice(Math.max(0, i - 19), i + 1);
      const mean = slice.reduce((s, x) => s + x, 0) / slice.length;
      const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length;
      const std = Math.sqrt(variance);

      const vSlice = vols.slice(Math.max(0, i - 19), i + 1);
      const vMean = vSlice.reduce((s, x) => s + x, 0) / vSlice.length || 1;

      const rs = avgGain[i] / Math.max(avgLoss[i], 0.0001);
      const rsi = 100 - 100 / (1 + rs);

      c.full_index = i;
      c.ema20 = round2(ema20[i]);
      c.ema50 = round2(ema50[i]);
      c.ema200 = round2(ema200[i]);
      c.vwap = round2(vwap);
      c.bb_upper = round2(mean + 2 * std);
      c.bb_lower = round2(mean - 2 * std);
      c.std_dev = round2(std);
      c.atr = round2(Math.max(atrArr[i], c.close * 0.002));
      c.rsi = round2(rsi);
      c.adx = round2(adxArr[i]);
      c.rvol = round2(v / vMean);
    }
    return candles;
  }

  function detectSwings(candles, leftRight = 3) {
    const highs = [];
    const lows = [];
    const all = [];
    let lastHigh = null;
    let lastLow = null;

    for (let i = leftRight; i < candles.length - leftRight; i++) {
      const curH = candles[i].high;
      const curL = candles[i].low;
      let isHigh = true;
      let isLow = true;
      for (let j = i - leftRight; j <= i + leftRight; j++) {
        if (j === i) continue;
        if (candles[j].high >= curH) isHigh = false;
        if (candles[j].low <= curL) isLow = false;
      }
      if (isHigh) {
        const label = lastHigh === null || curH >= lastHigh ? "HH" : "LH";
        lastHigh = curH;
        const item = { index: i, price: round2(curH), swing_type: "high", label, datetime: candles[i].datetime };
        highs.push(item);
        all.push(item);
      }
      if (isLow) {
        const label = lastLow === null || curL >= lastLow ? "HL" : "LL";
        lastLow = curL;
        const item = { index: i, price: round2(curL), swing_type: "low", label, datetime: candles[i].datetime };
        lows.push(item);
        all.push(item);
      }
    }
    return { highs, lows, all };
  }

  function filterZones(zones, currentPrice, atr, maxCount = 2) {
    if (!zones || !zones.length) return [];
    const maxDist = atr * 6.5;
    const near = zones.filter((z) => {
      const mid = (z.top + z.bottom) / 2;
      return Math.abs(mid - currentPrice) <= maxDist;
    });
    const pool = near.length ? near : zones.slice(-maxCount * 2);
    const rev = [...pool].reverse();
    const selected = [];
    for (const z of rev) {
      const overlaps = selected.some(
        (s) => !(z.top < s.bottom - atr * 0.25 || z.bottom > s.top + atr * 0.25)
      );
      if (!overlaps) selected.push(z);
      if (selected.length >= maxCount) break;
    }
    return selected.reverse();
  }

  function evaluateQuickBias(candles, isCurrent) {
    if (!candles || candles.length < 20) {
      return { bias: "NEUTRAL", trend: "Chờ", structure: "Neutral", is_current: isCurrent };
    }
    enrichIndicators(candles);
    const last = candles[candles.length - 1];
    const sw = detectSwings(candles, 2);
    const lastH = sw.highs[sw.highs.length - 1];
    const lastL = sw.lows[sw.lows.length - 1];
    if (last.close > last.ema50 && (lastH?.label === "HH" || lastL?.label === "HL")) {
      return { bias: "BULLISH", trend: "Tăng (Bullish)", structure: "HH / HL", is_current: isCurrent };
    }
    if (last.close < last.ema50 && (lastH?.label === "LH" || lastL?.label === "LL")) {
      return { bias: "BEARISH", trend: "Giảm (Bearish)", structure: "LH / LL", is_current: isCurrent };
    }
    if (last.close > last.ema20) {
      return { bias: "BULLISH", trend: "Hồi tăng", structure: "HL / BOS", is_current: isCurrent };
    }
    return { bias: "NEUTRAL", trend: "Điều chỉnh (Pullback)", structure: "Pullback", is_current: isCurrent };
  }

  async function buildClientMtfMatrix(symbol, activeTf, activeCandles) {
    const tfs = [
      { tf: "D1", code: "1d" },
      { tf: "H4", code: "4h" },
      { tf: "H1", code: "1h" },
      { tf: "M15", code: "15m" },
      { tf: "M5", code: "5m" },
    ];
    return Promise.all(
      tfs.map(async (item) => {
        try {
          const cands =
            item.code === activeTf
              ? activeCandles.map((c) => ({ ...c }))
              : await fetchLiveCandles(symbol, item.code, 70);
          if (!cands || cands.length < 20) {
            return { tf: item.tf, bias: "NEUTRAL", trend: "Chờ (Mất kết nối)", structure: "Neutral", is_current: item.code === activeTf };
          }
          const ev = evaluateQuickBias(cands, item.code === activeTf);
          return { tf: item.tf, ...ev };
        } catch (_) {
          return { tf: item.tf, bias: "NEUTRAL", trend: "Chờ (Mất kết nối)", structure: "Neutral", is_current: item.code === activeTf };
        }
      })
    );
  }

  async function analyzeGoldClientSide(symbol = "PAXG/USDT", timeframe = "1h", mode = "clean") {
    const rawCandles = await fetchLiveCandles(symbol, timeframe, 110);
    if (!rawCandles || rawCandles.length < 25) {
      throw new Error("Không thể tải dữ liệu nến từ các sàn.");
    }

    const candles = enrichIndicators(rawCandles);
    const [orderbook, mtfMatrix] = await Promise.all([
      fetchLiveOrderbook(symbol),
      buildClientMtfMatrix(symbol, timeframe, candles),
    ]);

    const n = candles.length;
    const last = candles[n - 1];
    const currentPrice = last.close;
    const atr = last.atr;

    const extSwings = detectSwings(candles, 3);
    const intSwings = detectSwings(candles, 2);

    const displacements = [];
    for (let i = Math.max(15, n - 55); i < n; i++) {
      const body = Math.abs(candles[i].close - candles[i].open);
      if (body >= candles[i].atr * 1.15) {
        displacements.push({
          index: i,
          direction: candles[i].close > candles[i].open ? "bullish" : "bearish",
          body_atr_ratio: round2(body / candles[i].atr),
          price: candles[i].close,
        });
      }
    }

    const recentHighs = extSwings.highs.slice(-7);
    const recentLows = extSwings.lows.slice(-7);

    // 1. Valid Liquidity Sweeps (skip prior already-broken levels & flag invalidated sweeps)
    const sweeps = [];
    for (const sh of recentHighs.slice(-5)) {
      for (let i = sh.index + 2; i < n; i++) {
        if (candles[i].high > sh.price && candles[i].close < sh.price && (candles[i].high - sh.price) <= candles[i].atr * 1.8) {
          const alreadyBrokenBefore = candles.slice(sh.index + 1, i).some((x) => x.close > sh.price);
          if (!alreadyBrokenBefore) {
            const invalidatedAfter = candles.slice(i + 1).some((x) => x.close > candles[i].high);
            sweeps.push({
              id: `SW_BSL_${i}`,
              type: "bearish",
              pool_type: "BSL",
              name: "Quét Thanh Khoản Đỉnh (BSL Sweep)",
              index: i,
              swept_level: sh.price,
              wick_extreme: candles[i].high,
              invalidated: invalidatedAfter,
              is_recent: (n - 1 - i) <= 8 && !invalidatedAfter,
              desc: `Quét thanh khoản Mua (BSL Sweep) tại $${sh.price} rồi rút râu giảm${invalidatedAfter ? " [ĐÃ VƯỢT LẠI]" : ""}`,
            });
          }
          break;
        }
      }
    }
    for (const sl of recentLows.slice(-5)) {
      for (let i = sl.index + 2; i < n; i++) {
        if (candles[i].low < sl.price && candles[i].close > sl.price && (sl.price - candles[i].low) <= candles[i].atr * 1.8) {
          const alreadyBrokenBefore = candles.slice(sl.index + 1, i).some((x) => x.close < sl.price);
          if (!alreadyBrokenBefore) {
            const invalidatedAfter = candles.slice(i + 1).some((x) => x.close < candles[i].low);
            sweeps.push({
              id: `SW_SSL_${i}`,
              type: "bullish",
              pool_type: "SSL",
              name: "Quét Thanh Khoản Đáy (SSL Sweep)",
              index: i,
              swept_level: sl.price,
              wick_extreme: candles[i].low,
              invalidated: invalidatedAfter,
              is_recent: (n - 1 - i) <= 8 && !invalidatedAfter,
              desc: `Quét thanh khoản Bán (SSL Sweep) tại $${sl.price} rồi rút râu tăng${invalidatedAfter ? " [ĐÃ THỦNG LẠI]" : ""}`,
            });
          }
          break;
        }
      }
    }
    sweeps.sort((a, b) => a.index - b.index);

    // 2. Chronological Structure Breaks: BOS, CHoCH, MSS
    const structureEvents = [];
    const brokenHighIdx = new Set();
    const brokenLowIdx = new Set();
    const allSwingsRef = [...recentHighs, ...recentLows];
    const earliestIdx = allSwingsRef.length ? Math.min(...allSwingsRef.map((s) => s.index)) : 0;
    const initIdx = Math.max(0, Math.min(n - 1, earliestIdx));
    let runningTrend = candles[initIdx].close >= candles[initIdx].ema50 ? "bullish" : "bearish";

    for (let k = 4; k < n; k++) {
      const cClose = candles[k].close;

      const brokenH = recentHighs.filter((h) => !brokenHighIdx.has(h.index) && h.index < k && cClose > h.price);
      if (brokenH.length) {
        for (const h of brokenH) brokenHighIdx.add(h.index);
        const hRef = brokenH.reduce((a, b) => (b.price > a.price ? b : a), brokenH[0]);
        const isChoch = runningTrend === "bearish";
        const hasDisp = displacements.some((d) => Math.abs(d.index - k) <= 2 && d.direction === "bullish");
        const hasSweep = sweeps.some((s) => s.type === "bullish" && k - s.index >= 0 && k - s.index <= 12);
        const evType = isChoch ? (hasDisp || hasSweep ? "MSS" : "CHoCH") : "BOS";
        structureEvents.push({
          id: `EV_H_${k}`,
          event: evType,
          direction: "bullish",
          broken_swing_index: hRef.index,
          index: k,
          price: hRef.price,
          causal_desc: `${evType} Tăng phá đỉnh ${hRef.label} ($${hRef.price})${hasDisp ? " kèm nến Displacement mạnh" : ""}`,
        });
        runningTrend = "bullish";
      }

      const brokenL = recentLows.filter((l) => !brokenLowIdx.has(l.index) && l.index < k && cClose < l.price);
      if (brokenL.length) {
        for (const l of brokenL) brokenLowIdx.add(l.index);
        const lRef = brokenL.reduce((a, b) => (b.price < a.price ? b : a), brokenL[0]);
        const isChoch = runningTrend === "bullish";
        const hasDisp = displacements.some((d) => Math.abs(d.index - k) <= 2 && d.direction === "bearish");
        const hasSweep = sweeps.some((s) => s.type === "bearish" && k - s.index >= 0 && k - s.index <= 12);
        const evType = isChoch ? (hasDisp || hasSweep ? "MSS" : "CHoCH") : "BOS";
        structureEvents.push({
          id: `EV_L_${k}`,
          event: evType,
          direction: "bearish",
          broken_swing_index: lRef.index,
          index: k,
          price: lRef.price,
          causal_desc: `${evType} Giảm phá đáy ${lRef.label} ($${lRef.price})${hasDisp ? " kèm nến Displacement mạnh" : ""}`,
        });
        runningTrend = "bearish";
      }
    }

    const rawOBs = [];
    const rawBreakers = [];
    for (const disp of displacements) {
      const idx = disp.index;
      for (let k = idx - 1; k >= Math.max(1, idx - 4); k--) {
        const c = candles[k];
        if (disp.direction === "bullish" && c.close < c.open) {
          const top = round2(Math.max(c.open, c.close) + atr * 0.08);
          const bottom = round2(c.low);
          const broken = candles.slice(idx + 1).some((x) => x.close < bottom);
          const chain = `Bullish OB tạo bởi nến Displacement (${disp.body_atr_ratio}x ATR) tại nến #${idx} phá cấu trúc`;
          if (!broken) {
            rawOBs.push({ id: `OB_B_${k}`, type: "bullish", index: k, top, bottom, causal_desc: chain });
          } else {
            rawBreakers.push({
              id: `BB_BEAR_${k}`,
              type: "bearish",
              index: k,
              top,
              bottom,
              causal_desc: "Bullish OB bị phá vỡ đổi vai trò thành Bearish Breaker Block",
            });
          }
          break;
        }
        if (disp.direction === "bearish" && c.close > c.open) {
          const top = round2(c.high);
          const bottom = round2(Math.min(c.open, c.close) - atr * 0.08);
          const broken = candles.slice(idx + 1).some((x) => x.close > top);
          const chain = `Bearish OB tạo bởi nến Displacement (${disp.body_atr_ratio}x ATR) tại nến #${idx} phá cấu trúc`;
          if (!broken) {
            rawOBs.push({ id: `OB_S_${k}`, type: "bearish", index: k, top, bottom, causal_desc: chain });
          } else {
            rawBreakers.push({
              id: `BB_BULL_${k}`,
              type: "bullish",
              index: k,
              top,
              bottom,
              causal_desc: "Bearish OB bị phá vượt lên đổi vai trò thành Bullish Breaker Block",
            });
          }
          break;
        }
      }
    }

    const rawFvgs = [];
    for (let i = Math.max(20, n - 55); i < n; i++) {
      const c0 = candles[i - 2];
      const c2 = candles[i];
      if (c2.low > c0.high && c2.low - c0.high >= atr * 0.12) {
        const mitigated = candles.slice(i + 1).some((x) => x.low <= c0.high);
        if (!mitigated) {
          rawFvgs.push({
            id: `FVG_B_${i}`,
            type: "bullish",
            index: i - 1,
            top: round2(c2.low),
            bottom: round2(c0.high),
            causal_desc: `Bullish FVG tạo ra tại nến #${i - 1} do lực mua Displacement nhảy vọt`,
          });
        }
      } else if (c2.high < c0.low && c0.low - c2.high >= atr * 0.12) {
        const mitigated = candles.slice(i + 1).some((x) => x.high >= c0.low);
        if (!mitigated) {
          rawFvgs.push({
            id: `FVG_S_${i}`,
            type: "bearish",
            index: i - 1,
            top: round2(c0.low),
            bottom: round2(c2.high),
            causal_desc: `Bearish FVG tạo ra tại nến #${i - 1} do lực bán Displacement áp đảo`,
          });
        }
      }
    }

    const orderBlocks = filterZones(rawOBs, currentPrice, atr, 2);
    const breakerBlocks = filterZones(rawBreakers, currentPrice, atr, 1);
    const fvgs = filterZones(rawFvgs, currentPrice, atr, 2);

    const lookbackSlice = candles.slice(-55);
    const rangeHigh = round2(Math.max(...lookbackSlice.map((c) => c.high)));
    const rangeLow = round2(Math.min(...lookbackSlice.map((c) => c.low)));
    const eq50 = round2((rangeHigh + rangeLow) / 2);
    const span = Math.max(rangeHigh - rangeLow, 1);
    const posPct = round2(((currentPrice - rangeLow) / span) * 100);
    const isDiscount = currentPrice <= eq50;

    const lastStruct = structureEvents[structureEvents.length - 1];
    const smcTrend = lastStruct
      ? lastStruct.direction
      : (last.close >= last.ema50 ? "bullish" : "bearish");

    const oteTop = smcTrend === "bullish" ? round2(rangeHigh - span * 0.618) : round2(rangeLow + span * 0.786);
    const oteBottom = smcTrend === "bullish" ? round2(rangeHigh - span * 0.786) : round2(rangeLow + span * 0.618);

    const dealingRange = {
      high: rangeHigh,
      low: rangeLow,
      equilibrium: eq50,
      current_pct: posPct,
      zone_status: isDiscount ? "DISCOUNT (< 50% Equilibrium)" : "PREMIUM (> 50% Equilibrium)",
      ote: {
        bottom: Math.min(oteTop, oteBottom),
        top: Math.max(oteTop, oteBottom),
        desc: `Vùng chiết khấu vàng ICT OTE (0.618 - 0.786 Fib): $${Math.min(oteTop, oteBottom)} - $${Math.max(oteTop, oteBottom)}`,
      },
    };

    const sdZones = [];
    for (let i = Math.max(15, n - 55); i < n - 1; i++) {
      const prev = candles[i - 1];
      const base = candles[i];
      const next = candles[i + 1];
      const baseBody = Math.abs(base.close - base.open);
      const nextBody = Math.abs(next.close - next.open);
      if (baseBody <= atr * 0.65 && nextBody >= atr * 1.1) {
        const isDemand = next.close > next.open;
        const pattern =
          prev.close < prev.open
            ? isDemand
              ? "DBR (Drop-Base-Rally)"
              : "DBD (Drop-Base-Drop)"
            : isDemand
            ? "RBR (Rally-Base-Rally)"
            : "RBD (Rally-Base-Drop)";
        const top = round2(Math.max(base.open, base.close, base.high));
        const bottom = round2(Math.min(base.open, base.close, base.low));
        const broken = candles
          .slice(i + 2)
          .some((x) => (isDemand ? x.close < bottom : x.close > top));
        if (!broken) {
          const qScore = Math.min(96, Math.round(74 + (nextBody / atr) * 8));
          sdZones.push({
            id: `SD_${i}`,
            type: isDemand ? "demand" : "supply",
            pattern,
            index: i,
            top,
            bottom,
            status: "Fresh (Chưa test)",
            quality_score: qScore,
            causal_desc: `Vùng ${isDemand ? "Demand" : "Supply"} ${pattern} (${qScore}/100đ) tạo bởi cú rời vùng mạnh`,
          });
        }
      }
    }
    const activeSdZones = filterZones(sdZones, currentPrice, atr, 2);

    const nyFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const nyParts = nyFormatter.formatToParts(new Date());
    const nyHour = Number(nyParts.find((p) => p.type === "hour")?.value || 10);
    const nyMin = Number(nyParts.find((p) => p.type === "minute")?.value || 0);
    const nyTimeStr = `${String(nyHour).padStart(2, "0")}:${String(nyMin).padStart(2, "0")} EST`;

    let activeKillzone = "Asian / Inter-Session (Ngoài Killzone chính)";
    if (nyHour >= 2 && nyHour < 5) activeKillzone = "London Killzone (02:00-05:00 NY)";
    else if (nyHour >= 7 && nyHour < 11) activeKillzone = "New York Killzone (07:00-11:00 NY)";
    else if (nyHour >= 13 && nyHour < 16) activeKillzone = "New York PM Session (13:00-16:00 NY)";

    let silverBullet = "Theo dõi 03-04h, 10-11h, 14-15h NY Silver Bullet";
    if (nyHour === 3) silverBullet = "⚡ ACTIVE: London Silver Bullet (03:00-04:00 NY)";
    else if (nyHour === 10) silverBullet = "⚡ ACTIVE: NY AM Silver Bullet (10:00-11:00 NY)";
    else if (nyHour === 14) silverBullet = "⚡ ACTIVE: NY PM Silver Bullet (14:00-15:00 NY)";

    const pdSlice = candles.slice(-48, -24);
    const pdh = round2(Math.max(...(pdSlice.length ? pdSlice : candles.slice(-30)).map((c) => c.high)));
    const pdl = round2(Math.min(...(pdSlice.length ? pdSlice : candles.slice(-30)).map((c) => c.low)));
    const pwh = round2(Math.max(...candles.map((c) => c.high)));
    const pwl = round2(Math.min(...candles.map((c) => c.low)));
    const asianSlice = candles.slice(-18, -10);
    const asianHigh = round2(Math.max(...(asianSlice.length ? asianSlice : candles.slice(-12)).map((c) => c.high)));
    const asianLow = round2(Math.min(...(asianSlice.length ? asianSlice : candles.slice(-12)).map((c) => c.low)));

    const binsCount = 24;
    const step = (rangeHigh - rangeLow) / binsCount || 1;
    const bins = Array.from({ length: binsCount }, (_, i) => ({
      price_low: round2(rangeLow + i * step),
      price_high: round2(rangeLow + (i + 1) * step),
      price_mid: round2(rangeLow + (i + 0.5) * step),
      volume: 0,
    }));
    for (const c of candles) {
      let idx = Math.floor((c.close - rangeLow) / step);
      idx = Math.max(0, Math.min(binsCount - 1, idx));
      bins[idx].volume += c.volume || 1;
    }
    const maxBin = bins.reduce((m, b) => (b.volume > m.volume ? b : m), bins[0]);
    const poc = maxBin.price_mid;
    const vah = round2(poc + atr * 1.35);
    const val = round2(poc - atr * 1.35);

    const isBull = smcTrend === "bullish";

    // Nearest directional POIs (strictly on the valid pullback side of price!)
    const bullPoisBelow = [...orderBlocks, ...fvgs].filter((z) => z.type === "bullish" && z.top <= currentPrice + atr * 0.15);
    const bearPoisAbove = [...orderBlocks, ...fvgs].filter((z) => z.type === "bearish" && z.bottom >= currentPrice - atr * 0.15);
    const nearBullPoi = bullPoisBelow.length
      ? bullPoisBelow.reduce((best, z) => (z.top > best.top ? z : best), bullPoisBelow[0])
      : null;
    const nearBearPoi = bearPoisAbove.length
      ? bearPoisAbove.reduce((best, z) => (z.bottom < best.bottom ? z : best), bearPoisAbove[0])
      : null;

    // Multi-Pillar Confluence Scoring (matching & reinforcing backend rigor)
    let buyScore = 0;
    let sellScore = 0;
    const reasons = [];
    const isTrending = last.adx >= 25;
    const isSideway = last.adx < 20;

    if (!isSideway) {
      if (last.close > last.ema20 && last.ema20 > last.ema50) {
        buyScore += isTrending ? 26 : 16;
        reasons.push(`Giá > EMA 20 > EMA 50 (ADX ${last.adx})`);
      } else if (last.close < last.ema20 && last.ema20 < last.ema50) {
        sellScore += isTrending ? 26 : 16;
        reasons.push(`Giá < EMA 20 < EMA 50 (ADX ${last.adx})`);
      }
    } else {
      reasons.push(`⚠️ Thị trường đi ngang (ADX ${last.adx} < 20) — Hạn chế vào giữa biên độ, chỉ săn Sweep 2 đầu.`);
    }

    if (smcTrend === "bullish") buyScore += 18;
    else sellScore += 18;

    // HTF Bias from D1 / H4 MTF Matrix
    let htfBull = 0;
    let htfBear = 0;
    for (const m of mtfMatrix || []) {
      if (m.tf === "D1" || m.tf === "H4") {
        if (m.bias === "BULLISH") htfBull += 1;
        else if (m.bias === "BEARISH") htfBear += 1;
      }
    }
    if (htfBull === 2 && htfBear === 0) {
      buyScore += 20;
      reasons.push("🌐 Đa khung D1 & H4 đồng thuận TĂNG (HTF Bullish)");
    } else if (htfBear === 2 && htfBull === 0) {
      sellScore += 20;
      reasons.push("🌐 Đa khung D1 & H4 đồng thuận GIẢM (HTF Bearish)");
    } else if (htfBull >= 1 && htfBear === 0) {
      buyScore += 10;
    } else if (htfBear >= 1 && htfBull === 0) {
      sellScore += 10;
    }
    if (htfBear >= 2) {
      buyScore = Math.max(0, buyScore - 18);
      reasons.push("⚠️ Cảnh báo ngược xu hướng lớn D1 & H4 (đang Giảm) nếu canh MUA");
    }
    if (htfBull >= 2) {
      sellScore = Math.max(0, sellScore - 18);
      reasons.push("⚠️ Cảnh báo ngược xu hướng lớn D1 & H4 (đang Tăng) nếu canh BÁN");
    }

    if (isDiscount) {
      buyScore += 15;
      reasons.push(`Vùng DISCOUNT (${posPct}% < 50% EQ $${eq50})`);
    } else {
      sellScore += 15;
      reasons.push(`Vùng PREMIUM (${posPct}% > 50% EQ $${eq50})`);
    }

    if (currentPrice >= dealingRange.ote.bottom && currentPrice <= dealingRange.ote.top) {
      if (isBull) {
        buyScore += 18;
        reasons.push(`Giá chạm vùng chiết khấu vàng ICT OTE ($${dealingRange.ote.bottom} - $${dealingRange.ote.top})`);
      } else {
        sellScore += 18;
        reasons.push(`Giá chạm vùng hồi vàng ICT OTE ($${dealingRange.ote.bottom} - $${dealingRange.ote.top})`);
      }
    }

    const recentValidSweeps = sweeps.filter((s) => s.is_recent && !s.invalidated);
    if (recentValidSweeps.length) {
      const sw = recentValidSweeps[recentValidSweeps.length - 1];
      if (sw.type === "bullish") {
        buyScore += 28;
        reasons.push(`⚡ ${sw.name} tại $${sw.swept_level}`);
      } else {
        sellScore += 28;
        reasons.push(`⚡ ${sw.name} tại $${sw.swept_level}`);
      }
    }

    if (nearBullPoi && Math.abs(currentPrice - nearBullPoi.top) <= atr * 2.8) {
      buyScore += 20;
      reasons.push(nearBullPoi.causal_desc);
    }
    if (nearBearPoi && Math.abs(nearBearPoi.bottom - currentPrice) <= atr * 2.8) {
      sellScore += 20;
      reasons.push(nearBearPoi.causal_desc);
    }

    if (currentPrice >= poc) {
      buyScore += 8;
    } else {
      sellScore += 8;
    }
    if (orderbook.available) {
      if (orderbook.bid_pct >= 56) buyScore += 12;
      else if (orderbook.ask_pct >= 56) sellScore += 12;
    }

    // Candlestick rejection on latest closed/live bar & RSI divergence
    const candleRange = Math.max(last.high - last.low, 0.01);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const upperWick = last.high - Math.max(last.open, last.close);
    const bodySz = Math.abs(last.close - last.open);
    const hasBullPA = lowerWick >= candleRange * 0.55 && bodySz <= candleRange * 0.35;
    const hasBearPA = upperWick >= candleRange * 0.55 && bodySz <= candleRange * 0.35;
    if (hasBullPA) {
      buyScore += 14;
      reasons.push("Price Action: Nến rút chân từ chối đáy (Bullish Pin Bar)");
    }
    if (hasBearPA) {
      sellScore += 14;
      reasons.push("Price Action: Nến rút đầu từ chối đỉnh (Bearish Pin Bar)");
    }

    if (extSwings.lows.length >= 2) {
      const l1 = extSwings.lows[extSwings.lows.length - 2];
      const l2 = extSwings.lows[extSwings.lows.length - 1];
      if (l2.price < l1.price && candles[l2.index].rsi > candles[l1.index].rsi + 2) {
        buyScore += 18;
        reasons.push("Phân kỳ tăng RSI Bullish Divergence");
      }
    }
    if (extSwings.highs.length >= 2) {
      const h1 = extSwings.highs[extSwings.highs.length - 2];
      const h2 = extSwings.highs[extSwings.highs.length - 1];
      if (h2.price > h1.price && candles[h2.index].rsi < candles[h1.index].rsi - 2) {
        sellScore += 18;
        reasons.push("Phân kỳ giảm RSI Bearish Divergence");
      }
    }

    const dominantScore = Math.max(buyScore, sellScore);
    const netEdge = Math.abs(buyScore - sellScore);
    const fightingHtf = (buyScore > sellScore && htfBear >= 2) || (sellScore > buyScore && htfBull >= 2);

    let confRaw = 36 + netEdge * 0.58 + dominantScore * 0.16;
    if (isSideway) confRaw -= 10;
    if (fightingHtf) confRaw -= 12;
    const confidence = Math.min(94, Math.max(35, Math.round(confRaw)));

    const minEdgeReq = isSideway || fightingHtf ? 22 : 16;
    const minDomReq = isSideway ? 56 : 46;
    const sidewayBullOk = !isSideway || recentValidSweeps.some((s) => s.type === "bullish") || hasBullPA;
    const sidewayBearOk = !isSideway || recentValidSweeps.some((s) => s.type === "bearish") || hasBearPA;

    // Structural barriers (opposing swings / OB ahead of TP1)
    const bullBarriers = [
      ...orderBlocks.filter((z) => z.type === "bearish" && z.bottom > currentPrice + atr * 0.15).map((z) => z.bottom),
      ...extSwings.highs.slice(-6).filter((h) => h.price > currentPrice + atr * 0.25).map((h) => h.price),
    ];
    const nearestResBarrier = bullBarriers.length ? Math.min(...bullBarriers) : null;

    const bearBarriers = [
      ...orderBlocks.filter((z) => z.type === "bullish" && z.top < currentPrice - atr * 0.15).map((z) => z.top),
      ...extSwings.lows.slice(-6).filter((l) => l.price < currentPrice - atr * 0.25).map((l) => l.price),
    ];
    const nearestSupBarrier = bearBarriers.length ? Math.max(...bearBarriers) : null;

    let action = "WAIT";
    let entry = round2(currentPrice);
    let riskDist = round2(atr * 1.45);
    let sl = 0;
    let tp1 = 0;
    let tp2 = 0;
    let tp3 = 0;
    let blockedReason = null;

    if (buyScore >= minDomReq && buyScore - sellScore >= minEdgeReq && posPct <= 62 && last.rsi < 72 && sidewayBullOk) {
      const localLow = Math.min(...candles.slice(-8).map((c) => c.low));
      const invalPt = nearBullPoi && Math.abs(entry - nearBullPoi.bottom) <= atr * 2.0 ? Math.min(localLow, nearBullPoi.bottom) : localLow;
      const rawDist = entry - invalPt + atr * 0.4;
      riskDist = round2(Math.min(Math.max(rawDist, atr * 1.0), atr * 2.1));
      if (nearestResBarrier !== null && nearestResBarrier - entry < riskDist * 1.05) {
        blockedReason = `⚠️ Cản kháng cự ngay trên đầu ($${round2(nearestResBarrier)}) làm R:R thực tế < 1.1:1 — Không vào đuổi!`;
      } else {
        action = "BUY";
        sl = round2(entry - riskDist);
        tp1 = round2(entry + riskDist * 1.6);
        tp2 = round2(entry + riskDist * 2.5);
        tp3 = round2(entry + riskDist * 3.5);
      }
    } else if (sellScore >= minDomReq && sellScore - buyScore >= minEdgeReq && posPct >= 38 && last.rsi > 28 && sidewayBearOk) {
      const localHigh = Math.max(...candles.slice(-8).map((c) => c.high));
      const invalPt = nearBearPoi && Math.abs(nearBearPoi.top - entry) <= atr * 2.0 ? Math.max(localHigh, nearBearPoi.top) : localHigh;
      const rawDist = invalPt - entry + atr * 0.4;
      riskDist = round2(Math.min(Math.max(rawDist, atr * 1.0), atr * 2.1));
      if (nearestSupBarrier !== null && entry - nearestSupBarrier < riskDist * 1.05) {
        blockedReason = `⚠️ Đỡ hỗ trợ ngay dưới chân ($${round2(nearestSupBarrier)}) làm R:R thực tế < 1.1:1 — Không bán đâm đầu vào hỗ trợ!`;
      } else {
        action = "SELL";
        sl = round2(entry + riskDist);
        tp1 = round2(entry - riskDist * 1.6);
        tp2 = round2(entry - riskDist * 2.5);
        tp3 = round2(entry - riskDist * 3.5);
      }
    }

    const waitIsBear = smcTrend === "bearish" || (smcTrend !== "bullish" && sellScore > buyScore);
    if (action === "WAIT") {
      if (blockedReason) reasons.unshift(blockedReason);
      if (!isBull && posPct < 38) {
        reasons.unshift(`🛡️ Chống bán đuổi đáy (Vị trí ${posPct}% | RSI ${last.rsi}) — Đợi hồi lên vùng Cung/OB mới canh Bán!`);
      } else if (isBull && posPct > 62) {
        reasons.unshift(`🛡️ Chống mua đuổi đỉnh (Vị trí ${posPct}% | RSI ${last.rsi}) — Đợi hồi về vùng Cầu/OB mới canh Mua!`);
      }
      if (waitIsBear) {
        const targetPull = nearBearPoi ? nearBearPoi.bottom : currentPrice + atr * 1.15;
        entry = round2(Math.min(Math.max(targetPull, currentPrice + atr * 0.65), currentPrice + atr * 2.1));
        riskDist = round2(atr * 1.45);
        sl = round2(entry + riskDist);
        tp1 = round2(entry - riskDist * 1.6);
        tp2 = round2(entry - riskDist * 2.5);
        tp3 = round2(entry - riskDist * 3.5);
      } else {
        const targetPull = nearBullPoi ? nearBullPoi.top : currentPrice - atr * 1.15;
        entry = round2(Math.max(Math.min(targetPull, currentPrice - atr * 0.65), currentPrice - atr * 2.1));
        riskDist = round2(atr * 1.45);
        sl = round2(entry - riskDist);
        tp1 = round2(entry + riskDist * 1.6);
        tp2 = round2(entry + riskDist * 2.5);
        tp3 = round2(entry + riskDist * 3.5);
      }
    }
    const rrRatio = round2(Math.abs(tp2 - entry) / Math.max(riskDist, 0.01));

    const lastSweep = sweeps[sweeps.length - 1];
    const lastEv = structureEvents[structureEvents.length - 1];
    const lastOb = orderBlocks[orderBlocks.length - 1];
    const lastFvg = fvgs[fvgs.length - 1];

    const causalChain = [
      {
        type: "LIQUIDITY SWEEP",
        text: lastSweep
          ? `${lastSweep.desc} tại nến #${lastSweep.index}.`
          : `Thanh khoản tích tụ quanh PDH ($${pdh}) / PDL ($${pdl}).`,
      },
      {
        type: "DISPLACEMENT",
        text: displacements.length
          ? `Xuất hiện cụm nến xung lực (${displacements[displacements.length - 1].body_atr_ratio}x ATR) xác nhận dòng tiền tổ chức.`
          : `Giá vận động theo cấu trúc EMA 20 ($${last.ema20}) & VWAP ($${last.vwap}).`,
      },
      {
        type: "MSS / BOS",
        text: lastEv
          ? `${lastEv.causal_desc}.`
          : `Duy trì cấu trúc chính ${smcTrend.toUpperCase()} (${isBull ? "HH / HL" : "LH / LL"}).`,
      },
      {
        type: "POI / OB & FVG",
        text:
          lastOb || lastFvg
            ? `Hình thành vùng hợp lưu ${lastOb ? `${lastOb.type.toUpperCase()} OB ($${lastOb.bottom}-$${lastOb.top})` : `${lastFvg.type.toUpperCase()} FVG ($${lastFvg.bottom}-$${lastFvg.top})`} đồng thuận với POC ($${poc}).`
            : `Giá đang ở vùng ${dealingRange.zone_status} (Vị trí ${posPct}%).`,
      },
    ];

    const activeModelName = isBull
      ? "Model 1: Liquidity Sweep + MSS + Bullish OB/FVG Retest"
      : "Model 2: BSL Sweep + MSS + Bearish OB/Supply Reject";

    // Build Future Conditional Roadmap (IF-THEN: BOS Continuation, CHoCH Reversal, Sweep Trap, POI Retest)
    const highCands = extSwings.highs.filter((h) => h.price > currentPrice + atr * 0.35).map((h) => h.price);
    const lowCands = extSwings.lows.filter((l) => l.price < currentPrice - atr * 0.35).map((l) => l.price);
    const recentWinHigh = Math.max(...candles.slice(-18).map((c) => c.high));
    const recentWinLow = Math.min(...candles.slice(-18).map((c) => c.low));
    let resHigh = highCands.length ? round2(Math.min(...highCands)) : round2(Math.max(currentPrice + atr * 1.3, recentWinHigh));
    let supLow = lowCands.length ? round2(Math.max(...lowCands)) : round2(Math.min(currentPrice - atr * 1.3, recentWinLow));
    if (resHigh - currentPrice > atr * 4.2) {
      resHigh = recentWinHigh >= currentPrice + atr * 0.4 ? round2(recentWinHigh) : round2(currentPrice + atr * 1.5);
    }
    if (resHigh < currentPrice + atr * 0.35) resHigh = round2(currentPrice + atr * 1.15);
    if (currentPrice - supLow > atr * 4.2) {
      supLow = recentWinLow <= currentPrice - atr * 0.4 ? round2(recentWinLow) : round2(currentPrice - atr * 1.5);
    }
    if (supLow > currentPrice - atr * 0.35) supLow = round2(currentPrice - atr * 1.15);

    const bosTrigger = isBull ? resHigh : supLow;
    const chochTrigger = isBull ? supLow : resHigh;
    const tfLabel = timeframe.toUpperCase();
    const futureRoadmap = [];

    if (isBull) {
      const retestE = round2(bosTrigger - atr * 0.35);
      const rSl = round2(retestE - atr * 1.35);
      const rRisk = Math.max(Math.abs(retestE - rSl), atr * 0.9);
      const rTp1 = round2(bosTrigger + rRisk * 1.4);
      const rTp2 = round2(bosTrigger + rRisk * 2.4);
      futureRoadmap.push({
        id: "ROADMAP_BOS_CONT",
        tag: "KÈO 1 • PHÁ BOS TĂNG",
        title: `Tiếp diễn Tăng nếu phá BOS trên $${bosTrigger}`,
        direction: "BUY",
        trigger_type: "BOS",
        trigger_price: bosTrigger,
        condition: `NẾU nến ${tfLabel} đóng thân vượt đỉnh $${bosTrigger} (xác nhận BOS Tăng) ➔ Giá hồi nhẹ test vùng FVG/OB mới quanh $${retestE} rồi tăng tiếp.`,
        entry: retestE,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((rTp2 - retestE) / rRisk),
        invalidation: `Đóng nến thủng ngược dưới $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 2.5, price: bosTrigger, label: `Phá BOS $${bosTrigger}` },
          { slot: 5.0, price: retestE, label: "Hồi test Entry" },
          { slot: 8.0, price: rTp1, label: "TP1" },
          { slot: 10.5, price: rTp2, label: "TP2" },
        ],
      });
    } else {
      const retestE = round2(bosTrigger + atr * 0.35);
      const rSl = round2(retestE + atr * 1.35);
      const rRisk = Math.max(Math.abs(rSl - retestE), atr * 0.9);
      const rTp1 = round2(bosTrigger - rRisk * 1.4);
      const rTp2 = round2(bosTrigger - rRisk * 2.4);
      futureRoadmap.push({
        id: "ROADMAP_BOS_CONT",
        tag: "KÈO 1 • PHÁ BOS GIẢM",
        title: `Tiếp diễn Giảm nếu phá BOS dưới $${bosTrigger}`,
        direction: "SELL",
        trigger_type: "BOS",
        trigger_price: bosTrigger,
        condition: `NẾU nến ${tfLabel} đóng thân thủng đáy $${bosTrigger} (xác nhận BOS Giảm) ➔ Canh giá hồi nhẹ lên vùng Supply/FVG quanh $${retestE} để BÁN tiếp diễn.`,
        entry: retestE,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((retestE - rTp2) / rRisk),
        invalidation: `Đóng nến vượt ngược lên trên $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 2.5, price: bosTrigger, label: `Phá BOS $${bosTrigger}` },
          { slot: 5.0, price: retestE, label: "Hồi test Entry" },
          { slot: 8.0, price: rTp1, label: "TP1" },
          { slot: 10.5, price: rTp2, label: "TP2" },
        ],
      });
    }

    if (!isBull) {
      const retestE = round2(chochTrigger - atr * 0.35);
      const rSl = round2(retestE - atr * 1.35);
      const rRisk = Math.max(Math.abs(retestE - rSl), atr * 0.9);
      const rTp1 = round2(chochTrigger + rRisk * 1.4);
      const rTp2 = round2(chochTrigger + rRisk * 2.4);
      futureRoadmap.push({
        id: "ROADMAP_CHOCH_REV",
        tag: "KÈO 2 • ĐẢO CHIỀU CHoCH TĂNG",
        title: `Đổi chiều Đánh Lên nếu phá CHoCH trên $${chochTrigger}`,
        direction: "BUY",
        trigger_type: "CHoCH",
        trigger_price: chochTrigger,
        condition: `NẾU giá không phá được đáy mà bật vượt đóng nến qua đỉnh $${chochTrigger} (xác nhận CHoCH / MSS Tăng) ➔ Bỏ phe Bán, canh hồi về Bullish OB quanh $${retestE} để MUA LÊN.`,
        entry: retestE,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((rTp2 - retestE) / rRisk),
        invalidation: `Giá sập lại thủng dưới $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 2.8, price: chochTrigger, label: `CHoCH $${chochTrigger}` },
          { slot: 5.3, price: retestE, label: "Hồi mua OTE" },
          { slot: 8.2, price: rTp1, label: "TP1" },
          { slot: 10.5, price: rTp2, label: "TP2" },
        ],
      });
    } else {
      const retestE = round2(chochTrigger + atr * 0.35);
      const rSl = round2(retestE + atr * 1.35);
      const rRisk = Math.max(Math.abs(rSl - retestE), atr * 0.9);
      const rTp1 = round2(chochTrigger - rRisk * 1.4);
      const rTp2 = round2(chochTrigger - rRisk * 2.4);
      futureRoadmap.push({
        id: "ROADMAP_CHOCH_REV",
        tag: "KÈO 2 • ĐẢO CHIỀU CHoCH GIẢM",
        title: `Đổi chiều Đánh Xuống nếu phá CHoCH dưới $${chochTrigger}`,
        direction: "SELL",
        trigger_type: "CHoCH",
        trigger_price: chochTrigger,
        condition: `NẾU giá quay đầu đóng nến thủng đáy $${chochTrigger} (xác nhận CHoCH / MSS Giảm) ➔ Bỏ phe Mua, canh hồi lên Bearish OB quanh $${retestE} để BÁN XUỐNG.`,
        entry: retestE,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((retestE - rTp2) / rRisk),
        invalidation: `Giá bật ngược đóng nến trên $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 2.8, price: chochTrigger, label: `CHoCH $${chochTrigger}` },
          { slot: 5.3, price: retestE, label: "Hồi bán OTE" },
          { slot: 8.2, price: rTp1, label: "TP1" },
          { slot: 10.5, price: rTp2, label: "TP2" },
        ],
      });
    }

    if (!isBull) {
      const sweepWick = round2(supLow - atr * 0.35);
      const trapE = round2(supLow + atr * 0.2);
      const rSl = round2(sweepWick - atr * 0.9);
      const rRisk = Math.max(Math.abs(trapE - rSl), atr * 0.8);
      const rTp1 = round2(trapE + rRisk * 1.6);
      const rTp2 = round2(Math.min(resHigh, trapE + rRisk * 2.6));
      futureRoadmap.push({
        id: "ROADMAP_SWEEP_TRAP",
        tag: "KÈO 3 • BẪY QUÉT RÂU SSL",
        title: `Bắt Đảo Chiều nếu chọc râu quét $${supLow} rồi rút lên`,
        direction: "BUY",
        trigger_type: "SWEEP",
        trigger_price: supLow,
        condition: `NẾU giá chọc râu xuống dưới $${supLow} quét Stop-Loss nhưng KHÔNG đóng thân nến qua (rút chân Pin Bar) ➔ Bẫy giảm, canh MUA hồi lên $${rTp1}.`,
        entry: trapE,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((rTp2 - trapE) / rRisk),
        invalidation: `Nến ${tfLabel} đóng thân đặc dưới $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 2.2, price: sweepWick, label: "Quét râu SSL" },
          { slot: 4.2, price: trapE, label: "Rút chân Entry" },
          { slot: 8.5, price: rTp1, label: "TP1" },
        ],
      });
    } else {
      const sweepWick = round2(resHigh + atr * 0.35);
      const trapE = round2(resHigh - atr * 0.2);
      const rSl = round2(sweepWick + atr * 0.9);
      const rRisk = Math.max(Math.abs(rSl - trapE), atr * 0.8);
      const rTp1 = round2(trapE - rRisk * 1.6);
      const rTp2 = round2(Math.max(supLow, trapE - rRisk * 2.6));
      futureRoadmap.push({
        id: "ROADMAP_SWEEP_TRAP",
        tag: "KÈO 3 • BẪY QUÉT RÂU BSL",
        title: `Bắt Đảo Chiều nếu chọc râu quét $${resHigh} rồi xả`,
        direction: "SELL",
        trigger_type: "SWEEP",
        trigger_price: resHigh,
        condition: `NẾU giá chọc râu vượt đỉnh $${resHigh} quét thanh khoản Mua rồi rút đầu mạnh ➔ Bẫy tăng, canh BÁN ăn nhịp điều chỉnh về $${rTp1}.`,
        entry: trapE,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((trapE - rTp2) / rRisk),
        invalidation: `Nến ${tfLabel} đóng thân đặc vượt trên $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 2.2, price: sweepWick, label: "Quét râu BSL" },
          { slot: 4.2, price: trapE, label: "Rút đầu Entry" },
          { slot: 8.5, price: rTp1, label: "TP1" },
        ],
      });
    }

    const poiZone = isBull ? nearBullPoi : nearBearPoi;
    if (isBull) {
      const zTop = poiZone ? poiZone.top : round2(currentPrice - atr * 0.65);
      const zBot = poiZone ? poiZone.bottom : round2(currentPrice - atr * 1.45);
      const rSl = round2(zBot - atr * 0.5);
      const rRisk = Math.max(Math.abs(zTop - rSl), atr * 0.85);
      const rTp1 = round2(zTop + rRisk * 1.6);
      const rTp2 = round2(zTop + rRisk * 2.5);
      futureRoadmap.push({
        id: "ROADMAP_POI_RETEST",
        tag: "KÈO 4 • CANH RETEST CẦU / OB",
        title: `Đợi hồi chạm Bullish OB/FVG ($${zBot} - $${zTop})`,
        direction: "BUY",
        trigger_type: "POI",
        trigger_price: zTop,
        condition: `Không FOMO đuổi giá: NẾU giá lùi về vùng cầu $${zBot} - $${zTop} kèm nến từ chối ➔ Vào MUA thuận sóng với SL cực ngắn.`,
        entry: zTop,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((rTp2 - zTop) / rRisk),
        invalidation: `Đóng nến thủng vùng cầu $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 3.0, price: zTop, label: "Chạm Cầu/OB" },
          { slot: 7.0, price: rTp1, label: "TP1" },
          { slot: 10.0, price: rTp2, label: "TP2" },
        ],
      });
    } else {
      const zBot = poiZone ? poiZone.bottom : round2(currentPrice + atr * 0.65);
      const zTop = poiZone ? poiZone.top : round2(currentPrice + atr * 1.45);
      const rSl = round2(zTop + atr * 0.5);
      const rRisk = Math.max(Math.abs(rSl - zBot), atr * 0.85);
      const rTp1 = round2(zBot - rRisk * 1.6);
      const rTp2 = round2(zBot - rRisk * 2.5);
      futureRoadmap.push({
        id: "ROADMAP_POI_RETEST",
        tag: "KÈO 4 • CANH RETEST CUNG / OB",
        title: `Đợi hồi lên Bearish OB/FVG ($${zBot} - $${zTop})`,
        direction: "SELL",
        trigger_type: "POI",
        trigger_price: zBot,
        condition: `Không FOMO bán đuổi: NẾU giá nảy hồi lên vùng cung $${zBot} - $${zTop} và rút râu ➔ Vào BÁN thuận xu hướng giảm.`,
        entry: zBot,
        sl: rSl,
        tp1: rTp1,
        tp2: rTp2,
        rr: round2((zBot - rTp2) / rRisk),
        invalidation: `Đóng nến vượt vùng cung $${rSl}`,
        path_points: [
          { slot: 0, price: currentPrice, label: "Hiện tại" },
          { slot: 3.0, price: zBot, label: "Chạm Cung/OB" },
          { slot: 7.0, price: rTp1, label: "TP1" },
          { slot: 10.0, price: rTp2, label: "TP2" },
        ],
      });
    }

    const bullScenarioEntry = action === "BUY" ? entry : (nearBullPoi ? nearBullPoi.top : round2(Math.min(currentPrice - atr * 0.65, pdl + atr * 0.3)));
    const bullScenarioSl = action === "BUY" ? sl : round2((nearBullPoi ? nearBullPoi.bottom : bullScenarioEntry - atr * 1.1) - atr * 0.45);
    const bullScenarioRisk = Math.max(Math.abs(bullScenarioEntry - bullScenarioSl), atr * 0.85);
    const bearScenarioEntry = action === "SELL" ? entry : (nearBearPoi ? nearBearPoi.bottom : round2(Math.max(currentPrice + atr * 0.65, pdh - atr * 0.3)));
    const bearScenarioSl = action === "SELL" ? sl : round2((nearBearPoi ? nearBearPoi.top : bearScenarioEntry + atr * 1.1) + atr * 0.45);
    const bearScenarioRisk = Math.max(Math.abs(bearScenarioSl - bearScenarioEntry), atr * 0.85);

    return {
      success: true,
      is_fallback: false,
      data_source: symbol === "XAU/USD" ? "PAXG_SPOT_PROXY" : "LIVE_EXCHANGE",
      engine_source: "GITHUB_PAGES_CLIENT_ENGINE",
      symbol,
      timeframe,
      mode,
      current_price: currentPrice,
      action,
      confidence,
      buy_score: buyScore,
      sell_score: sellScore,
      net_edge: netEdge,
      reasons,
      entry,
      sl,
      sl_distance: riskDist,
      tp1,
      tp2,
      tp3,
      rr_ratio: rrRatio,
      indicators: {
        atr: last.atr,
        rsi: last.rsi,
        adx: last.adx,
        std_dev: last.std_dev,
        vwap: last.vwap,
        bb_upper: last.bb_upper,
        bb_lower: last.bb_lower,
        ema20: last.ema20,
        ema50: last.ema50,
        ema200: last.ema200,
      },
      mtf_matrix: mtfMatrix,
      smc: {
        trend: smcTrend,
        external_swings: extSwings.all.slice(-12),
        internal_swings: intSwings.all.slice(-12),
        structure_events: structureEvents.slice(-5),
        order_blocks: orderBlocks,
        breaker_blocks: breakerBlocks,
        fvg: fvgs,
        sweeps: sweeps.slice(-4),
        dealing_range: dealingRange,
      },
      ict: {
        ny_time: nyTimeStr,
        is_dst: true,
        active_killzone: activeKillzone,
        silver_bullet_window: silverBullet,
        pdh,
        pdl,
        pwh,
        pwl,
        asian_high: asianHigh,
        asian_low: asianLow,
        amd_phase: nyHour < 5 ? "Accumulation (Tích lũy)" : nyHour < 10 ? "Manipulation (Judas Swing)" : "Distribution (Phân phối)",
        judas_swing: sweeps.length
          ? `${sweeps[sweeps.length - 1].desc} — Xác nhận mô hình Judas Swing đầu phiên!`
          : `Đang theo dõi quét biên Asian Range ($${asianLow} - $${asianHigh})`,
      },
      supply_demand: activeSdZones,
      volume_profile: {
        poc,
        vah,
        val,
        profile: bins,
      },
      quant_pro: {
        regime: {
          code: isSideway ? "SIDEWAY_RANGE" : (isTrending ? "STRONG_TREND" : "TRANSITION"),
          name: isSideway ? "ĐI NGANG (SIDEWAY)" : (isTrending ? "XU HƯỚNG MẠNH" : "CHUYỂN PHA"),
          adx: last.adx,
        },
        order_flow: {
          buy_delta_pct: orderbook.bid_pct,
          sell_delta_pct: orderbook.ask_pct,
          rvol: last.rvol,
          orderbook: { available: orderbook.available, bid_pct: orderbook.bid_pct, ask_pct: orderbook.ask_pct },
          volume_source_note:
            symbol === "XAU/USD"
              ? "XAU/USD trên web đọc nến Proxy PAXG/USDT Spot (có thể lệch $5-$25 so với Spot/CFD)."
              : `${symbol} sử dụng Volume khớp lệnh tập trung trực tiếp từ Binance / OKX / Bybit.`,
        },
      },
      causal_chain: causalChain,
      trading_plan: { active_model: action === "WAIT" ? "WAIT - Chờ hồi POI / Xác nhận MSS" : activeModelName },
      scenarios: {
        bullish: {
          model: "Liquidity Sweep + MSS + Bullish OB",
          condition: `Chờ giá giữ vững trên Bullish OB / POC ($${poc}), ưu tiên canh mua khi hồi về vùng Cầu.`,
          entry: bullScenarioEntry,
          sl: bullScenarioSl,
          tp1: action === "BUY" ? tp1 : round2(bullScenarioEntry + bullScenarioRisk * 1.8),
          tp2: action === "BUY" ? tp2 : round2(Math.max(bullScenarioEntry + bullScenarioRisk * 2.8, pdh)),
          invalidation: `Đóng nến thủng dưới $${bullScenarioSl}`,
        },
        bearish: {
          model: "BSL Sweep + Bearish OB / Supply",
          condition: `Kích hoạt khi giá hồi lên vùng Premium / Bearish OB và xuất hiện nến từ chối giảm.`,
          entry: bearScenarioEntry,
          sl: bearScenarioSl,
          tp1: action === "SELL" ? tp1 : round2(bearScenarioEntry - bearScenarioRisk * 1.8),
          tp2: action === "SELL" ? tp2 : round2(Math.min(bearScenarioEntry - bearScenarioRisk * 2.8, pdl)),
          invalidation: `Đóng nến vượt lên trên $${bearScenarioSl}`,
        },
      },
      future_roadmap: futureRoadmap,
      candles,
    };
  }

  function formatTelegramCaption(data) {
    const rawAct = (data.action || "WAIT").toUpperCase();
    const trendLower = (data.smc?.trend || "neutral").toLowerCase();
    const posPct = data.smc?.dealing_range?.current_pct ?? 50;
    const zoneTag = Number(posPct) <= 50 ? "DISCOUNT (Giá Rẻ)" : "PREMIUM (Giá Đắt)";

    let icon = "⏳⚠️";
    let actVn = `WAIT — ${trendLower === "bearish" ? "Canh Hồi BÁN" : trendLower === "bullish" ? "Canh Hồi MUA" : "Quan sát"} (KHÔNG ĐUỔI GIÁ)`;
    let entryLabel = "Entry Limit Chờ Hồi";
    if (rawAct === "BUY") {
      icon = "🟢📈";
      actVn = "MUA (BUY ACTIVE)";
      entryLabel = "Entry";
    } else if (rawAct === "SELL") {
      icon = "🔴📉";
      actVn = "BÁN (SELL ACTIVE)";
      entryLabel = "Entry";
    }

    const mtfStr = (data.mtf_matrix || [])
      .map((m) => `${m.tf}: <b>${m.trend.split(" ")[0]}</b>`)
      .join(" | ");
    const reasonsBlock = (data.reasons || []).slice(0, 3).map((r) => `• ${r}`).join("\n");
    const chainStr =
      reasonsBlock ||
      (data.causal_chain || [])
        .slice(0, 3)
        .map((c) => `• <b>[${c.type}]</b>: ${c.text}`)
        .join("\n");
    const roadStr = (data.future_roadmap || [])
      .slice(0, 2)
      .map((r) => `• <b>${r.trigger_type} $${r.trigger_price}</b> ➔ ${r.direction} Entry <code>$${r.entry}</code> | TP <code>$${r.tp1}</code>`)
      .join("\n");

    return (
      `${icon} <b>GOLDVISION AI — TÍN HIỆU ${data.symbol} (${data.timeframe.toUpperCase()})</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🎯 <b>Tín hiệu:</b> <code>${actVn}</code> (Độ tin cậy: <b>${data.confidence}%</b>)\n` +
      `💰 <b>Giá hiện tại:</b> <code>$${data.current_price}</code> (${posPct}% ${zoneTag})\n` +
      `📍 <b>${entryLabel}:</b> <code>$${data.entry}</code> | 🛑 <b>SL:</b> <code>$${data.sl}</code>\n` +
      `✅ <b>TP1:</b> <code>$${data.tp1}</code> | 🏆 <b>TP2:</b> <code>$${data.tp2}</code> (R:R 1:${data.rr_ratio})\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      (roadStr ? `🔮 <b>Kèo chờ tương lai (BOS / CHoCH):</b>\n${roadStr}\n━━━━━━━━━━━━━━━━━━\n` : "") +
      `🌐 <b>Đa khung (MTF):</b> ${mtfStr}\n` +
      `📊 <b>POC:</b> <code>$${data.volume_profile?.poc || "--"}</code> | <b>RSI:</b> ${data.indicators?.rsi} | <b>ADX:</b> ${data.indicators?.adx}\n` +
      `🔗 <b>Hội tụ & An toàn:</b>\n${chainStr}`
    );
  }

  async function autoDetectChatId(botToken) {
    const cleanToken = (botToken || "").trim();
    if (!cleanToken) {
      throw new Error("Vui lòng nhập Telegram Bot Token trước!");
    }
    const resp = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=25`);
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.description || "Bot Token không hợp lệ!");
    }
    const updates = data.result || [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chat =
        u.message?.chat ||
        u.channel_post?.chat ||
        u.my_chat_member?.chat ||
        u.edited_message?.chat ||
        u.callback_query?.message?.chat;
      if (chat && chat.id) {
        const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Telegram User";
        return { chatId: String(chat.id), chatName: name };
      }
    }
    throw new Error(
      "Chưa tìm thấy cuộc trò chuyện nào! Hãy mở Telegram, bấm vào Bot của bạn rồi nhắn chữ 'alo' (hoặc bấm /start), sau đó thử lại!"
    );
  }

  async function sendSignalToTelegram(botToken, chatId, data, canvasEl) {
    if (data && data.is_fallback) {
      throw new Error("Đang dùng dữ liệu giả lập offline — Hủy gửi Telegram để tránh nhầm lệnh!");
    }
    const cleanToken = (botToken || "").trim();
    let cleanChatId = (chatId || "").trim();
    if (!cleanToken) {
      throw new Error("Vui lòng nhập Telegram Bot Token!");
    }
    if (!cleanChatId) {
      const detected = await autoDetectChatId(cleanToken);
      cleanChatId = detected.chatId;
    }

    const caption = formatTelegramCaption(data);

    if (canvasEl && typeof canvasEl.toBlob === "function") {
      const blob = await new Promise((resolve) => canvasEl.toBlob(resolve, "image/png", 0.95));
      if (blob) {
        const form = new FormData();
        form.append("chat_id", cleanChatId);
        form.append("photo", blob, `GoldVision_${data.symbol.replace("/", "")}_${data.timeframe}.png`);
        form.append("caption", caption);
        form.append("parse_mode", "HTML");

        const resp = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
          method: "POST",
          body: form,
        });
        const resJson = await resp.json();
        if (!resJson.ok) {
          throw new Error(resJson.description || "Lỗi gửi ảnh Telegram");
        }
        resJson.detectedChatId = cleanChatId;
        return resJson;
      }
    }

    const resp = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: caption,
        parse_mode: "HTML",
      }),
    });
    const resJson = await resp.json();
    if (!resJson.ok) {
      throw new Error(resJson.description || "Lỗi gửi tin nhắn Telegram");
    }
    resJson.detectedChatId = cleanChatId;
    return resJson;
  }

  global.GoldVisionClientEngine = {
    fetchLiveCandles,
    fetchLiveOrderbook,
    analyzeGoldClientSide,
    autoDetectChatId,
    sendSignalToTelegram,
    formatTelegramCaption,
  };
})(window);
