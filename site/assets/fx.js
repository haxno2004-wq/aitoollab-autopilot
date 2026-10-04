// Shared currency engine — used by every platform's site and the dashboard.
// Live reference rates from the ECB (eurofxref-daily.xml, CORS-enabled). Falls
// back to static approximate rates if the network fails. USD is the base
// currency for all stored amounts/prices; display converts on the fly.
(function () {
  "use strict";

  var STATIC = {
    USD: 1, EUR: 0.92, GBP: 0.79, INR: 83.2, JPY: 149.5, CAD: 1.36,
    AUD: 1.52, CHF: 0.88, CNY: 7.24, SGD: 1.34, AED: 3.67, BRL: 4.97,
  };
  var SYMBOLS = {
    USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", CAD: "C$",
    AUD: "A$", CHF: "CHF ", CNY: "¥", SGD: "S$", AED: "د.إ ", BRL: "R$",
  };
  var ZERO_DEC = { JPY: true };
  var CODES = Object.keys(STATIC);

  var state = { rates: Object.assign({}, STATIC), live: false, code: "USD" };

  function loadPref() {
    try {
      var saved = localStorage.getItem("fx-currency");
      if (saved && STATIC[saved]) state.code = saved;
      else {
        var locale = (navigator.language || "en-US").toUpperCase();
        for (var i = 0; i < CODES.length; i++) {
          if (locale.indexOf(CODES[i]) !== -1) { state.code = CODES[i]; break; }
        }
      }
    } catch (e) {}
  }

  function persist() {
    try { localStorage.setItem("fx-currency", state.code); } catch (e) {}
  }

  function fetchLive() {
    fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { signal: AbortSignal.timeout(8000) })
      .then(function (r) { return r.text(); })
      .then(function (xml) {
        var rates = { EUR: 1 };
        var re = /currency='([A-Z]{3})'\s+rate='([\d.]+)'/g, m;
        while ((m = re.exec(xml))) rates[m[1]] = parseFloat(m[2]);
        if (rates.USD) {
          // normalize to USD base
          var usdPerEur = 1 / rates.EUR;
          var out = { USD: 1 };
          for (var c in rates) if (c !== "EUR") out[c] = rates[c] * usdPerEur;
          state.rates = Object.assign(state.rates, out);
          state.live = true;
          rerenderAll();
          updateStrip();
        }
      })
      .catch(function () {});
  }

  function convert(usdAmount) {
    var n = parseFloat(usdAmount) || 0;
    return n * (state.rates[state.code] || 1);
  }

  function format(usdAmount) {
    var v = convert(usdAmount);
    var sym = SYMBOLS[state.code] || state.code + " ";
    var dec = ZERO_DEC[state.code] ? 0 : 2;
    return sym + v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  // re-render every element that carries a USD price
  function rerenderAll() {
    document.querySelectorAll("[data-usd]").forEach(function (el) {
      el.textContent = format(el.getAttribute("data-usd"));
    });
  }

  function updateStrip() {
    var el = document.getElementById("fx-strip");
    if (!el) return;
    var bits = [];
    ["EUR", "GBP", "INR", "JPY"].forEach(function (c) {
      if (state.rates[c]) bits.push(c + " " + state.rates[c].toFixed(2));
    });
    el.textContent = "1 USD = " + bits.join(" · ") + (state.live ? "" : " (offline rates)");
  }

  function buildSelector() {
    var host = document.querySelector(".currency-widget");
    if (!host) return;
    var sel = document.getElementById("currency-select");
    if (!sel) {
      sel = document.createElement("select");
      sel.id = "currency-select";
      sel.className = "currency-select";
      sel.setAttribute("aria-label", "Currency");
      host.appendChild(sel);
    }
    sel.innerHTML = "";
    CODES.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c;
      o.textContent = (SYMBOLS[c] || "") + " " + c;
      sel.appendChild(o);
    });
    sel.value = state.code;
    sel.addEventListener("change", function () {
      state.code = sel.value;
      persist();
      rerenderAll();
      updateStrip();
    });
    var sym = host.querySelector(".currency-symbol");
    if (sym) sym.textContent = SYMBOLS[state.code] || "$";
    sel.addEventListener("change", function () {
      if (sym) sym.textContent = SYMBOLS[state.code] || "$";
    });
  }

  loadPref();
  document.addEventListener("DOMContentLoaded", function () {
    buildSelector();
    rerenderAll();
    updateStrip();
    fetchLive();
  });

  window.FX = { convert: convert, format: format, state: state };
})();
