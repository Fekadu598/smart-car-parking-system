# ENDERASE MVP Technical Architecture Plan

## 1. Goal

This document turns the product guideline into a more technical MVP implementation plan for a parking management system built with React and Firebase.

The MVP should support:

- driver parking discovery
- slot availability visibility
- pre-booking / reservation
- operator check-in and check-out
- parking fee calculation
- owner revenue visibility
- admin onboarding and oversight

This plan assumes there is already a rough implementation using **Create React App + Firebase**.

---

## 2. Technical direction

## Current assumption
- Frontend: React (currently CRA)
- Backend platform: Firebase
- Database: Cloud Firestore
- Auth: Firebase Authentication
- Storage: Firebase Storage
- Maps: Google Maps API

## Recommendation
Keep the current CRA codebase for MVP delivery, but avoid heavy long-term investment in CRA-specific tooling. After MVP stabilization, migrate to **Vite**.

For MVP, prioritize:
- stable role-based flows
- simple data model
- secure writes
- real-time slot updates
- minimal operator friction

---

## 3. High-level system architecture

```text
Client (React App)
  |- Driver app/pages
  |- Operator dashboard
  |- Owner dashboard
  |- Admin dashboard

Firebase Services
  |- Firebase Auth
  |- Cloud Firestore
  |- Cloud Functions
  |- Firebase Storage
  |- Firebase Hosting

External services
  |- Google Maps API
  |- Telebirr (later)
  |- CBE Birr (later)
```

### Responsibility split

### React app
Responsible for:
- UI rendering
- forms
- routing
- role-based screens
- subscriptions to Firestore documents
- invoking Cloud Functions
- showing live status and reports

### Firestore
Responsible for:
- source of truth for app data
- realtime updates
- persistent state for bookings, sessions, and payments

### Cloud Functions
Responsible for:
- trusted business logic
- booking transactions
- fee calculation
- revenue split
- slot counter integrity
- payment verification callbacks
- expiry handling

---

## 4. Role model

Use Firebase Auth for identity and Firestore user documents for role metadata.

### Roles
- `admin`
- `owner`
- `operator`
- `driver`

### User document shape

