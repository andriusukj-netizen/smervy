// paper-trader/order-manager.js
// FIXED: Comprehensive error boundaries for all async operations
// FIXED: Race condition in periodic order processing ✅
// FIXED: Debounced price updates to prevent duplicate order execution ✅
// FIXED: Per-order execution tracking to prevent double-fills ✅
// FIXED: Margin validation no longer double-counts exit fee
// UPDATED: Support for reserved exit fees in position tracking

import { uid } from './utils.js';

class AsyncLock {
  constructor() {
    this.locks = new Map();
  }

  async acquire(key) {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    let release;
    const lockPromise = new Promise(resolve => {
      release = resolve;
    });
    
    this.locks.set(key, lockPromise);
    
    return () => {
      this.locks.delete(key);
      release();
    };
  }

  isLocked(key) {
    return this.locks.has(key);
  }

  clear() {
    this.locks.clear();
  }
}

// FIXED: Debounce utility to prevent rapid duplicate calls
function debounce(fn, delay = 100) {
  let timer;
  const debounced = function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  debounced.flush = function(...args) {
    clearTimeout(timer);
    fn.apply(this, args);
  };
  debounced.pending = () => !!timer;
  return debounced;
}

export default class OrderManager {
  constructor(state, executor, notifications) {
    this.state = state;
    this.executor = executor;
    this.notifications = notifications;
    this._lock = new AsyncLock();
    this._processingLock = new AsyncLock();
    this._isProcessing = false;
    this._destroyed = false;
    
    // FIXED: Track which orders are currently being executed
    this._executingOrders = new Set(); // Set of order IDs
    
    // FIXED: Track recently executed orders to prevent double-execution
    this._recentlyExecuted = new Map(); // orderId -> timestamp
    this._executionWindow = 1000; // 1 second window to prevent duplicates
    
    // FIXED: Debounced price update handler
    this._debouncedPriceUpdate = debounce(
      this._processPriceUpdateBatch.bind(this),
      50 // 50ms debounce - balance between responsiveness and safety
    );
    
    // FIXED: Queue for price updates during debounce
    this._priceUpdateQueue = new Map(); // symbol -> price
    
    // FIXED: Wrap interval callback with error boundary and race condition prevention
    this._interval = setInterval(() => {
      if (!this._isProcessing) {
        this._processAllPendingOrders().catch(error => {
          console.error('[OrderManager] Periodic processing failed:', error);
          this.notifications.error(`Background order processing error: ${error.message}`);
        });
      }
    }, 500);

    // FIXED: Add global unhandled rejection handler for this instance
    this._setupGlobalErrorHandler();
    
    // FIXED: Cleanup old execution records periodically
    this._cleanupInterval = setInterval(() => {
      this._cleanupExecutionHistory();
    }, 5000); // Clean every 5 seconds
  }

