# AWCMS ESP32 IoT Firmware

ESP32-based IoT device firmware with web dashboard and Supabase integration.

## Features

- 🌐 **Web Dashboard** - Responsive dark-mode UI
- 📡 **WebSocket** - Real-time data updates
- ☁️ **Supabase Sync** - Cloud data storage
- 🔒 **Secure** - HTTPS communication

## Requirements

- ESP32 Dev Board
- PlatformIO IDE (VSCode extension)
- WiFi network

## Quick Start

1. **Clone and open in VSCode with PlatformIO**

2. **Configure credentials** in `include/config.h`:

   ```cpp
   #define WIFI_SSID "your_wifi"
   #define WIFI_PASSWORD "your_password"
   #define TENANT_ID "your_tenant_uuid"
   ```

3. **Upload filesystem:**

   ```bash
   pio run -t uploadfs
   ```

4. **Upload firmware:**

   ```bash
   pio run -t upload
   ```

5. **Open Serial Monitor** to see IP address

6. **Access dashboard** at `http://<device-ip>/`

## Project Structure

```text
awcms-esp32/
├── platformio.ini       # PlatformIO config
├── src/main.cpp         # Main firmware
├── include/
│   ├── config.h         # Credentials
│   ├── webserver.h      # Web server
│   └── supabase_client.h
└── data/                # Web files (SPIFFS)
    ├── index.html
    ├── style.css
    └── app.js
```

## API Endpoints

| Endpoint | Method | Description |
| :------- | :----- | :---------- |
| `/api/status` | GET | Device status |
| `/api/sensors` | GET | Sensor data |
| `/api/wifi` | GET | WiFi info |
| `/api/restart` | POST | Restart device |

## WebSocket

Connect to `ws://<device-ip>/ws` for real-time updates.

## License

MIT
