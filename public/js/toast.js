/**
 * Notificações tipo toast — window.showToast(texto, { type, duration })
 * type: 'success' | 'error' | 'danger' | 'info' | 'warning'
 */
(function () {
  var host = null;

  function ensureHost() {
    if (host) return host;
    host = document.getElementById("gp-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "gp-toast-host";
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    return host;
  }

  function iconLabel(type) {
    if (type === "success") return "\u2713";
    if (type === "error" || type === "danger") return "!";
    if (type === "warning") return "\u26A0";
    return "i";
  }

  window.showToast = function (message, opts) {
    if (!message) return;
    opts = opts || {};
    var type = opts.type || "info";
    if (type === "danger") type = "error";

    var duration =
      opts.duration != null
        ? opts.duration
        : type === "error"
          ? 6500
          : 4200;

    var h = ensureHost();
    var el = document.createElement("div");
    el.className = "gp-toast gp-toast--" + type;
    el.setAttribute("role", "status");

    var icon = document.createElement("span");
    icon.className = "gp-toast__icon";
    icon.textContent = iconLabel(type);
    icon.setAttribute("aria-hidden", "true");

    var body = document.createElement("div");
    body.className = "gp-toast__body";
    body.textContent = String(message);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "gp-toast__close";
    close.innerHTML = "&times;";
    close.setAttribute("aria-label", "Fechar");

    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(close);
    h.appendChild(el);

    var t = null;
    function remove() {
      if (t) clearTimeout(t);
      t = null;
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      el.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    }

    close.addEventListener("click", remove);
    t = setTimeout(remove, duration);
  };
})();