```json
/users/{uid}
{
  "fullName": "string",
  "email": "string",
  "phone": "string",
  "role": "admin | owner | operator | driver",
  "ownerId": "string | null",
  "assignedParkingIds": ["parkingId1", "parkingId2"],
  "status": "active | suspended",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Notes
- `ownerId` is used when the user is a parking owner.
- `assignedParkingIds` is used for operators.
- drivers usually do not need owner linkage.

---

## 5. Firestore data model

Keep the schema flat and query-friendly.

## 5.1 `owners`

```json
/owners/{ownerId}
{
  "userId": "uid",
  "fullName": "string",
  "email": "string",
  "phone": "string",
  "photoUrl": "string",
  "fanNumber": "string",
  "bankAccountNumber": "string",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "status": "active"
}
```

## 5.2 `parkings`

```json
/parkings/{parkingId}
{
  "ownerId": "ownerId",
  "name": "Bole Parking Center",
  "address": "string",
  "location": {
    "lat": 8.99,
    "lng": 38.79
  },
  "slotCapacity": 50,
  "availableSlots": 45,
  "reservedSlots": 2,
  "occupiedSlots": 3,
  "hourlyRate": 50,
  "status": "active | inactive",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Counter invariant
At all times:

```text
availableSlots + reservedSlots + occupiedSlots = slotCapacity
```

This invariant should be protected by Cloud Functions and validated in tests.

## 5.3 `operators` (optional)
If you want a separate operator collection:

```json
/operators/{operatorId}
{
  "userId": "uid",
  "assignedParkingIds": ["parking_1"],
  "createdAt": "timestamp",
  "status": "active"
}
```

This can also be skipped if operator metadata lives only in `/users`.

## 5.4 `bookings`

```json
/bookings/{bookingId}
{
  "parkingId": "parkingId",
  "driverId": "uid",
  "plateNumber": "AA12345",
  "status": "reserved | expired | verified | checked_in | cancelled | completed",
  "reservedAt": "timestamp",
  "expiresAt": "timestamp",
  "verifiedAt": null,
  "checkInAt": null,
  "checkOutAt": null,
  "estimatedRate": 50,
  "paymentStatus": "pending | paid | failed",
  "source": "app",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 5.5 `sessions`

A parking session represents actual usage after entry.

```json
/sessions/{sessionId}
{
  "parkingId": "parkingId",
  "bookingId": "bookingId | null",
  "driverId": "uid | null",
  "plateNumber": "AA12345",
  "entryTime": "timestamp",
  "exitTime": null,
  "durationMinutes": null,
  "hourlyRate": 50,
  "feeAmount": null,
  "paymentStatus": "pending | confirmed",
  "paymentMethod": "manual | telebirr | cbebirr | null",
  "checkedInBy": "uid",
  "checkedOutBy": null,
  "status": "active | completed",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Why `sessions` is separate from `bookings`
Because:
- not every parking use must come from a reservation
- operators may create walk-in sessions
- bookings can expire without becoming sessions
- payments attach more naturally to actual stays

## 5.6 `payments`

```json
/payments/{paymentId}
{
  "sessionId": "sessionId",
  "bookingId": "bookingId | null",
  "parkingId": "parkingId",
  "ownerId": "ownerId",
  "grossAmount": 150,
  "platformCommission": 15,
  "ownerAmount": 135,
  "method": "manual | telebirr | cbebirr",
  "providerReference": "string | null",
  "status": "pending | confirmed | failed | refunded",
  "paidAt": "timestamp",
  "confirmedBy": "uid | null",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 5.7 `auditLogs` (recommended)

```json
/auditLogs/{logId}
{
  "actorUid": "uid",
  "actorRole": "operator",
  "action": "CHECK_IN",
  "targetType": "session",
  "targetId": "sessionId",
  "parkingId": "parkingId",
  "metadata": {
    "plateNumber": "AA12345"
  },
  "createdAt": "timestamp"
}
```

Use this for debugging and trust.

## 5.8 `dailyReports` (derived)

```json
/dailyReports/{parkingId_yyyy_mm_dd}
{
  "parkingId": "parkingId",
  "ownerId": "ownerId",
  "dateKey": "2026-04-07",
  "totalSessions": 20,
  "grossRevenue": 3000,
  "ownerRevenue": 2700,
  "platformRevenue": 300,
  "reservedCount": 8,
  "walkInCount": 12,
  "updatedAt": "timestamp"
}
```

These documents can be generated by Cloud Functions.

---

## 6. Suggested indexes

Because Firestore query performance depends on indexes, define these early.

### Single-purpose query examples
- bookings by parking + status + expiresAt
- bookings by plate + parking + status
- sessions by parking + status
- sessions by plate + status
- payments by owner + status + paidAt
- parkings by status

### Likely composite indexes
- `bookings(parkingId ASC, status ASC, expiresAt ASC)`
- `bookings(parkingId ASC, plateNumber ASC, status ASC)`
- `sessions(parkingId ASC, status ASC, entryTime DESC)`
- `sessions(plateNumber ASC, status ASC)`
- `payments(ownerId ASC, paidAt DESC)`
- `payments(parkingId ASC, paidAt DESC)`

---

## 7. Frontend project structure

Move to feature-based organization.

```text
src/
  app/
    router.tsx
    providers.tsx
    auth-context.tsx
    role-guard.tsx

  components/
    layout/
    ui/
    forms/
    tables/
    maps/

  features/
    auth/
      pages/
      hooks/
      services/
    driver/
      pages/
      components/
      services/
    operator/
      pages/
      components/
      services/
    owner/
      pages/
      components/
      services/
    admin/
      pages/
      components/
      services/
    bookings/
      api/
      hooks/
      utils/
    sessions/
      api/
      hooks/
      utils/
    payments/
      api/
      hooks/
      utils/
    parkings/
      api/
      hooks/
      utils/

  services/
    firebase/
      app.ts
      auth.ts
      firestore.ts
      functions.ts
      storage.ts
    maps/
      googleMaps.ts

  lib/
    constants/
    validation/
    formatters/
    date/
    money/

  types/
```

### Design rule
- UI components stay dumb where possible
- feature hooks encapsulate data fetching and mutation
- Cloud Function invocation wrappers live in `services/firebase/functions.ts`
- validation schemas live in `lib/validation`

---

## 8. Routing model

Use protected routes by role.

### Route map
- `/login`
- `/driver/map`
- `/driver/bookings`
- `/operator/check-in`
- `/operator/check-out`
- `/operator/live-status`
- `/owner/dashboard`
- `/owner/revenue`
- `/admin/dashboard`
- `/admin/owners`
- `/admin/parkings`
- `/admin/operators`

### Guard model
- unauthenticated users redirected to `/login`
- authenticated users redirected by role to role home
- each role can only access its own route group

---

## 9. State management strategy

For MVP, avoid overengineering.

### Recommended
- local React state for form state
- React Context for auth/session
- Firestore listeners for live entities
- optional TanStack Query for function-backed queries and mutation lifecycle

### Avoid initially
- Redux unless complexity grows
- global state for all server data

---

## 10. Cloud Functions surface

Use callable functions or HTTPS functions for all sensitive workflows.

## 10.1 `createBooking`
### Input
```json
{
  "parkingId": "parkingId",
  "plateNumber": "AA12345"
}
```

### Output
```json
{
  "bookingId": "bookingId",
  "status": "reserved",
  "expiresAt": "timestamp"
}
```

### Responsibilities
- validate authenticated driver
- validate parking exists and active
- check `availableSlots > 0`
- create booking
- decrement `availableSlots`
- increment `reservedSlots`
- set `expiresAt`
- write audit log

## 10.2 `expireBooking`
Triggered by:
- scheduled function
- or lazy-expiry on read / operator lookup

### Responsibilities
- find expired bookings with `status = reserved`
- set booking status to `expired`
- decrement `reservedSlots`
- increment `availableSlots`
- write audit log

## 10.3 `checkInVehicle`
### Input
```json
{
  "parkingId": "parkingId",
  "plateNumber": "AA12345"
}
```

### Responsibilities
- validate operator assignment
- lookup valid booking, if present
- support walk-in flow if no booking
- create session
- if reservation exists:
  - mark booking `checked_in`
  - decrement `reservedSlots`
  - increment `occupiedSlots`
- if walk-in:
  - decrement `availableSlots`
  - increment `occupiedSlots`
- write audit log

## 10.4 `checkOutVehicle`
### Input
```json
{
  "parkingId": "parkingId",
  "plateNumber": "AA12345",
  "paymentMethod": "manual"
}
```

### Responsibilities
- find active session
- compute duration
- compute fee
- create payment record
- mark session completed
- decrement `occupiedSlots`
- increment `availableSlots`
- set payment status
- write audit log

## 10.5 `confirmPayment`
For later digital payment or delayed confirmation.

## 10.6 `createParking`
Admin-only creation of new parking sites.

## 10.7 `registerOwner`
Admin-only onboarding helper.

## 10.8 `assignOperator`
Admin-only operator assignment.

---

## 11. Transaction and consistency strategy

All slot-count-changing operations should happen in **Firestore transactions**.

### Transaction-required workflows
- booking creation
- booking expiry
- operator check-in
- operator check-out
- walk-in entry
- cancellation

### Rules
- never update slot counters directly from the client
- all counter mutations must go through Cloud Functions
- client reads are realtime; client writes for protected workflows are function calls only

---

## 12. Fee calculation model

Keep fee logic simple for MVP.

### Suggested rule
- `hourlyRate = 50`
- duration is rounded up to the nearest billing hour

### Example
- 0 to 60 min = 50
- 61 to 120 min = 100

### Utility
```ts
const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
const feeAmount = billedHours * hourlyRate;
```

### Store both
- raw duration minutes
- billed hours
- final fee amount

This allows later pricing changes without losing operational detail.

---

## 13. Security architecture

## 13.1 Auth
Use Firebase Auth with:
- email/password for admin, owner, operator
- email/password or phone auth for driver

## 13.2 Authorization source
Two options:

### Option A: Firestore role doc
- store role on `/users/{uid}`
- read role in client and in rules

### Option B: Firebase custom claims
- role mirrored in Auth token
- better for rules and sensitive checks
- more setup

### MVP recommendation
Start with Firestore user doc, then move critical role checks to custom claims when app grows.

## 13.3 Security rules philosophy
- client can read only what they need
- client cannot mutate financial or counter-sensitive data directly
- client can only update own profile fields
- drivers can only read their own bookings
- owners can only read parkings and reports they own
- operators can only read / act within assigned parkings
- admin has full control

---

## 14. Firestore Security Rules draft

This is a conceptual draft, not final production rules.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function userDoc() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function userRole() {
      return userDoc().data.role;
    }

    function isAdmin() {
      return isSignedIn() && userRole() == 'admin';
    }

    function isOwner() {
      return isSignedIn() && userRole() == 'owner';
    }

    function isOperator() {
      return isSignedIn() && userRole() == 'operator';
    }

    function isDriver() {
      return isSignedIn() && userRole() == 'driver';
    }

    match /users/{uid} {
      allow read: if isSignedIn() && request.auth.uid == uid;
      allow update: if isSignedIn() && request.auth.uid == uid;
      allow create: if isAdmin();
      allow delete: if false;
    }

    match /parkings/{parkingId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /owners/{ownerId} {
      allow read: if isAdmin() || isOwner();
      allow write: if isAdmin();
    }

    match /bookings/{bookingId} {
      allow read: if isAdmin()
                  || (isDriver() && resource.data.driverId == request.auth.uid)
                  || isOperator()
                  || isOwner();
      allow create: if false;
      allow update: if false;
      allow delete: if false;
    }

    match /sessions/{sessionId} {
      allow read: if isAdmin() || isOperator() || isOwner();
      allow write: if false;
    }

    match /payments/{paymentId} {
      allow read: if isAdmin() || isOwner();
      allow write: if false;
    }

    match /auditLogs/{logId} {
      allow read: if isAdmin();
      allow write: if false;
    }

    match /dailyReports/{reportId} {
      allow read: if isAdmin() || isOwner();
      allow write: if false;
    }
  }
}
```

### Important note
For MVP safety, direct writes to bookings, sessions, and payments are disabled from clients. Those writes should happen via Cloud Functions using admin privileges.

---

## 15. Validation layer

Use shared validation rules in:
- frontend forms
- Cloud Functions

Suggested validation rules:
- plate number required and normalized
- parkingId required
- slotCapacity must be positive integer
- hourlyRate must be positive
- payment amount cannot be negative
- status must be enum value
- lat/lng must be valid numeric coordinates

Recommend using:
- Zod or Yup in frontend
- same logic mirrored in Cloud Functions

---

## 16. Booking lifecycle

```text
reserved
  -> checked_in
  -> completed

reserved
  -> expired

reserved
  -> cancelled
```

### Reservation expiry policy
For MVP:
- reservation valid for 15 minutes
- if not checked in by then, auto-expire
- slot returns to available pool

### Anti-abuse suggestions
Later you can add:
- one active reservation per driver
- one active reservation per plate number
- booking cooldown after repeated no-shows

---

## 17. Session lifecycle

```text
active
  -> completed
```

### Session sources
- reservation-derived session
- walk-in session

### Walk-in flow
Operator can create session even without booking:
- validate parking has available capacity
- create session
- decrement available
- increment occupied

This is important for real-world usability.

---

## 18. Reporting design

## Owner dashboard
Minimum cards:
- current available slots
- current occupied slots
- today's total sessions
- today's gross revenue
- today's owner revenue
- weekly gross revenue

## Admin dashboard
Minimum cards:
- total parkings
- total owners
- total operators
- total gross revenue
- total platform commission

## Operator screen
Minimum widgets:
- live slot counts
- active sessions list
- booking lookup by plate
- recent completed checkouts

### Reporting strategy
For rough MVP, start with:
- direct queries for small datasets
- daily summaries via Cloud Functions when volume grows

---

## 19. Payment integration strategy

## Phase 1: manual confirmation
Fastest path:
- operator receives payment
- operator confirms payment method
- system writes payment record
- session closes

## Phase 2: provider integration
- driver pays digitally
- payment provider sends callback to HTTPS Cloud Function
- function verifies signature / reference
- system confirms payment
- audit log created

### Recommendation
Do not block initial MVP on full payment automation.

---

## 20. Logging and observability

Minimum logging stack for MVP:
- Cloud Function structured logs
- `auditLogs` collection for critical business actions
- frontend error boundary
- Firebase Crashlytics only if mobile client appears later

### Log all critical operations
- booking creation
- booking expiry
- check-in
- check-out
- payment confirmation
- owner creation
- parking creation
- operator assignment

---

## 21. Testing strategy

## Unit tests
Test:
- fee calculation
- duration rounding
- revenue split
- validation
- slot counter helpers

## Integration tests
Test:
- booking creation transaction
- booking expiry rollback
- check-in updates
- check-out updates
- walk-in flow
- auth guard behavior

## Manual test matrix
Create seed users for:
- admin
- owner
- operator
- driver

Manual scenarios:
- reserve last slot
- reserve with no slots
- expire reservation
- check in booked user
- check in walk-in user
- check out active session
- view owner dashboard
- view admin commission

---

## 22. Seed data plan

Create these initial seeds:
- 1 admin
- 2 owners
- 3 operators
- 3 parking sites
- 5 drivers
- sample bookings
- sample completed sessions
- sample payments

This makes dashboard and flow testing much easier.

---

## 23. Deployment environments

Use at least two Firebase projects:

- `enderase-dev`
- `enderase-prod`

If possible, also add:
- `enderase-staging`

### Environment variables
Keep these in environment config:
- Firebase config
- Google Maps API key
- payment provider keys
- function secrets
- webhook secrets

Never hardcode secrets in React source.

---

## 24. Implementation phases

## Phase 1: stabilize current codebase
- clean folder structure
- add route guards
- isolate Firebase service wrappers
- remove business logic from UI components

## Phase 2: core schema and auth
- create users
- create owners
- create parkings
- set up Firestore indexes
- implement login and role redirects

## Phase 3: booking flow
- driver map page
- parking detail page
- reserve slot function
- booking expiry mechanism

## Phase 4: operator flow
- plate lookup
- check-in function
- walk-in session creation
- check-out function
- fee calculation

## Phase 5: dashboards
- owner cards and revenue table
- admin overview
- operator live board

## Phase 6: security hardening
- Firestore rules
- remove direct sensitive client writes
- audit logs
- function validation

## Phase 7: launch prep
- seed data
- QA matrix
- deploy to staging
- operator acceptance testing

---

## 25. Concrete engineering backlog

## Backend / Firebase
- [ ] initialize Firebase projects
- [ ] define Firestore collections
- [ ] create indexes
- [ ] write `createBooking` function
- [ ] write `expireBooking` function
- [ ] write `checkInVehicle` function
- [ ] write `checkOutVehicle` function
- [ ] write `createParking` function
- [ ] write `registerOwner` function
- [ ] write `assignOperator` function
- [ ] write security rules
- [ ] add audit logging

## Frontend
- [ ] implement auth pages
- [ ] implement role-aware router
- [ ] build driver map page
- [ ] build parking detail page
- [ ] build booking status page
- [ ] build operator check-in page
- [ ] build operator check-out page
- [ ] build owner dashboard
- [ ] build admin dashboard
- [ ] add shared loading / empty / error states

## QA
- [ ] create seed data
- [ ] write core unit tests
- [ ] run manual operator workflow test
- [ ] validate slot counter invariants
- [ ] validate permissions by role

---

## 26. Recommended next technical documents

After this plan, the next documents to produce are:

1. Firestore schema reference
2. Cloud Functions API contract
3. Firestore Security Rules final draft
4. screen-by-screen UI spec
5. QA test cases
6. Vite migration plan for post-MVP cleanup

---

## 27. Final recommendation

For this MVP, the strongest architecture is:

- React frontend with role-based routing
- Firebase Auth for identity
- Firestore as the realtime operational database
- Cloud Functions for all protected workflows
- aggregate slot counters on parking docs
- separate `bookings`, `sessions`, and `payments` collections
- strict Firestore security rules
- manual payment confirmation first, digital integration later

This keeps the system simple enough to ship, but structured enough that you can scale it into a more production-ready platform later.
