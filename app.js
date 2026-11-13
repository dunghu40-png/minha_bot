/**
 * GoldVision AI - TradingView & KLineChart-UI-Core Inspired Interactive Terminal
 * Features:
 * 1. Multi-Exchange Live WebSocket Streaming (Binance / OKX / Bybit real-time kline ticks)
 * 2. Dynamic Visible-Range Volume Profile (VPVR) with Up/Down Volume Split & POC/VAH/VAL
 * 3. TradingView Long/Short Position R:R Shaded Target & Stop Boxes
 * 4. Smooth Mouse Wheel Zoom, Click-Drag Pan, Right Y-Axis Scale Drag & Double-Click Reset
 * 5. Anti-Collision Label Engine & Click-to-Inspect Causal Event Chain
 */

const API_BASE = (window.location.protocol === "file:" || !window.location.host)
  ? "http://127.0.0.1:8585"
  : "";

const MODE_PRESETS = {
  clean: ["structure", "supply_demand"],
  smc: ["structure", "liquidity", "order_blocks", "imbalance", "ict"],
  full: ["structure", "liquidity", "order_blocks", "imbalance", "supply_demand", "ict", "price_action", "indicators"]
};

let currentSymbol = "PAXG/USDT";
let currentTimeframe = "1h";
let currentMode = "clean";
let activeLayers = new Set(MODE_PRESETS.clean);
let hideAllAnnotations = false;
let currentData = null;
let interactiveHitBoxes = [];
let selectedInspectId = null;
let showFutureRoadmap = true;
let selectedRoadmapId = null;

// Live WebSocket Connection State
let activeWs = null;
let wsPingTimer = null;
let liveStreamSource = "REST";

// TradingView Interactive Viewport State
const viewState = {
  startIdx: 0,
  visibleCount: 55,
  priceZoom: 1.0,
  priceOffset: 0.0,
  isDragging: false,
  dragMode: "pan",
  dragStartX: 0,
  dragStartY: 0,
  dragMovedPx: 0,
  startIdxAtDrag: 0,
  priceOffsetAtDrag: 0,
  priceZoomAtDrag: 1.0,
  lastPriceSpan: 50.0,
  mouseX: -1,
  mouseY: -1,
  hoveredCandle: null
};

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

let _toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toastMessage");
  if (!toast) return;
  toast.innerHTML = `<span>${msg}</span>`;
  toast.style.display = "block";
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 2800);
}

document.addEventListener("DOMContentLoaded", () => {
  initControls();
  runAnalysis();
});

function resetChartView() {
  if (!currentData || !currentData.candles) return;
  const total = currentData.candles.length;
  viewState.visibleCount = Math.min(55, total);
  viewState.startIdx = Math.max(0, total - viewState.visibleCount);
  viewState.priceZoom = 1.0;
  viewState.priceOffset = 0.0;
  drawInteractiveChart();
}

function zoomChartBy(factor, anchorRatio = 0.75) {
  if (!currentData || !currentData.candles) return;
  const total = currentData.candles.length;
  const oldCount = viewState.visibleCount;
  const newCount = Math.max(16, Math.min(total, oldCount * factor));
  const anchorCandle = viewState.startIdx + oldCount * anchorRatio;
  viewState.visibleCount = newCount;
  viewState.startIdx = Math.max(0, Math.min(total - newCount, anchorCandle - newCount * anchorRatio));
  drawInteractiveChart();
}

/**
 * Real-Time WebSocket KLine Stream (inspired by klinechart-ui-core/datafeed/binance.ts & okx.ts)
 */
function connectLiveKlineStream(symbol, timeframe) {
  if (activeWs) {
    try { activeWs.onclose = null; activeWs.close(); } catch (_) {}
    activeWs = null;
  }
  if (wsPingTimer) {
    clearInterval(wsPingTimer);
    wsPingTimer = null;
  }

  if (symbol === "XAU/USD" && currentData && currentData.data_source === "YAHOO_GC_FUTURES") {
    liveStreamSource = "COMEX GC=F SNAPSHOT";
    return;
  }
  if (currentData && currentData.is_fallback) {
    liveStreamSource = "OFFLINE FALLBACK";
    return;
  }

  try {
    if (symbol === "XAUT/USDT") {
      // OKX Public WebSocket v5
      const okxBarMap = { "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" };
      const bar = okxBarMap[timeframe] || "1H";
      const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
      activeWs = ws;
      ws.onopen = () => {
        liveStreamSource = "OKX WS LIVE";
        ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: `candle${bar}`, instId: "XAUT-USDT" }] }));
        wsPingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 22000);
      };
      ws.onmessage = (evt) => {
        if (evt.data === "pong") return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.data && msg.data.length > 0) {
            const k = msg.data[0];
            applyRealtimeTick({
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[5])
            });
          }
        } catch (_) {}
      };
      ws.onerror = () => {};
    } else {
      // Binance Public WebSocket Stream (PAXGUSDT)
      const stream = `paxgusdt@kline_${timeframe}`;
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
      activeWs = ws;
      ws.onopen = () => {
        liveStreamSource = "BINANCE WS LIVE";
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.e === "kline" && msg.k) {
            const k = msg.k;
            applyRealtimeTick({
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v)
            });
          }
        } catch (_) {}
      };
      ws.onerror = () => {};
    }
  } catch (e) {
    console.warn("WebSocket stream fallback:", e);
  }
}

function applyRealtimeTick(tick) {
  if (!currentData || !currentData.candles || currentData.candles.length === 0) return;
  if (!tick || isNaN(tick.close)) return;

  const lastIdx = currentData.candles.length - 1;
  const lastC = currentData.candles[lastIdx];
  lastC.close = Number(tick.close.toFixed(2));
  if (tick.high > lastC.high) lastC.high = Number(tick.high.toFixed(2));
  if (tick.low < lastC.low) lastC.low = Number(tick.low.toFixed(2));
  if (tick.volume > lastC.volume) lastC.volume = Number(tick.volume.toFixed(2));

  currentData.current_price = lastC.close;
  setText("currentPriceBadge", fmtPrice(lastC.close));
  if (!viewState.isDragging) {
    drawInteractiveChart();
  }
}

/**
 * Compute Visible-Range Volume Profile (VPVR) with Up/Down Volume Split
 * (Adapted from klinechart-ui-core/src/features/chart/lib/volume-profile/compute.ts & draw-volume-profile.ts)
 */
function computeVisibleVPVR(candlesSlice, binsCount = 24) {
  if (!candlesSlice || candlesSlice.length === 0) return null;
  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (const c of candlesSlice) {
    if (c.low < minLow) minLow = c.low;
    if (c.high > maxHigh) maxHigh = c.high;
  }
  if (maxHigh <= minLow) return null;

  const step = (maxHigh - minLow) / binsCount;
  const rows = [];
  for (let i = 0; i < binsCount; i++) {
    rows.push({
      index: i,
      priceLow: minLow + i * step,
      priceHigh: minLow + (i + 1) * step,
      priceMid: minLow + (i + 0.5) * step,
      upVolume: 0,
      downVolume: 0,
      totalVolume: 0
    });
  }

  for (const c of candlesSlice) {
    const isUp = c.close >= c.open;
    const typical = (c.high + c.low + c.close) / 3;
    const idx = Math.max(0, Math.min(binsCount - 1, Math.floor((typical - minLow) / step)));
    const v = Math.max(c.volume || 1, 1);
    if (isUp) rows[idx].upVolume += v;
    else rows[idx].downVolume += v;
    rows[idx].totalVolume += v;
  }

  let pocIdx = 0;
  let maxVol = 1;
  let totalAll = 0;
  for (let i = 0; i < binsCount; i++) {
    totalAll += rows[i].totalVolume;
    if (rows[i].totalVolume > maxVol) {
      maxVol = rows[i].totalVolume;
      pocIdx = i;
    }
  }

  // 70% Value Area (VAH / VAL)
  const targetVA = totalAll * 0.7;
  let accum = rows[pocIdx].totalVolume;
  let valIdx = pocIdx;
  let vahIdx = pocIdx;
  while (accum < targetVA && (valIdx > 0 || vahIdx < binsCount - 1)) {
    const downV = valIdx > 0 ? rows[valIdx - 1].totalVolume : -1;
    const upV = vahIdx < binsCount - 1 ? rows[vahIdx + 1].totalVolume : -1;
    if (upV >= downV && vahIdx < binsCount - 1) {
      vahIdx++;
      accum += rows[vahIdx].totalVolume;
    } else if (valIdx > 0) {
      valIdx--;
      accum += rows[valIdx].totalVolume;
    } else {
      break;
    }
  }

  return {
    rows,
    maxVol,
    pocIdx,
    valIdx,
    vahIdx,
    pocPrice: Number(rows[pocIdx].priceMid.toFixed(2)),
    vahPrice: Number(rows[vahIdx].priceHigh.toFixed(2)),
    valPrice: Number(rows[valIdx].priceLow.toFixed(2))
  };
}

