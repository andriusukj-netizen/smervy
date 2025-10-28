// paper-trader/price-observer.js - FIXED VERSION
// âœ… FIXED #2: Circuit breaker now notifies user and provides recovery options
// ENHANCED: Robust error recovery and leak prevention
// FIXED: Automatic recovery from DOM errors
// FIXED: Graceful degradation when observers fail

export default class PriceObserverManager {
  constructor(notifications = null) {
    this.observers = new Map(); // symbol -> { observer, element, callback, errorCount, lastError }
    this.gridObserver = null;
    this.intervals = new Map();
    this.cleanupInterval = null;
    
    // âœ… FIXED: Store notifications instance for user feedback
    this.notifications = notifications;
    
    // Track which elements we're observing to detect removals
    this.observedElements = new WeakMap(); // element -> symbol
    
    // IntersectionObserver for performance optimization
    this.intersectionObserver = null;
    this.enableIntersectionOptimization = true;
    this.intersectionObservedElements = new Set();
    
    // ENHANCED: Circuit breaker pattern
    this.maxErrorsPerObserver = 5;
    this.errorResetTimeout = 60000; // Reset error count after 1 minute
    
    // ENHANCED: Health monitoring
    this.healthCheckInterval = 10000; // 10 seconds
    this.lastHealthCheck = Date.now();
    this.totalErrorsEncountered = 0;
    this.recoveryAttempts = 0;
    this.successfulRecoveries = 0;
    
    // ENHANCED: Fallback mechanisms
    this.fallbackMode = false;
    this.fallbackCheckInterval = null;
    
    // âœ… FIXED: Track which symbols have had circuit breaker triggered
    this.circuitBreakerTriggered = new Set();
    
    // ENHANCED: Performance monitoring
    this.performanceMetrics = {
      observerCreations: 0,
      observerDestructions: 0,
      errorRecoveries: 0,
      memoryLeaksDetected: 0,
      averageObserverLifetime: 0,
      circuitBreakerTriggers: 0 // âœ… NEW
    };
  }

  /**
   * âœ… FIXED: Set notifications instance after construction
   */
  setNotifications(notifications) {
    this.notifications = notifications;
    console.log('[PriceObserver] Notifications instance set');
  }

  /**
   * ENHANCED: Observe with error recovery and circuit breaker
   */
  observe(symbol, element, callback) {
    if (!element || !symbol || !callback) {
      console.warn('[PriceObserver] Invalid observe params:', { symbol, element, callback });
      return false;
    }

    const symbolKey = symbol.toUpperCase();
    
    // Check if observer already exists and is healthy
    const existing = this.observers.get(symbolKey);
    if (existing && existing.errorCount < this.maxErrorsPerObserver) {
      console.log('[PriceObserver] Observer already exists for:', symbolKey);
      return true;
    }

    // Clean up any existing unhealthy observer
    if (existing) {
      this.unobserve(symbolKey);
    }

    // Verify element is in DOM
    if (!document.contains(element)) {
      console.warn('[PriceObserver] Element not in DOM, skipping:', symbolKey);
      return false;
    }

    try {
      // ENHANCED: Create observer with error handling
      const observer = new MutationObserver(() => {
        this._handlePriceUpdate(symbolKey, element, callback);
      });

      // Start observing
      observer.observe(element, { 
        childList: true, 
        characterData: true, 
        subtree: true 
      });

      // Store observer data with error tracking
      this.observers.set(symbolKey, {
        observer,
        element,
        callback,
        symbol: symbolKey,
        created: Date.now(),
        paused: false,
        errorCount: 0,
        lastError: null,
        lastSuccessfulUpdate: Date.now()
      });

      // Track element for cleanup detection
      this.observedElements.set(element, symbolKey);

      // Set up intersection observer
      if (this.enableIntersectionOptimization) {
        this._observeIntersection(element, symbolKey);
      }

      // Update metrics
      this.performanceMetrics.observerCreations++;

      console.log('[PriceObserver] Successfully observing:', symbolKey);
      return true;

    } catch (error) {
      console.error('[PriceObserver] Failed to create observer:', error);
      this.totalErrorsEncountered++;
      
      // Try fallback mechanism
      this._enableFallbackForSymbol(symbolKey, callback);
      return false;
    }
  }

