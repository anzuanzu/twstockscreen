const SCAN_URL = "https://scanner.tradingview.com/taiwan/scan";
const COLUMNS = [
  "name",
  "description",
  "close",
  "time",
  "Perf.W",
  "Perf.1M",
  "Volatility.W",
  "SMA200",
  "market_cap_basic",
  "type",
];

const state = {
  loading: false,
  rows: [],
  filteredRows: [],
  lastUpdated: null,
  previewHideTimer: null,
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  statusText: document.querySelector("#statusText"),
  weekCount: document.querySelector("#weekCount"),
  monthCount: document.querySelector("#monthCount"),
  bothCount: document.querySelector("#bothCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  searchInput: document.querySelector("#searchInput"),
  marketFilter: document.querySelector("#marketFilter"),
  matchFilter: document.querySelector("#matchFilter"),
  sortMode: document.querySelector("#sortMode"),
  resultMeta: document.querySelector("#resultMeta"),
  stockTableBody: document.querySelector("#stockTableBody"),
  rowTemplate: document.querySelector("#rowTemplate"),
  preview: document.querySelector("#chartPreview"),
  previewSymbol: document.querySelector("#previewSymbol"),
  previewName: document.querySelector("#previewName"),
  previewLink: document.querySelector("#previewLink"),
  previewFrame: document.querySelector("#previewFrame"),
  protocolWarning: document.querySelector("#protocolWarning"),
};

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return formatNumber(value, value >= 1000 ? 0 : 2);
}

function formatCloseDate(epochSeconds) {
  if (epochSeconds == null || Number.isNaN(epochSeconds)) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeZone: "Asia/Taipei",
  }).format(new Date(epochSeconds * 1000));
}

function marketLabel(exchange) {
  return exchange === "TWSE" ? "上市 TWSE" : exchange === "TPEX" ? "上櫃 TPEX" : exchange;
}

function trendDistance(close, sma200) {
  if (close == null || sma200 == null || !sma200) {
    return null;
  }

  return ((close - sma200) / sma200) * 100;
}

function getNumberClass(value) {
  if (value == null || Number.isNaN(value)) {
    return "neutral";
  }

  if (value < 0) {
    return "negative";
  }

  if (value > 0) {
    return "positive";
  }

  return "neutral";
}

