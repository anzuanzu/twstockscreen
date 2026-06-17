const SCAN_PROXY_URL = "/api/taiwan-scan";
const SCAN_URL = "https://scanner.tradingview.com/taiwan/scan";
const TABLE_COLUMN_COUNT = 13;
const COLUMNS = [
  "name",
  "description",
  "close",
  "time",
  "Perf.W",
  "Perf.1M",
  "Volatility.W",
  "SMA200",
  "SMA20",
  "market_cap_basic",
  "type",
  "Recommend.All",
];

const MATCH_DEFINITIONS = [
  { key: "bullWeekMatch", filterValue: "BULL_WEEK", label: "多頭本周大跌", badgeClass: "badge-bull-week" },
  { key: "bullMonthMatch", filterValue: "BULL_MONTH", label: "多頭本月大跌", badgeClass: "badge-bull-month" },
  { key: "bearWeekMatch", filterValue: "BEAR_WEEK", label: "空頭本周大漲", badgeClass: "badge-bear-week" },
  { key: "bearMonthMatch", filterValue: "BEAR_MONTH", label: "空頭本月大漲", badgeClass: "badge-bear-month" },
];

const ANALYST_BANDS = [
  { value: "STRONG_BUY", label: "強力買進", min: 0.5, max: Number.POSITIVE_INFINITY, tone: "positive" },
  { value: "BUY", label: "買進", min: 0.1, max: 0.5, tone: "positive" },
  { value: "NEUTRAL", label: "中立", min: -0.1, max: 0.1, tone: "neutral" },
  { value: "SELL", label: "賣出", min: -0.5, max: -0.1, tone: "negative" },
  { value: "STRONG_SELL", label: "強力賣出", min: Number.NEGATIVE_INFINITY, max: -0.5, tone: "negative" },
];

