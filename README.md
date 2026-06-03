# Enderase Smart Parking

Full project docs are in `docs/README.md`.

## 🚀 Quick Start for New Developers

**First time setup?** Follow this order:

1. **[SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md)** - Complete checklist for new developers
2. **[EMULATOR_SETUP.md](./EMULATOR_SETUP.md)** - Detailed guide for running functions locally
3. **[NODE_VERSION_COMPATIBILITY.md](./NODE_VERSION_COMPATIBILITY.md)** - Node.js version info

## Quick Start

1. Install deps:
   - `npm install`
   - `cd functions && npm install && cd ..`
2. Configure env from `.env.example` into `.env`
3. Get service account key: `digital-parking-f9d2c-firebase-adminsdk-fbsvc-fb7366722e.json`
4. Run app: 
   - Terminal 1: `npm run firebase:emulators`
   - Terminal 2: `npm start`

## Useful Scripts

- `npm run lint`
- `npm run build`
- `npm run firebase:emulators` - Run functions emulator only
- `npm run firebase:emulators:all` - Run all emulators (requires Java)
- `npm run deploy:firestore`
- `npm run deploy:functions`
- `npm run deploy:phase2`

## Requirements

- Node.js 20 or 22 (LTS versions)
- Firebase CLI: `npm install -g firebase-tools`
- Service account key file (see SETUP_CHECKLIST.md)
