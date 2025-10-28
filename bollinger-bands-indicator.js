// bollinger-bands-indicator.js
import { BaseIndicator } from './base-indicator.js';

/**
 * Bollinger Bands Indicator
 * 
 * Bollinger Bands consist of:
 * - Middle Band: Simple Moving Average (SMA)
 * - Upper Band: SMA + (Standard Deviation × multiplier)
 * - Lower Band: SMA - (Standard Deviation × multiplier)
 * 
 * Default settings: 20-period SMA with 2 standard deviations
 */
export class BollingerBandsIndicator extends BaseIndicator {
  constructor(chart, options = {}) {
    super(chart, options);
    
    // Default Bollinger Bands parameters
    this.options = {
      period: 20,
      stdDev: 2,
      colors: {
        upper: '#ff6b6b',      // Red for upper band
        middle: '#4ecdc4',     // Teal for middle band (SMA)
        lower: '#45b7d1',      // Blue for lower band
        fill: 'rgba(78, 205, 196, 0.1)' // Light teal fill between bands
      },
      lineWidth: 2,
      ...options
    };

    this.series = {
      upper: null,
      middle: null,
      lower: null,
      fill: null
    };
  }

  /**
   * Calculate Simple Moving Average (SMA)
   * @param {Array} data - Array of candle data
   * @param {number} period - SMA period
   * @returns {Array} Array of SMA values
   */
  calculateSMA(data, period) {
    const sma = [];
    
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sma.push(null);
        continue;
      }
      
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      
      sma.push(sum / period);
    }
    
    return sma;
  }

  /**
   * Calculate Standard Deviation
   * @param {Array} data - Array of candle data
   * @param {Array} sma - Array of SMA values
   * @param {number} period - Period for calculation
   * @returns {Array} Array of standard deviation values
   */
  calculateStdDev(data, sma, period) {
    const stdDev = [];
    
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1 || sma[i] === null) {
        stdDev.push(null);
        continue;
      }
      
      let sumSquaredDiff = 0;
      for (let j = 0; j < period; j++) {
        const diff = data[i - j].close - sma[i];
        sumSquaredDiff += diff * diff;
      }
      
      const variance = sumSquaredDiff / period;
      stdDev.push(Math.sqrt(variance));
    }
    
    return stdDev;
  }

  /**
   * Calculate Bollinger Bands
   * @param {Array} candles - Array of candle objects {time, open, high, low, close, volume}
   * @returns {Object} Object containing upper, middle, and lower band arrays
   */
  calculate(candles) {
    if (!candles || candles.length < this.options.period) {
      return { upper: [], middle: [], lower: [] };
    }

    // Calculate SMA (middle band)
    const sma = this.calculateSMA(candles, this.options.period);
    
    // Calculate standard deviation
    const stdDev = this.calculateStdDev(candles, sma, this.options.period);
    
    // Calculate upper and lower bands
    const upper = [];
    const middle = [];
    const lower = [];
    
    for (let i = 0; i < candles.length; i++) {
      if (sma[i] === null || stdDev[i] === null) {
        upper.push({ time: candles[i].time, value: null });
        middle.push({ time: candles[i].time, value: null });
        lower.push({ time: candles[i].time, value: null });
      } else {
        const deviation = stdDev[i] * this.options.stdDev;
        
        upper.push({ 
          time: candles[i].time, 
          value: sma[i] + deviation 
        });
        
        middle.push({ 
          time: candles[i].time, 
          value: sma[i] 
        });
        
        lower.push({ 
          time: candles[i].time, 
          value: sma[i] - deviation 
        });
      }
    }
    
    return { upper, middle, lower };
  }

  /**
   * Render Bollinger Bands on the chart
   * This creates the line series for upper, middle, and lower bands
   */
  render() {
    if (!this.chart) {
      console.error('[BollingerBands] Chart instance not available');
      return;
    }

    try {
      // Create middle band (SMA) series
      this.series.middle = this.chart.addLineSeries({
        color: this.options.colors.middle,
        lineWidth: this.options.lineWidth,
        lineStyle: 0, // Solid line
        priceLineVisible: false,
        crossHairMarkerVisible: true,
        lastValueVisible: false,
        title: `BB Middle (${this.options.period})`
      });

      // Create upper band series
      this.series.upper = this.chart.addLineSeries({
        color: this.options.colors.upper,
        lineWidth: this.options.lineWidth,
        lineStyle: 2, // Dashed line
        priceLineVisible: false,
        crossHairMarkerVisible: true,
        lastValueVisible: false,
        title: `BB Upper (+${this.options.stdDev}σ)`
      });

      // Create lower band series
      this.series.lower = this.chart.addLineSeries({
        color: this.options.colors.lower,
        lineWidth: this.options.lineWidth,
        lineStyle: 2, // Dashed line
        priceLineVisible: false,
        crossHairMarkerVisible: true,
        lastValueVisible: false,
        title: `BB Lower (-${this.options.stdDev}σ)`
      });

      console.log('[BollingerBands] Indicator rendered successfully');
    } catch (error) {
      console.error('[BollingerBands] Error rendering indicator:', error);
    }
  }

  /**
   * Update Bollinger Bands with new data
   * @param {Array} candles - Array of candle data
   */
  update(candles) {
    if (!candles || candles.length === 0) {
      console.warn('[BollingerBands] No candle data provided');
      return;
    }

    if (!this.series.upper || !this.series.middle || !this.series.lower) {
      console.warn('[BollingerBands] Series not initialized, calling render()');
      this.render();
    }

    try {
      const { upper, middle, lower } = this.calculate(candles);
      
      // Filter out null values before setting data
      const filterNull = (data) => data.filter(d => d.value !== null);
      
      if (this.series.upper) {
        this.series.upper.setData(filterNull(upper));
      }
      
      if (this.series.middle) {
        this.series.middle.setData(filterNull(middle));
      }
      
      if (this.series.lower) {
        this.series.lower.setData(filterNull(lower));
      }

      console.log(`[BollingerBands] Updated with ${candles.length} candles`);
    } catch (error) {
      console.error('[BollingerBands] Error updating indicator:', error);
    }
  }

  /**
   * Update only the last value (for real-time updates)
   * @param {Object} candle - Latest candle object
   * @param {Array} history - Full candle history
   */
  updateLast(candle, history) {
    if (!candle || !history || history.length < this.options.period) {
      return;
    }

    try {
      const { upper, middle, lower } = this.calculate(history);
      
      const lastUpper = upper[upper.length - 1];
      const lastMiddle = middle[middle.length - 1];
      const lastLower = lower[lower.length - 1];
      
      if (lastUpper.value !== null && this.series.upper) {
        this.series.upper.update(lastUpper);
      }
      
      if (lastMiddle.value !== null && this.series.middle) {
        this.series.middle.update(lastMiddle);
      }
      
      if (lastLower.value !== null && this.series.lower) {
        this.series.lower.update(lastLower);
      }
    } catch (error) {
      console.error('[BollingerBands] Error updating last value:', error);
    }
  }

  /**
   * Get the current Bollinger Bands values
   * @param {Array} candles - Array of candle data
   * @returns {Object|null} Current BB values or null
   */
  getCurrentValues(candles) {
    if (!candles || candles.length < this.options.period) {
      return null;
    }

    const { upper, middle, lower } = this.calculate(candles);
    const lastIndex = upper.length - 1;
    
    if (lastIndex < 0 || upper[lastIndex].value === null) {
      return null;
    }

    return {
      upper: upper[lastIndex].value,
      middle: middle[lastIndex].value,
      lower: lower[lastIndex].value,
      bandwidth: upper[lastIndex].value - lower[lastIndex].value,
      percentB: this.calculatePercentB(
        candles[candles.length - 1].close,
        upper[lastIndex].value,
        lower[lastIndex].value
      )
    };
  }

  /**
   * Calculate %B (Percent B)
   * Shows where price is relative to the bands
   * %B = (Close - Lower Band) / (Upper Band - Lower Band)
   * 
   * %B > 1: Price is above upper band
   * %B = 0.5: Price is at middle band
   * %B < 0: Price is below lower band
   * 
   * @param {number} close - Current close price
   * @param {number} upper - Upper band value
   * @param {number} lower - Lower band value
   * @returns {number} Percent B value
   */
  calculatePercentB(close, upper, lower) {
    const bandwidth = upper - lower;
    if (bandwidth === 0) return 0.5;
    return (close - lower) / bandwidth;
  }

  /**
   * Detect Bollinger Band squeeze
   * A squeeze occurs when bands narrow significantly
   * @param {Array} candles - Array of candle data
   * @param {number} lookback - Number of periods to compare
   * @returns {boolean} True if squeeze is detected
   */
  detectSqueeze(candles, lookback = 100) {
    if (!candles || candles.length < Math.max(this.options.period, lookback)) {
      return false;
    }

    const { upper, lower } = this.calculate(candles);
    const bandwidths = [];
    
    for (let i = Math.max(0, upper.length - lookback); i < upper.length; i++) {
      if (upper[i].value !== null && lower[i].value !== null) {
        bandwidths.push(upper[i].value - lower[i].value);
      }
    }
    
    if (bandwidths.length < 2) return false;
    
    const currentBandwidth = bandwidths[bandwidths.length - 1];
    const avgBandwidth = bandwidths.reduce((a, b) => a + b) / bandwidths.length;
    
    // Squeeze detected if current bandwidth is less than 75% of average
    return currentBandwidth < avgBandwidth * 0.75;
  }

  /**
   * Remove the indicator from the chart
   */
  remove() {
    this.destroy();
  }

  /**
   * Clean up and remove all series
   */
  destroy() {
    if (!this.chart) return;

    try {
      if (this.series.upper) {
        this.chart.removeSeries(this.series.upper);
        this.series.upper = null;
      }
      
      if (this.series.middle) {
        this.chart.removeSeries(this.series.middle);
        this.series.middle = null;
      }
      
      if (this.series.lower) {
        this.chart.removeSeries(this.series.lower);
        this.series.lower = null;
      }

      console.log('[BollingerBands] Indicator destroyed successfully');
    } catch (error) {
      console.error('[BollingerBands] Error destroying indicator:', error);
    }
  }

  /**
   * Update indicator settings
   * @param {Object} newOptions - New options to apply
   */
  updateSettings(newOptions) {
    this.options = { ...this.options, ...newOptions };
    
    // Remove old series
    this.destroy();
    
    // Re-render with new settings
    this.render();
    
    console.log('[BollingerBands] Settings updated:', this.options);
  }
}

/**
 * Usage Example:
 * 
 * import { BollingerBandsIndicator } from './bollinger-bands-indicator.js';
 * 
 * // Create indicator with default settings (20, 2)
 * const bb = new BollingerBandsIndicator(chart);
 * bb.render();
 * bb.update(candles);
 * 
 * // Create indicator with custom settings
 * const bbCustom = new BollingerBandsIndicator(chart, {
 *   period: 30,
 *   stdDev: 2.5,
 *   colors: {
 *     upper: '#ff0000',
 *     middle: '#00ff00',
 *     lower: '#0000ff'
 *   }
 * });
 * bbCustom.render();
 * bbCustom.update(candles);
 * 
 * // Get current values
 * const current = bb.getCurrentValues(candles);
 * console.log('Current BB:', current);
 * // { upper: 50100, middle: 50000, lower: 49900, bandwidth: 200, percentB: 0.5 }
 * 
 * // Detect squeeze
 * const isSqueeze = bb.detectSqueeze(candles);
 * console.log('Squeeze detected:', isSqueeze);
 * 
 * // Update settings
 * bb.updateSettings({ period: 25, stdDev: 3 });
 * 
 * // Remove indicator
 * bb.remove();
 */