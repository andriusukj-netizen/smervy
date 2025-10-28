// paper-trader/state.js - FIXED VERSION
// ✅ FIXED #3: Race condition prevention with validated hydration
// ✅ FIXED #10: Proper null/undefined checks in equity calculation
// ✅ FIXED: Safe fallbacks for missing price data
// ✅ FIXED: Validation of all numeric operations
// ✅ FIXED: Proper equity calculation for spot positions (includes asset value)

import { computeMetrics } from './utils.js';

export default class State {
  constructor(options = {}) {
    this.options = options;
    this.balance = options.initialBalance || 10000;
    this.initialBalance = options.initialBalance || 10000;
    this.positions = [];
    this.trades = [];
    this.pendingOrders = [];
    this.orderHistory = [];
    this.lastPrices = {};
    
    // Track missing price warnings to avoid spam
    this._missingPriceWarnings = new Set();
    
    // ✅ FIXED: Track hydration attempts and status
    this._hydrationAttempts = 0;
    this._lastHydrationSuccess = false;
    this._lastHydrationErrors = [];
  }

  serialize() {
    return {
      balance: this.balance,
      initialBalance: this.initialBalance,
      positions: this.positions,
      trades: this.trades,
      pendingOrders: this.pendingOrders,
      orderHistory: this.orderHistory,
      // ✅ NEW: Include metadata
      _metadata: {
        version: '1.0',
        timestamp: Date.now(),
        positionCount: this.positions.length,
        tradeCount: this.trades.length
      }
    };
  }

  /**
   * ✅ FIXED #3: Comprehensive hydration validation to prevent race conditions
   */
  hydrate(obj = {}) {
    this._hydrationAttempts++;
    this._lastHydrationErrors = [];
    
    console.log(`[State] Hydration attempt #${this._hydrationAttempts}...`);
    
    // ✅ Step 1: Validate hydration data structure
    const validation = this._validateHydrationData(obj);
    
    if (!validation.valid) {
      console.error('[State] ❌ Hydration validation failed:', validation.issues);
      this._lastHydrationErrors = validation.issues;
      this._lastHydrationSuccess = false;
      
      // Don't hydrate invalid data - return false to indicate failure
      return false;
    }
    
    console.log('[State] ✅ Hydration validation passed');
    
    // ✅ Step 2: Sanitize and hydrate with type checking
    try {
      // Hydrate primitive values with validation
      this.balance = this._sanitizeNumber(obj.balance, this.balance);
      this.initialBalance = this._sanitizeNumber(obj.initialBalance, this.initialBalance);
      
      // Hydrate arrays with validation
      this.positions = this._sanitizePositions(obj.positions);
      this.trades = this._sanitizeTrades(obj.trades);
      this.pendingOrders = this._sanitizeOrders(obj.pendingOrders);
      this.orderHistory = this._sanitizeOrders(obj.orderHistory);
      
      // Clear missing price warnings on successful hydration
      this._missingPriceWarnings.clear();
      
      this._lastHydrationSuccess = true;
      
      console.log('[State] ✅ Hydration successful:', {
        balance: this.balance.toFixed(2),
        positions: this.positions.length,
        trades: this.trades.length,
        pendingOrders: this.pendingOrders.length
      });
      
      return true;
      
    } catch (error) {
      console.error('[State] ❌ Hydration error during sanitization:', error);
      this._lastHydrationErrors.push(`Sanitization error: ${error.message}`);
      this._lastHydrationSuccess = false;
      
      // Rollback to safe state
      this._rollbackToSafeState();
      
      return false;
    }
  }

