/**
 * AWCMS ESP32 IoT Firmware
 * Authentication Module
 *
 * Basic HTTP Authentication for API endpoints
 */

#ifndef AUTH_H
#define AUTH_H

#include "config.h"
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <base64.h>

// ============================================
// Authentication Configuration
// ============================================

// Default credentials (override in config.h)
#ifndef AUTH_USERNAME
#define AUTH_USERNAME "admin"
#endif

#ifndef AUTH_PASSWORD
#define AUTH_PASSWORD "awcms2024"
#endif

// Enable/disable authentication
#ifndef AUTH_ENABLED
#define AUTH_ENABLED true
#endif

// ============================================
// Authentication Functions
// ============================================

/**
 * Check if request has valid Basic Auth credentials
 */
bool isAuthenticated(AsyncWebServerRequest *request) {
  // Skip auth if disabled
  if (!AUTH_ENABLED) {
    return true;
  }

  // Check for Authorization header
  if (!request->hasHeader("Authorization")) {
    return false;
  }

  String authHeader = request->header("Authorization");

  // Check for Basic auth
  if (!authHeader.startsWith("Basic ")) {
    return false;
  }

  // Decode and validate
  String encoded = authHeader.substring(6);
  String decoded = base64::decode(encoded);

  String expectedAuth = String(AUTH_USERNAME) + ":" + String(AUTH_PASSWORD);

  return decoded.equals(expectedAuth);
}

/**
 * Request authentication from client
 */
void requestAuthentication(AsyncWebServerRequest *request) {
  AsyncWebServerResponse *response =
      request->beginResponse(401, "text/plain", "Authentication Required");
  response->addHeader("WWW-Authenticate", "Basic realm=\"AWCMS IoT\"");
  request->send(response);
}

/**
 * Authentication middleware - call at start of protected handlers
 * Returns true if authenticated, false if auth response was sent
 */
bool requireAuth(AsyncWebServerRequest *request) {
  if (!isAuthenticated(request)) {
    requestAuthentication(request);
    return false;
  }
  return true;
}

/**
 * Validate API key (alternative to Basic Auth)
 */
bool isValidApiKey(AsyncWebServerRequest *request) {
  if (!request->hasHeader("X-API-Key")) {
    return false;
  }

  String apiKey = request->header("X-API-Key");

#ifdef API_KEY
  return apiKey.equals(API_KEY);
#else
  return false;
#endif
}

/**
 * Check if request is authenticated (Basic Auth or API Key)
 */
bool isAuthorized(AsyncWebServerRequest *request) {
  return isAuthenticated(request) || isValidApiKey(request);
}

#endif // AUTH_H
