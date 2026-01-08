/**
 * AWCMS ESP32 IoT Firmware
 * Main Entry Point
 *
 * Features:
 * - Web dashboard interface
 * - Gas sensor monitoring (MQ series)
 * - Camera streaming (ESP32-CAM)
 * - Supabase cloud sync
 * - Real-time WebSocket updates
 */

#include "camera.h"
#include "config.h"
#include "gas_sensor.h"
#include "supabase_client.h"
#include "webserver.h"
#include <Arduino.h>

// ============================================
// Global Variables
// ============================================
unsigned long lastSensorRead = 0;
unsigned long lastDataSync = 0;
unsigned long lastGasCheck = 0;
bool supabaseConnected = false;

// ============================================
// Setup
// ============================================
void setup() {
  // Initialize Serial
  Serial.begin(115200);
  delay(1000);

  DEBUG_PRINTLN();
  DEBUG_PRINTLN("================================");
  DEBUG_PRINTLN("  AWCMS ESP32 IoT Firmware");
  DEBUG_PRINTLN("  Gas Sensor + Camera Edition");
  DEBUG_PRINTLN("================================");
  DEBUG_PRINTF("Device ID: %s\n", DEVICE_ID);
  DEBUG_PRINTF("Firmware: v2.0.0\n");
  DEBUG_PRINTLN();

  // Initialize gas sensor
  initGasSensor();
  DEBUG_PRINTLN("Gas sensor warming up (5-10 min)...");

// Initialize camera (ESP32-CAM only)
#ifdef ENABLE_CAMERA
  if (initCamera()) {
    DEBUG_PRINTLN("Camera ready");
  } else {
    DEBUG_PRINTLN("Camera init failed - check connections");
  }
#endif

  // Connect to WiFi
  if (connectWiFi()) {
    // Initialize web server
    initWebServer();

    // Initialize Supabase
    supabaseConnected = initSupabase();

    // Log startup event
    if (supabaseConnected) {
      logEvent("startup", "Device started with gas sensor and camera");
    }
  } else {
    DEBUG_PRINTLN("Failed to connect to WiFi");
    // TODO: Start AP mode for configuration
  }

  DEBUG_PRINTLN("Setup complete!");
  DEBUG_PRINTLN();
}

// ============================================
// Loop
// ============================================
void loop() {
  // Clean up WebSocket clients
  ws.cleanupClients();

  // Read gas sensor at interval
  if (millis() - lastSensorRead >= SENSOR_READ_INTERVAL) {
    lastSensorRead = millis();

    // Read gas sensor
    readGasSensor();

    // Broadcast to WebSocket clients
    JsonDocument doc;
    doc["type"] = "sensor_data";
    doc["gas_ppm"] = gasPPM;
    doc["gas_raw"] = gasRaw;
    doc["gas_voltage"] = gasVoltage;
    doc["gas_calibrated"] = sensorCalibrated;
    doc["timestamp"] = millis();

    // Check for danger level
    if (isGasDangerous()) {
      doc["alert"] = "DANGER: High gas level detected!";
      DEBUG_PRINTLN("⚠️ DANGER: High gas level!");
    }

    String message;
    serializeJson(doc, message);
    broadcastWS(message);

    DEBUG_PRINTF("Gas: %.1f PPM (raw: %.0f)\n", gasPPM, gasRaw);
  }

  // Sync data to Supabase at interval
  if (supabaseConnected && (millis() - lastDataSync >= DATA_SYNC_INTERVAL)) {
    lastDataSync = millis();

    // Post gas sensor data
    JsonDocument doc;
    doc["device_id"] = DEVICE_ID;
    doc["tenant_id"] = TENANT_ID;
    doc["gas_ppm"] = gasPPM;
    doc["gas_raw"] = gasRaw;
    doc["timestamp"] = millis();

    String jsonData;
    serializeJson(doc, jsonData);

    int httpCode = supabase.insert("sensor_readings", jsonData, false);
    if (httpCode == 201) {
      DEBUG_PRINTLN("Gas data synced to Supabase");
    }
  }

  // Small delay to prevent watchdog issues
  delay(10);
}
