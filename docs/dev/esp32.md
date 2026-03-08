> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# ESP32 Firmware Development

## 1. Overview

AWCMS manages ESP32 devices remotely via Cloudflare Workers, existing Supabase functions where still required, and REST APIs. The firmware:

- Connects to WiFi.
- Polls or subscribes to AWCMS configuration endpoints to receive pushed settings.
- Reports telemetry back through scoped REST endpoints.
- **Never ships secrets**; it authenticates using a per-device publishable key.

---

## 2. Toolchain

| Tool | Purpose |
|------|---------|
| **PlatformIO** (VS Code) | Build system, env management, OTA |
| **Arduino / ESP-IDF** | Framework |
| `platformio.ini` | Environment configuration (`dev` / `prod`) |
| `include/secrets.h` | Gitignored; holds WiFi SSID, device token |

---

## 3. Project Structure

```text
awcms-esp32/primary/
├── include/
│   ├── config.h           # Endpoint URLs and polling intervals
│   └── secrets.h          # WiFi + device token (gitignored!)
├── src/
│   └── main.cpp           # Entry point
├── lib/
│   └── ConfigManager/     # Fetches + applies AWCMS config
└── platformio.ini
```

---

## 4. Receiving & Applying Configuration Changes (Benchmark-Ready)

### Objective

Deliver device configuration updates securely via a Supabase Edge Function, apply settings locally, and persist a safe last-known configuration for offline boot.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `device_token` | Device provisioning | Yes | Publishable per-device token |
| `device-config` URL | Admin config | Yes | Supabase Functions URL |
| `polling_interval_sec` | Config payload | Yes | Device checks interval |
| Config schema | Server response | Yes | JSON payload with known keys |

### Workflow

1. Device boots, connects to WiFi, and loads last-known config from `Preferences`.
2. Device polls `/functions/v1/device-config` with `Authorization: Bearer <device_token>`.
3. Edge Function validates token, resolves tenant/device, and returns scoped config.
4. Firmware applies config and persists it for offline recovery.
5. When `firmware_version` increases, device triggers OTA update.

### Reference Implementation

AWCMS pushes configuration to devices via a Supabase Edge Function endpoint (`/functions/v1/device-config`). The firmware's `ConfigManager` polls this endpoint on a configurable interval and applies any changes immediately.

### 4.1 `ConfigManager.h`

```cpp
#pragma once
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>

class ConfigManager {
public:
    struct DeviceConfig {
        int     pollingIntervalSec;
        bool    ledEnabled;
        int     brightnessLevel;
        String  firmwareVersion;
    };

    ConfigManager(const char* endpoint, const char* deviceToken) 
        : _endpoint(endpoint), _token(deviceToken) {}

    bool fetchAndApply(DeviceConfig& out) {
        HTTPClient http;
        http.begin(_endpoint);
        http.addHeader("Authorization", String("Bearer ") + _token);
        http.addHeader("Content-Type", "application/json");

        int httpCode = http.GET();
        if (httpCode != 200) {
            Serial.printf("[Config] HTTP error: %d\n", httpCode);
            return false;
        }

        String body = http.getString();
        http.end();

        StaticJsonDocument<512> doc;
        DeserializationError err = deserializeJson(doc, body);
        if (err) {
            Serial.printf("[Config] JSON parse error: %s\n", err.c_str());
            return false;
        }

        // Apply received config; persist with Preferences for offline boot
        out.pollingIntervalSec = doc["polling_interval_sec"] | 60;
        out.ledEnabled         = doc["led_enabled"] | true;
        out.brightnessLevel    = doc["brightness_level"] | 50;
        out.firmwareVersion    = doc["firmware_version"].as<String>();

        _persist(out);
        return true;
    }

private:
    const char* _endpoint;
    const char* _token;
    Preferences _prefs;

    void _persist(const DeviceConfig& cfg) {
        _prefs.begin("awcms_cfg", false);
        _prefs.putInt("poll_int", cfg.pollingIntervalSec);
        _prefs.putBool("led_en", cfg.ledEnabled);
        _prefs.putInt("brightness", cfg.brightnessLevel);
        _prefs.end();
    }
};
```

