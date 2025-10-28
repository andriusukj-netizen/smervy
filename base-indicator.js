// indicators/base-indicator.js
export class BaseIndicator {
  constructor(chart, options = {}) {
    this.chart = chart;     // LightweightCharts chart instance
    this.options = options; // config (period, colors, etc.)
    this.series = null;     // chart series
  }

  calculate(data) {
    throw new Error("calculate() must be implemented");
  }

  render(container) {
    throw new Error("render() must be implemented");
  }

  update(data) {
    throw new Error("update() must be implemented");
  }

  destroy() {
    if (this.series && this.chart) {
      this.chart.removeSeries(this.series);
      this.series = null;
    }
  }
}
