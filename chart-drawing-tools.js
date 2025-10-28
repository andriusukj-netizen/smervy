// chart-drawing-tools.js
// Drawing Tools for Lightweight Charts with per-chart localStorage support
// ENHANCED: Move/Edit shapes, Multi-point drawings, Undo/Redo support, Whole-shape drag

export class DrawingToolsManager {
  constructor(chart, container, chartKey) {
    this.chart = chart;
    this.container = container;
    this.chartKey = chartKey;
    this.overlay = null;
    this.toolbar = null;
    this.activeTool = null;
    this.drawings = [];
    this.isDrawing = false;
    this.currentShape = null;
    this.color = "#2196f3";
    this.thickness = 2;
    this.eventHandlers = [];
    this.resizeHandler = null;
    this.priceScaleHandler = null;
    this.toolButtons = {};
    this.themeObserver = null;
    this.visibleRangeHandler = null;
    this.candleSeries = null;
    // --- Enhanced features ---
    this.selectedShapeIdx = null;
    this.actionStack = [];
    this.redoStack = [];
    this.isMovingPoint = false;
    this.movePointIdx = null;
    // Whole-shape drag
    this.isMovingShape = false;
    this.moveShapeStart = null;
    this.moveShapeStartPoints = null;
    this.init();
    this.loadDrawings();
  }

  addEventListener(element, event, handler, options) {
    if (!element) return;
    element.addEventListener(event, handler, options);
    this.eventHandlers.push({ element, event, handler, options });
  }

  getThemedColors() {
    const root = document.documentElement;
    const theme = root.getAttribute('data-theme') || 'dark';
    const isDark = theme === 'dark';
    return {
      toolbarBg: isDark ? 'rgba(24,32,44,0.96)' : 'rgba(245,247,250,0.96)',
      toolbarBorder: isDark ? '#30363d' : '#d0d7de',
      buttonColor: isDark ? '#fff' : '#23272e',
      buttonHoverBg: isDark ? 'rgba(33, 118, 255, 0.2)' : 'rgba(33, 118, 255, 0.15)',
      inputBg: isDark ? '#161b22' : '#ffffff',
      inputBorder: isDark ? '#30363d' : '#d0d7de',
      inputColor: isDark ? '#fff' : '#23272e',
    };
  }

  applyThemedStyles() {
    if (!this.toolbar) return;
    const colors = this.getThemedColors();
    Object.assign(this.toolbar.style, {
      background: colors.toolbarBg,
      borderRadius: "7px",
      padding: "4px 6px",
      gap: "7px",
      alignItems: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      backdropFilter: "blur(10px)",
      border: `1px solid ${colors.toolbarBorder}`
    });
    Object.values(this.toolButtons).forEach(btn => {
      btn.style.color = colors.buttonColor;
    });
    const inputs = this.toolbar.querySelectorAll('input[type="number"]');
    inputs.forEach(input => {
      Object.assign(input.style, {
        background: colors.inputBg,
        color: colors.inputColor,
        border: `1px solid ${colors.inputBorder}`
      });
    });
  }

