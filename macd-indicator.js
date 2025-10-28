// macd-indicator.js
import { BaseIndicator } from './base-indicator.js';

/**
 * MACD Indicator Panel
 * - No built-in chart title; use external HTML label for the indicator name, like RSI.
 * - Handles nulls in EMA and MACD calculations gracefully for rendering and calculations.
 * - Robust signal line alignment even if MACD line has scattered nulls.
 * - Panel resizing is supported.
 * - Downstream consumers (renderers, strategies) are robust to nulls.
 */
export class MACDIndicator extends BaseIndicator {
  constructor(mainChart, options = {}) {
    super(mainChart, options);
    this.options = Object.assign(
      { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      options
    );
    this.macdChart = null;
    this.series = {};
  }

  // EMA helper (returns null for first period-1 points)
  ema(values, period) {
    const k = 2 / (period + 1);
    let emaArr = [];
    let prevEma;
    values.forEach((v, i) => {
      if (i < period - 1) {
        emaArr.push(null);
        return;
      }
      if (i === period - 1) {
        const sum = values.slice(0, period).reduce((a, b) => a + b, 0);
        prevEma = sum / period;
        emaArr.push(prevEma);
      } else {
        prevEma = v * k + prevEma * (1 - k);
        emaArr.push(prevEma);
      }
    });
    return emaArr;
  }

  // MACD calculation (handles nulls gracefully and robust signal alignment)
  calculate(data) {
    const closes = data.map(d => d.close);
    const fastEMA = this.ema(closes, this.options.fastPeriod);
    const slowEMA = this.ema(closes, this.options.slowPeriod);

    // MACD line: null if either fastEMA or slowEMA is null
    const macdLine = closes.map((_, i) => {
      if (fastEMA[i] == null || slowEMA[i] == null) return null;
      return fastEMA[i] - slowEMA[i];
    });

    // Signal line: calculate only for non-null MACD values, then align with macdLine robustly
    const validMacd = macdLine.filter(v => v != null);
    const signalLineRaw = this.ema(validMacd, this.options.signalPeriod);

    // Robust alignment: scan macdLine and map signalLineRaw values to non-null macdLine indices
    let fullSignal = [];
    let sigIdx = 0;
    macdLine.forEach(v => {
      if (v == null) {
        fullSignal.push(null);
      } else {
        fullSignal.push(signalLineRaw[sigIdx++] ?? null);
      }
    });

    // Histogram: only valid when both MACD and signal are not null
    const histogram = macdLine.map((v, i) =>
      v != null && fullSignal[i] != null ? v - fullSignal[i] : null
    );

    return { macdLine, signalLine: fullSignal, histogram };
  }

  // Render MACD panel chart (no title label inside chart)
  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error("MACD container not found:", containerId);
      return;
    }

    // Panel title is rendered externally in HTML, not here.

    // Create MACD chart without any built-in indicator name
    this.macdChart = LightweightCharts.createChart(container, {
      layout: { background: { color: '#11161d' }, textColor: '#e6edf3' },
      grid: { vertLines: { color: '#1c1c1c' }, horzLines: { color: '#1c1c1c' } },
      rightPriceScale: { borderColor: '#485c7b' },
      timeScale: { borderColor: '#485c7b', timeVisible: true }
      // No title option!
    });

    // Add series
    this.series.macd = this.macdChart.addLineSeries({ color: '#2196f3', lineWidth: 1 });
    this.series.signal = this.macdChart.addLineSeries({ color: '#ff9800', lineWidth: 1 });
    this.series.hist = this.macdChart.addHistogramSeries({
      color: '#888',
      priceFormat: { type: 'volume' }
    });

    // Sync only panning (not zoom)
    let syncing = false;
    const mainScale = this.chart.timeScale();
    const macdScale = this.macdChart.timeScale();

    mainScale.subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;
      macdScale.setVisibleLogicalRange(range);
      syncing = false;
    });

    macdScale.subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;
      mainScale.setVisibleLogicalRange(range);
      syncing = false;
    });
  }

  // Update values (handles nulls gracefully for chart rendering and strategies)
  update(data) {
    if (!this.macdChart || !this.series.macd) return;
    const { macdLine, signalLine, histogram } = this.calculate(data);

    const times = data.map(d => d.time);

    // MACD line
    this.series.macd.setData(
      times.map((t, i) => ({ time: t, value: macdLine[i] ?? null }))
    );
    // Signal line
    this.series.signal.setData(
      times.map((t, i) => ({ time: t, value: signalLine[i] ?? null }))
    );
    // Histogram: use 0 for nulls (or set value to null for true gaps)
    this.series.hist.setData(
      times.map((t, i) => ({
        time: t,
        value: histogram[i] ?? 0,
        color: histogram[i] == null ? 'rgba(128,128,128,0.2)' :
          histogram[i] >= 0 ? 'rgba(76,175,80,0.6)' : 'rgba(244,67,54,0.6)'
      }))
    );
  }

  resize(width, height) {
    if (this.macdChart) {
      this.macdChart.resize(width, height);
    }
  }

  destroy() {
    if (this.macdChart) {
      this.macdChart.remove();
      this.macdChart = null;
    }
  }
}