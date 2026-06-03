# Troubleshooting

This document covers common problems you might encounter and how to solve them.

---

## Authentication Issues

### `auth/invalid-api-key`

**What it means:** The Firebase API key in your configuration is missing or incorrect.

**Symptoms:**
- App fails to initialize
- Login fails immediately
- Console shows "Invalid API key" error

**Solutions:**

1. Check your `.env` file exists:
   ```bash
   # Should show the file contents
   cat .env
   ```

2. Verify the API key value:
   - Go to Firebase Console → Project Settings → General
   - Find your app and copy the `apiKey` value
   - Ensure it matches `REACT_APP_FIREBASE_API_KEY` in `.env`

3. Restart the dev server after changing `.env`:
   ```bash
   # Stop the server (Ctrl+C)
   npm start
   ```

---

### `auth/configuration-not-found`

**What it means:** Email/Password authentication is not enabled in Firebase.

**Symptoms:**
- Login/signup fails with "configuration-not-found"
- No users can sign in

**Solution:**

1. Go to Firebase Console
2. Navigate to **Authentication** → **Sign-in method**
3. Click on **Email/Password**
4. Toggle to **Enable**
5. Click **Save**

---

### `auth/user-not-found` or `auth/wrong-password`

**What it means:** The email or password is incorrect.

**Symptoms:**
- Login fails with specific error message

**Solutions:**

1. Verify the email is correct
2. Check if the user exists in Firebase Console → Authentication → Users
3. If password is forgotten, implement password reset or create a new user

---

## Emulator Issues

### CORS Errors on Callable Endpoints

**What it means:** The browser is blocking requests to the local function endpoint.

**Symptoms:**
- Functions fail with CORS error in console
- "Network error" when calling functions

**Solutions:**

1. Ensure emulator is configured in your app:
   ```javascript
   // src/firebase.js
   if (process.env.REACT_APP_USE_FUNCTIONS_EMULATOR === 'true') {
     connectFunctionsEmulator(functions, 'localhost', 5001);
   }
   ```

2. Check `.env` settings:
   ```env
   REACT_APP_USE_FUNCTIONS_EMULATOR=true
   REACT_APP_FUNCTIONS_EMULATOR_HOST=localhost
   REACT_APP_FUNCTIONS_EMULATOR_PORT=5001
   ```

3. Restart emulators after function code changes:
   ```bash
   # Stop emulators (Ctrl+C)
   npm run firebase:emulators
   ```

4. Use the callable SDK (`httpsCallable`) instead of manual fetch

---

### Emulator Port Already in Use

**What it means:** Another process is using the emulator port.

**Symptoms:**
- Emulator fails to start
- "Port 5001 is already in use" error

**Solutions:**

1. Find and kill the process:
   ```bash
   # Find process using port 5001
   lsof -i :5001        # Mac/Linux
   netstat -ano | findstr :5001  # Windows
   
   # Kill the process
   kill -9 <PID>        # Mac/Linux
   taskkill /PID <PID> /F  # Windows
   ```

2. Or change the port in `firebase.json`:
   ```json
   {
     "emulators": {
       "functions": { "port": 5002 }
     }
   }
   ```

---

### Functions Not Updating

**What it means:** Code changes to functions aren't reflected.

**Solutions:**

1. Restart the emulators after changing function code
2. Clear the functions cache:
   ```bash
   rm -rf functions/node_modules/.cache
   npm run firebase:emulators
   ```

---

## Permission Issues

### `Missing or insufficient permissions`

**What it means:** Firestore security rules blocked the request.

**Symptoms:**
- Data fails to load
- Writes fail silently or with error
- Console shows "permission-denied"

**Common Causes and Solutions:**

| Cause | Solution |
|-------|----------|
| User not logged in | Ensure user is authenticated before accessing data |
| Wrong role | Check `users/{uid}` has correct `role` field |
| User is inactive | Check `users/{uid}` has `status: "active"` |
| Operator not assigned | Check operator's `assignedParkingIds` includes the parking |
| Direct write attempt | Use Cloud Functions for writes to protected collections |

**Debugging Steps:**

1. Check user profile in Firestore:
   ```javascript
   // In browser console
   const uid = auth.currentUser.uid;
   const doc = await firebase.firestore().collection('users').doc(uid).get();
   console.log(doc.data());
   ```

2. Verify the fields:
   - `role` should be one of: `admin`, `owner`, `operator`, `driver`
   - `status` should be `active`
   - `assignedParkingIds` should include relevant parking IDs (for operators)

3. Check Firestore rules in `firestore.rules`:
   ```
   // Are you trying to read/write a protected collection?
   // Protected collections require Cloud Functions for writes
   ```

---

## App Loading Issues

### App Stuck on Loading After Login

**What it means:** The app is waiting for user profile data.

**Symptoms:**
- Login succeeds but app doesn't proceed
- Loading spinner never goes away

**Solutions:**

