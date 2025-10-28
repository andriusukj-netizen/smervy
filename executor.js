// paper-trader/executor.js
// FIXED #4: Proper negative balance handling with debt tracking
// FIXED #9: Fee calculation precision with actual exit price tracking
// FIXED: Account integrity verification system

import { sanitizeText, sanitizeArray } from './sanitizer.js';

class MoneyMath {
  static PRECISION = 100;

  static round(value, precision = MoneyMath.PRECISION) {
    return Math.round(value * precision) / precision;
  }

  static add(a, b) {
    return MoneyMath.round(a + b);
  }

  static subtract(a, b) {
    return MoneyMath.round(a - b);
  }

  static multiply(a, b) {
    return MoneyMath.round(a * b);
  }

  static divide(a, b) {
    if (b === 0) throw new Error('Division by zero');
    return MoneyMath.round(a / b);
  }

  static equals(a, b, tolerance = 0.01) {
    return Math.abs(a - b) < tolerance;
  }

  static greaterThan(a, b, tolerance = 0.01) {
    return a > b + tolerance;
  }

  static lessThan(a, b, tolerance = 0.01) {
    return a < b - tolerance;
  }

  static sum(values) {
    return MoneyMath.round(values.reduce((sum, val) => sum + val, 0));
  }

  static percentage(value, percent) {
    return MoneyMath.round(value * (percent / 100));
  }

  static isValid(value) {
    return typeof value === 'number' && 
           isFinite(value) && 
           !isNaN(value);
  }

  static clamp(value, min = 0, max = Infinity) {
    return Math.max(min, Math.min(max, MoneyMath.round(value)));
  }
}

export default class Executor {
  constructor(options, state, notifications, hooks = {}) {
    this.options = options || {};
    this.state = state;
    this.notifications = notifications;
    this.hooks = hooks;
    
    this._roundingErrorAccumulator = 0;
    this._transactionCount = 0;
    
    // FIXED #4: Track account debt instead of silently resetting
    this._accountDebt = 0;
    this._debtTransactions = [];
    
    // FIXED #9: Track expected vs actual fees
    this._feeDiscrepancies = [];
    this._totalFeeDiscrepancy = 0;
  }

  applySlippage(price, side, quantity) {
    if (!this.options.slippageEnabled || !price) return price;
    
    const slippageBps = Math.min((quantity || 0) * 0.1, 20);
    const slippagePercent = slippageBps / 10000;
    
    if (side === 'buy') {
      return MoneyMath.multiply(price, 1 + slippagePercent);
    } else {
      return MoneyMath.multiply(price, 1 - slippagePercent);
    }
  }

  calculateFee(amount) {
    return MoneyMath.multiply(amount, this.options.feeRate ?? 0.001);
  }

