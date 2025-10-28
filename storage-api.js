// paper-trader/storage-api.js
// FIXED: Implement missing window.storage API referenced in documentation
// Provides persistent key-value storage with personal/shared scopes
// Uses localStorage as backend with namespacing and error handling

/**
 * Storage API implementation for Paper Trading artifacts
 * Provides persistent storage with personal and shared scopes
 */
class StorageAPI {
  constructor(namespace = 'paperTrader') {
    this.namespace = namespace;
    this.personalPrefix = `${namespace}:personal:`;
    this.sharedPrefix = `${namespace}:shared:`;
    this.maxKeyLength = 200;
    this.maxValueSize = 5 * 1024 * 1024; // 5MB per value
    this.requestCount = 0;
    this.requestLimit = 100; // per hour
    this.requestWindow = 60 * 60 * 1000; // 1 hour
    this.requestTimestamps = [];
    
    // Initialize on window object
    if (typeof window !== 'undefined') {
      window.storage = this;
    }
  }

  /**
   * Validate key format
   */
  _validateKey(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }

    if (key.length > this.maxKeyLength) {
      throw new Error(`Key exceeds maximum length of ${this.maxKeyLength} characters`);
    }

    // Check for invalid characters
    if (/[\s\/\\'"]/g.test(key)) {
      throw new Error('Key cannot contain whitespace, slashes, or quotes');
    }

    return true;
  }

  /**
   * Validate value size
   */
  _validateValue(value) {
    if (value === null || value === undefined) {
      throw new Error('Value cannot be null or undefined');
    }

    const size = new Blob([String(value)]).size;
    if (size > this.maxValueSize) {
      throw new Error(`Value exceeds maximum size of ${this.maxValueSize / 1024 / 1024}MB`);
    }

    return true;
  }

  /**
   * Check rate limit
   */
  _checkRateLimit() {
    const now = Date.now();
    
    // Remove timestamps outside window
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => now - ts < this.requestWindow
    );

