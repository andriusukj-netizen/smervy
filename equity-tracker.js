// paper-trader/equity-tracker.js
// Tracks equity snapshots over time for P&L charting
// Stores snapshots in memory and optionally persists to localStorage

export default class EquityTracker {
  constructor(state, persistence) {
    this.state = state;
    this.persistence = persistence;
    
    // In-memory equity snapshots
    this.snapshots = [];
    
    // Configuration
    this.maxSnapshots = 10000; // Limit to prevent memory issues
    this.snapshotInterval = 60000; // Minimum 1 minute between auto-snapshots
    this.lastAutoSnapshot = 0;
    
    // Load existing snapshots
    this._loadSnapshots();
    
    // Set up periodic snapshot capture
    this._startPeriodicCapture();
  }

  /**
   * Load snapshots from localStorage
   */
  _loadSnapshots() {
    try {
      const stored = localStorage.getItem('paperTrader:equitySnapshots');
      if (stored) {
        const data = JSON.parse(stored);
        
        // Validate and sanitize
        if (Array.isArray(data.snapshots)) {
          this.snapshots = data.snapshots
            .filter(s => s && typeof s.timestamp === 'number' && typeof s.equity === 'number')
            .sort((a, b) => a.timestamp - b.timestamp);
          
          console.log(`[EquityTracker] Loaded ${this.snapshots.length} snapshots`);
        }
      }
    } catch (error) {
      console.error('[EquityTracker] Failed to load snapshots:', error);
      this.snapshots = [];
    }
    
    // Ensure we have an initial snapshot
    if (this.snapshots.length === 0) {
      this._captureSnapshot('initial');
    }
  }

  /**
   * Save snapshots to localStorage
   */
  _saveSnapshots() {
    try {
      const data = {
        snapshots: this.snapshots,
        lastUpdated: Date.now(),
        version: '1.0'
      };
      
      localStorage.setItem('paperTrader:equitySnapshots', JSON.stringify(data));
    } catch (error) {
      console.error('[EquityTracker] Failed to save snapshots:', error);
      
      // If quota exceeded, trim old snapshots
      if (error.name === 'QuotaExceededError') {
        this._trimOldSnapshots(Math.floor(this.snapshots.length / 2));
        this._saveSnapshots(); // Retry
      }
    }
  }