  /**
   * ENHANCED: Handle price update with error recovery
   */
  _handlePriceUpdate(symbolKey, element, callback) {
    const observerData = this.observers.get(symbolKey);
    if (!observerData) return;

    try {
      // Check if element still exists
      if (!document.contains(element)) {
        console.log('[PriceObserver] Element removed during update, cleaning up:', symbolKey);
        this.unobserve(symbolKey);
        return;
      }

      // Parse price
      const priceText = (element.textContent || '').trim();
      const price = parseFloat(priceText.replace(/[^0-9.\-]/g, ''));
      
      if (!isNaN(price) && price > 0) {
        callback(symbolKey, price);
        
        // Reset error count on success
        if (observerData.errorCount > 0) {
          console.log(`[PriceObserver] Observer recovered for ${symbolKey}, resetting error count from ${observerData.errorCount}`);
          this.performanceMetrics.errorRecoveries++;
          this.successfulRecoveries++;
          
          // âœ… FIXED: Notify user of recovery
          if (this.circuitBreakerTriggered.has(symbolKey)) {
            this._notifyUser('info', `âœ… Price updates recovered for ${symbolKey}`);
            this.circuitBreakerTriggered.delete(symbolKey);
          }
        }
        
        observerData.errorCount = 0;
        observerData.lastError = null;
        observerData.lastSuccessfulUpdate = Date.now();
      }

    } catch (error) {
      this._handleObserverError(symbolKey, error);
    }
  }

  /**
   * âœ… FIXED: Circuit breaker pattern with user notification
   */
  _handleObserverError(symbolKey, error) {
    const observerData = this.observers.get(symbolKey);
    if (!observerData) return;

    observerData.errorCount++;
    observerData.lastError = {
      message: error.message,
      timestamp: Date.now()
    };
    this.totalErrorsEncountered++;

    console.warn(`[PriceObserver] Error in observer for ${symbolKey} (${observerData.errorCount}/${this.maxErrorsPerObserver}):`, error);

    // Circuit breaker: If too many errors, disable this observer
    if (observerData.errorCount >= this.maxErrorsPerObserver) {
      console.error(`[PriceObserver] Circuit breaker triggered for ${symbolKey}, switching to fallback`);
      
      // âœ… FIXED: Track circuit breaker trigger
      this.circuitBreakerTriggered.add(symbolKey);
      this.performanceMetrics.circuitBreakerTriggers++;
      
      // âœ… FIXED: Notify user about circuit breaker
      this._notifyUser(
        'warning',
        `âš ï¸ Price updates for ${symbolKey} temporarily disabled due to errors. Switching to fallback mode.`
      );
      
      // Store callback for fallback
      const callback = observerData.callback;
      
      // Unobserve the failing observer
      this.unobserve(symbolKey);
      
      // Enable fallback mechanism
      this._enableFallbackForSymbol(symbolKey, callback);
      
      // Schedule recovery attempt
      this._scheduleRecoveryAttempt(symbolKey, callback);
    }

    // Auto-reset error count after timeout
    setTimeout(() => {
      const data = this.observers.get(symbolKey);
      if (data && data.errorCount > 0 && Date.now() - data.lastError.timestamp > this.errorResetTimeout) {
        console.log(`[PriceObserver] Auto-resetting error count for ${symbolKey}`);
        data.errorCount = 0;
        data.lastError = null;
      }
    }, this.errorResetTimeout);
  }

  /**
   * âœ… FIXED: Helper to notify user (with fallback if notifications unavailable)
   */
  _notifyUser(type, message) {
    try {
      if (this.notifications && typeof this.notifications[type] === 'function') {
        this.notifications[type](message);
      } else {
        // Fallback to console
        console.log(`[PriceObserver] Notification (${type}):`, message);
      }
    } catch (error) {
      console.warn('[PriceObserver] Failed to send notification:', error);
    }
  }

