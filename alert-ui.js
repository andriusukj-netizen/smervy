// alert-ui.js - Enhanced: Edit Alerts, Snooze/Dismiss, Expiry, Flexible Conditions, Telegram Config, Export/Import
import AlertSystem, { getTelegramConfig, setTelegramConfig } from './alert-system.js';

// --- Main UI Setup ---
export function setupAlertUI() {
  addAlertStyles();
  const modal = createAlertModal();
  document.body.appendChild(modal);

  setupGlobalAlertButton();
  setupCardAlertButtons();

  window.updateAlertUI = updateAlertList;

  updateAlertList();
  setupExportImportUI();
  setupTelegramConfigUI();

  // Return a cleanup function so the app can remove UI when shutting down
  return function cleanupAlertUI() {
    try {
      // Remove modal
      const modalEl = document.getElementById('alert-modal');
      if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);

      // Remove global alert button
      const btn = document.getElementById('global-alert-btn');
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);

      // Remove updateAlertUI global hook
      try { delete window.updateAlertUI; } catch {}

      // Remove handlers added to document (import input etc.)
      const importInput = document.getElementById('import-alerts-input');
      if (importInput) importInput.onchange = null;
      const exportBtn = document.getElementById('export-alerts-btn');
      if (exportBtn) exportBtn.onclick = null;
      const saveBtn = document.getElementById('save-telegram-config-btn');
      if (saveBtn) saveBtn.onclick = null;
      // Clear any banners created by showBanner (best-effort)
      document.querySelectorAll('.alert-banner').forEach(b => b.remove());
    } catch (err) {
      console.warn('[AlertUI] cleanup failed', err);
    }
  };
}

