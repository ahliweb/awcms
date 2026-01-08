/**
 * AWCMS ESP32 IoT Firmware
 * Camera Module (ESP32-CAM)
 *
 * OV2640 camera support with MJPEG streaming
 * and snapshot capture.
 */

#ifndef CAMERA_H
#define CAMERA_H

#include "config.h"
#include "esp_camera.h"
#include <Arduino.h>
#include <ArduinoJson.h>

// ============================================
// ESP32-CAM AI-Thinker Pin Configuration
// ============================================
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27

#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// ============================================
// Camera Variables
// ============================================
bool cameraInitialized = false;

// ============================================
// Camera Functions
// ============================================

/**
 * Initialize camera with configuration
 */
bool initCamera() {
  camera_config_t config;

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Frame size and quality based on PSRAM availability
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA; // 640x480
    config.jpeg_quality = 10;
    config.fb_count = 2;
    DEBUG_PRINTLN("PSRAM found, using VGA resolution");
  } else {
    config.frame_size = FRAMESIZE_QVGA; // 320x240
    config.jpeg_quality = 12;
    config.fb_count = 1;
    DEBUG_PRINTLN("No PSRAM, using QVGA resolution");
  }

  // Initialize camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    DEBUG_PRINTF("Camera init failed with error 0x%x\n", err);
    return false;
  }

  // Camera settings
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);                 // -2 to 2
    s->set_contrast(s, 0);                   // -2 to 2
    s->set_saturation(s, 0);                 // -2 to 2
    s->set_special_effect(s, 0);             // 0 = no effect
    s->set_whitebal(s, 1);                   // 0 = disable, 1 = enable
    s->set_awb_gain(s, 1);                   // 0 = disable, 1 = enable
    s->set_wb_mode(s, 0);                    // 0 to 4
    s->set_exposure_ctrl(s, 1);              // 0 = disable, 1 = enable
    s->set_aec2(s, 0);                       // 0 = disable, 1 = enable
    s->set_ae_level(s, 0);                   // -2 to 2
    s->set_aec_value(s, 300);                // 0 to 1200
    s->set_gain_ctrl(s, 1);                  // 0 = disable, 1 = enable
    s->set_agc_gain(s, 0);                   // 0 to 30
    s->set_gainceiling(s, (gainceiling_t)0); // 0 to 6
    s->set_bpc(s, 0);                        // 0 = disable, 1 = enable
    s->set_wpc(s, 1);                        // 0 = disable, 1 = enable
    s->set_raw_gma(s, 1);                    // 0 = disable, 1 = enable
    s->set_lenc(s, 1);                       // 0 = disable, 1 = enable
    s->set_hmirror(s, 0);                    // 0 = disable, 1 = enable
    s->set_vflip(s, 0);                      // 0 = disable, 1 = enable
    s->set_dcw(s, 1);                        // 0 = disable, 1 = enable
    s->set_colorbar(s, 0);                   // 0 = disable, 1 = enable
  }

  cameraInitialized = true;
  DEBUG_PRINTLN("Camera initialized successfully");
  return true;
}

/**
 * Capture a single frame
 */
camera_fb_t *captureFrame() {
  if (!cameraInitialized) {
    return NULL;
  }
  return esp_camera_fb_get();
}

/**
 * Return frame buffer to driver
 */
void releaseFrame(camera_fb_t *fb) {
  if (fb) {
    esp_camera_fb_return(fb);
  }
}

/**
 * Get camera status as JSON
 */
String getCameraStatusJSON() {
  JsonDocument doc;

  doc["initialized"] = cameraInitialized;
  doc["psram"] = psramFound();

  if (cameraInitialized) {
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
      doc["resolution"] = s->status.framesize;
      doc["quality"] = s->status.quality;
    }
  }

  String output;
  serializeJson(doc, output);
  return output;
}

/**
 * Set camera resolution
 */
bool setCameraResolution(framesize_t size) {
  if (!cameraInitialized)
    return false;

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, size);
    return true;
  }
  return false;
}

#endif // CAMERA_H