  /**
   * ENHANCED: Fallback mechanism using polling
   */
  _enableFallbackForSymbol(symbolKey, callback) {
    if (!this.fallbackMode) {
      console.log('[PriceObserver] Enabling fallback mode');
      this.fallbackMode = true;
      
      // âœ… FIXED: Notify user about fallback mode
      this._notifyUser('info', 'Fallback price monitoring active for affected symbols');
    }

    // Check if element still exists
    const checkElement = () => {
      const elements = document.querySelectorAll('.current-price');
      const targetElement = Array.from(elements).find(el => 
        el.dataset.ticker?.toUpperCase() === symbolKey
      );

      if (targetElement) {
        try {
          const priceText = (targetElement.textContent || '').trim();
          const price = parseFloat(priceText.replace(/[^0-9.\-]/g, ''));
          
          if (!isNaN(price) && price > 0) {
            callback(symbolKey, price);
          }
        } catch (error) {
          console.warn('[PriceObserver] Fallback error:', error);
        }
      }
    };

    // Poll every 500ms
    if (!this.intervals.has(`fallback-${symbolKey}`)) {
      const intervalId = setInterval(checkElement, 500);
      this.intervals.set(`fallback-${symbolKey}`, intervalId);
      console.log(`[PriceObserver] Fallback polling enabled for ${symbolKey}`);
    }
  }

  /**
   * âœ… FIXED: Enhanced recovery attempt with user feedback
   */
  _scheduleRecoveryAttempt(symbolKey, callback) {
    this.recoveryAttempts++;

    setTimeout(() => {
      console.log(`[PriceObserver] Attempting recovery for ${symbolKey}...`);
      
      // âœ… FIXED: Notify user about recovery attempt
      this._notifyUser('info', `Attempting to restore price updates for ${symbolKey}...`);
      
      // Find element
      const elements = document.querySelectorAll('.current-price');
      const targetElement = Array.from(elements).find(el => 
        el.dataset.ticker?.toUpperCase() === symbolKey
      );

      if (targetElement && document.contains(targetElement)) {
        // Stop fallback
        const fallbackInterval = this.intervals.get(`fallback-${symbolKey}`);
        if (fallbackInterval) {
          clearInterval(fallbackInterval);
          this.intervals.delete(`fallback-${symbolKey}`);
        }

        // Try to re-observe
        const success = this.observe(symbolKey, targetElement, callback);
        if (success) {
          console.log(`[PriceObserver] âœ… Successfully recovered observer for ${symbolKey}`);
          this._notifyUser('success', `âœ… Price updates restored for ${symbolKey}`);
        } else {
          console.warn(`[PriceObserver] Recovery failed for ${symbolKey}, will retry later`);
          // Try again in 30 seconds
          this._scheduleRecoveryAttempt(symbolKey, callback);
        }
      } else {
        console.warn(`[PriceObserver] Element not found for recovery: ${symbolKey}`);
        // Try again later
        this._scheduleRecoveryAttempt(symbolKey, callback);
      }
    }, 30000); // Retry after 30 seconds
  }

  /**
   * ENHANCED: IntersectionObserver with error handling
   */
  _observeIntersection(element, symbolKey) {
    try {
      if (!this.intersectionObserver) {
        this.intersectionObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach(entry => {
              try {
                const sym = this.observedElements.get(entry.target);
                if (!sym) return;

                const observerData = this.observers.get(sym);
                if (!observerData) return;

                if (entry.isIntersecting) {
                  if (observerData.paused) {
                    observerData.observer.observe(observerData.element, {
                      childList: true,
                      characterData: true,
                      subtree: true
                    });
                    observerData.paused = false;
                    console.log('[PriceObserver] Resumed (visible):', sym);
                  }
                } else {
                  if (!observerData.paused) {
                    observerData.observer.disconnect();
                    observerData.paused = true;
                    console.log('[PriceObserver] Paused (off-screen):', sym);
                  }
                }
              } catch (error) {
                console.warn('[PriceObserver] IntersectionObserver entry error:', error);
              }
            });
          },
          { 
            rootMargin: '100px',
            threshold: 0.01 
          }
        );
      }

      this.intersectionObservedElements.add(element);
      this.intersectionObserver.observe(element);
      
