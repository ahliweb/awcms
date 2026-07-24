/**
 * Lightweight, dependency-free user-agent parsing and bot detection (ported
 * from awcms-micro epic #617-#624). Pure string parsing — no external
 * bot-intelligence provider, no fingerprinting beyond ordinary
 * browser/OS/device-type detection from the UA string itself.
 *
 * Deliberately does NOT pull in a UA-parsing library (`ua-parser-js` and
 * similar are large, frequently-updated-for-new-devices dependencies that
 * would need Bun-compatibility verification per AGENTS.md's Bun-only rule) —
 * a compact regex table covering the handful of browser/OS/bot families that
 * matter for aggregate analytics is enough; this is not a security or
 * billing decision point (see file header note below), so occasionally
 * missing an exotic UA and falling back to `"unknown"` is an acceptable
 * trade-off, not a defect.
 *
 * BINDING: human/bot classification here is for ANALYTICS ONLY. Never wire
 * `isBotUserAgent`/`parseUserAgent`'s output into an authorization,
 * rate-limit, or security decision — a spoofed UA trivially defeats it.
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export type ParsedUserAgent = {
  browserName: string | null;
  browserVersionMajor: string | null;
  osName: string | null;
  deviceType: DeviceType;
  isBot: boolean;
  botReason: string | null;
};

/**
 * Common crawler/bot/preview-fetcher signatures — search engines
 * (Googlebot, Bingbot, Slurp, DuckDuckBot, Baiduspider, YandexBot,
 * Applebot), social link-preview fetchers (facebookexternalhit, Twitterbot,
 * LinkedInBot, Slackbot, WhatsApp, TelegramBot, Discordbot), SEO/monitoring
 * crawlers (AhrefsBot, SemrushBot, MJ12bot, PetalBot, DotBot, UptimeRobot),
 * and generic script/automation clients (curl, wget, python-requests,
 * Go-http-client, PostmanRuntime, HeadlessChrome, PhantomJS, Selenium).
 * Matched case-insensitively against the raw UA string.
 */