function initControls() {
  document.querySelectorAll("#symbolSelector .select-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#symbolSelector .select-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentSymbol = btn.dataset.symbol;
      runAnalysis();
    });
  });

  document.querySelectorAll("#tfSelector .select-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tfSelector .select-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTimeframe = btn.dataset.tf;
      runAnalysis();
    });
  });

  document.querySelectorAll("#modeSelector .mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#modeSelector .mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentMode = btn.dataset.mode;
      hideAllAnnotations = false;
      activeLayers = new Set(MODE_PRESETS[currentMode] || MODE_PRESETS.clean);
      syncLayerChipsUI();
      if (currentData) {
        drawInteractiveChart();
        refreshStaticPngForMode();
      }
    });
  });

  document.querySelectorAll("#layersGrid .layer-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const layer = chip.dataset.layer;
      hideAllAnnotations = false;
      if (activeLayers.has(layer)) {
        activeLayers.delete(layer);
      } else {
        activeLayers.add(layer);
      }
      syncLayerChipsUI();
      drawInteractiveChart();
    });
  });

  const btnToggleAnn = document.getElementById("btnToggleAnnotations");
  if (btnToggleAnn) {
    btnToggleAnn.addEventListener("click", () => {
      hideAllAnnotations = !hideAllAnnotations;
      btnToggleAnn.textContent = hideAllAnnotations
        ? "👁️ Hiện lại annotation"
        : "👁️ Ẩn toàn bộ annotation";
      drawInteractiveChart();
    });
  }

  const btnClear = document.getElementById("btnClearLayers");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      activeLayers.clear();
      syncLayerChipsUI();
      drawInteractiveChart();
    });
  }

  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const btnResetView = document.getElementById("btnResetView");
  const btnToggleRoadmap = document.getElementById("btnToggleRoadmap");
  if (btnZoomIn) btnZoomIn.addEventListener("click", () => zoomChartBy(0.8));
  if (btnZoomOut) btnZoomOut.addEventListener("click", () => zoomChartBy(1.25));
  if (btnResetView) btnResetView.addEventListener("click", () => resetChartView());
  if (btnToggleRoadmap) {
    btnToggleRoadmap.addEventListener("click", () => {
      showFutureRoadmap = !showFutureRoadmap;
      btnToggleRoadmap.classList.toggle("active-projection", showFutureRoadmap);
      drawInteractiveChart();
    });
  }

  const tabCanvas = document.getElementById("tabInteractiveCanvas");
  const tabPng = document.getElementById("tabStaticPng");
  const canvasWrap = document.getElementById("interactiveCanvasWrap");
  const pngImg = document.getElementById("annotatedChartImage");

  if (tabCanvas && tabPng) {
    tabCanvas.addEventListener("click", () => {
      tabCanvas.classList.add("active");
      tabPng.classList.remove("active");
      if (canvasWrap) canvasWrap.style.display = "flex";
      if (pngImg) pngImg.style.display = "none";
      drawInteractiveChart();
    });

    tabPng.addEventListener("click", () => {
      tabPng.classList.add("active");
      tabCanvas.classList.remove("active");
      if (canvasWrap) canvasWrap.style.display = "none";
      if (pngImg) pngImg.style.display = "block";
    });
  }

  const btnAnalyze = document.getElementById("btnAnalyze");
  if (btnAnalyze) btnAnalyze.addEventListener("click", () => runAnalysis());

  const btnDownload = document.getElementById("btnDownloadChart");
  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      const canvas = document.getElementById("smcChartCanvas");
      if (canvas) {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `GoldVision_${currentSymbol.replace("/", "")}_${currentTimeframe}.png`;
        a.click();
        showToast("📥 Đã tải ảnh biểu đồ PNG thành công!");
        return;
      }
      if (!currentData || !currentData.chart_image || !currentData.chart_image.base64) return;
      const a = document.createElement("a");
      a.href = currentData.chart_image.base64;
      a.download = currentData.chart_image.filename || "GoldVision_Analysis.png";
      a.click();
    });
  }

  const btnCopy = document.getElementById("btnCopySignal");
  if (btnCopy) btnCopy.addEventListener("click", copySignalToClipboard);

  const inCap = document.getElementById("inputCapital");
  const inRisk = document.getElementById("inputRiskPct");
  if (inCap) inCap.addEventListener("input", updatePositionCalculator);
  if (inRisk) inRisk.addEventListener("input", updatePositionCalculator);

  initTelegramAutoBot();
  initCanvasTradingViewInteractions();
  window.addEventListener("resize", () => {
    if (currentData) drawInteractiveChart();
  });
}

function initCanvasTradingViewInteractions() {
  const canvas = document.getElementById("smcChartCanvas");
  if (!canvas) return;

  canvas.addEventListener("wheel", (evt) => {
    evt.preventDefault();
    if (!currentData || !currentData.candles) return;
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const padLeft = 14;
    const padRight = 104;
    const plotWidth = Math.max(rect.width - padLeft - padRight, 200);
    const ratio = Math.max(0.05, Math.min(0.95, (mx - padLeft) / plotWidth));
    const factor = evt.deltaY < 0 ? 0.86 : 1.16;
    zoomChartBy(factor, ratio);
  }, { passive: false });

  canvas.addEventListener("mousedown", (evt) => {
    if (evt.button !== 0 || !currentData) return;
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    const padRight = 104;

    viewState.isDragging = true;
    viewState.dragStartX = mx;
    viewState.dragStartY = my;
    viewState.dragMovedPx = 0;
    viewState.startIdxAtDrag = viewState.startIdx;
    viewState.priceOffsetAtDrag = viewState.priceOffset;
    viewState.priceZoomAtDrag = viewState.priceZoom;

    if (mx >= rect.width - padRight) {
      viewState.dragMode = "price_scale";
      canvas.style.cursor = "ns-resize";
    } else {
      viewState.dragMode = "pan";
      canvas.style.cursor = "grabbing";
    }
  });

  window.addEventListener("mousemove", (evt) => {
    if (!currentData || !currentData.candles) return;
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    const inside = mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height;

    viewState.mouseX = inside ? mx : -1;
    viewState.mouseY = inside ? my : -1;

    const padLeft = 14;
    const padRight = 104;
    const plotWidth = Math.max(rect.width - padLeft - padRight, 200);
    const mainHeight = 380;

    if (viewState.isDragging) {
      const dx = mx - viewState.dragStartX;
      const dy = my - viewState.dragStartY;
      viewState.dragMovedPx = Math.hypot(dx, dy);

      if (viewState.dragMode === "price_scale") {
        const scaleChange = Math.exp(dy * 0.0045);
        viewState.priceZoom = Math.max(0.35, Math.min(4.5, viewState.priceZoomAtDrag * scaleChange));
      } else {
        const total = currentData.candles.length;
        const candlesPerPx = viewState.visibleCount / plotWidth;
        const newStart = viewState.startIdxAtDrag - dx * candlesPerPx;
        viewState.startIdx = Math.max(0, Math.min(total - viewState.visibleCount, newStart));

        const pricePerPx = viewState.lastPriceSpan / mainHeight;
        viewState.priceOffset = viewState.priceOffsetAtDrag + dy * pricePerPx;
      }
      drawInteractiveChart();
    } else if (inside) {
      canvas.style.cursor = mx >= rect.width - padRight ? "ns-resize" : "crosshair";
      drawInteractiveChart();
    }
  });

  window.addEventListener("mouseup", (evt) => {
    if (!viewState.isDragging) return;
    viewState.isDragging = false;
    canvas.style.cursor = "crosshair";
    if (viewState.dragMovedPx < 5) {
      handleCanvasClick(evt);
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (!viewState.isDragging) {
      viewState.mouseX = -1;
      viewState.mouseY = -1;
      viewState.hoveredCandle = null;
      drawInteractiveChart();
    }
  });

  canvas.addEventListener("dblclick", () => {
    resetChartView();
  });
}

function syncLayerChipsUI() {
  document.querySelectorAll("#layersGrid .layer-chip").forEach(chip => {
    const layer = chip.dataset.layer;
    if (activeLayers.has(layer)) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });
  setText("layersCounter", `Đang bật ${activeLayers.size}/8 lớp`);
}

function buildClientFallbackData(symbol, tf) {
  const candles = [];
  let p = 4120.0;
  for (let i = 0; i < 110; i++) {
    const step = Math.sin(i * 0.22) * 3.0 + (i > 75 ? 1.1 : -0.2);
    const o = Number(p.toFixed(2));
    const c = Number((p + step).toFixed(2));
    const h = Number((Math.max(o, c) + 3.2).toFixed(2));
    const l = Number((Math.min(o, c) - (i === 92 ? 9.5 : 2.8)).toFixed(2));
    p = c;
    candles.push({
      full_index: i,
      datetime: `${String((i % 24)).padStart(2, "0")}:00`,
      open: o, high: h, low: l, close: c,
      volume: 240 + (i % 7) * 65,
      rvol: i === 93 ? 1.9 : 1.1,
      ema20: Number((c - 2.2).toFixed(2)),
      ema50: Number((c - 5.4).toFixed(2)),
      ema200: Number((c - 12.0).toFixed(2)),
      vwap: Number((c - 1.5).toFixed(2)),
      bb_upper: Number((c + 8.5).toFixed(2)),
      bb_lower: Number((c - 8.5).toFixed(2))
    });
  }
  const curr = candles[candles.length - 1].close;
  return {
    success: true,
    is_fallback: true,
    data_source: "OFFLINE_FALLBACK",
    symbol,
    timeframe: tf,
    current_price: curr,
    action: "WAIT",
    confidence: 0,
    entry: curr,
    sl: Number((curr - 9.5).toFixed(2)),
    tp1: Number((curr + 15.2).toFixed(2)),
    tp2: Number((curr + 23.8).toFixed(2)),
    rr_ratio: 0,
    indicators: { atr: 5.8, rsi: 58.4, adx: 28.5, std_dev: 4.5, vwap: Number((curr - 1.5).toFixed(2)) },
    mtf_matrix: [
      { tf: "D1", trend: "Tăng (Bullish)", structure: "HH / HL", bias: "BULLISH", is_current: tf === "1d" },
      { tf: "H4", trend: "Tăng (Bullish)", structure: "HH / HL", bias: "BULLISH", is_current: tf === "4h" },
      { tf: "H1", trend: "Tăng (Bullish)", structure: "BOS Tăng", bias: "BULLISH", is_current: tf === "1h" },
      { tf: "M15", trend: "Điều chỉnh (Pullback)", structure: "Pullback về OB", bias: "NEUTRAL", is_current: tf === "15m" },
      { tf: "M5", trend: "Tăng (Bullish)", structure: "MSS Xác nhận", bias: "BULLISH", is_current: tf === "5m" }
    ],
    smc: {
      trend: "bullish",
      external_swings: [
        { index: 70, price: curr - 16, label: "HL", swing_type: "low" },
        { index: 84, price: curr + 5, label: "HH", swing_type: "high" },
        { index: 92, price: curr - 10, label: "HL", swing_type: "low" },
        { index: 104, price: curr + 3, label: "HH", swing_type: "high" }
      ],
      structure_events: [
        { id: "MSS_1", event: "MSS", direction: "bullish", broken_swing_index: 84, index: 98, price: Number((curr - 3.5).toFixed(2)), causal_desc: "MSS Tăng phá đỉnh sau khi quét SSL kèm Displacement 2.1x ATR" }
      ],
      order_blocks: [
        { id: "OB_1", type: "bullish", index: 92, bottom: Number((curr - 10.5).toFixed(2)), top: Number((curr - 6.0).toFixed(2)), causal_desc: "Bullish OB khởi nguồn cú Displacement phá cấu trúc MSS" }
      ],
      breaker_blocks: [],
      fvg: [
        { id: "FVG_1", type: "bullish", index: 95, bottom: Number((curr - 5.0).toFixed(2)), top: Number((curr - 2.2).toFixed(2)), causal_desc: "Bullish FVG tạo bởi nến Displacement tăng mạnh" }
      ],
      sweeps: [
        { id: "SW_1", type: "bullish", pool_type: "SSL", name: "Quét Thanh Khoản Đáy (SSL Sweep)", index: 92, swept_level: Number((curr - 10.0).toFixed(2)), wick_extreme: Number((curr - 13.5).toFixed(2)), desc: "Quét qua đáy SSL rồi rút chân đóng nến xanh mạnh" }
      ],
      dealing_range: {
        high: Number((curr + 15).toFixed(2)),
        low: Number((curr - 18).toFixed(2)),
        equilibrium: Number((curr - 1.5).toFixed(2)),
        current_pct: 46.5,
        zone_status: "DISCOUNT (< 50% Equilibrium)",
        ote: { bottom: Number((curr - 8.5).toFixed(2)), top: Number((curr - 4.5).toFixed(2)), desc: "Vùng chiết khấu vàng OTE (0.618 - 0.786 Fib)" }
      }
    },
    ict: {
      ny_time: "08:30 EST",
      is_dst: false,
      active_killzone: "New York Killzone (07:00-10:00 NY)",
      silver_bullet_window: "Theo dõi 10:00 - 11:00 NY AM Silver Bullet",
      pdh: Number((curr + 16.5).toFixed(2)),
      pdl: Number((curr - 14.0).toFixed(2)),
      pwh: Number((curr + 32.0).toFixed(2)),
      pwl: Number((curr - 28.0).toFixed(2)),
      asian_high: Number((curr + 4.5).toFixed(2)),
      asian_low: Number((curr - 9.5).toFixed(2)),
      amd_phase: "Distribution Tăng (Đã xong pha Manipulation)",
      judas_swing: "Bullish Judas Swing: Quét giả dưới Asian Low rồi đảo chiều tăng!"
    },
    supply_demand: [
      { id: "SD_1", type: "demand", pattern: "DBR (Drop-Base-Rally)", index: 91, bottom: Number((curr - 11.0).toFixed(2)), top: Number((curr - 6.5).toFixed(2)), status: "Fresh (Chưa test)", quality_score: 92, causal_desc: "Vùng Demand DBR Fresh trong vùng Discount, lực rời vùng 2.1x ATR" }
    ],
    volume_profile: {
      poc: Number((curr - 3.0).toFixed(2)),
      vah: Number((curr + 9.0).toFixed(2)),
      val: Number((curr - 10.5).toFixed(2)),
      profile: []
    },
    quant_pro: {
      order_flow: {
        buy_delta_pct: 61.5,
        sell_delta_pct: 38.5,
        rvol: 1.45,
        orderbook: { bid_pct: 58.0, ask_pct: 42.0 },
        volume_source_note: "Centralized Exchange Volume (PAXG/XAUT) vs Tick Volume (XAUUSD)"
      }
    },
    causal_chain: [
      { type: "SWEEP", text: "1. Quét thanh khoản đáy SSL (Stop-Hunt) dưới đáy phiên Á." },
      { type: "MSS", text: "2. Nến Displacement tăng mạnh phá đỉnh nội bộ xác nhận MSS." },
      { type: "OB / FVG", text: "3. Để lại cụm hợp lưu Bullish OB + FVG tại vùng OTE Discount." }
    ],
    trading_plan: { active_model: "Model 1: Liquidity Sweep + MSS + OB Retest" },
    scenarios: {
      bullish: {
        model: "Liquidity Sweep + MSS",
        condition: "Giá giữ trên Bullish OB & POC, ưu tiên canh mua thuận cấu trúc.",
        entry: curr,
        sl: Number((curr - 9.5).toFixed(2)),
        tp1: Number((curr + 15.2).toFixed(2)),
        tp2: Number((curr + 23.8).toFixed(2)),
        invalidation: `Đóng nến thủng dưới $${(curr - 9.5).toFixed(2)}`
      },
      bearish: {
        model: "Supply / Bearish OB Retest",
        condition: "Chỉ kích hoạt nếu giá sập thủng đáy OB cầu và đóng nến dưới PDL.",
        entry: Number((curr - 11.0).toFixed(2)),
        sl: Number((curr - 2.0).toFixed(2)),
        tp1: Number((curr - 24.0).toFixed(2)),
        tp2: Number((curr - 35.0).toFixed(2)),
        invalidation: `Đóng nến vượt lên trên $${(curr - 2.0).toFixed(2)}`
      }
    },
    candles
  };
}

// Telegram Auto-Bot State
const tgAutoState = {
  enabled: false,
  timerId: null,
  lastSentHash: ""
};

function initTelegramAutoBot() {
  const tokenInput = document.getElementById("tgBotToken");
  const chatInput = document.getElementById("tgChatId");
  const intervalSelect = document.getElementById("tgIntervalSelect");
  const minConfSelect = document.getElementById("tgMinConfSelect");
  const btnToggle = document.getElementById("btnToggleAutoTelegram");
  const btnSendNow = document.getElementById("btnSendTelegramNow");
  const btnSendQuick = document.getElementById("btnSendTelegramQuick");
  const btnSave = document.getElementById("btnSaveTelegramConfig");
  const btnDetectChat = document.getElementById("btnAutoDetectChatId");

  try {
    const saved = JSON.parse(localStorage.getItem("goldvision_tg_config") || "{}");
    if (tokenInput && saved.botToken) tokenInput.value = saved.botToken;
    if (chatInput && saved.chatId) chatInput.value = saved.chatId;
    if (intervalSelect && saved.intervalSec) intervalSelect.value = String(saved.intervalSec);
    if (minConfSelect && saved.minConf) minConfSelect.value = String(saved.minConf);
    if (saved.lastSentHash) tgAutoState.lastSentHash = saved.lastSentHash;
    if (saved.enabled && saved.botToken && saved.chatId) {
      setTelegramAutoLoop(true);
    }
  } catch (_) {}

  async function ensureChatIdFilled() {
    const token = (tokenInput?.value || "").trim();
    let chat = (chatInput?.value || "").trim();
    if (!token) {
      setHtml("tgStatusLog", "⚠️ Bạn chưa nhập <strong>Telegram Bot Token</strong>!");
      showToast("⚠️ Hãy nhập Telegram Bot Token trước!");
      return null;
    }
    if (!chat && window.GoldVisionClientEngine?.autoDetectChatId) {
      setHtml("tgStatusLog", "🔍 Đang tự động dò tìm <strong>Chat ID</strong> từ Bot Token của bạn...");
      try {
        const res = await window.GoldVisionClientEngine.autoDetectChatId(token);
        if (res && res.chatId) {
          chat = res.chatId;
          if (chatInput) chatInput.value = chat;
          saveTelegramConfig();
          setHtml("tgStatusLog", `✅ Đã tự động nhận diện <strong>Chat ID: ${chat}</strong> (${res.chatName})!`);
          showToast(`✅ Đã tự lấy Chat ID: ${chat} (${res.chatName})`);
        }
      } catch (err) {
        setHtml("tgStatusLog", `⚠️ <strong>Chưa lấy được Chat ID:</strong> ${err.message || err}`);
        showToast("⚠️ Hãy nhắn 'alo' vào Bot trên Telegram rồi bấm lại!");
        return null;
      }
    }
    return { token, chat };
  }

  if (btnDetectChat) {
    btnDetectChat.addEventListener("click", async () => {
      if (chatInput) chatInput.value = "";
      await ensureChatIdFilled();
    });
  }

  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      await ensureChatIdFilled();
      saveTelegramConfig();
      showToast("💾 Đã lưu cấu hình Telegram Bot trên trình duyệt của bạn!");
    });
  }

  if (btnToggle) {
    btnToggle.addEventListener("click", async () => {
      if (tgAutoState.enabled) {
        setTelegramAutoLoop(false);
        return;
      }
      const ok = await ensureChatIdFilled();
      if (!ok || !ok.token || !ok.chat) return;
      setTelegramAutoLoop(true);
    });
  }

  if (btnSendNow) {
    btnSendNow.addEventListener("click", async () => {
      const ok = await ensureChatIdFilled();
      if (!ok || !ok.token || !ok.chat) return;
      await sendCurrentAnalysisToTelegram(true);
    });
  }
  if (btnSendQuick) {
    btnSendQuick.addEventListener("click", async () => {
      const ok = await ensureChatIdFilled();
      if (!ok || !ok.token || !ok.chat) return;
      await sendCurrentAnalysisToTelegram(true);
    });
  }
  if (intervalSelect) {
    intervalSelect.addEventListener("change", () => {
      saveTelegramConfig();
      if (tgAutoState.enabled) setTelegramAutoLoop(true);
    });
  }
  if (minConfSelect) {
    minConfSelect.addEventListener("change", () => saveTelegramConfig());
  }
}