// --- Styles ---
function addAlertStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideDown {
      from { transform: translate(-50%, -100%); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }
    @keyframes slideUp {
      from { transform: translate(-50%, 0); opacity: 1; }
      to { transform: translate(-50%, -100%); opacity: 0; }
    }
    .alert-modal-content { animation: modalFadeIn 0.3s ease-out; }
    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    .alert-edit-form label { font-size:13px; color:var(--muted); margin-bottom:3px; }
    .alert-edit-form input, .alert-edit-form select { width:100%; padding:7px; background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; font-size:14px; margin-bottom:8px; }
    .alert-export-import-panel { margin-top:16px; padding:10px; background:var(--panel); border-radius:8px; border:1px solid var(--border); }
    .telegram-config-panel { margin-top:16px; padding:10px; background:var(--panel); border-radius:8px; border:1px solid var(--border); }
  `;
  document.head.appendChild(style);
}

// --- Alert Modal w/ Edit, New, Expiry, Condition Types ---
function createAlertModal() {
  const modal = document.createElement('div');
  modal.id = 'alert-modal';
  modal.style.cssText = `
    display: none;
    position: fixed;
    z-index: 99999;
    left: 0; top: 0; width: 100vw; height: 100vh;
    background: rgba(16,20,30,0.92);
    backdrop-filter: blur(4px);
  `;

  modal.innerHTML = `
    <div class="alert-modal-content" style="margin: 60px auto 0 auto; max-width: 650px; background: var(--panel); border-radius: 12px; box-shadow: 0 6px 32px rgba(0,0,0,0.4); padding: 24px; max-height: 80vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="color: var(--accent); margin: 0;">Price Alerts</h2>
        <button id="close-alert-modal" style="background: transparent; border: none; color: var(--muted); font-size: 24px; cursor: pointer; padding: 0 8px;">✕</button>
      </div>
      <form id="alert-edit-form" class="alert-edit-form" autocomplete="off">
        <h3 style="margin: 0 0 12px; font-size: 15px; color: var(--text);">Create/Edit Alert</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label>Symbol</label>
            <input type="text" id="alert-symbol" placeholder="BTCUSDT" required>
          </div>
          <div>
            <label>Price</label>
            <input type="number" id="alert-price" placeholder="50000" step="0.01" required>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label>Condition</label>
            <select id="alert-condition-type">
              <option value="above">Above</option>
              <option value="below">Below</option>
              <option value="cross">Crosses</option>
              <option value="percent">Percent Move</option>
              <option value="range">Range</option>
            </select>
          </div>
          <div id="alert-condition-extra"></div>
        </div>
        <div>
          <label>Expiry (Optional)</label>
          <input type="datetime-local" id="alert-expiry">
        </div>
        <div>
          <label>Note (Optional)</label>
          <input type="text" id="alert-note" placeholder="Optional note...">
        </div>
        <input type="hidden" id="alert-edit-id">
        <div style="margin-top:12px;">
          <button type="submit" id="create-alert-btn" style="background: var(--ok); color: white; border: none; border-radius: 6px; padding: 8px 18px; font-size: 14px; cursor: pointer; font-weight: 600;">Save Alert</button>
          <button type="button" id="cancel-alert-edit-btn" style="background: var(--danger); color: white; border: none; border-radius: 6px; padding: 8px 18px; font-size: 14px; cursor: pointer; font-weight: 600; margin-left:10px;">Cancel</button>
        </div>
      </form>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:15px;color:var(--text);">Active Alerts</h3>
        <button id="clear-triggered-alerts" style="background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Clear Triggered</button>
      </div>
      <div id="alert-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto;">
        <p style="text-align: center; color: var(--muted); padding: 20px;">No alerts yet</p>
      </div>
      <div class="alert-export-import-panel">
        <h3 style="margin:0;font-size:15px;color:var(--accent);">Export / Import Alerts</h3>
        <button id="export-alerts-btn" style="background:var(--accent);color:white;border:none;border-radius:6px;padding:8px 16px;margin-top:8px;cursor:pointer;">Export</button>
        <input type="file" id="import-alerts-input" accept=".json" style="margin-left:12px;">
        <span id="import-alerts-status" style="margin-left:8px;font-size:13px;color:var(--muted);"></span>
      </div>
      <div class="telegram-config-panel">
        <h3 style="margin:0;font-size:15px;color:var(--accent);">Telegram Alert Config</h3>
        <label>Bot Token</label>
        <input type="text" id="telegram-token" placeholder="Bot Token">
        <label>Chat ID</label>
        <input type="text" id="telegram-chatid" placeholder="Chat ID">
        <button id="save-telegram-config-btn" style="background:var(--ok);color:white;border:none;border-radius:6px;padding:8px 16px;margin-top:8px;cursor:pointer;">Save Telegram Config</button>
        <span id="telegram-config-status" style="margin-left:8px;font-size:13px;color:var(--muted);"></span>
      </div>
    </div>
  `;

  // --- Modal Events ---
  modal.querySelector('#close-alert-modal').onclick = () => {
    modal.style.display = 'none';
    resetAlertEditForm();
  };
  modal.querySelector('#cancel-alert-edit-btn').onclick = () => {
    modal.style.display = 'none';
    resetAlertEditForm();
  };

  // --- Condition Type Change: Show extra fields ---
  const condTypeSelect = modal.querySelector('#alert-condition-type');
  const condExtraDiv = modal.querySelector('#alert-condition-extra');
  function updateConditionExtra() {
    const type = condTypeSelect.value;
    condExtraDiv.innerHTML = "";
    if (type === "cross") {
      condExtraDiv.innerHTML = `<label>Threshold</label><input type="number" id="alert-cross-value" placeholder="Price threshold" step="0.01">`;
    } else if (type === "percent") {
      condExtraDiv.innerHTML = `<label>Percent Move</label><input type="number" id="alert-percent-value" placeholder="%" min="0.01" step="0.01">`;
    } else if (type === "range") {
      condExtraDiv.innerHTML = `<label>Min</label><input type="number" id="alert-range-min" placeholder="Min" step="0.01"><label>Max</label><input type="number" id="alert-range-max" placeholder="Max" step="0.01">`;
    }
  }
  condTypeSelect.onchange = updateConditionExtra;
  updateConditionExtra();

  // --- Create/Edit Alert Form Submit ---
  modal.querySelector('#alert-edit-form').onsubmit = (e) => {
    e.preventDefault();
    const symbol = modal.querySelector('#alert-symbol').value.trim().toUpperCase();
    const price = parseFloat(modal.querySelector('#alert-price').value);
    const condType = condTypeSelect.value;
    let condition;
    if (condType === 'above' || condType === 'below') {
      condition = condType;
    } else if (condType === 'cross') {
      const val = parseFloat(modal.querySelector('#alert-cross-value').value);
      condition = { type: 'cross', value: val };
    } else if (condType === 'percent') {
      const pct = parseFloat(modal.querySelector('#alert-percent-value').value);
      condition = { type: 'percent', percent: pct };
    } else if (condType === 'range') {
      const min = parseFloat(modal.querySelector('#alert-range-min').value);
      const max = parseFloat(modal.querySelector('#alert-range-max').value);
      condition = { type: 'range', min, max };
    }
    const expiryValue = modal.querySelector('#alert-expiry').value;
    const expiresAt = expiryValue ? (new Date(expiryValue)).getTime() : null;
    const note = modal.querySelector('#alert-note').value.trim();
    const editId = modal.querySelector('#alert-edit-id').value;

    if (!symbol || !price || price <= 0) {
      alert('Please enter valid symbol and price');
      return;
    }

    if (editId) {
      AlertSystem.editAlert(editId, { symbol, price, condition, note, expiresAt });
    } else {
      AlertSystem.createAlert(symbol, price, condition, note, { expiresAt });
    }

    resetAlertEditForm();
    updateAlertList();
    modal.style.display = 'none';
  };

  // --- Clear Triggered Alerts ---
  modal.querySelector('#clear-triggered-alerts').onclick = () => {
    AlertSystem.clearTriggeredAlerts();
    updateAlertList();
  };

  // --- Modal click outside to close ---
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      resetAlertEditForm();
    }
  };
  return modal;
}

// --- Reset Form ---
function resetAlertEditForm() {
  const modal = document.getElementById('alert-modal');
  if (!modal) return;
  modal.querySelector('#alert-symbol').value = '';
  modal.querySelector('#alert-price').value = '';
  modal.querySelector('#alert-condition-type').value = 'above';
  modal.querySelector('#alert-expiry').value = '';
  modal.querySelector('#alert-note').value = '';
  modal.querySelector('#alert-edit-id').value = '';
  modal.querySelector('#alert-condition-extra').innerHTML = '';
  modal.querySelector('#cancel-alert-edit-btn').style.display = 'none';
  modal.querySelector('#create-alert-btn').textContent = 'Create Alert';
  try { modal.querySelector('#alert-edit-form').reset?.(); } catch {}
  // Redraw extra fields
  modal.querySelector('#alert-condition-type').onchange();
}

// --- Update List UI with Edit/Snooze/Dismiss ---
function updateAlertList() {
  const listContainer = document.getElementById('alert-list');
  if (!listContainer) return;
  const alerts = AlertSystem.getAlerts();

  if (alerts.length === 0) {
    listContainer.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 20px;">No alerts yet</p>';
    return;
  }

  listContainer.innerHTML = alerts.map(alert => {
    const isTriggered = alert.triggered;
    const bgColor = isTriggered ? 'rgba(46, 204, 113, 0.1)' : 'var(--bg)';
    const borderColor = isTriggered ? 'var(--ok)' : 'var(--border)';
    const expiryText = alert.expiresAt ? `<div style="color:var(--muted);font-size:12px;">Expires: ${new Date(alert.expiresAt).toLocaleString()}</div>` : '';
    let condText;
    if (typeof alert.condition === 'string') {
      condText = alert.condition === 'above' ? '↑ Above' : '↓ Below';
    } else if (alert.condition?.type === 'cross') {
      condText = `Crosses $${alert.condition.value}`;
    } else if (alert.condition?.type === 'percent') {
      condText = `±${alert.condition.percent}%`;
    } else if (alert.condition?.type === 'range') {
      condText = `In [$${alert.condition.min}, $${alert.condition.max}]`;
    } else {
      condText = String(alert.condition);
    }

    return `
      <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--accent);font-size:15px;">${alert.symbol}</span>
            <span style="color:var(--text);font-size:14px;">${condText} $${alert.price.toFixed(2)}</span>
            ${isTriggered ? '<span style="background:var(--ok);color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">TRIGGERED</span>' : ''}
          </div>
          ${alert.note ? `<div style="color:var(--muted);font-size:12px;">${alert.note}</div>` : ''}
          ${expiryText}
          ${isTriggered ? `<div style="color:var(--muted);font-size:12px;margin-top:4px;">Triggered at $${alert.triggeredPrice?.toFixed(2)} on ${new Date(alert.triggeredAt).toLocaleString()}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button onclick="editAlert('${alert.id}')" style="background:transparent;border:none;color:var(--accent);cursor:pointer;font-size:18px;padding:4px 8px;">✏️</button>
          ${isTriggered ? `
            <button onclick="snoozeAlert('${alert.id}')" style="background:var(--ok);color:white;border:none;border-radius:6px;padding:2px 8px;font-size:13px;cursor:pointer;">Snooze</button>
            <button onclick="dismissAlert('${alert.id}')" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:2px 8px;font-size:13px;cursor:pointer;">Dismiss</button>
          ` : ''}
          <button onclick="deleteAlert('${alert.id}')" style="background:transparent;border:none;color:var(--danger);cursor:pointer;font-size:18px;padding:4px 8px;">🗑</button>
        </div>
      </div>
    `;
  }).join('');
  updateAlertBadge();
}

