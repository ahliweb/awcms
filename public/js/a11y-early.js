/*
 * Reading preferences, early-apply (Issue #1369, ADR-0166). A classic BLOCKING
 * script in <head>: a saved preference must be on <html> before first paint.
 * It is the one owner of the storage contract (key `awcms-a11y`, JSON
 * {"v":1,"text":"normal|large|x-large", contrast|mono|dyslexia|underline|
 * highlight|motion: bool}; `motion:true` = reduce). Unreadable storage or any
 * invalid value means "nothing stored": OS defaults apply. The panel script only
 * calls `window.awcmsA11y`. `data-a11y-ready` tells the CSS this script ran.
 */
(function (w, d) {
  "use strict";

  var KEY = "awcms-a11y";
  var BOOLS = [
    "contrast",
    "mono",
    "dyslexia",
    "underline",
    "highlight",
    "motion"
  ];
  var root = d.documentElement;

  function os(query) {
    try {
      return w.matchMedia(query).matches === true;
    } catch (e) {
      return false;
    }
  }

  function defaults() {
    return {
      v: 1,
      text: "normal",
      contrast: os("(prefers-contrast: more)"),
      mono: false,
      dyslexia: false,
      underline: false,
      highlight: false,
      motion: os("(prefers-reduced-motion: reduce)")
    };
  }

  /** A full, valid preferences object, or null. */
  function parse(raw) {
    var o;
    try {
      o = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!o || typeof o !== "object" || o.v !== 1) return null;
    if (o.text !== "normal" && o.text !== "large" && o.text !== "x-large") {
      return null;
    }
    var p = { v: 1, text: o.text };
    for (var i = 0; i < BOOLS.length; i++) {
      if (typeof o[BOOLS[i]] !== "boolean") return null;
      p[BOOLS[i]] = o[BOOLS[i]];
    }
    return p;
  }

  function read() {
    var stored = null;
    try {
      stored = parse(w.localStorage.getItem(KEY));
    } catch (e) {
      stored = null;
    }
    return stored || defaults();
  }

  function flag(name, on, value) {
    if (on) root.setAttribute(name, value || "");
    else root.removeAttribute(name);
  }

  function apply(p) {
    flag("data-a11y-text", p.text !== "normal", p.text);
    flag("data-a11y-contrast", p.contrast);
    flag("data-a11y-mono", p.mono);
    flag("data-a11y-dyslexia", p.dyslexia);
    flag("data-a11y-underline", p.underline);
    flag("data-a11y-highlight", p.highlight);
    flag("data-a11y-motion", p.motion, "reduce");
    root.setAttribute("data-a11y-ready", "");
  }

  function announce(p) {
    try {
      d.dispatchEvent(new w.CustomEvent("awcms-a11y-change", { detail: p }));
    } catch (e) {
      /* a listener must never break the page */
    }
  }

  function set(next) {
    var p = parse(JSON.stringify(next)) || defaults();
    try {
      w.localStorage.setItem(KEY, JSON.stringify(p));
    } catch (e) {
      /* blocked or full: still applies to this page */
    }
    apply(p);
    announce(p);
    return p;
  }

  function reset() {
    try {
      w.localStorage.removeItem(KEY);
    } catch (e) {
      /* nothing to remove */
    }
    var p = defaults();
    apply(p);
    announce(p);
    return p;
  }

  apply(read());

  w.awcmsA11y = {
    key: KEY,
    parse: parse,
    defaults: defaults,
    read: read,
    apply: apply,
    set: set,
    reset: reset
  };
})(window, document);