    if (this.requestTimestamps.length >= this.requestLimit) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    this.requestTimestamps.push(now);
    return true;
  }

  /**
   * Get full key with prefix
   */
  _getFullKey(key, shared = false) {
    const prefix = shared ? this.sharedPrefix : this.personalPrefix;
    return `${prefix}${key}`;
  }

  /**
   * Get a value from storage
   * @param {string} key - The key to retrieve
   * @param {boolean} shared - Whether to access shared storage
   * @returns {Object|null} - {key, value, shared} or null if not found
   */
  async get(key, shared = false) {
    try {
      this._validateKey(key);
      
      const fullKey = this._getFullKey(key, shared);
      const value = localStorage.getItem(fullKey);

      if (value === null) {
        throw new Error(`Key not found: ${key}`);
      }

      return {
        key,
        value,
        shared
      };
    } catch (error) {
      console.error('[StorageAPI] Get error:', error);
      throw error;
    }
  }

  /**
   * Set a value in storage
   * @param {string} key - The key to set
   * @param {string} value - The value to store (must be string)
   * @param {boolean} shared - Whether to use shared storage
   * @returns {Object|null} - {key, value, shared} or null on failure
   */
  async set(key, value, shared = false) {
    try {
      this._validateKey(key);
      this._validateValue(value);
      this._checkRateLimit();

      const fullKey = this._getFullKey(key, shared);
      
      // Try to set the value
      localStorage.setItem(fullKey, String(value));

      console.log(`[StorageAPI] Set ${shared ? 'shared' : 'personal'} key: ${key}`);

      return {
        key,
        value: String(value),
        shared
      };
    } catch (error) {
      console.error('[StorageAPI] Set error:', error);
      
      // Handle quota exceeded
      if (error.name === 'QuotaExceededError') {
        console.warn('[StorageAPI] Storage quota exceeded');
        return null;
      }
      
      throw error;
    }
  }

  /**
   * Delete a value from storage
   * @param {string} key - The key to delete
   * @param {boolean} shared - Whether to access shared storage
   * @returns {Object|null} - {key, deleted: true, shared} or null
   */
  async delete(key, shared = false) {
    try {
      this._validateKey(key);

      const fullKey = this._getFullKey(key, shared);
      localStorage.removeItem(fullKey);

      console.log(`[StorageAPI] Deleted ${shared ? 'shared' : 'personal'} key: ${key}`);

      return {
        key,
        deleted: true,
        shared
      };
    } catch (error) {
      console.error('[StorageAPI] Delete error:', error);
      throw error;
    }
  }

  /**
   * List keys with optional prefix filter
   * @param {string} prefix - Optional prefix to filter keys
   * @param {boolean} shared - Whether to access shared storage
   * @returns {Object|null} - {keys: string[], prefix?, shared} or null
   */
  async list(prefix = '', shared = false) {
    try {
      const storagePrefix = shared ? this.sharedPrefix : this.personalPrefix;
      const searchPrefix = `${storagePrefix}${prefix}`;
      const keys = [];

      // Iterate through localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        
        if (fullKey && fullKey.startsWith(searchPrefix)) {
          // Remove storage prefix to get user key
          const userKey = fullKey.substring(storagePrefix.length);
          keys.push(userKey);
        }
      }

      return {
        keys,
        prefix: prefix || undefined,
        shared
      };
    } catch (error) {
      console.error('[StorageAPI] List error:', error);
      throw error;
    }
  }

  /**
   * Clear all storage for this namespace
   * @param {boolean} shared - Whether to clear shared storage
   */
  async clear(shared = false) {
    try {
      const prefix = shared ? this.sharedPrefix : this.personalPrefix;
      const keysToRemove = [];

      // Find all keys with this prefix
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      // Remove them
      keysToRemove.forEach(key => localStorage.removeItem(key));

      console.log(`[StorageAPI] Cleared ${keysToRemove.length} ${shared ? 'shared' : 'personal'} keys`);

      return {
        cleared: keysToRemove.length,
        shared
      };
    } catch (error) {
      console.error('[StorageAPI] Clear error:', error);
      throw error;
    }
  }

  /**
   * Get storage usage statistics
   */
  getStats() {
    try {
      let personalCount = 0;
      let personalSize = 0;
      let sharedCount = 0;
      let sharedSize = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        const value = localStorage.getItem(key);
        const size = new Blob([value || '']).size;

        if (key.startsWith(this.personalPrefix)) {
          personalCount++;
          personalSize += size;
        } else if (key.startsWith(this.sharedPrefix)) {
          sharedCount++;
          sharedSize += size;
        }
      }

      return {
        personal: {
          count: personalCount,
          sizeBytes: personalSize,
          sizeMB: (personalSize / 1024 / 1024).toFixed(2)
        },
        shared: {
          count: sharedCount,
          sizeBytes: sharedSize,
          sizeMB: (sharedSize / 1024 / 1024).toFixed(2)
        },
        total: {
          count: personalCount + sharedCount,
          sizeBytes: personalSize + sharedSize,
          sizeMB: ((personalSize + sharedSize) / 1024 / 1024).toFixed(2)
        },
        rateLimit: {
          requests: this.requestTimestamps.length,
          limit: this.requestLimit,
          remaining: this.requestLimit - this.requestTimestamps.length
        }
      };
    } catch (error) {
      console.error('[StorageAPI] Stats error:', error);
      return null;
    }
  }

  /**
   * Test storage functionality
   */
  async test() {
    console.log('[StorageAPI] Running self-test...');
    
    try {
      // Test set
      await this.set('test:key', 'test-value', false);
      console.log('✅ Set personal key');

      // Test get
      const result = await this.get('test:key', false);
      if (result.value !== 'test-value') {
        throw new Error('Get returned wrong value');
      }
      console.log('✅ Get personal key');

      // Test list
      const list = await this.list('test:', false);
      if (!list.keys.includes('test:key')) {
        throw new Error('List did not include test key');
      }
      console.log('✅ List keys');

      // Test delete
      await this.delete('test:key', false);
      console.log('✅ Delete key');

      // Verify deletion
      try {
        await this.get('test:key', false);
        throw new Error('Key should not exist after deletion');
      } catch (e) {
        if (e.message.includes('not found')) {
          console.log('✅ Verified deletion');
        } else {
          throw e;
        }
      }

      console.log('[StorageAPI] ✅ All tests passed');
      return true;
    } catch (error) {
      console.error('[StorageAPI] ❌ Test failed:', error);
      return false;
    }
  }
}

// Initialize storage API
const storageAPI = new StorageAPI('paperTrader');

// Expose for import in index.js
export { StorageAPI, storageAPI };
export default storageAPI;

// Also make available globally
if (typeof window !== 'undefined') {
  window.storage = storageAPI;
  
  // Auto-run test in development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    setTimeout(() => {
      storageAPI.test().then(success => {
        if (success) {
          console.log('🟢 Storage API ready');
        } else {
          console.warn('🟡 Storage API test failed - functionality may be limited');
        }
      });
    }, 1000);
  }
}