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
});
