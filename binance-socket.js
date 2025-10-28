/**
 * BinanceSocket - Singleton WebSocket Pooling for Binance Streams
 * Features:
 * - One socket per symbol/interval
 * - Multiple callbacks can subscribe to each stream
 * - Automatic cleanup when last subscriber leaves, with stale timer/generation token
 * - Error event hooks per stream
 * - REST methods for symbol validation & history (with caching)
 * - Async error handling: global error notifications for UI
 * - FIXED: Race condition in stale timer logic
 */

class BinanceSocket {
  constructor() {
    if (BinanceSocket._instance) return BinanceSocket._instance;
    BinanceSocket._instance = this;

    this.subscriptions = new Map(); // key: symbol-interval -> Set of callbacks
    this.sockets = new Map();       // key: symbol-interval -> WebSocket instance
    this.reconnectInfo = new Map(); // key: symbol-interval -> reconnect state
    this.staleTimers = new Map();   // key: symbol-interval -> timeout id
    this.staleGenerations = new Map(); // key: symbol-interval -> generation token
    this.errorHandlers = new Map(); // key: symbol-interval/global -> Set of error handlers
    this.socketStates = new Map();  // ✅ NEW: Track socket lifecycle states

    // Cache for exchangeInfo to reduce REST calls
    this._exchangeInfoCache = { timestamp: 0, data: null, ttl: 5 * 60 * 1000 }; // 5 minutes

    this._globalErrorState = false;
    this._setupDefaultGlobalErrorHook();
  }

  // Setup the default global error hook for UI banner and controls
  _setupDefaultGlobalErrorHook() {
    this.onError('global', '', (err, ctx) => {
      if (window && typeof window.handleGlobalError === 'function') {
        window.handleGlobalError(true, err, ctx);
      }
      this._globalErrorState = true;
    });
  }

  // Call this when a connection is restored or API request succeeds
  _clearGlobalError() {
    if (window && typeof window.handleGlobalError === 'function') {
      window.handleGlobalError(false);
    }
    this._globalErrorState = false;
  }

  /**
   * Register an error handler for a particular symbol/interval stream.
   */
  onError(symbol, interval, handler) {
    const key = symbol && interval ? `${symbol}-${interval}` : 'global';
    if (!this.errorHandlers.has(key)) {
      this.errorHandlers.set(key, new Set());
    }
    this.errorHandlers.get(key).add(handler);
  }

  /**
   * Remove a previously registered error handler.
   */
  offError(symbol, interval, handler) {
    const key = symbol && interval ? `${symbol}-${interval}` : 'global';
    if (this.errorHandlers.has(key)) {
      this.errorHandlers.get(key).delete(handler);
      if (this.errorHandlers.get(key).size === 0) {
        this.errorHandlers.delete(key);
      }
    }
  }

  /**
   * Internal: Fire error events to handlers
   */
  _emitError(key, err, context = {}) {
    if (this.errorHandlers.has(key)) {
      this.errorHandlers.get(key).forEach(handler => {
        try {
          handler(err, context);
        } catch (e) {
          console.warn('[BinanceSocket] Error handler threw', e);
        }
      });
    }
    if (key !== 'global' && this.errorHandlers.has('global')) {
      this.errorHandlers.get('global').forEach(handler => {
        try { handler(err, context); } catch (e) {}
      });
    }

    // Only mark global error for REST or socket-level errors (not every parse/handler error)
    if (context && (context.type === 'rest' || context.type === 'socket')) {
      this._globalErrorState = true;
      if (window && typeof window.handleGlobalError === 'function') {
        window.handleGlobalError(true, err, context);
      }
    } else {
      // log non-global errors
      console.warn('[BinanceSocket] Non-global error:', err, context);
    }
  }

  /**
   * Validate a symbol against Binance exchange info (cached)
   */
  async isValidSymbol(symbol) {
    try {
      const exchange = await this._getExchangeInfo();
      if (!exchange) return false;
      return exchange.some(s => s.toUpperCase() === symbol.toUpperCase());
    } catch (err) {
      console.error('[BinanceSocket] Symbol validation failed', err);
      this._emitError('global', err, { type: 'rest', action: 'isValidSymbol', symbol });
      return false;
    }
  }

