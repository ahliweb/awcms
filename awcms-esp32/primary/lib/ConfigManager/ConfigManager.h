// awcms-esp32/primary/lib/ConfigManager/ConfigManager.h
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
