// ema-indicator.js
export class EMAIndicator {
  constructor(chart, period, color = 'orange') {
    this.chart = chart;
    this.period = period;
    this.color = color;

    this.series = this.chart.addLineSeries({
      color: this.color,
      lineWidth: 2,
      priceLineVisible: false,
      crossHairMarkerVisible: false,
    });
  }

  // Calculate EMA for a single period
  calculateEMA(candles) {
    if (!candles || candles.length < this.period) return [];
    const k = 2 / (this.period + 1);
    let prevEma = candles[0].close;
    const emaArray = [];

    for (let i = 0; i < candles.length; i++) {
      const close = candles[i].close;
      if (i === 0) {
        emaArray.push({ time: candles[i].time, value: prevEma });
      } else {
        prevEma = close * k + prevEma * (1 - k);
        emaArray.push({ time: candles[i].time, value: prevEma });
      }
    }
    return emaArray;
  }

  // Called on full history load
  update(candles) {
    if (!candles || candles.length === 0) return;
    const emaData = this.calculateEMA(candles);
    if (emaData.length > 0) {
      this.series.setData(emaData);
    }
  }

  // Called on live update (incremental)
  updateLast(candle, history) {
    if (!candle || !history || history.length < this.period) return;
    const emaData = this.calculateEMA(history);
    if (emaData.length > 0) {
      this.series.update(emaData[emaData.length - 1]);
    }
  }

  remove() {
    if (this.series) {
      this.chart.removeSeries(this.series);
      this.series = null;
    }
  }

  destroy() {
    this.remove();
  }
}