function saveTelegramConfig() {
  const tokenInput = document.getElementById("tgBotToken");
  const chatInput = document.getElementById("tgChatId");
  const intervalSelect = document.getElementById("tgIntervalSelect");
  const minConfSelect = document.getElementById("tgMinConfSelect");
  const cfg = {
    botToken: (tokenInput?.value || "").trim(),
    chatId: (chatInput?.value || "").trim(),
    intervalSec: Number(intervalSelect?.value || 300),
    minConf: Number(minConfSelect?.value || 70),
    enabled: tgAutoState.enabled,
    lastSentHash: tgAutoState.lastSentHash
  };
  try {
    localStorage.setItem("goldvision_tg_config", JSON.stringify(cfg));
  } catch (_) {}
  return cfg;
}

function setTelegramAutoLoop(enable) {
  tgAutoState.enabled = Boolean(enable);
  if (tgAutoState.timerId) {
    clearInterval(tgAutoState.timerId);
    tgAutoState.timerId = null;
  }

  const btnToggle = document.getElementById("btnToggleAutoTelegram");
  const badge = document.getElementById("tgStateBadge");
  const cfg = saveTelegramConfig();

  if (tgAutoState.enabled) {
    if (btnToggle) {
      btnToggle.classList.add("active");
      btnToggle.textContent = "ĐANG BẬT (AUTO)";
    }
    if (badge) badge.textContent = "AUTO ACTIVE";
    const mins = Math.round(cfg.intervalSec / 60);
    setHtml("tgStatusLog", `🟢 <strong>Đang bật chế độ Tự Động</strong>: Quét mỗi <strong>${mins} phút</strong> (Confidence ≥ ${cfg.minConf}%) và tự động bắn Ảnh Chart + Kèo mới về Telegram!`);

    if (currentData) {
      checkAndAutoSendTelegram(currentData);
    }
    tgAutoState.timerId = setInterval(() => {
      runAnalysis();
    }, cfg.intervalSec * 1000);
  } else {
    if (btnToggle) {
      btnToggle.classList.remove("active");
      btnToggle.textContent = "ĐANG TẮT";
    }
    if (badge) badge.textContent = "SẴN SÀNG";
    setHtml("tgStatusLog", "⏸️ Đã tạm dừng tự động gửi. Bạn có thể bấm <strong>BẬT</strong> bất cứ lúc nào hoặc bấm <strong>Gửi Ảnh Chart + Kèo Ngay</strong>.");
  }
}

