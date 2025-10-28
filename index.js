// paper-trader/index.js - UPDATED WITH EQUITY TRACKER
// ✅ FIXED #1: Storage API now properly initialized
// ✅ NEW: Equity tracking for P&L chart

import PriceObserverManager from './price-observer.js';
import State from './state.js';
import Persistence from './persistence.js';
import Notifications from './notifications.js';
import Executor from './executor.js';
import OrderManager from './order-manager.js';
import UI from './ui.js';
import EquityTracker from './equity-tracker.js'; // ✅ NEW
import storageAPI from './storage-api.js';
import { formatMoney } from './utils.js';

const DEFAULT_OPTIONS = {
  position: 'right',
  width: '420px',
  initialBalance: 10000,
  feeRate: 0.001,
  maxLeverage: 3,
  slippageEnabled: true,
  saveIntervalMs: 5000,
  leverageSimulation: true,
  maintenanceMarginRatio: 0.5
};

class PaperTraderConnector {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.state = new State(this.options);
    this.persistence = new Persistence('paperTraderConnectorState');
    this.notifications = new Notifications();
    
    // ✅ FIXED: Initialize storage API
    this.storageAPI = storageAPI;
    
    this.priceObserver = new PriceObserverManager();
    
    // ✅ FIXED: Pass notifications to executor for better error reporting
    this.executor = new Executor(
      this.options, 
      this.state, 
      this.notifications,
      { emitEvent: this._emitEvent.bind(this) }
    );
    
    // ✅ FIXED: Pass notifications to order manager
    this.orderManager = new OrderManager(
      this.state, 
      this.executor, 
      this.notifications
    );
    
    // ✅ NEW: Initialize equity tracker
    this.equityTracker = new EquityTracker(this.state, this.persistence);
    
    this.ui = new UI(this.options, {
      state: this.state,
      orderManager: this.orderManager,
      persistence: this.persistence,
      notifications: this.notifications,
      executor: this.executor,
      storageAPI: this.storageAPI,
      equityTracker: this.equityTracker // ✅ NEW: Pass to UI
    });
    