function buildWidgetUrl(symbol) {
  const params = new URLSearchParams({
    frameElementId: "tv_hover_preview",
    symbol,
    interval: "D",
    hidesidetoolbar: "1",
    symboledit: "0",
    saveimage: "0",
    toolbarbg: "f8f2e8",
    studies: "[]",
    theme: "light",
    style: "1",
    timezone: "Asia/Taipei",
    withdateranges: "0",
    hide_side_toolbar: "1",
    allow_symbol_change: "0",
    details: "0",
    hotlist: "0",
    calendar: "0",
    locale: "zh_TW",
  });

  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function buildSymbolPageUrl(symbol) {
  return `https://tw.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function normaliseRow(item) {
  const [exchange, code] = item.s.split(":");
  const [
    name,
    description,
    close,
    closeTime,
    perfWeek,
    perfMonth,
    volatilityWeek,
    sma200,
    marketCap,
    type,
  ] = item.d;

  const weekMatch =
    type === "stock" &&
    close != null &&
    sma200 != null &&
    volatilityWeek != null &&
    close > sma200 &&
    perfWeek != null &&
    perfWeek <= -5 &&
    volatilityWeek >= 3;

  const monthMatch =
    type === "stock" &&
    close != null &&
    sma200 != null &&
    volatilityWeek != null &&
    close > sma200 &&
    perfMonth != null &&
    perfMonth <= -10 &&
    volatilityWeek >= 3;

  const distancePct = trendDistance(close, sma200);

  return {
    id: item.s,
    symbol: item.s,
    exchange,
    code,
    name: description || name || code,
    shortName: name || code,
    close,
    closeTime,
    perfWeek,
    perfMonth,
    volatilityWeek,
    sma200,
    marketCap,
    type,
    weekMatch,
    monthMatch,
    bothMatch: weekMatch && monthMatch,
    distancePct,
  };
}

async function fetchStocks() {
  const payload = {
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "exchange", operation: "in_range", right: ["TWSE", "TPEX"] },
    ],
    options: { lang: "zh_TW" },
    range: [0, 3000],
    sort: { sortBy: "name", sortOrder: "asc" },
    columns: COLUMNS,
  };

  const response = await fetch(SCAN_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`資料請求失敗 (${response.status})`);
  }

  const json = await response.json();

  if (!Array.isArray(json.data)) {
    throw new Error("資料格式不正確");
  }

  return json.data.map(normaliseRow);
}

function updateSummary(rows) {
  const weekCount = rows.filter((row) => row.weekMatch).length;
  const monthCount = rows.filter((row) => row.monthMatch).length;
  const bothCount = rows.filter((row) => row.bothMatch).length;

  els.weekCount.textContent = weekCount.toLocaleString("zh-TW");
  els.monthCount.textContent = monthCount.toLocaleString("zh-TW");
  els.bothCount.textContent = bothCount.toLocaleString("zh-TW");
}

function applyFilters() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const market = els.marketFilter.value;
  const matchMode = els.matchFilter.value;
  const sortMode = els.sortMode.value;

  const filtered = state.rows.filter((row) => {
    if (!(row.weekMatch || row.monthMatch)) {
      return false;
    }

    if (market !== "ALL" && row.exchange !== market) {
      return false;
    }

    if (matchMode === "WEEK" && !row.weekMatch) {
      return false;
    }

    if (matchMode === "MONTH" && !row.monthMatch) {
      return false;
    }

    if (matchMode === "BOTH" && !row.bothMatch) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const haystack = `${row.code} ${row.name} ${row.shortName} ${row.exchange}`.toLowerCase();
    return haystack.includes(keyword);
  });

  const sorted = [...filtered].sort((left, right) => compareRows(left, right, sortMode, matchMode));
  state.filteredRows = sorted;
  renderRows(sorted);
  els.resultMeta.textContent = `顯示 ${sorted.length.toLocaleString("zh-TW")} 檔 / 原始掃描 ${
    state.rows.length.toLocaleString("zh-TW")
  } 檔`;
}

function compareRows(left, right, sortMode, matchMode) {
  const effectiveMode =
    sortMode === "AUTO"
      ? matchMode === "WEEK"
        ? "WEEK_ASC"
        : matchMode === "MONTH"
          ? "MONTH_ASC"
          : "DISTANCE_ASC"
      : sortMode;

  if (effectiveMode === "WEEK_ASC") {
    return safeNumber(left.perfWeek) - safeNumber(right.perfWeek) || safeNumber(right.distancePct) - safeNumber(left.distancePct);
  }

  if (effectiveMode === "MONTH_ASC") {
    return safeNumber(left.perfMonth) - safeNumber(right.perfMonth) || safeNumber(right.distancePct) - safeNumber(left.distancePct);
  }

  if (effectiveMode === "VOL_DESC") {
    return safeNumber(right.volatilityWeek) - safeNumber(left.volatilityWeek) || safeNumber(left.perfWeek) - safeNumber(right.perfWeek);
  }

  return Math.abs(safeNumber(left.distancePct)) - Math.abs(safeNumber(right.distancePct)) || safeNumber(left.perfWeek) - safeNumber(right.perfWeek);
}

function safeNumber(value) {
  return value == null || Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

function renderRows(rows) {
  els.stockTableBody.innerHTML = "";

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = '<td colspan="10" class="empty-state">沒有符合目前條件的股票。</td>';
    els.stockTableBody.appendChild(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const node = els.rowTemplate.content.firstElementChild.cloneNode(true);
    const matchCell = node.querySelector(".match-cell");
    const symbolCell = node.querySelector(".symbol-cell");
    const closeCell = node.querySelector(".close-cell");
    const closeDateCell = node.querySelector(".close-date-cell");
    const weekCell = node.querySelector(".week-cell");
    const monthCell = node.querySelector(".month-cell");
    const volCell = node.querySelector(".vol-cell");
    const smaCell = node.querySelector(".sma-cell");
    const distanceCell = node.querySelector(".distance-cell");
    const marketCell = node.querySelector(".market-cell");

    matchCell.appendChild(buildMatchBadges(row));
    symbolCell.appendChild(buildSymbolButton(row));
    closeCell.textContent = formatPrice(row.close);
    closeDateCell.textContent = formatCloseDate(row.closeTime);
    weekCell.textContent = formatPercent(row.perfWeek);
    monthCell.textContent = formatPercent(row.perfMonth);
    volCell.textContent = formatPercent(row.volatilityWeek);
    smaCell.textContent = formatPrice(row.sma200);
    distanceCell.textContent = formatPercent(row.distancePct);
    marketCell.innerHTML = `<span class="market-chip">${marketLabel(row.exchange)}</span>`;

    weekCell.className = `number-cell week-cell ${getNumberClass(row.perfWeek)}`;
    monthCell.className = `number-cell month-cell ${getNumberClass(row.perfMonth)}`;
    volCell.className = `number-cell vol-cell ${getNumberClass(row.volatilityWeek)}`;
    distanceCell.className = `number-cell distance-cell ${getNumberClass(row.distancePct)}`;

    fragment.appendChild(node);
  });

  els.stockTableBody.appendChild(fragment);
}

function buildMatchBadges(row) {
  const wrap = document.createElement("div");
  wrap.className = "match-badges";

  if (row.bothMatch) {
    wrap.appendChild(makeBadge("雙重命中", "badge-both"));
  }

  if (row.weekMatch) {
    wrap.appendChild(makeBadge("本周大跌", "badge-week"));
  }

  if (row.monthMatch) {
    wrap.appendChild(makeBadge("本月大跌", "badge-month"));
  }

  return wrap;
}

function makeBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`;
  badge.textContent = text;
  return badge;
}

function buildSymbolButton(row) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "symbol-button";
  button.dataset.symbol = row.symbol;
  button.dataset.name = row.name;

  button.innerHTML = `<strong>${row.code}</strong><span>${row.name}</span>`;

  button.addEventListener("mouseenter", (event) => showPreview(event.currentTarget, row));
  button.addEventListener("focus", (event) => showPreview(event.currentTarget, row));
  button.addEventListener("mouseleave", schedulePreviewHide);
  button.addEventListener("blur", schedulePreviewHide);
  button.addEventListener("click", () => {
    window.open(buildSymbolPageUrl(row.symbol), "_blank", "noopener,noreferrer");
  });

  return button;
}

