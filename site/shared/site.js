// Skin-aware interactions: aurora backdrop, scroll-reveal, theme toggle.
// No tracking, no external calls. The aurora is injected only for skins that
// render it (editorial, command); CSS would hide it elsewhere anyway.
(function () {
  document.documentElement.classList.remove("no-js");
  var skin = document.documentElement.getAttribute("data-skin") || "editorial";

  // aurora backdrop — editorial + command skins only
  if (skin === "editorial" || skin === "command") {
    var a = document.createElement("div");
    a.className = "aurora";
    for (var i = 0; i < 3; i++) a.appendChild(document.createElement("span"));
    document.body.prepend(a);
  }

  // theme toggle
  var btn = document.createElement("button");
  btn.className = "theme-btn";
  btn.setAttribute("aria-label", "Toggle dark mode");
  btn.textContent = "◐";
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

  // scroll-reveal
  var targets = document.querySelectorAll("section, .aff-box, .takeaway, .card, .kpi");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08 }
    );
    targets.forEach(function (t) { io.observe(t); });
  } else {
    targets.forEach(function (t) { t.classList.add("in"); });
  }
})();
