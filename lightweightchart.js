// lightweightchart.js - Crypto Chart Grid Main Controller (Complete with Alert System)
import { ChartRenderer } from './chart-renderer.js';
import { ChartDataManager } from './chart-data-manager.js';
import { setupTickerSelect } from './ticker-select.js';
import { enableDragDrop } from './drag-drop.js';
import { setupAlertUI } from './alert-ui.js';
import AlertSystem from './alert-system.js';

// ==================== CONSTANTS ====================

const CDN_SOURCES = [
  'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
  'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lightweight-charts/4.1.3/lightweight-charts.standalone.production.min.js'
];

const chartConfigs = [
  { id: 'chart-btc', symbol: 'BTCUSDT', cardId: 'btc-card' },
  { id: 'chart-eth', symbol: 'ETHUSDT', cardId: 'eth-card' },
  { id: 'chart-sol', symbol: 'SOLUSDT', cardId: 'sol-card' },
  { id: 'chart-bnb', symbol: 'BNBUSDT', cardId: 'bnb-card' }
];

const SCRIPT_LOAD_TIMEOUT = 10000;
const CHART_RESIZE_DEBOUNCE = 200;

// ==================== STATE MANAGEMENT ====================

const appState = {
  charts: new Map(),
  isShuttingDown: false,
  isInitialized: false,
  abortController: null,
  statusLabel: null,
  statusDot: null
};

// ==================== STORAGE UTILITIES ====================

const storage = {
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch (error) {
      console.warn(`[Storage] Failed to get ${key}:`, error);
      return defaultValue;
    }
  },
  
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`[Storage] Failed to set ${key}:`, error);
      return false;
    }
  },
  
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn(`[Storage] Failed to remove ${key}:`, error);
      return false;
    }
  }
};

// ==================== CLEANUP MANAGEMENT ====================

class AppCleanupManager {
  constructor() {
    this.cleanupTasks = new Set();
    this.isDestroying = false;
    this.hasSetupCleanup = false;
  }