  /**
   * Start periodic snapshot capture
   */
  _startPeriodicCapture() {
    // Capture snapshot every 5 minutes (if there are open positions)
    this._periodicInterval = setInterval(() => {
      if (this.state.positions.length > 0) {
        this._captureSnapshot('periodic');
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    console.log('[EquityTracker] Periodic capture started');
  }

  /**
   * Capture a snapshot of current equity
   */
  _captureSnapshot(reason = 'manual') {
    try {
      const now = Date.now();
      
      // Prevent too-frequent snapshots
      if (reason === 'auto' && now - this.lastAutoSnapshot < this.snapshotInterval) {
        return null;
      }
      
      // Calculate current equity
      const equity = this.state.getEquity();
      const balance = this.state.balance;
      const unrealizedPnL = equity - balance;
      
      // Get realized P&L from trades
      const realizedPnL = this.state.trades.reduce((sum, trade) => {
        return sum + (trade.pnl || 0);
      }, 0);
      
      const snapshot = {
        timestamp: now,
        equity: Math.round(equity * 100) / 100,
        balance: Math.round(balance * 100) / 100,
        unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
        realizedPnL: Math.round(realizedPnL * 100) / 100,
        positionCount: this.state.positions.length,
        tradeCount: this.state.trades.length,
        reason
      };
      
      // Add to snapshots
      this.snapshots.push(snapshot);
      
      // Update last auto snapshot time
      if (reason === 'auto') {
        this.lastAutoSnapshot = now;
      }
      
      // Trim if exceeding max
      if (this.snapshots.length > this.maxSnapshots) {
        this._trimOldSnapshots(Math.floor(this.maxSnapshots * 0.9));
      }
      
      // Save to localStorage (debounced)
      this._debouncedSave();
      
      console.log('[EquityTracker] Snapshot captured:', {
        equity: snapshot.equity,
        reason,
        totalSnapshots: this.snapshots.length
      });
      
      return snapshot;
    } catch (error) {
      console.error('[EquityTracker] Snapshot capture failed:', error);
      return null;
    }
  }

  /**
   * Trim old snapshots to reduce memory usage
   */
  _trimOldSnapshots(keepCount) {
    if (this.snapshots.length <= keepCount) return;
    
    // Keep most recent snapshots
    const removed = this.snapshots.length - keepCount;
    this.snapshots = this.snapshots.slice(-keepCount);
    
    console.log(`[EquityTracker] Trimmed ${removed} old snapshots`);
  }

  /**
   * Debounced save to localStorage
   */
  _debouncedSave = (() => {
    let timeout;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => this._saveSnapshots(), 2000);
    };
  })();

  /**
   * Capture snapshot on trade execution
   */
  onTradeExecuted(trade) {
    this._captureSnapshot('trade');
  }

  /**
   * Capture snapshot on position close
   */
  onPositionClosed(position) {
    this._captureSnapshot('position_close');
  }

  /**
   * Manually capture snapshot
   */
  captureSnapshot() {
    return this._captureSnapshot('manual');
  }

  /**
   * Get snapshots for a time range
   */
  getSnapshotsForRange(range = 'all') {
    const now = Date.now();
    let startTime;
    
    switch (range) {
      case '1h':
        startTime = now - (60 * 60 * 1000);
        break;
      case '1d':
        startTime = now - (24 * 60 * 60 * 1000);
        break;
      case '1w':
        startTime = now - (7 * 24 * 60 * 60 * 1000);
        break;
      case '1m':
        startTime = now - (30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startTime = 0;
    }
    
    return this.snapshots.filter(s => s.timestamp >= startTime);
  }

  /**
   * Get chart data for visualization
   */
  getChartData(range = 'all') {
    const snapshots = this.getSnapshotsForRange(range);
    
    if (snapshots.length === 0) {
      // Return initial balance point
      return {
        labels: [new Date().toISOString()],
        equity: [this.state.initialBalance],
        balance: [this.state.initialBalance],
        unrealizedPnL: [0]
      };
    }
    
    return {
      labels: snapshots.map(s => s.timestamp),
      equity: snapshots.map(s => s.equity),
      balance: snapshots.map(s => s.balance),
      unrealizedPnL: snapshots.map(s => s.unrealizedPnL)
    };
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(range = 'all') {
    const snapshots = this.getSnapshotsForRange(range);
    
    if (snapshots.length === 0) {
      return {
        startEquity: this.state.initialBalance,
        endEquity: this.state.getEquity(),
        change: 0,
        changePercent: 0,
        peak: this.state.initialBalance,
        trough: this.state.initialBalance,
        drawdown: 0,
        drawdownPercent: 0
      };
    }
    
    const startEquity = snapshots[0].equity;
    const endEquity = snapshots[snapshots.length - 1].equity;
    const change = endEquity - startEquity;
    const changePercent = (change / startEquity) * 100;
    
    // Calculate peak and drawdown
    let peak = startEquity;
    let maxDrawdown = 0;
    
    snapshots.forEach(snapshot => {
      if (snapshot.equity > peak) {
        peak = snapshot.equity;
      }
      const drawdown = peak - snapshot.equity;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });
    
    const trough = peak - maxDrawdown;
    const drawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
    
    return {
      startEquity: Math.round(startEquity * 100) / 100,
      endEquity: Math.round(endEquity * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      peak: Math.round(peak * 100) / 100,
      trough: Math.round(trough * 100) / 100,
      drawdown: Math.round(maxDrawdown * 100) / 100,
      drawdownPercent: Math.round(drawdownPercent * 100) / 100
    };
  }

  /**
   * Reset all snapshots
   */
  reset() {
    this.snapshots = [];
    this._captureSnapshot('reset');
    this._saveSnapshots();
    console.log('[EquityTracker] Snapshots reset');
  }

  /**
   * Get diagnostics
   */
  getDiagnostics() {
    const now = Date.now();
    const oldestSnapshot = this.snapshots[0];
    const newestSnapshot = this.snapshots[this.snapshots.length - 1];
    
    return {
      snapshotCount: this.snapshots.length,
      oldestTimestamp: oldestSnapshot?.timestamp,
      newestTimestamp: newestSnapshot?.timestamp,
      timespan: newestSnapshot && oldestSnapshot 
        ? newestSnapshot.timestamp - oldestSnapshot.timestamp 
        : 0,
      memoryUsage: JSON.stringify(this.snapshots).length,
      lastAutoSnapshot: this.lastAutoSnapshot,
      timeSinceLastAuto: now - this.lastAutoSnapshot
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this._periodicInterval) {
      clearInterval(this._periodicInterval);
      this._periodicInterval = null;
    }
    
    // Save final state
    this._saveSnapshots();
    
    console.log('[EquityTracker] Destroyed');
  }
}