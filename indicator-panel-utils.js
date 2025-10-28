// indicator-panel-utils.js

/**
 * Utility class for managing indicator panels (show/hide, transitions, cleanup).
 */
export class IndicatorPanelManager {
  constructor(panelSelectorOrElement, card) {
    this.panel =
      typeof panelSelectorOrElement === "string"
        ? card?.querySelector(panelSelectorOrElement)
        : panelSelectorOrElement;
    this.card = card;
    this._isActive = false;
    this._transitionHandler = null;
  }

  show() {
    if (!this.panel) return;
    this.panel.style.display = "flex";
    requestAnimationFrame(() => {
      this.panel.classList.add("active");
      this._isActive = true;
    });
  }

  hide() {
    if (!this.panel) return;
    this.panel.classList.remove("active");
    const handler = (ev) => {
      if (ev.propertyName === "max-height" || ev.propertyName === "opacity") {
        this.panel.style.display = "none";
        this.panel.removeEventListener("transitionend", handler);
        this._isActive = false;
      }
    };
    this.panel.addEventListener("transitionend", handler);
    setTimeout(() => {
      if (
        this.panel.style.display !== "none" &&
        !this.panel.classList.contains("active")
      ) {
        this.panel.style.display = "none";
        this._isActive = false;
      }
    }, 400);
    this._transitionHandler = handler;
  }

  isActive() {
    return this._isActive;
  }

  cleanup() {
    if (this.panel && this._transitionHandler) {
      this.panel.removeEventListener("transitionend", this._transitionHandler);
      this._transitionHandler = null;
    }
    if (this.panel) {
      this.panel.style.display = "none";
      this.panel.classList.remove("active");
    }
    this._isActive = false;
  }
}