  setupGlobalCleanup() {
    if (this.hasSetupCleanup) return;
    this.hasSetupCleanup = true;

    const cleanup = async () => {
      if (this.isDestroying) return;
      await this.destroy();
    };

    // Single beforeunload handler to prevent duplicate cleanup
    window.addEventListener('beforeunload', cleanup, { once: true });
    
    // Monitor visibility changes (informational only, no cleanup)
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        console.log('[AppCleanupManager] Page hidden, maintaining connections');
      }
    };
    
    document.addEventListener('visibilitychange', visibilityHandler);
    
    // Store reference for potential manual cleanup
    this._visibilityHandler = visibilityHandler;
  }

  addCleanupTask(task) {
    if (typeof task === 'function') {
      this.cleanupTasks.add(task);
    }
  }

  removeCleanupTask(task) {
    this.cleanupTasks.delete(task);
  }

  async destroy() {
    if (this.isDestroying) return;
    this.isDestroying = true;

    console.log('[AppCleanupManager] Performing global cleanup...');

    const tasks = Array.from(this.cleanupTasks);
    const results = await Promise.allSettled(
      tasks.map(task => {
        try {
          return Promise.resolve(task());
        } catch (error) {
          console.warn('[AppCleanupManager] Cleanup task failed:', error);
          return Promise.resolve();
        }
      })
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[AppCleanupManager] ${failed.length} cleanup tasks failed`);
    }

    // Remove visibility handler
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }

    this.cleanupTasks.clear();
    console.log('[AppCleanupManager] Global cleanup completed');
  }
}

const cleanupManager = new AppCleanupManager();

// ==================== GLOBAL ERROR HANDLER ====================

window.handleGlobalError = function(isError, err, ctx) {
  window.isGlobalError = !!isError;
  
  const banner = document.getElementById('global-error-banner');
  if (banner) banner.style.display = isError ? '' : 'none';

  const dot = document.querySelector('.dot-global');
  const label = document.getElementById('label-global');
  if (dot && label) {
    dot.style.background = isError ? 'var(--danger)' : 'var(--ok)';
    label.textContent = isError ? 'DISCONNECTED' : 'CONNECTED';
  }

  // Batch DOM updates for better performance
  requestAnimationFrame(() => {
    const controls = document.querySelectorAll(
      '.chart-card .right-controls button, .timeframe-select, .ticker-input'
    );
    controls.forEach(el => {
      el.disabled = isError;
      el.classList.toggle('disabled', isError);
    });
    
    const addBtn = document.getElementById('add-chart');
    if (addBtn) addBtn.disabled = isError;
  });

  if (isError && err) {
    console.error('[GlobalError]', err, ctx || '');
  }
};

// ==================== FULLSCREEN FUNCTIONALITY ====================

function enableFullscreen(card, chartInstance) {
  const header = card.querySelector('.chart-header');
  if (!header) return null;

  let btn = header.querySelector('.fullscreen-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'fullscreen-btn';
    btn.title = 'Fullscreen';
    btn.textContent = '⛶';
    header.appendChild(btn);
  }

  const abortController = new AbortController();
  const signal = abortController.signal;

  const fullscreenHandler = () => {
    if (appState.isShuttingDown || window.isGlobalError) return;

    try {
      if (!document.fullscreenElement) {
        card.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } catch (error) {
      console.warn('[Fullscreen] Error toggling fullscreen:', error);
    }
  };

  const fullscreenChangeHandler = () => {
    if (appState.isShuttingDown) return;

    try {
      btn.textContent = document.fullscreenElement === card ? '🗗' : '⛶';

      // Debounced chart resize
      setTimeout(() => {
        if (!appState.isShuttingDown && chartInstance?.chart) {
          const container = card.querySelector('.tvchart');
          if (container) {
            chartInstance.chart.resize(container.clientWidth, container.clientHeight);
          }
        }
      }, CHART_RESIZE_DEBOUNCE);
    } catch (error) {
      console.warn('[Fullscreen] Error in fullscreen change handler:', error);
    }
  };

  btn.addEventListener('click', fullscreenHandler, { signal });
  document.addEventListener('fullscreenchange', fullscreenChangeHandler, { signal });

  const cleanup = () => {
    abortController.abort();
  };

  cleanupManager.addCleanupTask(cleanup);
  return cleanup;
}

// ==================== GRID LAYOUT ====================

let lastGridState = null;

export function adjustGridLayout() {
  if (appState.isShuttingDown) return;

  try {
    const grid = document.getElementById('chart-grid');
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.chart-card'));
    const chartCount = cards.length;

    // Cache check - avoid unnecessary recalculations
    const currentState = `${chartCount}-${cards.map(c => c.id).join(',')}`;
    if (lastGridState === currentState) return;
    lastGridState = currentState;

    // Batch DOM updates for better performance
    requestAnimationFrame(() => {
      // Reset all styles
      grid.style.gridTemplateColumns = '';
      grid.style.gridAutoRows = '';
      cards.forEach(card => {
        card.style.gridColumn = '';
        card.style.gridRow = '';
      });

      // Apply layout based on chart count
      switch (chartCount) {
        case 1:
          grid.style.gridTemplateColumns = '1fr';
          break;
        case 2:
          grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
          break;
        case 3:
          grid.style.gridTemplateColumns = '1fr 1fr';
          grid.style.gridAutoRows = '1fr';
          if (cards[0]) { cards[0].style.gridColumn = '1'; cards[0].style.gridRow = '1'; }
          if (cards[1]) { cards[1].style.gridColumn = '1'; cards[1].style.gridRow = '2'; }
          if (cards[2]) { cards[2].style.gridColumn = '2'; cards[2].style.gridRow = '1 / span 2'; }
          break;
        case 4:
          grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
          break;
        case 5:
          grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
          if (cards[4]) cards[4].style.gridColumn = '1 / -1';
          break;
        case 6:
          grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
          break;
        default:
          if (chartCount >= 7) {
            grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
          }
      }
    });
  } catch (error) {
    console.warn('[GridLayout] Error adjusting layout:', error);
  }
}

// ==================== SCRIPT LOADING ====================

function loadScript(src, timeout = SCRIPT_LOAD_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      reject(new Error(`Script load timeout: ${src}`));
    }, timeout);

    script.src = src;
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to load script: ${src}`));
    };
    
    document.head.appendChild(script);
  });
}

// ==================== CHART CLEANUP ====================

function resolveCardIdFromKey(key, symbol) {
  if (!key) return null;
  if (key.endsWith('-card')) return key;
  if (key.startsWith('chart-')) return key.replace(/^chart-/, '') + '-card';
  if (symbol) return `${symbol.toLowerCase()}-card`;
  return null;
}