    this.isOpen = false;
    this._boundPriceHandler = this._onPriceUpdate.bind(this);
    this._eventHandlers = new Map();
  }

  init() {
    console.log('[PaperTrader] Initializing...');
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    
    // ✅ FIXED: Initialize storage API and test it
    this._initializeStorageAPI();
    
    // Load saved state
    const saved = this.persistence.load();
    if (saved) {
      console.log('[PaperTrader] Loading saved state...');
      this.state.hydrate(saved);
    }
    
    // Build UI
    this.ui.buildPanel();
    
    // Set up event handlers
    this.ui.on('placeOrder', (order) => this.placeOrder(order));
    this.ui.on('resetAccount', () => this.reset());
    this.ui.on('exportTrades', () => this.exportTrades());
    
    // Start price observation
    this.priceObserver.observeAll(this._boundPriceHandler);
    
    // Auto-save interval
    this._saveTimer = setInterval(() => {
      try { 
        this.persistence.save(this.state.serialize()); 
      } catch (e) {
        console.warn('[PaperTrader] Auto-save failed:', e);
      }
    }, this.options.saveIntervalMs);
    
    // Make globally available
    window.paperTraderConnector = this;
    window.PaperTraderConnector = PaperTraderConnector;
    
    // Update UI
    if (typeof this.ui.updateBalanceDisplay === 'function') {
      this.ui.updateBalanceDisplay(this.state.balance);
    }
    
    // Show initialization message
    this.notifications.info('Paper Trader initialized');
    console.log('✅ Paper Trader Connector initialized');
    
    // Emit ready event
    this._emitEvent('paperTrader:ready', { connector: this });
    
    return this;
  }

  /**
   * ✅ FIXED: Initialize and test storage API
   */
  _initializeStorageAPI() {
    try {
      // Test storage API
      const testResult = storageAPI.test();
      
      if (testResult) {
        console.log('[PaperTrader] ✅ Storage API initialized and tested successfully');
        this.notifications.success('Storage API ready');
      } else {
        console.warn('[PaperTrader] ⚠️ Storage API test failed, but API is available');
        this.notifications.warning('Storage API available but test failed');
      }
      
      // Log storage stats
      const stats = storageAPI.getStats();
      if (stats) {
        console.log('[PaperTrader] Storage stats:', {
          personalKeys: stats.personal.count,
          sharedKeys: stats.shared.count,
          totalSize: stats.total.sizeMB + ' MB'
        });
      }
      
      // Make storage API globally accessible
      window.storage = this.storageAPI;
      
    } catch (error) {
      console.error('[PaperTrader] Storage API initialization error:', error);
      this.notifications.warning('Storage API unavailable - some features may be limited');
    }
  }

  /**
   * ✅ FIXED: Centralized event emission
   */
  _emitEvent(name, detail) {
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      try {
        document.dispatchEvent(new CustomEvent(name, { detail }));
      } catch (e) {
        console.warn('[PaperTrader] Event emission failed:', name, e);
      }
    }
    
    // Also emit to internal handlers
    const handlers = this._eventHandlers.get(name);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(detail);
        } catch (e) {
          console.warn('[PaperTrader] Event handler error:', name, e);
        }
      });
    }
  }

  /**
   * Subscribe to events
   */
  on(eventName, handler) {
    if (!this._eventHandlers.has(eventName)) {
      this._eventHandlers.set(eventName, new Set());
    }
    this._eventHandlers.get(eventName).add(handler);
  }

  /**
   * Unsubscribe from events
   */
  off(eventName, handler) {
    const handlers = this._eventHandlers.get(eventName);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  _onPriceUpdate(symbol, price) {
    this.state.setLastPrice(symbol, price);
    this.orderManager.onPriceUpdate(symbol, price);
    this._emitEvent('paperTrader:priceUpdate', { symbol, price });
    this.ui.refreshIfOpen();
  }

  async placeOrder(order) {
    try {
      const result = await this.orderManager.placeOrder(order);
      
      // ✅ NEW: Capture equity snapshot on trade
      this.equityTracker.onTradeExecuted(result);
      
      this.ui.refreshIfOpen();
      this.persistence.save(this.state.serialize());
      
      // ✅ FIXED: Emit order placed event
      this._emitEvent('paperTrader:orderPlaced', { order, result });
      
      return result;
    } catch (err) {
      this.notifications.error(err.message || String(err));
      throw err;
    }
  }

  exportTrades() {
    try {
      const data = {
        trades: this.state.trades,
        positions: this.state.positions,
        pendingOrders: this.state.pendingOrders,
        balance: this.state.balance,
        initialBalance: this.state.initialBalance,
        metrics: this.state.getPerformanceMetrics(),
        equitySnapshots: this.equityTracker.snapshots, // ✅ NEW: Include snapshots
        exportDate: new Date().toISOString(),
        version: '1.0'
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paper-trades-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      this.notifications.success('Trades exported successfully');
      
      // ✅ FIXED: Emit export event
      this._emitEvent('paperTrader:tradesExported', { tradeCount: data.trades.length });
      
    } catch (error) {
      console.error('[PaperTrader] Export failed:', error);
      this.notifications.error('Export failed: ' + error.message);
    }
  }

  reset() {
    try {
      this.state.reset();
      this.equityTracker.reset(); // ✅ NEW: Reset equity snapshots
      this.persistence.clear();
      this.ui.refreshIfOpen();
      this.notifications.info('Account reset');
      
      // ✅ FIXED: Emit reset event
      this._emitEvent('paperTrader:accountReset', { timestamp: Date.now() });
      
    } catch (error) {
      console.error('[PaperTrader] Reset failed:', error);
      this.notifications.error('Reset failed: ' + error.message);
    }
  }

  getState() {
    return this.state.serialize();
  }

  /**
   * ✅ NEW: Get comprehensive diagnostics
   */
  getDiagnostics() {
    return {
      state: this.state.getDiagnostics(),
      priceObserver: this.priceObserver.getStats(),
      orderManager: this.orderManager.getRaceConditionDiagnostics(),
      executor: this.executor.getPrecisionStats(),
      ui: this.ui.getErrorDiagnostics(),
      storage: this.storageAPI.getStats(),
      persistence: this.persistence.getStorageInfo(),
      equityTracker: this.equityTracker.getDiagnostics() // ✅ NEW
    };
  }

  /**
   * ✅ NEW: Health check for all subsystems
   */
  healthCheck() {
    console.log('[PaperTrader] Running health check...');
    
    const diagnostics = this.getDiagnostics();
    const issues = [];
    
    // Check state
    if (!diagnostics.state.validation.valid) {
      issues.push({
        component: 'State',
        severity: 'critical',
        issues: diagnostics.state.validation.issues
      });
    }
    
    // Check price observer
    if (diagnostics.priceObserver.health === 'POOR' || diagnostics.priceObserver.health === 'CRITICAL') {
      issues.push({
        component: 'PriceObserver',
        severity: 'warning',
        health: diagnostics.priceObserver.health,
        totalErrors: diagnostics.priceObserver.totalErrors
      });
    }
    
    // Check order manager
    if (diagnostics.orderManager.health.status === 'WARNING') {
      issues.push({
        component: 'OrderManager',
        severity: 'warning',
        recommendations: diagnostics.orderManager.health.recommendations
      });
    }
    
    // Check executor
    if (Math.abs(diagnostics.executor.cumulativeRoundingError) > 1.0) {
      issues.push({
        component: 'Executor',
        severity: 'warning',
        issue: 'Cumulative rounding error exceeds $1.00',
        value: diagnostics.executor.cumulativeRoundingError
      });
    }
    
    if (diagnostics.executor.accountDebt > 0) {
      issues.push({
        component: 'Executor',
        severity: 'critical',
        issue: 'Account has unresolved debt',
        value: diagnostics.executor.accountDebt
      });
    }
    
    // Summary
    const healthStatus = {
      timestamp: new Date().toISOString(),
      overall: issues.length === 0 ? 'HEALTHY' : 
               issues.some(i => i.severity === 'critical') ? 'CRITICAL' : 'WARNING',
      issues,
      diagnostics
    };
    
    console.log('[PaperTrader] Health check complete:', healthStatus.overall);
    
    if (issues.length > 0) {
      console.warn('[PaperTrader] Health issues detected:', issues);
      
      if (healthStatus.overall === 'CRITICAL') {
        this.notifications.error('Critical health issues detected. Check console for details.');
      } else {
        this.notifications.warning(`${issues.length} health warning(s) detected.`);
      }
    }
    
    return healthStatus;
  }

  destroy() {
    console.log('[PaperTrader] Destroying connector...');
    
    try {
      // Clear save timer
      if (this._saveTimer) {
        clearInterval(this._saveTimer);
        this._saveTimer = null;
      }
      
      // Save final state
      this.persistence.save(this.state.serialize(), true); // immediate save
      
      // Destroy subsystems
      this.priceObserver.unobserveAll();
      this.ui.destroy();
      this.orderManager.destroy();
      this.executor.destroy();
      this.equityTracker.destroy(); // ✅ NEW
      this.notifications.destroy();
      this.persistence.destroy();
      
      // Clear event handlers
      this._eventHandlers.clear();
      
      // Remove global references
      if (window.paperTraderConnector === this) {
        delete window.paperTraderConnector;
      }
      
      console.log('🧹 Paper Trader Connector destroyed');
      
      // Emit destroy event
      this._emitEvent('paperTrader:destroyed', { timestamp: Date.now() });
      
    } catch (error) {
      console.error('[PaperTrader] Destroy error:', error);
    }
  }
}

// Initialize on load
const connector = new PaperTraderConnector();
connector.init();

// ✅ FIXED: Run health check after initialization
setTimeout(() => {
  connector.healthCheck();
}, 2000);

export default connector;
export { PaperTraderConnector, connector };