async function sendCurrentAnalysisToTelegram(isManual = true) {
  if (!currentData || !window.GoldVisionClientEngine) return;
  if (currentData.is_fallback) {
    setHtml("tgStatusLog", "⚠️ <strong>Mất kết nối API sàn (Dữ liệu giả lập offline)</strong> — Tự động chặn gửi Telegram để bảo vệ vốn!");
    if (isManual) showToast("⚠️ Đang mất kết nối sàn, không gửi tín hiệu giả lập!");
    return;
  }
  const cfg = saveTelegramConfig();
  if (!cfg.botToken || !cfg.chatId) {
    setHtml("tgStatusLog", "⚠️ Bạn chưa nhập <strong>Telegram Bot Token</strong> và <strong>Chat ID</strong>!");
    showToast("⚠️ Vui lòng nhập Bot Token & Chat ID ở khung bên phải!");
    return;
  }

  const badge = document.getElementById("tgStateBadge");
  if (badge) badge.textContent = "ĐANG GỬI...";
  setHtml("tgStatusLog", `⏳ Đang chụp biểu đồ <strong>${currentData.symbol} (${currentData.timeframe.toUpperCase()})</strong> và gửi về Telegram...`);

  try {
    drawInteractiveChart();
    const canvas = document.getElementById("smcChartCanvas");
    await window.GoldVisionClientEngine.sendSignalToTelegram(cfg.botToken, cfg.chatId, currentData, canvas);
    const nowStr = new Date().toLocaleTimeString("vi-VN");
    const sigHash = `${currentData.symbol}_${currentData.timeframe}_${currentData.action}_${Math.round(currentData.entry / 4)}`;
    tgAutoState.lastSentHash = sigHash;
    saveTelegramConfig();

    if (badge) badge.textContent = tgAutoState.enabled ? "AUTO ACTIVE" : "ĐÃ GỬI ✓";
    setHtml(
      "tgStatusLog",
      `✅ <strong>[${nowStr}] Đã bắn thành công về Telegram!</strong><br>Kèo: <strong>${currentData.symbol} (${currentData.timeframe.toUpperCase()}) - ${currentData.action}</strong> | Entry: <strong>$${currentData.entry}</strong> | SL: <strong>$${currentData.sl}</strong> | TP1: <strong>$${currentData.tp1}</strong>`
    );
    if (isManual) {
      showToast("✈️ Đã gửi Ảnh Chart & Tín hiệu về Telegram thành công!");
    }
  } catch (err) {
    if (badge) badge.textContent = "LỖI GỬI";
    setHtml("tgStatusLog", `❌ <strong>Lỗi gửi Telegram:</strong> ${err.message || err}`);
    if (isManual) {
      showToast(`❌ Lỗi gửi Telegram: ${err.message || err}`);
    }
  }
}

async function checkAndAutoSendTelegram(data) {
  if (!tgAutoState.enabled || !data || data.is_fallback) return;
  const cfg = saveTelegramConfig();
  if (!cfg.botToken || !cfg.chatId) return;

  if (data.confidence < cfg.minConf) {
    const nowStr = new Date().toLocaleTimeString("vi-VN");
    setHtml("tgStatusLog", `🔍 [${nowStr}] Đã quét tự động: Confidence hiện tại (${data.confidence}%) thấp hơn mức lọc (${cfg.minConf}%), đang chờ kèo đẹp hơn...`);
    return;
  }

  const sigHash = `${data.symbol}_${data.timeframe}_${data.action}_${Math.round(data.entry / 4)}`;
  if (sigHash === tgAutoState.lastSentHash) {
    const nowStr = new Date().toLocaleTimeString("vi-VN");
    setHtml("tgStatusLog", `🟢 [${nowStr}] Đã quét tự động: Kèo <strong>${data.symbol} ${data.action}</strong> đã gửi trước đó, chống spam trùng lặp.`);
    return;
  }

  await sendCurrentAnalysisToTelegram(false);
}

async function runAnalysis() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.style.display = "flex";

  try {
    let data = null;
    if (window.GoldVisionClientEngine && typeof window.GoldVisionClientEngine.analyzeGoldClientSide === "function") {
      data = await window.GoldVisionClientEngine.analyzeGoldClientSide(currentSymbol, currentTimeframe, currentMode);
    } else {
      const layersParam = Array.from(activeLayers).join(",");
      const url = `${API_BASE}/api/analyze?symbol=${encodeURIComponent(currentSymbol)}&timeframe=${encodeURIComponent(currentTimeframe)}&mode=${encodeURIComponent(currentMode)}&layers=${encodeURIComponent(layersParam)}`;
      const res = await fetch(url);
      data = await res.json();
    }

    if (!data || !data.success) {
      throw new Error("Không thể tải dữ liệu phân tích");
    }

    currentData = data;
    resetChartView();
    renderDashboard(data);
    updatePositionCalculator();
    connectLiveKlineStream(currentSymbol, currentTimeframe);
    await checkAndAutoSendTelegram(data);
  } catch (err) {
    console.warn("Using instant fallback dataset:", err);
    currentData = buildClientFallbackData(currentSymbol, currentTimeframe);
    resetChartView();
    renderDashboard(currentData);
    updatePositionCalculator();
    connectLiveKlineStream(currentSymbol, currentTimeframe);
  } finally {
    if (overlay) overlay.style.display = "none";
  }
}

