/**
 * Public news article share widget progressive enhancement (Issue #642,
 * epic `news_portal`). Loaded same-origin via `<script src="/js/news-share.js"
 * defer>` by `src/modules/blog-content/domain/social-share-links.ts`'s
 * `renderSocialShareButtonsHtml` — never inlined, so this file adds no
 * Content-Security-Policy hash/nonce bookkeeping (plain `'self'` script-src
 * already allows it, see `astro.config.mjs`).
 *
 * Deliberately vanilla, dependency-free, and does not fetch/import anything
 * from a third-party origin — the whole point of this file is to satisfy
 * the issue's "no third-party tracking JavaScript is loaded by default"
 * requirement while still implementing the two share actions that
 * structurally require client-side JS (native OS share sheet, clipboard
 * copy). Every other share platform (WhatsApp/Telegram/Facebook/LinkedIn/
 * X/email) is a plain server-rendered `<a href>` and needs no JS at all.
 */
(function () {
  "use strict";

  function showStatus(widget, message) {
    var status = widget.querySelector(".js-news-share-status");

    if (!status) {
      return;
    }

    status.textContent = message;
    status.hidden = false;
  }

  function findWidget(button) {
    return button.closest(".news-share");
  }

  /**
   * Native share button: stays `hidden` (server-rendered default) unless
   * `navigator.share` really exists in a secure context — issue: "Native
   * share uses `navigator.share` only after user activation and only in
   * secure context." The button is only ever revealed here (feature
   * detection); the actual `navigator.share(...)` call happens strictly
   * inside the `click` handler below, i.e. only as the direct result of a
   * real user activation, never on page load/automatically.
   */
  function enhanceNativeShareButtons() {
    if (!window.isSecureContext || typeof navigator.share !== "function") {
      return;
    }

    var buttons = document.querySelectorAll(".js-news-share-native");

    buttons.forEach(function (button) {
      button.hidden = false;

      button.addEventListener("click", function () {
        var shareData = {
          url: button.getAttribute("data-share-url") || "",
          title: button.getAttribute("data-share-title") || "",
          text: button.getAttribute("data-share-text") || ""
        };

        navigator.share(shareData).catch(function (error) {
          // AbortError = the visitor closed the native share sheet without
          // picking a target — not a real failure, no status message.
          if (error && error.name === "AbortError") {
            return;
          }

          var widget = findWidget(button);

          if (widget) {
            showStatus(widget, "Unable to share right now.");
          }
        });
      });
    });
  }

  function fallbackCopyToClipboard(url) {
    var textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    var succeeded = false;

    try {
      succeeded = document.execCommand("copy");
    } catch (error) {
      succeeded = false;
    }

    document.body.removeChild(textarea);
    return succeeded;
  }

  function enhanceCopyLinkButtons() {
    var buttons = document.querySelectorAll(".js-news-share-copy");

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var url = button.getAttribute("data-share-url") || "";
        var widget = findWidget(button);

        if (
          window.isSecureContext &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === "function"
        ) {
          navigator.clipboard
            .writeText(url)
            .then(function () {
              if (widget) {
                showStatus(widget, "Link copied.");
              }
            })
            .catch(function () {
              var succeeded = fallbackCopyToClipboard(url);

              if (widget) {
                showStatus(
                  widget,
                  succeeded ? "Link copied." : "Could not copy the link."
                );
              }
            });
          return;
        }

        var succeeded = fallbackCopyToClipboard(url);

        if (widget) {
          showStatus(
            widget,
            succeeded ? "Link copied." : "Could not copy the link."
          );
        }
      });
    });
  }

  enhanceNativeShareButtons();
  enhanceCopyLinkButtons();
})();