function cleanupChart(chartKey) {
  if (!appState.charts.has(chartKey)) return;

  try {
    const { chartInstance, dataManager, symbol, cleanup } = appState.charts.get(chartKey);

    console.log(`[ChartCleanup] Cleaning up chart: ${symbol}`);

    const resolvedCardId = resolveCardIdFromKey(chartKey, symbol);
    const card = (resolvedCardId && document.getElementById(resolvedCardId)) ||
                 document.querySelector(`[data-symbol="${symbol.toLowerCase()}"]`);
    const tfSelect = card?.querySelector('.timeframe-select');
    const currentInterval = tfSelect?.value || '5m';

    // Unsubscribe from data stream
    if (dataManager) {
      dataManager.unsubscribe(symbol, currentInterval).catch(error => {
        console.warn(`[ChartCleanup] Error unsubscribing ${symbol}:`, error);
      });
    }

    // Destroy chart instance
    if (chartInstance && typeof chartInstance.destroy === 'function') {
      chartInstance.destroy();
    }

    // Run chart-specific cleanup
    if (cleanup && typeof cleanup === 'function') {
      try {
        cleanup();
        cleanupManager.removeCleanupTask(cleanup);
      } catch (err) {
        console.warn('[ChartCleanup] Error running chart cleanup handler:', err);
      }
    }

    appState.charts.delete(chartKey);
    console.log(`[ChartCleanup] Successfully cleaned up chart: ${symbol}`);
  } catch (error) {
    console.error(`[ChartCleanup] Error cleaning up chart ${chartKey}:`, error);
  }
}

// ==================== BUTTON HANDLERS ====================

function setupRemoveButton(card, chartKey) {
  const removeBtn = card?.querySelector('.remove-btn');
  if (!removeBtn) return null;

  const abortController = new AbortController();

  const removeHandler = () => {
    if (appState.isShuttingDown || window.isGlobalError) return;

    try {
      cleanupChart(chartKey);
      card.remove();
      adjustGridLayout();
      console.log(`[RemoveButton] Successfully removed chart card: ${chartKey}`);
    } catch (error) {
      console.error(`[RemoveButton] Error removing chart ${chartKey}:`, error);
    }
  };

  removeBtn.addEventListener('click', removeHandler, { signal: abortController.signal });

  const cleanup = () => {
    abortController.abort();
  };

  return cleanup;
}

// ==================== TIMEFRAME HANDLER ====================

function setupTimeframeHandler(card, chartInstance, dataManager, symbol) {
  const tfSelect = card?.querySelector('.timeframe-select');
  if (!tfSelect) return null;

  let currentInterval = tfSelect.value;
  let isChanging = false;
  const abortController = new AbortController();

  const changeHandler = async () => {
    if (appState.isShuttingDown || window.isGlobalError || isChanging) return;

    const newInterval = tfSelect.value;
    if (newInterval === currentInterval) return;

    isChanging = true;
    console.log(`[TimeframeHandler] Changing ${symbol} from ${currentInterval} to ${newInterval}`);

    try {
      await dataManager.unsubscribe(symbol, currentInterval);
      currentInterval = newInterval;
      await dataManager.loadAndStart(symbol, currentInterval, chartInstance);
      console.log(`[TimeframeHandler] Successfully switched ${symbol} to ${newInterval}`);
    } catch (error) {
      console.error(`[TimeframeHandler] Failed to switch interval for ${symbol}:`, error);
      tfSelect.value = currentInterval;
    } finally {
      isChanging = false;
    }
  };

  tfSelect.addEventListener('change', changeHandler, { signal: abortController.signal });

  const cleanup = () => {
    abortController.abort();
  };

  return cleanup;
}

// ==================== CHART INITIALIZATION ====================