async function refreshStaticPngForMode() {
  if (!currentData) return;
  try {
    const layersParam = Array.from(activeLayers).join(",");
    const url = `${API_BASE}/api/analyze?symbol=${encodeURIComponent(currentSymbol)}&timeframe=${encodeURIComponent(currentTimeframe)}&mode=${encodeURIComponent(currentMode)}&layers=${encodeURIComponent(layersParam)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.chart_image) {
      currentData.chart_image = data.chart_image;
      const imgEl = document.getElementById("annotatedChartImage");
      if (imgEl) imgEl.src = data.chart_image.base64;
    }
  } catch (e) {
    console.warn("Static PNG refresh skipped:", e);
  }
}

function fmtPrice(val) {
  if (val === undefined || val === null || isNaN(val)) return "--";
  return "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderDashboard(data) {
  const imgEl = document.getElementById("annotatedChartImage");
  if (imgEl && data.chart_image && data.chart_image.base64) {
    imgEl.src = data.chart_image.base64;
  }

  if (data.ict && data.ict.ny_time) {
    setText("nyClockLabel", `NY: ${data.ict.ny_time} • ${liveStreamSource}`);
  }

  setText("overviewSymbolTitle", `🌐 ${data.symbol} MARKET OVERVIEW (${data.timeframe.toUpperCase()})`);
  setText("currentPriceBadge", fmtPrice(data.current_price));

  const biasBanner = document.getElementById("marketBiasBanner");
  const smc = data.smc || {};
  const dr = smc.dealing_range;
  const trendStr = (smc.trend || "neutral").toLowerCase();
  const isBearTrend = trendStr === "bearish";
  const isBullTrend = trendStr === "bullish";
  const posPct = dr ? Number(dr.current_pct) : 50;
  const isBearInBottom = isBearTrend && posPct < 38;
  const isBullInTop = isBullTrend && posPct > 62;
  const isWaitState = data.action === "WAIT" || isBearInBottom || isBullInTop;

  if (biasBanner) {
    biasBanner.classList.remove("bull", "bear", "wait");
    if (isWaitState) {
      biasBanner.classList.add("wait");
    } else {
      biasBanner.classList.add(isBullTrend ? "bull" : (isBearTrend ? "bear" : "wait"));
    }
  }

  let biasMainText = "CHỜ XÁC NHẬN (NEUTRAL)";
  if (data.is_fallback) {
    biasMainText = "⚠️ MẤT KẾT NỐI SÀN — CHẾ ĐỘ XEM THỬ OFFLINE";
  } else if (isBearInBottom) {
    biasMainText = "XU HƯỚNG GIẢM • CHỜ HỒI LÊN MỚI BÁN";
  } else if (isBullInTop) {
    biasMainText = "XU HƯỚNG TĂNG • CHỜ HỒI VỀ MỚI MUA";
  } else if (data.action === "BUY") {
    biasMainText = "XU HƯỚNG TĂNG • ĐẸP ĐỂ MUA (DISCOUNT)";
  } else if (data.action === "SELL") {
    biasMainText = "XU HƯỚNG GIẢM • ĐẸP ĐỂ BÁN (PREMIUM)";
  } else if (isBearTrend) {
    biasMainText = "XU HƯỚNG GIẢM • ĐANG CHỜ TÍN HIỆU BÁN";
  } else if (isBullTrend) {
    biasMainText = "XU HƯỚNG TĂNG • ĐANG CHỜ TÍN HIỆU MUA";
  }
  setText("marketBiasText", biasMainText);
  setText("confVal", data.is_fallback ? "OFFLINE" : `${data.confidence}%`);

  if (dr) {
    let rangeNote = `Vị trí giá: ${dr.current_pct}% (Giữa EQ: ${fmtPrice(dr.equilibrium)})`;
    if (data.is_fallback) {
      rangeNote = "❌ Không kết nối được dữ liệu live từ sàn (Dữ liệu mô phỏng offline — TUYỆT ĐỐI KHÔNG VÀO LỆNH!)";
    } else if (isBearInBottom) {
      rangeNote = `⚠️ Đang sát đáy (${dr.current_pct}% < 50% EQ ${fmtPrice(dr.equilibrium)}) — KHÔNG BÁN ĐUỔI! Chờ hồi lên vùng cản`;
    } else if (isBullInTop) {
      rangeNote = `⚠️ Đang sát đỉnh (${dr.current_pct}% > 50% EQ ${fmtPrice(dr.equilibrium)}) — KHÔNG MUA ĐUỔI! Chờ hồi về vùng đỡ`;
    } else if (isBearTrend && posPct >= 50) {
      rangeNote = `✅ Vùng Giá Đắt/Premium (${dr.current_pct}% > EQ ${fmtPrice(dr.equilibrium)}) — Thuận lợi canh BÁN`;
    } else if (isBullTrend && posPct <= 50) {
      rangeNote = `✅ Vùng Giá Rẻ/Discount (${dr.current_pct}% < EQ ${fmtPrice(dr.equilibrium)}) — Thuận lợi canh MUA`;
    }
    setText("dealingRangeStatus", rangeNote);
  }

  if (data.mtf_matrix && data.mtf_matrix.length > 0) {
    const html = data.mtf_matrix.map(row => {
      const cls = row.bias === "BULLISH" ? "trend-bull" : (row.bias === "BEARISH" ? "trend-bear" : "trend-pullback");
      const activeMark = row.is_current ? " ⭐" : "";
      return `
        <tr>
          <td><strong>${row.tf}${activeMark}</strong></td>
          <td class="${cls}">${row.trend}</td>
          <td>${row.structure}</td>
        </tr>
      `;
    }).join("");
    setHtml("mtfTableBody", html);
  }

  const lastSweep = smc.sweeps && smc.sweeps.length ? smc.sweeps[smc.sweeps.length - 1] : null;
  const lastEv = smc.structure_events && smc.structure_events.length ? smc.structure_events[smc.structure_events.length - 1] : null;
  const lastFvg = smc.fvg && smc.fvg.length ? smc.fvg[smc.fvg.length - 1] : null;
  const lastSd = data.supply_demand && data.supply_demand.length ? data.supply_demand[data.supply_demand.length - 1] : null;

  setHtml("smcFindingsList", `
    <div class="finding-item">
      <span class="f-key">SSL / BSL Sweep:</span>
      <span class="f-val">${lastSweep ? `${lastSweep.pool_type} đã quét tại ${fmtPrice(lastSweep.swept_level)}` : "Chưa có quét mới gần đây"}</span>
    </div>
    <div class="finding-item">
      <span class="f-key">BOS / CHoCH / MSS:</span>
      <span class="f-val">${lastEv ? `${lastEv.event} (${lastEv.direction.toUpperCase()}) tại ${fmtPrice(lastEv.price)}` : "Đang chờ xác nhận MSS"}</span>
    </div>
    <div class="finding-item">
      <span class="f-key">FVG / BPR:</span>
      <span class="f-val">${lastFvg ? `${lastFvg.type.toUpperCase()} FVG [${fmtPrice(lastFvg.bottom)} - ${fmtPrice(lastFvg.top)}]` : "Không có FVG gần giá"}</span>
    </div>
    <div class="finding-item">
      <span class="f-key">Supply / Demand:</span>
      <span class="f-val">${lastSd ? `${lastSd.pattern} (${lastSd.quality_score}đ) [${fmtPrice(lastSd.bottom)}-${fmtPrice(lastSd.top)}]` : "Đang tích lũy"}</span>
    </div>
    <div class="finding-item">
      <span class="f-key">ICT OTE (0.62-0.79):</span>
      <span class="f-val">${dr && dr.ote ? `${fmtPrice(dr.ote.bottom)} - ${fmtPrice(dr.ote.top)}` : "--"}</span>
    </div>
  `);

  const ict = data.ict || {};
  setText("ictNyTime", ict.ny_time || "--:--");
  setText("ictKillzone", ict.active_killzone || "--");
  setText("ictSilverBullet", ict.silver_bullet_window || "--");
  setText("ictPdhPdl", `${fmtPrice(ict.pdh)} / ${fmtPrice(ict.pdl)}`);
  setText("ictPwhPwl", `${fmtPrice(ict.pwh)} / ${fmtPrice(ict.pwl)}`);
  setText("ictAsianRange", `${fmtPrice(ict.asian_high)} / ${fmtPrice(ict.asian_low)}`);
  setText("ictAmdPhase", ict.amd_phase || "Accumulation");
  setText("ictJudasAlert", ict.judas_swing || "Chưa phát hiện Judas Swing quét biên độ phiên Á.");

  const vp = data.volume_profile || {};
  const ind = data.indicators || {};
  const oflow = (data.quant_pro && data.quant_pro.order_flow) ? data.quant_pro.order_flow : {};
  setText("vpPoc", fmtPrice(vp.poc));
  setText("vpVahVal", `${fmtPrice(vp.vah)} / ${fmtPrice(vp.val)}`);
  setText("quantVwapStd", `${fmtPrice(ind.vwap)} / ±$${ind.std_dev || 0}`);
  setText("quantAtrAdx", `$${ind.atr} / ADX ${ind.adx}`);
  setText("quantRsiRvol", `RSI ${ind.rsi} / RVOL ${oflow.rvol || 1.0}x`);
  setText("quantDeltaVal", `Mua ${oflow.buy_delta_pct || 50}% / Bán ${oflow.sell_delta_pct || 50}%`);
  setText(
    "quantObWall",
    oflow.orderbook && oflow.orderbook.available !== false
      ? `Bid ${oflow.orderbook.bid_pct}% / Ask ${oflow.orderbook.ask_pct}%`
      : "Tạm mất kết nối Depth"
  );
  setText("volSourceNote", oflow.volume_source_note || "");

  if (data.causal_chain && data.causal_chain.length > 0) {
    setHtml("causalTimeline", data.causal_chain.map(ev => `
      <div class="causal-step">
        <strong>[${ev.type}]</strong> ${ev.text}
      </div>
    `).join(""));
  } else {
    setHtml("causalTimeline", `<div class="causal-step">Đang theo dõi cấu trúc nến để ghi nhận chuỗi sự kiện mới.</div>`);
  }

  const activeModel = data.trading_plan ? data.trading_plan.active_model : "SMC + ICT Setup";
  setText("activeModelHeaderBadge", activeModel);
  setText("signalStatusBadge", data.is_fallback ? "OFFLINE" : (data.action === "WAIT" ? "WAIT / LIMIT" : `${data.action} ACTIVE`));
  setText(
    "signalStatusText",
    data.is_fallback
      ? "❌ Mất kết nối API sàn — Đang hiển thị dữ liệu mô phỏng offline, KHÔNG dùng để giao dịch!"
      : data.action === "WAIT"
      ? "⏳ WAIT – Không đuổi giá! Có thể canh Entry Limit chờ hồi bên dưới hoặc đợi 4 Kèo Tương Lai:"
      : `⚡ TÍN HIỆU ${data.action} KÍCH HOẠT theo [${activeModel}]`
  );

  if (data.scenarios) {
    const b = data.scenarios.bullish;
    const s = data.scenarios.bearish;
    if (b) {
      setText("bullModelName", b.model);
      setText("bullCondition", b.condition);
      setText("bullEntry", fmtPrice(b.entry));
      setText("bullSL", fmtPrice(b.sl));
      setText("bullTP", `${fmtPrice(b.tp1)} / ${fmtPrice(b.tp2)}`);
      setText("bullInval", `❌ Vô hiệu: ${b.invalidation}`);
    }
    if (s) {
      setText("bearModelName", s.model);
      setText("bearCondition", s.condition);
      setText("bearEntry", fmtPrice(s.entry));
      setText("bearSL", fmtPrice(s.sl));
      setText("bearTP", `${fmtPrice(s.tp1)} / ${fmtPrice(s.tp2)}`);
      setText("bearInval", `❌ Vô hiệu: ${s.invalidation}`);
    }
  }

  setText("valEntry", fmtPrice(data.entry));
  setText("valSL", fmtPrice(data.sl));
  setText("valTP12", `${fmtPrice(data.tp1)} / ${fmtPrice(data.tp2)}`);
  setText("rrBadge", `1 : ${data.rr_ratio}`);

  renderFutureRoadmap(data);
}

function getActiveRoadmapList(data) {
  if (data && Array.isArray(data.future_roadmap) && data.future_roadmap.length > 0) {
    return data.future_roadmap;
  }
  if (!data || !data.current_price) return [];
  const p = Number(data.current_price);
  const atr = Number(data.indicators?.atr || p * 0.004);
  const resH = Number((p + atr * 1.5).toFixed(2));
  const supL = Number((p - atr * 1.5).toFixed(2));
  return [
    {
      id: "ROADMAP_BOS_CONT",
      tag: "KÈO 1 • PHÁ BOS",
      title: `Tiếp diễn Giảm nếu phá BOS dưới $${supL}`,
      direction: "SELL",
      trigger_type: "BOS",
      trigger_price: supL,
      condition: `NẾU đóng nến phá BOS dưới $${supL} ➔ Canh hồi lên $${Number((supL + atr * 0.35).toFixed(2))} để BÁN tiếp diễn.`,
      entry: Number((supL + atr * 0.35).toFixed(2)),
      sl: Number((supL + atr * 1.7).toFixed(2)),
      tp1: Number((supL - atr * 1.6).toFixed(2)),
      tp2: Number((supL - atr * 2.8).toFixed(2)),
      rr: 2.3,
      path_points: [
        { slot: 0, price: p, label: "Hiện tại" },
        { slot: 2.5, price: supL, label: `Phá BOS $${supL}` },
        { slot: 5.0, price: Number((supL + atr * 0.35).toFixed(2)), label: "Hồi Entry" },
        { slot: 8.5, price: Number((supL - atr * 1.6).toFixed(2)), label: "TP1" }
      ]
    },
    {
      id: "ROADMAP_CHOCH_REV",
      tag: "KÈO 2 • ĐẢO CHIỀU CHoCH",
      title: `Đổi chiều Đánh Lên nếu phá CHoCH trên $${resH}`,
      direction: "BUY",
      trigger_type: "CHoCH",
      trigger_price: resH,
      condition: `NẾU bật vượt đóng nến phá CHoCH trên $${resH} ➔ Canh hồi về $${Number((resH - atr * 0.35).toFixed(2))} để MUA LÊN.`,
      entry: Number((resH - atr * 0.35).toFixed(2)),
      sl: Number((resH - atr * 1.7).toFixed(2)),
      tp1: Number((resH + atr * 1.6).toFixed(2)),
      tp2: Number((resH + atr * 2.8).toFixed(2)),
      rr: 2.3,
      path_points: [
        { slot: 0, price: p, label: "Hiện tại" },
        { slot: 2.8, price: resH, label: `CHoCH $${resH}` },
        { slot: 5.3, price: Number((resH - atr * 0.35).toFixed(2)), label: "Hồi Entry" },
        { slot: 8.5, price: Number((resH + atr * 1.6).toFixed(2)), label: "TP1" }
      ]
    }
  ];
}

function renderFutureRoadmap(data) {
  const container = document.getElementById("futureRoadmapList");
  if (!container) return;
  const list = getActiveRoadmapList(data);
  if (!list.length) {
    container.innerHTML = `<div class="roadmap-empty">Chưa có kịch bản tương lai khả dụng.</div>`;
    return;
  }

  container.innerHTML = list.map(item => {
    const dirCls = item.direction === "BUY" ? "buy" : "sell";
    const activeCls = selectedRoadmapId === item.id ? "active" : "";
    return `
      <div class="roadmap-card ${dirCls} ${activeCls}" data-roadmap-id="${item.id}">
        <div class="roadmap-card-top">
          <span class="roadmap-tag">${item.tag}</span>
          <span class="roadmap-rr">${item.direction} • R:R 1:${item.rr}</span>
        </div>
        <div class="roadmap-title">${item.title}</div>
        <div class="roadmap-cond">${item.condition}</div>
        <div class="roadmap-levels">
          <div><small>Entry hồi:</small><strong>${fmtPrice(item.entry)}</strong></div>
          <div><small>SL:</small><strong class="text-red">${fmtPrice(item.sl)}</strong></div>
          <div><small>TP1 / TP2:</small><strong class="text-green">${fmtPrice(item.tp1)} / ${fmtPrice(item.tp2)}</strong></div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".roadmap-card").forEach(card => {
    card.addEventListener("click", () => {
      const rid = card.dataset.roadmapId;
      selectedRoadmapId = selectedRoadmapId === rid ? null : rid;
      showFutureRoadmap = true;
      const btn = document.getElementById("btnToggleRoadmap");
      if (btn) btn.classList.add("active-projection");
      renderFutureRoadmap(currentData);
      const picked = list.find(x => x.id === selectedRoadmapId);
      if (picked) {
        setText("inspectCategoryBadge", `🔮 DỰ PHÓNG TƯƠNG LAI: ${picked.tag}`);
        setText("inspectTitle", picked.title);
        setText("inspectDesc", `${picked.condition} | Vô hiệu: ${picked.invalidation || "--"}`);
      }
      drawInteractiveChart();
    });
  });
}

/**
 * TradingView & KLineChart-UI-Core Renderer
 */