  /**
   * Fetch historical candles (uses REST)
   */
  async getHistoricalData(symbol, interval, limit = 500) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      const data = await res.json();
      this._clearGlobalError();
      return data.map(c => ({
        time: Math.floor(c[0] / 1000),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));
    } catch (err) {
      console.error(`[BinanceSocket] Failed to fetch historical data for ${symbol} [${interval}]`, err);
      this._emitError('global', err, { type: 'rest', action: 'getHistoricalData', symbol, interval });
      return [];
    }
  }

  /**
   * Internal: fetch and cache exchangeInfo symbols
   */
  async _getExchangeInfo() {
    const now = Date.now();
    if (this._exchangeInfoCache.data && (now - this._exchangeInfoCache.timestamp) < this._exchangeInfoCache.ttl) {
      return this._exchangeInfoCache.data;
    }
    try {
      const res = await fetch('https://api.binance.com/api/v3/exchangeInfo');
      const json = await res.json();
      const symbols = (json?.symbols || []).map(s => s.symbol);
      this._exchangeInfoCache = { timestamp: Date.now(), data: symbols, ttl: this._exchangeInfoCache.ttl };
      this._clearGlobalError();
      return symbols;
    } catch (err) {
      console.error('[BinanceSocket] Failed to fetch exchangeInfo', err);
      this._emitError('global', err, { type: 'rest', action: 'exchangeInfo' });
      return null;
    }
  }

  /**
   * ✅ FIXED: Subscribe to a symbol/interval stream (WebSocket pooling with race condition fix).
   */
  subscribe(symbol, interval, callback) {
    const key = `${symbol}-${interval}`;
    
    // Initialize subscriptions set if needed
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    this.subscriptions.get(key).add(callback);

    // ✅ RACE CONDITION FIX: Cancel stale timer and bump generation BEFORE checking socket
    if (this.staleTimers.has(key)) {
      clearTimeout(this.staleTimers.get(key));
      this.staleTimers.delete(key);
    }
    
    // ✅ Always bump generation when new subscription added
    const currentGen = this.staleGenerations.get(key) || 0;
    const newGen = currentGen + 1;
    this.staleGenerations.set(key, newGen);
    
    console.log(`[BinanceSocket] Subscribe: ${key}, generation: ${newGen}, callbacks: ${this.subscriptions.get(key).size}`);

    // If socket already exists and is connected, we're done
    const existingSocket = this.sockets.get(key);
    const socketState = this.socketStates.get(key);
    
    if (existingSocket && socketState === 'connected') {
      console.log(`[BinanceSocket] Reusing existing connected socket for ${key}`);
      return;
    }
    
    // If socket is connecting, wait for it
    if (existingSocket && socketState === 'connecting') {
      console.log(`[BinanceSocket] Socket already connecting for ${key}`);
      return;
    }

    // Init reconnect info
    if (!this.reconnectInfo.has(key)) {
      this.reconnectInfo.set(key, { reconnecting: false, attempt: 0 });
    }

    this._openSocket(key, symbol, interval);
  }

  /**
   * ✅ FIXED: Unsubscribe a callback from a symbol/interval with proper race condition handling.
   */
  unsubscribe(symbol, interval, callback) {
    const key = `${symbol}-${interval}`;
    const cbs = this.subscriptions.get(key);
    
    if (!cbs) {
      console.log(`[BinanceSocket] No subscriptions found for ${key}`);
      return;
    }
    
    cbs.delete(callback);
    console.log(`[BinanceSocket] Unsubscribe: ${key}, remaining callbacks: ${cbs.size}`);

    // Only start stale timer if there are no callbacks left
    if (cbs.size === 0) {
      // ✅ Bump generation and start fresh timer
      const currentGen = this.staleGenerations.get(key) || 0;
      const newGen = currentGen + 1;
      this.staleGenerations.set(key, newGen);
      
      console.log(`[BinanceSocket] No more callbacks for ${key}, starting stale timer with generation ${newGen}`);
      this._startStaleTimer(key, symbol, interval, 10 * 60 * 1000, newGen);
    }
  }

  _openSocket(key, symbol, interval) {
    // ✅ Set state to 'connecting' before creating socket
    this.socketStates.set(key, 'connecting');
    
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}`;
    const ws = new WebSocket(wsUrl);

    this.sockets.set(key, ws);
    console.log(`[BinanceSocket] Opening socket for ${key}`);

    ws.onopen = () => {
      console.log(`[BinanceSocket] Connected: ${key}`);
      
      // ✅ Set state to 'connected'
      this.socketStates.set(key, 'connected');
      
      const info = this.reconnectInfo.get(key);
      if (info) info.attempt = 0;
      this._clearGlobalError();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg.k) return;
        this._clearGlobalError();
        const k = msg.k;
        const candle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };
        const isClosed = k.x === true;

        const cbs = this.subscriptions.get(key);
        if (cbs) {
          cbs.forEach(cb => {
            try {
              cb(candle, isClosed);
            } catch (err) {
              console.warn('[BinanceSocket] Callback error', err);
              this._emitError(key, err, { type: 'callback', candle, isClosed });
            }
          });
        }
      } catch (err) {
        console.error('[BinanceSocket] Failed to parse WebSocket message', err);
        // Parsing errors shouldn't necessarily mark the global state, but notify handlers
        this._emitError(key, err, { type: 'parse', raw: event.data });
      }
    };

    ws.onerror = (err) => {
      console.error(`[BinanceSocket] WebSocket error for ${key}`, err);
      this._emitError(key, err, { type: 'socket', action: 'onerror' });
      
      // ✅ Set state to 'error'
      this.socketStates.set(key, 'error');
      
      this._handleReconnect(key, symbol, interval);
    };

    ws.onclose = () => {
      console.log(`[BinanceSocket] Closed: ${key}`);
      
      // ✅ Clear state
      this.socketStates.delete(key);
      this.sockets.delete(key);
      
      // Only reconnect if there are still active subscriptions
      if (this.subscriptions.has(key) && this.subscriptions.get(key).size > 0) {
        console.log(`[BinanceSocket] Socket closed but ${this.subscriptions.get(key).size} callbacks remain, reconnecting...`);
        this._handleReconnect(key, symbol, interval);
      } else {
        console.log(`[BinanceSocket] Socket closed with no remaining callbacks`);
        this.reconnectInfo.delete(key);
      }
    };
  }

  _handleReconnect(key, symbol, interval) {
    const info = this.reconnectInfo.get(key);
    if (!info || info.reconnecting) return;

    // ✅ Check if there are still subscribers before reconnecting
    const cbs = this.subscriptions.get(key);
    if (!cbs || cbs.size === 0) {
      console.log(`[BinanceSocket] No subscribers for ${key}, skipping reconnect`);
      return;
    }

    info.reconnecting = true;
    info.attempt += 1;

    // Exponential backoff: min 1s, max 30s
    const delay = Math.min(1000 * Math.pow(2, info.attempt), 30000);
    console.log(`[BinanceSocket] Reconnecting for ${key} in ${delay / 1000}s (attempt ${info.attempt})`);

    setTimeout(() => {
      // ✅ Double-check subscribers still exist before reconnecting
      const currentCbs = this.subscriptions.get(key);
      if (!currentCbs || currentCbs.size === 0) {
        console.log(`[BinanceSocket] Subscribers gone during reconnect delay for ${key}, aborting`);
        info.reconnecting = false;
        return;
      }
      
      info.reconnecting = false;
      this._openSocket(key, symbol, interval);
    }, delay);
  }

  /**
   * ✅ FIXED: Start a stale socket timer with proper race condition handling.
   * Uses generation token to avoid race conditions.
   */
  _startStaleTimer(key, symbol, interval, timeoutMs = 10 * 60 * 1000, gen) {
    // ✅ Clear any existing timer first
    if (this.staleTimers.has(key)) {
      clearTimeout(this.staleTimers.get(key));
      this.staleTimers.delete(key);
    }

    console.log(`[BinanceSocket] Starting stale timer for ${key} (gen: ${gen}, timeout: ${timeoutMs}ms)`);

    const timerId = setTimeout(() => {
      console.log(`[BinanceSocket] Stale timer fired for ${key} (gen: ${gen})`);
      
      // ✅ CRITICAL: Check generation token to prevent race condition
      const currentGen = this.staleGenerations.get(key);
      if (currentGen !== gen) {
        console.log(`[BinanceSocket] Generation mismatch for ${key}: expected ${gen}, got ${currentGen}. Aborting close.`);
        return;
      }
      
      // ✅ Double-check subscriptions
      const cbs = this.subscriptions.get(key);
      if (!cbs || cbs.size === 0) {
        console.log(`[BinanceSocket] Stale timer confirmed: closing ${key}`);
        this._closeSocket(key, symbol, interval);
      } else {
        console.log(`[BinanceSocket] Stale timer aborted: ${key} has ${cbs.size} active callbacks`);
      }
      
      // Clean up timer reference
      this.staleTimers.delete(key);
      this.staleGenerations.delete(key);
    }, timeoutMs);

    this.staleTimers.set(key, timerId);
  }

  /**
   * ✅ FIXED: Close WebSocket for symbol/interval with proper cleanup
   */
  _closeSocket(key, symbol, interval) {
    console.log(`[BinanceSocket] Closing socket for ${key}`);
    
    // ✅ Triple-check if any callbacks remain (belt and suspenders)
    const cbs = this.subscriptions.get(key);
    if (cbs && cbs.size > 0) {
      console.warn(`[BinanceSocket] Aborting close: ${key} has ${cbs.size} active callbacks!`);
      return;
    }

    // Clear stale timer if it exists
    if (this.staleTimers.has(key)) {
      clearTimeout(this.staleTimers.get(key));
      this.staleTimers.delete(key);
    }
    this.staleGenerations.delete(key);

    // Close the WebSocket
    const ws = this.sockets.get(key);
    if (ws) {
      try {
        // ✅ Check socket state before closing
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          console.log(`[BinanceSocket] WebSocket closed for ${key}`);
        } else {
          console.log(`[BinanceSocket] WebSocket already closed for ${key} (readyState: ${ws.readyState})`);
        }
      } catch (err) {
        console.warn(`[BinanceSocket] Error closing socket ${key}`, err);
        this._emitError(key, err, { type: 'socket', action: 'close' });
      }
    }

    // Clean up all references
    this.sockets.delete(key);
    this.socketStates.delete(key);
    this.subscriptions.delete(key);
    this.reconnectInfo.delete(key);
    this.errorHandlers.delete(key);
    
    console.log(`[BinanceSocket] All references cleared for ${key}`);
  }

  /**
   * ✅ NEW: Get socket status for debugging
   */
  getSocketStatus(symbol, interval) {
    const key = `${symbol}-${interval}`;
    return {
      key,
      hasSocket: this.sockets.has(key),
      socketState: this.socketStates.get(key) || 'none',
      subscriberCount: this.subscriptions.get(key)?.size || 0,
      generation: this.staleGenerations.get(key) || 0,
      hasStaleTimer: this.staleTimers.has(key),
      reconnectInfo: this.reconnectInfo.get(key) || null
    };
  }

  /**
   * ✅ NEW: Force cleanup (for debugging/testing)
   */
  forceCleanup(symbol, interval) {
    const key = `${symbol}-${interval}`;
    console.log(`[BinanceSocket] Force cleanup: ${key}`);
    this._closeSocket(key, symbol, interval);
  }
}

// Export singleton instance
export default new BinanceSocket();