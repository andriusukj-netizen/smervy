// stochastic-indicator.js
// stochastic-indicator.js
import { BaseIndicator } from './base-indicator.js';

/**
 * Stochastic RSI Indicator
 * 
 * The Stochastic RSI is an oscillator that measures the level of RSI relative to its high-low range 
 * over a set time period. It applies the Stochastic formula to RSI values instead of price data.
 * 
 * Formula:
 * 1. Calculate RSI(14)
 * 2. Stochastic RSI = (RSI - Min RSI) / (Max RSI - Min RSI) × 100
 * 3. %K = SMA of Stochastic RSI (default 3 periods)
 * 4. %D = SMA of %K (default 3 periods)
 * 
 * Default parameters: RSI(14), Stochastic(14), %K(3), %D(3)
 * Range: 0-100
 * Overbought: Above 80
 * Oversold: Below 20
 */
export class StochasticRSIIndicator extends BaseIndicator {
  constructor(mainChart, options = {}) {
    super(mainChart, options);
    
    // Default parameters
    this.options = {
      rsiPeriod: 14,          // RSI calculation period
      stochPeriod: 14,        // Stochastic lookback period
      kPeriod: 3,             // %K smoothing period (SMA)
      dPeriod: 3,             // %D smoothing period (SMA)
      kColor: '#2196f3',      // %K line color (blue)
      dColor: '#ff9800',      // %D line color (orange)
      lineWidth: 2,
      ...options
    };

    this.stochChart = null;
    this.series = {
      k: null,    // %K line
      d: null     // %D line
    };
    
    this._rendered = false;
    this.lastValues = { k: null, d: null };
  }

  /**
   * Calculate RSI for the given data
   * @param {Array} data - Array of candle objects {close, ...}
   * @param {number} period - RSI period
   * @returns {Array} Array of RSI values (nulls for initial period)
   */
  calculateRSI(data, period) {
    if (!data || data.length <= period) return [];

    const rsiValues = [];
    
    // Initialize with nulls for the first period
    for (let i = 0; i < period; i++) {
      rsiValues.push(null);
    }

    let gain = 0;
    let loss = 0;

    // Calculate initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const change = data[i].close - data[i - 1].close;
      if (change > 0) {
        gain += change;
      } else {
        loss += Math.abs(change);
      }
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;

    // Calculate first RSI value
    const rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    rsiValues.push(rsi);

    // Calculate remaining RSI values using smoothed averages
    for (let i = period + 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;

      avgGain = ((avgGain * (period - 1)) + currentGain) / period;
      avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;

      const rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
      const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
      
      rsiValues.push(rsi);
    }

    return rsiValues;
  }

  /**
   * Calculate Simple Moving Average
   * @param {Array} values - Array of values
   * @param {number} period - SMA period
   * @returns {Array} Array of SMA values
   */
  calculateSMA(values, period) {
    const sma = [];
    
    for (let i = 0; i < values.length; i++) {
      if (i < period - 1 || values[i] === null) {
        sma.push(null);
        continue;
      }
      
      let sum = 0;
      let count = 0;
      
      for (let j = 0; j < period; j++) {
        if (values[i - j] !== null) {
          sum += values[i - j];
          count++;
        }
      }
      
      sma.push(count === period ? sum / period : null);
    }
    
    return sma;
  }

  /**
   * Calculate Stochastic RSI
   * @param {Array} data - Array of candle data
   * @returns {Object} Object containing %K and %D arrays
   */
  calculate(data) {
    if (!data || data.length < this.options.rsiPeriod + this.options.stochPeriod) {
      return { k: [], d: [] };
    }

    // Step 1: Calculate RSI
    const rsiValues = this.calculateRSI(data, this.options.rsiPeriod);

    // Step 2: Calculate Stochastic of RSI
    const stochRSI = [];
    
    for (let i = 0; i < rsiValues.length; i++) {
      if (i < this.options.rsiPeriod + this.options.stochPeriod - 1 || rsiValues[i] === null) {
        stochRSI.push(null);
        continue;
      }

      // Find min and max RSI in the stochastic period
      let minRSI = Infinity;
      let maxRSI = -Infinity;
      
      for (let j = 0; j < this.options.stochPeriod; j++) {
        const idx = i - j;
        if (rsiValues[idx] !== null) {
          minRSI = Math.min(minRSI, rsiValues[idx]);
          maxRSI = Math.max(maxRSI, rsiValues[idx]);
        }
      }

      // Calculate Stochastic RSI
      const range = maxRSI - minRSI;
      if (range === 0) {
        stochRSI.push(0);
      } else {
        const stoch = ((rsiValues[i] - minRSI) / range) * 100;
        stochRSI.push(stoch);
      }
    }

    // Step 3: Calculate %K (SMA of Stochastic RSI)
    const kValues = this.calculateSMA(stochRSI, this.options.kPeriod);

    // Step 4: Calculate %D (SMA of %K)
    const dValues = this.calculateSMA(kValues, this.options.dPeriod);

    // Prepare output with time data
    const k = [];
    const d = [];

    for (let i = 0; i < data.length; i++) {
      k.push({
        time: data[i].time,
        value: kValues[i]
      });
      
      d.push({
        time: data[i].time,
        value: dValues[i]
      });
    }

    return { k, d };
  }