function drawInteractiveChart() {
  if (!currentData || !currentData.candles || currentData.candles.length === 0) return;

  const canvas = document.getElementById("smcChartCanvas");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width || 1050, 600);
  const height = 540;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  interactiveHitBoxes = [];

  const padLeft = 14;
  const padRight = 104;
  const padTop = 38;
  const padBottom = 30;
  const volHeight = 68;
  const mainHeight = height - padTop - padBottom - volHeight - 8;
  const mainBottom = padTop + mainHeight;
  const volTop = mainBottom + 8;
  const volBottom = volTop + volHeight;
  const plotWidth = width - padLeft - padRight;

  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(0, 0, width, height);

  const allCandles = currentData.candles;
  const total = allCandles.length;
  const firstFullIdx = allCandles[0].full_index;

  const vStart = Math.max(0, Math.min(total - 8, viewState.startIdx));
  const vCount = Math.max(12, Math.min(total - vStart, viewState.visibleCount));
  const iStart = Math.floor(vStart);
  const iEnd = Math.min(total - 1, Math.ceil(vStart + vCount));

  let cMin = Infinity;
  let cMax = -Infinity;
  let maxVol = 1;
  const visibleSlice = [];
  for (let i = iStart; i <= iEnd; i++) {
    const c = allCandles[i];
    visibleSlice.push(c);
    if (c.low < cMin) cMin = c.low;
    if (c.high > cMax) cMax = c.high;
    if (c.volume > maxVol) maxVol = c.volume;
  }

  const candleSpan = Math.max(cMax - cMin, 2.0);
  [currentData.entry, currentData.sl, currentData.tp1, currentData.tp2].forEach(lvl => {
    if (lvl && Math.abs(lvl - (cMin + cMax) / 2) <= candleSpan * 0.95) {
      if (lvl < cMin) cMin = lvl;
      if (lvl > cMax) cMax = lvl;
    }
  });

  const midP = (cMin + cMax) / 2 + viewState.priceOffset;
  const halfSpan = (Math.max(cMax - cMin, 2.0) * 0.62) * viewState.priceZoom;
  const minP = midP - halfSpan;
  const maxP = midP + halfSpan;
  viewState.lastPriceSpan = maxP - minP;

  const effectiveSlots = vCount + (showFutureRoadmap ? 11.8 : 3.5);
  const xOfArrayIdx = (arrIdx) => padLeft + ((arrIdx - vStart + 0.5) / effectiveSlots) * plotWidth;
  const xOfFull = (fullIdx) => xOfArrayIdx(fullIdx - firstFullIdx);
  const yOfPrice = (price) => padTop + ((maxP - price) / (maxP - minP)) * mainHeight;
  const priceOfY = (py) => maxP - ((py - padTop) / mainHeight) * (maxP - minP);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotWidth, mainHeight + volHeight + 8);
  ctx.clip();

  // Grid Lines
  ctx.strokeStyle = "#161d2a";
  ctx.lineWidth = 1;
  const gridSteps = 7;
  for (let i = 0; i <= gridSteps; i++) {
    const pVal = minP + ((maxP - minP) * i) / gridSteps;
    const py = yOfPrice(pVal);
    ctx.beginPath();
    ctx.moveTo(padLeft, py);
    ctx.lineTo(width - padRight, py);
    ctx.stroke();
  }

  const usedRightY = [];
  const usedLeftY = [];

  function drawAntiCollideTag(text, targetY, xPos, color, bgAlpha = 0.88, side = "right") {
    const clampedY = Math.max(padTop + 12, Math.min(mainBottom - 8, targetY));
    const tracker = side === "right" ? usedRightY : usedLeftY;
    let finalY = clampedY;
    const minGap = 16;

    for (let attempt = 0; attempt < 6; attempt++) {
      const collision = tracker.find(y => Math.abs(y - finalY) < minGap);
      if (!collision) break;
      finalY = attempt % 2 === 0 ? collision + minGap : collision - minGap;
    }
    if (finalY < padTop + 10 || finalY > mainBottom - 6) return;
    tracker.push(finalY);

    ctx.font = "bold 9.5px 'Be Vietnam Pro', Inter, sans-serif";
    const tw = ctx.measureText(text).width + 10;
    const drawX = side === "right" ? Math.min(xPos, width - padRight - tw - 4) : xPos;

    ctx.fillStyle = `rgba(11, 15, 23, ${bgAlpha})`;
    ctx.fillRect(drawX, finalY - 10, tw, 14);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(drawX, finalY - 10, tw, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, drawX + 5, finalY);
  }

  const smc = currentData.smc || {};
  const ict = currentData.ict || {};

  if (!hideAllAnnotations) {
    // LAYER 8: Dynamic Visible-Range Volume Profile (VPVR with Up/Down Split from klinechart-ui-core)
    if (activeLayers.has("indicators")) {
      const vpvr = computeVisibleVPVR(visibleSlice, 24);
      if (vpvr) {
        const maxBarW = plotWidth * 0.15;
        const edgeX = width - padRight - 4;
        vpvr.rows.forEach(row => {
          if (row.totalVolume <= 0) return;
          const yTop = yOfPrice(row.priceHigh);
          const yBot = yOfPrice(row.priceLow);
          const rawH = Math.max(1.5, Math.abs(yBot - yTop));
          const gap = Math.min(2, rawH * 0.18);
          const barH = Math.max(1, rawH - gap);
          const drawY = Math.min(yTop, yBot) + gap / 2;

          const totalW = (row.totalVolume / vpvr.maxVol) * maxBarW;
          const upW = (row.upVolume / row.totalVolume) * totalW;
          const downW = totalW - upW;

          // Up Volume (Teal #26a69a) & Down Volume (Coral #ef5350)
          ctx.fillStyle = row.index === vpvr.pocIdx ? "rgba(245, 158, 11, 0.52)" : "rgba(38, 166, 154, 0.42)";
          ctx.fillRect(edgeX - totalW, drawY, upW, barH);
          ctx.fillStyle = row.index === vpvr.pocIdx ? "rgba(242, 54, 69, 0.52)" : "rgba(239, 83, 80, 0.42)";
          ctx.fillRect(edgeX - downW, drawY, downW, barH);
        });

        // VAH, VAL & POC Lines
        const yPoc = yOfPrice(vpvr.pocPrice);
        const yVah = yOfPrice(vpvr.vahPrice);
        const yVal = yOfPrice(vpvr.valPrice);

        ctx.strokeStyle = "rgba(41, 98, 255, 0.65)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yVah); ctx.lineTo(width - padRight, yVah);
        ctx.moveTo(padLeft, yVal); ctx.lineTo(width - padRight, yVal);
        ctx.stroke();

        ctx.strokeStyle = "#F23645";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yPoc); ctx.lineTo(width - padRight, yPoc);
        ctx.stroke();
        drawAntiCollideTag(`VPVR POC $${vpvr.pocPrice}`, yPoc, padLeft + 8, "#F23645", 0.88, "left");
      }
    }

    // LAYER 6: ICT Dealing Range Equilibrium 50% & OTE (0.618-0.786)
    if (activeLayers.has("ict") && smc.dealing_range) {
      const dr = smc.dealing_range;
      const yEq = yOfPrice(dr.equilibrium);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padLeft, yEq);
      ctx.lineTo(width - padRight, yEq);
      ctx.stroke();
      ctx.setLineDash([]);
      drawAntiCollideTag(`EQ 50% ($${dr.equilibrium})`, yEq, padLeft + 8, "#cbd5e1", 0.85, "left");

      if (dr.ote) {
        const yTop = yOfPrice(dr.ote.top);
        const yBot = yOfPrice(dr.ote.bottom);
        const xStart = Math.max(padLeft, xOfArrayIdx(total - 24));
        const boxW = (width - padRight) - xStart;
        const boxH = Math.max(yBot - yTop, 5);
        ctx.fillStyle = "rgba(245, 158, 11, 0.09)";
        ctx.fillRect(xStart, yTop, boxW, boxH);
        ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
        ctx.strokeRect(xStart, yTop, boxW, boxH);
        drawAntiCollideTag(`ICT OTE [${dr.ote.bottom}-${dr.ote.top}]`, (yTop + yBot) / 2, width - padRight - 155, "#fbbf24", 0.88, "right");

        interactiveHitBoxes.push({
          id: "ICT_OTE", x: xStart, y: yTop, w: boxW, h: boxH,
          category: "ICT CONCEPTS",
          title: "ICT Optimal Trade Entry (OTE 0.618 - 0.786)",
          detail: dr.ote.desc
        });
      }
    }

    // LAYER 5: SUPPLY & DEMAND ZONES
    if (activeLayers.has("supply_demand") && currentData.supply_demand) {
      currentData.supply_demand.slice(-2).forEach(sd => {
        const x1 = Math.max(padLeft, xOfFull(sd.index));
        const y1 = yOfPrice(sd.top);
        const y2 = yOfPrice(sd.bottom);
        const w = (width - padRight) - x1;
        const h = Math.max(y2 - y1, 5);
        const isDem = sd.type === "demand";
        const col = isDem ? "#26a69a" : "#ef5350";
        ctx.fillStyle = isDem ? "rgba(38, 166, 154, 0.16)" : "rgba(239, 83, 80, 0.16)";
        ctx.fillRect(x1, y1, w, h);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.1;
        ctx.strokeRect(x1, y1, w, h);
        drawAntiCollideTag(`${sd.pattern.split(" ")[0]} (${sd.quality_score}đ)`, (y1 + y2) / 2, width - padRight - 110, col, 0.88, "right");

        interactiveHitBoxes.push({
          id: sd.id, x: x1, y: y1, w, h,
          category: "SUPPLY & DEMAND",
          title: `${sd.pattern} (${sd.status})`,
          detail: sd.causal_desc
        });
      });
    }

    // LAYER 3: ORDER BLOCKS & BREAKER BLOCKS
    if (activeLayers.has("order_blocks")) {
      (smc.order_blocks || []).slice(-2).forEach(ob => {
        const x1 = Math.max(padLeft, xOfFull(ob.index));
        const y1 = yOfPrice(ob.top);
        const y2 = yOfPrice(ob.bottom);
        const w = (width - padRight) - x1;
        const h = Math.max(y2 - y1, 5);
        const isBull = ob.type === "bullish";
        const col = isBull ? "#00e676" : "#ff3366";
        ctx.fillStyle = isBull ? "rgba(0, 230, 118, 0.14)" : "rgba(255, 51, 102, 0.14)";
        ctx.fillRect(x1, y1, w, h);
        ctx.strokeStyle = col;
        ctx.strokeRect(x1, y1, w, h);
        drawAntiCollideTag(`${isBull ? "BULL OB" : "BEAR OB"} [${ob.bottom}-${ob.top}]`, (y1 + y2) / 2, width - padRight - 155, col, 0.88, "right");

        interactiveHitBoxes.push({
          id: ob.id, x: x1, y: y1, w, h,
          category: "ORDER BLOCK",
          title: `${isBull ? "Bullish" : "Bearish"} Order Block`,
          detail: ob.causal_desc
        });
      });

      if (currentMode === "full") {
        (smc.breaker_blocks || []).slice(-1).forEach(bb => {
          const x1 = Math.max(padLeft, xOfFull(bb.index));
          const y1 = yOfPrice(bb.top);
          const y2 = yOfPrice(bb.bottom);
          const w = (width - padRight) - x1;
          const h = Math.max(y2 - y1, 5);
          ctx.fillStyle = "rgba(56, 189, 248, 0.11)";
          ctx.fillRect(x1, y1, w, h);
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = "#38bdf8";
          ctx.strokeRect(x1, y1, w, h);
          ctx.setLineDash([]);
          drawAntiCollideTag(`BREAKER (${bb.type.toUpperCase()})`, (y1 + y2) / 2, width - padRight - 130, "#38bdf8", 0.88, "right");

          interactiveHitBoxes.push({
            id: bb.id, x: x1, y: y1, w, h,
            category: "BREAKER BLOCK",
            title: `${bb.type.toUpperCase()} Breaker Block`,
            detail: bb.causal_desc
          });
        });
      }
    }

    // LAYER 4: IMBALANCE (FVG)
    if (activeLayers.has("imbalance")) {
      (smc.fvg || []).slice(-2).forEach(fvg => {
        const x1 = Math.max(padLeft, xOfFull(fvg.index));
        const y1 = yOfPrice(fvg.top);
        const y2 = yOfPrice(fvg.bottom);
        const w = (width - padRight) - x1;
        const h = Math.max(y2 - y1, 5);
        const isBull = fvg.type === "bullish";
        const col = isBull ? "#ffb74d" : "#f48fb1";
        ctx.fillStyle = isBull ? "rgba(255, 152, 0, 0.16)" : "rgba(233, 30, 99, 0.16)";
        ctx.fillRect(x1, y1, w, h);
        drawAntiCollideTag(`FVG (${isBull ? "Bull" : "Bear"})`, (y1 + y2) / 2, width - padRight - 95, col, 0.85, "right");

        interactiveHitBoxes.push({
          id: fvg.id, x: x1, y: y1, w, h,
          category: "IMBALANCE (FVG)",
          title: `${isBull ? "Bullish" : "Bearish"} Fair Value Gap`,
          detail: fvg.causal_desc
        });
      });
    }
  }

  // DRAW CANDLESTICKS & VOLUME BARS (TradingView / KLineChart Teal #26a69a & Coral #ef5350 Palette)
  const candleW = Math.max((plotWidth / effectiveSlots) * 0.66, 2.5);
  viewState.hoveredCandle = null;

  for (let i = iStart; i <= iEnd; i++) {
    const c = allCandles[i];
    const cx = xOfArrayIdx(i);
    if (cx < padLeft - candleW || cx > width - padRight + candleW) continue;

    const yHigh = yOfPrice(c.high);
    const yLow = yOfPrice(c.low);
    const yOpen = yOfPrice(c.open);
    const yClose = yOfPrice(c.close);
    const isUp = c.close >= c.open;
    const col = isUp ? "#26a69a" : "#ef5350";

    if (viewState.mouseX >= 0 && Math.abs(viewState.mouseX - cx) <= (plotWidth / effectiveSlots) * 0.55) {
      viewState.hoveredCandle = c;
    }

    ctx.strokeStyle = col;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx, yHigh);
    ctx.lineTo(cx, yLow);
    ctx.stroke();

    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(Math.abs(yClose - yOpen), 1.5);
    ctx.fillStyle = col;
    ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);

    const vh = Math.min(volHeight - 4, (c.volume / maxVol) * (volHeight - 6));
    ctx.fillStyle = isUp ? "rgba(38, 166, 154, 0.52)" : "rgba(239, 83, 80, 0.52)";
    ctx.fillRect(cx - candleW / 2, volBottom - vh, candleW, vh);
  }

  // Live Current Price Dashed Line across chart
  const lastCandle = allCandles[total - 1];
  if (lastCandle) {
    const yLive = yOfPrice(lastCandle.close);
    if (yLive >= padTop && yLive <= mainBottom) {
      const isUpLive = lastCandle.close >= lastCandle.open;
      ctx.strokeStyle = isUpLive ? "rgba(38, 166, 154, 0.65)" : "rgba(239, 83, 80, 0.65)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(padLeft, yLive);
      ctx.lineTo(width - padRight, yLive);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (!hideAllAnnotations) {
    // LAYER 8: EMAs & VWAP
    if (activeLayers.has("indicators")) {
      const drawLineSeries = (key, color, widthLine = 1.5, dash = []) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = widthLine;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let started = false;
        for (let i = iStart; i <= iEnd; i++) {
          const px = xOfArrayIdx(i);
          const py = yOfPrice(allCandles[i][key]);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      drawLineSeries("ema20", "#f0b90b", 1.5);
      drawLineSeries("ema50", "#3b82f6", 1.5);
      drawLineSeries("ema200", "#a855f7", 1.8);
      drawLineSeries("vwap", "#00e5ff", 1.2, [4, 3]);
    }

    // LAYER 1: MARKET STRUCTURE (HH/HL/LH/LL & BOS / CHoCH / MSS)
    if (activeLayers.has("structure")) {
      let lastSwingX = -999;
      (smc.external_swings || []).forEach(pt => {
        const px = xOfFull(pt.index);
        if (px < padLeft + 15 || px > width - padRight - 15) return;
        if (Math.abs(px - lastSwingX) < 34) return;
        lastSwingX = px;

        const py = yOfPrice(pt.price);
        const isHigh = pt.swing_type === "high";
        const col = (pt.label === "HH" || pt.label === "HL") ? "#38bdf8" : "#f43f5e";
        const tagY = isHigh ? py - 18 : py + 7;

        ctx.fillStyle = "rgba(11, 14, 20, 0.9)";
        ctx.fillRect(px - 11, tagY, 22, 13);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 11, tagY, 22, 13);
        ctx.fillStyle = col;
        ctx.font = "bold 9px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(pt.label, px - 6.5, tagY + 9.5);
      });

      (smc.structure_events || []).slice(-3).forEach(ev => {
        const x1 = Math.max(padLeft, xOfFull(ev.broken_swing_index));
        const x2 = xOfFull(ev.index);
        if (x2 < padLeft || x1 > width - padRight) return;
        const py = yOfPrice(ev.price);
        const col = ev.direction === "bullish" ? "#00e676" : "#ff3b57";

        ctx.strokeStyle = col;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, py);
        ctx.lineTo(x2, py);
        ctx.stroke();
        ctx.setLineDash([]);

        const midX = (x1 + x2) / 2;
        ctx.fillStyle = "rgba(11, 14, 20, 0.85)";
        ctx.fillRect(midX - 16, py - 12, 32, 11);
        ctx.fillStyle = col;
        ctx.font = "bold 9px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(ev.event, midX - 11, py - 3);

        interactiveHitBoxes.push({
          id: ev.id, x: Math.min(x1, x2), y: py - 12, w: Math.max(Math.abs(x2 - x1), 28), h: 18,
          category: `MARKET STRUCTURE (${ev.event})`,
          title: `${ev.event} (${ev.direction.toUpperCase()}) tại $${ev.price}`,
          detail: ev.causal_desc
        });
      });
    }

    // LAYER 2: LIQUIDITY (PDH/PDL & BSL/SSL Sweeps)
    if (activeLayers.has("liquidity") || currentMode === "clean") {
      if (ict.pdh && ict.pdl) {
        [
          { lbl: `PDH $${ict.pdh}`, p: ict.pdh, col: "#facc15" },
          { lbl: `PDL $${ict.pdl}`, p: ict.pdl, col: "#38bdf8" }
        ].forEach(item => {
          const py = yOfPrice(item.p);
          if (py >= padTop && py <= mainBottom) {
            ctx.strokeStyle = item.col;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(padLeft, py);
            ctx.lineTo(width - padRight, py);
            ctx.stroke();
            ctx.setLineDash([]);
            drawAntiCollideTag(item.lbl, py, padLeft + 8, item.col, 0.88, "left");
          }
        });
      }
    }

    if (activeLayers.has("liquidity")) {
      (smc.sweeps || []).slice(-2).forEach(sw => {
        const px = xOfFull(sw.index);
        if (px < padLeft || px > width - padRight) return;
        const py = yOfPrice(sw.wick_extreme);
        const isBull = sw.type === "bullish";
        const col = isBull ? "#00ffcc" : "#ff00ff";

        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        const lblY = isBull ? py + 15 : py - 8;
        ctx.fillStyle = "rgba(11, 14, 20, 0.88)";
        ctx.fillRect(px - 28, lblY - 9, 56, 12);
        ctx.fillStyle = col;
        ctx.font = "bold 8.5px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(`SWEEP ${sw.pool_type}`, px - 24, lblY);

        interactiveHitBoxes.push({
          id: sw.id, x: px - 28, y: py - 14, w: 56, h: 28,
          category: "LIQUIDITY SWEEP",
          title: `${sw.name} ($${sw.swept_level})`,
          detail: sw.desc
        });
      });
    }

    // TRADINGVIEW LONG/SHORT R:R POSITION OVERLAY (Adapted from klinechart-ui-core/overlays/longPosition.ts)
    const sigXStart = Math.max(padLeft, xOfArrayIdx(total - 14));
    const sigXEnd = width - padRight;
    const yEntry = yOfPrice(currentData.entry);
    const ySL = yOfPrice(currentData.sl);
    const yTP2 = yOfPrice(currentData.tp2);
    const boxW = Math.max(0, sigXEnd - sigXStart);

    if (boxW > 10) {
      // Shaded Profit Target Box (Teal rgba(38, 166, 154, 0.14))
      const topProf = Math.max(padTop, Math.min(yEntry, yTP2));
      const botProf = Math.min(mainBottom, Math.max(yEntry, yTP2));
      if (botProf > topProf) {
        ctx.fillStyle = "rgba(38, 166, 154, 0.13)";
        ctx.fillRect(sigXStart, topProf, boxW, botProf - topProf);
      }

      // Shaded Stop Loss Box (Coral rgba(239, 83, 80, 0.14))
      const topLoss = Math.max(padTop, Math.min(yEntry, ySL));
      const botLoss = Math.min(mainBottom, Math.max(yEntry, ySL));
      if (botLoss > topLoss) {
        ctx.fillStyle = "rgba(239, 83, 80, 0.13)";
        ctx.fillRect(sigXStart, topLoss, boxW, botLoss - topLoss);
      }
    }

    const drawSignalLevel = (price, label, col) => {
      if (!price) return;
      const py = yOfPrice(price);
      if (py >= padTop && py <= mainBottom) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(sigXStart, py);
        ctx.lineTo(sigXEnd, py);
        ctx.stroke();
        ctx.setLineDash([]);
        drawAntiCollideTag(`${label}: $${price}`, py, sigXEnd - 125, col, 0.94, "right");
      } else {
        const edgeY = py < padTop ? padTop + 14 : mainBottom - 10;
        const arrow = py < padTop ? "▲" : "▼";
        drawAntiCollideTag(`${arrow} ${label}: $${price}`, edgeY, sigXEnd - 135, col, 0.92, "right");
      }
    };

    drawSignalLevel(currentData.entry, `ENTRY (R:R 1:${currentData.rr_ratio})`, "#00f0ff");
    drawSignalLevel(currentData.sl, "STOP", "#ef5350");
    drawSignalLevel(currentData.tp1, "TP1", "#26a69a");
    drawSignalLevel(currentData.tp2, "TARGET TP2", "#ffd700");

    // FUTURE CONDITIONAL PROJECTION PATHS (BOS Continuation vs CHoCH Reversal)
    if (showFutureRoadmap) {
      const roadmapList = getActiveRoadmapList(currentData);
      const lastBarX = xOfArrayIdx(total - 1);
      if (lastBarX < width - padRight - 25 && roadmapList.length > 0) {
        // Subtle vertical boundary separating Present Candles vs Future Forecast Zone
        ctx.save();
        ctx.strokeStyle = "rgba(168, 85, 247, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(lastBarX, padTop);
        ctx.lineTo(lastBarX, mainBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(168, 85, 247, 0.78)";
        ctx.font = "bold 9px 'Be Vietnam Pro', sans-serif";
        ctx.fillText("DỰ PHÓNG TƯƠNG LAI ➔", Math.min(lastBarX + 8, width - padRight - 135), padTop + 13);

        // Choose either the selected card OR show the top 2 opposing branches (BOS & CHoCH)
        const activePaths = selectedRoadmapId
          ? roadmapList.filter(r => r.id === selectedRoadmapId)
          : roadmapList.slice(0, 2);

        activePaths.forEach(rm => {
          const isBuy = rm.direction === "BUY";
          const pathCol = isBuy ? "#26a69a" : "#ef5350";
          const glowCol = isBuy ? "rgba(38, 166, 154, 0.9)" : "rgba(239, 83, 80, 0.9)";

          // Draw Trigger Line (BOS / CHoCH / SWEEP / POI threshold)
          if (rm.trigger_price) {
            const yTrig = yOfPrice(rm.trigger_price);
            if (yTrig >= padTop + 10 && yTrig <= mainBottom - 10) {
              ctx.strokeStyle = isBuy ? "rgba(38, 166, 154, 0.55)" : "rgba(239, 83, 80, 0.55)";
              ctx.lineWidth = 1.1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(Math.max(padLeft, lastBarX - 95), yTrig);
              ctx.lineTo(width - padRight, yTrig);
              ctx.stroke();
              ctx.setLineDash([]);
              drawAntiCollideTag(`${rm.trigger_type} $${rm.trigger_price}`, yTrig, Math.max(padLeft + 8, lastBarX - 115), pathCol, 0.9, "left");
            }
          }

          // Draw Projected Zig-Zag Arrows
          const pts = (rm.path_points || []).map(pt => ({
            x: xOfArrayIdx((total - 1) + Number(pt.slot || 0)),
            y: Math.max(padTop + 14, Math.min(mainBottom - 14, yOfPrice(pt.price))),
            label: pt.label,
            price: pt.price
          }));

          if (pts.length >= 2) {
            ctx.strokeStyle = glowCol;
            ctx.lineWidth = selectedRoadmapId ? 2.4 : 1.8;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let k = 1; k < pts.length; k++) {
              ctx.lineTo(pts[k].x, pts[k].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw Arrowhead at final target
            const pPrev = pts[pts.length - 2];
            const pLast = pts[pts.length - 1];
            const ang = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
            const headLen = 8;
            ctx.fillStyle = glowCol;
            ctx.beginPath();
            ctx.moveTo(pLast.x, pLast.y);
            ctx.lineTo(pLast.x - headLen * Math.cos(ang - Math.PI / 6), pLast.y - headLen * Math.sin(ang - Math.PI / 6));
            ctx.lineTo(pLast.x - headLen * Math.cos(ang + Math.PI / 6), pLast.y - headLen * Math.sin(ang + Math.PI / 6));
            ctx.closePath();
            ctx.fill();

            // Waypoint nodes & concise tags
            pts.slice(1).forEach((pt, idx) => {
              ctx.fillStyle = "#0b0e14";
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 3.6, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = glowCol;
              ctx.lineWidth = 1.5;
              ctx.stroke();

              if (selectedRoadmapId || idx === 0 || idx === pts.length - 2) {
                ctx.font = "bold 8.5px 'Be Vietnam Pro', sans-serif";
                const lbl = `${pt.label}`;
                const lw = ctx.measureText(lbl).width + 8;
                const lx = Math.min(pt.x - lw / 2, width - padRight - lw - 4);
                const ly = isBuy ? pt.y - 16 : pt.y + 6;
                ctx.fillStyle = "rgba(11, 14, 20, 0.9)";
                ctx.fillRect(lx, ly, lw, 12);
                ctx.fillStyle = pathCol;
                ctx.fillText(lbl, lx + 4, ly + 9);
              }
            });
          }
        });
        ctx.restore();
      }
    }
  }

  ctx.restore();

  // Right Price Axis Background & Labels
  ctx.fillStyle = "#0e131d";
  ctx.fillRect(width - padRight, 0, padRight, height);
  ctx.strokeStyle = "#212b3d";
  ctx.beginPath();
  ctx.moveTo(width - padRight, padTop);
  ctx.lineTo(width - padRight, height - padBottom);
  ctx.stroke();

  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#8b949e";
  for (let i = 0; i <= gridSteps; i++) {
    const pVal = minP + ((maxP - minP) * i) / gridSteps;
    const py = yOfPrice(pVal);
    ctx.fillText("$" + pVal.toFixed(1), width - padRight + 8, py + 4);
  }

  // Live Price Pill on Right Y-Axis
  if (lastCandle) {
    const yLive = yOfPrice(lastCandle.close);
    if (yLive >= padTop && yLive <= mainBottom) {
      const isUpLive = lastCandle.close >= lastCandle.open;
      ctx.fillStyle = isUpLive ? "#26a69a" : "#ef5350";
      ctx.fillRect(width - padRight + 2, yLive - 9, padRight - 6, 18);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10.5px 'JetBrains Mono', monospace";
      ctx.fillText("$" + lastCandle.close.toFixed(2), width - padRight + 8, yLive + 4);
    }
  }

  // Bottom Time Axis Labels
  const timeStep = Math.max(1, Math.floor(vCount / 6));
  ctx.font = "10px 'Be Vietnam Pro', sans-serif";
  ctx.fillStyle = "#64748b";
  for (let i = iStart; i <= iEnd; i += timeStep) {
    const cx = xOfArrayIdx(i);
    if (cx >= padLeft + 20 && cx <= width - padRight - 30) {
      ctx.fillText(allCandles[i].datetime, cx - 22, height - 10);
    }
  }

  // LIVE TRADINGVIEW CROSSHAIR (+) & AXIS TAGS
  if (viewState.mouseX >= padLeft && viewState.mouseX <= width - padRight && viewState.mouseY >= padTop && viewState.mouseY <= volBottom) {
    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(viewState.mouseX, padTop);
    ctx.lineTo(viewState.mouseX, volBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(padLeft, viewState.mouseY);
    ctx.lineTo(width - padRight, viewState.mouseY);
    ctx.stroke();
    ctx.restore();

    if (viewState.mouseY <= mainBottom) {
      const hoverPrice = priceOfY(viewState.mouseY);
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(width - padRight + 2, viewState.mouseY - 10, padRight - 6, 20);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      ctx.fillText("$" + hoverPrice.toFixed(2), width - padRight + 8, viewState.mouseY + 4);
    }

    if (viewState.hoveredCandle) {
      const dtText = viewState.hoveredCandle.datetime;
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(viewState.mouseX - 36, height - 24, 72, 18);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(dtText, viewState.mouseX - 28, height - 11);
    }
  }

  // Top-left TradingView Status & Dynamic OHLCV Bar
  const activeC = viewState.hoveredCandle || allCandles[allCandles.length - 1];
  const isUpC = activeC.close >= activeC.open;
  ctx.fillStyle = "rgba(14, 19, 29, 0.94)";
  ctx.fillRect(padLeft + 4, 5, width - padRight - 24, 26);
  ctx.strokeStyle = "#212b3d";
  ctx.strokeRect(padLeft + 4, 5, width - padRight - 24, 26);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 11px 'Be Vietnam Pro', sans-serif";
  const headerPrefix = `${currentData.symbol} • ${currentData.timeframe.toUpperCase()} (${currentMode.toUpperCase()} ${activeLayers.size}/8)`;
  ctx.fillText(headerPrefix, padLeft + 12, 22);

  const ohlcX = padLeft + 255;
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.fillStyle = isUpC ? "#26a69a" : "#ef5350";
  ctx.fillText(
    `O:${activeC.open.toFixed(2)}  H:${activeC.high.toFixed(2)}  L:${activeC.low.toFixed(2)}  C:${activeC.close.toFixed(2)}  Vol:${Math.round(activeC.volume)}`,
    ohlcX,
    22
  );
}

function handleCanvasClick(evt) {
  const canvas = document.getElementById("smcChartCanvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const clickX = evt.clientX - rect.left;
  const clickY = evt.clientY - rect.top;

  for (let i = interactiveHitBoxes.length - 1; i >= 0; i--) {
    const b = interactiveHitBoxes[i];
    if (clickX >= b.x && clickX <= b.x + b.w && clickY >= b.y && clickY <= b.y + b.h) {
      selectedInspectId = b.id;
      setText("inspectCategoryBadge", `🔍 ĐANG XEM CHI TIẾT: ${b.category}`);
      setText("inspectTitle", b.title);
      setText("inspectDesc", b.detail);
      return;
    }
  }
}

function updatePositionCalculator() {
  if (!currentData) return;
  const inCap = document.getElementById("inputCapital");
  const inRisk = document.getElementById("inputRiskPct");
  const cap = inCap ? (parseFloat(inCap.value) || 1000) : 1000;
  const riskPct = inRisk ? (parseFloat(inRisk.value) || 1.5) : 1.5;
  const entry = currentData.entry;
  const sl = currentData.sl;
  const tp1 = currentData.tp1;
  const tp2 = currentData.tp2;

  const maxLoss = cap * (riskPct / 100.0);
  const slDist = Math.max(Math.abs(entry - sl), 0.5);
  const units = maxLoss / slDist;
  const gain1 = units * Math.abs(tp1 - entry);
  const gain2 = units * Math.abs(tp2 - entry);

  const symBase = currentSymbol.split("/")[0];
  setText("calcMaxLoss", `-$${maxLoss.toFixed(2)}`);
  setText("calcUnits", `${units.toFixed(4)} ${symBase}`);
  setText("calcProfitTP", `+$${gain1.toFixed(2)} / +$${gain2.toFixed(2)}`);
}

function copySignalToClipboard() {
  if (!currentData) return;
  const text = [
    `[GOLDVISION AI - ${currentData.symbol} (${currentData.timeframe.toUpperCase()})]`,
    `- Market Bias: ${currentData.action} (Độ tin cậy: ${currentData.confidence}%)`,
    `- Mô hình (Entry Model): ${currentData.trading_plan.active_model}`,
    `- Entry: $${currentData.entry} | SL: $${currentData.sl} | TP1: $${currentData.tp1} | TP2: $${currentData.tp2} (R:R 1:${currentData.rr_ratio})`,
    `- Kịch bản Tăng: ${currentData.scenarios.bullish.condition}`,
    `- Kịch bản Giảm: ${currentData.scenarios.bearish.condition}`
  ].join("\n");

  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById("toastMessage");
    if (toast) {
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 2500);
    }
  });
}
