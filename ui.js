// ui.js (Enhanced with Error Boundaries)
// FIXED: Comprehensive error boundaries for all rendering operations
// FIXED: Graceful degradation and error recovery
// FIXED: User-friendly error messages with retry mechanisms
// FIXED: Proper equity and P&L display everywhere using state.getEquity()

import { formatMoney, uid } from './utils.js';

const CSS_FILE = 'paper-trader/ui.css';
const FALLBACK_CSS = null;

function ensureCssLoaded(href, fallbackCss) {
  return new Promise((resolve) => {
    const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
    if (existing) { resolve(true); return; }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => {
      if (fallbackCss) {
        const style = document.createElement('style');
        style.textContent = fallbackCss;
        document.head.appendChild(style);
      }
      resolve(false);
    };
    document.head.appendChild(link);
  });
}

// XSS Protection: Sanitize user input
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Safe number formatting
function safeFormatNumber(value, decimals = 2) {
  try {
    const num = Number(value);
    if (!isFinite(num) || isNaN(num)) return '0.00';
    return num.toFixed(decimals);
  } catch (e) {
    console.warn('[UI] Number format error:', e);
    return '0.00';
  }
}

// Error boundary wrapper for render methods
class RenderErrorBoundary {
  constructor(component, fallbackRenderer) {
    this.component = component;
    this.fallbackRenderer = fallbackRenderer;
    this.errorCount = 0;
    this.lastError = null;
    this.errorTimestamp = null;
  }

  /**
   * Safely execute a render function with error handling
   */
  safeRender(renderFn, context = 'render') {
    try {
      // Reset error count if last error was > 1 minute ago
      if (this.errorTimestamp && Date.now() - this.errorTimestamp > 60000) {
        this.errorCount = 0;
        this.lastError = null;
      }

      const result = renderFn();
      
      // Reset error count on successful render
      if (this.errorCount > 0) {
        console.log(`[UI] ${context} recovered after ${this.errorCount} error(s)`);
        this.errorCount = 0;
        this.lastError = null;
      }
      
      return result;
    } catch (error) {
      this.errorCount++;
      this.lastError = error;
      this.errorTimestamp = Date.now();

      console.error(`[UI] ${context} error (attempt ${this.errorCount}):`, error);
      
      // Log stack trace for debugging
      if (error.stack) {
        console.error(error.stack);
      }

      // Notify user after 2nd consecutive error
      if (this.errorCount >= 2 && this.component.deps?.notifications) {
        this.component.deps.notifications.error(
          `UI rendering issue in ${context}. Some features may not work correctly.`
        );
      }

      // Return fallback UI
      return this.fallbackRenderer(error, context);
    }
  }

  /**
   * Check if we should show error state instead of trying to render
   */
  shouldShowErrorState() {
    return this.errorCount >= 3;
  }

  /**
   * Reset error boundary (for manual recovery)
   */
  reset() {
    this.errorCount = 0;
    this.lastError = null;
    this.errorTimestamp = null;
  }

  /**
   * Get error diagnostics
   */
  getDiagnostics() {
    return {
      errorCount: this.errorCount,
      lastError: this.lastError?.message,
      timestamp: this.errorTimestamp,
      shouldShowErrorState: this.shouldShowErrorState()
    };
  }
}

// Inline SVGs
const SVGS = {
  dashboard() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/>
      <rect x="13" y="3" width="8" height="5" rx="1" fill="currentColor" opacity="0.9"/>
      <rect x="13" y="10" width="8" height="11" rx="1" fill="currentColor" opacity="0.7"/>
    </svg>`;
  },

  history() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12A9 9 0 1 1 12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 7v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },

  stats() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3v18h18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7 13v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 9v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M17 5v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },

  positions() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3v18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M5 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M5 16h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },

  close() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },

  export() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 21H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },

  error() {
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
      <path d="M12 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="12" cy="16" r="1" fill="currentColor"/>
    </svg>`;
  },

  refresh() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9h-4m-5 9a9 9 0 0 1 0-18m0 18v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
};

export default class UI {
  constructor(options = {}, deps = {}) {
    this.options = options;
    this.deps = deps;
    this.panel = null;
    this.overlay = null;
    this.isOpen = false;
    this.events = new Map();
    this._listeners = [];
    this.currentTheme = this._detectTheme();
    
    // FIXED: Initialize error boundaries for each render method
    this.errorBoundaries = {
      orderForm: new RenderErrorBoundary(this, this._renderOrderFormFallback.bind(this)),
      positions: new RenderErrorBoundary(this, this._renderPositionsFallback.bind(this)),
      history: new RenderErrorBoundary(this, this._renderHistoryFallback.bind(this)),
      performance: new RenderErrorBoundary(this, this._renderPerformanceFallback.bind(this)),
      balance: new RenderErrorBoundary(this, this._renderBalanceFallback.bind(this))
    };

    // Track refresh errors separately
    this._consecutiveRefreshErrors = 0;
    this._lastRefreshError = null;

    ensureCssLoaded(CSS_FILE, FALLBACK_CSS);
  }

