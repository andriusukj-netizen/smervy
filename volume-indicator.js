// volume-indicator.js
import { BaseIndicator } from './base-indicator.js';

export class VolumeIndicator extends BaseIndicator {
  constructor(chart, options = {}) {
    const opts = { height: 120, upColor: '#26a69a', downColor: '#ef5350', ...options };
    super(chart, opts);

    this.height = opts.height;
    this.upColor = opts.upColor;
    this.downColor = opts.downColor;

    this.container = null;
    this.volumeChart = null;
    this.volumeSeries = null;
    this._rendered = false;
  }

  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('Volume container not found:', containerId);
      return;
    }
    this.container = container;

    if (container.clientHeight === 0) {
      container.style.minHeight = this.height + 'px';
      container.style.height = this.height + 'px';
    }

    this.volumeChart = LightweightCharts.createChart(container, {
      height: Math.max(this.height, container.clientHeight || 0),
      layout: { background: { color: '#11161d' }, textColor: '#e6edf3' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#343434' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { visible: false },
      timeScale: { visible: true, borderColor: '#485c7b' },
    });

    this.volumeSeries = this.volumeChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
    });

    this._rendered = true;
  }

  update(data) {
    if (!this.volumeSeries || !this._rendered) return;
    if (!data || data.length === 0) return;

    const volumeData = data.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? this.upColor : this.downColor
    }));

    this.volumeSeries.setData(volumeData);
  }

  updateLast(candle) {
    if (!this.volumeSeries || !this._rendered) return;
    if (!candle) return;

    this.volumeSeries.update({
      time: candle.time,
      value: candle.volume,
      color: candle.close >= candle.open ? this.upColor : this.downColor
    });
  }

  resize(width, height) {
    if (!this.volumeChart || !this.container) return;
    try {
      if (height && this.container.clientHeight !== height) {
        this.container.style.height = height + 'px';
      }
      this.volumeChart.resize(width, height);
    } catch (err) {
      console.warn('Volume resize failed', err);
    }
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
    this.volumeSeries = null;
    this.volumeChart = null;
    this.container = null;
    this._rendered = false;
  }
}
