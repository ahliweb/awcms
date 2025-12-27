/**
 * AWCMS ESP32 IoT Firmware
 * Main Entry Point
 *
 * This firmware provides:
 * - Web-based dashboard interface
 * - Sensor data collection
 * - Supabase cloud sync
 * - Real-time WebSocket updates
 */

#include "config.h"
#include "supabase_client.h"
#include "webserver.h"
#include <Arduino.h>

// ============================================
// Global Variables
// ============================================
unsigned long lastSensorRead = 0;
unsigned long lastDataSync = 0;
bool supabaseConnected = false;

// Sensor data (placeholder)
float temperature = 0.0;
float humidity = 0.0;

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
  DEBUG_PRINTLN("================================");
  DEBUG_PRINTF("Device ID: %s\n", DEVICE_ID);
  DEBUG_PRINTF("Firmware: v1.0.0\n");
  DEBUG_PRINTLN();

  // Connect to WiFi
  if (connectWiFi()) {
    // Initialize web server
    initWebServer();

    // Initialize Supabase
    supabaseConnected = initSupabase();

    // Log startup event
    if (supabaseConnected) {
      logEvent("startup", "Device started successfully");
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

  // Read sensors at interval
  if (millis() - lastSensorRead >= SENSOR_READ_INTERVAL) {
    lastSensorRead = millis();

    // Read sensors (placeholder - replace with actual sensor code)
    temperature = 25.0 + random(-50, 50) / 10.0;
    humidity = 60.0 + random(-100, 100) / 10.0;

    // Broadcast to WebSocket clients
    JsonDocument doc;
    doc["type"] = "sensor_data";
    doc["temperature"] = temperature;
    doc["humidity"] = humidity;
    doc["timestamp"] = millis();

    String message;
    serializeJson(doc, message);
    broadcastWS(message);

    DEBUG_PRINTF("Sensor: T=%.1f°C H=%.1f%%\n", temperature, humidity);
  }

  // Sync data to Supabase at interval
  if (supabaseConnected && (millis() - lastDataSync >= DATA_SYNC_INTERVAL)) {
    lastDataSync = millis();

    if (postSensorData(temperature, humidity)) {
      DEBUG_PRINTLN("Data synced to Supabase");
    }
  }

  // Small delay to prevent watchdog issues
  delay(10);
}