// --- Alert Badge ---
function updateAlertBadge() {
  const alerts = AlertSystem.getAlerts();
  const activeCount = alerts.filter(a => !a.triggered).length;
  document.querySelectorAll('.alert-badge').forEach(badge => {
    if (activeCount > 0) {
      badge.textContent = activeCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  });
}

// --- Alert CRUD for window ---
window.deleteAlert = function(alertId) {
  if (confirm('Delete this alert?')) {
    AlertSystem.deleteAlert(alertId);
    updateAlertList();
  }
};
window.editAlert = function(alertId) {
  const alert = AlertSystem.getAlerts().find(a => a.id === alertId);
  if (!alert) return;
  const modal = document.getElementById('alert-modal');
  modal.style.display = 'block';
  modal.querySelector('#alert-symbol').value = alert.symbol;
  modal.querySelector('#alert-price').value = alert.price;
  modal.querySelector('#alert-note').value = alert.note || '';
  modal.querySelector('#alert-edit-id').value = alert.id;
  modal.querySelector('#alert-expiry').value = alert.expiresAt ? new Date(alert.expiresAt).toISOString().slice(0,16) : '';
  // Set condition type/fields
  let condType = typeof alert.condition === 'string' ? alert.condition : alert.condition.type;
  modal.querySelector('#alert-condition-type').value = condType;
  modal.querySelector('#alert-condition-type').onchange();
  if (condType === 'cross') modal.querySelector('#alert-cross-value').value = alert.condition.value;
  if (condType === 'percent') modal.querySelector('#alert-percent-value').value = alert.condition.percent;
  if (condType === 'range') {
    modal.querySelector('#alert-range-min').value = alert.condition.min;
    modal.querySelector('#alert-range-max').value = alert.condition.max;
  }
  modal.querySelector('#cancel-alert-edit-btn').style.display = '';
  modal.querySelector('#create-alert-btn').textContent = 'Save Changes';
};
window.snoozeAlert = function(alertId) {
  if (confirm('Snooze this alert for 15 minutes?')) {
    AlertSystem.snoozeAlert(alertId, 15);
    updateAlertList();
  }
};
window.dismissAlert = function(alertId) {
  if (confirm('Dismiss this alert?')) {
    AlertSystem.dismissAlert(alertId);
    updateAlertList();
  }
};

// --- Global Alert Button ---
function setupGlobalAlertButton() {
  const header = document.querySelector('header .row');
  if (!header) return;
  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'position: relative; display: inline-block;';
  const btn = document.createElement('button');
  btn.id = 'global-alert-btn';
  btn.innerHTML = '🔔';
  btn.title = 'Price Alerts';
  btn.style.cssText = `
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 13px;
    font-size: 18px;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  `;
  const badge = document.createElement('span');
  badge.className = 'alert-badge';
  badge.style.cssText = `
    position: absolute;
    top: -6px;
    right: -6px;
    background: var(--danger);
    color: white;
    border-radius: 10px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 600;
    min-width: 18px;
    height: 18px;
    display: none;
    align-items: center;
    justify-content: center;
  `;
  btn.appendChild(badge);
  btnContainer.appendChild(btn);
  btn.onclick = () => {
    const modal = document.getElementById('alert-modal');
    if (modal) {
      modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
      resetAlertEditForm();
    }
  };
  header.insertBefore(btnContainer, header.firstChild);
}

// --- Card Alert Buttons ---
function setupCardAlertButtons() {
  document.querySelectorAll('.chart-card').forEach(card => {
    const header = card.querySelector('.chart-header .right-controls');
    if (!header || header.querySelector('.card-alert-btn')) return;
    const symbol = card.dataset.symbol?.toUpperCase();
    if (!symbol) return;
    const btn = document.createElement('button');
    btn.className = 'card-alert-btn';
    btn.innerHTML = '🔔';
    btn.title = 'Set Price Alert';
    btn.style.cssText = `
      background: transparent;
      border: none;
      color: var(--text);
      font-size: 1.2em;
      cursor: pointer;
      padding: 6px;
      border-radius: 8px;
      min-width: 32px;
      min-height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    `;
    btn.onmouseover = () => {
      btn.style.color = 'var(--accent)';
      btn.style.background = 'var(--border)';
    };
    btn.onmouseout = () => {
      btn.style.color = 'var(--text)';
      btn.style.background = 'transparent';
    };
    btn.onclick = () => {
      const modal = document.getElementById('alert-modal');
      if (!modal) return;
      modal.querySelector('#alert-symbol').value = symbol;
      const priceEl = card.querySelector('.current-price');
      if (priceEl) {
        const currentPrice = parseFloat(priceEl.textContent);
        if (!isNaN(currentPrice)) {
          modal.querySelector('#alert-price').value = currentPrice;
        }
      }
      resetAlertEditForm();
      modal.style.display = 'block';
    };
    header.insertBefore(btn, header.querySelector('.fullscreen-btn'));
  });
}

// --- Integrate Alerts with Charts ---
export function integrateAlertsWithCharts() {
  const originalHandleDataUpdate = window.ChartRenderer?.prototype?.handleDataUpdate;
  if (originalHandleDataUpdate) {
    window.ChartRenderer.prototype.handleDataUpdate = function(update) {
      originalHandleDataUpdate.call(this, update);
      if (update && update.close && this.symbol) {
        // For crossing/percent conditions, pass lastPrice if available (extend as needed)
        AlertSystem.checkPrice(this.symbol, update.close, this.lastClosePrice);
      }
    };
  }
}

// --- Export/Import UI ---
function setupExportImportUI() {
  const exportBtn = document.getElementById('export-alerts-btn');
  if (exportBtn) {
    exportBtn.onclick = () => {
      const json = AlertSystem.exportAlerts();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'alerts.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }
  const importInput = document.getElementById('import-alerts-input');
  const importStatus = document.getElementById('import-alerts-status');
  if (importInput) {
    importInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const text = ev.target.result;
          const ok = AlertSystem.importAlerts(text);
          importStatus.textContent = ok ? 'Imported!' : 'Import failed';
          updateAlertList();
        } catch {
          importStatus.textContent = 'Import failed';
        }
        setTimeout(() => importStatus.textContent = '', 3000);
      };
      reader.readAsText(file);
    };
  }
}

// --- Telegram Config UI ---
function setupTelegramConfigUI() {
  const tokenInput = document.getElementById('telegram-token');
  const chatIdInput = document.getElementById('telegram-chatid');
  const saveBtn = document.getElementById('save-telegram-config-btn');
  const statusEl = document.getElementById('telegram-config-status');
  const config = getTelegramConfig();
  if (tokenInput) tokenInput.value = config.token;
  if (chatIdInput) chatIdInput.value = config.chatId;
  if (saveBtn) {
    saveBtn.onclick = () => {
      setTelegramConfig({
        token: tokenInput.value.trim(),
        chatId: chatIdInput.value.trim()
      });
      statusEl.textContent = 'Saved!';
      setTimeout(() => statusEl.textContent = '', 2000);
    };
  }
}