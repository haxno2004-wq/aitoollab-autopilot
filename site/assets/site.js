// Theme toggle + small niceties. No tracking, no external calls.
(function () {
  try {
    var btn = document.createElement("button");
    btn.setAttribute("aria-label", "Toggle dark mode");
    btn.textContent = "◐";
    btn.style.cssText =
      "position:fixed;bottom:1rem;right:1rem;width:2.4rem;height:2.4rem;border-radius:50%;" +
      "border:1px solid var(--border);background:var(--card);color:var(--fg);cursor:pointer;font-size:1.1rem;";
    btn.addEventListener("click", function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      if (dark) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("theme", "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("theme", "dark");
      }
    });
    document.body.appendChild(btn);
  } catch (e) {}
})();
