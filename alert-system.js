// alert-system.js
// --- TELEGRAM ALERT SUPPORT, ALERT EDITING, SNOOZE, EXPIRY, FLEXIBLE CONDITIONS, EXPORT/IMPORT --- //

// Utility for user Telegram configuration (stored in localStorage)
function getTelegramConfig() {
  try {
    const data = JSON.parse(localStorage.getItem('telegramConfig'));
    return data || { token: '', chatId: '' };
  } catch {
    return { token: '', chatId: '' };
  }
}
function setTelegramConfig({ token, chatId }) {
  localStorage.setItem('telegramConfig', JSON.stringify({ token, chatId }));
}

export class AlertSystem {
  constructor() {
    this.alerts = new Map(); // key: alertId -> { symbol, price, condition, triggered, ... }
    this.subscriptions = new Map(); // key: symbol -> Set of alertIds
    this.notificationQueue = [];
    this.audioContext = null;
    this.loadAlerts();
    this.setupNotificationPermission();
  }

  async setupNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  loadAlerts() {
    try {
      const saved = localStorage.getItem('priceAlerts');
      if (saved) {
        const data = JSON.parse(saved);
        data.forEach(alert => {
          this.alerts.set(alert.id, alert);
          if (!this.subscriptions.has(alert.symbol)) {
            this.subscriptions.set(alert.symbol, new Set());
          }
          this.subscriptions.get(alert.symbol).add(alert.id);
        });
      }
    } catch (err) {
      console.warn('[AlertSystem] Failed to load alerts:', err);
    }
  }

  saveAlerts() {
    try {
      const data = Array.from(this.alerts.values());
      localStorage.setItem('priceAlerts', JSON.stringify(data));
    } catch (err) {
      console.warn('[AlertSystem] Failed to save alerts:', err);
    }
  }

  // --- ALERT CREATION ---
  createAlert(symbol, price, condition, note = '', opts = {}) {
    const id = opts.id || `${symbol}-${price}-${condition}-${Date.now()}`;
    const alert = {
      id,
      symbol: symbol.toUpperCase(),
      price: parseFloat(price),
      condition, // { type: 'above'|'below'|'cross'|'percent'|'range', ... }
      note,
      triggered: false,
      snoozeUntil: null,
      expiresAt: opts.expiresAt || null,
      createdAt: Date.now()
    };
    if (opts.editing) {
      // If editing, overwrite existing alert
      this.alerts.set(id, { ...this.alerts.get(id), ...alert });
    } else {
      this.alerts.set(id, alert);
    }
    if (!this.subscriptions.has(alert.symbol)) {
      this.subscriptions.set(alert.symbol, new Set());
    }
    this.subscriptions.get(alert.symbol).add(id);
    this.saveAlerts();
    return id;
  }

  // --- ALERT EDITING ---
  editAlert(alertId, updates) {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    const updated = { ...alert, ...updates };
    if (updates.symbol && updates.symbol !== alert.symbol) {
      // Remove from old subscriptions, add to new
      const oldSym = alert.symbol;
      this.subscriptions.get(oldSym)?.delete(alertId);
      if (this.subscriptions.get(oldSym)?.size === 0) {
        this.subscriptions.delete(oldSym);
      }
      if (!this.subscriptions.has(updates.symbol)) {
        this.subscriptions.set(updates.symbol, new Set());
      }
      this.subscriptions.get(updates.symbol).add(alertId);
    }
    this.alerts.set(alertId, updated);
    this.saveAlerts();
    return true;
  }

  // --- ALERT DELETION ---
  deleteAlert(alertId) {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    this.alerts.delete(alertId);
    const symbolAlerts = this.subscriptions.get(alert.symbol);
    if (symbolAlerts) {
      symbolAlerts.delete(alertId);
      if (symbolAlerts.size === 0) {
        this.subscriptions.delete(alert.symbol);
      }
    }
    this.saveAlerts();
    return true;
  }

  // --- SNOOZE/DISMISS ---
  snoozeAlert(alertId, minutes) {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    alert.snoozeUntil = Date.now() + (minutes * 60 * 1000);
    alert.triggered = false;
    alert.triggeredAt = null;
    alert.triggeredPrice = null;
    this.saveAlerts();
    return true;
  }

  dismissAlert(alertId) {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    alert.triggered = false;
    alert.triggeredAt = null;
    alert.triggeredPrice = null;
    this.saveAlerts();
    return true;
  }

  // --- EXPIRY CHECK ---
  cleanExpiredAlerts() {
    const now = Date.now();
    Array.from(this.alerts.values())
      .filter(a => a.expiresAt && now > a.expiresAt)
      .forEach(a => this.deleteAlert(a.id));
  }

  // --- FLEXIBLE ALERT CONDITIONS ---
  checkPrice(symbol, currentPrice, lastPrice = null) {
    this.cleanExpiredAlerts();
    const symbolAlerts = this.subscriptions.get(symbol.toUpperCase());
    if (!symbolAlerts || symbolAlerts.size === 0) return;
    symbolAlerts.forEach(alertId => {
      const alert = this.alerts.get(alertId);
      if (!alert || alert.triggered) return;

      // Snooze logic
      if (alert.snoozeUntil && Date.now() < alert.snoozeUntil) return;

      let shouldTrigger = false;
      const cond = alert.condition;
      if (typeof cond === 'string') {
        // Backwards compatible
        if (cond === 'above' && currentPrice >= alert.price) shouldTrigger = true;
        else if (cond === 'below' && currentPrice <= alert.price) shouldTrigger = true;
      } else if (cond?.type === 'cross') {
        // Requires lastPrice - price crossing the threshold
        if (lastPrice != null) {
          if ((lastPrice < cond.value && currentPrice >= cond.value) ||
              (lastPrice > cond.value && currentPrice <= cond.value)) {
            shouldTrigger = true;
          }
        }
      } else if (cond?.type === 'percent') {
        // % move from alert.price
        const pctMove = Math.abs((currentPrice - alert.price) / alert.price) * 100;
        if (pctMove >= cond.percent) shouldTrigger = true;
      } else if (cond?.type === 'range') {
        // Price in range [min, max]
        if (currentPrice >= cond.min && currentPrice <= cond.max) shouldTrigger = true;
      }
      // Extend with more conditions as needed...

      if (shouldTrigger) {
        this.triggerAlert(alert, currentPrice);
      }
    });
  }

