// ticker-select.js
import BinanceSocket from './binance-socket.js';
import { ChartRenderer } from './chart-renderer.js';
import { ChartDataManager } from './chart-data-manager.js';
import { adjustGridLayout } from './lightweightchart.js';

// Singleton pool for global cleanup of all listeners created by this module
const TickerSelectCleanup = {
  listeners: [],
  add(el, event, handler, opts) {
    el.addEventListener(event, handler, opts);
    this.listeners.push({ el, event, handler, opts });
  },
  cleanup() {
    this.listeners.forEach(({ el, event, handler, opts }) => {
      try { el.removeEventListener(event, handler, opts); } catch {}
    });
    this.listeners = [];
  }
};

const socketHelper = BinanceSocket;
let allSymbols = [];

// ----------------- FAVORITES -----------------
function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem("favoriteTickers")) || [];
  } catch {
    return [];
  }
}
function saveFavorites(list) {
  localStorage.setItem("favoriteTickers", JSON.stringify(list));
}
function refreshFavoritesMenu() {
  const favSelect = document.getElementById("favorite-select");
  if (!favSelect) return;
  const favorites = loadFavorites();
  favSelect.innerHTML =
    `<option value="">⭐ Favorites</option>` +
    favorites.map(s => `<option value="${s}">${s}</option>`).join("");
}
function toggleFavorite(symbol, starEl) {
  let favorites = loadFavorites();
  symbol = symbol.toUpperCase();
  if (favorites.includes(symbol)) {
    favorites = favorites.filter(s => s !== symbol);
    starEl.classList.remove("favorited");
  } else {
    favorites.push(symbol);
    starEl.classList.add("favorited");
  }
  saveFavorites(favorites);
  refreshFavoritesMenu();
}

// ✅ fetch all Binance symbols once
async function loadSymbolsList() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const data = await response.json();
    return data.symbols.map(s => s.symbol);
  } catch (err) {
    console.error('Failed to load symbol list', err);
    return [];
  }
}

// ✅ debounce utility
function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ✅ enable replacing ticker in existing cards
function enableTickerReplacement(card, chartInstance, dataManager, allCharts, chartKey) {
  const input = card.querySelector('.ticker-input');
  const tfSelect = card.querySelector('.timeframe-select');
  if (!input || !tfSelect) return;

  const handler = async () => {
    if (window.isGlobalError) return; // Disable if error banner is up
    const newSymbol = input.value.trim().toUpperCase();
    if (!newSymbol || newSymbol === chartInstance.symbol) return;

    const valid = await socketHelper.isValidSymbol(newSymbol);
    if (!valid) {
      alert(`Invalid symbol: ${newSymbol}`);
      input.value = chartInstance.symbol;
      return;
    }

    await dataManager.unsubscribe(chartInstance.symbol, tfSelect.value);
    chartInstance.symbol = newSymbol;
    card.dataset.symbol = newSymbol.toLowerCase();
    const priceEl = card.querySelector('.current-price');
    if (priceEl) priceEl.setAttribute('data-ticker', newSymbol.toLowerCase());

    try {
      const candles = await dataManager.loadAndStart(newSymbol, tfSelect.value, chartInstance);
      console.log(`[${newSymbol}] loaded ${candles?.length || 0} candles`);
    } catch (err) {
      console.error(`Failed to reload ${newSymbol}:`, err);
    }

    if (allCharts.has(chartKey)) {
      allCharts.get(chartKey).symbol = newSymbol;
    }
  };

  TickerSelectCleanup.add(input, 'change', handler);
}

