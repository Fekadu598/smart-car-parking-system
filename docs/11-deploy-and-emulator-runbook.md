# Deploy and Emulator Runbook

This document provides step-by-step instructions for running the app locally with emulators and deploying to production.

## Firebase Project

| Property | Value |
|----------|-------|
| **Project ID** | `digital-parking-f9d2c` |
| **Region** | `us-central1` |
| **Config File** | `.firebaserc` |

---

## Local Development with Emulators

### What Are Emulators?

Firebase emulators are local versions of Firebase services that run on your computer. They let you:

- Develop without affecting production data
- Test Cloud Functions locally
- Work offline
- Iterate faster (no deployment needed)

### Available Emulators

| Emulator | Port | Purpose |
|----------|------|---------|
| **Functions** | 5001 | Run Cloud Functions locally |
| **Firestore** | 8080 | Local database |
| **Auth** | 9099 | Local authentication |
| **Emulator UI** | 4000 | Visual interface for all emulators |

---

## Running Emulators

### Functions Emulator Only

Run just the Cloud Functions locally:

```bash
npm run firebase:emulators
```

**When to use:**
- Testing function logic
- Debugging callable functions
- Quick function iteration

**What happens:**
- Functions run at `http://localhost:5001`
- Functions connect to production Firestore (if configured)
- No local database

---

### All Emulators (Functions + Firestore)

Run both Functions and Firestore locally:

```bash
npm run firebase:emulators:all
```

**When to use:**
- Full local development
- Testing database operations
- Complete isolation from production

**What happens:**
- Functions run at `http://localhost:5001`
- Firestore runs at `http://localhost:8080`
- Data is stored locally (in `.emulator-data/` by default)
- Emulator UI at `http://localhost:4000`

---

### Configuring the App for Emulators

In your `.env` file:

```env
# Enable emulator usage
REACT_APP_USE_FUNCTIONS_EMULATOR=true
REACT_APP_FUNCTIONS_EMULATOR_HOST=localhost
REACT_APP_FUNCTIONS_EMULATOR_PORT=5001
```

In `src/firebase.js`, the app automatically connects to emulators:

```javascript
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const functions = getFunctions();

// Connect to emulator in development
if (process.env.REACT_APP_USE_FUNCTIONS_EMULATOR === 'true') {
  connectFunctionsEmulator(functions, 'localhost', 5001);
}
```

---

### Emulator UI

When emulators are running, access the UI at:

```
http://localhost:4000
```

**Features:**
- View and edit Firestore documents
- See Cloud Functions logs
- Manage authentication users
- View emulator status

---

## Recommended Local Workflow

### Step 1: Start Emulators

```bash
npm run firebase:emulators:all
```

Wait for:
```
✔  All emulators ready! View status and logs at http://localhost:4000
```

### Step 2: Start Frontend

In a new terminal:

```bash
npm start
```

The app opens at `http://localhost:3000`.

### Step 3: Test with Seed Data

If you need test data:

```bash
# Seed test users (if script exists)
node scripts/seedPhaseAUsers.js

# Or create users manually in Emulator UI
```

### Step 4: Develop and Test

- Make code changes
- See changes reflected immediately
- Test all flows (booking, check-in, payment)
- Check Emulator UI for database state

### Step 5: Verify Before Deploying

```bash
# Run linting
npm run lint

# Build for production
npm run build
```

---

## Deployment Commands

## Deploying the Web App to Vercel

Vercel can host the React frontend, but it cannot run the Firebase Emulator Suite as a production backend. The emulator is a local development tool, so any production deployment must either use real Firebase services or a separate always-on backend that you host outside Vercel.

### Vercel Settings

- Root Directory: `Web App`
- Build Command: `npm run build`
- Output Directory: `build`
- Install Command: `npm install`

### Environment Variables

Set the normal Firebase client config in Vercel, and keep emulator usage off in production:

```env
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_DATABASE_URL=...
REACT_APP_FIREBASE_PROJECT_ID=...
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
REACT_APP_FIREBASE_APP_ID=...
REACT_APP_USE_FUNCTIONS_EMULATOR=false
```

### What This Means For Billing

If your goal is to avoid Firebase Functions billing, the safe options are:

- Keep the emulator for local development only.
- Move the backend logic to a separate service you host elsewhere.
- Reduce callable-function usage and rely more on Firestore/Auth where possible.

