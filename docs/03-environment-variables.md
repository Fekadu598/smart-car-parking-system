# Environment Variables

This document explains all the configuration values needed to run the Enderase Smart Parking application.

## What Are Environment Variables?

Environment variables are configuration values that live outside your code. They:

- Keep sensitive information (like API keys) out of your source code
- Allow different configurations for development, staging, and production
- Make it easy to change settings without modifying code

In this project, environment variables are stored in a `.env` file in the project root.

---

## Required Variables

Here are all the environment variables used by the application:

### Firebase Configuration

These values come from your Firebase project settings:

| Variable | Description | Where to Find It |
|----------|-------------|------------------|
| `REACT_APP_FIREBASE_API_KEY` | Public API key for your Firebase project | Firebase Console → Project Settings → General → Your Apps |
| `REACT_APP_FIREBASE_AUTH_DOMAIN` | Domain for authentication | Usually `your-project-id.firebaseapp.com` |
| `REACT_APP_FIREBASE_DATABASE_URL` | Realtime Database URL (if used) | `https://your-project-id.firebaseio.com` |
| `REACT_APP_FIREBASE_PROJECT_ID` | Your Firebase project ID | Visible in Firebase Console URL and project settings |
| `REACT_APP_FIREBASE_STORAGE_BUCKET` | Cloud Storage bucket | Usually `your-project-id.appspot.com` |
| `REACT_APP_FIREBASE_MESSAGING_SENDER_ID` | Sender ID for push notifications | Firebase Console → Project Settings → Cloud Messaging |
| `REACT_APP_FIREBASE_APP_ID` | App identifier | Firebase Console → Project Settings → General → Your Apps |

### Google Maps Configuration

| Variable | Description |
|----------|-------------|
| `REACT_APP_GOOGLE_MAPS_API_KEY` | API key for Google Maps JavaScript API |

### Emulator Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_USE_FUNCTIONS_EMULATOR` | `false` | Set to `true` to route function calls to local emulator |
| `REACT_APP_FUNCTIONS_EMULATOR_HOST` | `localhost` | Hostname of the functions emulator |
| `REACT_APP_FUNCTIONS_EMULATOR_PORT` | `5001` | Port of the functions emulator |

---

## Example .env File

```env
# Google Maps
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# Firebase Configuration
REACT_APP_FIREBASE_API_KEY=your_api_key_here
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789
REACT_APP_FIREBASE_APP_ID=1:123456789:web:abcdef123456

# Emulator Settings (for local development)
REACT_APP_USE_FUNCTIONS_EMULATOR=true
REACT_APP_FUNCTIONS_EMULATOR_HOST=localhost
REACT_APP_FUNCTIONS_EMULATOR_PORT=5001
```

---

## How to Get Firebase Configuration Values

### Step-by-Step Guide

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project (or create a new one)
3. Click the gear icon ⚙️ → **Project settings**
4. Scroll down to **Your apps** section
5. If no app exists, click **Add app** → **Web** (</> icon)
6. Register your app with a nickname (e.g., "Enderase Web")
7. Copy the `firebaseConfig` object values to your `.env` file

### Example Firebase Config Object

In Firebase Console, you'll see something like:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB...",           // → REACT_APP_FIREBASE_API_KEY
  authDomain: "project.firebaseapp.com",  // → REACT_APP_FIREBASE_AUTH_DOMAIN
  databaseURL: "https://project.firebaseio.com",  // → REACT_APP_FIREBASE_DATABASE_URL
  projectId: "project-id",        // → REACT_APP_FIREBASE_PROJECT_ID
  storageBucket: "project.appspot.com",  // → REACT_APP_FIREBASE_STORAGE_BUCKET
  messagingSenderId: "123456789",  // → REACT_APP_FIREBASE_MESSAGING_SENDER_ID
  appId: "1:123456789:web:abc123"  // → REACT_APP_FIREBASE_APP_ID
};
```

---

## How to Get Google Maps API Key

### Step-by-Step Guide

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Library**
4. Search for **Maps JavaScript API** and enable it
5. Go to **APIs & Services** → **Credentials**
6. Click **Create Credentials** → **API Key**
7. Copy the API key to your `.env` file

### API Key Restrictions (Recommended for Production)

For security, restrict your API key:

1. In Google Cloud Console, find your API key
2. Click **Edit**
3. Under **Application restrictions**, choose:
   - **HTTP referrers** for web apps
   - Add your domain(s): `localhost:3000/*` for development, your production domain for production
4. Under **API restrictions**, select **Restrict key** and choose **Maps JavaScript API**

---

## Emulator Flags Explained

### When to Use Emulators

| Environment | `REACT_APP_USE_FUNCTIONS_EMULATOR` | Behavior |
|-------------|-----------------------------------|----------|
| Local development | `true` | Function calls go to local emulator at `localhost:5001` |
| Production | `false` | Function calls go to Firebase Cloud Functions |

### How Emulator Detection Works

In `src/firebase.js`, the app checks:

```javascript
// Simplified logic
if (process.env.NODE_ENV === 'development' || 
    process.env.REACT_APP_USE_FUNCTIONS_EMULATOR === 'true') {
  functions.useEmulator('localhost', 5001);
}
```

This means:
- In development mode, emulators are used by default
- Setting `REACT_APP_USE_FUNCTIONS_EMULATOR=false` forces production functions even in development

---

## Security Best Practices

### Do's ✅

| Practice | Why |
|----------|-----|
| Add `.env` to `.gitignore` | Prevents secrets from being committed to version control |
| Use `.env.example` as a template | Shows what variables are needed without exposing values |
| Use different API keys for dev/prod | Limits exposure if one key is compromised |
| Restrict API keys by domain | Prevents unauthorized use of your keys |

### Don'ts ❌

| Practice | Risk |
|----------|------|
| Committing `.env` to git | Exposes secrets to anyone with repository access |
| Hardcoding values in code | Makes it hard to change and exposes secrets |
| Using production keys in development | Accidental data corruption in production |
| Sharing API keys publicly | Unauthorized usage and potential charges |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `auth/invalid-api-key` | Verify Firebase API key is correct in `.env` |
| Map not loading | Check Google Maps API key is set and valid |
| Functions not working locally | Ensure emulator is running and `REACT_APP_USE_FUNCTIONS_EMULATOR=true` |
| Changes not taking effect | Restart the dev server after editing `.env` |

---

## Related Documentation

- `docs/02-getting-started-local.md` - Setting up the project
- `docs/11-deploy-and-emulator-runbook.md` - Running emulators and deploying

