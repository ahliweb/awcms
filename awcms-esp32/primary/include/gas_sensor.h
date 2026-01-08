/**
 * AWCMS ESP32 IoT Firmware
 * Gas Sensor Module (MQ Series)
 *
 * Supports MQ-2, MQ-135, and other MQ series sensors
 * with calibration and PPM calculation.
 */

#ifndef GAS_SENSOR_H
#define GAS_SENSOR_H

#include "config.h"
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================
// Gas Sensor Configuration
// ============================================

// Sensor pin (ADC1 pins only: 32, 33, 34, 35, 36, 39)
#define GAS_SENSOR_PIN 34

// Clean air ratio (Rs/Ro in clean air)
// MQ-2: ~9.83, MQ-135: ~3.6
#define CLEAN_AIR_RATIO 9.83

// Load resistance (kOhms) - check your module
#define RL_VALUE 10.0

// ADC resolution
#define ADC_RESOLUTION 4095.0
#define VOLTAGE_REF 3.3

// Calibration samples
#define CALIBRATION_SAMPLES 50
#define CALIBRATION_DELAY 500

// ============================================
// Gas Sensor Variables
// ============================================
float Ro = 10.0; // Sensor resistance in clean air (calibrated)
bool sensorCalibrated = false;
unsigned long lastGasRead = 0;

// Current readings
float gasRaw = 0;
float gasPPM = 0;
float gasVoltage = 0;

// ============================================
// Gas Sensor Functions
// ============================================

/**
 * Read raw ADC value from gas sensor
 */
int readGasSensorRaw() { return analogRead(GAS_SENSOR_PIN); }

/**
 * Convert ADC value to voltage
 */
float adcToVoltage(int adcValue) {
  return (adcValue / ADC_RESOLUTION) * VOLTAGE_REF;
}

/**
 * Calculate sensor resistance (Rs)
 */
float calculateRs(int adcValue) {
  float voltage = adcToVoltage(adcValue);
  if (voltage == 0)
    return 0;

  // Rs = (Vc * RL) / Vout - RL
  float rs = ((VOLTAGE_REF * RL_VALUE) / voltage) - RL_VALUE;
  return rs;
}

/**
 * Calculate PPM from Rs/Ro ratio
 * Using simplified formula for MQ-2 (LPG curve)
 */
float calculatePPM(float rsRoRatio) {
  // MQ-2 LPG curve approximation: PPM = 574.25 * (Rs/Ro)^-2.222
  // Adjust formula based on your specific gas and sensor
  float ppm = 574.25 * pow(rsRoRatio, -2.222);
  return ppm;
}

/**
 * Calibrate sensor in clean air
 * Should be called after warm-up period (5-10 minutes)
 */
bool calibrateGasSensor() {
  DEBUG_PRINTLN("Calibrating gas sensor...");
  DEBUG_PRINTLN("Ensure sensor is in clean air!");

  float rsSum = 0;

  for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
    int adcValue = readGasSensorRaw();
    float rs = calculateRs(adcValue);
    rsSum += rs;
    delay(CALIBRATION_DELAY / CALIBRATION_SAMPLES);

    if (i % 10 == 0) {
      DEBUG_PRINTF("Calibration: %d%%\n", (i * 100) / CALIBRATION_SAMPLES);
    }
  }

  float rsAvg = rsSum / CALIBRATION_SAMPLES;
  Ro = rsAvg / CLEAN_AIR_RATIO;

  if (Ro > 0 && Ro < 1000) {
    sensorCalibrated = true;
    DEBUG_PRINTF("Calibration complete! Ro = %.2f kOhm\n", Ro);
    return true;
  }

  DEBUG_PRINTLN("Calibration failed. Check sensor connection.");
  return false;
}

/**
 * Initialize gas sensor
 */
void initGasSensor() {
  pinMode(GAS_SENSOR_PIN, INPUT);
  DEBUG_PRINTLN("Gas sensor initialized on GPIO " + String(GAS_SENSOR_PIN));
  DEBUG_PRINTLN("Allow 5-10 min warm-up before calibration.");
}

/**
 * Read gas sensor values
 */
void readGasSensor() {
  int adcValue = readGasSensorRaw();
  gasRaw = adcValue;
  gasVoltage = adcToVoltage(adcValue);

  if (sensorCalibrated && Ro > 0) {
    float rs = calculateRs(adcValue);
    float rsRoRatio = rs / Ro;
    gasPPM = calculatePPM(rsRoRatio);

    // Clamp PPM to reasonable range
    if (gasPPM < 0)
      gasPPM = 0;
    if (gasPPM > 10000)
      gasPPM = 10000;
  } else {
    gasPPM = 0;
  }
}

/**
 * Get gas sensor data as JSON
 */
String getGasSensorJSON() {
  JsonDocument doc;

  doc["raw"] = gasRaw;
  doc["voltage"] = gasVoltage;
  doc["ppm"] = gasPPM;
  doc["calibrated"] = sensorCalibrated;
  doc["ro"] = Ro;
  doc["timestamp"] = millis();

  // Gas level indicator
  String level = "normal";
  if (gasPPM > 1000)
    level = "danger";
  else if (gasPPM > 500)
    level = "warning";
  else if (gasPPM > 200)
    level = "elevated";
  doc["level"] = level;

  String output;
  serializeJson(doc, output);
  return output;
}

/**
 * Check if gas level is dangerous
 */
bool isGasDangerous() { return gasPPM > 1000; }

#endif // GAS_SENSOR_H