function selectAny(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

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
  bullWeekCount: selectAny(["#bullWeekCount", "#weekCount"]),
  bullMonthCount: selectAny(["#bullMonthCount", "#monthCount"]),
  bearWeekCount: selectAny(["#bearWeekCount", "#bothCount"]),
  bearMonthCount: document.querySelector("#bearMonthCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  searchInput: document.querySelector("#searchInput"),
  marketFilter: document.querySelector("#marketFilter"),
  matchFilter: document.querySelector("#matchFilter"),
  sortMode: document.querySelector("#sortMode"),
  analystFilter: document.querySelector("#analystFilter"),
  distance20Min: document.querySelector("#distance20Min"),
  distance20Max: document.querySelector("#distance20Max"),
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

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setHtml(element, value) {
  if (element) {
    element.innerHTML = value;
  }
}

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

function distancePercent(close, average) {
  if (close == null || average == null || !average) {
    return null;
  }

  return ((close - average) / average) * 100;
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

function getAnalystBand(score) {
  if (score == null || Number.isNaN(score)) {
    return null;
  }

  return ANALYST_BANDS.find((band) => score >= band.min && score < band.max) || ANALYST_BANDS[2];
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
    sma20,
    marketCap,
    type,
    analystScore,
  ] = item.d;

  const isStock = type === "stock" && close != null && sma200 != null;
  const bullWeekMatch = isStock && close > sma200 && perfWeek != null && perfWeek <= -5;
  const bullMonthMatch = isStock && close > sma200 && perfMonth != null && perfMonth <= -10;
  const bearWeekMatch = isStock && close < sma200 && perfWeek != null && perfWeek >= 5;
  const bearMonthMatch = isStock && close < sma200 && perfMonth != null && perfMonth >= 10;
  const analystBand = getAnalystBand(analystScore);

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
    sma20,
    marketCap,
    type,
    analystScore,
    analystBand,
    bullWeekMatch,
    bullMonthMatch,
    bearWeekMatch,
    bearMonthMatch,
    anyBullMatch: bullWeekMatch || bullMonthMatch,
    anyBearMatch: bearWeekMatch || bearMonthMatch,
    anyMatch: bullWeekMatch || bullMonthMatch || bearWeekMatch || bearMonthMatch,
    distanceSma200Pct: distancePercent(close, sma200),
    distanceSma20Pct: distancePercent(close, sma20),
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

  let response;

  try {
    response = await fetch(SCAN_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`proxy ${response.status}`);
    }
  } catch {
    response = await fetch(SCAN_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

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
  setText(els.bullWeekCount, rows.filter((row) => row.bullWeekMatch).length.toLocaleString("zh-TW"));
  setText(els.bullMonthCount, rows.filter((row) => row.bullMonthMatch).length.toLocaleString("zh-TW"));
  setText(els.bearWeekCount, rows.filter((row) => row.bearWeekMatch).length.toLocaleString("zh-TW"));
  setText(els.bearMonthCount, rows.filter((row) => row.bearMonthMatch).length.toLocaleString("zh-TW"));
}

function parseInputNumber(input) {
  const value = input.value.trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesRange(value, min, max) {
  if (value == null || Number.isNaN(value)) {
    return min == null && max == null;
  }

  if (min != null && value < min) {
    return false;
  }

  if (max != null && value > max) {
    return false;
  }

  return true;
}

function matchesMode(row, matchMode) {
  if (matchMode === "BULL_ALL") {
    return row.anyBullMatch;
  }

  if (matchMode === "BEAR_ALL") {
    return row.anyBearMatch;
  }

  if (matchMode === "BULL_WEEK") {
    return row.bullWeekMatch;
  }

  if (matchMode === "BULL_MONTH") {
    return row.bullMonthMatch;
  }

  if (matchMode === "BEAR_WEEK") {
    return row.bearWeekMatch;
  }

  if (matchMode === "BEAR_MONTH") {
    return row.bearMonthMatch;
  }

  return row.anyMatch;
}

function matchesAnalystFilter(row, analystFilter) {
  if (analystFilter === "ALL") {
    return true;
  }

  return row.analystBand?.value === analystFilter;
}

function applyFilters() {
  const keyword = els.searchInput?.value.trim().toLowerCase() || "";
  const market = els.marketFilter?.value || "ALL";
  const matchMode = els.matchFilter?.value || "ALL";
  const sortMode = els.sortMode?.value || "AUTO";
  const analystFilter = els.analystFilter?.value || "ALL";
  const distance20Min = parseInputNumber(els.distance20Min);
  const distance20Max = parseInputNumber(els.distance20Max);

  const filtered = state.rows.filter((row) => {
    if (!matchesMode(row, matchMode)) {
      return false;
    }

    if (market !== "ALL" && row.exchange !== market) {
      return false;
    }

    if (!matchesAnalystFilter(row, analystFilter)) {
      return false;
    }

    if (!matchesRange(row.distanceSma20Pct, distance20Min, distance20Max)) {
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
  setText(
    els.resultMeta,
    `顯示 ${sorted.length.toLocaleString("zh-TW")} 檔 / 原始掃描 ${state.rows.length.toLocaleString("zh-TW")} 檔`,
  );
}

function effectiveSortMode(sortMode, matchMode) {
  if (sortMode !== "AUTO") {
    return sortMode;
  }

  if (matchMode === "BULL_WEEK") {
    return "BULL_WEEK";
  }

  if (matchMode === "BULL_MONTH") {
    return "BULL_MONTH";
  }

  if (matchMode === "BEAR_WEEK") {
    return "BEAR_WEEK";
  }

  if (matchMode === "BEAR_MONTH") {
    return "BEAR_MONTH";
  }

  return "DISTANCE_SMA200_ASC";
}

function compareNumeric(a, b, { direction = "asc", absolute = false } = {}) {
  if (a == null || Number.isNaN(a)) {
    return b == null || Number.isNaN(b) ? 0 : 1;
  }

  if (b == null || Number.isNaN(b)) {
    return -1;
  }

  const left = absolute ? Math.abs(a) : a;
  const right = absolute ? Math.abs(b) : b;
  return direction === "desc" ? right - left : left - right;
}

function compareRows(left, right, sortMode, matchMode) {
  const effectiveMode = effectiveSortMode(sortMode, matchMode);

  if (effectiveMode === "BULL_WEEK") {
    return (
      compareNumeric(left.perfWeek, right.perfWeek) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "BEAR_WEEK") {
    return (
      compareNumeric(left.perfWeek, right.perfWeek, { direction: "desc" }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "BULL_MONTH") {
    return (
      compareNumeric(left.perfMonth, right.perfMonth) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "BEAR_MONTH") {
    return (
      compareNumeric(left.perfMonth, right.perfMonth, { direction: "desc" }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "DISTANCE_SMA20_ASC") {
    return (
      compareNumeric(left.distanceSma20Pct, right.distanceSma20Pct, { absolute: true }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  if (effectiveMode === "RATING_DESC") {
    return compareNumeric(left.analystScore, right.analystScore, { direction: "desc" });
  }

  if (effectiveMode === "RATING_ASC") {
    return compareNumeric(left.analystScore, right.analystScore);
  }

  if (effectiveMode === "VOL_DESC") {
    return (
      compareNumeric(left.volatilityWeek, right.volatilityWeek, { direction: "desc" }) ||
      compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true })
    );
  }

  return (
    compareNumeric(left.distanceSma200Pct, right.distanceSma200Pct, { absolute: true }) ||
    compareNumeric(left.distanceSma20Pct, right.distanceSma20Pct, { absolute: true }) ||
    left.code.localeCompare(right.code, "zh-Hant")
  );
}

function renderRows(rows) {
  if (!els.stockTableBody) {
    return;
  }

  els.stockTableBody.innerHTML = "";

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">沒有符合目前條件的股票。</td>`;
    els.stockTableBody.appendChild(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const node = document.createElement("tr");
    node.innerHTML = `
      <td class="match-cell"></td>
      <td class="symbol-cell"></td>
      <td class="number-cell close-cell"></td>
      <td class="close-date-cell"></td>
      <td class="number-cell week-cell"></td>
      <td class="number-cell month-cell"></td>
      <td class="number-cell vol-cell"></td>
      <td class="rating-cell"></td>
      <td class="number-cell sma-cell"></td>
      <td class="number-cell distance200-cell"></td>
      <td class="number-cell sma20-cell"></td>
      <td class="number-cell distance20-cell"></td>
      <td class="market-cell"></td>
    `;
    const matchCell = node.querySelector(".match-cell");
    const symbolCell = node.querySelector(".symbol-cell");
    const closeCell = node.querySelector(".close-cell");
    const closeDateCell = node.querySelector(".close-date-cell");
    const weekCell = node.querySelector(".week-cell");
    const monthCell = node.querySelector(".month-cell");
    const volCell = node.querySelector(".vol-cell");
    const ratingCell = node.querySelector(".rating-cell");
    const smaCell = node.querySelector(".sma-cell");
    const distance200Cell = node.querySelector(".distance200-cell");
    const sma20Cell = node.querySelector(".sma20-cell");
    const distance20Cell = node.querySelector(".distance20-cell");
    const marketCell = node.querySelector(".market-cell");

    matchCell.appendChild(buildMatchBadges(row));
    symbolCell.appendChild(buildSymbolButton(row));
    setText(closeCell, formatPrice(row.close));
    setText(closeDateCell, formatCloseDate(row.closeTime));
    setText(weekCell, formatPercent(row.perfWeek));
    setText(monthCell, formatPercent(row.perfMonth));
    setText(volCell, formatPercent(row.volatilityWeek));
    if (ratingCell) {
      ratingCell.appendChild(buildRatingCell(row));
    }
    setText(smaCell, formatPrice(row.sma200));
    setText(distance200Cell, formatPercent(row.distanceSma200Pct));
    setText(sma20Cell, formatPrice(row.sma20));
    setText(distance20Cell, formatPercent(row.distanceSma20Pct));
    setHtml(marketCell, `<span class="market-chip">${marketLabel(row.exchange)}</span>`);

    if (weekCell) weekCell.className = `number-cell week-cell ${getNumberClass(row.perfWeek)}`;
    if (monthCell) monthCell.className = `number-cell month-cell ${getNumberClass(row.perfMonth)}`;
    if (volCell) volCell.className = `number-cell vol-cell ${getNumberClass(row.volatilityWeek)}`;
    if (distance200Cell) distance200Cell.className = `number-cell distance200-cell ${getNumberClass(row.distanceSma200Pct)}`;
    if (distance20Cell) distance20Cell.className = `number-cell distance20-cell ${getNumberClass(row.distanceSma20Pct)}`;

    fragment.appendChild(node);
  });

  els.stockTableBody.appendChild(fragment);
}

function buildMatchBadges(row) {
  const wrap = document.createElement("div");
  wrap.className = "match-badges";

  MATCH_DEFINITIONS.forEach((definition) => {
    if (row[definition.key]) {
      wrap.appendChild(makeBadge(definition.label, definition.badgeClass));
    }
  });

  return wrap;
}

function makeBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`;
  badge.textContent = text;
  return badge;
}

function buildRatingCell(row) {
  const wrap = document.createElement("div");
  wrap.className = "rating-stack";

  if (!row.analystBand) {
    wrap.innerHTML = '<strong class="neutral">—</strong><span>無資料</span>';
    return wrap;
  }

  const label = document.createElement("strong");
  label.className = row.analystBand.tone;
  label.textContent = row.analystBand.label;

  const score = document.createElement("span");
  score.textContent = `分數 ${formatNumber(row.analystScore, 2)}`;

  wrap.append(label, score);
  return wrap;
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
  if (!els.preview || !els.previewSymbol || !els.previewName || !els.previewLink || !els.previewFrame) {
    return;
  }

  els.preview.classList.remove("hidden");
  setText(els.previewSymbol, row.symbol);
  setText(els.previewName, row.name);
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
  if (els.refreshButton) {
    els.refreshButton.disabled = true;
  }
  setText(els.statusText, "更新中，正在向 TradingView 取得最新台股掃描資料...");
  setHtml(
    els.stockTableBody,
    `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">正在更新資料...</td></tr>`,
  );

  try {
    state.rows = await fetchStocks();
    state.lastUpdated = new Date();

    updateSummary(state.rows);
    applyFilters();

    const timeText = new Intl.DateTimeFormat("zh-TW", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Taipei",
    }).format(state.lastUpdated);

    setText(els.lastUpdated, timeText);
    setText(els.statusText, `更新完成，共取得 ${state.rows.length.toLocaleString("zh-TW")} 檔台股資料。`);
  } catch (error) {
    setText(els.statusText, `更新失敗：${error.message}`);
    setHtml(
      els.stockTableBody,
      `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">資料更新失敗，請稍後再試。</td></tr>`,
    );
  } finally {
    state.loading = false;
    if (els.refreshButton) {
      els.refreshButton.disabled = false;
    }
  }
}

function bindEvents() {
  els.refreshButton?.addEventListener("click", refreshData);
  els.searchInput?.addEventListener("input", applyFilters);
  els.marketFilter?.addEventListener("change", applyFilters);
  els.matchFilter?.addEventListener("change", applyFilters);
  els.sortMode?.addEventListener("change", applyFilters);
  els.analystFilter?.addEventListener("change", applyFilters);
  els.distance20Min?.addEventListener("input", applyFilters);
  els.distance20Max?.addEventListener("input", applyFilters);
  els.preview?.addEventListener("mouseenter", () => clearTimeout(state.previewHideTimer));
  els.preview?.addEventListener("mouseleave", schedulePreviewHide);
  window.addEventListener("scroll", () => els.preview?.classList.add("hidden"), { passive: true });
  window.addEventListener("resize", () => els.preview?.classList.add("hidden"));
}

function initWarnings() {
  if (window.location.protocol === "file:") {
    els.protocolWarning?.classList.remove("hidden");
    setText(
      els.statusText,
      "偵測到你是直接開啟檔案。請先用本地 HTTP 伺服器開啟這個資料夾，才能抓 TradingView 最新資料。",
    );
    setText(els.lastUpdated, "請改用本地伺服器");
    setHtml(
      els.stockTableBody,
      `<tr><td colspan="${TABLE_COLUMN_COUNT}" class="empty-state">請用本地伺服器開啟，建議使用 \`node server.js\`。</td></tr>`,
    );
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