  /**
   * ✅ FIXED: Comprehensive validation of hydration data
   */
  _validateHydrationData(obj) {
    const issues = [];
    
    // Check if obj exists and is an object
    if (!obj || typeof obj !== 'object') {
      issues.push('Data is not a valid object');
      return { valid: false, issues };
    }
    
    // Validate balance (critical field)
    if ('balance' in obj) {
      if (typeof obj.balance !== 'number') {
        issues.push(`Invalid balance type: ${typeof obj.balance} (expected number)`);
      } else if (!isFinite(obj.balance) || isNaN(obj.balance)) {
        issues.push(`Invalid balance value: ${obj.balance}`);
      }
    }
    
    // Validate initialBalance
    if ('initialBalance' in obj) {
      if (typeof obj.initialBalance !== 'number') {
        issues.push(`Invalid initialBalance type: ${typeof obj.initialBalance}`);
      } else if (!isFinite(obj.initialBalance) || isNaN(obj.initialBalance)) {
        issues.push(`Invalid initialBalance value: ${obj.initialBalance}`);
      }
    }
    
    // Validate arrays
    if ('positions' in obj && !Array.isArray(obj.positions)) {
      issues.push('Positions must be an array');
    }
    
    if ('trades' in obj && !Array.isArray(obj.trades)) {
      issues.push('Trades must be an array');
    }
    
    if ('pendingOrders' in obj && !Array.isArray(obj.pendingOrders)) {
      issues.push('PendingOrders must be an array');
    }
    
    if ('orderHistory' in obj && !Array.isArray(obj.orderHistory)) {
      issues.push('OrderHistory must be an array');
    }
    
    // Validate positions structure (sample first few)
    if (Array.isArray(obj.positions)) {
      const samplesToCheck = Math.min(3, obj.positions.length);
      for (let i = 0; i < samplesToCheck; i++) {
        const pos = obj.positions[i];
        if (!pos || typeof pos !== 'object') {
          issues.push(`Position ${i} is not a valid object`);
          continue;
        }
        
        if (!pos.symbol || typeof pos.symbol !== 'string') {
          issues.push(`Position ${i} missing or invalid symbol`);
        }
        
        if (typeof pos.entryPrice !== 'number' || !isFinite(pos.entryPrice)) {
          issues.push(`Position ${i} has invalid entryPrice`);
        }
        
        if (typeof pos.quantity !== 'number' || !isFinite(pos.quantity)) {
          issues.push(`Position ${i} has invalid quantity`);
        }
        
        if (pos.side !== 'buy' && pos.side !== 'sell') {
          issues.push(`Position ${i} has invalid side: ${pos.side}`);
        }
      }
    }
    
    // Check for data integrity issues
    if (obj.balance < 0 && obj.positions && obj.positions.length === 0) {
      issues.push('Negative balance with no open positions (potential corruption)');
    }
    
    // Check for suspiciously large values
    if (obj.balance && Math.abs(obj.balance) > 10000000) {
      issues.push(`Balance suspiciously large: ${obj.balance}`);
    }
    
    if (obj.positions && obj.positions.length > 1000) {
      issues.push(`Excessive position count: ${obj.positions.length}`);
    }
    
    if (obj.trades && obj.trades.length > 50000) {
      issues.push(`Excessive trade count: ${obj.trades.length}`);
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * ✅ FIXED: Sanitize numeric values
   */
  _sanitizeNumber(value, defaultValue = 0) {
    if (typeof value !== 'number') {
      console.warn('[State] Non-numeric value, using default:', { value, defaultValue });
      return defaultValue;
    }
    
    if (!isFinite(value) || isNaN(value)) {
      console.warn('[State] Invalid numeric value, using default:', { value, defaultValue });
      return defaultValue;
    }
    
    return value;
  }

  /**
   * ✅ FIXED: Sanitize positions array
   */
  _sanitizePositions(positions) {
    if (!Array.isArray(positions)) {
      console.warn('[State] Positions not an array, returning empty array');
      return [];
    }
    
    return positions.filter((pos, idx) => {
      try {
        // Validate required fields
        if (!pos || typeof pos !== 'object') {
          console.warn(`[State] Position ${idx} is not an object, skipping`);
          return false;
        }
        
        if (!pos.symbol || typeof pos.symbol !== 'string') {
          console.warn(`[State] Position ${idx} missing symbol, skipping`);
          return false;
        }
        
        if (!this._isValidNumber(pos.entryPrice) || pos.entryPrice <= 0) {
          console.warn(`[State] Position ${idx} (${pos.symbol}) has invalid entryPrice, skipping`);
          return false;
        }
        
        if (!this._isValidNumber(pos.quantity) || pos.quantity <= 0) {
          console.warn(`[State] Position ${idx} (${pos.symbol}) has invalid quantity, skipping`);
          return false;
        }
        
        if (pos.side !== 'buy' && pos.side !== 'sell') {
          console.warn(`[State] Position ${idx} (${pos.symbol}) has invalid side, skipping`);
          return false;
        }
        
        // Sanitize optional numeric fields
        if (pos.leverage !== undefined) {
          pos.leverage = this._sanitizeNumber(pos.leverage, 1);
        }
        
        if (pos.stopLoss !== undefined && pos.stopLoss !== null) {
          if (!this._isValidNumber(pos.stopLoss)) {
            pos.stopLoss = null;
          }
        }
        
        if (pos.takeProfit !== undefined && pos.takeProfit !== null) {
          if (!this._isValidNumber(pos.takeProfit)) {
            pos.takeProfit = null;
          }
        }
        
        if (pos.reservedExitFee !== undefined) {
          pos.reservedExitFee = this._sanitizeNumber(pos.reservedExitFee, 0);
        }
        
        return true;
        
      } catch (error) {
        console.error(`[State] Error sanitizing position ${idx}:`, error);
        return false;
      }
    });
  }

  /**
   * ✅ FIXED: Sanitize trades array
   */
  _sanitizeTrades(trades) {
    if (!Array.isArray(trades)) {
      console.warn('[State] Trades not an array, returning empty array');
      return [];
    }
    
    return trades.filter((trade, idx) => {
      try {
        if (!trade || typeof trade !== 'object') return false;
        
        // Validate required fields
        if (!trade.symbol || typeof trade.symbol !== 'string') return false;
        if (!this._isValidNumber(trade.price) || trade.price <= 0) return false;
        if (!this._isValidNumber(trade.quantity) || trade.quantity <= 0) return false;
        
        // Sanitize numeric fields
        if (trade.fee !== undefined) {
          trade.fee = this._sanitizeNumber(trade.fee, 0);
        }
        
        if (trade.pnl !== undefined && trade.pnl !== null) {
          if (!this._isValidNumber(trade.pnl)) {
            trade.pnl = undefined;
          }
        }
        
        if (trade.leverage !== undefined) {
          trade.leverage = this._sanitizeNumber(trade.leverage, 1);
        }
        
        return true;
      } catch (error) {
        console.error(`[State] Error sanitizing trade ${idx}:`, error);
        return false;
      }
    });
  }

  /**
   * ✅ FIXED: Sanitize orders array
   */
  _sanitizeOrders(orders) {
    if (!Array.isArray(orders)) {
      console.warn('[State] Orders not an array, returning empty array');
      return [];
    }
    
    return orders.filter((order, idx) => {
      try {
        if (!order || typeof order !== 'object') return false;
        
        // Validate required fields
        if (!order.symbol || typeof order.symbol !== 'string') return false;
        if (!this._isValidNumber(order.quantity) || order.quantity <= 0) return false;
        
        // Sanitize numeric fields
        if (order.price !== undefined && order.price !== null) {
          if (!this._isValidNumber(order.price)) {
            order.price = null;
          }
        }
        
        if (order.stopLoss !== undefined && order.stopLoss !== null) {
          if (!this._isValidNumber(order.stopLoss)) {
            order.stopLoss = null;
          }
        }
        
        if (order.takeProfit !== undefined && order.takeProfit !== null) {
          if (!this._isValidNumber(order.takeProfit)) {
            order.takeProfit = null;
          }
        }
        
        return true;
      } catch (error) {
        console.error(`[State] Error sanitizing order ${idx}:`, error);
        return false;
      }
    });
  }

  /**
   * ✅ FIXED: Helper to validate numbers
   */
  _isValidNumber(value) {
    return typeof value === 'number' && isFinite(value) && !isNaN(value);
  }

  /**
   * ✅ FIXED: Rollback to safe state on hydration failure
   */
  _rollbackToSafeState() {
    console.warn('[State] Rolling back to safe default state');
    
    this.balance = this.options.initialBalance || 10000;
    this.initialBalance = this.options.initialBalance || 10000;
    this.positions = [];
    this.trades = [];
    this.pendingOrders = [];
    this.orderHistory = [];
    this.lastPrices = {};
    this._missingPriceWarnings.clear();
  }

  reset() {
    this.balance = this.initialBalance;
    this.positions = [];
    this.trades = [];
    this.pendingOrders = [];
    this.orderHistory = [];
    this._missingPriceWarnings.clear();
    
    // ✅ Reset hydration tracking
    this._lastHydrationSuccess = true;
    this._lastHydrationErrors = [];
  }

  setLastPrice(symbol, price) {
    if (!symbol) return;
    
    // Validate price
    if (typeof price !== 'number' || !isFinite(price) || isNaN(price) || price <= 0) {
      console.warn(`[State] Invalid price for ${symbol}:`, price);
      return;
    }
    
    this.lastPrices[symbol.toUpperCase()] = price;
    
    // Clear missing price warning if price is now available
    this._missingPriceWarnings.delete(symbol.toUpperCase());
  }

  // FIXED #10: Safe price retrieval with validation
  getLastPrice(symbol) {
    if (!symbol) {
      console.warn('[State] getLastPrice called with null/undefined symbol');
      return null;
    }
    
    const key = symbol.toUpperCase();
    const price = this.lastPrices[key];
    
    // Validate price
    if (price === undefined || price === null) {
      // Only warn once per symbol to avoid spam
      if (!this._missingPriceWarnings.has(key)) {
        console.warn(`[State] No price data available for ${key}`);
        this._missingPriceWarnings.add(key);
      }
      return null;
    }
    
    if (typeof price !== 'number' || !isFinite(price) || isNaN(price)) {
      console.error(`[State] Invalid price data for ${key}:`, price);
      return null;
    }
    
    if (price <= 0) {
      console.error(`[State] Invalid price value for ${key}: ${price}`);
      return null;
    }
    
    return price;
  }

  getPerformanceMetrics() {
    return computeMetrics(this);
  }

  // FIXED #10: Safe margin calculation with comprehensive validation
  getTotalMarginUsed() {
    if (!Array.isArray(this.positions)) {
      console.error('[State] Invalid positions array');
      return 0;
    }

    return this.positions.reduce((sum, pos) => {
      try {
        // Validate position data
        if (!pos || typeof pos !== 'object') {
          console.warn('[State] Invalid position object:', pos);
          return sum;
        }

        const entry = pos.entryPrice;
        const qty = pos.quantity;
        const lev = pos.leverage || this.options.maxLeverage || 1;

        // Validate all components
        if (typeof entry !== 'number' || !isFinite(entry) || isNaN(entry) || entry <= 0) {
          console.warn(`[State] Invalid entry price for ${pos.symbol}:`, entry);
          return sum;
        }

        if (typeof qty !== 'number' || !isFinite(qty) || isNaN(qty) || qty <= 0) {
          console.warn(`[State] Invalid quantity for ${pos.symbol}:`, qty);
          return sum;
        }

        if (typeof lev !== 'number' || !isFinite(lev) || isNaN(lev) || lev < 1) {
          console.warn(`[State] Invalid leverage for ${pos.symbol}:`, lev);
          return sum;
        }

        const margin = (entry * qty) / lev;

        // Validate result
        if (!isFinite(margin) || isNaN(margin)) {
          console.error(`[State] Invalid margin calculation for ${pos.symbol}:`, {
            entry, qty, lev, margin
          });
          return sum;
        }

        return sum + margin;
      } catch (error) {
        console.error('[State] Error calculating margin for position:', error, pos);
        return sum;
      }
    }, 0);
  }

  // ✅ FIXED: Proper equity calculation including spot asset values
  getEquity() {
    try {
      // Validate balance
      if (typeof this.balance !== 'number' || !isFinite(this.balance) || isNaN(this.balance)) {
        console.error('[State] Invalid balance:', this.balance);
        return 0;
      }

      let eq = this.balance;

      if (!Array.isArray(this.positions)) {
        console.error('[State] Invalid positions array');
        return Math.max(0, eq);
      }

      // Calculate unrealized P&L for all positions
      for (const pos of this.positions) {
        try {
          // Validate position
          if (!pos || typeof pos !== 'object') {
            console.warn('[State] Invalid position object:', pos);
            continue;
          }

          const symbol = pos.symbol;
          const side = pos.side;
          const entryPrice = pos.entryPrice;
          const quantity = pos.quantity;
          const tradeType = pos.tradeType || 'spot';

          // Validate position data
          if (!symbol) {
            console.warn('[State] Position missing symbol:', pos);
            continue;
          }

          if (typeof entryPrice !== 'number' || !isFinite(entryPrice) || isNaN(entryPrice) || entryPrice <= 0) {
            console.warn(`[State] Invalid entry price for ${symbol}:`, entryPrice);
            continue;
          }

          if (typeof quantity !== 'number' || !isFinite(quantity) || isNaN(quantity) || quantity <= 0) {
            console.warn(`[State] Invalid quantity for ${symbol}:`, quantity);
            continue;
          }

          if (side !== 'buy' && side !== 'sell') {
            console.warn(`[State] Invalid side for ${symbol}:`, side);
            continue;
          }

          // ✅ FIXED: Safe price retrieval with null check
          const currentPrice = this.getLastPrice(symbol);
          
          // If no current price available, use entry price for spot (asset still has value)
          if (currentPrice === null || currentPrice === undefined) {
            console.warn(`[State] Using entry price for ${symbol} - no current price available`);
            // For spot, add back position value at entry price
            if (tradeType === 'spot' && side === 'buy') {
              eq += entryPrice * quantity;
            }
            continue;
          }

          // Validate current price
          if (typeof currentPrice !== 'number' || !isFinite(currentPrice) || isNaN(currentPrice) || currentPrice <= 0) {
            console.error(`[State] Invalid current price for ${symbol}:`, currentPrice);
            continue;
          }

          // ✅ FIXED: Calculate equity based on trade type
          if (tradeType === 'spot') {
            // For spot positions, equity includes the current market value of the asset
            if (side === 'buy') {
              // Add current value of holdings
              // Balance already reduced by (cost + fee), so we add back the asset value
              eq += currentPrice * quantity;
            } else {
              // For short spot (shouldn't happen normally, but handle it)
              eq += (entryPrice - currentPrice) * quantity;
            }
          } else {
            // For margin positions, only unrealized P&L affects equity (margin already in balance)
            let pnl = 0;
            if (side === 'buy') {
              pnl = (currentPrice - entryPrice) * quantity;
            } else {
              pnl = (entryPrice - currentPrice) * quantity;
            }

            // Validate P&L calculation
            if (!isFinite(pnl) || isNaN(pnl)) {
              console.error(`[State] Invalid P&L calculation for ${symbol}:`, {
                side, currentPrice, entryPrice, quantity, pnl
              });
              continue;
            }

            eq += pnl;

            // Log large P&L changes for monitoring
            if (Math.abs(pnl) > this.balance * 0.5) {
              console.warn(`[State] Large P&L detected for ${symbol}: ${pnl.toFixed(2)}`);
            }
          }

        } catch (error) {
          console.error('[State] Error calculating equity for position:', error, pos);
          // Continue processing other positions
        }
      }

      // Validate final equity
      if (!isFinite(eq) || isNaN(eq)) {
        console.error('[State] Invalid equity calculation result:', eq);
        return 0;
      }

      // Clamp negative equity to zero for display/safety
      return Math.max(0, eq);

    } catch (error) {
      console.error('[State] Critical error in getEquity:', error);
      // Return balance as fallback
      return Math.max(0, this.balance || 0);
    }
  }

  // Get equity without clamping (for internal calculations)
  getRawEquity() {
    try {
      let eq = this.balance;

      if (!Array.isArray(this.positions)) {
        return eq;
      }

      for (const pos of this.positions) {
        const currentPrice = this.getLastPrice(pos.symbol);
        if (currentPrice === null) {
          // For spot, use entry price as fallback
          if (pos.tradeType === 'spot' && pos.side === 'buy') {
            eq += pos.entryPrice * pos.quantity;
          }
          continue;
        }

        const entryPrice = pos.entryPrice || 0;
        const quantity = pos.quantity || 0;
        const tradeType = pos.tradeType || 'spot';

        if (tradeType === 'spot') {
          if (pos.side === 'buy') {
            eq += currentPrice * quantity;
          } else {
            eq += (entryPrice - currentPrice) * quantity;
          }
        } else {
          if (pos.side === 'buy') {
            eq += (currentPrice - entryPrice) * quantity;
          } else {
            eq += (entryPrice - currentPrice) * quantity;
          }
        }
      }

      return eq;
    } catch (error) {
      console.error('[State] Error in getRawEquity:', error);
      return this.balance || 0;
    }
  }

  // ✅ ENHANCED: Validate state integrity with detailed checks
  validateState() {
    const issues = [];

    // Check balance
    if (typeof this.balance !== 'number' || !isFinite(this.balance) || isNaN(this.balance)) {
      issues.push(`Invalid balance: ${this.balance}`);
    }

    // Check initialBalance
    if (typeof this.initialBalance !== 'number' || !isFinite(this.initialBalance) || isNaN(this.initialBalance)) {
      issues.push(`Invalid initialBalance: ${this.initialBalance}`);
    }

    // Check positions
    if (!Array.isArray(this.positions)) {
      issues.push('Positions is not an array');
    } else {
      this.positions.forEach((pos, idx) => {
        if (!pos.symbol) issues.push(`Position ${idx}: missing symbol`);
        if (typeof pos.entryPrice !== 'number') issues.push(`Position ${idx}: invalid entry price`);
        if (typeof pos.quantity !== 'number') issues.push(`Position ${idx}: invalid quantity`);
        if (pos.side !== 'buy' && pos.side !== 'sell') issues.push(`Position ${idx}: invalid side`);
        
        // Check for negative values
        if (pos.entryPrice <= 0) issues.push(`Position ${idx}: negative or zero entry price`);
        if (pos.quantity <= 0) issues.push(`Position ${idx}: negative or zero quantity`);
      });
    }

    // Check trades
    if (!Array.isArray(this.trades)) {
      issues.push('Trades is not an array');
    }

    // Check pending orders
    if (!Array.isArray(this.pendingOrders)) {
      issues.push('Pending orders is not an array');
    }

    // Check for data consistency
    const totalMargin = this.getTotalMarginUsed();
    const equity = this.getEquity();
    
    if (totalMargin > equity * 2) {
      issues.push(`Margin (${totalMargin.toFixed(2)}) significantly exceeds equity (${equity.toFixed(2)})`);
    }

    return {
      valid: issues.length === 0,
      issues,
      severity: issues.length === 0 ? 'none' : issues.length < 3 ? 'low' : 'high'
    };
  }

  // ✅ NEW: Get comprehensive diagnostic information
  getDiagnostics() {
    const validation = this.validateState();
    
    return {
      balance: this.balance,
      initialBalance: this.initialBalance,
      positionCount: this.positions?.length || 0,
      tradeCount: this.trades?.length || 0,
      pendingOrderCount: this.pendingOrders?.length || 0,
      priceDataCount: Object.keys(this.lastPrices).length,
      missingPriceWarnings: Array.from(this._missingPriceWarnings),
      equity: this.getEquity(),
      rawEquity: this.getRawEquity(),
      marginUsed: this.getTotalMarginUsed(),
      validation,
      hydration: {
        attempts: this._hydrationAttempts,
        lastSuccess: this._lastHydrationSuccess,
        lastErrors: this._lastHydrationErrors
      },
      health: {
        balanceValid: this._isValidNumber(this.balance),
        hasPositions: this.positions.length > 0,
        hasTrades: this.trades.length > 0,
        allPricesAvailable: this.positions.every(p => this.getLastPrice(p.symbol) !== null)
      }
    };
  }

  // ✅ NEW: Export state with validation report
  exportWithValidation() {
    const validation = this.validateState();
    const diagnostics = this.getDiagnostics();
    
    return {
      state: this.serialize(),
      validation,
      diagnostics,
      exportedAt: new Date().toISOString(),
      exportedBy: 'PaperTrader v1.0'
    };
  }

  // ✅ NEW: Get hydration report
  getHydrationReport() {
    return {
      totalAttempts: this._hydrationAttempts,
      lastAttemptSuccess: this._lastHydrationSuccess,
      lastErrors: this._lastHydrationErrors,
      currentStateValid: this.validateState().valid
    };
  }
}