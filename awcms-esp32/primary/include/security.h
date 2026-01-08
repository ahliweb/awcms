/**
 * AWCMS ESP32 IoT Firmware
 * Security Module
 *
 * String obfuscation and anti-reverse engineering
 */

#ifndef SECURITY_H
#define SECURITY_H

#include <Arduino.h>

// ============================================
// Obfuscation Configuration
// ============================================

// XOR key for string obfuscation (change this!)
#define OBFUSCATION_KEY 0x5A

// ============================================
// String Obfuscation Functions
// ============================================

/**
 * Obfuscate a string using XOR
 * Returns dynamically allocated string (remember to free!)
 */
char *obfuscateString(const char *input) {
  size_t len = strlen(input);
  char *output = (char *)malloc(len + 1);

  for (size_t i = 0; i < len; i++) {
    output[i] = input[i] ^ OBFUSCATION_KEY;
  }
  output[len] = '\0';

  return output;
}

/**
 * Deobfuscate a string (same as obfuscate for XOR)
 */
char *deobfuscateString(const char *input) {
  return obfuscateString(input); // XOR is reversible
}

/**
 * Secure string comparison (constant-time)
 * Prevents timing attacks
 */
bool secureCompare(const char *a, const char *b) {
  size_t lenA = strlen(a);
  size_t lenB = strlen(b);

  // Always compare full length to prevent timing attacks
  volatile size_t maxLen = (lenA > lenB) ? lenA : lenB;
  volatile uint8_t result = 0;

  for (size_t i = 0; i < maxLen; i++) {
    char charA = (i < lenA) ? a[i] : 0;
    char charB = (i < lenB) ? b[i] : 0;
    result |= charA ^ charB;
  }

  return (result == 0) && (lenA == lenB);
}

/**
 * Clear sensitive data from memory
 */
void secureZero(void *ptr, size_t len) {
  volatile uint8_t *p = (volatile uint8_t *)ptr;
  while (len--) {
    *p++ = 0;
  }
}

// ============================================
// Compile-Time String Obfuscation Macro
// ============================================

// Helper to obfuscate at compile time (limited)
#define XOR_CHAR(c, key) ((char)((c) ^ (key)))

// Note: Full compile-time obfuscation requires C++14 constexpr
// For runtime-only obfuscation, use obfuscateString()

// ============================================
// Security Checks
// ============================================

/**
 * Check if running in debug mode
 * Can be used to disable features in production
 */
bool isDebugMode() {
#ifdef DEBUG_MODE
  return DEBUG_MODE;
#else
  return false;
#endif
}

/**
 * Log security event (for audit trail)
 */
void logSecurityEvent(const char *event, const char *details) {
  if (isDebugMode()) {
    Serial.printf("[SECURITY] %s: %s\n", event, details);
  }
  // In production, could send to Supabase audit log
}

#endif // SECURITY_H
