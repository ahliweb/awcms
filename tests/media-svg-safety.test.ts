import { describe, expect, test } from "bun:test";

import {
  findSvgSafetyViolations,
  isSvgContentSafe
} from "../src/modules/media-library/domain/media-svg-safety";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const SAFE_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<circle cx="32" cy="32" r="30" fill="#c00" />' +
  '<text x="32" y="36" text-anchor="middle" fill="#fff">DPRD</text>' +
  "</svg>";

describe("findSvgSafetyViolations / isSvgContentSafe (Issue #806)", () => {
  test("a plain logo-shaped SVG (no script, no handlers, no external refs) has no violations and is safe", () => {
    const bytes = encode(SAFE_LOGO_SVG);
    expect(findSvgSafetyViolations(bytes)).toEqual([]);
    expect(isSvgContentSafe(bytes)).toBe(true);
  });

  test("rejects a <script> element", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toEqual(["script_element"]);
    expect(isSvgContentSafe(bytes)).toBe(false);
  });

  test("rejects a self-closing/typed <script/> variant, case-insensitively", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT type="text/javascript">evil()</SCRIPT></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toContain("script_element");
  });

  test("rejects an on*= event-handler attribute (onload)", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="1"/></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toEqual(["event_handler_attribute"]);
  });

  test("rejects an on*= event-handler attribute on a nested element (onclick)", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="steal()" width="1" height="1"/></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toContain("event_handler_attribute");
  });

  test("rejects a javascript: URI in href", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toEqual(["javascript_uri"]);
  });

  test("rejects a javascript: URI in xlink:href", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<use xlink:href="javascript:alert(1)" /></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toContain("javascript_uri");
  });

  test("rejects an external SYSTEM entity (classic XXE)", () => {
    const bytes = encode(
      '<?xml version="1.0"?>' +
        '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
        '<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toContain("external_entity");
  });

  test("rejects an external PUBLIC entity reference", () => {
    const bytes = encode(
      '<!DOCTYPE svg PUBLIC "-//evil//EVIL//EN" "https://evil.example/evil.dtd">' +
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toContain("external_entity");
  });

  test("a DOCTYPE naming the standard W3C SVG DTD (PUBLIC, but not attacker-controlled) is still flagged — this is a denylist on the keyword, not a trust decision about the specific URL", () => {
    const bytes = encode(
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toContain("external_entity");
  });

  test("reports every violation present, not just the first", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()">' +
        "<script>y()</script>" +
        '<a href="javascript:z()"><rect width="1" height="1"/></a>' +
        "</svg>"
    );
    const violations = findSvgSafetyViolations(bytes);
    expect(violations).toContain("script_element");
    expect(violations).toContain("event_handler_attribute");
    expect(violations).toContain("javascript_uri");
    expect(isSvgContentSafe(bytes)).toBe(false);
  });

  test("does not false-positive on an ordinary attribute that merely contains the letters 'on' (e.g. a data-* custom attribute)", () => {
    const bytes = encode(
      '<svg xmlns="http://www.w3.org/2000/svg" data-iconography="logo"><rect width="1" height="1"/></svg>'
    );
    expect(findSvgSafetyViolations(bytes)).toEqual([]);
  });

  describe("closure #1 — data: URI in href/xlink:href/src (PR #807 review)", () => {
    test("rejects a data: URI in xlink:href carrying a base64-encoded nested SVG with its own onload", () => {
      const nestedSvg = '<svg onload="alert(1)"/>';
      const base64 = Buffer.from(nestedSvg, "utf-8").toString("base64");
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
          `<use xlink:href="data:image/svg+xml;base64,${base64}" /></svg>`
      );
      expect(findSvgSafetyViolations(bytes)).toContain("data_uri");
    });

    test("rejects a data: URI in <image href> carrying a percent-encoded nested SVG with its own onload", () => {
      const nestedSvg = '<svg onload="alert(1)"/>';
      const percentEncoded = encodeURIComponent(nestedSvg);
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg">' +
          `<image href="data:image/svg+xml,${percentEncoded}" /></svg>`
      );
      expect(findSvgSafetyViolations(bytes)).toContain("data_uri");
    });

    test("rejects a data: URI in a plain src attribute", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><image src="data:image/svg+xml;base64,AAAA" /></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toContain("data_uri");
    });

    test("does not false-positive on an ordinary non-data href (baseline)", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.test/about"><rect width="1" height="1"/></a></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toEqual([]);
    });
  });

  describe("closure #2 — character-reference / control-character obfuscation of javascript:/data: (PR #807 review)", () => {
    test("rejects a decimal-character-reference-obfuscated javascript: URI", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript&#58;alert(1)"><rect width="1" height="1"/></a></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toContain("javascript_uri");
    });

    test("rejects a hex-character-reference-obfuscated javascript: URI", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#x6a;avascript&#x3a;alert(1)"><rect width="1" height="1"/></a></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toContain("javascript_uri");
    });

    test("rejects a TAB character-reference spliced into the middle of the javascript scheme itself (URL parsers strip TAB/LF/CR before reading the scheme)", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x09;ascript:alert(1)"><rect width="1" height="1"/></a></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toContain("javascript_uri");
    });

    test("rejects a literal raw TAB byte spliced into the javascript scheme, with no entity involved", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav\tascript:alert(1)"><rect width="1" height="1"/></a></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toContain("javascript_uri");
    });

    test("rejects a decimal-character-reference-obfuscated data: URI", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><image src="&#100;ata:image/svg+xml;base64,AAAA" /></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toContain("data_uri");
    });

    test("does not decode-and-falsely-trip on inert escaped text like &lt;script&gt; — character references are never expanded into markup structure by a real XML parser", () => {
      const bytes = encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>&lt;script&gt;not a real element&lt;/script&gt;</text></svg>'
      );
      expect(findSvgSafetyViolations(bytes)).toEqual([]);
    });

    test("a large number of numeric character references decodes and scans promptly (linear-time guard, no ReDoS)", () => {
      const many = "&#106;".repeat(50_000);
      const bytes = encode(
        `<svg xmlns="http://www.w3.org/2000/svg"><a href="${many}"><rect width="1" height="1"/></a></svg>`
      );
      const start = performance.now();
      findSvgSafetyViolations(bytes);
      const elapsedMs = performance.now() - start;
      expect(elapsedMs).toBeLessThan(500);
    });
  });

  describe("closure #3 — parameter-entity splitting of SYSTEM/PUBLIC (PR #807 review)", () => {
    test("rejects a SYSTEM keyword split across two parameter-entity declarations, via entity_declaration — the keyword-anchored pattern alone misses it", () => {
      const bytes = encode(
        '<?xml version="1.0"?>' +
          "<!DOCTYPE svg [" +
          '<!ENTITY % p1 "SYST">' +
          '<!ENTITY % p2 "EM \\"file:///etc/passwd\\"">' +
          "]>" +
          '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
      );
      const violations = findSvgSafetyViolations(bytes);
      expect(violations).toContain("entity_declaration");
      // Demonstrates the bypass this closure exists for: no single
      // declaration contains the literal keyword, so the SYSTEM/PUBLIC-
      // anchored pattern alone does not fire.
      expect(violations).not.toContain("external_entity");
    });

    test("rejects a plain general <!ENTITY declaration with no SYSTEM/PUBLIC keyword at all", () => {
      const bytes = encode(
        "<!DOCTYPE svg [" +
          '<!ENTITY logo "a benign local entity">' +
          "]>" +
          '<svg xmlns="http://www.w3.org/2000/svg">&logo;</svg>'
      );
      const violations = findSvgSafetyViolations(bytes);
      expect(violations).toContain("entity_declaration");
      expect(violations).not.toContain("external_entity");
    });

    test("still reports external_entity too when SYSTEM/PUBLIC does appear inside one whole declaration (both fire together, not exclusively)", () => {
      const bytes = encode(
        '<?xml version="1.0"?>' +
          '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
          '<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>'
      );
      const violations = findSvgSafetyViolations(bytes);
      expect(violations).toContain("entity_declaration");
      expect(violations).toContain("external_entity");
    });
  });
});