async function initializeCharts() {
  if (appState.isShuttingDown || appState.isInitialized) return;

  appState.statusLabel = document.getElementById('label-global');
  appState.statusDot = document.querySelector('.dot-global');
  const grid = document.getElementById('chart-grid');

  if (!grid) {
    console.error('[InitCharts] Chart grid container not found');
    return;
  }

  try {
    // Load LightweightCharts library with fallback CDNs
    await Promise.any(CDN_SOURCES.map(src => loadScript(src)));
    
    if (typeof LightweightCharts === 'undefined') {
      throw new Error('Lightweight Charts not loaded.');
    }

    console.log('[InitCharts] LightweightCharts loaded successfully');

    if (appState.statusLabel) appState.statusLabel.textContent = 'CONNECTED';
    if (appState.statusDot) appState.statusDot.style.background = 'var(--ok)';

    // Restore chart order from storage
    const savedOrder = storage.get('chartOrder', []);
    if (Array.isArray(savedOrder) && savedOrder.length > 0) {
      const nodeMap = new Map();
      Array.from(grid.querySelectorAll('.chart-card')).forEach(node => {
        if (node.dataset?.symbol) {
          nodeMap.set(node.dataset.symbol.toLowerCase(), node);
        }
      });
      
      savedOrder.forEach(sym => {
        const node = nodeMap.get((sym || '').toLowerCase());
        if (node) grid.appendChild(node);
      });
    }

    // Initialize all charts in parallel
    const initPromises = chartConfigs.map(async (config) => {
      if (appState.isShuttingDown) return;

      try {
        const dataManager = new ChartDataManager();
        const chartInstance = new ChartRenderer(config.id, config.symbol, dataManager);

        if (!chartInstance.container) {
          console.warn(`[InitCharts] Skipping ${config.symbol} - container not found`);
          return;
        }

        chartInstance.init();

        const card = document.getElementById(config.cardId);
        if (!card) {
          console.warn(`[InitCharts] Card not found for ${config.symbol}`);
          return;
        }

        // Setup all handlers
        const fullscreenCleanup = enableFullscreen(card, chartInstance);
        const removeCleanup = setupRemoveButton(card, config.cardId);
        const timeframeCleanup = setupTimeframeHandler(card, chartInstance, dataManager, config.symbol);

        // Combined cleanup function
        const chartCleanup = () => {
          try { fullscreenCleanup?.(); } catch (e) {}
          try { removeCleanup?.(); } catch (e) {}
          try { timeframeCleanup?.(); } catch (e) {}
        };

        // Store chart reference with cleanup
        appState.charts.set(config.cardId, {
          chartInstance,
          dataManager,
          symbol: config.symbol,
          cleanup: chartCleanup
        });

        cleanupManager.addCleanupTask(chartCleanup);

        // Load initial data
        const tfSelect = card.querySelector('.timeframe-select');
        const initialInterval = tfSelect?.value || '5m';

        const candles = await dataManager.loadAndStart(config.symbol, initialInterval, chartInstance);
        console.log(`[InitCharts] ${config.symbol} loaded ${candles?.length || 0} candles`);
      } catch (err) {
        console.error(`[InitCharts] Failed to initialize ${config.symbol}:`, err);
      }
    });

    // Wait for all charts to initialize
    await Promise.allSettled(initPromises);

    // Setup drag and drop functionality
    const dragDropCleanup = enableDragDrop(grid);
    if (typeof dragDropCleanup === 'function') {
      cleanupManager.addCleanupTask(dragDropCleanup);
    }

    adjustGridLayout();
    appState.isInitialized = true;
    console.log('[InitCharts] All charts initialized successfully');
  } catch (error) {
    console.error('[InitCharts] Failed to initialize charts:', error);
    if (appState.statusLabel) appState.statusLabel.textContent = 'ERROR';
    if (appState.statusDot) appState.statusDot.style.background = 'var(--danger)';
    window.handleGlobalError?.(true, error, 'LightweightCharts bootstrap failure');
  }
}

// ==================== APPLICATION LIFECYCLE ====================

async function startApplication() {
  if (appState.isInitialized) {
    console.warn('[App] Application already initialized');
    return;
  }

  try {
    appState.isShuttingDown = false;
    appState.abortController = new AbortController();
    window.isGlobalError = false;
    window.handleGlobalError?.(false);

    cleanupManager.setupGlobalCleanup();

    console.log('[App] Starting crypto charts application...');

    await initializeCharts();

    // ✅ Initialize Alert System and register cleanup
    try {
      const alertCleanup = setupAlertUI();
      if (typeof alertCleanup === 'function') {
        cleanupManager.addCleanupTask(alertCleanup);
      }
      console.log('[App] ✅ Alert system initialized and ready');
    } catch (error) {
      console.error('[App] Failed to initialize alert system:', error);
      // Don't fail the entire app if alerts fail
    }

    const tickerCleanup = await setupTickerSelect(
      appState.charts,
      adjustGridLayout,
      enableFullscreen
    );
    if (typeof tickerCleanup === 'function') {
      cleanupManager.addCleanupTask(tickerCleanup);
    }

    console.log('[App] Application started successfully');
  } catch (error) {
    console.error('[App] Failed to start application:', error);
    window.handleGlobalError?.(true, error, 'App startup failure');
  }
}

export async function shutdownApplication() {
  if (appState.isShuttingDown) {
    console.warn('[App] Shutdown already in progress');
    return;
  }

  console.log('[App] Shutting down application...');
  appState.isShuttingDown = true;

  try {
    // Abort all ongoing operations
    appState.abortController?.abort();

    // Cleanup alert system
    try {
      if (AlertSystem && typeof AlertSystem.destroy === 'function') {
        AlertSystem.destroy();
        console.log('[App] Alert system destroyed');
      }
    } catch (error) {
      console.warn('[App] Error destroying alert system:', error);
    }

    // Run cleanup manager
    await cleanupManager.destroy();

    // Clean up any remaining charts
    const remainingCharts = Array.from(appState.charts.keys());
    for (const chartKey of remainingCharts) {
      cleanupChart(chartKey);
    }

    // Reset state
    appState.charts.clear();
    appState.isInitialized = false;
    lastGridState = null;
    
    console.log('[App] Application shutdown complete');
  } catch (error) {
    console.error('[App] Error during application shutdown:', error);
  }
}

// ==================== INITIALIZATION ====================

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApplication, { once: true });
} else {
  startApplication();
}