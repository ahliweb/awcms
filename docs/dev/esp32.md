> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# ESP32 Firmware Development

## Purpose

Describe the current ESP32 firmware development model for `awcms-esp32/primary`: toolchain, device configuration patterns, current Worker-backed compatibility expectations, and current cautions around documented device routes.

## Current ESP32 Model

The ESP32 integration currently combines:

- PlatformIO-based firmware development
- WiFi-connected device polling/configuration behavior
- per-device token-based auth patterns
- compatibility HTTP endpoint examples for device config/update flows

Current important rule:

- the docs should not imply a maintained Worker route exists for every illustrative device example if the checked-in Worker runtime does not currently expose that exact endpoint

## Current Toolchain

- PlatformIO / PlatformIO Core
- Arduino / ESP-IDF compatible firmware stack
- `platformio.ini`
- gitignored `include/secrets.h`

## Current Project Shape

Representative workspace layout:

- `awcms-esp32/primary/include/`
- `awcms-esp32/primary/src/`
- `awcms-esp32/primary/lib/`
- `awcms-esp32/primary/platformio.ini`

## Current Device Configuration Pattern

Current firmware guidance still centers on:

1. boot device
2. connect to WiFi
3. load last-known persisted config
4. fetch current config from a configured endpoint
5. apply the received configuration
6. persist safe local state for offline recovery

## Current Runtime Boundary Note

The example Worker-backed config endpoint pattern remains illustrative unless the live Worker runtime exposes the route being referenced.

Current important rule:

- verify the current `awcms-edge/src/index.ts` surface before documenting or shipping a device firmware endpoint as a maintained contract

## Current Security Rules

- never ship `SUPABASE_SECRET_KEY` in firmware
- keep per-device tokens/device auth separate from server-side secrets
- keep `secrets.h` gitignored
- treat OTA/config endpoints as privileged operational surfaces

## Current Offline / Recovery Guidance

- keep last-known config persisted for offline boot
- handle config-fetch failure gracefully
- do not assume constant network availability

## Current Validation Guidance

| Surface | Validation |
| --- | --- |
| firmware workspace changes | `cd awcms-esp32/primary && pio run -e dev` |
| device flash/dev verification | `cd awcms-esp32/primary && pio run -e dev -t upload` and `pio device monitor` when hardware is available |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/runtime implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |

## Related Docs

- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/dev/edge-functions.md](./edge-functions.md)
- [docs/dev/api-usage.md](./api-usage.md)
