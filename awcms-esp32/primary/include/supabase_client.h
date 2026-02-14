/**
 * AWCMS ESP32 IoT Firmware
 * Supabase Client Header
 *
 * Integration with Supabase for data sync
 */

#ifndef SUPABASE_CLIENT_H
#define SUPABASE_CLIENT_H

#include "config.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPSupabase.h>
#include <WiFiClientSecure.h>

// Supabase client instance
Supabase supabase;

// ============================================
// Supabase Functions
// ============================================

/**
 * Initialize Supabase connection
 */
bool initSupabase() {
  supabase.begin(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  DEBUG_PRINTLN("Supabase initialized");
  return true;
}

/**
 * Send sensor data to Supabase
 */
bool postSensorData(float temperature, float humidity) {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["tenant_id"] = TENANT_ID;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["timestamp"] = millis();

  String jsonData;
  serializeJson(doc, jsonData);

  // POST to sensor_readings table
  int httpCode = supabase.insert("sensor_readings", jsonData, false);

  if (httpCode == 201) {
    DEBUG_PRINTLN("Data sent to Supabase");
    return true;
  } else {
    DEBUG_PRINTF("Supabase POST failed: %d\n", httpCode);
    return false;
  }
}

/**
 * Get device configuration from Supabase
 */
String getDeviceConfig() {
  String query = supabase.from("device_configs")
                     .select("*")
                     .eq("device_id", DEVICE_ID)
                     .limit(1)
                     .doSelect();

  DEBUG_PRINTLN("Config: " + query);
  return query;
}

/**
 * Update device status in Supabase
 */
bool updateDeviceStatus(bool online, int rssi) {
  JsonDocument doc;
  doc["online"] = online;
  doc["rssi"] = rssi;
  doc["last_seen"] = "now()";
  doc["ip_address"] = WiFi.localIP().toString();

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode =
      supabase.update("devices").eq("device_id", DEVICE_ID).doUpdate(jsonData);

  return httpCode == 200 || httpCode == 204;
}

/**
 * Log event to Supabase
 */
bool logEvent(const char *eventType, const char *message) {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["tenant_id"] = TENANT_ID;
  doc["event_type"] = eventType;
  doc["message"] = message;

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = supabase.insert("device_logs", jsonData, false);
  return httpCode == 201;
}

#endif // SUPABASE_CLIENT_H
