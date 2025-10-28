// panel-resize.js
// Make indicator panels resizable via drag
// NOTE: This file is intended to be loaded as a plain <script> (non-module) from index.html.
// Because index.html includes this script without type="module", we must not use `export`.
// We expose setupPanelResize and teardownPanelResize on window.

(function () {
  const PANEL_MIN_HEIGHT = 80;
  const PANEL_MAX_HEIGHT = 600;
  const PANEL_TYPES = ['rsi', 'macd', 'stochrsi'];

  const _panelResizeState = {
    listeners: [], // { target, type, handler, options }
    panels: new WeakMap(), // panel -> { handlers: [...] }
  };

  /**
   * Register a DOM listener and track it for cleanup
   */
  function _addListener(target, type, handler, options) {
    try {
      target.addEventListener(type, handler, options);
      _panelResizeState.listeners.push({ target, type, handler, options });
    } catch (e) {
      console.warn('[PanelResize] Failed to add listener', e);
    }
  }

  /**
   * Remove all tracked listeners
   */
  function _removeAllListeners() {
    _panelResizeState.listeners.forEach(({ target, type, handler, options }) => {
      try { target.removeEventListener(type, handler, options); } catch {}
    });
    _panelResizeState.listeners = [];
  }

  /**
   * Setup resizers for panels. Returns a cleanup function.
   */
  function setupPanelResize() {
    try {
      PANEL_TYPES.forEach(type => {
        document.querySelectorAll(`.${type}-panel`).forEach(panel => {
          if (!panel) return;
          if (_panelResizeState.panels.has(panel)) return; // already initialized

          // Find handle
          const handle = panel.querySelector('.indicator-resize-handle');
          if (!handle) return;
          let startY = 0;
          let startHeight = 0;
          let dragging = false;
          let symbol = panel.closest('.chart-card')?.dataset.symbol || '';

          // Restore saved height
          const savedHeight = getPanelHeight(symbol, type);
          if (savedHeight) {
            panel.style.maxHeight = savedHeight + 'px';
            panel.style.height = savedHeight + 'px';
          }

          const onMouseMove = (e) => {
            if (!dragging) return;
            const dy = e.clientY - startY;
            let newHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, startHeight + dy));
            panel.style.maxHeight = newHeight + 'px';
            panel.style.height = newHeight + 'px';
            setPanelHeight(symbol, type, newHeight);
          };
          const onMouseUp = () => {
            if (dragging) {
              dragging = false;
              document.body.style.cursor = '';
            }
          };

          const onTouchMove = (e) => {
            if (!dragging) return;
            const dy = e.touches[0].clientY - startY;
            let newHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, startHeight + dy));
            panel.style.maxHeight = newHeight + 'px';
            panel.style.height = newHeight + 'px';
            setPanelHeight(symbol, type, newHeight);
          };
          const onTouchEnd = () => {
            if (dragging) {
              dragging = false;
              document.body.style.cursor = '';
            }
          };

          const onMouseDown = (e) => {
            dragging = true;
            startY = e.clientY;
            startHeight = panel.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
          };
          const onTouchStart = (e) => {
            dragging = true;
            startY = e.touches[0].clientY;
            startHeight = panel.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
          };

          // Add listeners and track them
          _addListener(handle, 'mousedown', onMouseDown);
          _addListener(document, 'mousemove', onMouseMove);
          _addListener(document, 'mouseup', onMouseUp);
          _addListener(handle, 'touchstart', onTouchStart, { passive: false });
          _addListener(document, 'touchmove', onTouchMove, { passive: false });
          _addListener(document, 'touchend', onTouchEnd);

          _panelResizeState.panels.set(panel, {
            handlers: [
              { target: handle, type: 'mousedown', handler: onMouseDown },
              { target: document, type: 'mousemove', handler: onMouseMove },
              { target: document, type: 'mouseup', handler: onMouseUp },
              { target: handle, type: 'touchstart', handler: onTouchStart },
              { target: document, type: 'touchmove', handler: onTouchMove },
              { target: document, type: 'touchend', handler: onTouchEnd },
            ]
          });
        });
      });
    } catch (err) {
      console.warn('[PanelResize] Error initializing resize handlers', err);
    }

    // Return cleanup function
    return function teardownPanelResize() {
      try {
        _removeAllListeners();
        _panelResizeState.panels = new WeakMap();
      } catch (err) {
        console.warn('[PanelResize] teardown failed', err);
      }
    };
  }

  // Utility: persist and restore per-panel height
  function getPanelHeight(symbol, type) {
    try {
      return parseInt(localStorage.getItem(`panelHeight-${symbol}-${type}`), 10) || null;
    } catch {
      return null;
    }
  }
  function setPanelHeight(symbol, type, height) {
    try {
      localStorage.setItem(`panelHeight-${symbol}-${type}`, Math.round(height));
    } catch {}
  }

  // Auto-expose to global in case inline scripts call setupPanelResize
  window.setupPanelResize = window.setupPanelResize || setupPanelResize;
  window.teardownPanelResize = window.teardownPanelResize || function () {
    try {
      const fn = window.setupPanelResize && window.setupPanelResize();
      if (typeof fn === 'function') fn();
    } catch {}
  };

  // Initialize on load if DOM ready (keeps previous behavior)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function initPanelResizeOnLoad() {
      try {
        if (typeof window.setupPanelResize === 'function') {
          window.setupPanelResize();
        }
      } catch (e) {
        console.warn('[PanelResize] init failed', e);
      }
    }, { once: true });
  } else {
    try {
      if (typeof window.setupPanelResize === 'function') {
        window.setupPanelResize();
      }
    } catch (e) {
      console.warn('[PanelResize] init failed', e);
    }
  }
})();