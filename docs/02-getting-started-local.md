# Getting Started Locally

This guide will help you set up the Enderase Smart Parking project on your local machine for development and testing.

## Prerequisites

Before you begin, make sure you have the following installed:

| Requirement | Version | How to Check | How to Install |
|-------------|---------|--------------|----------------|
| **Node.js** | 20+ recommended | Run `node --version` | Download from [nodejs.org](https://nodejs.org) |
| **npm** | Comes with Node.js | Run `npm --version` | Included with Node.js |
| **Firebase CLI** | Latest | Run `firebase --version` | `npm install -g firebase-tools` |
| **Git** | Any recent version | Run `git --version` | Download from [git-scm.com](https://git-scm.com) |

### Firebase Project Access

You need access to the Firebase project `digital-parking-f9d2c`. Contact the project administrator to be added as a contributor.

---

## Step 1: Clone and Install Dependencies

### Clone the Repository

```bash
git clone <repository-url>
cd smart-car-parking-managiment-system/Web\ App
```

### Install Dependencies

The project has two sets of dependencies:

1. **Frontend dependencies** - React app libraries
2. **Functions dependencies** - Cloud Functions libraries

```bash
# Install frontend dependencies
npm install

# Install functions dependencies
cd functions && npm install && cd ..
```

**What this does:**
- `npm install` reads `package.json` and downloads all required libraries to `node_modules/`
- The functions folder has its own `package.json` for backend-specific libraries

---

## Step 2: Configure Environment Variables

### Create Your Environment File

**On Mac/Linux:**
```bash
cp .env.example .env
```

**On Windows PowerShell:**
```powershell
Copy-Item .env.example .env
```

**On Windows Command Prompt:**
```cmd
copy .env.example .env
```

### Fill In Your Environment Variables

Open the `.env` file in your text editor and fill in the values. See `docs/03-environment-variables.md` for detailed explanations of each variable.

**Minimum required values to run the app:**
- Firebase configuration (API key, project ID, etc.)
- Google Maps API key

---

## Step 3: Run the Application

### Start the Development Server

```bash
npm start
```

**What happens:**
1. React starts a development server
2. A browser window opens automatically
3. The app loads at `http://localhost:3000`

**If the browser doesn't open automatically:**
- Open your browser manually
- Navigate to `http://localhost:3000`

### Hot Reloading

The development server supports hot reloading:
- When you save a file, the browser automatically refreshes
- You see changes immediately without restarting the server

---

## Step 4: Run Firebase Emulators (Recommended)

Firebase emulators let you run Firebase services locally without affecting production data.

### Functions Emulator Only

```bash
npm run firebase:emulators
```

**Use this when:** You want to test Cloud Functions locally.

### All Emulators (Functions + Firestore)

```bash
npm run firebase:emulators:all
```

**Use this when:** You want to test both database operations and Cloud Functions locally.

### Emulator UI

When emulators are running, you can access the Emulator UI at:
- `http://localhost:4000` (default)

This gives you a visual interface to:
- View and edit Firestore documents
- See Cloud Functions logs
- Monitor authentication

### Setting Up Emulator Environment

To use emulators, set in your `.env`:
```env
REACT_APP_USE_FUNCTIONS_EMULATOR=true
REACT_APP_FUNCTIONS_EMULATOR_HOST=localhost
REACT_APP_FUNCTIONS_EMULATOR_PORT=5001
```

---

## Step 5: Verify Your Setup

### Run Linting

Check for code quality issues:

```bash
npm run lint
```

### Build for Production

Verify the app builds without errors:

```bash
npm run build
```

**What this does:**
- Creates an optimized production build in the `build/` folder
- Minifies JavaScript and CSS
- Generates hashed filenames for caching

---

## Local Login Flow

### Default User Creation

When you sign up through the app:

| Action | Result |
|--------|--------|
| New user signs up | Creates a **driver** account |
| Email verification | Not required in development |
| Profile creation | Document created in `users/{uid}` |

### Creating Other User Types

Admin, owner, and operator accounts are created differently:

| User Type | How Created |
|-----------|-------------|
| **Admin** | Created directly in Firebase Console or via seed script |
| **Owner** | Created by admin via `createOwnerAccount` function |
| **Operator** | Created by owner via `ownerCreateOperator` function |
| **Driver** | Self-registration through the signup page |

### Test Accounts

For development, you may want to create test accounts:

1. **Seed script approach:** Run `node scripts/seedPhaseAUsers.js` (if available)
2. **Manual approach:** Create users in Firebase Console, then set their role in Firestore

---

## Common Issues

| Problem | Solution |
|---------|----------|
| `EADDRINUSE: address already in use` | Another app is using port 3000. Close it or use `PORT=3001 npm start` |
| `Missing or insufficient permissions` | Check your Firestore rules and user role |
| `Firebase: Error (auth/invalid-api-key)` | Verify your `.env` Firebase configuration |
| Emulators not connecting | Check that `REACT_APP_USE_FUNCTIONS_EMULATOR=true` |

---

## Next Steps

After setting up locally:

1. Read `docs/01-system-architecture.md` to understand the system design
2. Read `docs/05-firestore-data-model.md` to understand the database structure
3. Start the emulators and explore the app with test data

