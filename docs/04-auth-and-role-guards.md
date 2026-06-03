# Auth and Role Guards

This document explains how user authentication and role-based access control work in the Enderase Smart Parking platform.

## Overview

The platform has four user roles, each with different permissions and access levels:

| Role | Description | Main Capabilities |
|------|-------------|-------------------|
| **Driver** | End users who park their vehicles | Reserve parking, check in via QR, submit payments |
| **Operator** | Parking attendants | Check in vehicles, confirm payments, generate QR codes |
| **Owner** | Parking facility owners | Manage their parkings, view analytics, manage operators |
| **Admin** | Platform administrators | Full system access, manage owners, view all analytics |

---

## Authentication

### How Users Log In

The platform uses **Firebase Email/Password authentication**:

| Page | File | Purpose |
|------|------|---------|
| Login | `src/pages/Login.js` | Existing users sign in with email and password |
| Signup | `src/pages/signup.js` | New users create accounts (becomes driver by default) |

### Authentication Flow

```
User enters credentials → Firebase validates → App receives user object → App fetches user profile → User redirected to role home
```

### Important Notes

- **Signup creates driver accounts only** - Other roles are created by admins/owners
- **Email verification** is not required (can be enabled in Firebase Console)
- **Password reset** is handled by Firebase (not yet implemented in UI)

---

## Canonical User Profile

### Where User Data Lives

When a user signs up or is created, a document is stored in the `users` collection:

**Collection:** `users`  
**Document ID:** The user's Firebase Auth UID

### User Document Structure

```javascript
// users/{uid}
{
  fullName: "John Doe",           // User's full name
  email: "john@example.com",      // Email address
  phone: "+251912345678",         // Phone number (optional)
  role: "driver",                 // One of: admin, owner, operator, driver
  status: "active",               // One of: active, inactive
  ownerId: "owner123",            // For operators: which owner they belong to
  assignedParkingIds: ["parking1", "parking2"]  // For operators: which parkings they manage
}
```

### Field Explanations

| Field | Type | Values | Purpose |
|-------|------|--------|---------|
| `fullName` | string | Any text | Display name throughout the app |
| `email` | string | Valid email | Login identifier and contact |
| `phone` | string | Phone number | Contact for payment coordination |
| `role` | string | `admin`, `owner`, `operator`, `driver` | Determines what user can access |
| `status` | string | `active`, `inactive` | Inactive users cannot log in |
| `ownerId` | string | Owner's UID | Links operators to their employer |
| `assignedParkingIds` | array | Array of parking IDs | Limits operator access to specific locations |

---

## Route Guarding

### What Are Route Guards?

Route guards are components that check if a user is allowed to access a page before showing it. They prevent users from:

- Accessing pages meant for other roles
- Seeing sensitive information
- Performing unauthorized actions

### Where Guards Are Defined

| File | Purpose |
|------|---------|
| `src/App.js` | Main routing configuration with guards |
| `src/app/RoleGuards.js` | Guard components for each role |
| `src/app/roleUtils.js` | Helper functions for role checking |

### Route Categories

| Category | Routes | Who Can Access |
|----------|--------|----------------|
| **Public** | `/login`, `/signup` | Anyone (including non-logged-in users) |
| **Driver** | `/driver/*` | Users with `role: "driver"` |
| **Operator** | `/operator/*` | Users with `role: "operator"` |
| **Owner** | `/owner/*` | Users with `role: "owner"` |
| **Admin** | `/admin/*` | Users with `role: "admin"` |

### How Guards Work

```javascript
// Simplified example from RoleGuards.js
function DriverGuard({ children }) {
  const { user, role, loading } = useAuth();
  
  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" />;
  if (role !== 'driver') return <Navigate to={`/${role}`} />;
  
  return children;
}
```

**What this does:**
1. Wait for authentication to load
2. If no user, redirect to login
3. If user has wrong role, redirect to their correct home
4. If all checks pass, show the protected content

---

## Role Resolution Strategy

### How the App Determines User Role

When a user logs in, the app needs to figure out their role:

```
Auth state changes → App sets user quickly → Fetches users/{uid} → Gets role from profile → Redirects to role home
```

### Step-by-Step Process

1. **Firebase Auth triggers** - When auth state changes (login/logout)
2. **Quick user set** - App sets the Firebase user object immediately to avoid UI deadlock
3. **Profile fetch** - App fetches the user's profile from `users/{uid}`
4. **Timeout protection** - If fetch takes too long, app uses fallback
5. **Role assignment** - App sets the user's role from profile
6. **Status check** - If user is `inactive`, they're signed out

### Fallback Behavior

| Situation | Fallback |
|-----------|----------|
| Profile document doesn't exist | Role defaults to `driver` |
| Profile fetch times out | Role defaults to `driver`, shows warning |
| User status is `inactive` | User is signed out with message |

### Why This Matters

This approach prevents:
- **Infinite loading** - Users always see something, even if profile fetch fails
- **Deadlock** - App doesn't wait forever for profile
- **Security holes** - Invalid/missing profiles get minimal access

---

## Defense in Depth

Security is enforced at multiple levels:

### Level 1: Frontend Guards

**Purpose:** Prevent accidental access to wrong pages

**Example:** A driver trying to navigate to `/admin` is redirected to `/driver`

**Limitation:** Can be bypassed by modifying browser state

### Level 2: Backend Callable Checks

**Purpose:** Verify permissions before performing actions

**Example:**
```javascript
// In a Cloud Function
exports.createBooking = functions.https.onCall(async (data, context) => {
  requireRole(context, 'driver');  // Throws if not driver
  // ... rest of function
});
```

**Benefit:** Cannot be bypassed - runs on the server

### Level 3: Firestore Security Rules

**Purpose:** Block unauthorized database access

**Example:**
```javascript
// In firestore.rules
match /parkings/{parkingId} {
  allow read: if isOwnerOf(resource.data.ownerId) 
              || isAdmin() 
              || isAssignedOperator(resource.data.parkingId);
  allow write: if false;  // All writes through Cloud Functions
}
```

**Benefit:** Last line of defense - even compromised clients can't bypass

### Security Layers Summary

| Layer | Enforced Where | Bypassable? |
|-------|----------------|-------------|
| Frontend guards | Browser | Yes (by modifying client) |
| Callable checks | Cloud Functions | No |
| Firestore rules | Database | No |

---

## Common Scenarios

### Scenario 1: New User Signup

1. User fills out signup form
2. Firebase Auth creates account
3. App creates `users/{uid}` document with `role: "driver"`
4. User is redirected to `/driver`

### Scenario 2: Operator Created by Owner

1. Owner fills out operator creation form
2. `ownerCreateOperator` Cloud Function runs
3. Firebase Auth account created
4. `users/{uid}` created with `role: "operator"`, `ownerId` set
5. New operator can log in

### Scenario 3: User Becomes Inactive

1. Admin sets `status: "inactive"` in user profile
2. User's next action triggers auth check
3. App detects inactive status
4. User is signed out with message

---

## Related Documentation

- `docs/01-system-architecture.md` - Overall system design
- `docs/06-cloud-functions-api.md` - Backend functions for user management
- `docs/05-firestore-data-model.md` - User collection structure