  _detectTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  on(name, cb) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(cb);
  }

  _emit(name, payload) {
    (this.events.get(name) || []).forEach(cb => { 
      try { cb(payload); } catch (e) { console.warn('[UI] Event handler error:', e); } 
    });
  }

  /**
   * FIXED: Safe state access with validation
   */
  _safeGetState() {
    try {
      if (!this.deps?.state) {
        throw new Error('State not available');
      }
      return this.deps.state;
    } catch (e) {
      console.error('[UI] State access error:', e);
      return {
        balance: 0,
        initialBalance: 10000,
        positions: [],
        trades: [],
        pendingOrders: [],
        getLastPrice: () => 0,
        getTotalMarginUsed: () => 0,
        getEquity: () => 0,
        getPerformanceMetrics: () => ({})
      };
    }
  }

  /**
   * FIXED: Error boundary wrapper for buildPanel
   */
  buildPanel() {
    if (this.panel) return;

    try {
      this._buildPanelInternal();
    } catch (error) {
      console.error('[UI] Critical error building panel:', error);
      
      // Create minimal error panel
      this.panel = document.createElement('aside');
      this.panel.className = 'paper-trader-panel';
      this.panel.id = 'paper-trader-panel';
      this.panel.innerHTML = this._renderCriticalError(error);
      document.body.appendChild(this.panel);

      if (this.deps?.notifications) {
        this.deps.notifications.error('Failed to initialize Paper Trader UI. Please reload the page.');
      }
    }
  }

  _buildPanelInternal() {
    // overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'pt-overlay';
    this.overlay.id = 'pt-overlay';
    this.overlay.onclick = () => this.hide();
    document.body.appendChild(this.overlay);

    // panel
    this.panel = document.createElement('aside');
    this.panel.className = 'paper-trader-panel';
    this.panel.id = 'paper-trader-panel';
    document.body.appendChild(this.panel);

    // header
    const header = document.createElement('div');
    header.className = 'pt-header';
    header.innerHTML = `
      <div class="brand">
        <div class="logo" aria-hidden>${SVGS.dashboard()}</div>
        <div>
          <h2>Paper Trading</h2>
          <div class="subtitle">Simulation Platform</div>
        </div>
      </div>
      <button id="pt-close" aria-label="Close">${SVGS.close()}</button>
    `;
    this.panel.appendChild(header);

    // body
    const body = document.createElement('div');
    body.className = 'pt-body';

    // FIXED: Safe rendering of balance card with error boundary
    const balanceCard = document.createElement('div');
    balanceCard.className = 'pt-accent-card';
    balanceCard.id = 'pt-balance-card';
    balanceCard.innerHTML = this.errorBoundaries.balance.safeRender(
      () => this._renderBalanceCard(),
      'balance card'
    );
    body.appendChild(balanceCard);

    // Leverage metrics (conditionally shown)
    if (this.options.leverageSimulation) {
      const lev = document.createElement('div');
      lev.className = 'card';
      lev.style.marginTop = '12px';
      lev.innerHTML = this._renderLeverageMetrics();
      body.appendChild(lev);
    }

    // tabs
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'pt-tabs';
    tabsWrap.innerHTML = `
      <button class="pt-tab active" data-tab="order">Order</button>
      <button class="pt-tab" data-tab="positions">Positions <span class="pt-badge" id="pos-count" style="display:none;"></span></button>
      <button class="pt-tab" data-tab="history">History <span class="pt-badge" id="trade-count" style="display:none;"></span></button>
      <button class="pt-tab" data-tab="performance">Stats</button>
    `;
    body.appendChild(tabsWrap);

    // FIXED: Safe rendering of tab contents
    const tabOrder = document.createElement('div');
    tabOrder.id = 'pt-tab-order';
    tabOrder.className = 'pt-tab-content active';
    tabOrder.innerHTML = this.errorBoundaries.orderForm.safeRender(
      () => this._renderOrderForm(),
      'order form'
    );
    body.appendChild(tabOrder);

    const tabPositions = document.createElement('div');
    tabPositions.id = 'pt-tab-positions';
    tabPositions.className = 'pt-tab-content';
    tabPositions.style.display = 'none';
    body.appendChild(tabPositions);

    const tabHistory = document.createElement('div');
    tabHistory.id = 'pt-tab-history';
    tabHistory.className = 'pt-tab-content';
    tabHistory.style.display = 'none';
    body.appendChild(tabHistory);

    const tabPerformance = document.createElement('div');
    tabPerformance.id = 'pt-tab-performance';
    tabPerformance.className = 'pt-tab-content';
    tabPerformance.style.display = 'none';
    body.appendChild(tabPerformance);

    this.panel.appendChild(body);

    // footer
    const footer = document.createElement('div');
    footer.className = 'pt-footer';
    footer.innerHTML = `
      <div class="controls">
        <button id="pt-export" class="btn btn-ghost" title="Export trades">${SVGS.export()} Export</button>
        <button id="pt-reset" class="btn btn-danger" title="Reset account">Reset</button>
      </div>
      <div style="font-size:11px; color:var(--text-dim); display:flex; gap:12px; align-items:center;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="pt-enable-desktop-alerts" ${this.deps.notifications?.enableDesktopAlerts ? 'checked' : ''}/>
          <span>Desktop Notifications</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="pt-enable-trade-sound" ${this.deps.notifications?.enableTradeSound ? 'checked' : ''}/>
          <span>Trade Sound Alerts</span>
        </label>
      </div>
    `;
    this.panel.appendChild(footer);

    // insert toggle button
    this._insertToggleButton();

    // bind handlers & features
    this._bindHandlers();
    this._bindNotificationToggles();
  }

  /**
   * FIXED: Proper equity and P&L display using state.getEquity()
   */
  _renderBalanceCard() {
    const state = this._safeGetState();
    const balance = safeFormatNumber(state.balance);
    const equity = safeFormatNumber(state.getEquity());
    const totalPnL = state.getEquity() - state.initialBalance;
    const pnl = safeFormatNumber(totalPnL);
    const pnlClass = totalPnL >= 0 ? 'positive' : 'negative';
    
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div>
          <div style="font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; letter-spacing:0.6px;">Cash Balance</div>
          <div id="pt-balance" class="pt-balance">${formatMoney(state.balance)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; letter-spacing:0.6px;">Total P&L</div>
          <div id="pt-pnl" class="pt-pnl ${pnlClass}">${totalPnL >= 0 ? '+' : ''}${pnl}</div>
        </div>
      </div>
      <div style="margin-top:12px; border-top:1px solid rgba(255,255,255,0.03); padding-top:12px; display:flex; justify-content:space-between; font-size:12px;">
        <span style="color:var(--text-dim)">Account Equity</span>
        <span id="pt-equity-balance" style="font-weight:700">${formatMoney(state.getEquity())}</span>
      </div>
    `;
  }

  _renderLeverageMetrics() {
    try {
      const state = this._safeGetState();
      const marginUsed = safeFormatNumber(state.getTotalMarginUsed());
      const equity = safeFormatNumber(state.getEquity());
      
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Margin Account</div>
          <div style="font-size:13px; font-weight:800; color:var(--accent)">${this.options.maxLeverage}x</div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px;">
          <div>
            <div style="color:var(--text-dim); font-size:12px;">Margin Used</div>
            <div id="pt-marginused" style="font-weight:700;">${marginUsed}</div>
          </div>
          <div>
            <div style="color:var(--text-dim); font-size:12px;">Account Equity</div>
            <div id="pt-equity" style="font-weight:700;">${equity}</div>
          </div>
        </div>
        <div style="font-size:11px; color:var(--text-dim); margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.03);">
          Warning: Margin Call if equity &lt; ${Math.round((this.options.maintenanceMarginRatio||0.5)*100)}% of margin
        </div>
      `;
    } catch (e) {
      console.error('[UI] Leverage metrics render error:', e);
      return '<div style="color:var(--text-dim);">Margin data unavailable</div>';
    }
  }

  _renderOrderForm() {
    return `
      <form id="pt-order-form" style="display:flex; flex-direction:column; gap:12px;">
        <div style="display:grid; grid-template-columns: 3fr 2fr; gap:12px;">
          <div>
            <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Symbol</label>
            <input class="input" type="text" id="pt-symbol" placeholder="BTCUSDT" />
          </div>
          <div>
            <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Side</label>
            <select id="pt-side" class="input">
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Quantity</label>
            <input class="input" type="number" id="pt-quantity" value="1" min="0.001" step="0.001" />
          </div>
          <div>
            <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Type</label>
            <select id="pt-order-type" class="input">
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP_MARKET">Stop Market</option>
            </select>
          </div>
        </div>

        <div id="pt-price-field" style="display:none;">
          <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Price</label>
          <input class="input" type="number" id="pt-price" step="0.01" />
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Stop Loss</label>
            <input class="input" type="number" id="pt-stoploss" placeholder="Optional" step="0.01" />
          </div>
          <div>
            <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Take Profit</label>
            <input class="input" type="number" id="pt-takeprofit" placeholder="Optional" step="0.01" />
          </div>
        </div>

        <div>
          <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Trailing Stop</label>
          <input class="input" type="text" id="pt-trailing" placeholder="e.g. 2% or 100" />
        </div>

        ${this.options.leverageSimulation ? `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Trade Type</label>
              <select id="pt-trade-type" class="input">
                <option value="spot">Spot</option>
                <option value="margin">Margin</option>
              </select>
            </div>
            <div>
              <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Leverage</label>
              <input class="input" type="number" id="pt-leverage" value="1" min="1" max="${this.options.maxLeverage}" step="0.1" />
            </div>
          </div>
        ` : ''}

        <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Tags (comma separated)</label>
        <input class="input" type="text" id="pt-tags" placeholder="e.g. strategy1, test" />

        <label style="display:block; font-size:11px; color:var(--text-dim); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Note</label>
        <textarea class="input" id="pt-note" placeholder="Optional note"></textarea>

        <button type="submit" class="btn btn-primary">Place Order</button>
      </form>
    `;
  }

  _renderPositions() {
    const state = this._safeGetState();
    
    if (!state.positions || !state.positions.length) {
      return `
        <div class="card" style="text-align:center; padding:36px 20px; color:var(--text-dim);">
          <div style="font-size:42px; opacity:0.5;">${SVGS.positions()}</div>
          <div style="font-size:14px; font-weight:700; margin-top:8px;">No Open Positions</div>
          <div style="font-size:12px; margin-top:4px;">Place an order to start trading</div>
        </div>
      `;
    }

    return `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${state.positions.map(pos => {
          try {
            const currentPrice = state.getLastPrice(pos.symbol) || pos.entryPrice;
            const pnl = pos.side === 'buy' 
              ? (currentPrice - pos.entryPrice) * pos.quantity 
              : (pos.entryPrice - currentPrice) * pos.quantity;
            const pnlPercent = safeFormatNumber(((pnl / (pos.entryPrice * pos.quantity)) * 100));
            const pnlClass = pnl >= 0 ? 'positive' : 'negative';
            
            return `
              <div class="pos-item" data-posid="${escapeHtml(pos.id)}">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                  <div>
                    <div class="symbol">${escapeHtml(pos.symbol)}</div>
                    <div class="meta">${escapeHtml(pos.side.toUpperCase())} ${safeFormatNumber(pos.quantity, 3)} @ ${safeFormatNumber(pos.entryPrice)} ${pos.tradeType === 'margin' ? ` • ${pos.leverage}x` : ' • Spot'}</div>
                  </div>
                  <div style="text-align:right;">
                    <div class="${pnlClass}">${pnl >= 0 ? '+' : ''}${safeFormatNumber(pnl)}</div>
                    <div class="${pnlClass}" style="font-size:11px; margin-top:4px;">${pnl >= 0 ? '+' : ''}${pnlPercent}%</div>
                  </div>
                </div>

                <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; font-size:12px; margin-bottom:12px;">
                  <div><span style="color:var(--text-dim)">Current:</span> <span style="font-weight:700; margin-left:6px;">${safeFormatNumber(currentPrice)}</span></div>
                  <div><span style="color:var(--text-dim)">Entry:</span> <span style="font-weight:700; margin-left:6px;">${safeFormatNumber(pos.entryPrice)}</span></div>
                  ${pos.stopLoss ? `<div><span style="color:var(--danger)">SL:</span> <span style="font-weight:700; margin-left:6px;">${safeFormatNumber(pos.stopLoss)}</span></div>` : ''}
                  ${pos.takeProfit ? `<div><span style="color:var(--success)">TP:</span> <span style="font-weight:700; margin-left:6px;">${safeFormatNumber(pos.takeProfit)}</span></div>` : ''}
                </div>

                <button class="btn btn-ghost pt-close-pos-btn" data-posid="${escapeHtml(pos.id)}">Close Position</button>
              </div>
            `;
          } catch (e) {
            console.warn('[UI] Position render error:', e);
            return `<div class="card" style="padding:12px; color:var(--text-dim);">Error rendering position</div>`;
          }
        }).join('')}
      </div>
    `;
  }

  _renderHistory() {
    const state = this._safeGetState();
    
    if (!state.trades || !state.trades.length) {
      return `
        <div class="card" style="text-align:center; padding:36px 20px; color:var(--text-dim);">
          <div style="font-size:42px; opacity:0.5;">${SVGS.history()}</div>
          <div style="font-size:14px; font-weight:700; margin-top:8px;">No Trade History</div>
          <div style="font-size:12px; margin-top:4px;">Your completed trades will appear here</div>
        </div>
      `;
    }

    // FIXED: XSS protection with escapeHtml
    return `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${state.trades.slice().reverse().slice(0,50).map(trade => {
          try {
            const hasPnL = typeof trade.pnl !== 'undefined';
            const pnlClass = (trade.pnl ?? 0) >= 0 ? 'positive' : 'negative';
            const pnlValue = hasPnL ? safeFormatNumber(trade.pnl) : '';
            const formattedDate = new Date(trade.timestamp).toLocaleString();
            
            return `
              <div class="card" style="padding:12px; font-size:12px;" data-tradeid="${escapeHtml(trade.id)}">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <div>
                    <span style="font-weight:700;">${escapeHtml(trade.symbol)}</span>
                    <span style="color:${trade.side === 'buy' ? 'var(--success)' : 'var(--danger)'}; margin-left:8px; font-weight:600;">${escapeHtml(trade.side.toUpperCase())}</span>
                    ${trade.tradeType === 'margin' ? `<span style="color:var(--accent); margin-left:8px;">${trade.leverage}x</span>` : ''}
                  </div>
                  ${hasPnL ? `<div style="font-weight:700; color:${trade.pnl >= 0 ? 'var(--success)' : 'var(--danger)'};">${trade.pnl >= 0 ? '+' : ''}${pnlValue}</div>` : ''}
                </div>
                <div style="color:var(--text-dim)">${safeFormatNumber(trade.quantity, 3)} @ ${safeFormatNumber(trade.price)} • ${escapeHtml(formattedDate)}</div>
                <div style="margin-top:8px;">
                  <span style="color:var(--text-dim);">Tags:</span> <span>${escapeHtml((trade.tags || []).join(', '))}</span>
                  <span style="color:var(--text-dim); margin-left:12px;">Note:</span> <span>${escapeHtml(trade.note || '')}</span>
                  <button class="btn btn-ghost pt-annotate-btn" data-tradeid="${escapeHtml(trade.id)}" style="margin-left:12px; padding:4px 8px; font-size:11px;">Annotate</button>
                </div>
                <div class="pt-annotate-form" style="display:none; margin-top:8px;">
                  <input class="input pt-annotate-tags" type="text" placeholder="Tags (comma separated)" />
                  <textarea class="input pt-annotate-note" placeholder="Note" style="margin-top:6px;"></textarea>
                  <div style="margin-top:8px; display:flex; gap:8px;">
                    <button class="btn btn-primary pt-annotate-save" data-tradeid="${escapeHtml(trade.id)}" style="padding:6px 12px; font-size:11px;">Save</button>
                    <button class="btn btn-ghost pt-annotate-cancel" style="padding:6px 12px; font-size:11px;">Cancel</button>
                    <span class="pt-annotate-status" style="margin-left:8px; font-size:11px; align-self:center;"></span>
                  </div>
                </div>
              </div>
            `;
          } catch (e) {
            console.warn('[UI] Trade render error:', e);
            return `<div class="card" style="padding:12px; color:var(--text-dim);">Error rendering trade</div>`;
          }
        }).join('')}
      </div>
    `;
  }

  _renderPerformance() {
    try {
      const state = this._safeGetState();
      const metrics = state.getPerformanceMetrics ? state.getPerformanceMetrics() : {};
      
      return `
        <div>
          <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-bottom:16px;">
            <div class="card" style="text-align:center;">
              <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; font-weight:700; margin-bottom:6px;">Total Trades</div>
              <div style="font-size:28px; font-weight:800; color:var(--accent)">${metrics.totalTrades ?? 0}</div>
            </div>
            <div class="card" style="text-align:center;">
              <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; font-weight:700; margin-bottom:6px;">Win Rate</div>
              <div style="font-size:28px; font-weight:800; color:var(--success)">${metrics.winRate ?? '0%'}</div>
            </div>
            <div class="card" style="text-align:center;">
              <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; font-weight:700; margin-bottom:6px;">Total P&L</div>
              <div style="font-size:28px; font-weight:800; color:${parseFloat(metrics.totalPnL||0) >= 0 ? 'var(--success)': 'var(--danger)'}">${parseFloat(metrics.totalPnL||0) >= 0 ? '+' : ''}${metrics.totalPnL ?? '0.00'}</div>
            </div>
            <div class="card" style="text-align:center;">
              <div style="font-size:11px; color:var(--text-dim); text-transform:uppercase; font-weight:700; margin-bottom:6px;">Returns</div>
              <div style="font-size:28px; font-weight:800; color:${parseFloat(metrics.returns||0) >= 0 ? 'var(--success)' : 'var(--danger)'}">${parseFloat(metrics.returns||0) >= 0 ? '+' : ''}${metrics.returns ?? '0%'}</div>
            </div>
          </div>

          <div class="card">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-dim); margin-bottom:12px;">Trade Breakdown</div>
            <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
              <div>
                <div style="font-size:11px; color:var(--text-dim); margin-bottom:4px;">Winning Trades</div>
                <div style="font-size:20px; font-weight:700; color:var(--success);">${metrics.winningTrades ?? 0}</div>
                <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">Avg: ${metrics.avgWin ?? '0.00'}</div>
              </div>
              <div>
                <div style="font-size:11px; color:var(--text-dim); margin-bottom:4px;">Losing Trades</div>
                <div style="font-size:20px; font-weight:700; color:var(--danger);">${metrics.losingTrades ?? 0}</div>
                <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">Avg: ${metrics.avgLoss ?? '0.00'}</div>
              </div>
            </div>
            <div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.03);">
              <div style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">Profit Factor</div>
              <div style="font-size:18px; font-weight:700;">${metrics.profitFactor ?? '0.00'}</div>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      console.error('[UI] Performance render error:', e);
      return this._renderPerformanceFallback(e);
    }
  }

  /**
   * FIXED: Fallback renderers for error boundaries
   */
  _renderOrderFormFallback(error, context) {
    return `
      <div class="card" style="text-align:center; padding:24px; background:rgba(220,38,38,0.05); border:1px solid rgba(220,38,38,0.2);">
        <div style="color:var(--danger); font-size:36px; margin-bottom:12px;">${SVGS.error()}</div>
        <div style="font-weight:700; margin-bottom:8px;">Order Form Unavailable</div>
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
          ${escapeHtml(error?.message || 'Unknown error')}
        </div>
        <button class="btn btn-primary" onclick="window.location.reload()">
          ${SVGS.refresh()} Reload Page
        </button>
      </div>
    `;
  }

  _renderPositionsFallback(error, context) {
    return `
      <div class="card" style="text-align:center; padding:24px;">
        <div style="color:var(--text-dim); font-size:36px; margin-bottom:12px;">${SVGS.error()}</div>
        <div style="font-weight:700; margin-bottom:8px;">Failed to Load Positions</div>
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
          ${escapeHtml(error?.message || 'Unknown error')}
        </div>
        <button class="btn btn-ghost" onclick="document.querySelector('[data-tab=positions]').click()">
          ${SVGS.refresh()} Retry
        </button>
      </div>
    `;
  }

  _renderHistoryFallback(error, context) {
    return `
      <div class="card" style="text-align:center; padding:24px;">
        <div style="color:var(--text-dim); font-size:36px; margin-bottom:12px;">${SVGS.error()}</div>
        <div style="font-weight:700; margin-bottom:8px;">Failed to Load Trade History</div>
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
          ${escapeHtml(error?.message || 'Unknown error')}
        </div>
        <button class="btn btn-ghost" onclick="document.querySelector('[data-tab=history]').click()">
          ${SVGS.refresh()} Retry
        </button>
      </div>
    `;
  }

  _renderPerformanceFallback(error, context) {
    return `
      <div class="card" style="text-align:center; padding:24px;">
        <div style="color:var(--text-dim); font-size:36px; margin-bottom:12px;">${SVGS.error()}</div>
        <div style="font-weight:700; margin-bottom:8px;">Failed to Load Performance Stats</div>
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:16px;">
          ${escapeHtml(error?.message || 'Unknown error')}
        </div>
        <div style="margin-top:12px; padding:12px; background:rgba(255,255,255,0.02); border-radius:8px; font-size:11px; text-align:left;">
          <div style="font-family:monospace; color:var(--danger);">${escapeHtml(String(error))}</div>
        </div>
        <button class="btn btn-ghost" style="margin-top:12px;" onclick="document.querySelector('[data-tab=performance]').click()">
          ${SVGS.refresh()} Retry
        </button>
      </div>
    `;
  }

  _renderBalanceFallback(error, context) {
    return `
      <div style="text-align:center; padding:12px; color:var(--text-dim);">
        <div style="font-size:11px; margin-bottom:6px;">Balance data unavailable</div>
        <div style="font-size:20px; font-weight:700;">$0.00</div>
        <div style="font-size:10px; margin-top:6px; color:var(--danger);">${escapeHtml(error?.message || 'Error')}</div>
      </div>
    `;
  }

  _renderCriticalError(error) {
    return `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; padding:40px; text-align:center; background:var(--bg);">
        <div style="color:var(--danger); font-size:64px; margin-bottom:24px;">${SVGS.error()}</div>
        <h2 style="font-size:24px; font-weight:800; margin-bottom:12px; color:var(--text);">Critical Error</h2>
        <p style="font-size:14px; color:var(--text-dim); margin-bottom:24px; max-width:400px;">
          Paper Trader failed to initialize. Please reload the page or contact support if the issue persists.
        </p>
        <div style="margin-bottom:24px; padding:16px; background:rgba(220,38,38,0.05); border:1px solid rgba(220,38,38,0.2); border-radius:12px; max-width:500px;">
          <div style="font-size:11px; font-weight:700; margin-bottom:8px; color:var(--text-dim);">Error Details:</div>
          <div style="font-family:monospace; font-size:12px; color:var(--danger); word-break:break-all;">
            ${escapeHtml(error?.message || String(error))}
          </div>
        </div>
        <button class="btn btn-primary" onclick="window.location.reload()" style="padding:14px 28px;">
          ${SVGS.refresh()} Reload Page
        </button>
      </div>
    `;
  }

  _bindHandlers() {
    try {
      // delegate some handlers
      this.panel.querySelector('#pt-close')?.addEventListener('click', () => this.hide());

      // tabs
      this.panel.querySelectorAll('.pt-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          const target = e.currentTarget;
          const tname = target.dataset.tab;

          this.panel.querySelectorAll('.pt-tab').forEach(t => t.classList.remove('active'));
          target.classList.add('active');

          this.panel.querySelectorAll('.pt-tab-content').forEach(c => {
            c.classList.remove('active');
            c.style.display = 'none';
          });

          const ct = this.panel.querySelector(`#pt-tab-${tname}`);
          if (ct) {
            ct.style.display = 'block';
            setTimeout(() => ct.classList.add('active'), 10);

            // FIXED: Safe tab content rendering with error boundaries
            try {
              if (tname === 'positions') {
                ct.innerHTML = this.errorBoundaries.positions.safeRender(
                  () => this._renderPositions(),
                  'positions tab'
                );
              }
              if (tname === 'history') {
                ct.innerHTML = this.errorBoundaries.history.safeRender(
                  () => this._renderHistory(),
                  'history tab'
                );
              }
              if (tname === 'performance') {
                ct.innerHTML = this.errorBoundaries.performance.safeRender(
                  () => this._renderPerformance(),
                  'performance tab'
                );
              }

              // Re-bind handlers after tab redraw
              if (tname === 'history') this._bindHistoryAnnotationHandlers();
              if (tname === 'positions') this._bindPositionCloseHandlers();
            } catch (e) {
              console.error(`[UI] Tab ${tname} render error:`, e);
              ct.innerHTML = `
                <div class="card" style="padding:24px; text-align:center;">
                  <div style="color:var(--danger); margin-bottom:12px;">${SVGS.error()}</div>
                  <div style="font-weight:700; margin-bottom:8px;">Failed to load ${tname}</div>
                  <button class="btn btn-ghost" onclick="this.closest('.pt-tab-content').previousElementSibling.querySelector('[data-tab=${tname}]').click()">
                    ${SVGS.refresh()} Retry
                  </button>
                </div>
              `;
            }
          }
        });
      });

      // order type toggle price field
      const orderTypeSelect = this.panel.querySelector('#pt-order-type');
      const priceField = this.panel.querySelector('#pt-price-field');
      if (orderTypeSelect && priceField) {
        orderTypeSelect.addEventListener('change', (e) => {
          priceField.style.display = e.target.value !== 'MARKET' ? 'block' : 'none';
        });
      }

      // order submit
      const form = this.panel.querySelector('#pt-order-form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          
          try {
            const symbol = this.panel.querySelector('#pt-symbol')?.value?.trim();
            const side = this.panel.querySelector('#pt-side')?.value;
            const quantity = parseFloat(this.panel.querySelector('#pt-quantity')?.value || 0);
            const type = this.panel.querySelector('#pt-order-type')?.value;
            const price = parseFloat(this.panel.querySelector('#pt-price')?.value || 0);
            const stopLoss = parseFloat(this.panel.querySelector('#pt-stoploss')?.value || 0) || null;
            const takeProfit = parseFloat(this.panel.querySelector('#pt-takeprofit')?.value || 0) || null;
            const trailingInput = this.panel.querySelector('#pt-trailing')?.value?.trim();
            const tradeType = this.panel.querySelector('#pt-trade-type')?.value || 'spot';
            const leverage = parseFloat(this.panel.querySelector('#pt-leverage')?.value || 1);
            const tags = this.panel.querySelector('#pt-tags')?.value?.split(',').map(t => t.trim()).filter(Boolean) || [];
            const note = this.panel.querySelector('#pt-note')?.value || '';

            if (!symbol) {
              this.deps.notifications?.error('Symbol is required');
              return;
            }

            if (!quantity || quantity <= 0) {
              this.deps.notifications?.error('Quantity must be positive');
              return;
            }

            if (type !== 'MARKET' && (!price || price <= 0)) {
              this.deps.notifications?.error('Price required for limit/stop orders');
              return;
            }

            if (leverage < 1) {
              this.deps.notifications?.error('Leverage must be at least 1');
              return;
            }

            const order = {
              symbol,
              side,
              quantity,
              type,
              price: type !== 'MARKET' ? price : null,
              stopLoss,
              takeProfit,
              trailingStop: this._parseTrailingStop(trailingInput),
              tradeType,
              leverage,
              tags,
              note
            };

            this._emit('placeOrder', order);
          } catch (error) {
            console.error('[UI] Order submit error:', error);
            this.deps.notifications?.error(`Failed to submit order: ${error.message}`);
          }
        });
      }

      // export / reset
      this.panel.querySelector('#pt-export')?.addEventListener('click', () => {
        try {
          this._emit('exportTrades');
        } catch (e) {
          console.error('[UI] Export error:', e);
          this.deps.notifications?.error('Failed to export trades');
        }
      });
      
      this.panel.querySelector('#pt-reset')?.addEventListener('click', () => {
        try {
          if (confirm('Reset account? This will clear all trades and positions.')) {
            this._emit('resetAccount');
          }
        } catch (e) {
          console.error('[UI] Reset error:', e);
          this.deps.notifications?.error('Failed to reset account');
        }
      });

      // Initial bind for annotation and close position handlers
      this._bindPositionCloseHandlers();
      this._bindHistoryAnnotationHandlers();
    } catch (error) {
      console.error('[UI] Handler binding error:', error);
      this.deps.notifications?.error('Some UI features may not work correctly');
    }
  }

  _bindPositionCloseHandlers() {
    try {
      const btns = this.panel.querySelectorAll('.pt-close-pos-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const posid = btn.getAttribute('data-posid');
          if (!posid) return;
          
          try {
            btn.disabled = true;
            btn.textContent = 'Closing...';
            await this.deps.orderManager.closePosition(posid);
            this.refreshIfOpen();
          } catch (err) {
            console.error('[UI] Close position error:', err);
            this.deps.notifications?.error(`Close failed: ${err.message || err}`);
            btn.disabled = false;
            btn.textContent = 'Close Position';
          }
        });
      });
    } catch (error) {
      console.error('[UI] Position close handler binding error:', error);
    }
  }

  _bindHistoryAnnotationHandlers() {
    try {
      // Annotate buttons
      this.panel.querySelectorAll('.pt-annotate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          try {
            const tradeid = btn.getAttribute('data-tradeid');
            const card = btn.closest('.card');
            if (!card) return;
            const form = card.querySelector('.pt-annotate-form');
            if (!form) return;
            
            form.style.display = 'block';
            
            // Pre-fill existing values
            const tagsSpan = btn.parentElement.querySelector('span:nth-child(2)');
            const noteSpan = btn.parentElement.querySelector('span:nth-child(4)');
            
            form.querySelector('.pt-annotate-tags').value = tagsSpan?.textContent || '';
            form.querySelector('.pt-annotate-note').value = noteSpan?.textContent || '';
          } catch (error) {
            console.error('[UI] Annotation form show error:', error);
          }
        });
      });

      // Save buttons
      this.panel.querySelectorAll('.pt-annotate-save').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const card = btn.closest('.card');
          const tradeid = btn.getAttribute('data-tradeid');
          const status = card.querySelector('.pt-annotate-status');
          
          try {
            const tags = card.querySelector('.pt-annotate-tags').value
              .split(',').map(t => t.trim()).filter(Boolean);
            const note = card.querySelector('.pt-annotate-note').value;
            
            this.deps.executor.annotateTrade(tradeid, tags, note);
            
            status.textContent = 'Saved!';
            status.style.color = '#16a34a';
            
            setTimeout(() => { 
              status.textContent = '';
              card.querySelector('.pt-annotate-form').style.display = 'none';
              this.refreshIfOpen();
            }, 1500);
          } catch (err) {
            console.error('[UI] Annotation save error:', err);
            status.textContent = 'Failed to save';
            status.style.color = '#dc2626';
          }
        });
      });
      
      // Cancel buttons
      this.panel.querySelectorAll('.pt-annotate-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
          try {
            const card = btn.closest('.card');
            card.querySelector('.pt-annotate-form').style.display = 'none';
          } catch (error) {
            console.error('[UI] Annotation cancel error:', error);
          }
        });
      });
    } catch (error) {
      console.error('[UI] History annotation handler binding error:', error);
    }
  }

  _bindNotificationToggles() {
    try {
      const desktopToggle = this.panel.querySelector('#pt-enable-desktop-alerts');
      const soundToggle = this.panel.querySelector('#pt-enable-trade-sound');

      if (desktopToggle) {
        desktopToggle.addEventListener('change', (e) => {
          try {
            this.deps.notifications?.setEnableDesktopAlerts(e.target.checked);
          } catch (error) {
            console.error('[UI] Desktop alerts toggle error:', error);
          }
        });
      }
      
      if (soundToggle) {
        soundToggle.addEventListener('change', (e) => {
          try {
            this.deps.notifications?.setEnableTradeSound(e.target.checked);
          } catch (error) {
            console.error('[UI] Sound toggle error:', error);
          }
        });
      }
    } catch (error) {
      console.error('[UI] Notification toggle binding error:', error);
    }
  }

  _insertToggleButton() {
    try {
      const existing = document.querySelector('.pt-toggle-btn.header-placement');
      if (existing) return;
      
      const btn = document.createElement('button');
      btn.className = 'pt-toggle-btn header-placement';
      btn.textContent = 'PT';
      btn.title = 'Paper Trading';
      btn.onclick = () => this.toggle();
      document.body.appendChild(btn);
    } catch (error) {
      console.error('[UI] Toggle button insertion error:', error);
    }
  }

  _parseTrailingStop(value) {
    try {
      if (!value) return null;
      const m = ('' + value).trim().match(/(\d+(\.\d+)?)(%)?$/);
      if (!m) return null;
      const v = parseFloat(m[1]);
      const isPercent = !!m[3];
      return { type: isPercent ? 'percent' : 'absolute', value: v };
    } catch (error) {
      console.warn('[UI] Trailing stop parse error:', error);
      return null;
    }
  }

  updateBalanceDisplay(balance) {
    try {
      const balanceEl = this.panel?.querySelector('#pt-balance');
      if (balanceEl) {
        balanceEl.textContent = formatMoney(balance);
      }
    } catch (error) {
      console.warn('[UI] Balance display update error:', error);
    }
  }

  /**
   * FIXED: Comprehensive error handling for refresh operation
   */
  refreshIfOpen() {
    if (!this.isOpen || !this.panel) return;

    try {
      this._refreshInternal();
      
      // Reset error counter on successful refresh
      if (this._consecutiveRefreshErrors > 0) {
        console.log(`[UI] Refresh recovered after ${this._consecutiveRefreshErrors} error(s)`);
        this._consecutiveRefreshErrors = 0;
        this._lastRefreshError = null;
      }
    } catch (error) {
      this._consecutiveRefreshErrors++;
      this._lastRefreshError = error;
      
      console.error(`[UI] Refresh error (attempt ${this._consecutiveRefreshErrors}):`, error);
      
      // Show error to user after 2nd consecutive failure
      if (this._consecutiveRefreshErrors >= 2 && this.deps?.notifications) {
        this.deps.notifications.warning(
          'UI refresh is experiencing issues. Some data may be outdated.'
        );
      }
      
      // If too many consecutive errors, show recovery UI
      if (this._consecutiveRefreshErrors >= 5) {
        this._showRefreshErrorRecovery();
      }
    }
  }

  /**
   * FIXED: Internal refresh logic with proper equity usage
   */
  _refreshInternal() {
    const state = this._safeGetState();

    // Update balance card with error boundary
    const balanceCard = this.panel.querySelector('#pt-balance-card');
    if (balanceCard) {
      try {
        balanceCard.innerHTML = this.errorBoundaries.balance.safeRender(
          () => this._renderBalanceCard(),
          'balance refresh'
        );
      } catch (e) {
        console.warn('[UI] Balance card refresh error:', e);
      }
    }

    // Update individual balance elements (fallback)
    try {
      const balanceEl = this.panel.querySelector('#pt-balance');
      if (balanceEl) balanceEl.textContent = formatMoney(state.balance);
    } catch (e) {
      console.warn('[UI] Balance element update error:', e);
    }

    // FIXED: Calculate and update P&L using getEquity
    try {
      const totalPnL = state.getEquity() - state.initialBalance;

      const pnlEl = this.panel.querySelector('#pt-pnl');
      if (pnlEl) {
        pnlEl.textContent = `${totalPnL >= 0 ? '+' : ''}${safeFormatNumber(totalPnL)}`;
        pnlEl.classList.remove('positive','negative');
        pnlEl.classList.add(totalPnL >= 0 ? 'positive' : 'negative');
      }

      const equityEl = this.panel.querySelector('#pt-equity-balance');
      if (equityEl) {
        equityEl.textContent = formatMoney(state.getEquity());
      }
    } catch (e) {
      console.warn('[UI] P&L update error:', e);
    }

    // Update leverage metrics if enabled
    if (this.options.leverageSimulation) {
      try {
        const marginEl = this.panel.querySelector('#pt-marginused');
        const levEqEl = this.panel.querySelector('#pt-equity');
        
        if (marginEl) marginEl.textContent = safeFormatNumber(state.getTotalMarginUsed());
        if (levEqEl) levEqEl.textContent = safeFormatNumber(state.getEquity());
      } catch (e) {
        console.warn('[UI] Leverage metrics update error:', e);
      }
    }

    // Update active tab content
    try {
      const activeTab = this.panel.querySelector('.pt-tab.active')?.dataset?.tab || 'order';
      
      if (activeTab === 'positions') {
        const el = this.panel.querySelector('#pt-tab-positions');
        if (el) {
          el.innerHTML = this.errorBoundaries.positions.safeRender(
            () => this._renderPositions(),
            'positions refresh'
          );
          this._bindPositionCloseHandlers();
        }
        
        // Update position count badge
        const posCount = (state.positions || []).length;
        const posCountEl = this.panel.querySelector('#pos-count');
        if (posCountEl) {
          posCountEl.textContent = posCount;
          posCountEl.style.display = posCount > 0 ? 'inline-block' : 'none';
        }
      } else if (activeTab === 'history') {
        const el = this.panel.querySelector('#pt-tab-history');
        if (el) {
          el.innerHTML = this.errorBoundaries.history.safeRender(
            () => this._renderHistory(),
            'history refresh'
          );
          this._bindHistoryAnnotationHandlers();
        }
        
        // Update trade count badge
        const tradeCountEl = this.panel.querySelector('#trade-count');
        const tCount = (state.trades || []).length;
        if (tradeCountEl) {
          tradeCountEl.textContent = tCount;
          tradeCountEl.style.display = tCount > 0 ? 'inline-block' : 'none';
        }
      } else if (activeTab === 'performance') {
        const el = this.panel.querySelector('#pt-tab-performance');
        if (el) {
          el.innerHTML = this.errorBoundaries.performance.safeRender(
            () => this._renderPerformance(),
            'performance refresh'
          );
        }
      }
    } catch (e) {
      console.warn('[UI] Tab content refresh error:', e);
    }
  }

  /**
   * FIXED: Show recovery UI when refresh fails repeatedly
   */
  _showRefreshErrorRecovery() {
    try {
      const body = this.panel.querySelector('.pt-body');
      if (!body) return;

      // Create recovery overlay
      let recoveryOverlay = this.panel.querySelector('.pt-recovery-overlay');
      if (!recoveryOverlay) {
        recoveryOverlay = document.createElement('div');
        recoveryOverlay.className = 'pt-recovery-overlay';
        recoveryOverlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(11,14,17,0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 40px;
        `;
        
        recoveryOverlay.innerHTML = `
          <div style="text-align:center; max-width:400px;">
            <div style="color:var(--danger); font-size:48px; margin-bottom:16px;">${SVGS.error()}</div>
            <h3 style="font-size:18px; font-weight:800; margin-bottom:12px;">UI Refresh Failed</h3>
            <p style="font-size:13px; color:var(--text-dim); margin-bottom:20px;">
              The interface is having trouble updating. This may be due to corrupted data or a system issue.
            </p>
            <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-primary" onclick="window.location.reload()">
                ${SVGS.refresh()} Reload Page
              </button>
              <button class="btn btn-ghost pt-recovery-reset">
                Reset Error State
              </button>
            </div>
            <div style="margin-top:16px; font-size:11px; color:var(--text-dim);">
              Last error: ${escapeHtml(this._lastRefreshError?.message || 'Unknown')}
            </div>
          </div>
        `;
        
        this.panel.appendChild(recoveryOverlay);
        
        // Bind reset button
        recoveryOverlay.querySelector('.pt-recovery-reset')?.addEventListener('click', () => {
          this._resetErrorBoundaries();
          recoveryOverlay.remove();
          this._consecutiveRefreshErrors = 0;
          this.refreshIfOpen();
        });
      }
    } catch (error) {
      console.error('[UI] Recovery UI error:', error);
      // Last resort: show alert
      alert('Paper Trader UI has encountered critical errors. Please reload the page.');
    }
  }

  /**
   * FIXED: Reset all error boundaries
   */
  _resetErrorBoundaries() {
    try {
      Object.values(this.errorBoundaries).forEach(boundary => {
        boundary.reset();
      });
      console.log('[UI] Error boundaries reset');
    } catch (error) {
      console.error('[UI] Error boundary reset failed:', error);
    }
  }

  /**
   * Get diagnostics for all error boundaries
   */
  getErrorDiagnostics() {
    const diagnostics = {};
    Object.entries(this.errorBoundaries).forEach(([name, boundary]) => {
      diagnostics[name] = boundary.getDiagnostics();
    });
    return {
      boundaries: diagnostics,
      consecutiveRefreshErrors: this._consecutiveRefreshErrors,
      lastRefreshError: this._lastRefreshError?.message
    };
  }

  show() {
    try {
      if (!this.panel || !this.overlay) return;
      this.overlay.style.display = 'block';
      setTimeout(() => { this.panel.style.right = '0'; }, 10);
      this.isOpen = true;
      this.refreshIfOpen();
    } catch (error) {
      console.error('[UI] Show error:', error);
    }
  }

  hide() {
    try {
      if (!this.panel || !this.overlay) return;
      this.panel.style.right = '-520px';
      setTimeout(() => { this.overlay.style.display = 'none'; }, 340);
      this.isOpen = false;
    } catch (error) {
      console.error('[UI] Hide error:', error);
    }
  }

  toggle() { 
    try {
      this.isOpen ? this.hide() : this.show(); 
    } catch (error) {
      console.error('[UI] Toggle error:', error);
    }
  }

  getPanel() { return this.panel; }

  destroy() {
    try {
      // Reset error boundaries
      this._resetErrorBoundaries();
      
      // Remove DOM elements
      this.panel?.remove();
      this.overlay?.remove();
      
      const toggle = document.querySelector('.pt-toggle-btn.header-placement');
      if (toggle) toggle.remove();
      
      // Clear event listeners
      this.events.clear();
      
      console.log('[UI] Destroyed successfully');
    } catch (e) {
      console.warn('[UI] Cleanup error:', e);
    }
  }
}