Vercel itself is not a place to run the emulator in production, because it does not provide a persistent local process that can stand in for Firebase Functions.

### Deploy Firestore Rules and Indexes

Deploy database security rules and indexes:

```bash
npm run deploy:firestore
```

**What this deploys:**
- `firestore.rules` - Security rules
- `firestore.indexes.json` - Database indexes

**When to run:**
- After changing security rules
- After adding new database queries that need indexes

---

### Deploy Cloud Functions

Deploy backend functions:

```bash
npm run deploy:functions
```

**What this deploys:**
- All functions in `functions/index.js`
- Scheduled functions (like `expireBookings`)

**When to run:**
- After changing function logic
- After adding new functions

**Note:** First deployment may take several minutes.

---

### Deploy Everything (Phase 2 Baseline)

Deploy all Phase 2 artifacts:

```bash
npm run deploy:phase2
```

**What this deploys:**
- Firestore rules and indexes
- Cloud Functions
- (Potentially) Hosting

**When to run:**
- After major updates
- For release deployments

---

## Deployment Checklist

### Before Deploying

| Check | Command |
|-------|---------|
| Lint passes | `npm run lint` |
| Build succeeds | `npm run build` |
| Functions tests pass | `cd functions && npm test` |
| Environment variables set | Check `.env` |

### Security Checks

| Check | Why |
|-------|-----|
| `.env` not committed | Prevents secret exposure |
| Service account JSON not committed | Prevents unauthorized access |
| API keys restricted | Prevents abuse |

---

## Production Readiness Checklist

### Firebase Console Setup

| Item | How to Check |
|------|--------------|
| Email/Password auth enabled | Firebase Console → Authentication → Sign-in method |
| Firestore created | Firebase Console → Firestore |
| Cloud Functions deployed | Firebase Console → Functions |
| App registered | Firebase Console → Project Settings → Your Apps |

### Security Configuration

| Item | Location |
|------|----------|
| Firestore rules deployed | `firestore.rules` |
| Firestore indexes deployed | `firestore.indexes.json` |
| API key restrictions | Google Cloud Console → APIs & Services → Credentials |

### Environment Variables

| Variable | Required For |
|----------|--------------|
| `REACT_APP_FIREBASE_*` | Firebase connection |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | Map display |
| `REACT_APP_USE_FUNCTIONS_EMULATOR` | Set to `false` for production |

---

## Files Reference

### Configuration Files

| File | Purpose |
|------|---------|
| `.firebaserc` | Firebase project configuration |
| `firebase.json` | Firebase services configuration |
| `firestore.rules` | Database security rules |
| `firestore.indexes.json` | Database query indexes |
| `.env` | Environment variables (not committed) |
| `.env.example` | Template for environment variables |

### firebase.json Example

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "functions"
  },
  "emulators": {
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "auth": { "port": 9099 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

---

## Troubleshooting

### Emulator Issues

| Problem | Solution |
|---------|----------|
| Port already in use | Kill the process using the port or change port in `firebase.json` |
| Functions not updating | Restart emulators after code changes |
| Data not persisting | Check if `--import` and `--export` flags are set |
| CORS errors | Ensure app uses `connectFunctionsEmulator` |

### Deployment Issues

| Problem | Solution |
|---------|----------|
| "Permission denied" | Check Firebase project access |
| "Quota exceeded" | Check Firebase billing and quotas |
| "Function deployment error" | Check function logs in Firebase Console |
| "Rules validation failed" | Fix syntax errors in `firestore.rules` |

### Useful Commands

```bash
# View deployment status
firebase deploy --only functions --dry-run

# View function logs
firebase functions:log

# Test specific function locally
firebase emulators:start --only functions

# Export emulator data
firebase emulators:export ./emulator-data

# Import emulator data
firebase emulators:start --import ./emulator-data
```

---

## CI/CD Integration

For automated deployments, consider:

1. **GitHub Actions** - Deploy on push to main branch
2. **Firebase Hosting previews** - Deploy preview for pull requests
3. **Automated tests** - Run before deployment

### Example GitHub Actions Workflow

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Deploy to Firebase
        uses: w9jds/firebase-action@master
        with:
          args: deploy
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

---

## Related Documentation

- `docs/02-getting-started-local.md` - Setting up the project
- `docs/03-environment-variables.md` - Environment configuration
- `docs/12-troubleshooting.md` - Common issues and solutions