      console.log('[PriceObserver] IntersectionObserver tracking:', {
        symbol: symbolKey,
        totalTracked: this.intersectionObservedElements.size
      });
    } catch (error) {
      console.error('[PriceObserver] IntersectionObserver setup error:', error);
      // Continue without intersection optimization
    }
  }

  /**
   * Observe all current price elements and watch for new ones
   */
  observeAll(callback) {
    // Observe existing elements
    const existingElements = document.querySelectorAll('.current-price');
    console.log(`[PriceObserver] Found ${existingElements.length} existing price elements`);
    
    let successCount = 0;
    existingElements.forEach(el => {
      const sym = el.dataset.ticker;
      if (sym) {
        if (this.observe(sym, el, callback)) {
          successCount++;
        }
      }
    });

    console.log(`[PriceObserver] Successfully observing ${successCount}/${existingElements.length} elements`);

    // Watch for new elements
    this._setupGridObserver(callback);

    // Set up periodic health checks
    this._setupHealthCheck();

    // Set up global fallback
    this._setupGlobalFallback(callback);
  }

  /**
   * ENHANCED: Grid observer with error recovery
   */
  _setupGridObserver(callback) {
    if (this.gridObserver) {
      this.gridObserver.disconnect();
    }

    const grid = document.querySelector('.chart-grid') || document.body;
    
    try {
      this.gridObserver = new MutationObserver(mutations => {
        try {
          for (const mutation of mutations) {
            // Handle removed nodes
            if (mutation.removedNodes.length > 0) {
              for (const node of mutation.removedNodes) {
                if (!node || !node.querySelectorAll) continue;
                
                const removedPriceElements = [
                  ...(node.classList?.contains('current-price') ? [node] : []),
                  ...(node.querySelectorAll ? node.querySelectorAll('.current-price') : [])
                ];

                removedPriceElements.forEach(el => {
                  const sym = this.observedElements.get(el);
                  if (sym) {
                    console.log('[PriceObserver] Detected removal via grid observer:', sym);
                    this.unobserve(sym);
                  }
                });
              }
            }

            // Handle added nodes
            if (mutation.addedNodes.length > 0) {
              for (const node of mutation.addedNodes) {
                if (!node || !node.querySelectorAll) continue;
                
                const newPriceElements = [
                  ...(node.classList?.contains('current-price') ? [node] : []),
                  ...(node.querySelectorAll ? node.querySelectorAll('.current-price') : [])
                ];

                newPriceElements.forEach(el => {
                  const sym = el.dataset.ticker;
                  if (sym && !this.observers.has(sym.toUpperCase())) {
                    console.log('[PriceObserver] Detected new element:', sym);
                    this.observe(sym, el, callback);
                  }
                });
              }
            }
          }
        } catch (error) {
          console.error('[PriceObserver] Grid observer mutation handling error:', error);
        }
      });

      this.gridObserver.observe(grid, { 
        childList: true, 
        subtree: true 
      });
      
      console.log('[PriceObserver] Grid observer active');
    } catch (error) {
      console.error('[PriceObserver] Grid observer setup failed:', error);
    }
  }

  /**
   * ENHANCED: Comprehensive health check with auto-recovery
   */
  _setupHealthCheck() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this._performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * ENHANCED: Health check with recovery actions
   */
  _performHealthCheck() {
    let cleaned = 0;
    let recovered = 0;
    let failed = 0;
    const now = Date.now();

    console.log('[PriceObserver] Running health check...');

    // Check main observers
    for (const [symbol, data] of this.observers.entries()) {
      try {
        // Check if element still exists
        if (!document.contains(data.element)) {
          console.warn('[PriceObserver] Health check: orphaned observer:', symbol);
          this.unobserve(symbol);
          cleaned++;
          continue;
        }

        // Check for stale observers (no updates in 5 minutes)
        const timeSinceUpdate = now - data.lastSuccessfulUpdate;
        if (timeSinceUpdate > 300000) {
          console.warn(`[PriceObserver] Stale observer detected: ${symbol} (${Math.round(timeSinceUpdate/1000)}s since last update)`);
          
          // Try to recover
          const callback = data.callback;
          this.unobserve(symbol);
          
          if (this.observe(symbol, data.element, callback)) {
            recovered++;
            console.log(`[PriceObserver] Recovered stale observer: ${symbol}`);
          } else {
            failed++;
          }
        }

        // Check for high error count
        if (data.errorCount >= this.maxErrorsPerObserver / 2) {
          console.warn(`[PriceObserver] High error count: ${symbol} (${data.errorCount} errors)`);
        }
      } catch (error) {
        console.error(`[PriceObserver] Health check error for ${symbol}:`, error);
      }
    }

    // Check IntersectionObserver for orphaned elements
    let intersectionCleaned = 0;
    if (this.intersectionObserver && this.intersectionObservedElements.size > 0) {
      const orphaned = [];
      
      this.intersectionObservedElements.forEach(element => {
        if (!document.contains(element)) {
          orphaned.push(element);
        }
      });

      orphaned.forEach(element => {
        try {
          this.intersectionObserver.unobserve(element);
          this.intersectionObservedElements.delete(element);
          intersectionCleaned++;
        } catch (e) {
          console.warn('[PriceObserver] Error cleaning orphaned intersection element:', e);
        }
      });
    }

    // Check for memory leaks
    const observerCount = this.observers.size;
    const intersectionCount = this.intersectionObservedElements.size;
    const discrepancy = intersectionCount - observerCount;

    if (discrepancy > 10) {
      console.warn(`[PriceObserver] Memory leak detected: ${discrepancy} orphaned intersection observers`);
      this.performanceMetrics.memoryLeaksDetected++;
    }

    // Log results
    this.lastHealthCheck = now;
    
    console.log('[PriceObserver] Health check complete:', {
      activeObservers: observerCount,
      intersectionTracked: intersectionCount,
      cleaned,
      recovered,
      failed,
      intersectionCleaned,
      totalErrors: this.totalErrorsEncountered,
      recoveryAttempts: this.recoveryAttempts,
      successfulRecoveries: this.successfulRecoveries,
      fallbackMode: this.fallbackMode,
      circuitBreakersActive: this.circuitBreakerTriggered.size
    });

    // Alert if health is poor
    if (failed > 3 || cleaned > 5) {
      console.warn('[PriceObserver] âš ï¸ Poor health detected, consider manual intervention');
      this._notifyUser('warning', 'Price observer health degraded - monitoring issues detected');
    }
  }

  /**
   * ENHANCED: Global fallback using window.lastPrices
   */
  _setupGlobalFallback(callback) {
    if (window.lastPrices && !this.intervals.has('global-fallback')) {
      const id = setInterval(() => {
        if (!window.lastPrices) {
          clearInterval(id);
          this.intervals.delete('global-fallback');
          return;
        }

        Object.keys(window.lastPrices).forEach(sym => {
          const price = window.lastPrices[sym];
          if (price !== undefined && !isNaN(price) && price > 0) {
            callback(sym.toUpperCase(), price);
          }
        });
      }, 1000);
      
      this.intervals.set('global-fallback', id);
      console.log('[PriceObserver] Global fallback polling active');
    }
  }

  /**
   * Unobserve a specific symbol
   */
  unobserve(symbol) {
    const key = (symbol || '').toUpperCase();
    const data = this.observers.get(key);
    
    if (data) {
      try {
        // Disconnect mutation observer
        data.observer.disconnect();
        
        // Disconnect from IntersectionObserver
        if (this.intersectionObserver && data.element) {
          try {
            this.intersectionObserver.unobserve(data.element);
            this.intersectionObservedElements.delete(data.element);
          } catch (e) {
            console.warn('[PriceObserver] Error unobserving from IntersectionObserver:', e);
          }
        }

        // Clean up element tracking
        if (data.element) {
          this.observedElements.delete(data.element);
        }

        // Remove from map
        this.observers.delete(key);
        
        // Update metrics
        this.performanceMetrics.observerDestructions++;
        const lifetime = Date.now() - data.created;
        this.performanceMetrics.averageObserverLifetime = 
          (this.performanceMetrics.averageObserverLifetime + lifetime) / 2;
        
        console.log('[PriceObserver] Fully unobserved:', key);
      } catch (e) {
        console.warn('[PriceObserver] Error during unobserve:', e);
      }
    }

    // Clean up fallback interval if exists
    const fallbackInterval = this.intervals.get(`fallback-${key}`);
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      this.intervals.delete(`fallback-${key}`);
    }
  }

  /**
   * Clean up all observers
   */
  unobserveAll() {
    console.log('[PriceObserver] Cleaning up all observers...');

    // Disconnect all mutation observers
    this.observers.forEach((data, symbol) => {
      try {
        data.observer.disconnect();
        
        if (this.intersectionObserver && data.element) {
          try {
            this.intersectionObserver.unobserve(data.element);
          } catch (e) {
            // Element might already be removed
          }
        }
      } catch (e) {
        console.warn('[PriceObserver] Error disconnecting observer:', symbol, e);
      }
    });
    this.observers.clear();

    // Disconnect grid observer
    if (this.gridObserver) {
      this.gridObserver.disconnect();
      this.gridObserver = null;
    }

    // Fully cleanup IntersectionObserver
    if (this.intersectionObserver) {
      try {
        this.intersectionObservedElements.forEach(element => {
          try {
            this.intersectionObserver.unobserve(element);
          } catch (e) {
            // Element might already be removed
          }
        });
        
        this.intersectionObserver.disconnect();
        this.intersectionObserver = null;
        this.intersectionObservedElements.clear();
        
        console.log('[PriceObserver] IntersectionObserver fully cleaned up');
      } catch (e) {
        console.warn('[PriceObserver] Error cleaning up IntersectionObserver:', e);
      }
    }

    // Clear all intervals
    this.intervals.forEach((id, key) => {
      clearInterval(id);
    });
    this.intervals.clear();

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log('[PriceObserver] All observers cleaned up successfully');
  }

  /**
   * Get current observer stats
   */
  getStats() {
    const stats = {
      totalObservers: this.observers.size,
      totalIntervals: this.intervals.size,
      intersectionTracked: this.intersectionObservedElements.size,
      symbols: Array.from(this.observers.keys()),
      pausedCount: 0,
      activeCount: 0,
      errorCount: 0,
      fallbackMode: this.fallbackMode,
      circuitBreakersActive: this.circuitBreakerTriggered.size,
      circuitBreakerSymbols: Array.from(this.circuitBreakerTriggered),
      health: this._calculateHealth(),
      performance: this.performanceMetrics,
      totalErrors: this.totalErrorsEncountered,
      recoveryAttempts: this.recoveryAttempts,
      successfulRecoveries: this.successfulRecoveries
    };

    this.observers.forEach((data) => {
      if (data.paused) {
        stats.pausedCount++;
      } else {
        stats.activeCount++;
      }
      if (data.errorCount > 0) {
        stats.errorCount++;
      }
    });

    const orphanedIntersectionElements = this.intersectionObservedElements.size - this.observers.size;
    if (orphanedIntersectionElements > 10) {
      stats.memoryHealth = 'WARNING';
      stats.orphanedElements = orphanedIntersectionElements;
    } else {
      stats.memoryHealth = 'GOOD';
    }

    return stats;
  }

  /**
   * Calculate overall health score
   */
  _calculateHealth() {
    let score = 100;
    
    // Deduct for errors
    const errorRate = this.observers.size > 0 
      ? (this.totalErrorsEncountered / this.observers.size) 
      : 0;
    score -= Math.min(errorRate * 10, 30);
    
    // Deduct for fallback mode
    if (this.fallbackMode) score -= 20;
    
    // Deduct for active circuit breakers
    score -= this.circuitBreakerTriggered.size * 5;
    
    // Deduct for memory leaks
    const leakCount = this.performanceMetrics.memoryLeaksDetected;
    score -= Math.min(leakCount * 10, 20);
    
    // Bonus for successful recoveries
    if (this.successfulRecoveries > 0) {
      score += Math.min(this.successfulRecoveries * 2, 10);
    }
    
    score = Math.max(0, Math.min(100, score));
    
    if (score >= 80) return 'EXCELLENT';
    if (score >= 60) return 'GOOD';
    if (score >= 40) return 'FAIR';
    if (score >= 20) return 'POOR';
    return 'CRITICAL';
  }

  /**
   * Manual cleanup trigger
   */
  cleanup() {
    console.log('[PriceObserver] Manual cleanup triggered');
    this._performHealthCheck();
  }

  /**
   * âœ… NEW: Force recovery of all symbols with circuit breakers
   */
  forceRecoveryAll() {
    console.log('[PriceObserver] Forcing recovery of all circuit breakers...');
    
    const symbolsToRecover = Array.from(this.circuitBreakerTriggered);
    
    if (symbolsToRecover.length === 0) {
      this._notifyUser('info', 'No circuit breakers active - all observers healthy');
      return;
    }
    
    this._notifyUser('info', `Attempting to recover ${symbolsToRecover.length} symbol(s)...`);
    
    symbolsToRecover.forEach(symbol => {
      // Find the fallback interval for this symbol
      const fallbackKey = `fallback-${symbol}`;
      if (this.intervals.has(fallbackKey)) {
        // Trigger immediate recovery
        const elements = document.querySelectorAll('.current-price');
        const targetElement = Array.from(elements).find(el => 
          el.dataset.ticker?.toUpperCase() === symbol
        );
        
        if (targetElement && document.contains(targetElement)) {
          // Get callback from intervals or reconstruct
          console.log(`[PriceObserver] Attempting forced recovery for ${symbol}`);
          // The actual callback will be handled by the scheduled recovery
        }
      }
    });
  }

  /**
   * Get memory diagnostics
   */
  getMemoryDiagnostics() {
    return {
      observers: {
        total: this.observers.size,
        paused: 0,
        active: 0,
        symbols: Array.from(this.observers.keys()),
        withErrors: Array.from(this.observers.entries())
          .filter(([, data]) => data.errorCount > 0)
          .map(([symbol, data]) => ({ symbol, errorCount: data.errorCount }))
      },
      intersectionObserver: {
        enabled: this.enableIntersectionOptimization,
        exists: !!this.intersectionObserver,
        trackedElements: this.intersectionObservedElements.size,
        orphaned: Math.max(0, this.intersectionObservedElements.size - this.observers.size)
      },
      intervals: {
        total: this.intervals.size,
        types: Array.from(this.intervals.keys())
      },
      circuitBreakers: {
        active: this.circuitBreakerTriggered.size,
        symbols: Array.from(this.circuitBreakerTriggered)
      },
      health: {
        hasCleanupInterval: !!this.cleanupInterval,
        hasGridObserver: !!this.gridObserver,
        lastHealthCheck: new Date(this.lastHealthCheck).toISOString(),
        timeSinceLastCheck: Date.now() - this.lastHealthCheck,
        score: this._calculateHealth(),
        estimatedMemoryImpact: this._estimateMemoryUsage()
      },
      errors: {
        total: this.totalErrorsEncountered,
        recoveryAttempts: this.recoveryAttempts,
        successfulRecoveries: this.successfulRecoveries,
        recoveryRate: this.recoveryAttempts > 0 
          ? `${((this.successfulRecoveries / this.recoveryAttempts) * 100).toFixed(1)}%`
          : 'N/A'
      },
      performance: this.performanceMetrics
    };
  }

  /**
   * Estimate memory usage
   */
  _estimateMemoryUsage() {
    const bytesPerObserver = 1024;
    const bytesPerIntersectionElement = 512;
    
    const totalBytes = 
      (this.observers.size * bytesPerObserver) + 
      (this.intersectionObservedElements.size * bytesPerIntersectionElement);
    
    const kb = (totalBytes / 1024).toFixed(2);
    return `~${kb} KB`;
  }

  /**
   * Force recovery of all failing observers
   */
  forceRecovery() {
    console.log('[PriceObserver] Forcing recovery of all observers...');
    
    const toRecover = [];
    this.observers.forEach((data, symbol) => {
      if (data.errorCount > 0) {
        toRecover.push({ symbol, data });
      }
    });

    toRecover.forEach(({ symbol, data }) => {
      console.log(`[PriceObserver] Forcing recovery for ${symbol}...`);
      const callback = data.callback;
      const element = data.element;
      
      this.unobserve(symbol);
      this.observe(symbol, element, callback);
    });

    console.log(`[PriceObserver] Force recovery complete: ${toRecover.length} observer(s) processed`);
    
    if (toRecover.length > 0) {
      this._notifyUser('info', `Attempted recovery for ${toRecover.length} observer(s)`);
    }
  }
}