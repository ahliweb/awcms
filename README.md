# AWCMS Monorepo

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

Welcome to the AWCMS development monorepo. A complete content management and IoT platform.

## 📂 Project Structure

| Directory | Description | Tech Stack |
| :--- | :--- | :--- |
| `awcms/` | Admin Panel & CMS | React 18, Vite, Supabase |
| `awcms-public/` | Public Portal | Astro 5, React 19 |
| `awcms-mobile/` | Mobile App | Flutter 3.x, Riverpod |
| `awcms-esp32/` | IoT Firmware | ESP32, PlatformIO |

## 🚀 Quick Start

### 1. Admin Panel (`awcms`)

```bash
cd awcms
npm install
cp .env.example .env.local
npm run dev

# Optional: Configure CORS in .env.local
# VITE_CORS_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

→ `http://localhost:3000`

### 2. Public Portal (`awcms-public`)

```bash
cd awcms-public
npm install
npm run dev
```

→ `http://localhost:4321`

### 3. Mobile App (`awcms-mobile`)

```bash
cd awcms-mobile
flutter pub get
flutter run
```

### 4. ESP32 IoT (`awcms-esp32`)

```bash
cd awcms-esp32
cp .env.example .env
# Edit .env with credentials
source .env && pio run -t upload
```

## 🌟 Features

### Admin Panel

- 📝 Content management (articles, pages)
- 👥 Multi-tenant architecture
- 🔐 ABAC + RLS security
- 🎨 Visual page builder
- 📊 Analytics dashboard

### IoT (ESP32)

- 💨 Gas sensor monitoring (MQ series)
- 📷 Camera streaming (ESP32-CAM)
- 📡 Realtime data sync to Supabase
- 🌐 Web dashboard on device
- 🔐 Secure credentials (.env)

## 📚 Documentation

| Doc | Path |
| :-- | :--- |
| Admin Docs | `awcms/docs/` |
| **AI Agents Guide** | [AGENTS.md](AGENTS.md) |
| ESP32 Docs | `awcms-esp32/README.md` |
| Mobile Docs | `awcms-mobile/README.md` |

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## 📜 License

MIT - see [LICENSE](LICENSE)

## 🔒 Security

See [SECURITY.md](SECURITY.md)
