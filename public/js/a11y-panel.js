/*
 * Reading preferences, panel (Issue #1369, ADR-0166). Deferred, same-origin.
 * Wires the server-rendered, initially hidden dialog; storage and attributes are
 * `window.awcmsA11y` (js/a11y-early.js). Without it the button stays hidden.
 * Non-modal: Esc and the close button return focus to the floating button; an
 * outside click closes without moving focus.
 */
(function (w, d) {
  "use strict";

  var api = w.awcmsA11y;
  var fab = d.getElementById("a11y-fab");
  var panel = d.getElementById("a11y-panel");
  if (!api || !fab || !panel) return;

  var heading = d.getElementById("a11y-title");
  var radios = panel.querySelectorAll('input[name="a11y-text"]');
  var switches = panel.querySelectorAll("input[data-a11y-switch]");
  var current = api.read();

  function show(p) {
    var i;
    for (i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === p.text;
    for (i = 0; i < switches.length; i++) {
      switches[i].checked = p[switches[i].getAttribute("data-a11y-switch")] === true;
    }
  }

  function collect() {
    var p = { v: 1, text: "normal" };
    var i;
    for (i = 0; i < radios.length; i++) if (radios[i].checked) p.text = radios[i].value;
    for (i = 0; i < switches.length; i++) {
      p[switches[i].getAttribute("data-a11y-switch")] = switches[i].checked;
    }
    return p;
  }

  function open() {
    show(current);
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    if (heading) heading.focus();
  }

  function close(returnFocus) {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    if (returnFocus) fab.focus();
  }

  fab.addEventListener("click", function () {
    if (panel.hidden) open();
    else close(true);
  });

  panel.addEventListener("change", function () {
    current = api.set(collect());
  });

  d.getElementById("a11y-reset").addEventListener("click", function () {
    current = api.reset();
    show(current);
  });

  d.getElementById("a11y-close").addEventListener("click", function () {
    close(true);
  });

  d.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) close(true);
  });

  d.addEventListener("click", function (event) {
    if (panel.hidden) return;
    if (panel.contains(event.target) || fab.contains(event.target)) return;
    close(false);
  });

  fab.hidden = false;
})(window, document);
