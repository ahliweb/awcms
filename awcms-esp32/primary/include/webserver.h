/**
 * AWCMS ESP32 IoT Firmware
 * Web Server Header
 *
 * ESPAsyncWebServer setup for serving web interface
 */

#ifndef WEBSERVER_H
#define WEBSERVER_H

#include "auth.h"
#include "config.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <SPIFFS.h>
#include <WiFi.h>

// Web server instance
AsyncWebServer server(WEB_SERVER_PORT);
AsyncWebSocket ws("/ws");

// ============================================
// Function Declarations
// ============================================

/**
 * Initialize SPIFFS filesystem
 */
bool initSPIFFS() {
  if (!SPIFFS.begin(true)) {
    DEBUG_PRINTLN("SPIFFS Mount Failed");
    return false;
  }
  DEBUG_PRINTLN("SPIFFS Mounted");
  return true;
}

/**
 * Connect to WiFi network
 */
bool connectWiFi() {
  DEBUG_PRINT("Connecting to WiFi: ");
  DEBUG_PRINTLN(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - startTime > WIFI_TIMEOUT) {
      DEBUG_PRINTLN("WiFi Connection Timeout");
      return false;
    }
    delay(500);
    DEBUG_PRINT(".");
  }

  DEBUG_PRINTLN();
  DEBUG_PRINT("Connected! IP: ");
  DEBUG_PRINTLN(WiFi.localIP());

  return true;
}

/**
 * Get device status as JSON
 */
String getDeviceStatus() {
  JsonDocument doc;

  doc["device_id"] = DEVICE_ID;
  doc["device_name"] = DEVICE_NAME;
  doc["wifi_rssi"] = WiFi.RSSI();
  doc["ip_address"] = WiFi.localIP().toString();
  doc["uptime"] = millis() / 1000;
  doc["heap_free"] = ESP.getFreeHeap();
  doc["heap_total"] = ESP.getHeapSize();

  String output;
  serializeJson(doc, output);
  return output;
}

/**
 * WebSocket event handler
 */
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
  case WS_EVT_CONNECT:
    DEBUG_PRINTF("WebSocket client #%u connected\n", client->id());
    client->text(getDeviceStatus());
    break;
  case WS_EVT_DISCONNECT:
    DEBUG_PRINTF("WebSocket client #%u disconnected\n", client->id());
    break;
  case WS_EVT_DATA:
    // Handle incoming data
    DEBUG_PRINTF("WebSocket data received: %s\n", (char *)data);
    break;
  case WS_EVT_PONG:
  case WS_EVT_ERROR:
    break;
  }
}

/**
 * Broadcast message to all WebSocket clients
 */
void broadcastWS(const String &message) { ws.textAll(message); }

/**
 * Setup API routes
 */
void setupAPIRoutes() {
  // API: Get device status
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "application/json", getDeviceStatus());
  });

  // API: Get sensor data (placeholder)
  server.on("/api/sensors", HTTP_GET, [](AsyncWebServerRequest *request) {
    JsonDocument doc;
    doc["temperature"] = 25.5;
    doc["humidity"] = 60.0;
    doc["timestamp"] = millis();

    String output;
    serializeJson(doc, output);
    request->send(200, "application/json", output);
  });

  // API: Restart device
  server.on("/api/restart", HTTP_POST, [](AsyncWebServerRequest *request) {
    request->send(200, "application/json", "{\"status\":\"restarting\"}");
    delay(1000);
    ESP.restart();
  });

  // API: Get WiFi info
  server.on("/api/wifi", HTTP_GET, [](AsyncWebServerRequest *request) {
    JsonDocument doc;
    doc["ssid"] = WiFi.SSID();
    doc["rssi"] = WiFi.RSSI();
    doc["ip"] = WiFi.localIP().toString();
    doc["mac"] = WiFi.macAddress();

    String output;
    serializeJson(doc, output);
    request->send(200, "application/json", output);
  });

  // API: Get gas sensor data
  server.on("/api/gas", HTTP_GET, [](AsyncWebServerRequest *request) {
    extern String getGasSensorJSON();
    request->send(200, "application/json", getGasSensorJSON());
  });

  // API: Calibrate gas sensor
  server.on("/api/gas/calibrate", HTTP_POST,
            [](AsyncWebServerRequest *request) {
              extern bool calibrateGasSensor();
              bool success = calibrateGasSensor();
              String response = success ? "{\"status\":\"calibrated\"}"
                                        : "{\"status\":\"failed\"}";
              request->send(200, "application/json", response);
            });

  // API: Get camera status
  server.on("/api/camera", HTTP_GET, [](AsyncWebServerRequest *request) {
    extern String getCameraStatusJSON();
    request->send(200, "application/json", getCameraStatusJSON());
  });

  // API: Capture single frame
  server.on("/capture", HTTP_GET, [](AsyncWebServerRequest *request) {
    extern camera_fb_t *captureFrame();
    extern void releaseFrame(camera_fb_t *);
    extern bool cameraInitialized;

    if (!cameraInitialized) {
      request->send(503, "text/plain", "Camera not initialized");
      return;
    }

    camera_fb_t *fb = captureFrame();
    if (!fb) {
      request->send(500, "text/plain", "Camera capture failed");
      return;
    }

    AsyncWebServerResponse *response =
        request->beginResponse_P(200, "image/jpeg", fb->buf, fb->len);
    response->addHeader("Content-Disposition", "inline; filename=capture.jpg");
    request->send(response);
    releaseFrame(fb);
  });
}

/**
 * Initialize and start web server
 */
void initWebServer() {
  // Initialize SPIFFS
  if (!initSPIFFS()) {
    return;
  }

  // Setup WebSocket
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // Serve static files from SPIFFS
  server.serveStatic("/", SPIFFS, "/").setDefaultFile("index.html");

  // Setup API routes
  setupAPIRoutes();

  // 404 handler
  server.onNotFound([](AsyncWebServerRequest *request) {
    request->send(404, "text/plain", "Not Found");
  });

  // Start server
  server.begin();
  DEBUG_PRINTLN("Web Server Started");
}

#endif // WEBSERVER_H