### 4.2 `main.cpp` — Main Loop

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"     // WIFI_SSID, WIFI_PASS, DEVICE_TOKEN
#include "config.h"      // CONFIG_ENDPOINT
#include "ConfigManager.h"

ConfigManager configMgr(CONFIG_ENDPOINT, DEVICE_TOKEN);
ConfigManager::DeviceConfig activeConfig;

void connectWifi() {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("[WiFi] Connecting");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.printf("\n[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
    Serial.begin(115200);
    connectWifi();

    // Boot with last known config from persistent storage
    activeConfig.pollingIntervalSec = 60;

    // Fetch current config from AWCMS on boot
    configMgr.fetchAndApply(activeConfig);
}

void loop() {
    // Re-fetch config on every polling interval
    static unsigned long lastFetch = 0;
    unsigned long now = millis();

    if (now - lastFetch >= (unsigned long)activeConfig.pollingIntervalSec * 1000) {
        lastFetch = now;
        if (!configMgr.fetchAndApply(activeConfig)) {
            Serial.println("[Config] Fetch failed; using last-known config.");
        }
    }

    // Apply config to hardware
    digitalWrite(LED_BUILTIN, activeConfig.ledEnabled ? HIGH : LOW);

    delay(1000);
}
```

### 4.3 `config.h`

```cpp
#pragma once

// Supabase Edge Function URL for device configuration
// Replace {FUNCTION_BASE_URL} with your project's functions URL
#define CONFIG_ENDPOINT "https://<project>.supabase.co/functions/v1/device-config"
```

### 4.4 `secrets.h` (gitignored)

```cpp
#pragma once

// WiFi credentials
#define WIFI_SSID     "YourNetworkSSID"
#define WIFI_PASS     "YourNetworkPassword"

// Per-device Supabase publishable key (NOT the secret key)
#define DEVICE_TOKEN  "sb_publishable_..."
```

### Validation Checklist

- Device uses last-known config when the network is unavailable.
- Config updates apply within one polling interval.
- OTA update triggers only when `firmware_version` increases.
- Token revocation prevents future config/telemetry updates.

### Failure Modes and Guardrails

- Token leaked: revoke token in AWCMS, block requests in Edge Function.
- Invalid JSON payload: fall back to last-known settings and log parse error.
- WiFi failures: keep device in safe mode and retry connection.
- Breaking config changes: use versioned endpoints (for example `device-config-v2`).

---

## 5. Reporting Telemetry Back

Devices POST sensor data or status updates to a scoped REST endpoint secured by the device token:

```cpp
void reportTelemetry(float temperature, float humidity) {
    HTTPClient http;
    http.begin("https://<project>.supabase.co/rest/v1/iot_telemetry");
    http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
    http.addHeader("apikey", DEVICE_TOKEN);
    http.addHeader("Content-Type", "application/json");

    String body = "{\"device_id\":\"" + String(DEVICE_ID) +
                  "\",\"temperature\":" + String(temperature) +
                  ",\"humidity\":" + String(humidity) + "}";

    int code = http.POST(body);
    Serial.printf("[Telemetry] POST status: %d\n", code);
    http.end();
}
```

---

## 6. Security Rules

| Rule | Reason |
|------|--------|
| Only publishable keys on device | Secret keys must never leave the server |
| `secrets.h` in `.gitignore` | Prevents credential exposure |
| Edge Function validates device token | Server-side control; revoke compromised tokens via AWCMS Admin |
| No plaintext WiFi fallback | Prefer WPA2 networks; log WiFi errors and halt |

---

## 7. Build & Flash

```bash
# Using PlatformIO CLI
cd awcms-esp32/primary
pio run -e dev          # compile
pio run -e dev -t upload # flash to connected device
pio device monitor      # serial output at 115200 baud
```

Or use **PlatformIO → Project Tasks** in VS Code.

---

## 8. OTA (Over-The-Air) Updates

For firmware updates pushed via AWCMS, use the `Update.h` ESP32 Arduino library. The Edge Function serves the binary and the device calls `Update.begin()` → `Update.write()` → `Update.end()` after verifying the new version against `activeConfig.firmwareVersion`.