  setupThemeObserver() {
    const root = document.documentElement;
    this.themeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          this.applyThemedStyles();
        }
      });
    });
    this.themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  pixelToChart(x, y) {
    try {
      const timeScale = this.chart.timeScale();
      if (!timeScale) return null;
      const time = timeScale.coordinateToTime(x);
      if (time === null || time === undefined) return null;
      const timestamp = typeof time === 'object' ? 
        new Date(time.year, time.month - 1, time.day).getTime() / 1000 : 
        time;
      const series = this.candleSeries || this.chart._series?.[0];
      if (!series) return null;
      const price = series.coordinateToPrice(y);
      if (price === null || price === undefined) return null;
      return { time: timestamp, price };
    } catch (error) {
      console.warn('[DrawingTools] Error converting pixel to chart:', error);
      return null;
    }
  }
  
  chartToPixel(time, price) {
    try {
      const timeScale = this.chart.timeScale();
      if (!timeScale) return null;
      const normalizedTime = typeof time === 'number' ? Math.floor(time) : time;
      const x = timeScale.timeToCoordinate(normalizedTime);
      if (x === null || x === undefined) return null;
      const series = this.candleSeries || this.chart._series?.[0];
      if (!series) return null;
      const y = series.priceToCoordinate(price);
      if (y === null || y === undefined) return null;
      return { x, y };
    } catch (error) {
      console.warn('[DrawingTools] Error converting chart to pixel:', error);
      return null;
    }
  }
  
  setCandleSeries(series) { this.candleSeries = series; }
  _resizeOverlayToContainer() {
    if (!this.overlay || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.overlay.style.width = rect.width + "px";
    this.overlay.style.height = rect.height + "px";
    this.overlay.setAttribute("width", rect.width);
    this.overlay.setAttribute("height", rect.height);
  }

  _instantRedraw = () => { this._resizeOverlayToContainer(); this.redraw(); }

  init() {
    this.createOverlay();
    this.createToolbar();
    this.attachEvents();
    this.setupThemeObserver();

    // Window resize: double-raf
    this.resizeHandler = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this._resizeOverlayToContainer();
          this.redraw();
        });
      });
    };
    window.addEventListener('resize', this.resizeHandler);

    // Pan/zoom/time scale: redraw synchronously
    this.visibleRangeHandler = () => {
      this._resizeOverlayToContainer();
      this.redraw();
    };

    // Price scale (vertical zoom): double-raf
    this.priceScaleHandler = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this._resizeOverlayToContainer();
          this.redraw();
        });
      });
    };

    const timeScale = this.chart.timeScale();
    if (timeScale?.subscribeVisibleLogicalRangeChange) {
      timeScale.subscribeVisibleLogicalRangeChange(this.visibleRangeHandler);
    }
    if (timeScale?.subscribeVisibleTimeRangeChange) {
      timeScale.subscribeVisibleTimeRangeChange(this.visibleRangeHandler);
    }
    if (typeof this.chart.subscribeSizeChanged === 'function') {
      this.chart.subscribeSizeChanged(this.resizeHandler);
    }
    if (typeof this.chart.subscribePriceScaleChange === 'function') {
      this.chart.subscribePriceScaleChange(this.priceScaleHandler);
    }

    this._resizeOverlayToContainer();
    this.redraw();
  }

  createOverlay() {
    this.overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.assign(this.overlay.style, {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: 20
    });
    this.container.appendChild(this.overlay);
    this._resizeOverlayToContainer();
  }

  createToolbar() {
    const colors = this.getThemedColors();
    let bar = document.createElement("div");
    bar.className = "drawing-toolbar";
    Object.assign(bar.style, {
      position: "absolute",
      top: "6px",
      right: "8px",
      zIndex: 21,
      background: colors.toolbarBg,
      border: `1px solid ${colors.toolbarBorder}`,
      borderRadius: "7px",
      padding: "4px 6px",
      display: "none",
      gap: "7px",
      alignItems: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      backdropFilter: "blur(10px)"
    });

    const tools = [
      { tool: "select", label: "↻", tooltip: "Select/Move" },
      { tool: "trend",  label: "📈", tooltip: "Trend Line" },
      { tool: "hline",  label: "▬",  tooltip: "Horizontal Line" },
      { tool: "vline",  label: "▮",  tooltip: "Vertical Line" },
      { tool: "fib",    label: "𝔽",  tooltip: "Fibonacci" },
      { tool: "rect",   label: "▭",  tooltip: "Rectangle" },
      { tool: "ellipse",label: "◯",  tooltip: "Ellipse" },
      { tool: "poly",   label: "↝",  tooltip: "Polyline" },
      { tool: "arrow",  label: "➤",  tooltip: "Arrow" },
      { tool: "text",   label: "𝓣",  tooltip: "Text" },
      { tool: "erase",  label: "✖", tooltip: "Delete Mode" },
    ];
    for (const t of tools) {
      let btn = document.createElement("button");
      btn.textContent = t.label;
      btn.title = t.tooltip;
      btn.onclick = () => this.setTool(t.tool);
      Object.assign(btn.style, {
        fontSize: "1.14em",
        background: "none",
        border: "none",
        color: colors.buttonColor,
        cursor: "pointer",
        padding: "2px 7px",
        borderRadius: "4px",
        transition: "all 0.2s"
      });
      bar.appendChild(btn);
      this.toolButtons[t.tool] = btn;
    }
    // Undo/Redo buttons
    const undoBtn = document.createElement("button");
    undoBtn.textContent = "↶";
    undoBtn.title = "Undo";
    undoBtn.onclick = () => this.undo();
    Object.assign(undoBtn.style, { fontSize: "1.14em", background: "none", border: "none", color: colors.buttonColor, cursor: "pointer", borderRadius: "4px", padding: "2px 7px" });
    bar.appendChild(undoBtn);
    this.toolButtons["undo"] = undoBtn;

    const redoBtn = document.createElement("button");
    redoBtn.textContent = "↷";
    redoBtn.title = "Redo";
    redoBtn.onclick = () => this.redo();
    Object.assign(redoBtn.style, { fontSize: "1.14em", background: "none", border: "none", color: colors.buttonColor, cursor: "pointer", borderRadius: "4px", padding: "2px 7px" });
    bar.appendChild(redoBtn);
    this.toolButtons["redo"] = redoBtn;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = this.color;
    colorInput.title = "Line/Shape Color";
    colorInput.oninput = e => { this.color = e.target.value; };
    Object.assign(colorInput.style, {
      width: "30px",
      height: "24px",
      border: "none",
      borderRadius: "4px",
      cursor: "pointer"
    });
    bar.appendChild(colorInput);

    const thickInput = document.createElement("input");
    thickInput.type = "number";
    thickInput.value = this.thickness;
    thickInput.min = 1;
    thickInput.max = 10;
    thickInput.style.width = "38px";
    thickInput.title = "Line Width";
    thickInput.oninput = e => { this.thickness = Math.max(1, Math.min(10, +e.target.value)); };
    Object.assign(thickInput.style, {
      background: colors.inputBg,
      color: colors.inputColor,
      border: `1px solid ${colors.inputBorder}`,
      borderRadius: "4px",
      padding: "2px 4px"
    });
    bar.appendChild(thickInput);

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "🗑";
    clearBtn.title = "Clear All";
    clearBtn.onclick = () => { 
      if (confirm('Clear all drawings?')) {
        this.saveToActionStack();
        this.drawings = []; 
        this.saveDrawings(); 
        this.redraw(); 
      }
    };
    Object.assign(clearBtn.style, {
      fontSize: "1.14em",
      background: "none",
      border: "none",
      color: colors.buttonColor,
      cursor: "pointer",
      borderRadius: "4px",
      padding: "2px 7px"
    });
    bar.appendChild(clearBtn);

    this.container.appendChild(bar);
    this.toolbar = bar;
  }

  setTool(tool) {
    this.activeTool = tool;
    this.isDrawing = false;
    this.currentShape = null;
    this.selectedShapeIdx = null;
    this.isMovingPoint = false;
    this.movePointIdx = null;
    this.isMovingShape = false;
    this.moveShapeStart = null;
    this.moveShapeStartPoints = null;
    for (const t in this.toolButtons) {
      this.toolButtons[t].style.background = (t === tool) ? "#2176ff44" : "none";
    }
    this.overlay.style.pointerEvents = "auto";
  }

  attachEvents() {
    this.addEventListener(this.overlay, "mousedown", e => this.onDown(e));
    this.addEventListener(this.overlay, "mousemove", e => this.onMove(e));
    this.addEventListener(this.overlay, "mouseup", e => this.onUp(e));
    this.addEventListener(this.overlay, "touchstart", e => { e.preventDefault(); this.onDown(e); }, { passive: false });
    this.addEventListener(this.overlay, "touchmove", e => { e.preventDefault(); this.onMove(e); }, { passive: false });
    this.addEventListener(this.overlay, "touchend", e => this.onUp(e));
    this.addEventListener(this.overlay, "click", e => {
      if (this.activeTool === "erase") {
        const [x, y] = this.getChartXY(e);
        const beforeCount = this.drawings.length;
        this.saveToActionStack();
        this.drawings = this.drawings.filter(shape => !this.hitTest(shape, x, y));
        if (this.drawings.length < beforeCount) {
          this.saveDrawings();
          this.redraw();
        }
      } else if (this.activeTool === "select") {
        // Selection logic
        const [x, y] = this.getChartXY(e);
        this.selectedShapeIdx = null;
        for (let i = 0; i < this.drawings.length; i++) {
          if (this.hitTest(this.drawings[i], x, y)) {
            this.selectedShapeIdx = i;
            break;
          }
        }
        this.redraw();
      } else if (this.activeTool === "text") {
        const [x, y] = this.getChartXY(e);
        const chartCoords = this.pixelToChart(x, y);
        if (!chartCoords) return;
        const text = prompt("Enter annotation text:");
        if (text) {
          this.saveToActionStack();
          this.drawings.push({
            tool: "text",
            color: this.color,
            thickness: this.thickness,
            points: [chartCoords],
            value: text
          });
          this.saveDrawings();
          this.redraw();
        }
      }
    });
  }

  getChartXY(e) {
    const rect = this.overlay.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return [clientX - rect.left, clientY - rect.top];
  }

  onDown(e) {
    const [x, y] = this.getChartXY(e);
    if (this.activeTool === "select") {
      this.selectedShapeIdx = null;
      this.isMovingPoint = false;
      this.isMovingShape = false;
      for (let i = 0; i < this.drawings.length; i++) {
        if (this.hitTest(this.drawings[i], x, y)) {
          this.selectedShapeIdx = i;
          const shape = this.drawings[i];
          // Find nearest point to (x, y)
          let nearestPoint = -1, minDist = 20;
          for (let j = 0; j < shape.points.length; j++) {
            const p = this.chartToPixel(shape.points[j].time, shape.points[j].price);
            if (!p) continue;
            const dist = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
            if (dist < minDist) {
              nearestPoint = j;
              minDist = dist;
            }
          }
          if (nearestPoint !== -1) {
            this.isMovingPoint = true;
            this.movePointIdx = nearestPoint;
          } else {
            // Not near a point, so start moving the whole shape
            this.isMovingShape = true;
            this.moveShapeStart = { x, y };
            this.moveShapeStartPoints = shape.points.map(pt => ({ ...pt }));
          }
          break;
        }
      }
      this.redraw();
    } else if (!this.activeTool || this.activeTool === "erase") {
      return;
    } else {
      this.isDrawing = true;
      const chartCoords = this.pixelToChart(x, y);
      if (!chartCoords) return;
      if (["poly", "arrow"].includes(this.activeTool)) {
        this.currentShape = { 
          tool: this.activeTool, 
          color: this.color, 
          thickness: this.thickness, 
          points: [chartCoords]
        };
      } else if (["trend", "hline", "vline", "fib", "rect", "ellipse"].includes(this.activeTool)) {
        this.currentShape = { 
          tool: this.activeTool, 
          color: this.color, 
          thickness: this.thickness, 
          points: [chartCoords]
        };
        this.currentShape.points.push(chartCoords);
      }
      if (this.activeTool === "fib") {
        this.currentShape.levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      }
      e.preventDefault();
    }
  }

  onMove(e) {
    const [x, y] = this.getChartXY(e);
    if (this.activeTool === "select" && this.selectedShapeIdx !== null) {
      if (this.isMovingPoint) {
        const chartCoords = this.pixelToChart(x, y);
        if (!chartCoords) return;
        this.drawings[this.selectedShapeIdx].points[this.movePointIdx] = chartCoords;
        this.redraw();
      } else if (this.isMovingShape) {
        // Move entire shape
        const startChart = this.pixelToChart(this.moveShapeStart.x, this.moveShapeStart.y);
        const curChart = this.pixelToChart(x, y);
        if (!startChart || !curChart) return;
        const dt = curChart.time - startChart.time;
        const dp = curChart.price - startChart.price;
        const newPoints = this.moveShapeStartPoints.map(pt => ({
          time: pt.time + dt,
          price: pt.price + dp,
        }));
        this.drawings[this.selectedShapeIdx].points = newPoints;
        this.redraw();
      }
      return;
    }
    if (!this.isDrawing || !this.currentShape) return;
    const chartCoords = this.pixelToChart(x, y);
    if (!chartCoords) return;
    if (["poly", "arrow"].includes(this.activeTool)) {
      if (!this.currentShape.points) this.currentShape.points = [];
      if (this.currentShape.points.length > 0) {
        this.currentShape.points[this.currentShape.points.length - 1] = chartCoords;
      }
      this.redraw();
      this.drawShape(this.currentShape, true);
    } else {
      this.currentShape.points[1] = chartCoords;
      this.redraw();
      this.drawShape(this.currentShape, true);
    }
    e.preventDefault();
  }

  onUp(e) {
    if (this.activeTool === "select" && this.selectedShapeIdx !== null) {
      if (this.isMovingPoint || this.isMovingShape) {
        this.saveDrawings();
        this.isMovingPoint = false;
        this.movePointIdx = null;
        this.isMovingShape = false;
        this.moveShapeStart = null;
        this.moveShapeStartPoints = null;
        return;
      }
    }
    if (!this.isDrawing || !this.currentShape) return;
    const [x, y] = this.getChartXY(e);
    const chartCoords = this.pixelToChart(x, y);
    if (!chartCoords) return;
    if (["poly", "arrow"].includes(this.activeTool)) {
      if (e.type === "mouseup" && e.detail === 2) {
        this.saveToActionStack();
        this.drawings.push(this.currentShape);
        this.saveDrawings();
        this.isDrawing = false;
        this.currentShape = null;
        this.redraw();
        return;
      }
      if (!this.currentShape.points) this.currentShape.points = [];
      this.currentShape.points.push(chartCoords);
    } else {
      this.currentShape.points[1] = chartCoords;
      const p0Pixel = this.chartToPixel(this.currentShape.points[0].time, this.currentShape.points[0].price);
      const p1Pixel = this.chartToPixel(this.currentShape.points[1].time, this.currentShape.points[1].price);
      if (p0Pixel && p1Pixel) {
        const distance = Math.sqrt(Math.pow(p1Pixel.x - p0Pixel.x, 2) + Math.pow(p1Pixel.y - p0Pixel.y, 2));
        if (distance > 5) {
          this.saveToActionStack();
          this.drawings.push(this.currentShape);
          this.saveDrawings();
        }
      }
      this.isDrawing = false;
      this.currentShape = null;
      this.redraw();
    }
    e.preventDefault();
  }

  redraw() {
    this._resizeOverlayToContainer();
    while (this.overlay.firstChild) this.overlay.removeChild(this.overlay.firstChild);
    for (let i = 0; i < this.drawings.length; i++) {
      this.drawShape(this.drawings[i], false, i === this.selectedShapeIdx);
    }
  }

  drawShape(shape, isTemp, isSelected) {
    const { tool, color, thickness, points } = shape;
    if (!points || points.length === 0) return;
    // Multi-point tools
    if (tool === "poly") {
      for (let i = 1; i < points.length; i++) {
        const p0 = this.chartToPixel(points[i-1].time, points[i-1].price);
        const p1 = this.chartToPixel(points[i].time, points[i].price);
        if (!p0 || !p1) continue;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", p0.x); line.setAttribute("y1", p0.y);
        line.setAttribute("x2", p1.x); line.setAttribute("y2", p1.y);
        line.setAttribute("stroke", color); line.setAttribute("stroke-width", thickness);
        line.setAttribute("fill", "none");
        if (isTemp) line.setAttribute("opacity", 0.6);
        this.overlay.appendChild(line);
      }
      // Draw points as handles if selected
      if (isSelected) {
        points.forEach(pt => {
          const p = this.chartToPixel(pt.time, pt.price);
          if (!p) return;
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", p.x); handle.setAttribute("cy", p.y);
          handle.setAttribute("r", 6);
          handle.setAttribute("fill", "#fff");
          handle.setAttribute("stroke", color);
          handle.setAttribute("stroke-width", 2);
          this.overlay.appendChild(handle);
        });
      }
    }
    if (tool === "arrow") {
      // Draw as polyline with an arrowhead at the end
      if (points.length < 2) return;
      for (let i = 1; i < points.length; i++) {
        const p0 = this.chartToPixel(points[i-1].time, points[i-1].price);
        const p1 = this.chartToPixel(points[i].time, points[i].price);
        if (!p0 || !p1) continue;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", p0.x); line.setAttribute("y1", p0.y);
        line.setAttribute("x2", p1.x); line.setAttribute("y2", p1.y);
        line.setAttribute("stroke", color); line.setAttribute("stroke-width", thickness);
        line.setAttribute("fill", "none");
        if (isTemp) line.setAttribute("opacity", 0.6);
        this.overlay.appendChild(line);
      }
      // Draw arrowhead at last segment
      const p0 = this.chartToPixel(points[points.length-2].time, points[points.length-2].price);
      const p1 = this.chartToPixel(points[points.length-1].time, points[points.length-1].price);
      if (p0 && p1) {
        // Calculate arrowhead
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > 0) {
          const ux = dx / len, uy = dy / len;
          const size = 18;
          const left = { x: p1.x - size*ux + size*uy/2, y: p1.y - size*uy - size*ux/2 };
          const right = { x: p1.x - size*ux - size*uy/2, y: p1.y - size*uy + size*ux/2 };
          const arrowhead = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          arrowhead.setAttribute("points", `${p1.x},${p1.y} ${left.x},${left.y} ${right.x},${right.y}`);
          arrowhead.setAttribute("fill", color);
          this.overlay.appendChild(arrowhead);
        }
      }
      // Draw points as handles if selected
      if (isSelected) {
        points.forEach(pt => {
          const p = this.chartToPixel(pt.time, pt.price);
          if (!p) return;
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", p.x); handle.setAttribute("cy", p.y);
          handle.setAttribute("r", 6);
          handle.setAttribute("fill", "#fff");
          handle.setAttribute("stroke", color);
          handle.setAttribute("stroke-width", 2);
          this.overlay.appendChild(handle);
        });
      }
    }
    if (tool === "trend") {
      if (points.length < 2) return;
      const p0 = this.chartToPixel(points[0].time, points[0].price);
      const p1 = this.chartToPixel(points[1].time, points[1].price);
      if (!p0 || !p1) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", p0.x); line.setAttribute("y1", p0.y);
      line.setAttribute("x2", p1.x); line.setAttribute("y2", p1.y);
      line.setAttribute("stroke", color); line.setAttribute("stroke-width", thickness);
      line.setAttribute("fill", "none");
      if (isTemp) line.setAttribute("opacity", 0.6);
      if (isSelected) line.setAttribute("stroke-dasharray", "4 4");
      this.overlay.appendChild(line);
      if (isSelected) {
        [p0, p1].forEach(p => {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", p.x); handle.setAttribute("cy", p.y);
          handle.setAttribute("r", 6);
          handle.setAttribute("fill", "#fff");
          handle.setAttribute("stroke", color);
          handle.setAttribute("stroke-width", 2);
          this.overlay.appendChild(handle);
        });
      }
    }
    if (tool === "hline") {
      const y = this.chartToPixel(points[0].time, points[0].price)?.y;
      const w = this.overlay.clientWidth || this.overlay.width.baseVal.value;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", 0); line.setAttribute("y1", y);
      line.setAttribute("x2", w); line.setAttribute("y2", y);
      line.setAttribute("stroke", color); line.setAttribute("stroke-width", thickness);
      line.setAttribute("stroke-dasharray", "6 3");
      if (isTemp) line.setAttribute("opacity", 0.6);
      this.overlay.appendChild(line);
    }
    if (tool === "vline") {
      const x = this.chartToPixel(points[0].time, points[0].price)?.x;
      const h = this.overlay.clientHeight || this.overlay.height.baseVal.value;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x); line.setAttribute("y1", 0);
      line.setAttribute("x2", x); line.setAttribute("y2", h);
      line.setAttribute("stroke", color); line.setAttribute("stroke-width", thickness);
      line.setAttribute("stroke-dasharray", "6 3");
      if (isTemp) line.setAttribute("opacity", 0.6);
      this.overlay.appendChild(line);
    }
    if (tool === "rect") {
      if (points.length < 2) return;
      const p0 = this.chartToPixel(points[0].time, points[0].price);
      const p1 = this.chartToPixel(points[1].time, points[1].price);
      if (!p0 || !p1) return;
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x);
      const h = Math.abs(p1.y - p0.y);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", w); rect.setAttribute("height", h);
      rect.setAttribute("stroke", color); rect.setAttribute("stroke-width", thickness);
      rect.setAttribute("fill", "none");
      if (isTemp) rect.setAttribute("opacity", 0.6);
      if (isSelected) rect.setAttribute("stroke-dasharray", "4 4");
      this.overlay.appendChild(rect);
      if (isSelected) {
        [p0, p1].forEach(p => {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", p.x); handle.setAttribute("cy", p.y);
          handle.setAttribute("r", 6);
          handle.setAttribute("fill", "#fff");
          handle.setAttribute("stroke", color);
          handle.setAttribute("stroke-width", 2);
          this.overlay.appendChild(handle);
        });
      }
    }
    if (tool === "ellipse") {
      if (points.length < 2) return;
      const p0 = this.chartToPixel(points[0].time, points[0].price);
      const p1 = this.chartToPixel(points[1].time, points[1].price);
      if (!p0 || !p1) return;
      const cx = (p0.x + p1.x) / 2;
      const cy = (p0.y + p1.y) / 2;
      const rx = Math.abs(p1.x - p0.x) / 2;
      const ry = Math.abs(p1.y - p0.y) / 2;
      const el = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      el.setAttribute("cx", cx); el.setAttribute("cy", cy);
      el.setAttribute("rx", rx); el.setAttribute("ry", ry);
      el.setAttribute("stroke", color); el.setAttribute("stroke-width", thickness);
      el.setAttribute("fill", "none");
      if (isTemp) el.setAttribute("opacity", 0.6);
      if (isSelected) el.setAttribute("stroke-dasharray", "4 4");
      this.overlay.appendChild(el);
      if (isSelected) {
        [p0, p1].forEach(p => {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", p.x); handle.setAttribute("cy", p.y);
          handle.setAttribute("r", 6);
          handle.setAttribute("fill", "#fff");
          handle.setAttribute("stroke", color);
          handle.setAttribute("stroke-width", 2);
          this.overlay.appendChild(handle);
        });
      }
    }
    if (tool === "fib") {
      if (points.length < 2) return;
      const p0 = this.chartToPixel(points[0].time, points[0].price);
      const p1 = this.chartToPixel(points[1].time, points[1].price);
      if (!p0 || !p1) return;
      const levels = shape.levels || [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      for (let lvl of levels) {
        const y = p0.y + (p1.y - p0.y) * lvl;
        const fibLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        fibLine.setAttribute("x1", p0.x); fibLine.setAttribute("y1", y);
        fibLine.setAttribute("x2", p1.x); fibLine.setAttribute("y2", y);
        fibLine.setAttribute("stroke", color); fibLine.setAttribute("stroke-width", thickness);
        fibLine.setAttribute("stroke-dasharray", "2 2");
        if (isTemp) fibLine.setAttribute("opacity", 0.6);
        this.overlay.appendChild(fibLine);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", Math.max(p0.x, p1.x) + 6); 
        text.setAttribute("y", y + 4);
        text.setAttribute("fill", color);
        text.setAttribute("font-size", "12px");
        text.setAttribute("font-weight", "600");
        text.textContent = `${(lvl * 100).toFixed(1)}%`;
        if (isTemp) text.setAttribute("opacity", 0.6);
        this.overlay.appendChild(text);
      }
    }
    if (tool === "text") {
      if (!points[0] || !shape.value) return;
      const p = this.chartToPixel(points[0].time, points[0].price);
      if (!p) return;
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", p.x + 8); text.setAttribute("y", p.y - 8);
      text.setAttribute("fill", color);
      text.setAttribute("font-size", "18px");
      text.setAttribute("font-weight", "600");
      text.textContent = shape.value;
      this.overlay.appendChild(text);
      if (isSelected) {
        const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handle.setAttribute("cx", p.x); handle.setAttribute("cy", p.y);
        handle.setAttribute("r", 6);
        handle.setAttribute("fill", "#fff");
        handle.setAttribute("stroke", color);
        handle.setAttribute("stroke-width", 2);
        this.overlay.appendChild(handle);
      }
    }
  }

  saveDrawings() {
    try {
      localStorage.setItem("drawings-" + this.chartKey, JSON.stringify(this.drawings));
    } catch (e) { 
      console.warn('[DrawingTools] Failed to save drawings:', e);
    }
  }
  
  loadDrawings() {
    try {
      const data = localStorage.getItem("drawings-" + this.chartKey);
      if (!data) {
        this.drawings = [];
        return;
      }
      const loaded = JSON.parse(data);
      this.drawings = loaded.filter(shape => {
        if (!shape || !shape.tool || !shape.points) return false;
        if (!Array.isArray(shape.points) || shape.points.length < 1) return false;
        for (let pt of shape.points) {
          if (!pt || typeof pt.time !== 'number' || typeof pt.price !== 'number') return false;
        }
        return true;
      });
      if (this.drawings.length !== loaded.length) {
        this.saveDrawings();
      }
      this.redraw();
    } catch (e) { 
      console.warn('[DrawingTools] Failed to load drawings:', e);
      this.drawings = [];
      try {
        localStorage.removeItem("drawings-" + this.chartKey);
      } catch (err) {}
    }
  }

  hitTest(shape, x, y) {
    // For multi-point, check if near any segment or point
    if (!shape.points || !shape.points[0]) return false;
    if (["poly", "arrow"].includes(shape.tool)) {
      for (let i = 1; i < shape.points.length; i++) {
        const p0 = this.chartToPixel(shape.points[i-1].time, shape.points[i-1].price);
        const p1 = this.chartToPixel(shape.points[i].time, shape.points[i].price);
        if (!p0 || !p1) continue;
        const dist = this._distToLine({x, y}, p0, p1);
        if (dist < 10) return true;
      }
      // Check points as handles
      for (let pt of shape.points) {
        const p = this.chartToPixel(pt.time, pt.price);
        if (!p) continue;
        const d = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
        if (d < 10) return true;
      }
      return false;
    }
    // For other shapes, check near line/rect/ellipse/text as needed
    if (shape.tool === "trend" && shape.points.length === 2) {
      const p0 = this.chartToPixel(shape.points[0].time, shape.points[0].price);
      const p1 = this.chartToPixel(shape.points[1].time, shape.points[1].price);
      if (!p0 || !p1) return false;
      const dist = this._distToLine({x, y}, p0, p1);
      if (dist < 10) return true;
      [p0, p1].forEach(p => {
        const d = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
        if (d < 10) return true;
      });
    }
    if (shape.tool === "rect" && shape.points.length === 2) {
      const p0 = this.chartToPixel(shape.points[0].time, shape.points[0].price);
      const p1 = this.chartToPixel(shape.points[1].time, shape.points[1].price);
      if (!p0 || !p1) return false;
      const xMin = Math.min(p0.x, p1.x), xMax = Math.max(p0.x, p1.x);
      const yMin = Math.min(p0.y, p1.y), yMax = Math.max(p0.y, p1.y);
      if (x >= xMin - 5 && x <= xMax + 5 && y >= yMin - 5 && y <= yMax + 5) return true;
    }
    if (shape.tool === "ellipse" && shape.points.length === 2) {
      const p0 = this.chartToPixel(shape.points[0].time, shape.points[0].price);
      const p1 = this.chartToPixel(shape.points[1].time, shape.points[1].price);
      if (!p0 || !p1) return false;
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      const rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
      const dx = x - cx, dy = y - cy;
      if (((dx*dx)/(rx*rx) + (dy*dy)/(ry*ry)) <= 1.1) return true;
    }
    if (shape.tool === "hline" && shape.points.length) {
      const yLine = this.chartToPixel(shape.points[0].time, shape.points[0].price)?.y;
      if (yLine !== undefined && Math.abs(y - yLine) < 8) return true;
    }
    if (shape.tool === "vline" && shape.points.length) {
      const xLine = this.chartToPixel(shape.points[0].time, shape.points[0].price)?.x;
      if (xLine !== undefined && Math.abs(x - xLine) < 8) return true;
    }
    if (shape.tool === "text" && shape.points.length) {
      const p = this.chartToPixel(shape.points[0].time, shape.points[0].price);
      if (!p) return false;
      if (Math.abs(x - p.x) < 16 && Math.abs(y - p.y) < 16) return true;
    }
    return false;
  }

  _distToLine(pt, v, w) {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(pt.x - v.x, 2) + Math.pow(pt.y - v.y, 2));
    let t = ((pt.x - v.x) * (w.x - v.x) + (pt.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return Math.sqrt(Math.pow(pt.x - proj.x, 2) + Math.pow(pt.y - proj.y, 2));
  }

  saveToActionStack() {
    this.actionStack.push(JSON.stringify(this.drawings));
    this.redoStack = [];
  }
  undo() {
    if (this.actionStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.drawings));
    const prev = this.actionStack.pop();
    this.drawings = JSON.parse(prev);
    this.saveDrawings();
    this.redraw();
  }
  redo() {
    if (this.redoStack.length === 0) return;
    this.actionStack.push(JSON.stringify(this.drawings));
    const next = this.redoStack.pop();
    this.drawings = JSON.parse(next);
    this.saveDrawings();
    this.redraw();
  }

  destroy() {
    try {
      this.activeTool = null;
      this.isDrawing = false;
      this.currentShape = null;
      if (this.visibleRangeHandler) {
        const timeScale = this.chart?.timeScale();
        if (timeScale?.unsubscribeVisibleLogicalRangeChange) {
          timeScale.unsubscribeVisibleLogicalRangeChange(this.visibleRangeHandler);
        }
        if (timeScale?.unsubscribeVisibleTimeRangeChange) {
          timeScale.unsubscribeVisibleTimeRangeChange(this.visibleRangeHandler);
        }
        if (typeof this.chart.unsubscribeSizeChanged === 'function') {
          this.chart.unsubscribeSizeChanged(this.resizeHandler);
        }
        if (typeof this.chart.unsubscribePriceScaleChange === 'function') {
          this.chart.unsubscribePriceScaleChange(this.priceScaleHandler);
        }
        this.visibleRangeHandler = null;
      }
      if (this.themeObserver) {
        this.themeObserver.disconnect();
        this.themeObserver = null;
      }
      if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
      }
      this.eventHandlers.forEach(({ element, event, handler, options }) => {
        try {
          if (element && typeof element.removeEventListener === 'function') {
            element.removeEventListener(event, handler, options);
          }
        } catch (err) {
          console.warn('[DrawingTools] Error removing event listener:', err);
        }
      });
      this.eventHandlers = [];
      if (this.toolButtons) {
        Object.keys(this.toolButtons).forEach(key => {
          this.toolButtons[key] = null;
        });
        this.toolButtons = null;
      }
      if (this.overlay) {
        while (this.overlay.firstChild) {
          this.overlay.removeChild(this.overlay.firstChild);
        }
        if (this.overlay.parentNode) {
          this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
      }
      if (this.toolbar) {
        if (this.toolbar.parentNode) {
          this.toolbar.parentNode.removeChild(this.toolbar);
        }
        this.toolbar = null;
      }
      this.drawings = [];
      this.chart = null;
      this.container = null;
      this.chartKey = null;
      this.candleSeries = null;
    } catch (error) {
      console.error('[DrawingTools] Error during destruction:', error);
    }
  }
}