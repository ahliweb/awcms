const DEFAULT_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

type SecretKeySource = "map" | "wildcard" | "test" | "default" | "missing";

type SecretKeyResolution = {
  key: string | null;
  source: SecretKeySource;
  host: string | null;
};

const parseSecretKeyMap = (value?: string | null) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, string>;
  } catch (error) {
    console.warn("[Turnstile] Invalid TURNSTILE_SECRET_KEY_MAP JSON", error);
    return null;
  }
};

const resolveHost = (req: Request) => {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const candidate = origin || referer;
  if (!candidate) return null;
  try {
    return new URL(candidate).hostname;
  } catch {
    return null;
  }
};

const resolveSecretKey = (req: Request): SecretKeyResolution => {
  const host = resolveHost(req);
  const secretKeyMap = parseSecretKeyMap(
    Deno.env.get("TURNSTILE_SECRET_KEY_MAP"),
  );

  if (host && secretKeyMap?.[host]) {
    return { key: secretKeyMap[host], source: "map", host };
  }

  if (host && secretKeyMap) {
    const wildcardEntry = Object.entries(secretKeyMap).find(
      ([pattern, value]) => {
        if (!value || typeof pattern !== "string") return false;
        if (!pattern.startsWith("*.") || pattern.length < 3) return false;
        const suffix = pattern.slice(1);
        return host.endsWith(suffix);
      },
    );

    if (wildcardEntry?.[1]) {
      return { key: wildcardEntry[1], source: "wildcard", host };
    }
  }

  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (isLocalhost) {
    return {
      key: Deno.env.get("TURNSTILE_TEST_SECRET_KEY") || DEFAULT_TEST_SECRET_KEY,
      source: "test",
      host,
    };
  }

  const defaultKey = Deno.env.get("TURNSTILE_SECRET_KEY") || null;
  return {
    key: defaultKey,
    source: defaultKey ? "default" : "missing",
    host,
  };
};

export { resolveSecretKey, resolveHost };
