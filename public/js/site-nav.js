/**
 * Menu fixo com painel expansível (mobile).
 * [data-nav-toggle], [data-nav-panel], opcional #gp-nav-backdrop
 * Painéis com [data-nav-animate-height] ajustam max-height ao abrir/fechar.
 */
(function () {
  function syncPanelHeight(panel) {
    if (!panel || !panel.hasAttribute("data-nav-animate-height")) return;
    if (panel.classList.contains("is-open")) {
      var h = panel.scrollHeight + 16;
      var cap = Math.floor(window.innerHeight * 0.78);
      panel.style.maxHeight = Math.min(h, cap) + "px";
    } else {
      panel.style.maxHeight = "0";
    }
  }

  function init() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var panel = document.querySelector("[data-nav-panel]");
    if (!toggle || !panel) return;

    var backdrop = document.getElementById("gp-nav-backdrop");
    var openClass = "is-open";

    function setOpen(open) {
      panel.classList.toggle(openClass, open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("gp-nav-open", open);
      if (backdrop) backdrop.classList.toggle("is-visible", open);
      syncPanelHeight(panel);
    }

    function close() {
      setOpen(false);
    }

    if (panel.hasAttribute("data-nav-animate-height")) {
      panel.style.overflow = "hidden";
      if (panel.classList.contains(openClass)) {
        syncPanelHeight(panel);
      } else {
        panel.style.maxHeight = "0";
      }
    }

    toggle.addEventListener("click", function () {
      setOpen(!panel.classList.contains(openClass));
    });

    panel.querySelectorAll("a[href]").forEach(function (a) {
      a.addEventListener("click", function () {
        close();
      });
    });

    if (backdrop) {
      backdrop.addEventListener("click", close);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    window.addEventListener(
      "resize",
      function () {
        if (window.matchMedia("(min-width: 768px)").matches) {
          close();
        } else {
          syncPanelHeight(panel);
        }
      },
      { passive: true }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
