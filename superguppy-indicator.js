// superguppy-indicator.js
// Based on classic Super Guppy (CM SuperGuppy, TradingView/PineScript logic)

import { BaseIndicator } from './base-indicator.js';

export class SuperGuppyIndicator extends BaseIndicator {
  constructor(chart) {
    super(chart);
    this.chart = chart;
    // Classic periods
    this.fastPeriods = [3, 6, 9, 12, 15, 18, 21];
    this.slowPeriods = [24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66];
    this.emaPeriods = this.fastPeriods.concat(this.slowPeriods, [200]);
    this._isDestroyed = false;
    this.allSeries = [];
  }

  // Classic EMA calculation (returns full array of {time, value})
  calcEMA(values, period) {
    if (!values || values.length === 0) return [];
    const k = 2 / (period + 1);
    let emaArr = [];
    let prev = values[0].close;
    emaArr.push({ time: values[0].time, value: prev });
    for (let i = 1; i < values.length; i++) {
      prev = values[i].close * k + prev * (1 - k);
      emaArr.push({ time: values[i].time, value: prev });
    }
    return emaArr;
  }

  static splitColorSegments(emaArr, colorArr) {
    if (emaArr.length === 0) return [];
    const segments = [];
    let currentColor = colorArr[0];
    let currentSeg = [emaArr[0]];
    for (let i = 1; i < emaArr.length; i++) {
      if (colorArr[i] === currentColor) {
        currentSeg.push(emaArr[i]);
      } else {
        if (currentSeg.length > 1) segments.push({ points: currentSeg, color: currentColor });
        currentColor = colorArr[i];
        currentSeg = [emaArr[i - 1], emaArr[i]];
      }
    }
    if (currentSeg.length > 1) segments.push({ points: currentSeg, color: currentColor });
    return segments;
  }

  render() {
    // No-op: series are created dynamically in update()
  }

  update(data) {
    if (this._isDestroyed || !data || data.length === 0) return;
    // Remove all previous series
    if (this.allSeries.length && this.chart) {
      this.allSeries.forEach(s => this.chart.removeSeries(s));
      this.allSeries = [];
    }

    // Compute all EMAs
    const emas = this.emaPeriods.map(p => this.calcEMA(data, p));
    const N = data.length;
    const fastEMAs = emas.slice(0, this.fastPeriods.length);
    const slowEMAs = emas.slice(this.fastPeriods.length, this.fastPeriods.length + this.slowPeriods.length);

    // For each bar, only compute colors if all EMAs for that bar are defined
    let colFinal = [];
    let colFinal2 = [];

    for (let i = 0; i < N; i++) {
      // Check all fast and slow EMAs exist at this bar
      let allFastDefined = fastEMAs.every(arr => arr[i] && typeof arr[i].value === 'number');
      let allSlowDefined = slowEMAs.every(arr => arr[i] && typeof arr[i].value === 'number');

      if (!allFastDefined || !allSlowDefined) {
        colFinal.push('gray');
        colFinal2.push('gray');
        continue;
      }

      // Fast group up/down (classic guppy: all fast in order)
      let fastL = true, fastS = true;
      for (let k = 0; k < this.fastPeriods.length - 1; k++) {
        fastL = fastL && (fastEMAs[k][i].value > fastEMAs[k + 1][i].value);
        fastS = fastS && (fastEMAs[k][i].value < fastEMAs[k + 1][i].value);
      }
      // Slow group up/down
      let slowL = true, slowS = true;
      for (let k = 0; k < this.slowPeriods.length - 1; k++) {
        slowL = slowL && (slowEMAs[k][i].value > slowEMAs[k + 1][i].value);
        slowS = slowS && (slowEMAs[k][i].value < slowEMAs[k + 1][i].value);
      }

      // Colors as per TradingView/PineScript
      // Fast: "aqua" if fastL && slowL, "orange" if fastS && slowS, "gray" otherwise
      if (fastL && slowL) colFinal.push('aqua');
      else if (fastS && slowS) colFinal.push('orange');
      else colFinal.push('gray');

      // Slow: "lime" if slowL, "red" if slowS, "gray" otherwise
      if (slowL) colFinal2.push('lime');
      else if (slowS) colFinal2.push('red');
      else colFinal2.push('gray');
    }

    // Draw all fast EMAs (per-bar colors)
    for (let f = 0; f < this.fastPeriods.length; f++) {
      const emaArr = fastEMAs[f];
      const colorArr = colFinal;
      const segments = SuperGuppyIndicator.splitColorSegments(emaArr, colorArr);
      segments.forEach(seg => {
        const lineSeries = this.chart.addLineSeries({
          color: seg.color,
          lineWidth: (f === 0 || f === this.fastPeriods.length - 1) ? 2 : 1,
          priceLineVisible: false,
          crossHairMarkerVisible: false,
          lastValueVisible: false // <--- disables colored price marker for this series
        });
        lineSeries.setData(seg.points);
        this.allSeries.push(lineSeries);
      });
    }

    // Draw all slow EMAs (per-bar colors)
    for (let s = 0; s < this.slowPeriods.length; s++) {
      const emaArr = slowEMAs[s];
      const colorArr = colFinal2;
      const segments = SuperGuppyIndicator.splitColorSegments(emaArr, colorArr);
      segments.forEach(seg => {
        const lineSeries = this.chart.addLineSeries({
          color: seg.color,
          lineWidth: (s === 0 || s === this.slowPeriods.length - 1) ? 2 : 1,
          priceLineVisible: false,
          crossHairMarkerVisible: false,
          lastValueVisible: false // <--- disables colored price marker for this series
        });
        lineSeries.setData(seg.points);
        this.allSeries.push(lineSeries);
      });
    }

    // Baseline EMA200 (white)
    const ema200 = emas[emas.length - 1];
    if (ema200 && ema200.length > 0) {
      const lineSeries = this.chart.addLineSeries({
        color: '#fff',
        lineWidth: 2,
        priceLineVisible: false,
        crossHairMarkerVisible: false,
        lastValueVisible: false // <--- disables colored price marker for this series
      });
      lineSeries.setData(ema200);
      this.allSeries.push(lineSeries);
    }
  }

  updateLast(candle, history) {
    if (this._isDestroyed || !history?.length) return;
    this.update(history);
  }

  remove() {
    this.destroy();
  }

  destroy() {
    if (this._isDestroyed) return;
    if (this.allSeries.length && this.chart) {
      this.allSeries.forEach(s => {
        try { this.chart.removeSeries(s); } catch {}
      });
      this.allSeries = [];
    }
    super.destroy();
    this._isDestroyed = true;
  }
}