# Running Functions Emulator with Remote Firebase

This guide helps you run the Cloud Functions locally while using remote Firebase Auth and Firestore.

## Why This Setup?

- ✅ No billing issues - Functions run locally
- ✅ Real authentication - Users can sign in
- ✅ Real database - Access production data
- ✅ Fast development - Edit functions without deploying

---

## Prerequisites

### Required Software

| Software | Version | Check | Install |
|----------|---------|-------|---------|
| Node.js | 20 or 22 | `node --version` | [nodejs.org](https://nodejs.org) |
| npm | Any | `npm --version` | Comes with Node.js |
| Firebase CLI | Latest | `firebase --version` | `npm install -g firebase-tools` |
| Git | Any | `git --version` | [git-scm.com](https://git-scm.com) |

**Note:** Functions are configured for Node 20, but Node 22 works fine. Avoid Node 21 (odd versions are unstable).

### Firebase Project Access

You need:
- Access to Firebase project `digital-parking-f9d2c`
- Service account key file (see below)

---

## Step 1: Clone and Install

```bash
# Clone repository
git clone <repository-url>
cd "smart-car-parking-managiment-system/Web App"

# Install frontend dependencies
npm install

# Install functions dependencies
cd functions
npm install
cd ..
```

---

## Step 2: Get Service Account Key

### Option A: Request from Team

Ask the project owner for the file:
- `digital-parking-f9d2c-firebase-adminsdk-fbsvc-fb7366722e.json`
- Place it in the `Web App/` folder (same level as `package.json`)

### Option B: Generate Your Own

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select project `digital-parking-f9d2c`
3. Click ⚙️ → **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key**
5. Save as `digital-parking-f9d2c-firebase-adminsdk-fbsvc-fb7366722e.json`
6. Place in `Web App/` folder

**⚠️ IMPORTANT:** Never commit this file to git! It's already in `.gitignore`.

---

## Step 3: Configure Environment

### Create .env File

```bash
# Copy example
cp .env.example .env
```

### Edit .env

```env
# Remote Firebase (for Auth & Firestore)
REACT_APP_FIREBASE_API_KEY=your_api_key_here
REACT_APP_FIREBASE_AUTH_DOMAIN=digital-parking-f9d2c.firebaseapp.com
REACT_APP_FIREBASE_DATABASE_URL=https://digital-parking-f9d2c.firebaseio.com
REACT_APP_FIREBASE_PROJECT_ID=digital-parking-f9d2c
REACT_APP_FIREBASE_STORAGE_BUCKET=digital-parking-f9d2c.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id

# Google Maps
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Local Functions Emulator
REACT_APP_USE_FUNCTIONS_EMULATOR=true
REACT_APP_FUNCTIONS_EMULATOR_HOST=localhost
REACT_APP_FUNCTIONS_EMULATOR_PORT=5001
```

**Get Firebase values from:** Firebase Console → Project Settings → Your Apps

---

## Step 4: Firebase Login

```bash
# Login to Firebase
firebase login

# Set project
firebase use digital-parking-f9d2c
```

---

## Step 5: Run the Application

### Terminal 1: Start Functions Emulator

```bash
npm run firebase:emulators
```

**Expected output:**
```
✔  functions: Emulator started at http://localhost:5001
✔  functions[us-central1-yourFunction]: http function initialized
```

### Terminal 2: Start React App

```bash
npm start
```

**Expected output:**
```
Compiled successfully!
You can now view smart_car_parking in the browser.
  Local:            http://localhost:3000
```

### Verify Setup

Open browser console, you should see:
```
Using Functions emulator at localhost:5001
```

---

## Troubleshooting

### Error: "Cannot find module 'firebase-admin'"

**Solution:**
```bash
cd functions
npm install
cd ..
```

### Error: "Port 5001 already in use"

**Solution 1:** Kill the process using the port

**Windows:**
```bash
netstat -ano | findstr :5001
taskkill /PID <PID> /F
```

**Mac/Linux:**
```bash
lsof -i :5001
kill -9 <PID>
```

**Solution 2:** Change the port in `firebase.json`:
```json
{
  "emulators": {
    "functions": {
      "port": 5002
    }
  }
}
```

And update `.env`:
```env
REACT_APP_FUNCTIONS_EMULATOR_PORT=5002
```

### Error: "Permission denied" when accessing Firebase

**Solution:** Make sure you're added as a collaborator:
- Firebase Console → Project Settings → Users and permissions
- Ask project owner to add your email

### Error: "auth/invalid-api-key"

**Solution:** Verify your `.env` file has correct Firebase configuration values.

### Functions can't access Firestore

**Solution:** Make sure the service account key file is in the correct location:
```
Web App/
  ├── digital-parking-f9d2c-firebase-adminsdk-fbsvc-fb7366722e.json  ← Here
  ├── package.json
  ├── firebase.json
  └── ...
```

### Error: "Node version mismatch"

**Solution:** Functions require Node 20 or 22 (LTS versions)
```bash
node --version  # Should be 20.x.x or 22.x.x
```

If you have Node 21 or older than 20, download Node 20 LTS or Node 22 LTS from [nodejs.org](https://nodejs.org)

**Note:** The emulator runs functions with your local Node version, not the deployed version.

---

## What's Running Where?

| Service | Location | URL |
|---------|----------|-----|
| **Functions** | Local emulator | http://localhost:5001 |
| **Auth** | Remote Firebase | https://identitytoolkit.googleapis.com |
| **Firestore** | Remote Firebase | https://firestore.googleapis.com |
| **React App** | Local dev server | http://localhost:3000 |
| **Emulator UI** | Local (if enabled) | http://localhost:4000 |

---

## Network Verification

Open browser DevTools → Network tab:

- ✅ Function calls → `localhost:5001` (Local)
- ✅ Auth requests → `identitytoolkit.googleapis.com` (Remote)
- ✅ Firestore requests → `firestore.googleapis.com` (Remote)

---

## Security Notes

### Do NOT commit:
- ❌ `.env` file
- ❌ `*-firebase-adminsdk-*.json` files
- ❌ Service account keys

### Safe to commit:
- ✅ `.env.example`
- ✅ `firebase.json`
- ✅ `.firebaserc`

---

## Additional Commands

```bash
# Lint code
npm run lint

# Build for production
npm run build

# Run all emulators (requires Java)
npm run firebase:emulators:all

# Deploy to production (requires permissions)
npm run deploy:functions
```

---

## Getting Help

If you encounter issues:

1. Check this troubleshooting guide
2. Verify all prerequisites are installed
3. Ensure service account key is in correct location
4. Check Firebase Console for project access
5. Review browser console for error messages

---

## Quick Reference

### Startup Commands
```bash
# Every time you start development:
npm run firebase:emulators  # Terminal 1
npm start                    # Terminal 2
```

### Stop Commands
```bash
# Ctrl+C in both terminals
```

### Restart After Code Changes
- React app: Auto-reloads
- Functions: Restart emulator (Ctrl+C, then run again)