function showPreview(anchor, row) {
  clearTimeout(state.previewHideTimer);
  els.preview.classList.remove("hidden");
  els.previewSymbol.textContent = row.symbol;
  els.previewName.textContent = row.name;
  els.previewLink.href = buildSymbolPageUrl(row.symbol);

  const nextSrc = buildWidgetUrl(row.symbol);
  if (els.previewFrame.src !== nextSrc) {
    els.previewFrame.src = nextSrc;
  }

  positionPreview(anchor);
}

function positionPreview(anchor) {
  const rect = anchor.getBoundingClientRect();
  const previewRect = els.preview.getBoundingClientRect();
  const width = previewRect.width || 390;
  const height = previewRect.height || 320;

  let left = rect.right + 18;
  let top = rect.top - 8;

  if (left + width > window.innerWidth - 12) {
    left = Math.max(12, rect.left - width - 18);
  }

  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - height - 12);
  }

  els.preview.style.left = `${left}px`;
  els.preview.style.top = `${top}px`;
}

function schedulePreviewHide() {
  clearTimeout(state.previewHideTimer);
  state.previewHideTimer = window.setTimeout(() => {
    els.preview.classList.add("hidden");
  }, 180);
}

async function refreshData() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  els.refreshButton.disabled = true;
  els.statusText.textContent = "更新中，正在向 TradingView 取得最新台股掃描資料...";
  els.stockTableBody.innerHTML = '<tr><td colspan="10" class="empty-state">正在更新資料...</td></tr>';

  try {
    const rows = await fetchStocks();
    state.rows = rows;
    state.lastUpdated = new Date();

    updateSummary(rows);
    applyFilters();

    const timeText = new Intl.DateTimeFormat("zh-TW", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Taipei",
    }).format(state.lastUpdated);

    els.lastUpdated.textContent = timeText;
    els.statusText.textContent = `更新完成，共取得 ${rows.length.toLocaleString(
      "zh-TW",
    )} 檔台股資料。`;
  } catch (error) {
    els.statusText.textContent = `更新失敗：${error.message}`;
    els.stockTableBody.innerHTML =
      '<tr><td colspan="10" class="empty-state">資料更新失敗，請稍後再試。</td></tr>';
  } finally {
    state.loading = false;
    els.refreshButton.disabled = false;
  }
}

function bindEvents() {
  els.refreshButton.addEventListener("click", refreshData);
  els.searchInput.addEventListener("input", applyFilters);
  els.marketFilter.addEventListener("change", applyFilters);
  els.matchFilter.addEventListener("change", applyFilters);
  els.sortMode.addEventListener("change", applyFilters);
  els.preview.addEventListener("mouseenter", () => clearTimeout(state.previewHideTimer));
  els.preview.addEventListener("mouseleave", schedulePreviewHide);
  window.addEventListener("scroll", () => els.preview.classList.add("hidden"), { passive: true });
  window.addEventListener("resize", () => els.preview.classList.add("hidden"));
}

function initWarnings() {
  if (window.location.protocol === "file:") {
    els.protocolWarning.classList.remove("hidden");
    els.statusText.textContent =
      "偵測到你是直接開啟檔案。請先用本地 HTTP 伺服器開啟這個資料夾，才能抓 TradingView 最新資料。";
    els.lastUpdated.textContent = "請改用本地伺服器";
    els.stockTableBody.innerHTML =
      '<tr><td colspan="10" class="empty-state">請用本地伺服器開啟，例如 `python -m http.server 4173`。</td></tr>';
    return false;
  }

  return true;
}

window.stockRadar = {
  refreshData,
  get state() {
    return state;
  },
  showPreviewBySymbol(symbol) {
    const row = state.filteredRows.find((item) => item.symbol === symbol);
    const trigger = document.querySelector(`.symbol-button[data-symbol="${symbol}"]`);
    if (row && trigger) {
      showPreview(trigger, row);
    }
  },
};

bindEvents();
if (initWarnings()) {
  refreshData();
}