  /**
   * FIXED: Set up global error handler for unhandled rejections
   */
  _setupGlobalErrorHandler() {
    this._unhandledRejectionHandler = (event) => {
      // Check if error is from our module
      if (event.reason && event.reason.stack && 
          event.reason.stack.includes('OrderManager')) {
        console.error('[OrderManager] Unhandled rejection caught:', event.reason);
        this.notifications.error(`Unhandled error: ${event.reason.message || event.reason}`);
        event.preventDefault(); // Prevent default browser error
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', this._unhandledRejectionHandler);
    }
  }

  /**
   * FIXED: Wrap async operations with consistent error handling
   */
  async _safeAsync(operation, context = 'operation') {
    try {
      return await operation();
    } catch (error) {
      console.error(`[OrderManager] ${context} failed:`, error);
      
      // Log stack trace for debugging
      if (error.stack) {
        console.error(error.stack);
      }
      
      // Re-throw to let caller handle if needed
      throw error;
    }
  }

  /**
   * FIXED: Check if an order was recently executed
   */
  _wasRecentlyExecuted(orderId) {
    if (!this._recentlyExecuted.has(orderId)) {
      return false;
    }
    
    const executionTime = this._recentlyExecuted.get(orderId);
    const age = Date.now() - executionTime;
    
    // If execution was within window, it's a duplicate
    if (age < this._executionWindow) {
      console.warn('[OrderManager] Prevented duplicate execution:', {
        orderId,
        ageMs: age,
        window: this._executionWindow
      });
      return true;
    }
    
    // Old execution record, can be removed
    this._recentlyExecuted.delete(orderId);
    return false;
  }

  /**
   * FIXED: Mark an order as executed
   */
  _markAsExecuted(orderId) {
    this._recentlyExecuted.set(orderId, Date.now());
    
    // Log if too many recent executions (possible issue)
    if (this._recentlyExecuted.size > 100) {
      console.warn('[OrderManager] High number of recent executions:', this._recentlyExecuted.size);
    }
  }

  /**
   * FIXED: Clean up old execution records
   */
  _cleanupExecutionHistory() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [orderId, timestamp] of this._recentlyExecuted.entries()) {
      if (now - timestamp > this._executionWindow * 2) {
        this._recentlyExecuted.delete(orderId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[OrderManager] Cleaned ${cleaned} old execution record(s)`);
    }
  }

  async placeOrder(order) {
    return this._safeAsync(async () => {
      const normalized = this._normalizeOrder(order);
      
      if (!normalized.quantity || normalized.quantity <= 0) {
        throw new Error('Invalid quantity');
      }

      // Non-market orders go to pending queue
      if (normalized.type !== 'MARKET') {
        normalized.status = 'pending';
        normalized.stopPrice = normalized.price;
        this.state.pendingOrders.push(normalized);
        this.notifications.info(
          `${normalized.type} order placed for ${normalized.symbol} @ ${normalized.price}`
        );
        return normalized;
      }

      // Market orders execute immediately
      const lastPrice = this.state.getLastPrice(normalized.symbol);
      if (!lastPrice) {
        throw new Error('No price data for ' + normalized.symbol);
      }

      let execPrice = lastPrice;
      if (this.executor.options.slippageEnabled) {
        execPrice = this.executor.applySlippage(execPrice, normalized.side, normalized.quantity);
      }

      this._validateMarketOrder(normalized, execPrice);

      const symbolKey = normalized.symbol.toUpperCase();
      const release = await this._lock.acquire(symbolKey);
      
      try {
        const trade = await this.executor.executeMarket(normalized, execPrice);
        this._updatePositionsAfterTrade(normalized, trade);
        return trade;
      } finally {
        release();
      }
    }, 'placeOrder').catch(error => {
      // Surface error to user
      this.notifications.error(`Order failed: ${error.message}`);
      throw error; // Re-throw for caller
    });
  }

  _normalizeOrder(o) {
    try {
      const maxLev = this.executor.options.maxLeverage || 1;
      let lev = typeof o.leverage === 'number' ? o.leverage : parseInt(o.leverage) || 1;
      lev = Math.max(1, Math.min(lev, maxLev));
      
      let trailingStop = null;
      if (o.trailingStop && typeof o.trailingStop === 'object' && o.trailingStop.value) {
        trailingStop = o.trailingStop;
      } else if (typeof o.trailingStop === 'string') {
        const m = o.trailingStop.match(/(\d+(\.\d+)?)(%)?$/);
        if (m) {
          trailingStop = { type: m[3] ? 'percent' : 'absolute', value: parseFloat(m[1]) };
        }
      }
      
      return {
        id: o.id || uid(),
        symbol: (o.symbol || 'BTCUSDT').toUpperCase(),
        side: (o.side || 'buy').toLowerCase(),
        type: (o.type || 'MARKET').toUpperCase(),
        price: o.price ? parseFloat(o.price) : null,
        quantity: parseFloat(o.quantity || 0),
        stopLoss: o.stopLoss ? parseFloat(o.stopLoss) : null,
        takeProfit: o.takeProfit ? parseFloat(o.takeProfit) : null,
        trailingStop,
        timestamp: Date.now(),
        raw: o,
        tags: Array.isArray(o.tags) ? o.tags : [],
        note: typeof o.note === 'string' ? o.note : "",
        leverage: lev,
        tradeType: o.tradeType || 'spot'
      };
    } catch (error) {
      console.error('[OrderManager] Order normalization failed:', error);
      throw new Error(`Invalid order parameters: ${error.message}`);
    }
  }

  _validateMarketOrder(order, execPrice) {
    try {
      const cost = execPrice * order.quantity;
      const entryFee = cost * (this.executor.options.feeRate || 0.001);

      if (
        order.tradeType === 'margin' &&
        this.executor.options.leverageSimulation &&
        order.leverage > 1
      ) {
        const lev = order.leverage;
        const marginRequired = (execPrice * order.quantity) / lev;
        const immediateRequired = marginRequired + entryFee;
        
        if (this.state.balance < immediateRequired) {
          throw new Error(
            `Insufficient balance. Required: $${immediateRequired.toFixed(2)} ` +
            `(Margin: $${marginRequired.toFixed(2)} + Entry Fee: $${entryFee.toFixed(2)}), ` +
            `Available: $${this.state.balance.toFixed(2)}\n` +
            `Note: Exit fee will be reserved from remaining balance.`
          );
        }
        
        const exitFee = cost * (this.executor.options.feeRate || 0.001);
        const totalRequired = immediateRequired + exitFee;
        
        if (this.state.balance < totalRequired) {
          throw new Error(
            `Insufficient balance for full position (including exit fee reservation).\n` +
            `Required: $${totalRequired.toFixed(2)} ` +
            `(Margin: $${marginRequired.toFixed(2)} + Entry Fee: $${entryFee.toFixed(2)} + ` +
            `Exit Fee Reserve: $${exitFee.toFixed(2)})\n` +
            `Available: $${this.state.balance.toFixed(2)}\n` +
            `Reduce leverage or quantity.`
          );
        }
        
        const totalMargin = this.state.getTotalMarginUsed() + marginRequired;
        const equity = this.state.getEquity();
        
        if (totalMargin > equity) {
          throw new Error(
            `Insufficient equity for leveraged position.\n` +
            `New margin required: $${marginRequired.toFixed(2)}\n` +
            `Total margin after: $${totalMargin.toFixed(2)}\n` +
            `Current equity: $${equity.toFixed(2)}\n` +
            `Close some positions or reduce leverage.`
          );
        }
        
        console.log('[OrderManager] Margin validation passed:', {
          marginRequired: marginRequired.toFixed(2),
          entryFee: entryFee.toFixed(2),
          exitFeeToReserve: exitFee.toFixed(2),
          totalRequired: totalRequired.toFixed(2),
          availableBalance: this.state.balance.toFixed(2),
          remainingAfter: (this.state.balance - totalRequired).toFixed(2)
        });
      }

      if (
        order.tradeType === 'spot' &&
        order.side === 'buy' &&
        (cost + entryFee) > this.state.balance
      ) {
        throw new Error(
          `Insufficient balance for spot trade.\n` +
          `Required: $${(cost + entryFee).toFixed(2)}\n` +
          `Available: $${this.state.balance.toFixed(2)}`
        );
      }
    } catch (error) {
      // Add context to validation errors
      if (!error.message.includes('Insufficient')) {
        throw new Error(`Order validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  _updatePositionsAfterTrade(order, trade) {
    try {
      const existing = this.state.positions.find(p => p.symbol === order.symbol);

      if (!existing) {
        this.state.positions.push({
          id: trade.id,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          entryPrice: trade.price,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          trailingStop: order.trailingStop ? {
            ...order.trailingStop,
            distance: this._computeTrailingDistance(order.trailingStop, trade.price),
            anchor: trade.price
          } : null,
          timestamp: trade.timestamp,
          leverage: order.leverage,
          tradeType: order.tradeType,
          reservedExitFee: trade.reservedExitFee || 0
        });
        
        console.log('[OrderManager] New position opened:', {
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          entryPrice: trade.price.toFixed(2),
          leverage: order.leverage,
          reservedExitFee: (trade.reservedExitFee || 0).toFixed(2)
        });
        
        return;
      }

      if (existing.side === order.side) {
        const existingValue = existing.entryPrice * existing.quantity;
        const newValue = trade.price * order.quantity;
        const totalQty = existing.quantity + order.quantity;
        const totalValue = existingValue + newValue;

        existing.entryPrice = totalValue / totalQty;
        existing.quantity = totalQty;

        if (order.tradeType === 'margin') {
          const existingMargin = existingValue / existing.leverage;
          const newMargin = newValue / order.leverage;
          const totalMargin = existingMargin + newMargin;
          
          existing.leverage = totalValue / totalMargin;
          
          const maxLev = this.executor.options.maxLeverage || 1;
          existing.leverage = Math.min(existing.leverage, maxLev);
          existing.leverage = Math.round(existing.leverage * 100) / 100;
        }

        if (trade.reservedExitFee) {
          existing.reservedExitFee = (existing.reservedExitFee || 0) + trade.reservedExitFee;
        }

        if (order.stopLoss) existing.stopLoss = order.stopLoss;
        if (order.takeProfit) existing.takeProfit = order.takeProfit;

        if (order.trailingStop) {
          existing.trailingStop = {
            ...order.trailingStop,
            distance: this._computeTrailingDistance(order.trailingStop, existing.entryPrice),
            anchor: existing.entryPrice
          };
        } else if (existing.trailingStop) {
          existing.trailingStop.distance = this._computeTrailingDistance(
            existing.trailingStop,
            existing.entryPrice
          );
          const currentPrice = this.state.getLastPrice(existing.symbol) || existing.entryPrice;
          if (existing.side === 'buy') {
            existing.trailingStop.anchor = Math.max(existing.trailingStop.anchor, currentPrice);
          } else {
            existing.trailingStop.anchor = Math.min(existing.trailingStop.anchor, currentPrice);
          }
        }

        console.log('[OrderManager] Position merged:', {
          symbol: existing.symbol,
          totalQty: existing.quantity,
          avgEntry: existing.entryPrice.toFixed(2),
          weightedLeverage: existing.leverage,
          totalReservedExitFee: (existing.reservedExitFee || 0).toFixed(2)
        });

      } else {
        if (order.quantity >= existing.quantity) {
          const pnl = this._calcPnL(existing, trade.price);
          trade.pnl = pnl;

          this.state.positions = this.state.positions.filter(p => p.id !== existing.id);
          
          const netPnL = pnl;
          const releasedFee = existing.reservedExitFee || 0;
          
          this.notifications.info(
            `Position closed: ${existing.symbol}\n` +
            `P&L: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}\n` +
            `Reserved exit fee released: $${releasedFee.toFixed(2)}`
          );

          if (order.quantity > existing.quantity) {
            const remainingQty = order.quantity - existing.quantity;
            this.state.positions.push({
              id: trade.id + '_rev',
              symbol: order.symbol,
              side: order.side,
              quantity: remainingQty,
              entryPrice: trade.price,
              stopLoss: order.stopLoss,
              takeProfit: order.takeProfit,
              trailingStop: order.trailingStop ? {
                ...order.trailingStop,
                distance: this._computeTrailingDistance(order.trailingStop, trade.price),
                anchor: trade.price
              } : null,
              timestamp: Date.now(),
              leverage: order.leverage,
              tradeType: order.tradeType,
              reservedExitFee: trade.reservedExitFee || 0
            });
            
            console.log('[OrderManager] Reversed position:', {
              symbol: order.symbol,
              newSide: order.side,
              quantity: remainingQty,
              entryPrice: trade.price.toFixed(2)
            });
          }
        } else {
          const closedQty = order.quantity;
          const pnl = (existing.side === 'buy') 
            ? (trade.price - existing.entryPrice) * closedQty 
            : (existing.entryPrice - trade.price) * closedQty;

          trade.pnl = pnl;
          existing.quantity -= closedQty;
          
          if (existing.reservedExitFee) {
            const totalQty = existing.quantity + closedQty;
            const proportion = closedQty / totalQty;
            const releasedFee = existing.reservedExitFee * proportion;
            existing.reservedExitFee -= releasedFee;
            
            console.log('[OrderManager] Partial close fee release:', {
              symbol: existing.symbol,
              closedQty,
              remainingQty: existing.quantity,
              proportion: (proportion * 100).toFixed(1) + '%',
              releasedFee: releasedFee.toFixed(2),
              remainingReservedFee: existing.reservedExitFee.toFixed(2)
            });
          }
          
          if (existing.trailingStop) {
            existing.trailingStop.distance = this._computeTrailingDistance(
              existing.trailingStop,
              existing.entryPrice
            );
          }

          this.notifications.info(
            `Partial close: ${existing.symbol}\n` +
            `Closed: ${closedQty}/${closedQty + existing.quantity}\n` +
            `P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
          );
        }
      }
    } catch (error) {
      console.error('[OrderManager] Position update failed:', error);
      throw new Error(`Failed to update positions: ${error.message}`);
    }
  }

  _calcPnL(pos, price) {
    if (pos.side === 'buy') {
      return (price - pos.entryPrice) * pos.quantity;
    }
    return (pos.entryPrice - price) * pos.quantity;
  }

  _computeTrailingDistance(ts, price) {
    if (!ts) return 0;
    if (ts.type === 'percent') {
      return price * (ts.value / 100);
    }
    return ts.value;
  }

  /**
   * FIXED: Debounced price update handler - queues updates and processes in batch
   */
  async onPriceUpdate(symbol, price) {
    // Quick validation
    if (this._destroyed) return;
    if (!symbol || typeof price !== 'number' || isNaN(price)) {
      console.warn('[OrderManager] Invalid price update:', { symbol, price });
      return;
    }

    const symbolKey = symbol.toUpperCase();
    
    // FIXED: Add to queue instead of processing immediately
    this._priceUpdateQueue.set(symbolKey, price);
    
    // Trigger debounced batch processing
    this._debouncedPriceUpdate();
  }

  /**
   * FIXED: Process batched price updates to prevent race conditions
   */
  async _processPriceUpdateBatch() {
    if (this._destroyed || this._priceUpdateQueue.size === 0) return;
    
    // Take snapshot of queue and clear it
    const updates = new Map(this._priceUpdateQueue);
    this._priceUpdateQueue.clear();
    
    console.log(`[OrderManager] Processing ${updates.size} price update(s)`);
    
    // Process each symbol's price update
    for (const [symbolKey, price] of updates) {
      // Skip if already locked (another process is handling this symbol)
      if (this._lock.isLocked(symbolKey)) {
        console.log(`[OrderManager] Skipping ${symbolKey} - already processing`);
        continue;
      }

      const release = await this._lock.acquire(symbolKey);

      try {
        await this._handlePriceUpdate(symbolKey, price);
      } catch (error) {
        console.error(`[OrderManager] Price update failed for ${symbolKey}:`, error);
        this.notifications.error(`Price update error for ${symbolKey}: ${error.message}`);
      } finally {
        release();
      }
    }
  }

  /**
   * FIXED: Separated logic with proper error handling
   */
  async _handlePriceUpdate(symbolKey, price) {
    // Process pending orders
    const toExecute = [];
    for (const order of this.state.pendingOrders) {
      if (order.status !== 'pending' || order.symbol.toUpperCase() !== symbolKey) {
        continue;
      }
      
      // FIXED: Skip if order is already being executed
      if (this._executingOrders.has(order.id)) {
        console.log(`[OrderManager] Order ${order.id} already executing, skipping`);
        continue;
      }
      
      // FIXED: Skip if order was recently executed
      if (this._wasRecentlyExecuted(order.id)) {
        continue;
      }

      let shouldTrigger = false;

      if (order.type === 'LIMIT') {
        shouldTrigger = (order.side === 'buy' && price <= order.stopPrice) || 
                        (order.side === 'sell' && price >= order.stopPrice);
      } else if (order.type === 'STOP_MARKET') {
        shouldTrigger = (order.side === 'buy' && price >= order.stopPrice) || 
                        (order.side === 'sell' && price <= order.stopPrice);
      } else if (order.type === 'TAKE_PROFIT_MARKET') {
        shouldTrigger = (order.side === 'buy' && price <= order.stopPrice) || 
                        (order.side === 'sell' && price >= order.stopPrice);
      }

      if (shouldTrigger) {
        toExecute.push(order);
      }
    }

    // Execute triggered orders with individual error handling
    for (const order of toExecute) {
      // FIXED: Mark as executing to prevent duplicates
      this._executingOrders.add(order.id);
      
      try {
        order.status = 'triggered';
        const execOrder = { ...order, type: 'MARKET' };
        let execPrice = price;

        if (this.executor.options.slippageEnabled) {
          execPrice = this.executor.applySlippage(execPrice, execOrder.side, execOrder.quantity);
        }

        const trade = await this.executor.executeMarket(execOrder, execPrice);
        this._updatePositionsAfterTrade(execOrder, trade);

        // FIXED: Mark as executed to prevent re-execution
        this._markAsExecuted(order.id);

        this.state.pendingOrders = this.state.pendingOrders.filter(o => o.id !== order.id);
        this.notifications.success(`${order.type} triggered for ${order.symbol} @ ${execPrice.toFixed(2)}`);
      } catch (err) {
        console.error('[OrderManager] Failed to execute triggered order:', err);
        this.notifications.error(`Order execution failed: ${err.message}`);
        order.status = 'failed';
        order.errorMessage = err.message;
      } finally {
        // FIXED: Remove from executing set
        this._executingOrders.delete(order.id);
      }
    }

    // Process positions (SL/TP/Trailing)
    await this._processPositions(symbolKey, price);

    // Check margin call
    await this._checkMarginCall();
  }

  /**
   * FIXED: Separated position processing with error handling
   */
  async _processPositions(symbolKey, price) {
    const positionsSnapshot = [...this.state.positions].filter(
      p => p.symbol.toUpperCase() === symbolKey
    );

    for (const pos of positionsSnapshot) {
      // Check if position still exists (might have been closed)
      if (!this.state.positions.find(p => p.id === pos.id)) {
        continue;
      }

      try {
        // Update trailing stop
        if (pos.trailingStop) {
          if (pos.side === 'buy') {
            pos.trailingStop.anchor = Math.max(
              pos.trailingStop.anchor || pos.entryPrice, 
              price
            );
            const newStop = pos.trailingStop.anchor - (pos.trailingStop.distance ?? 0);
            if (!pos.stopLoss || newStop > pos.stopLoss) {
              pos.stopLoss = newStop;
            }
          } else {
            pos.trailingStop.anchor = Math.min(
              pos.trailingStop.anchor || pos.entryPrice, 
              price
            );
            const newStop = pos.trailingStop.anchor + (pos.trailingStop.distance ?? 0);
            if (!pos.stopLoss || newStop < pos.stopLoss) {
              pos.stopLoss = newStop;
            }
          }
        }

        // Check stop loss
        if (pos.stopLoss) {
          const slTriggered = (pos.side === 'buy' && price <= pos.stopLoss) || 
                              (pos.side === 'sell' && price >= pos.stopLoss);
          
          if (slTriggered) {
            await this._executeStopLoss(pos, price);
            continue; // Skip take profit check
          }
        }

        // Check take profit
        if (pos.takeProfit) {
          const tpTriggered = (pos.side === 'buy' && price >= pos.takeProfit) || 
                              (pos.side === 'sell' && price <= pos.takeProfit);
          
          if (tpTriggered) {
            await this._executeTakeProfit(pos, price);
          }
        }
      } catch (error) {
        console.error(`[OrderManager] Position processing failed for ${pos.symbol}:`, error);
        this.notifications.error(`Position update failed: ${error.message}`);
      }
    }
  }

  /**
   * FIXED: Separate stop loss execution with error handling
   */
  async _executeStopLoss(pos, price) {
    try {
      const closeOrder = {
        id: uid(),
        symbol: pos.symbol,
        side: pos.side === 'buy' ? 'sell' : 'buy',
        type: 'MARKET',
        quantity: pos.quantity,
        leverage: pos.leverage,
        tradeType: pos.tradeType
      };
      
      const execPrice = this.executor.applySlippage(price, closeOrder.side, closeOrder.quantity);
      const pnl = this._calcPnL(pos, execPrice);

      await this.executor.executeMarket(closeOrder, execPrice, pnl);
      this.state.positions = this.state.positions.filter(p => p.id !== pos.id);
      
      this.notifications.error(
        `🛑 Stop Loss: ${pos.symbol} | P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`
      );
    } catch (err) {
      console.error('[OrderManager] Stop loss execution failed:', err);
      this.notifications.error(`Stop loss failed for ${pos.symbol}: ${err.message}`);
      throw err;
    }
  }

  /**
   * FIXED: Separate take profit execution with error handling
   */
  async _executeTakeProfit(pos, price) {
    try {
      const closeOrder = {
        id: uid(),
        symbol: pos.symbol,
        side: pos.side === 'buy' ? 'sell' : 'buy',
        type: 'MARKET',
        quantity: pos.quantity,
        leverage: pos.leverage,
        tradeType: pos.tradeType
      };
      
      const execPrice = this.executor.applySlippage(price, closeOrder.side, closeOrder.quantity);
      const pnl = this._calcPnL(pos, execPrice);

      await this.executor.executeMarket(closeOrder, execPrice, pnl);
      this.state.positions = this.state.positions.filter(p => p.id !== pos.id);
      
      this.notifications.success(
        `🎯 Take Profit: ${pos.symbol} | P&L: +${pnl.toFixed(2)}`
      );
    } catch (err) {
      console.error('[OrderManager] Take profit execution failed:', err);
      this.notifications.error(`Take profit failed for ${pos.symbol}: ${err.message}`);
      throw err;
    }
  }

  /**
   * FIXED: Separate margin call check with error handling
   */
  async _checkMarginCall() {
    if (!this.executor.options.leverageSimulation) return;

    try {
      const equity = this.state.getEquity();
      const marginUsed = this.state.getTotalMarginUsed();
      const maintRatio = this.executor.options.maintenanceMarginRatio || 0.5;
      const maintMargin = marginUsed * maintRatio;

      if (marginUsed > 0 && equity < maintMargin) {
        console.error('[OrderManager] Margin call triggered!', {
          equity: equity.toFixed(2),
          marginUsed: marginUsed.toFixed(2),
          maintMargin: maintMargin.toFixed(2)
        });
        
        await this.closeAll();
        
        this.notifications.error(
          `⚠️ MARGIN CALL! All positions liquidated. ` +
          `Equity (${equity.toFixed(2)}) < Maintenance Margin (${maintMargin.toFixed(2)})`
        );
      }
    } catch (error) {
      console.error('[OrderManager] Margin call check failed:', error);
      this.notifications.error(`Margin call check error: ${error.message}`);
    }
  }

  /**
   * FIXED: Process all pending orders with comprehensive error handling and race condition prevention
   */
  async _processAllPendingOrders() {
    if (this._destroyed) return;
    
    // FIXED: Prevent overlapping execution
    if (this._isProcessing) {
      console.log('[OrderManager] Already processing, skipping this cycle');
      return;
    }

    const processingRelease = await this._processingLock.acquire('processing');
    this._isProcessing = true;
    
    try {
      const symbolsWithOrders = new Set(
        this.state.pendingOrders
          .filter(o => o.status === 'pending')
          .map(o => o.symbol.toUpperCase())
      );

      for (const symbol of symbolsWithOrders) {
        if (this._lock.isLocked(symbol)) {
          console.log(`[OrderManager] Skipping ${symbol} - already processing`);
          continue;
        }

        const price = this.state.getLastPrice(symbol);
        if (!price) {
          console.log(`[OrderManager] No price data for ${symbol}`);
          continue;
        }

        const symbolRelease = await this._lock.acquire(symbol);
        
        try {
          await this._handlePriceUpdate(symbol, price);
        } catch (error) {
          console.error(`[OrderManager] Processing error for ${symbol}:`, error);
        } finally {
          symbolRelease();
        }
      }
      
    } catch (error) {
      console.error('[OrderManager] Critical error in _processAllPendingOrders:', error);
    } finally {
      this._isProcessing = false;
      processingRelease();
    }
  }

  async closePosition(positionId) {
    return this._safeAsync(async () => {
      const pos = this.state.positions.find(p => p.id === positionId);
      if (!pos) {
        throw new Error('Position not found');
      }

      const symbolKey = pos.symbol.toUpperCase();
      const release = await this._lock.acquire(symbolKey);

      try {
        const currentPos = this.state.positions.find(p => p.id === positionId);
        if (!currentPos) {
          throw new Error('Position was already closed');
        }

        const opposite = currentPos.side === 'buy' ? 'sell' : 'buy';
        const closeOrder = {
          id: uid(),
          symbol: currentPos.symbol,
          side: opposite,
          type: 'MARKET',
          quantity: currentPos.quantity,
          leverage: currentPos.leverage,
          tradeType: currentPos.tradeType
        };

        const price = this.state.getLastPrice(currentPos.symbol) || currentPos.entryPrice;
        const execPrice = this.executor.applySlippage(price, closeOrder.side, closeOrder.quantity);
        const pnl = this._calcPnL(currentPos, execPrice);

        const trade = await this.executor.executeMarket(closeOrder, execPrice, pnl);
        this.state.positions = this.state.positions.filter(p => p.id !== currentPos.id);
        
        return trade;
      } finally {
        release();
      }
    }, `closePosition(${positionId})`).catch(error => {
      this.notifications.error(`Close position failed: ${error.message}`);
      throw error;
    });
  }

  async closeAll() {
    return this._safeAsync(async () => {
      const toClose = [...this.state.positions];
      const results = [];
      
      console.log(`[OrderManager] Closing ${toClose.length} position(s)...`);
      
      for (const pos of toClose) {
        try {
          const trade = await this.closePosition(pos.id);
          results.push({ success: true, trade, positionId: pos.id });
        } catch (e) {
          console.warn('[OrderManager] closeAll failed for position:', pos.id, e);
          results.push({ success: false, error: e.message, positionId: pos.id });
        }
      }
      
      // Log summary
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`[OrderManager] Close all complete: ${successful} successful, ${failed} failed`);
      
      if (failed > 0) {
        this.notifications.warning(`Closed ${successful} positions, ${failed} failed`);
      }
      
      return results;
    }, 'closeAll').catch(error => {
      this.notifications.error(`Close all positions failed: ${error.message}`);
      throw error;
    });
  }

  /**
   * FIXED: Get diagnostics for race condition monitoring
   */
  getRaceConditionDiagnostics() {
    return {
      isProcessing: this._isProcessing,
      executingOrders: Array.from(this._executingOrders),
      recentlyExecutedCount: this._recentlyExecuted.size,
      queuedPriceUpdates: this._priceUpdateQueue.size,
      debouncePending: this._debouncedPriceUpdate.pending(),
      lockedSymbols: Array.from(this._lock.locks.keys()),
      executionWindow: this._executionWindow,
      health: {
        status: this._getHealthStatus(),
        recommendations: this._getHealthRecommendations()
      }
    };
  }

  /**
   * Get health status of order processing
   */
  _getHealthStatus() {
    const executingCount = this._executingOrders.size;
    const recentCount = this._recentlyExecuted.size;
    const queuedCount = this._priceUpdateQueue.size;
    
    if (executingCount > 10 || recentCount > 50 || queuedCount > 20) {
      return 'WARNING';
    }
    
    if (executingCount > 5 || recentCount > 20 || queuedCount > 10) {
      return 'CAUTION';
    }
    
    return 'GOOD';
  }

  /**
   * Get health recommendations
   */
  _getHealthRecommendations() {
    const recommendations = [];
    const status = this._getHealthStatus();
    
    if (status === 'WARNING') {
      recommendations.push('High order processing load detected');
      recommendations.push('Consider reducing trading frequency');
      
      if (this._executingOrders.size > 10) {
        recommendations.push('Too many concurrent order executions');
      }
      
      if (this._recentlyExecuted.size > 50) {
        recommendations.push('High recent execution count - possible rapid trading');
      }
      
      if (this._priceUpdateQueue.size > 20) {
        recommendations.push('Price update queue is backed up');
      }
    }
    
    return recommendations;
  }

  /**
   * FIXED: Proper cleanup with error handling
   */
  destroy() {
    console.log('[OrderManager] Destroying instance...');
    
    try {
      this._destroyed = true;
      
      // Clear interval
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
      
      // FIXED: Clear cleanup interval
      if (this._cleanupInterval) {
        clearInterval(this._cleanupInterval);
        this._cleanupInterval = null;
      }
      
      // FIXED: Cancel pending debounced operations
      if (this._debouncedPriceUpdate && this._debouncedPriceUpdate.cancel) {
        this._debouncedPriceUpdate.cancel();
      }
      
      // Clear locks
      this._lock.clear();
      this._processingLock.clear();
      
      // FIXED: Clear execution tracking
      this._executingOrders.clear();
      this._recentlyExecuted.clear();
      this._priceUpdateQueue.clear();
      
      // Remove global error handler
      if (this._unhandledRejectionHandler && typeof window !== 'undefined') {
        window.removeEventListener('unhandledrejection', this._unhandledRejectionHandler);
        this._unhandledRejectionHandler = null;
      }
      
      console.log('[OrderManager] Cleanup complete');
    } catch (error) {
      console.error('[OrderManager] Cleanup error:', error);
    }
  }
}