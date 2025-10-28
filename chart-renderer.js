// chart-renderer.js
import { RSIIndicator } from './indicators/rsi-indicator.js';
import { EMAIndicator } from './indicators/ema-indicator.js';
import { MACDIndicator } from './indicators/macd-indicator.js';
import { SuperGuppyIndicator } from './indicators/superguppy-indicator.js';
import { BollingerBandsIndicator } from './indicators/bollinger-bands-indicator.js';
import { StochasticRSIIndicator } from './indicators/stochastic-indicator.js';
import { IndicatorPanelManager } from './indicator-panel-utils.js';
import { DrawingToolsManager } from './chart-drawing-tools.js';
import AlertSystem from './alert-system.js';


const INDICATOR_PANELS = ['rsi', 'macd', 'stochrsi'];

const customUtils = {
  addLineSeries: (chart, opts) => chart.addLineSeries(opts),
  addHistogramSeries: (chart, opts) => chart.addHistogramSeries(opts),
};

function debounce(fn, delay = 150) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export class ChartRenderer {
  constructor(containerId, symbol, dataManager) {
    this.containerId = containerId;
    // Normalize symbol internally to UPPERCASE for consistent logic
    this.symbol = typeof symbol === 'string' ? symbol.toUpperCase() : symbol;
    this.dataManager = dataManager;
    this.chart = null;
    this.candleSeries = null;
    this.volumeSeries = null;
    this.indicators = [];
    this.customIndicators = [];
    this.drawingTools = null;
    this.lastClosePrice = null;
    this.resizeObserver = null;
    this.mutationObserver = null;
    this.eventListeners = [];
    this.isDestroyed = false;
    this.isReady = false;
    this.errored = false;
    this.timers = [];
    this.intervals = [];

    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[ChartRenderer] Chart container #${containerId} not found`);
      this.errored = true;
      return;
    }

    const card = this.container.closest('.chart-card');
    this.card = card;
    this.cardStatusDot = card?.querySelector('.status-dot');
    this.cardStatusLabel = card?.querySelector('.status-label');

    this.panelManagers = {};
    INDICATOR_PANELS.forEach((type) => {
      this.panelManagers[type] = new IndicatorPanelManager(`.${type}-panel`, this.card);
    });

    this.debouncedResizeChart = debounce(() => {
      if (this.isDestroyed || !this.chart) return;
      const chartContainer = this.card?.querySelector('.tvchart');
      if (chartContainer && this.chart) {
        this.chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
      }
      if (this.drawingTools && typeof this.drawingTools.redraw === 'function') {
        this.drawingTools._resizeOverlayToContainer?.();
        this.drawingTools.redraw();
      }
    }, 150);

    this._fullscreenChangeHandler = () => {
      if (this.isDestroyed) return;
      this.debouncedResizeChart();
    };

    if (card) card.chartRenderer = this;

    this.setupCustomIndicatorUI();
  }

  setupCustomIndicatorUI() {
    if (!this.card) return;
    const customBtn = this.card.querySelector('.custom-indicator-btn');
    if (!customBtn) return;

    customBtn.addEventListener('click', () => {
      const modal = document.getElementById('custom-indicator-modal');
      if (!modal) return;
      modal.style.display = '';
      modal.dataset.chartCard = this.card.id;
      const textarea = document.getElementById('custom-indicator-js-input');
      if (textarea) textarea.value = '';
      const fileInput = document.getElementById('custom-indicator-js-upload');
      if (fileInput) fileInput.value = '';
      modal.dataset.chartRendererId = this.containerId;
    });

    const modal = document.getElementById('custom-indicator-modal');
    if (modal && !modal.dataset.listeners) {
      modal.dataset.listeners = true;
      document.getElementById('custom-indicator-save').onclick = () => {
        const code = document.getElementById('custom-indicator-js-input').value;
        if (!code.trim()) return alert('Paste JS logic for your indicator.');
        const chartRendererId = modal.dataset.chartRendererId;
        const renderer = chartRendererId ? window.chartRendererMap?.[chartRendererId] : null;
        if (renderer) {
          renderer.addCustomIndicator(code, 'customIndicator');
        }
        modal.style.display = 'none';
      };
      document.getElementById('custom-indicator-cancel').onclick = () => {
        modal.style.display = 'none';
      };
      document.getElementById('custom-indicator-js-upload').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          document.getElementById('custom-indicator-js-input').value = ev.target.result;
        };
        reader.readAsText(file);
      };
    }
    if (!window.chartRendererMap) window.chartRendererMap = {};
    window.chartRendererMap[this.containerId] = this;
  }

  tryInitIfReady() {
    if (this.isDestroyed || !this.errored) return;
    this.container = document.getElementById(this.containerId);
    if (this.container) {
      this.errored = false;
      this.init();
    }
  }

  init() {
    if (!this.container || this.isDestroyed || this.errored) return;

    try {
      this.chart = LightweightCharts.createChart(this.container, {
        layout: { background: { color: '#11161d' }, textColor: '#e6edf3' },
        grid: { vertLines: { color: '#1c1c1c' }, horzLines: { color: '#1c1c1c' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#485c7b' },
        timeScale: { borderColor: '#485c7b', timeVisible: true }
      });

      this.chart.applyOptions({
        layout: { background: { color: '#11161d' }, textColor: '#e6edf3' }
      });

      this.candleSeries = this.chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderDownColor: '#ef5350',
        borderUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        wickUpColor: '#26a69a'
      });

      this.volumeSeries = this.chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
        visible: false
      });

      const chartWrap = this.container.closest('.chart-wrap');
      if (chartWrap && !chartWrap.querySelector('.ema-badges')) {
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'ema-badges';
        chartWrap.appendChild(badgeContainer);
      }

      if (chartWrap && !this.drawingTools) {
        const chartKey = `${this.symbol}-${this.containerId}`;
        try {
          this.drawingTools = new DrawingToolsManager(
            this.chart,
            chartWrap,
            chartKey
          );
          if (this.candleSeries) {
            this.drawingTools.setCandleSeries(this.candleSeries);
          }
          this.drawingTools._resizeOverlayToContainer?.();
          this.drawingTools.redraw?.();
          console.log(`[ChartRenderer] Drawing tools initialized for ${this.symbol}`);
        } catch (error) {
          console.error(`[ChartRenderer] Failed to initialize drawing tools:`, error);
        }
      }

      this.timers.push(setTimeout(() => {
        if (!this.isDestroyed && this.container) {
          const rect = this.container.getBoundingClientRect();
          this.chart?.resize(rect.width, rect.height);
          if (this.drawingTools && typeof this.drawingTools._resizeOverlayToContainer === 'function') {
            this.drawingTools._resizeOverlayToContainer();
            this.drawingTools.redraw();
          }
        }
      }, 0));

      this.setupResizeObserver();
      this.setupPanelMutationObserver();
      this.setupCardControls();
      this.setupCrosshairTracking();

      document.addEventListener('fullscreenchange', this._fullscreenChangeHandler);

      this.isReady = true;
      console.log(`[ChartRenderer] Initialized for ${this.symbol}`);
    } catch (error) {
      this.errored = true;
      this.isReady = false;
      console.error(`[ChartRenderer] Failed to initialize chart for ${this.symbol}:`, error);
    }
  }

  setupResizeObserver() {
    if (!this.container || this.isDestroyed || this.errored) return;

    try {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isDestroyed || !this.container || !this.isReady) return;
        try {
          const rect = this.container.getBoundingClientRect();
          if (this.chart) {
            this.chart.resize(rect.width, this.container.clientHeight);
          }
          this.indicators.forEach(i => {
            if (this.isDestroyed || !this.isReady) return;
            if (i.instance?.resize && i.type in this.panelManagers) {
              const panelEl = this.card?.querySelector(`.${i.type}-chart`);
              if (panelEl) i.instance.resize(panelEl.clientWidth, panelEl.clientHeight);
            }
          });
          this.customIndicators.forEach(ind => {
            if (ind.instance && typeof ind.instance.resize === 'function') {
              ind.instance.resize(rect.width, rect.height);
            }
          });
          if (this.drawingTools && typeof this.drawingTools._resizeOverlayToContainer === 'function') {
            this.drawingTools._resizeOverlayToContainer();
            this.drawingTools.redraw();
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Resize observer error for ${this.symbol}:`, error);
        }
      });
      this.resizeObserver.observe(this.container);
    } catch (error) {
      console.error(`[ChartRenderer] Failed to setup resize observer for ${this.symbol}:`, error);
    }
  }

  setupPanelMutationObserver() {
    if (!this.card || this.isDestroyed || this.errored) return;
    this.mutationObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const panel = mutation.target;
          if (panel.classList.contains('active')) {
            this.timers.push(setTimeout(() => {
              this.debouncedResizeChart();
              panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              panel.focus?.();
            }, 100));
          }
        }
      }
    });
    INDICATOR_PANELS.forEach(type => {
      const panel = this.card?.querySelector(`.${type}-panel`);
      if (panel) {
        this.mutationObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
      }
    });
  }

  addEventListener(element, eventType, handler, options = {}) {
    if (!element || this.isDestroyed) return;
    try {
      element.addEventListener(eventType, handler, options);
      this.eventListeners.push({ element, eventType, handler, options });
    } catch (error) {
      console.warn(`[ChartRenderer] Failed to add event listener:`, error);
    }
  }

  setupCardControls() {
    if (!this.card || this.isDestroyed || this.errored) return;

    if (window.isGlobalError) {
      this.card.querySelectorAll('.right-controls button, .timeframe-select, .ticker-input')
        .forEach(el => {
          el.disabled = true;
          el.classList.add('disabled');
        });
    }

    const drawingBtn = this.card.querySelector('.drawing-tools-btn');
    if (drawingBtn) {
      drawingBtn.setAttribute('aria-label', 'Toggle drawing tools');
      drawingBtn.setAttribute('tabindex', '0');
      drawingBtn.setAttribute('role', 'button');
      drawingBtn.setAttribute('title', 'Enable/disable drawing tools');
      
      const drawingHandler = () => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        
        if (this.drawingTools) {
          const toolbar = this.card.querySelector('.drawing-toolbar');
          if (toolbar) {
            const isVisible = toolbar.style.display !== 'none';
            toolbar.style.display = isVisible ? 'none' : 'flex';
            drawingBtn.style.background = isVisible ? 'transparent' : 'var(--accent)';
            drawingBtn.style.color = isVisible ? 'var(--text)' : '#fff';
            drawingBtn.classList.toggle('active', !isVisible);
            
            const overlay = this.card.querySelector('svg');
            if (overlay) {
              overlay.style.pointerEvents = isVisible ? 'none' : 'auto';
            }
          }
        }
      };
      
      this.addEventListener(drawingBtn, 'click', drawingHandler);
      this.addEventListener(drawingBtn, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          drawingHandler();
        }
      });
    }

    const fullscreenBtn = this.card.querySelector('.fullscreen-btn');
    if (fullscreenBtn) {
      fullscreenBtn.setAttribute('aria-label', 'Fullscreen');
      fullscreenBtn.setAttribute('tabindex', '0');
      fullscreenBtn.setAttribute('role', 'button');
      fullscreenBtn.setAttribute('title', 'Toggle fullscreen mode');
      const fullscreenHandler = () => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        this.card.classList.toggle('fullscreen');
        this.debouncedResizeChart();
      };
      this.addEventListener(fullscreenBtn, 'click', fullscreenHandler);
      this.addEventListener(fullscreenBtn, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fullscreenHandler(); }
      });
    }

    const toggleBtn = this.card.querySelector('.toggle-indicators');
    const indicatorsPanel = this.card.querySelector('.indicators-panel');
    if (toggleBtn && indicatorsPanel) {
      toggleBtn.setAttribute('aria-label', 'Show/hide indicators panel');
      toggleBtn.setAttribute('tabindex', '0');
      toggleBtn.setAttribute('role', 'button');
      toggleBtn.setAttribute('title', 'Show/hide indicator controls');
      indicatorsPanel.setAttribute('tabindex', '-1');
      indicatorsPanel.setAttribute('role', 'region');
      indicatorsPanel.setAttribute('aria-label', 'Indicators panel');
      const toggleHandler = () => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        indicatorsPanel.classList.toggle('active');
        if (indicatorsPanel.classList.contains('active')) {
          this.timers.push(setTimeout(() => {
            indicatorsPanel.focus();
            indicatorsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 100));
        }
      };
      this.addEventListener(toggleBtn, 'click', toggleHandler);
      this.addEventListener(toggleBtn, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleHandler(); }
      });
    }

    INDICATOR_PANELS.forEach(type => {
      const checkbox = indicatorsPanel?.querySelector(`input[data-indicator="${type}"]`);
      if (checkbox) {
        checkbox.setAttribute('aria-label', `Toggle ${type.toUpperCase()} indicator`);
        checkbox.setAttribute('tabindex', '0');
        const uniqueId = this.card.id.replace('-card', '');
        const chartId = `${type}-chart-${uniqueId}`;
        const handler = (e) => {
          if (this.isDestroyed || this.errored || window.isGlobalError) return;
          try {
            if (e.target.checked) {
              this.addIndicator(type, chartId);
            } else {
              this.removeIndicator(type, chartId);
            }
          } catch (error) {
            console.warn(`[ChartRenderer] ${type} toggle error:`, error);
          }
        };
        this.addEventListener(checkbox, 'change', handler);
        this.addEventListener(checkbox, 'keydown', (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change')); }
        });
      }
    });

    const emaCheckbox = indicatorsPanel?.querySelector('input[data-indicator="ema"]');
    const emaSettings = indicatorsPanel?.querySelector('.ema-settings-panel');
    if (emaCheckbox) {
      emaCheckbox.setAttribute('aria-label', 'Toggle EMA indicators');
      emaCheckbox.setAttribute('tabindex', '0');
      const emaHandler = (e) => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        try {
          if (e.target.checked) {
            if (emaSettings) emaSettings.style.display = 'flex';
            this.addIndicator('ema', this.getEmaConfig());
          } else {
            if (emaSettings) emaSettings.style.display = 'none';
            this.removeIndicator('ema');
          }
        } catch (error) {
          console.warn(`[ChartRenderer] EMA toggle error:`, error);
        }
      };
      this.addEventListener(emaCheckbox, 'change', emaHandler);
      this.addEventListener(emaCheckbox, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); emaCheckbox.checked = !emaCheckbox.checked; emaCheckbox.dispatchEvent(new Event('change')); }
      });
    }

    const volumeCheckbox = indicatorsPanel?.querySelector('input[data-indicator="volume"]');
    if (volumeCheckbox) {
      volumeCheckbox.setAttribute('aria-label', 'Toggle Volume indicator');
      volumeCheckbox.setAttribute('tabindex', '0');
      const volumeHandler = (e) => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        try {
          if (e.target.checked) {
            this.addIndicator('volume');
          } else {
            this.removeIndicator('volume');
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Volume toggle error:`, error);
        }
      };
      this.addEventListener(volumeCheckbox, 'change', volumeHandler);
      this.addEventListener(volumeCheckbox, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); volumeCheckbox.checked = !volumeCheckbox.checked; volumeCheckbox.dispatchEvent(new Event('change')); }
      });
    }

    const superguppyCheckbox = indicatorsPanel?.querySelector('input[data-indicator="superguppy"]');
    if (superguppyCheckbox) {
      superguppyCheckbox.setAttribute('aria-label', 'Toggle Super Guppy indicator');
      superguppyCheckbox.setAttribute('tabindex', '0');
      const superguppyHandler = (e) => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        try {
          if (e.target.checked) {
            this.addIndicator('superguppy');
          } else {
            this.removeIndicator('superguppy');
          }
        } catch (error) {
          console.warn(`[ChartRenderer] SuperGuppy toggle error:`, error);
        }
      };
      this.addEventListener(superguppyCheckbox, 'change', superguppyHandler);
      this.addEventListener(superguppyCheckbox, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); superguppyCheckbox.checked = !superguppyCheckbox.checked; superguppyCheckbox.dispatchEvent(new Event('change')); }
      });
    }

    // Bollinger Bands checkbox handler
    const bbCheckbox = indicatorsPanel?.querySelector('input[data-indicator="bb"]');
    if (bbCheckbox) {
      bbCheckbox.setAttribute('aria-label', 'Toggle Bollinger Bands indicator');
      bbCheckbox.setAttribute('tabindex', '0');
      const bbHandler = (e) => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        try {
          if (e.target.checked) {
            this.addIndicator('bb', { period: 20, stdDev: 2 });
          } else {
            this.removeIndicator('bb');
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Bollinger Bands toggle error:`, error);
        }
      };
      this.addEventListener(bbCheckbox, 'change', bbHandler);
      this.addEventListener(bbCheckbox, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { 
          e.preventDefault(); 
          bbCheckbox.checked = !bbCheckbox.checked; 
          bbCheckbox.dispatchEvent(new Event('change')); 
        }
      });
    }

    // Stochastic RSI checkbox handler
    const stochRSICheckbox = indicatorsPanel?.querySelector('input[data-indicator="stochrsi"]');
    if (stochRSICheckbox) {
      stochRSICheckbox.setAttribute('aria-label', 'Toggle Stochastic RSI indicator');
      stochRSICheckbox.setAttribute('tabindex', '0');
      const stochRSIHandler = (e) => {
        if (this.isDestroyed || this.errored || window.isGlobalError) return;
        try {
          if (e.target.checked) {
            const uniqueId = this.card.id.replace('-card', '');
            const chartId = `stochrsi-chart-${uniqueId}`;
            this.addIndicator('stochrsi', chartId);
          } else {
            const uniqueId = this.card.id.replace('-card', '');
            const chartId = `stochrsi-chart-${uniqueId}`;
            this.removeIndicator('stochrsi', chartId);
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Stochastic RSI toggle error:`, error);
        }
      };
      this.addEventListener(stochRSICheckbox, 'change', stochRSIHandler);
      this.addEventListener(stochRSICheckbox, 'keydown', (e) => {
        if (e.key === "Enter" || e.key === " ") { 
          e.preventDefault(); 
          stochRSICheckbox.checked = !stochRSICheckbox.checked; 
          stochRSICheckbox.dispatchEvent(new Event('change')); 
        }
      });
    }
  }

  getEmaConfig() {
    // Robustly resolve the id prefix for EMA controls:
    // Prefer the card id (dynamic cards use uniqueId like `symbol-<ts>`), fallback to symbol-based prefix
    if (this.isDestroyed || this.errored || !this.card)
      return {
        periods: [20, 100, 200, 400],
        colors: ['#ff9800', '#2196f3', '#4caf50', '#e91e63'],
        badges: [true, true, true, true],
      };
    try {
      const uniqueId = this.card.id ? this.card.id.replace('-card', '') : this.symbol.toLowerCase().replace('usdt','');
      const periods = [
        parseInt(document.getElementById(`ema-period-${uniqueId}1`)?.value || 20, 10),
        parseInt(document.getElementById(`ema-period-${uniqueId}2`)?.value || 100, 10),
        parseInt(document.getElementById(`ema-period-${uniqueId}3`)?.value || 200, 10),
        parseInt(document.getElementById(`ema-period-${uniqueId}4`)?.value || 400, 10),
      ];
      const colors = [
        document.getElementById(`ema-color-${uniqueId}1`)?.value || '#ff9800',
        document.getElementById(`ema-color-${uniqueId}2`)?.value || '#2196f3',
        document.getElementById(`ema-color-${uniqueId}3`)?.value || '#4caf50',
        document.getElementById(`ema-color-${uniqueId}4`)?.value || '#e91e63',
      ];
      const badges = [
        document.getElementById(`ema-period-${uniqueId}1`)?.parentElement?.querySelector('.ema-badge-toggle')?.checked ?? true,
        document.getElementById(`ema-period-${uniqueId}2`)?.parentElement?.querySelector('.ema-badge-toggle')?.checked ?? true,
        document.getElementById(`ema-period-${uniqueId}3`)?.parentElement?.querySelector('.ema-badge-toggle')?.checked ?? true,
        document.getElementById(`ema-period-${uniqueId}4`)?.parentElement?.querySelector('.ema-badge-toggle')?.checked ?? true,
      ];
      return { periods, colors, badges };
    } catch (error) {
      console.warn(`[ChartRenderer] Error getting EMA config:`, error);
      return {
        periods: [20, 100, 200, 400],
        colors: ['#ff9800', '#2196f3', '#4caf50', '#e91e63'],
        badges: [true, true, true, true],
      };
    }
  }

  setupCrosshairTracking() {
    if (!this.chart || !this.candleSeries || this.isDestroyed || this.errored) return;
    try {
      const crosshairHandler = (param) => {
        if (this.isDestroyed || this.errored || !param || !param.time) return;
        try {
          const candle = param.seriesData.get(this.candleSeries);
          if (candle) {
            this.updatePriceDisplay(candle.close);
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Crosshair tracking error:`, error);
        }
      };
      this.chart.subscribeCrosshairMove(crosshairHandler);
      this._crosshairHandler = crosshairHandler;
    } catch (error) {
      console.error(`[ChartRenderer] Failed to setup crosshair tracking:`, error);
    }
  }

  updateStatus(isConnected) {
    if (this.isDestroyed || this.errored) return;
    try {
      const dot = document.querySelector('.dot-global');
      const label = document.getElementById('label-global');
      if (dot && label) {
        dot.style.background = isConnected ? 'var(--ok)' : 'var(--danger)';
        label.textContent = isConnected ? 'CONNECTED' : 'DISCONNECTED';
      }
      if (this.cardStatusDot && this.cardStatusLabel) {
        this.cardStatusDot.style.background = isConnected ? 'var(--ok)' : 'var(--danger)';
        this.cardStatusLabel.textContent = isConnected ? 'CONNECTED' : 'DISCONNECTED';
      }
    } catch (error) {
      console.warn(`[ChartRenderer] Error updating status:`, error);
    }
  }

  setData(candles) {
    if (!this.candleSeries || this.isDestroyed || this.errored || !candles || !this.isReady) return;
    try {
      this.candleSeries.setData(candles);
      if (this.volumeSeries) {
        this.volumeSeries.setData(
          candles.map((c) => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
          }))
        );
      }
      if (candles.length) {
        this.lastClosePrice = candles[candles.length - 1].close;
        this.updatePriceDisplay(this.lastClosePrice);

      }
      this.indicators.forEach((i) => {
        if (this.isDestroyed || this.errored) return;
        try {
          i.instance?.update(candles);
        } catch (error) {
          console.warn(`[ChartRenderer] Error updating indicator ${i.type}:`, error);
        }
      });
      this.customIndicators.forEach(ind => {
        try {
          if (typeof ind.logic === 'function') {
            ind.instance = ind.logic(candles, this.chart, customUtils);
          }
        } catch (err) {
          console.warn('[ChartRenderer] Custom indicator error:', err);
        }
      });
      if (this.drawingTools && typeof this.drawingTools._resizeOverlayToContainer === 'function') {
        this.drawingTools._resizeOverlayToContainer();
        this.drawingTools.redraw();
      }
    } catch (error) {
      console.error(`[ChartRenderer] Error setting data:`, error);
    }
  }

  handleDataUpdate(update) {
    if (!update || !this.candleSeries || this.isDestroyed || this.errored || !this.isReady) return;
    try {
      this.candleSeries.update(update);
      if (this.volumeSeries) {
        this.volumeSeries.update({
          time: update.time,
          value: update.volume,
          color: update.close >= update.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
        });
      }
      
      if (update.close && this.symbol) {
        // pass lastClosePrice so AlertSystem can evaluate crosses if needed
        AlertSystem.checkPrice(this.symbol, update.close, this.lastClosePrice);
      }

      if (update.closed && this.dataManager) {
        const key = `${this.symbol}-${this.card?.querySelector('.timeframe-select')?.value || '5m'}`;
        const history = this.dataManager.historicalData.get(key) || [];
        this.indicators.forEach((i) => {
          if (this.isDestroyed || this.errored) return;
          try {
            i.instance?.update(history);
          } catch (error) {
            console.warn(`[ChartRenderer] Error updating indicator on closed candle:`, error);
          }
        });
        this.customIndicators.forEach(ind => {
          try {
            if (typeof ind.logic === 'function') {
              ind.instance = ind.logic(history, this.chart, customUtils);
            }
          } catch (err) {
            console.warn('[ChartRenderer] Custom indicator error:', err);
          }
        });
      }
      this.updatePriceDisplay(update.close);
      if (this.drawingTools && typeof this.drawingTools._resizeOverlayToContainer === 'function') {
        this.drawingTools._resizeOverlayToContainer();
        this.drawingTools.redraw();
      }
    } catch (error) {
      if (!this.isDestroyed) {
        console.warn(`[ChartRenderer] Error handling data update:`, error);
      }
    }
  }

  updatePriceDisplay(price) {
    if (this.isDestroyed || this.errored || price === undefined || price === null) return;
    try {
      // Try to find the badge by normalized lowercase ticker first, fallback to original symbol
      const tickerAttr = (this.symbol || '').toLowerCase();
      let el = document.querySelector(`[data-ticker="${tickerAttr}"]`);
      if (!el) {
        el = document.querySelector(`[data-ticker="${this.symbol}"]`);
      }
      if (!el) return;
      el.textContent = price >= 1 ? price.toFixed(2) : price.toFixed(6);
      this.lastClosePrice = price;
    } catch (error) {
      console.warn(`[ChartRenderer] Error updating price display:`, error);
    }
  }

  addIndicator(type, optionsOrContainerId) {
    if (this.isDestroyed || this.errored || !this.isReady || window.isGlobalError) return;
    try {
      if (INDICATOR_PANELS.includes(type) && !this.indicators.find((i) => i.type === type)) {
        this.panelManagers[type].show();
        let indicatorInstance = null;
        if (type === 'rsi') {
          indicatorInstance = new RSIIndicator(this.chart, { period: 14 });
        } else if (type === 'macd') {
          indicatorInstance = new MACDIndicator(this.chart, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
        } else if (type === 'stochrsi') {
          indicatorInstance = new StochasticRSIIndicator(this.chart, {
            rsiPeriod: 14,
            stochPeriod: 14,
            kPeriod: 3,
            dPeriod: 3
          });
        }
        if (indicatorInstance && typeof indicatorInstance.render === 'function') {
          indicatorInstance.render(optionsOrContainerId);
        }
        if (this.dataManager) {
          const key = `${this.symbol}-${this.card?.querySelector('.timeframe-select')?.value || '5m'}`;
          const history = this.dataManager.historicalData.get(key) || [];
          indicatorInstance.update(history);
        }
        this.indicators.push({ type, instance: indicatorInstance });
      }

      // Bollinger Bands indicator
      if (type === 'bb' && !this.indicators.find((i) => i.type === 'bb')) {
        const bbOptions = optionsOrContainerId || { period: 20, stdDev: 2 };
        const bb = new BollingerBandsIndicator(this.chart, bbOptions);
        bb.render();
        
        if (this.dataManager) {
          const key = `${this.symbol}-${this.card?.querySelector('.timeframe-select')?.value || '5m'}`;
          const history = this.dataManager.historicalData.get(key) || [];
          bb.update(history);
        }
        
        this.indicators.push({ type: 'bb', instance: bb });
        console.log(`[ChartRenderer] Bollinger Bands added for ${this.symbol}`);
      }

      if (type === 'ema') {
        const { periods, colors, badges } = optionsOrContainerId;
        if (this.dataManager) {
          const key = `${this.symbol}-${this.card?.querySelector('.timeframe-select')?.value || '5m'}`;
          const history = this.dataManager.historicalData.get(key) || [];
          this.indicators
            .filter((i) => i.type.startsWith('ema-'))
            .forEach((i) => {
              try {
                i.instance.remove?.();
              } catch (error) {
                console.warn(`[ChartRenderer] Error removing EMA indicator:`, error);
              }
              });
          this.indicators = this.indicators.filter((i) => !i.type.startsWith('ema-'));
          const badgeContainer = this.card?.querySelector('.ema-badges');
          if (badgeContainer) badgeContainer.innerHTML = '';
          periods.forEach((p, idx) => {
            if (this.isDestroyed || this.errored) return;
            try {
              const ema = new EMAIndicator(this.chart, p, colors[idx]);
              ema.update(history);
              this.indicators.push({ type: `ema-${p}`, instance: ema });
              if (badges[idx] && badgeContainer) {
                const badgeEl = document.createElement('span');
                badgeEl.className = 'ema-badge';
                badgeEl.textContent = `EMA (${p})`;
                badgeEl.style.borderColor = colors[idx];
                badgeEl.style.color = colors[idx];
                badgeContainer.appendChild(badgeEl);
              }
            } catch (error) {
              console.warn(`[ChartRenderer] Error adding EMA ${p}:`, error);
            }
          });
        }
      }

      if (type === 'superguppy' && !this.indicators.find((i) => i.type === 'superguppy')) {
        const superguppy = new SuperGuppyIndicator(this.chart);
        superguppy.render();
        if (this.dataManager) {
          const key = `${this.symbol}-${this.card?.querySelector('.timeframe-select')?.value || '5m'}`;
          const history = this.dataManager.historicalData.get(key) || [];
          superguppy.update(history);
        }
        this.indicators.push({ type: 'superguppy', instance: superguppy });
      }

      if (type === 'volume' && this.volumeSeries) {
        this.volumeSeries.applyOptions({ visible: true });
      }

      if (this.drawingTools && typeof this.drawingTools._resizeOverlayToContainer === 'function') {
        this.drawingTools._resizeOverlayToContainer();
        this.drawingTools.redraw();
      }
    } catch (error) {
      console.error(`[ChartRenderer] Error adding indicator ${type}:`, error);
    }
  }

  updateIndicator(type, options) {
    if (this.isDestroyed || this.errored || !this.isReady || window.isGlobalError) return;
    try {
      if (type === 'ema') {
        this.addIndicator('ema', options);
      } else if (type === 'bb') {
        // Remove existing BB and re-add with new options
        this.removeIndicator('bb');
        this.addIndicator('bb', options);
      } else if (type === 'stochrsi') {
        // Remove existing Stochastic RSI and re-add with new options
        this.removeIndicator('stochrsi');
        const uniqueId = this.card.id.replace('-card', '');
        const chartId = `stochrsi-chart-${uniqueId}`;
        this.addIndicator('stochrsi', chartId);
        
        // Update the instance with new options
        const stochRSI = this.indicators.find((i) => i.type === 'stochrsi');
        if (stochRSI && stochRSI.instance) {
          stochRSI.instance.options = { ...stochRSI.instance.options, ...options };
          if (this.dataManager) {
            const key = `${this.symbol}-${this.card?.querySelector('.timeframe-select')?.value || '5m'}`;
            const history = this.dataManager.historicalData.get(key) || [];
            stochRSI.instance.update(history);
          }
        }
      }
    } catch (error) {
      console.error(`[ChartRenderer] Error updating indicator ${type}:`, error);
    }
  }

  removeIndicator(type, containerId) {
    if (this.isDestroyed || this.errored || !this.isReady || window.isGlobalError) return;
    try {
      if (INDICATOR_PANELS.includes(type)) {
        const idx = this.indicators.findIndex((i) => i.type === type);
        if (idx === -1) return;
        try {
          this.indicators[idx].instance.remove?.();
          this.indicators[idx].instance.destroy?.();
        } catch (error) {
          console.warn(`[ChartRenderer] Error destroying ${type} indicator:`, error);
        }
        this.indicators.splice(idx, 1);
        this.panelManagers[type].hide();
        const container = document.getElementById(containerId);
        if (container) container.innerHTML = '';
      }

      // Remove Bollinger Bands
      if (type === 'bb') {
        this.indicators
          .filter((i) => i.type === 'bb')
          .forEach((i) => {
            try {
              i.instance.remove?.();
            } catch (error) {
              console.warn(`[ChartRenderer] Error removing Bollinger Bands:`, error);
            }
          });
        this.indicators = this.indicators.filter((i) => i.type !== 'bb');
        console.log(`[ChartRenderer] Bollinger Bands removed for ${this.symbol}`);
      }

      if (type === 'ema') {
        this.indicators
          .filter((i) => i.type.startsWith('ema-'))
          .forEach((i) => {
            try {
              i.instance.remove?.();
            } catch (error) {
              console.warn(`[ChartRenderer] Error removing EMA indicator:`, error);
            }
          });
        this.indicators = this.indicators.filter((i) => !i.type.startsWith('ema-'));
        const badgeContainer = this.card?.querySelector('.ema-badges');
        if (badgeContainer) badgeContainer.innerHTML = '';
      }

      if (type === 'superguppy') {
        this.indicators
          .filter((i) => i.type === 'superguppy')
          .forEach((i) => {
            try {
              i.instance.remove?.();
            } catch (e) {}
          });
        this.indicators = this.indicators.filter((i) => i.type !== 'superguppy');
      }

      if (type === 'volume' && this.volumeSeries) {
        this.volumeSeries.applyOptions({ visible: false });
      }

      if (this.drawingTools && typeof this.drawingTools._resizeOverlayToContainer === 'function') {
        this.drawingTools._resizeOverlayToContainer();
        this.drawingTools.redraw();
      }
    } catch (error) {
      console.error(`[ChartRenderer] Error removing indicator ${type}:`, error);
    }
  }

  /**
   * Add custom indicator code in a sandboxed Worker.
   * The user code must define a function like:
   *   function customIndicator(candles) { return { series: [{ type: 'line', data: [{time, value}, ...], options: {...}}] }; }
   * The worker executes without DOM access and returns the output to the main thread.
   */
  async addCustomIndicator(codeString, name = 'customIndicator') {
    this.customIndicators = this.customIndicators.filter(ind => ind.name !== name);
    let logicFn;
    try {
      // Try to create a sandboxed worker to execute user code
      const workerBlob = new Blob([`
        onmessage = async function(e) {
          const { code, candles } = e.data;
          try {
            // The user code should assign a function to self.customIndicator
            // e.g. self.customIndicator = function(candles) { return {...} }
            self.customIndicator = null;
            const fnWrap = new Function('self', code + '\\n; return self.customIndicator;');
            const fn = fnWrap(self);
            if (typeof fn !== 'function') {
              postMessage({ error: 'Provided code did not expose a function as self.customIndicator' });
              return;
            }
            const result = await fn(candles);
            postMessage({ result });
          } catch (err) {
            postMessage({ error: err && err.message ? err.message : String(err) });
          }
        };
      `], { type: 'application/javascript' });

      const workerUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerUrl);

      const candles = (this.dataManager && this.card) ? (() => {
        const tf = this.card.querySelector('.timeframe-select')?.value || '5m';
        const key = `${this.symbol}-${tf}`;
        return this.dataManager.historicalData.get(key) || [];
      })() : [];

      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Custom indicator worker timeout'));
        }, 8000);

        worker.onmessage = (ev) => {
          clearTimeout(timeout);
          const { result, error } = ev.data;
          worker.terminate();
          if (error) {
            reject(new Error(error));
          } else {
            resolve(result);
          }
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(err);
        };

        worker.postMessage({ code: codeString, candles });
      });

      // result expected to contain a structure we can render
      if (!result || !result.series) throw new Error('Invalid indicator result from sandbox');

      // Add series to chart using documented APIs in main thread
      const createdInstance = {
        remove: () => {
          try {
            if (result._createdSeries) {
              result._createdSeries.forEach(s => {
                try { this.chart.removeSeries(s); } catch {}
              });
            }
          } catch (err) {}
        },
        resize: (w, h) => { /* no-op; series are chart-native */ },
      };

      // Create series now
      result._createdSeries = [];
      for (const s of result.series) {
        if (!s || !s.type || !s.data) continue;
        try {
          if (s.type === 'line') {
            const series = this.chart.addLineSeries(s.options || {});
            series.setData(s.data);
            result._createdSeries.push(series);
          } else if (s.type === 'histogram') {
            const series = this.chart.addHistogramSeries(s.options || {});
            series.setData(s.data);
            result._createdSeries.push(series);
          } else {
            // fallback: try line
            const series = this.chart.addLineSeries(s.options || {});
            series.setData(s.data);
            result._createdSeries.push(series);
          }
        } catch (err) {
          console.warn('[ChartRenderer] Failed to create custom series', err);
        }
      }

      this.customIndicators.push({ name, logic: null, instance: createdInstance });
      alert('Custom indicator added (executed in sandbox).');
    } catch (err) {
      alert('Failed to add custom indicator: ' + (err && err.message ? err.message : String(err)));
      console.warn('[ChartRenderer] addCustomIndicator error:', err);
    }
  }

  destroy() {
    if (this.isDestroyed) {
      console.warn(`[ChartRenderer] Already destroyed: ${this.symbol}`);
      return;
    }
    this.isDestroyed = true;
    this.isReady = false;
    this.errored = false;
    
    console.log(`[ChartRenderer] Destroying ${this.symbol}...`);
    
    try {
      if (this.drawingTools) {
        try {
          const drawingBtn = this.card?.querySelector('.drawing-tools-btn');
          if (drawingBtn) {
            drawingBtn.style.background = 'transparent';
            drawingBtn.style.color = 'var(--text)';
            drawingBtn.classList.remove('active');
          }
          
          if (typeof this.drawingTools.destroy === 'function') {
            this.drawingTools.destroy();
          }
          this.drawingTools = null;
          console.log(`[ChartRenderer] Drawing tools destroyed for ${this.symbol}`);
        } catch (error) {
          console.warn(`[ChartRenderer] Error destroying drawing tools:`, error);
        }
      }

      this.eventListeners.forEach(({ element, eventType, handler, options }) => {
        try {
          if (element && typeof element.removeEventListener === 'function') {
            element.removeEventListener(eventType, handler, options);
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Error removing event listener:`, error);
        }
      });
      this.eventListeners = [];

      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      this.timers.forEach(t => clearTimeout(t));
      this.timers = [];
      this.intervals.forEach(i => clearInterval(i));
      this.intervals = [];

      if (this.chart && this._crosshairHandler) {
        try {
          this.chart.unsubscribeCrosshairMove(this._crosshairHandler);
        } catch (error) {
          console.warn(`[ChartRenderer] Error unsubscribing crosshair:`, error);
        }
        this._crosshairHandler = null;
      }

      this.indicators.forEach((indicator) => {
        try {
          if (indicator.instance) {
            if (typeof indicator.instance.destroy === 'function') {
              indicator.instance.destroy();
            } else if (typeof indicator.instance.remove === 'function') {
              indicator.instance.remove();
            }
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Error destroying indicator ${indicator.type}:`, error);
        }
      });
      this.indicators = [];

      if (this.chart) {
        try {
          if (this.candleSeries) {
            this.chart.removeSeries(this.candleSeries);
            this.candleSeries = null;
          }
          if (this.volumeSeries) {
            this.chart.removeSeries(this.volumeSeries);
            this.volumeSeries = null;
          }
        } catch (error) {
          console.warn(`[ChartRenderer] Error removing chart series:`, error);
        }
        try {
          this.chart.remove();
        } catch (error) {
          console.warn(`[ChartRenderer] Error removing chart:`, error);
        }
        this.chart = null;
      }

      Object.values(this.panelManagers).forEach((pm) => {
        try { pm.cleanup(); } catch (err) {}
      });

      document.removeEventListener('fullscreenchange', this._fullscreenChangeHandler);

      if (this.card && this.card.chartRenderer === this) {
        this.card.chartRenderer = null;
      }
      this.container = null;
      this.card = null;
      this.cardStatusDot = null;
      this.cardStatusLabel = null;
      this.dataManager = null;
      this.lastClosePrice = null;

      if (this.customIndicators && this.customIndicators.length) {
        this.customIndicators.forEach(ind => {
          if (ind.instance && typeof ind.instance.remove === 'function') {
            try { ind.instance.remove(); } catch (err) {}
          }
        });
        this.customIndicators = [];
      }
      
      console.log(`[ChartRenderer] Successfully destroyed ${this.symbol}`);
    } catch (error) {
      console.error(`[ChartRenderer] Error during destruction of ${this.symbol}:`, error);
    }
  }
}