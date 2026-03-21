# Compatibility

## Browsers

| Browser | Support |
|---------|---------|
| Chrome 110+ | ✅ Fully supported |
| Edge 110+ | ✅ Fully supported |
| Firefox 110+ | ✅ Fully supported |
| Safari 16+ | ✅ Fully supported |
| Mobile Chrome / Safari | ✅ Responsive layout supported |
| Internet Explorer | ❌ Not supported |

---

## Devices

The UI is responsive and works on:
- Desktop (1280px+) — full experience
- Tablet (768px+) — sidebar collapses, tables scroll horizontally
- Mobile — core pages usable; complex tables require horizontal scroll

PDF exports and print layouts are optimized for A4 paper.

---

## Node.js

| Version | Status |
|---------|--------|
| 20.x LTS | ✅ Recommended |
| 18.x LTS | ✅ Supported |
| 16.x | ⚠️ Not tested |

---

## Database

- **PostgreSQL 14+** required
- Uses Drizzle ORM — no manual SQL migrations needed; schema is auto-synced on server start

---

## Environment

- Runs on Linux (tested on Ubuntu 22.04 and Replit's NixOS environment)
- Not tested on Windows natively; use WSL2 if running locally on Windows
- All environment variables must be set before starting (see `.env.example` if present)