1. Check if user profile exists:
   - Go to Firebase Console → Firestore
   - Look for `users/{uid}` document
   - If missing, create it with required fields

2. Check browser console for errors:
   - Open DevTools (F12)
   - Look for red error messages

3. The app has a timeout fallback - wait 10 seconds
   - If still stuck, check network tab for failed requests

---

### White Screen on App Load

**What it means:** JavaScript error preventing render.

**Solutions:**

1. Check browser console for errors
2. Verify all environment variables are set
3. Try clearing browser cache and hard refresh (Ctrl+Shift+R)
4. Check if build succeeded:
   ```bash
   npm run build
   ```

---

## Payment Issues

### Pending Payment Not Appearing for Operator

**What it means:** The payment request isn't visible in the operator's queue.

**Possible Causes:**

| Cause | Check |
|-------|-------|
| Wrong parking selected | Operator should select the correct parking |
| Operator not assigned | Check `assignedParkingIds` in operator's profile |
| Request already processed | Check `paymentRequests` document status |
| Real-time listener issue | Refresh the page |

**Debugging:**

1. Check the payment request document:
   ```javascript
   // In Firebase Console or Emulator UI
   // Look at paymentRequests/{requestId}
   // Verify: parkingId, status: "pending"
   ```

2. Check operator's assignments:
   ```javascript
   // users/{operatorUid}
   { assignedParkingIds: ["parking1", "parking2"] }
   ```

3. Verify parking IDs match

---

### Payment Submission Fails

**What it means:** Driver can't submit payment request.

**Possible Causes:**

| Cause | Solution |
|-------|----------|
| No active session | Ensure vehicle is checked in |
| Payment already pending | Wait for operator to confirm/reject |
| Missing required fields | Fill in all required form fields |

---

## Map Issues

### Map Not Loading

**What it means:** Google Maps failed to initialize.

**Symptoms:**
- Map area is blank or shows error
- Console shows Google Maps errors

**Solutions:**

1. Check API key is set:
   ```bash
   # In .env
   REACT_APP_GOOGLE_MAPS_API_KEY=your_key_here
   ```

2. Verify API key is valid:
   - Go to Google Cloud Console
   - Navigate to APIs & Services → Credentials
   - Check if key exists and is not restricted incorrectly

3. Enable required APIs:
   - In Google Cloud Console → Library
   - Enable **Maps JavaScript API**

4. Check HTTP referrer restrictions:
   - For development, add `localhost:3000/*`
   - For production, add your domain

---

## Build Issues

### Build Fails with Errors

**Solutions:**

1. Check for syntax errors:
   ```bash
   npm run lint
   ```

2. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules
   rm package-lock.json
   npm install
   ```

3. Check for TypeScript errors (if using TypeScript):
   ```bash
   npx tsc --noEmit
   ```

---

### Lint Errors

**Solutions:**

1. Run lint to see errors:
   ```bash
   npm run lint
   ```

2. Auto-fix what's possible:
   ```bash
   npm run lint -- --fix
   ```

3. Manually fix remaining issues

---

## Deployment Issues

### Deployment Fails

**Common Causes:**

| Error | Solution |
|-------|----------|
| "Permission denied" | Ensure you have access to the Firebase project |
| "Quota exceeded" | Check Firebase billing and quotas |
| "Function deployment error" | Check function logs for details |
| "Rules validation failed" | Fix syntax in `firestore.rules` |

**Debugging:**

1. Try dry-run first:
   ```bash
   firebase deploy --dry-run
   ```

2. Check function logs:
   ```bash
   firebase functions:log
   ```

3. Verify Firebase CLI is logged in:
   ```bash
   firebase login
   ```

---

## Performance Issues

### App Runs Slowly

**Possible Causes:**

| Cause | Solution |
|-------|----------|
| Too many real-time listeners | Reduce number of active listeners |
| Large data queries | Add pagination or limit queries |
| Unoptimized re-renders | Use React.memo, useMemo, useCallback |
| Large bundle size | Code splitting, lazy loading |

---

### Functions Run Slowly

**Possible Causes:**

| Cause | Solution |
|-------|----------|
| Cold starts | Expected for infrequently called functions |
| Inefficient queries | Add indexes, optimize queries |
| Large data processing | Batch operations, use pagination |

---

## Getting Help

### Before Asking for Help

1. Check this troubleshooting guide
2. Search for the error message online
3. Check browser console for errors
4. Check Firebase Console for errors
5. Try to reproduce the issue consistently

### Information to Provide

When asking for help, include:

- Error message (exact text)
- Steps to reproduce
- Browser and version
- Node.js version
- What you've already tried
- Relevant code snippets
- Console logs (redacted of sensitive info)

---

## Related Documentation

- `docs/02-getting-started-local.md` - Setting up the project
- `docs/03-environment-variables.md` - Configuration
- `docs/11-deploy-and-emulator-runbook.md` - Running and deploying