export async function setupTickerSelect(allCharts) {
  const input = document.getElementById('new-symbol');
  const addBtn = document.getElementById('add-chart');
  const favSelect = document.getElementById('favorite-select');
  const grid = document.getElementById('chart-grid');
  if (!input || !addBtn || !grid) return;

  allSymbols = await loadSymbolsList();

  // ✅ suggestion box
  const suggestionBox = document.createElement('div');
  suggestionBox.id = 'symbol-suggestions';
  suggestionBox.style.position = 'absolute';
  suggestionBox.style.background = '#161b22';
  suggestionBox.style.border = '1px solid #30363d';
  suggestionBox.style.maxHeight = '200px';
  suggestionBox.style.overflowY = 'auto';
  suggestionBox.style.zIndex = '1000';
  suggestionBox.style.display = 'none';
  document.body.appendChild(suggestionBox);

  function positionSuggestions() {
    const rect = input.getBoundingClientRect();
    suggestionBox.style.left = `${rect.left}px`;
    suggestionBox.style.top = `${rect.bottom + window.scrollY}px`;
    suggestionBox.style.width = `${rect.width}px`;
  }
  TickerSelectCleanup.add(window, 'resize', positionSuggestions);
  TickerSelectCleanup.add(window, 'scroll', positionSuggestions, true);

  const showSuggestions = debounce(() => {
    const query = input.value.trim().toUpperCase();
    if (!query) {
      suggestionBox.style.display = 'none';
      return;
    }
    const matches = allSymbols.filter(s => s.includes(query)).slice(0, 20);
    if (!matches.length) {
      suggestionBox.style.display = 'none';
      return;
    }
    suggestionBox.innerHTML = matches
      .map(s => `<div class="suggestion-item" style="padding:4px 8px;cursor:pointer;">${s}</div>`)
      .join('');
    Array.from(suggestionBox.querySelectorAll('.suggestion-item')).forEach(item => {
      TickerSelectCleanup.add(item, 'click', () => {
        input.value = item.textContent;
        suggestionBox.style.display = 'none';
      });
    });
    positionSuggestions();
    suggestionBox.style.display = 'block';
  }, 150);

  TickerSelectCleanup.add(input, 'input', showSuggestions);
  TickerSelectCleanup.add(document, 'click', e => {
    if (e.target !== input && !suggestionBox.contains(e.target)) {
      suggestionBox.style.display = 'none';
    }
  });

  // ✅ Add Chart button
  const addChartHandler = async () => {
    if (window.isGlobalError) return; // Disable if error banner is up
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    const valid = await socketHelper.isValidSymbol(symbol);
    if (!valid) {
      alert(`Invalid symbol: ${symbol}`);
      return;
    }

    const uniqueId = `${symbol.toLowerCase()}-${Date.now()}`;
    const cardId = `chart-${uniqueId}`;
    const rsiPanelId = `rsi-panel-${uniqueId}`;
    const rsiChartId = `rsi-chart-${uniqueId}`;

    const card = document.createElement('div');
    card.className = 'chart-card chart-ticker';
    card.dataset.symbol = symbol.toLowerCase();
    card.id = `${uniqueId}-card`;
    card.innerHTML = `
      <div class="chart-header">
        <div class="drag-handle" title="Drag to move">☰</div>
        <div class="ticker-wrap">
          <input type="text" value="${symbol}" class="ticker-input">
          <span class="current-price" data-ticker="${symbol.toLowerCase()}"></span>
        </div>
        <span class="favorite-star" title="Add to favorites">★</span>
        <select class="timeframe-select">
          <option value="1m">1m</option>
          <option value="3m">3m</option>
          <option value="5m" selected>5m</option>
          <option value="15m">15m</option>
          <option value="30m">30m</option>
          <option value="1h">1h</option>
          <option value="2h">2h</option>
          <option value="4h">4h</option>
          <option value="6h">6h</option>
          <option value="8h">8h</option>
          <option value="12h">12h</option>
          <option value="1d">1d</option>
          <option value="3d">3d</option>
          <option value="1w">1w</option>
          <option value="1M">1M</option>
        </select>
        <div class="right-controls">
          <button class="toggle-indicators" title="Indicators">📊</button>
          <button class="fullscreen-btn" title="Fullscreen">⛶</button>
          <button class="remove-btn">✕</button>
        </div>
      </div>

      <div class="chart-wrap">
        <div id="${cardId}" class="tvchart"></div>
      </div>

      <div class="rsi-panel" id="${rsiPanelId}" style="display:none;">
        <div class="rsi-header">
          <span class="rsi-title">RSI (14)</span>
          <span class="rsi-value" id="rsi-value-${uniqueId}"></span>
        </div>
        <div id="${rsiChartId}" class="rsi-chart"></div>
      </div>

      <!-- Indicators panel -->
      <div class="indicators-panel" id="indicators-${uniqueId}">
        <h4>Indicators</h4>
        <div class="indicator-toggles">
          <label><input type="checkbox" data-indicator="rsi"> Relative Strength Index (RSI)</label>
          <label><input type="checkbox" data-indicator="ema"> Exponential Moving Averages (EMA)</label>
          <label><input type="checkbox" data-indicator="volume"> Volume</label>
        </div>
        <div class="ema-settings-panel" id="ema-settings-${uniqueId}" style="display:none;">
          <h4>EMA Settings</h4>
          ${[1,2,3,4].map(i => `
            <div>
              <label>EMA ${i}:</label>
              <input type="number" value="${i===1?20:i===2?100:i===3?200:400}" min="1" id="ema-period-${uniqueId}${i}">
              <input type="color" value="${i===1?'#ff9800':i===2?'#2196f3':i===3?'#4caf50':'#e91e63'}" id="ema-color-${uniqueId}${i}">
              <label><input type="checkbox" class="ema-badge-toggle" checked> Show Badge</label>
            </div>
          `).join('')}
          <button class="save-ema-btn" data-target="${uniqueId}">Save</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
    adjustGridLayout();

    const dataManager = new ChartDataManager();
    const chartInstance = new ChartRenderer(cardId, symbol, dataManager);
    chartInstance.init();
    allCharts.set(uniqueId, { chartInstance, dataManager, symbol });

    const tfSelect = card.querySelector('.timeframe-select');
    let chartInterval = tfSelect.value;

    try {
      const candles = await dataManager.loadAndStart(symbol, chartInterval, chartInstance);
      console.log(`[${symbol}] loaded ${candles?.length || 0} candles`);
    } catch (err) {
      console.error(`Failed to load ${symbol}:`, err);
    }

    // Timeframe change cleanup
    const timeframeHandler = async () => {
      if (window.isGlobalError) return; // Disable if error banner is up
      const newInterval = tfSelect.value;
      await dataManager.unsubscribe(symbol, chartInterval);
      chartInterval = newInterval;
      try {
        const candles = await dataManager.loadAndStart(symbol, chartInterval, chartInstance);
        console.log(`[${symbol}] switched to ${newInterval}, loaded ${candles?.length || 0} candles`);
      } catch (err) {
        console.error(`Failed to switch interval for ${symbol}:`, err);
      }
    };
    TickerSelectCleanup.add(tfSelect, 'change', timeframeHandler);

    // Remove button cleanup
    const removeBtn = card.querySelector('.remove-btn');
    const removeHandler = () => {
      if (window.isGlobalError) return; // Disable if error banner is up
      dataManager.unsubscribe(symbol, chartInterval);
      chartInstance.destroy();
      card.remove();
      allCharts.delete(uniqueId);
      adjustGridLayout();
    };
    TickerSelectCleanup.add(removeBtn, 'click', removeHandler);

    enableTickerReplacement(card, chartInstance, dataManager, allCharts, uniqueId);

    // ✅ Restore saved EMA config if exists
    const savedConfig = localStorage.getItem(`emaConfig-${uniqueId}`);
    if (savedConfig) {
      const { periods, colors, badges } = JSON.parse(savedConfig);
      periods.forEach((p, i) => {
        const numInput = card.querySelector(`#ema-period-${uniqueId}${i+1}`);
        const colInput = card.querySelector(`#ema-color-${uniqueId}${i+1}`);
        const badgeToggle = card.querySelectorAll('.ema-badge-toggle')[i];
        if (numInput) numInput.value = p;
        if (colInput) colInput.value = colors[i];
        if (badgeToggle) badgeToggle.checked = badges?.[i] ?? true;
      });
      chartInstance.addIndicator('ema', { periods, colors, badges });
      card.querySelector('input[data-indicator="ema"]').checked = true;
      card.querySelector(`#ema-settings-${uniqueId}`).style.display = 'flex';
    }

    const starEl = card.querySelector(".favorite-star");
    const favorites = loadFavorites();
    if (favorites.includes(symbol)) {
      starEl.classList.add("favorited");
    }
    TickerSelectCleanup.add(starEl, "click", () => toggleFavorite(symbol, starEl));

    input.value = '';
    suggestionBox.style.display = 'none';
  };
  TickerSelectCleanup.add(addBtn, 'click', addChartHandler);

  // ✅ Favorites dropdown select
  const favSelectHandler = async e => {
    if (window.isGlobalError) return; // Disable if error banner is up
    const symbol = e.target.value;
    if (symbol) {
      const card = document.querySelector(`.chart-card[data-symbol="${symbol.toLowerCase()}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("highlight");
        setTimeout(() => card.classList.remove("highlight"), 1200);
      } else {
        input.value = symbol;
        addBtn.click();
      }
      e.target.value = "";
    }
  };
  TickerSelectCleanup.add(favSelect, "change", favSelectHandler);

  refreshFavoritesMenu();

  // ✅ attach star handlers for static cards (BTC, ETH, SOL, BNB)
  document.querySelectorAll(".chart-card .favorite-star").forEach(starEl => {
    const card = starEl.closest(".chart-card");
    if (!card) return;
    const symbol = card.dataset.symbol?.toUpperCase();
    if (!symbol) return;

    if (loadFavorites().includes(symbol)) {
      starEl.classList.add("favorited");
    }
    TickerSelectCleanup.add(starEl, "click", () => toggleFavorite(symbol, starEl));
  });

  // Return a cleanup function for global shutdown
  return () => {
    TickerSelectCleanup.cleanup();
    if (suggestionBox && suggestionBox.parentNode) suggestionBox.parentNode.removeChild(suggestionBox);
  };
}