  _emitEvent(name, detail) {
    let emitted = false;
    if (this.hooks && typeof this.hooks.emitEvent === 'function') {
      try { this.hooks.emitEvent(name, detail); emitted = true; } catch (e) {}
    }
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      try { document.dispatchEvent(new CustomEvent(name, { detail })); emitted = true; } catch (e) {}
    }
    if (!emitted) {
      console.warn(`[Executor] Failed to emit event: ${name}`, detail);
    }
  }

  _getPositionContext(order) {
    const existingPos = this.state.positions.find(p => p.symbol === order.symbol);
    if (!existingPos) return { isClosing: false, position: null };
    
    const isClosing = existingPos.side !== order.side;
    return { isClosing, position: existingPos };
  }

  _validateBalanceChange(before, after, expectedChange, context) {
    const actualChange = MoneyMath.subtract(after, before);
    const difference = Math.abs(actualChange - expectedChange);
    
    if (difference > 0.01) {
      console.warn(`[Executor] Balance calculation discrepancy in ${context}:`, {
        before: before.toFixed(2),
        after: after.toFixed(2),
        expectedChange: expectedChange.toFixed(2),
        actualChange: actualChange.toFixed(2),
        difference: difference.toFixed(4)
      });
      
      this._roundingErrorAccumulator += difference;
      
      if (Math.abs(this._roundingErrorAccumulator) > 1.00) {
        console.error(`[Executor] Cumulative rounding error exceeds $1.00: ${this._roundingErrorAccumulator.toFixed(2)}`);
        this.notifications.warning(
          `Precision drift detected: $${this._roundingErrorAccumulator.toFixed(2)}. ` +
          `Consider resetting account.`
        );
      }
    }
  }

  // FIXED #4: Proper negative balance handling with debt tracking
  _handleNegativeBalance(context, amount) {
    if (this.state.balance >= 0) return; // Not negative
    
    const debt = Math.abs(this.state.balance);
    this._accountDebt += debt;
    
    // Record debt transaction
    this._debtTransactions.push({
      timestamp: Date.now(),
      context,
      amount: debt,
      originalBalance: this.state.balance,
      description: `Negative balance in ${context}`
    });
    
    console.error('[Executor] NEGATIVE BALANCE DETECTED:', {
      context,
      balance: this.state.balance.toFixed(2),
      debt: debt.toFixed(2),
      totalDebt: this._accountDebt.toFixed(2),
      transactionNumber: this._transactionCount
    });
    
    // Notify user with actionable information
    this.notifications.error(
      `⚠️ Account Error: Balance went negative by $${debt.toFixed(2)} during ${context}.\n` +
      `Total account debt: $${this._accountDebt.toFixed(2)}.\n` +
      `This indicates a calculation error. Please review recent trades and report this bug.`
    );
    
    // Reset to zero but keep debt record
    this.state.balance = 0;
    
    // Emit debt event for potential handling
    this._emitEvent('paperTrader:accountDebt', {
      debt: this._accountDebt,
      transaction: this._debtTransactions[this._debtTransactions.length - 1]
    });
    
    return debt;
  }

  // FIXED #9: Track fee discrepancies for position exits
  _trackFeeDiscrepancy(position, reservedFee, actualFee, context) {
    const discrepancy = MoneyMath.subtract(actualFee, reservedFee);
    
    if (Math.abs(discrepancy) > 0.01) {
      this._feeDiscrepancies.push({
        timestamp: Date.now(),
        position: position.symbol,
        reservedFee,
        actualFee,
        discrepancy,
        context
      });
      
      this._totalFeeDiscrepancy = MoneyMath.add(this._totalFeeDiscrepancy, discrepancy);
      
      console.warn(`[Executor] Fee discrepancy detected:`, {
        symbol: position.symbol,
        reserved: reservedFee.toFixed(4),
        actual: actualFee.toFixed(4),
        discrepancy: discrepancy.toFixed(4),
        totalDiscrepancy: this._totalFeeDiscrepancy.toFixed(4)
      });
      
      // Notify if total discrepancy exceeds $1
      if (Math.abs(this._totalFeeDiscrepancy) > 1.00) {
        this.notifications.warning(
          `Fee calculation discrepancy detected: $${this._totalFeeDiscrepancy.toFixed(2)} total difference between reserved and actual fees.`
        );
      }
    }
  }

  async executeMarket(order, execPrice, pnl = null) {
    if (!order || !MoneyMath.isValid(execPrice)) {
      throw new Error('Invalid execution params');
    }

    this._transactionCount++;

    // Clamp leverage
    let leverage = order.tradeType === 'spot'
      ? 1
      : Math.max(1, Math.min(
        typeof order.leverage === 'number' ? order.leverage : parseInt(order.leverage) || this.options.maxLeverage || 1,
        this.options.maxLeverage || 1
      ));
    
    const tradeType = order.tradeType || 'spot';
    
    const cost = MoneyMath.multiply(execPrice, order.quantity);
    const entryFee = this.calculateFee(cost);
    
    const { isClosing, position } = this._getPositionContext(order);
    
    let reservedExitFee = 0;
    
    const balanceBefore = this.state.balance;
    let expectedBalanceChange = 0;

    // === TRADING LOGIC ===
    if (tradeType === 'spot') {
      if (order.side === 'buy') {
        const required = MoneyMath.add(cost, entryFee);
        
        if (MoneyMath.lessThan(this.state.balance, required)) {
          throw new Error('Insufficient balance to execute market buy (post-fee)');
        }
        
        this.state.balance = MoneyMath.subtract(this.state.balance, required);
        expectedBalanceChange = -required;
      } else {
        const proceeds = MoneyMath.subtract(cost, entryFee);
        this.state.balance = MoneyMath.add(this.state.balance, Math.max(0, proceeds));
        expectedBalanceChange = proceeds;
      }
      
    } else if (tradeType === 'margin') {
      const marginRequired = MoneyMath.divide(cost, leverage);
      
      if (isClosing) {
        // === CLOSING A POSITION ===
        const closingQty = Math.min(order.quantity, position.quantity);
        const closingProportion = closingQty / position.quantity;
        
        const releasedExitFee = MoneyMath.multiply(
          position.reservedExitFee || 0, 
          closingProportion
        );
        
        const originalMargin = MoneyMath.divide(
          MoneyMath.multiply(position.entryPrice, closingQty),
          position.leverage
        );
        
        // FIXED #9: Calculate actual exit fee at current price
        const actualExitFee = this.calculateFee(
          MoneyMath.multiply(execPrice, closingQty)
        );
        
        // Track fee discrepancy
        this._trackFeeDiscrepancy(
          position, 
          releasedExitFee, 
          actualExitFee, 
          'position close'
        );
        
        const marginAndFeeReturn = MoneyMath.sum([
          originalMargin,
          releasedExitFee,
          -actualExitFee
        ]);
        
        this.state.balance = MoneyMath.add(this.state.balance, marginAndFeeReturn);
        expectedBalanceChange = marginAndFeeReturn;
        
        if (MoneyMath.isValid(pnl)) {
          this.state.balance = MoneyMath.add(this.state.balance, pnl);
          expectedBalanceChange = MoneyMath.add(expectedBalanceChange, pnl);
        }
        
        console.log('[Executor] Close position accounting:', {
          symbol: position.symbol,
          closingQty,
          closingProportion: (closingProportion * 100).toFixed(1) + '%',
          returnedMargin: originalMargin.toFixed(2),
          releasedReservedFee: releasedExitFee.toFixed(2),
          actualExitFee: actualExitFee.toFixed(2),
          feeDiscrepancy: (actualExitFee - releasedExitFee).toFixed(4),
          netMarginReturn: marginAndFeeReturn.toFixed(2),
          pnl: MoneyMath.isValid(pnl) ? pnl.toFixed(2) : 'calculated by order-manager',
          totalAdded: (marginAndFeeReturn + (MoneyMath.isValid(pnl) ? pnl : 0)).toFixed(2),
          newBalance: this.state.balance.toFixed(2)
        });
        
      } else {
        // === OPENING A NEW POSITION ===
        // FIXED #9: Reserve exit fee based on ENTRY price (will adjust at exit)
        reservedExitFee = this.calculateFee(cost);
        
        const totalRequired = MoneyMath.sum([
          marginRequired,
          entryFee,
          reservedExitFee
        ]);
        
        if (MoneyMath.lessThan(this.state.balance, totalRequired)) {
          throw new Error(
            `Insufficient margin. Required: $${totalRequired.toFixed(2)} ` +
            `(Margin: $${marginRequired.toFixed(2)} + Entry Fee: $${entryFee.toFixed(2)} + ` +
            `Reserved Exit Fee: $${reservedExitFee.toFixed(2)}), ` +
            `Available: $${this.state.balance.toFixed(2)}`
          );
        }
        
        this.state.balance = MoneyMath.subtract(this.state.balance, totalRequired);
        expectedBalanceChange = -totalRequired;
        
        console.log('[Executor] Open position accounting:', {
          marginUsed: marginRequired.toFixed(2),
          entryFee: entryFee.toFixed(2),
          reservedExitFee: reservedExitFee.toFixed(2),
          note: 'Exit fee will be recalculated at actual exit price',
          totalDeducted: totalRequired.toFixed(2),
          remainingBalance: this.state.balance.toFixed(2)
        });
      }
    }

    this._validateBalanceChange(balanceBefore, this.state.balance, expectedBalanceChange, 
      `${tradeType} ${order.side} ${isClosing ? 'close' : 'open'}`);

    // FIXED #4: Enhanced negative balance handling
    if (this.state.balance < -0.01) {
      this._handleNegativeBalance(
        `${tradeType} ${order.side} ${isClosing ? 'close' : 'open'}`,
        this.state.balance
      );
    }

    this.state.balance = MoneyMath.round(this.state.balance);

    if (this._transactionCount % 100 === 0) {
      console.log('[Executor] Precision health check:', {
        transactions: this._transactionCount,
        cumulativeError: this._roundingErrorAccumulator.toFixed(4),
        errorPerTrade: (this._roundingErrorAccumulator / this._transactionCount).toFixed(6),
        currentBalance: this.state.balance.toFixed(2),
        totalDebt: this._accountDebt.toFixed(2),
        feeDiscrepancy: this._totalFeeDiscrepancy.toFixed(4)
      });
    }

    const sanitizedTags = sanitizeArray(order.tags || []);
    const sanitizedNote = sanitizeText(order.note || '');

    const trade = {
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      type: 'MARKET',
      price: MoneyMath.round(execPrice),
      quantity: order.quantity,
      fee: MoneyMath.round(entryFee),
      timestamp: Date.now(),
      pnl: MoneyMath.isValid(pnl) ? MoneyMath.round(pnl) : undefined,
      tags: sanitizedTags,
      note: sanitizedNote,
      leverage,
      tradeType,
      isClosing,
      reservedExitFee: isClosing ? 0 : MoneyMath.round(reservedExitFee)
    };

    this.state.trades = this.state.trades || [];
    this.state.trades.push(trade);

    this.state.orderHistory = this.state.orderHistory || [];
    this.state.orderHistory.push({
      ...order,
      status: 'filled',
      fillPrice: MoneyMath.round(execPrice),
      fillTime: Date.now(),
      tags: sanitizedTags,
      note: sanitizedNote,
      leverage,
      tradeType
    });

    if (this.state.orderHistory.length > 2000) {
      this.state.orderHistory = this.state.orderHistory.slice(-2000);
    }

    // === NOTIFICATIONS ===
    try {
      let tradeMsg = `${(order.side || '').toUpperCase()} ${order.quantity} ${order.symbol} @ ${execPrice.toFixed(2)}`;
      
      if (tradeType === 'margin') {
        tradeMsg += ` [${leverage}x${isClosing ? ' Close' : ' Open'}]`;
        if (!isClosing) {
          tradeMsg += ` (Reserved $${reservedExitFee.toFixed(2)} exit fee)`;
        }
      } else {
        tradeMsg += ` [Spot]`;
      }
      
      if (MoneyMath.isValid(pnl)) {
        const pnlColor = pnl >= 0 ? '🟢' : '🔴';
        tradeMsg += ` ${pnlColor} P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      }
      
      if (trade.tags.length) {
        tradeMsg += ` [${trade.tags.join(', ')}]`;
      }
      
      if (this.notifications && typeof this.notifications.success === 'function') {
        this.notifications.success(tradeMsg);
      }
      if (this.notifications && typeof this.notifications.showTradeNotification === 'function') {
        this.notifications.showTradeNotification(tradeMsg);
      }
      if (this.notifications && typeof this.notifications.playTradeSound === 'function') {
        this.notifications.playTradeSound();
      }
    } catch (e) {
      console.warn('[Executor] Notification failed', e);
    }

    this._emitEvent('paperTrader:tradeExecuted', trade);

    return trade;
  }

  annotateTrade(tradeId, tags, note) {
    if (!this.state.trades) return null;
    const trade = this.state.trades.find(t => t.id === tradeId);
    if (!trade) return null;
    
    trade.tags = sanitizeArray(tags);
    trade.note = sanitizeText(note);
    
    const orderHist = this.state.orderHistory?.find(o => o.id === tradeId);
    if (orderHist) {
      orderHist.tags = trade.tags;
      orderHist.note = trade.note;
    }
    
    console.log('[Executor] Trade annotated:', {
      tradeId,
      tags: trade.tags,
      noteLength: trade.note.length,
      sanitized: true
    });
    
    return trade;
  }

  getPrecisionStats() {
    return {
      transactionCount: this._transactionCount,
      cumulativeRoundingError: MoneyMath.round(this._roundingErrorAccumulator),
      averageErrorPerTrade: this._transactionCount > 0 
        ? MoneyMath.round(this._roundingErrorAccumulator / this._transactionCount)
        : 0,
      currentBalance: MoneyMath.round(this.state.balance),
      balanceIsValid: MoneyMath.isValid(this.state.balance),
      accountDebt: MoneyMath.round(this._accountDebt),
      debtTransactionCount: this._debtTransactions.length,
      totalFeeDiscrepancy: MoneyMath.round(this._totalFeeDiscrepancy),
      feeDiscrepancyCount: this._feeDiscrepancies.length
    };
  }

  // FIXED #4: Get debt report
  getDebtReport() {
    return {
      totalDebt: MoneyMath.round(this._accountDebt),
      transactions: this._debtTransactions.map(t => ({
        timestamp: new Date(t.timestamp).toISOString(),
        context: t.context,
        amount: MoneyMath.round(t.amount),
        description: t.description
      }))
    };
  }

  // FIXED #9: Get fee discrepancy report
  getFeeDiscrepancyReport() {
    return {
      totalDiscrepancy: MoneyMath.round(this._totalFeeDiscrepancy),
      count: this._feeDiscrepancies.length,
      discrepancies: this._feeDiscrepancies.map(d => ({
        timestamp: new Date(d.timestamp).toISOString(),
        symbol: d.position,
        reservedFee: MoneyMath.round(d.reservedFee),
        actualFee: MoneyMath.round(d.actualFee),
        discrepancy: MoneyMath.round(d.discrepancy),
        context: d.context
      }))
    };
  }

  resetPrecisionTracking() {
    this._roundingErrorAccumulator = 0;
    this._transactionCount = 0;
    this._accountDebt = 0;
    this._debtTransactions = [];
    this._feeDiscrepancies = [];
    this._totalFeeDiscrepancy = 0;
    console.log('[Executor] Precision tracking reset');
  }

  destroy() {
    const stats = this.getPrecisionStats();
    console.log('[Executor] Final precision stats:', stats);
    
    if (Math.abs(stats.cumulativeRoundingError) > 0.10) {
      console.warn('[Executor] Significant cumulative rounding error detected:', 
        stats.cumulativeRoundingError.toFixed(4));
    }
    
    if (stats.accountDebt > 0) {
      console.error('[Executor] Account has unresolved debt:', stats.accountDebt.toFixed(2));
      console.error('[Executor] Debt report:', this.getDebtReport());
    }
    
    if (Math.abs(stats.totalFeeDiscrepancy) > 0.10) {
      console.warn('[Executor] Significant fee discrepancy detected:', 
        stats.totalFeeDiscrepancy.toFixed(4));
      console.warn('[Executor] Fee discrepancy report:', this.getFeeDiscrepancyReport());
    }
  }
}

export { MoneyMath };