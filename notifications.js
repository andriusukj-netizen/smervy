// paper-trader/notifications.js
// Minimal toast/notification helper used by other modules, now with desktop and sound trade alert support.
// FIXED: Memory leak - proper cleanup of event listeners
// FIXED: Prevent sound error spam, play sound only after user interaction, robust error handling.

export default class Notifications {
  constructor() {
    this.container = null;
    this._ensureContainer();

    this.enableDesktopAlerts = JSON.parse(localStorage.getItem('ptEnableDesktopAlerts') ?? 'true');
    this.enableTradeSound = JSON.parse(localStorage.getItem('ptEnableTradeSound') ?? 'true');

    this._soundSources = [
      'paper-trader/sounds/trade.mp3',
      'https://cdn.freesound.org/previews/341/341695_5858296-lq.mp3',
      'https://cdn.freesound.org/previews/456/456966_5674468-lq.mp3',
    ];

    this.soundSrc = localStorage.getItem('ptTradeSoundSrc') || this._getDefaultSound();

    this._audio = null;
    this._audioReady = false;
    this._audioLoadFailed = false;
    this._soundErrorShown = false;
    if (this.enableTradeSound) {
      this._preloadAudio();
    }

    // FIXED: Store listener reference for proper cleanup
    this._userInteracted = false;
    this._interactionListener = () => { 
      this._userInteracted = true;
      this._cleanupInteractionListener();
    };
    
    // FIXED: Track all event types we listen to for complete cleanup
    this._eventListeners = [];
    
    // Register interaction listeners on multiple events for better coverage
    this._registerInteractionListeners();
  }

  /**
   * FIXED: Register interaction listeners with proper cleanup tracking
   */
  _registerInteractionListeners() {
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    
    events.forEach(eventType => {
      // Store reference with event type for cleanup
      const listener = () => {
        this._userInteracted = true;
        this._cleanupInteractionListener();
      };
      
      document.addEventListener(eventType, listener, { once: true, passive: true });
      
      // Track for manual cleanup if destroyed before interaction
      this._eventListeners.push({ eventType, listener });
    });
  }

  /**
   * FIXED: Clean up interaction listeners once triggered
   */
  _cleanupInteractionListener() {
    // Remove all tracked listeners
    this._eventListeners.forEach(({ eventType, listener }) => {
      try {
        document.removeEventListener(eventType, listener);
      } catch (e) {
        // Listener might already be removed by { once: true }
      }
    });
    
    this._eventListeners = [];
  }