  // --- TELEGRAM ALERT: Per-user configuration ---
  async sendTelegramAlert(message, config = null) {
    const telegram = config || getTelegramConfig();
    if (!telegram.token || !telegram.chatId) return;
    const url = `https://api.telegram.org/bot${telegram.token}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegram.chatId,
          text: message,
          parse_mode: "Markdown"
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn('[AlertSystem] Failed to send Telegram alert:', errText);
      }
    } catch (err) {
      console.warn('[AlertSystem] Telegram alert error:', err);
    }
  }

  // --- ALERT TRIGGER ---
  triggerAlert(alert, currentPrice) {
    alert.triggered = true;
    alert.triggeredAt = Date.now();
    alert.triggeredPrice = currentPrice;
    this.saveAlerts();
    const condType = typeof alert.condition === 'string' ? alert.condition : alert.condition.type;
    let condText = condType === 'cross' ? 'crossed' : condType;
    const message = `${alert.symbol} ${condText} $${alert.price.toFixed(2)}! Current: $${currentPrice.toFixed(2)}`;
    this.playSound();
    this.showNotification(alert.symbol, message);
    this.showBanner(message);
    // --- Send Telegram alert ---
    this.sendTelegramAlert(
      `🔔 *${alert.symbol}* ${condText} *$${alert.price.toFixed(2)}*\n_Current: $${currentPrice.toFixed(2)}_${alert.note ? `\nNote: ${alert.note}` : ''}`
    );
    if (window.updateAlertUI) {
      window.updateAlertUI();
    }
  }

  playSound() {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
      oscillator.frequency.setValueAtTime(1000, this.audioContext.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.3);
    } catch (err) {
      console.warn('[AlertSystem] Failed to play sound:', err);
    }
  }

  showNotification(title, message) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: message,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">🔔</text></svg>',
          badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">📈</text></svg>'
        });
      } catch (err) {
        console.warn('[AlertSystem] Failed to show notification:', err);
      }
    }
  }

  showBanner(message) {
    const banner = document.createElement('div');
    banner.className = 'alert-banner';
    banner.textContent = message;
    banner.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      z-index: 10000;
      font-weight: 600;
      font-size: 16px;
      animation: slideDown 0.3s ease-out;
      max-width: 90%;
      text-align: center;
    `;
    // Add snooze/dismiss buttons
    const snoozeBtn = document.createElement('button');
    snoozeBtn.textContent = 'Snooze 15min';
    snoozeBtn.style.cssText = 'margin-left:24px;background:#2ecc71;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;';
    snoozeBtn.onclick = () => {
      const alert = Array.from(this.alerts.values()).find(a => message.includes(a.symbol));
      if (alert) this.snoozeAlert(alert.id, 15);
      banner.remove();
      if (window.updateAlertUI) window.updateAlertUI();
    };
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText = 'margin-left:10px;background:#d7263d;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;';
    dismissBtn.onclick = () => {
      const alert = Array.from(this.alerts.values()).find(a => message.includes(a.symbol));
      if (alert) this.dismissAlert(alert.id);
      banner.remove();
      if (window.updateAlertUI) window.updateAlertUI();
    };
    banner.appendChild(snoozeBtn);
    banner.appendChild(dismissBtn);

    document.body.appendChild(banner);

    setTimeout(() => {
      banner.style.animation = 'slideUp 0.3s ease-in';
      setTimeout(() => banner.remove(), 300);
    }, 5000);
  }

  getAlerts(symbol = null) {
    this.cleanExpiredAlerts();
    if (symbol) {
      const symbolAlerts = this.subscriptions.get(symbol.toUpperCase());
      if (!symbolAlerts) return [];
      return Array.from(symbolAlerts).map(id => this.alerts.get(id)).filter(Boolean);
    }
    return Array.from(this.alerts.values());
  }

  clearTriggeredAlerts() {
    const triggered = Array.from(this.alerts.values()).filter(a => a.triggered);
    triggered.forEach(a => this.deleteAlert(a.id));
  }

  // --- EXPORT / IMPORT ---
  exportAlerts() {
    const data = Array.from(this.alerts.values());
    return JSON.stringify(data, null, 2);
  }

  importAlerts(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data)) throw new Error("Invalid alerts JSON");
      data.forEach(alert => {
        this.createAlert(
          alert.symbol,
          alert.price,
          alert.condition,
          alert.note,
          { id: alert.id, expiresAt: alert.expiresAt, editing: true }
        );
      });
      this.saveAlerts();
      if (window.updateAlertUI) window.updateAlertUI();
      return true;
    } catch (e) {
      console.warn('[AlertSystem] Failed to import alerts:', e);
      return false;
    }
  }

  destroy() {
    this.alerts.clear();
    this.subscriptions.clear();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Export singleton
const alertSystemInstance = new AlertSystem();
export default alertSystemInstance;

// Export Telegram config helpers for UI use
export { getTelegramConfig, setTelegramConfig };