  /**
   * Render Stochastic RSI panel
   * @param {string} containerId - DOM container ID
   */
  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('[StochRSI] Container not found:', containerId);
      return;
    }

    // Create Stochastic RSI chart
    this.stochChart = LightweightCharts.createChart(container, {
      layout: { 
        background: { color: '#11161d' }, 
        textColor: '#e6edf3' 
      },
      grid: { 
        vertLines: { color: '#1c1c1c' }, 
        horzLines: { color: '#1c1c1c' } 
      },
      rightPriceScale: { 
        borderColor: '#485c7b',
        visible: true 
      },
      timeScale: { 
        borderColor: '#485c7b', 
        timeVisible: true 
      },
      crosshair: { 
        mode: LightweightCharts.CrosshairMode.Normal 
      }
    });

    // Add %K line (blue)
    this.series.k = this.stochChart.addLineSeries({
      color: this.options.kColor,
      lineWidth: this.options.lineWidth,
      priceLineVisible: false,
      crossHairMarkerVisible: true,
      lastValueVisible: false,
      title: `%K (${this.options.kPeriod})`
    });

    // Add %D line (orange)
    this.series.d = this.stochChart.addLineSeries({
      color: this.options.dColor,
      lineWidth: this.options.lineWidth,
      priceLineVisible: false,
      crossHairMarkerVisible: true,
      lastValueVisible: false,
      title: `%D (${this.options.dPeriod})`
    });

    // Add overbought/oversold reference lines
    this.addReferenceLine(80, '#ef5350', 'Overbought');  // Red at 80
    this.addReferenceLine(50, '#888888', 'Midline');      // Gray at 50
    this.addReferenceLine(20, '#26a69a', 'Oversold');     // Green at 20

    // Sync time scales with main chart
    this.syncTimeScales();

    this._rendered = true;
    console.log('[StochRSI] Indicator rendered successfully');
  }

  /**
   * Add a horizontal reference line
   * @param {number} value - Y-axis value
   * @param {string} color - Line color
   * @param {string} title - Line title
   */
  addReferenceLine(value, color, title) {
    if (!this.series.k) return;

    try {
      this.series.k.createPriceLine({
        price: value,
        color: color,
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: title
      });
    } catch (error) {
      console.warn('[StochRSI] Failed to create reference line:', error);
    }
  }

  /**
   * Synchronize time scales between main chart and Stochastic RSI chart
   */
  syncTimeScales() {
    if (!this.chart || !this.stochChart) return;

    let syncing = false;
    const mainScale = this.chart.timeScale();
    const stochScale = this.stochChart.timeScale();

    // Sync main -> stoch
    mainScale.subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;
      try {
        stochScale.setVisibleLogicalRange(range);
      } catch (error) {
        console.warn('[StochRSI] Error syncing time scale:', error);
      }
      syncing = false;
    });

    // Sync stoch -> main
    stochScale.subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;
      try {
        mainScale.setVisibleLogicalRange(range);
      } catch (error) {
        console.warn('[StochRSI] Error syncing time scale:', error);
      }
      syncing = false;
    });
  }

  /**
   * Update Stochastic RSI with new data
   * @param {Array} data - Array of candle data
   */
  update(data) {
    if (!this.stochChart || !this.series.k || !this.series.d || !this._rendered) {
      console.warn('[StochRSI] Chart not initialized, calling render()');
      return;
    }

    if (!data || data.length === 0) {
      console.warn('[StochRSI] No data provided for update');
      return;
    }

    try {
      const { k, d } = this.calculate(data);

      // Filter out null values before setting data
      const filterNull = (arr) => arr.filter(item => item.value !== null);

      this.series.k.setData(filterNull(k));
      this.series.d.setData(filterNull(d));

      // Store last values
      if (k.length > 0) {
        this.lastValues.k = k[k.length - 1].value;
      }
      if (d.length > 0) {
        this.lastValues.d = d[d.length - 1].value;
      }

      console.log(`[StochRSI] Updated with ${data.length} candles`);
    } catch (error) {
      console.error('[StochRSI] Error updating indicator:', error);
    }
  }

  /**
   * Update only the last value (for real-time updates)
   * @param {Object} candle - Latest candle
   * @param {Array} history - Full candle history
   */
  updateLast(candle, history) {
    if (!candle || !history || !this._rendered) return;

    try {
      const { k, d } = this.calculate(history);
      
      const lastK = k[k.length - 1];
      const lastD = d[d.length - 1];

      if (lastK && lastK.value !== null && this.series.k) {
        this.series.k.update(lastK);
        this.lastValues.k = lastK.value;
      }

      if (lastD && lastD.value !== null && this.series.d) {
        this.series.d.update(lastD);
        this.lastValues.d = lastD.value;
      }
    } catch (error) {
      console.error('[StochRSI] Error updating last value:', error);
    }
  }

  /**
   * Get current Stochastic RSI values
   * @param {Array} data - Array of candle data
   * @returns {Object|null} Current values or null
   */
  getCurrentValues(data) {
    if (!data || data.length < this.options.rsiPeriod + this.options.stochPeriod) {
      return null;
    }

    const { k, d } = this.calculate(data);
    const lastIndex = k.length - 1;

    if (lastIndex < 0 || k[lastIndex].value === null) {
      return null;
    }

    return {
      k: k[lastIndex].value,
      d: d[lastIndex].value,
      isOverbought: k[lastIndex].value > 80,
      isOversold: k[lastIndex].value < 20,
      signal: this.getSignal(k[lastIndex].value, d[lastIndex].value)
    };
  }

  /**
   * Get trading signal based on Stochastic RSI
   * @param {number} kValue - %K value
   * @param {number} dValue - %D value
   * @returns {string} Signal ('bullish', 'bearish', or 'neutral')
   */
  getSignal(kValue, dValue) {
    if (kValue === null || dValue === null) return 'neutral';

    // Bullish crossover in oversold zone
    if (kValue > dValue && kValue < 20) {
      return 'bullish';
    }

    // Bearish crossover in overbought zone
    if (kValue < dValue && kValue > 80) {
      return 'bearish';
    }

    return 'neutral';
  }

  /**
   * Resize the chart
   * @param {number} width - New width
   * @param {number} height - New height
   */
  resize(width, height) {
    if (!this.stochChart) return;

    try {
      this.stochChart.resize(width, height);
    } catch (error) {
      console.warn('[StochRSI] Resize failed:', error);
    }
  }

  /**
   * Remove the indicator
   */
  remove() {
    this.destroy();
  }

  /**
   * Clean up and destroy the indicator
   */
  destroy() {
    if (!this.stochChart) return;

    try {
      // Unsubscribe from time scale events
      const mainScale = this.chart?.timeScale();
      const stochScale = this.stochChart?.timeScale();

      if (mainScale) {
        try {
          mainScale.unsubscribeVisibleLogicalRangeChange();
        } catch (error) {
          console.warn('[StochRSI] Error unsubscribing main scale:', error);
        }
      }

      if (stochScale) {
        try {
          stochScale.unsubscribeVisibleLogicalRangeChange();
        } catch (error) {
          console.warn('[StochRSI] Error unsubscribing stoch scale:', error);
        }
      }

      // Remove chart
      this.stochChart.remove();
      this.stochChart = null;
      this.series = { k: null, d: null };
      this._rendered = false;
      this.lastValues = { k: null, d: null };

      console.log('[StochRSI] Indicator destroyed successfully');
    } catch (error) {
      console.error('[StochRSI] Error destroying indicator:', error);
    }
  }

  /**
   * Update indicator settings
   * @param {Object} newOptions - New options to apply
   */
  updateSettings(newOptions) {
    this.options = { ...this.options, ...newOptions };
    
    // Remove old chart
    this.destroy();
    
    console.log('[StochRSI] Settings updated:', this.options);
  }
}

/**
 * Usage Example:
 * 
 * import { StochasticRSIIndicator } from './stochastic-indicator.js';
 * 
 * // Create indicator with default settings
 * const stochRSI = new StochasticRSIIndicator(chart);
 * stochRSI.render('stoch-rsi-chart-btc');
 * stochRSI.update(candles);
 * 
 * // Create indicator with custom settings
 * const customStochRSI = new StochasticRSIIndicator(chart, {
 *   rsiPeriod: 21,
 *   stochPeriod: 21,
 *   kPeriod: 5,
 *   dPeriod: 3,
 *   kColor: '#00ff00',
 *   dColor: '#ff0000'
 * });
 * customStochRSI.render('stoch-rsi-chart-eth');
 * customStochRSI.update(candles);
 * 
 * // Get current values
 * const current = stochRSI.getCurrentValues(candles);
 * console.log('Current Stoch RSI:', current);
 * // { k: 45.2, d: 42.1, isOverbought: false, isOversold: false, signal: 'neutral' }
 * 
 * // Update settings
 * stochRSI.updateSettings({ rsiPeriod: 28, kPeriod: 5 });
 * 
 * // Remove indicator
 * stochRSI.remove();
 */