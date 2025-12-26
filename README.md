# AWCMS Monorepo

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

Welcome to the AWCMS development monorepo. This repository contains the source code for both the Admin Panel and the Public Portal.

## 📂 Project Structure

| Directory | Description | Tech Stack |
| :--- | :--- | :--- |
| `awcms/` | Admin Panel & CMS | React 18, Vite, Supabase |
| `awcms-public/` | Public Portal | Astro 5, React 19 |
| `awcms-mobile/` | Mobile App | Flutter 3.x, Riverpod, Supabase |

## 🚀 Quick Start

### 1. Admin Panel (`awcms`)

```bash
cd awcms
npm install
cp .env.example .env.local # Configure your Supabase credentials
npm run dev
```

Runs on: `http://localhost:3000`

### 2. Public Portal (`awcms-public`)

```bash
cd awcms-public
npm install
cp .env.example .env # Configure your Supabase credentials
npm run dev
```

Runs on: `http://localhost:4321`

## 📚 Documentation

Detailed documentation is available in the `awcms/docs` directory:

- [**Full Documentation Index**](awcms/docs/INDEX.md)
- [**Deployment Guide**](awcms/docs/DEPLOYMENT.md)
- [**Security Guide**](awcms/docs/SECURITY.md)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔒 Security

For reporting security vulnerabilities, please see our [Security Policy](SECURITY.md).

## 📞 Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.