const BOT_SIGNATURES: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /googlebot/i, name: "Googlebot" },
  { pattern: /bingbot/i, name: "Bingbot" },
  { pattern: /slurp/i, name: "Yahoo Slurp" },
  { pattern: /duckduckbot/i, name: "DuckDuckBot" },
  { pattern: /baiduspider/i, name: "Baiduspider" },
  { pattern: /yandexbot/i, name: "YandexBot" },
  { pattern: /applebot/i, name: "Applebot" },
  { pattern: /facebookexternalhit/i, name: "Facebook" },
  { pattern: /twitterbot/i, name: "Twitterbot" },
  { pattern: /linkedinbot/i, name: "LinkedInBot" },
  { pattern: /slackbot/i, name: "Slackbot" },
  { pattern: /whatsapp/i, name: "WhatsApp" },
  { pattern: /telegrambot/i, name: "TelegramBot" },
  { pattern: /discordbot/i, name: "Discordbot" },
  { pattern: /ahrefsbot/i, name: "AhrefsBot" },
  { pattern: /semrushbot/i, name: "SemrushBot" },
  { pattern: /mj12bot/i, name: "MJ12bot" },
  { pattern: /petalbot/i, name: "PetalBot" },
  { pattern: /dotbot/i, name: "DotBot" },
  { pattern: /uptimerobot/i, name: "UptimeRobot" },
  { pattern: /curl\//i, name: "curl" },
  { pattern: /wget\//i, name: "Wget" },
  { pattern: /python-requests/i, name: "python-requests" },
  { pattern: /go-http-client/i, name: "Go-http-client" },
  { pattern: /postmanruntime/i, name: "PostmanRuntime" },
  { pattern: /headlesschrome/i, name: "HeadlessChrome" },
  { pattern: /phantomjs/i, name: "PhantomJS" },
  { pattern: /selenium/i, name: "Selenium" },
  { pattern: /\bbot\b/i, name: "generic bot" },
  { pattern: /crawler/i, name: "generic crawler" },
  { pattern: /spider/i, name: "generic spider" }
];

export function isBotUserAgent(userAgent: string | null | undefined): {
  isBot: boolean;
  botReason: string | null;
} {
  if (!userAgent) {
    return { isBot: false, botReason: null };
  }

  const match = BOT_SIGNATURES.find(({ pattern }) => pattern.test(userAgent));

  return match
    ? { isBot: true, botReason: match.name }
    : { isBot: false, botReason: null };
}

const BROWSER_PATTERNS: readonly { pattern: RegExp; name: string }[] = [
  // Order matters — many browser UAs include multiple engine tokens
  // (Chrome/Safari/Edge all include "Safari"; Edge/Opera include "Chrome"),
  // so more specific tokens are checked first.
  { pattern: /edg\//i, name: "Edge" },
  { pattern: /opr\//i, name: "Opera" },
  { pattern: /samsungbrowser\//i, name: "Samsung Internet" },
  { pattern: /firefox\//i, name: "Firefox" },
  { pattern: /chrome\//i, name: "Chrome" },
  { pattern: /crios\//i, name: "Chrome" },
  { pattern: /fxios\//i, name: "Firefox" },
  { pattern: /version\/.*safari/i, name: "Safari" },
  { pattern: /safari\//i, name: "Safari" },
  { pattern: /msie |trident\//i, name: "Internet Explorer" }
];

const BROWSER_VERSION_PATTERNS: Record<string, RegExp> = {
  Edge: /edg\/(\d+)/i,
  Opera: /opr\/(\d+)/i,
  "Samsung Internet": /samsungbrowser\/(\d+)/i,
  Firefox: /(?:firefox|fxios)\/(\d+)/i,
  Chrome: /(?:chrome|crios)\/(\d+)/i,
  Safari: /version\/(\d+)/i,
  "Internet Explorer": /(?:msie |rv:)(\d+)/i
};

function detectBrowser(userAgent: string): {
  name: string | null;
  versionMajor: string | null;
} {
  const match = BROWSER_PATTERNS.find(({ pattern }) => pattern.test(userAgent));

  if (!match) {
    return { name: null, versionMajor: null };
  }

  const versionPattern = BROWSER_VERSION_PATTERNS[match.name];
  const versionMatch = versionPattern ? userAgent.match(versionPattern) : null;

  return { name: match.name, versionMajor: versionMatch?.[1] ?? null };
}

const OS_PATTERNS: readonly { pattern: RegExp; name: string }[] = [
  // iOS/Android/CrOS checked before Windows/macOS/Linux: iPhone/iPad UAs
  // always carry a "like Mac OS X" compatibility token, and Android/CrOS UAs
  // are built on a Linux kernel string — checking the more specific
  // mobile/OS tokens first avoids misclassifying them as macOS/Linux.
  { pattern: /iphone|ipad|ipod/i, name: "iOS" },
  { pattern: /android/i, name: "Android" },
  { pattern: /cros/i, name: "Chrome OS" },
  { pattern: /windows nt/i, name: "Windows" },
  { pattern: /mac os x/i, name: "macOS" },
  { pattern: /linux/i, name: "Linux" }
];

function detectOs(userAgent: string): string | null {
  return (
    OS_PATTERNS.find(({ pattern }) => pattern.test(userAgent))?.name ?? null
  );
}

function detectDeviceType(userAgent: string, isBot: boolean): DeviceType {
  if (isBot) return "bot";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  // Android tablets omit "Mobile" in their UA; Android phones include it.
  if (/android/i.test(userAgent) && !/mobile/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod/i.test(userAgent)) return "mobile";
  if (/android/i.test(userAgent)) return "mobile";
  if (/windows nt|mac os x|linux|cros/i.test(userAgent)) return "desktop";
  return "unknown";
}

/**
 * Never throws. Empty/missing UA and completely unrecognized UAs both
 * resolve to `deviceType: "unknown"` with null browser/OS fields —
 * "unknown" is deliberately never conflated with "human" or "bot"
 * (unknown/ambiguous user-agents must not be blindly trusted as human).
 */
export function parseUserAgent(
  userAgent: string | null | undefined
): ParsedUserAgent {
  const { isBot, botReason } = isBotUserAgent(userAgent);

  if (!userAgent) {
    return {
      browserName: null,
      browserVersionMajor: null,
      osName: null,
      deviceType: "unknown",
      isBot,
      botReason
    };
  }

  const { name: browserName, versionMajor: browserVersionMajor } =
    detectBrowser(userAgent);

  return {
    browserName,
    browserVersionMajor,
    osName: detectOs(userAgent),
    deviceType: detectDeviceType(userAgent, isBot),
    isBot,
    botReason
  };
}
