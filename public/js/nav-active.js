/**
 * Marca links com data-gp-nav conforme a página atual.
 * Valores: home | login | cadastro | gym | pay
 */
(function () {
  function pageKey() {
    var path = (location.pathname || "").toLowerCase();
    var parts = path.split("/");
    var file = parts.pop() || "";
    if (!file || file === "") return "home";
    if (file === "index.html") return "home";
    if (file === "login.html") return "login";
    if (file === "cadastro.html") return "cadastro";
    if (file === "gymparceiras.html") return "gym";
    if (file === "mypay.html") return "pay";
    return "";
  }

  function apply() {
    var k = pageKey();
    if (!k) return;
    document.querySelectorAll("[data-gp-nav]").forEach(function (el) {
      if (el.getAttribute("data-gp-nav") === k) {
        el.classList.add("is-active");
        if (el.getAttribute("aria-current") == null) {
          el.setAttribute("aria-current", "page");
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
