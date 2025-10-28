// rsi-indicator.js
export class RSIIndicator {
  constructor(chart, options = {}) {
    const opts = { period: 14, color: '#B0BEC5', height: 120, ...options };
    this.mainChart = chart;
    this.period = opts.period;
    this.color = opts.color;
    this.height = opts.height;

    this.rsiChart = null;
    this.rsiSeries = null;
    this.container = null;

    this._rendered = false;
    this.lastValue = undefined;
  }

  // ---- RSI Calculation ----
  calculate(data) {
    const period = this.period;
    if (!data || data.length <= period) return [];

    const rsiValues = data.slice(0, period).map(d => ({ time: d.time, value: null }));

    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const change = data[i].close - data[i - 1].close;
      if (change > 0) gain += change;
      else loss += Math.abs(change);
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;
    let rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
    let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));

    rsiValues.push({ time: data[period].time, value: rsi });

    for (let i = period + 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;

      avgGain = ((avgGain * (period - 1)) + currentGain) / period;
      avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;

      rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
      rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));

      rsiValues.push({ time: data[i].time, value: rsi });
    }

    return rsiValues;
  }

  // ---- Render RSI Subchart ----
  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('RSI container not found:', containerId);
      return;
    }
    this.container = container;

    if (container.clientHeight === 0) {
      container.style.minHeight = `${this.height}px`;
      container.style.height = `${this.height}px`;
    }

    this.rsiChart = LightweightCharts.createChart(container, {
      height: Math.max(this.height, container.clientHeight || 0),
      layout: { background: { color: '#11161d' }, textColor: '#e6edf3' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#343434' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { visible: true, borderColor: '#485c7b' },
      timeScale: { visible: true, borderColor: '#485c7b' },
    });

    this.rsiSeries = this.rsiChart.addLineSeries({
      color: this.color,
      lineWidth: 2,
    });

    // Overbought/oversold lines
    [70, 30].forEach((level, idx) => {
      this.rsiSeries.createPriceLine?.({
        price: level,
        color: idx === 0 ? 'red' : 'green',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
    });

    // Sync with main chart
    this.mainChart?.timeScale()?.subscribeVisibleLogicalRangeChange((range) => {
      if (range) this.rsiChart?.timeScale().setVisibleLogicalRange(range);
    });
    this.rsiChart?.timeScale()?.subscribeVisibleLogicalRangeChange((range) => {
      if (range) this.mainChart?.timeScale().setVisibleLogicalRange(range);
    });

    this._rendered = true;
  }

  // ---- Update RSI Data ----
  update(data) {
    if (!this.rsiSeries || !this._rendered) return;
    const rsiData = this.calculate(data);
    if (rsiData.length > 0) {
      this.rsiSeries.setData(rsiData);
      this.lastValue = rsiData.at(-1).value;
    }
  }

  // ---- Resize ----
  resize(width, height) {
    if (!this.rsiChart || !this.container) return;
    try {
      if (height) this.container.style.height = `${height}px`;
      this.rsiChart.resize(width, height);
    } catch (err) {
      console.warn('RSI resize failed', err);
    }
  }

  // ---- Cleanup ----
  destroy() {
    try {
      this.mainChart?.timeScale()?.unsubscribeVisibleLogicalRangeChange();
      this.rsiChart?.timeScale()?.unsubscribeVisibleLogicalRangeChange();
    } catch {}

    if (this.container) this.container.innerHTML = '';
    this.rsiSeries = null;
    this.rsiChart = null;
    this.container = null;
    this._rendered = false;
    this.lastValue = undefined;
  }
}
