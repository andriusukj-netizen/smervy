// paper-trader/persistence.js - FIXED VERSION
// FIXES:
// 1. Timer cleanup on destroy
// 2. Immediate save option for critical operations
// 3. Better error recovery with retry logic

const STATE_VERSION = 1;

function debounce(fn, delay = 1000) {
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
  return debounced;
}

export default class Persistence {
  constructor(key = 'paperTraderConnectorState') {
    this.key = key;
    this._debouncedSave = debounce(this._saveInternal.bind(this), 1500);
    this._saveRetryCount = 0;
    this._maxRetries = 3;
    this._destroyed = false;
  }

  save(stateObj, immediate = false) {
    if (this._destroyed) return;
    
    const stateToSave = { ...stateObj, _stateVersion: STATE_VERSION };
    
    if (immediate) {
      this._debouncedSave.flush(stateToSave);
    } else {
      this._debouncedSave(stateToSave);
    }
  }

  _saveInternal(stateObj) {
    if (this._destroyed) return;
    
    try {
      const serialized = JSON.stringify(stateObj);
      
      // Check size before saving
      const sizeMB = new Blob([serialized]).size / 1024 / 1024;
      if (sizeMB > 4.5) {
        console.warn('[Persistence] State size approaching localStorage limit:', sizeMB.toFixed(2) + 'MB');
        this._trimOldData(stateObj);
        return; // Retry with trimmed data
      }
      
      localStorage.setItem(this.key, serialized);
      this._saveRetryCount = 0; // Reset on success
      
    } catch (err) {
      console.error('[Persistence] Save failed:', err);
      
      if (err.name === 'QuotaExceededError') {
        this._handleQuotaExceeded(stateObj);
      } else if (this._saveRetryCount < this._maxRetries) {
        this._saveRetryCount++;
        console.log(`[Persistence] Retrying save (attempt ${this._saveRetryCount}/${this._maxRetries})`);
        setTimeout(() => this._saveInternal(stateObj), 1000);
      } else {
        this._notifyUser('Failed to save state. Your data may be lost on page reload.');
      }
    }
  }

  _trimOldData(stateObj) {
    console.log('[Persistence] Trimming old data...');
    
    // Keep only last 500 trades instead of all
    if (stateObj.trades && stateObj.trades.length > 500) {
      stateObj.trades = stateObj.trades.slice(-500);
    }
    
    // Keep only last 1000 order history items
    if (stateObj.orderHistory && stateObj.orderHistory.length > 1000) {
      stateObj.orderHistory = stateObj.orderHistory.slice(-1000);
    }
    
    // Retry save with trimmed data
    this._saveInternal(stateObj);
  }

  _handleQuotaExceeded(stateObj) {
    console.warn('[Persistence] Storage quota exceeded, trimming data');
    
    // Aggressive trimming
    if (stateObj.trades) stateObj.trades = stateObj.trades.slice(-200);
    if (stateObj.orderHistory) stateObj.orderHistory = stateObj.orderHistory.slice(-200);
    
    try {
      localStorage.setItem(this.key, JSON.stringify(stateObj));
      this._notifyUser('Storage limit reached. Old trade history was trimmed.');
    } catch (e) {
      this._notifyUser('Critical: Unable to save state. Please export your trades.');
    }
  }

  _notifyUser(message) {
    if (typeof window !== 'undefined' && 
        window.paperTraderConnector?.notifications?.warning) {
      window.paperTraderConnector.notifications.warning(message);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      
      const obj = JSON.parse(raw);

      // Version migration
      if (obj._stateVersion && obj._stateVersion < STATE_VERSION) {
        obj = this._migrateState(obj, obj._stateVersion);
      }

      // Validate critical fields
      if (!this._validateState(obj)) {
        console.warn('[Persistence] Invalid state structure, returning null');
        return null;
      }

      // Remove version marker
      if (obj._stateVersion) delete obj._stateVersion;

      return obj;
      
    } catch (err) {
      console.error('[Persistence] Load failed:', err);
      
      // Attempt backup recovery
      const backup = this._loadBackup();
      if (backup) {
        console.log('[Persistence] Recovered from backup');
        return backup;
      }
      
      // Clear corrupted data
      this._handleCorruptedData();
      return null;
    }
  }

  _validateState(obj) {
    if (!obj || typeof obj !== 'object') return false;
    
    // Check required fields exist and have correct types
    const checks = [
      typeof obj.balance === 'number',
      typeof obj.initialBalance === 'number',
      Array.isArray(obj.positions),
      Array.isArray(obj.trades),
      Array.isArray(obj.pendingOrders)
    ];
    
    return checks.every(check => check === true);
  }

  _loadBackup() {
    try {
      const backupKey = this.key + '_backup';
      const raw = localStorage.getItem(backupKey);
      if (!raw) return null;
      
      const obj = JSON.parse(raw);
      return this._validateState(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  _handleCorruptedData() {
    console.warn('[Persistence] Clearing corrupted data');
    try {
      // Move corrupted data to error key for debugging
      const corrupted = localStorage.getItem(this.key);
      if (corrupted) {
        localStorage.setItem(this.key + '_corrupted', corrupted);
      }
      localStorage.removeItem(this.key);
    } catch (e) {
      console.error('[Persistence] Failed to handle corrupted data:', e);
    }
  }

  _migrateState(obj, oldVersion) {
    console.log(`[Persistence] Migrating state from v${oldVersion} to v${STATE_VERSION}`);
    
    // Example migration logic
    if (oldVersion < 1) {
      // Add new fields with defaults
      obj.orderHistory = obj.orderHistory || [];
    }
    
    return obj;
  }

  createBackup() {
    try {
      const current = localStorage.getItem(this.key);
      if (current) {
        localStorage.setItem(this.key + '_backup', current);
        console.log('[Persistence] Backup created');
      }
    } catch (e) {
      console.warn('[Persistence] Backup creation failed:', e);
    }
  }

  clear() {
    try {
      this.createBackup(); // Backup before clearing
      localStorage.removeItem(this.key);
    } catch (e) {
      console.error('[Persistence] Clear failed:', e);
    }
  }

  destroy() {
    console.log('[Persistence] Destroying instance...');
    this._destroyed = true;
    
    // Cancel any pending saves
    if (this._debouncedSave?.cancel) {
      this._debouncedSave.cancel();
    }
    
    console.log('[Persistence] Destroyed');
  }

  // Utility: Get storage usage info
  getStorageInfo() {
    try {
      const item = localStorage.getItem(this.key);
      const sizeBytes = item ? new Blob([item]).size : 0;
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
      
      // Estimate localStorage limit (usually 5-10MB)
      const estimatedLimit = 5;
      const percentUsed = ((sizeBytes / (estimatedLimit * 1024 * 1024)) * 100).toFixed(1);
      
      return {
        sizeBytes,
        sizeMB,
        percentUsed: percentUsed + '%',
        tradeCount: JSON.parse(item || '{}').trades?.length || 0,
        orderHistoryCount: JSON.parse(item || '{}').orderHistory?.length || 0
      };
    } catch (e) {
      return { error: 'Unable to calculate storage info' };
    }
  }
}