  _ensureContainer() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 11000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  _show(msg, background = '#1e2028') {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
      padding: 10px 14px;
      border-radius: 10px;
      color: #fff;
      background: ${background};
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      opacity: 0;
      transform: translateY(8px);
      transition: all 0.28s ease-out;
      pointer-events: auto;
      max-width: 300px;
      word-wrap: break-word;
    `;
    this.container.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(18px)';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  info(msg) { this._show(msg, '#2563eb'); }
  success(msg) { this._show(msg, '#16a34a'); }
  error(msg) { this._show(msg, '#dc2626'); }
  warning(msg) { this._show(msg, '#f59e0b'); }
  
  clearAll() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  // ----- Desktop Notification -----
  showTradeNotification(message) {
    if (!this.enableDesktopAlerts) return;

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Paper Trader", {
          body: message,
          icon: "https://cdn-icons-png.flaticon.com/512/2740/2740676.png",
          badge: "https://cdn-icons-png.flaticon.com/512/2740/2740676.png",
          tag: "paper-trader-trade",
          requireInteraction: false,
          silent: true
        });
      } catch (e) {
        console.warn('[Notifications] Desktop notification failed:', e);
      }
    }
  }

  // ----- Audio Preloading with Fallback -----
  _getDefaultSound() {
    return this._soundSources[0];
  }

  _preloadAudio() {
    if (this._audioReady && this._audio) return;

    this._audioReady = false;
    this._audioLoadFailed = false;

    this._tryLoadAudio(this.soundSrc || this._soundSources[0], 0);
  }

  _tryLoadAudio(src, fallbackIndex = 0) {
    try {
      this._audio = new Audio(src);
      this._audio.volume = 0.45;
      this._audio.preload = 'auto';

      // FIXED: Store event handler references for cleanup
      const canPlayHandler = () => {
        this._audioReady = true;
        this._audioLoadFailed = false;
        this._soundErrorShown = false;
        console.log('[Notifications] Audio ready:', src);
      };

      const errorHandler = (e) => {
        console.warn('[Notifications] Audio load failed for:', src);
        
        // FIXED: Clean up failed audio instance
        if (this._audio) {
          this._audio.removeEventListener('canplaythrough', canPlayHandler);
          this._audio.removeEventListener('error', errorHandler);
          this._audio = null;
        }
        
        this._audioReady = false;

        if (fallbackIndex < this._soundSources.length - 1) {
          const nextSrc = this._soundSources[fallbackIndex + 1];
          setTimeout(() => {
            this._tryLoadAudio(nextSrc, fallbackIndex + 1);
          }, 100);
        } else {
          this._audioLoadFailed = true;
          if (!this._soundErrorShown) {
            this.error('All trade sound sources failed to load. Please check your connection or upload a custom sound.');
            this._soundErrorShown = true;
          }
        }
      };

      this._audio.addEventListener('canplaythrough', canPlayHandler, { once: true });
      this._audio.addEventListener('error', errorHandler, { once: true });
      
    } catch (e) {
      console.warn('[Notifications] Audio initialization failed:', e);
      this._audio = null;
      this._audioReady = false;
      
      if (fallbackIndex < this._soundSources.length - 1) {
        this._tryLoadAudio(this._soundSources[fallbackIndex + 1], fallbackIndex + 1);
      } else {
        this._audioLoadFailed = true;
        if (!this._soundErrorShown) {
          this.error('All trade sound sources failed to load. Please check your connection or upload a custom sound.');
          this._soundErrorShown = true;
        }
      }
    }
  }

  // ----- Trade Sound Playback with Smart Fallback -----
  playTradeSound() {
    if (!this.enableTradeSound) return;
    
    if (this._audioLoadFailed) {
      if (!this._soundErrorShown) {
        this.error('Trade sound is unavailable (all sound sources failed).');
        this._soundErrorShown = true;
      }
      return;
    }
    
    if (!this._userInteracted) {
      // Wait for user to interact before playing sound
      console.log('[Notifications] Waiting for user interaction before playing sound');
      return;
    }
    
    try {
      if (this._audioReady && this._audio) {
        this._audio.currentTime = 0;
        const playPromise = this._audio.play();
        
        if (playPromise !== undefined) {
          playPromise.catch(e => {
            console.warn('[Notifications] Audio play failed (may need user interaction):', e);
          });
        }
        return;
      }
      
      if (!this._audio || !this._audioReady) {
        this._playWithFallback(0);
      }
    } catch (e) {
      console.warn('[Notifications] Audio error:', e);
    }
  }

  _playWithFallback(sourceIndex) {
    if (sourceIndex >= this._soundSources.length) {
      this._audioLoadFailed = true;
      if (!this._soundErrorShown) {
        this.error('All trade sound sources failed to load. Please check your connection or upload a custom sound.');
        this._soundErrorShown = true;
      }
      return;
    }

    if (!this._userInteracted) return;

    try {
      const audio = new Audio(this._soundSources[sourceIndex]);
      audio.volume = 0.45;

      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (sourceIndex < this._soundSources.length - 1) {
            this._playWithFallback(sourceIndex + 1);
          } else {
            this._audioLoadFailed = true;
            if (!this._soundErrorShown) {
              this.error('All trade sound sources failed to load. Please check your connection or upload a custom sound.');
              this._soundErrorShown = true;
            }
          }
        });
      }
    } catch (e) {
      if (sourceIndex < this._soundSources.length - 1) {
        this._playWithFallback(sourceIndex + 1);
      } else {
        this._audioLoadFailed = true;
        if (!this._soundErrorShown) {
          this.error('All trade sound sources failed to load. Please check your connection or upload a custom sound.');
          this._soundErrorShown = true;
        }
      }
    }
  }

  // ----- Settings Management -----
  setEnableDesktopAlerts(val) {
    this.enableDesktopAlerts = !!val;
    localStorage.setItem('ptEnableDesktopAlerts', JSON.stringify(!!val));
    
    if (val && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  setEnableTradeSound(val) {
    this.enableTradeSound = !!val;
    localStorage.setItem('ptEnableTradeSound', JSON.stringify(!!val));
    
    if (val && !this._audio) {
      this._preloadAudio();
    }
  }

  setTradeSoundSrc(src) {
    if (!src) return;
    
    this.soundSrc = src;
    localStorage.setItem('ptTradeSoundSrc', src);
    
    // FIXED: Clean up old audio before creating new one
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
    
    this._audioReady = false;
    this._audioLoadFailed = false;
    this._soundErrorShown = false;
    
    if (this.enableTradeSound) {
      this._tryLoadAudio(src, 0);
    }
  }

  // ----- Advanced: Custom Sound Selector -----
  static selectUserSound(notificationsInstance) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const url = URL.createObjectURL(file);
        notificationsInstance.setTradeSoundSrc(url);
        notificationsInstance.success('Custom trade sound selected!');
        
        // FIXED: Store object URL for cleanup
        notificationsInstance._customSoundUrl = url;
      }
    };
    
    input.click();
  }

  // ----- Cleanup -----
  destroy() {
    console.log('[Notifications] Destroying instance and cleaning up resources...');
    
    // FIXED: Clean up all toast notifications
    this.clearAll();
    
    // FIXED: Remove container from DOM
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    
    // FIXED: Clean up interaction event listeners
    this._cleanupInteractionListener();
    
    // FIXED: Clean up audio resources
    if (this._audio) {
      try {
        this._audio.pause();
        this._audio.src = ''; // Release the audio resource
        this._audio.load(); // Reset the audio element
        this._audio = null;
      } catch (e) {
        console.warn('[Notifications] Audio cleanup error:', e);
      }
    }
    
    // FIXED: Revoke custom sound URL if exists
    if (this._customSoundUrl) {
      try {
        URL.revokeObjectURL(this._customSoundUrl);
        this._customSoundUrl = null;
      } catch (e) {
        console.warn('[Notifications] Failed to revoke object URL:', e);
      }
    }
    
    // FIXED: Clear all flags
    this._audioReady = false;
    this._audioLoadFailed = false;
    this._userInteracted = false;
    this._soundErrorShown = false;
    
    console.log('[Notifications] Cleanup complete');
  }
}