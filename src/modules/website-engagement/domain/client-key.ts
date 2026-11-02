/**
 * The rate-limit key of a client address (audit H1).
 *
 * An IPv6 subscriber is routinely handed a whole /64, so keying the limiter on
 * the full address lets one host rotate through 2^64 buckets and never meet its
 * limit. IPv6 is therefore keyed on its /64 prefix; IPv4 (and an IPv4-mapped
 * IPv6 address) on the address itself. Pure; never throws.
 */
export function rateLimitClientKey(address: string): string {
  const raw = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);

  if (mapped) return mapped[1]!;

  if (!raw.includes(":")) return raw;

  // Drop a zone id and expand `::` so the first four groups are well defined.
  const bare = raw.split("%")[0]!;
  const halves = bare.split("::");

  if (halves.length > 2) return raw;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;

  if (halves.length === 1 ? head.length !== 8 : missing < 0) return raw;

  const groups =
    halves.length === 1
      ? head
      : [...head, ...Array.from({ length: missing }, () => "0"), ...tail];

  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return raw;

  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/64`;
}
