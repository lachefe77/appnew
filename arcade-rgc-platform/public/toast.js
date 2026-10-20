/**
 * ARENA ARCADE — Toast Notification System
 * Substitui todos os alert() por toasts animados.
 * window.toast.success / error / info / warn
 */

class ToastManager {
  constructor() {
    this._container = null;
    this._init();
  }

  _init() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => this._init());
      return;
    }
    const style = document.createElement("style");
    style.textContent = `
      #toast-container {
        position: fixed; bottom: 24px; right: 24px;
        display: flex; flex-direction: column-reverse; gap: 10px;
        z-index: 9999; pointer-events: none;
      }
      .toast {
        display: flex; align-items: flex-start; gap: 10px;
        background: #161c2b; border: 1px solid #242e42;
        border-radius: 8px; padding: 12px 16px;
        min-width: 280px; max-width: 400px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        font-family: 'Chakra Petch', sans-serif; font-size: 0.85rem;
        color: #f0f4fa; pointer-events: all;
        animation: toastIn 0.25s ease;
        cursor: pointer;
      }
      .toast.leaving { animation: toastOut 0.25s ease forwards; }
      .toast-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
      .toast-body { flex: 1; }
      .toast-title { font-weight: 700; margin-bottom: 2px; }
      .toast-msg { color: #8494ab; font-size: 0.8rem; line-height: 1.4; }
      .toast.success { border-left: 3px solid #00ff88; }
      .toast.error   { border-left: 3px solid #ff0055; }
      .toast.info    { border-left: 3px solid #00e5ff; }
      .toast.warn    { border-left: 3px solid #ffcc00; }
      .toast-progress {
        position: absolute; bottom: 0; left: 0; height: 2px;
        border-radius: 0 0 8px 8px;
        animation: toastProgress linear forwards;
      }
      .toast { position: relative; overflow: hidden; }
      .toast.success .toast-progress { background: #00ff88; }
      .toast.error   .toast-progress { background: #ff0055; }
      .toast.info    .toast-progress { background: #00e5ff; }
      .toast.warn    .toast-progress { background: #ffcc00; }
      @keyframes toastIn  { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes toastOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } }
      @keyframes toastProgress { from { width: 100%; } to { width: 0%; } }
    `;
    document.head.appendChild(style);

    this._container = document.createElement("div");
    this._container.id = "toast-container";
    document.body.appendChild(this._container);
  }

  _show(type, title, message, duration = 4000) {
    const icons = { success: "✅", error: "❌", info: "ℹ️", warn: "⚠️" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = icons[type] || "ℹ️";
    const body = document.createElement("div");
    body.className = "toast-body";
    const heading = document.createElement("div");
    heading.className = "toast-title";
    heading.textContent = title;
    body.append(heading);
    if (message) {
      const msg = document.createElement("div");
      msg.className = "toast-msg";
      msg.textContent = message;
      body.append(msg);
    }
    const progress = document.createElement("div");
    progress.className = "toast-progress";
    progress.style.animationDuration =
      Math.max(1000, Math.min(30000, duration)) + "ms";
    el.append(icon, body, progress);
    el.onclick = () => this._remove(el);
    this._container.appendChild(el);

    setTimeout(() => this._remove(el), duration);
    return el;
  }

  _remove(el) {
    if (!el.parentNode) return;
    el.classList.add("leaving");
    setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 250);
  }

  success(title, msg, duration) {
    return this._show("success", title, msg, duration);
  }
  error(title, msg, duration) {
    return this._show("error", title, msg, duration);
  }
  info(title, msg, duration) {
    return this._show("info", title, msg, duration);
  }
  warn(title, msg, duration) {
    return this._show("warn", title, msg, duration);
  }
}

window.toast = new ToastManager();
