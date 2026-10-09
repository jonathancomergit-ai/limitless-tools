/* ============================================================
   Limitless Lab - visitor stats (GoatCounter)

   Page views only. No events, no clicks, nothing else.

   Loaded the same way as on jonjoe1001.dev: one plain
   <script src=".../kit/stats.js" defer> near the end of every
   page, which adds GoatCounter's count.js. count.js counts the
   page view by itself once it loads.

   Privacy: GoatCounter sets no cookies and stores no IP
   addresses, so there's no cookie banner. Ad blockers block it,
   so every number is a floor, not the exact count.

   Nothing loads on localhost, 127.0.0.1, a .local address or
   a double-clicked file, so testing and local
   development never count (and never call out to the internet).

   The Content-Security-Policy on every page allows exactly
   these two GoatCounter addresses and nothing else.
   ============================================================ */

(function () {
  "use strict";

  /* The site code. Dashboard: https://jonjoe1001.goatcounter.com */
  var CODE = "jonjoe1001";

  var host = location.hostname;
  var local = location.protocol === "file:" ||
              host === "" ||
              host === "localhost" ||
              host === "[::1]" ||
              /^127\./.test(host) ||
              /\.(local|localhost)$/.test(host);
  if (local) { return; }

  var tag = document.createElement("script");
  tag.async = true;
  tag.src = "https://gc.zgo.at/count.js";
  tag.setAttribute("data-goatcounter", "https://" + CODE + ".goatcounter.com/count");
  document.head.appendChild(tag);
})();
