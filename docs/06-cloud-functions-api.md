# Cloud Functions API Reference

This document provides a comprehensive reference for all Cloud Functions used in the Enderase Smart Parking platform.

## What Are Cloud Functions?

Cloud Functions are pieces of backend code that run on Google's servers in response to events. In this project, they handle all business-critical operations like creating bookings, processing payments, and managing users.

### Why Use Cloud Functions?

| Benefit | Explanation |
|---------|-------------|
| **Security** | Sensitive operations run on the server, not in the browser |
| **Consistency** | Business logic is centralized and cannot be bypassed |
| **Atomicity** | Database updates happen transactionally |
| **Auditability** | All actions can be logged for accountability |

### Types of Functions

| Type | Trigger | Use Case |
|------|---------|----------|
| **Callable** | Called directly from the app | User actions like booking, payment |
| **Scheduled** | Runs automatically on a schedule | Cleanup tasks like expiring bookings |

---

## Function Location

| Property | Value |
|----------|-------|
| **Source File** | `functions/index.js` |
| **Region** | `us-central1` |
| **Runtime** | Node.js 18+ |

---

## Booking + Session Functions

### `createBooking`

Creates a new parking reservation for a driver.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Driver |
| **Purpose** | Reserve a parking slot before arrival |

#### Parameters

```javascript
{
  parkingId: "parking123",    // Required: Which parking to book
  plateNumber: "AA-1234-B"   // Required: Vehicle plate number
}
```

#### What It Does

1. Validates the driver has an active account
2. Checks parking has available slots
3. Creates a booking document with status `reserved`
4. Increments `reservedSlots` and decrements `availableSlots` transactionally
5. Sets booking to expire in 30 minutes

#### Returns

```javascript
{
  bookingId: "booking789",
  status: "reserved",
  expiresAt: timestamp
}
```

#### Errors

| Error | Cause |
|-------|-------|
| `permission-denied` | User is not a driver |
| `failed-precondition` | No available slots |
| `invalid-argument` | Missing parkingId or plateNumber |

---

### `expireBookings`

Automatically expires stale reservations and restores slot counters.

| Property | Value |
|----------|-------|
| **Type** | Scheduled |
| **Schedule** | Every 1 minute |
| **Trigger** | Automatic (no user action) |

#### What It Does

1. Finds all bookings with `status: "reserved"` and `expiresAt < now`
2. Updates each booking to `status: "expired"`
3. Decrements `reservedSlots` and increments `availableSlots`
4. Logs expiration to audit logs

#### Why This Matters

Without this function:
- Expired bookings would keep slots reserved
- Available slots would decrease over time
- Parking capacity would be artificially reduced

---

### `checkInVehicle`

Checks in a vehicle (either a booking or walk-in).

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator |
| **Purpose** | Start a parking session when vehicle arrives |

#### Parameters

```javascript
{
  parkingId: "parking123",       // Required: Which parking
  plateNumber: "AA-1234-B",      // Required: Vehicle plate number
  allowWalkIn: true              // Optional: Allow walk-ins without booking
}
```

#### What It Does

1. Validates operator is assigned to the parking
2. Checks for existing booking with matching plate
3. If booking exists:
   - Updates booking to `status: "checked_in"`
   - Decrements `reservedSlots`, increments `occupiedSlots`
4. If no booking and `allowWalkIn: true`:
   - Creates a walk-in session directly
   - Increments `occupiedSlots`, decrements `availableSlots`
5. Creates a new session document with `status: "active"`

#### Returns

```javascript
{
  sessionId: "session123",
  bookingId: "booking789",  // null for walk-ins
  status: "active"
}
```

---

### `checkOutVehicle`

**Note:** This function is intentionally disabled. Check-out happens through the payment confirmation flow instead.

---

## Manual Payment Functions

### `submitManualPayment`

Driver submits a payment for operator review.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Driver |
| **Purpose** | Submit payment proof for parking session |

#### Parameters

```javascript
{
  parkingId: "parking123",       // Required: Which parking
  plateNumber: "AA-1234-B",      // Required: Vehicle plate number
  method: "bank",                // Required: "bank" or "phone"
  referenceCode: "TXN123456"     // Optional: Transaction reference
}
```

#### What It Does

1. Finds the active session for the vehicle
2. Calculates fee: `ceil(durationMinutes / 60) * hourlyRate`
3. Creates a `paymentRequests` document with `status: "pending"`
4. Updates session `paymentStatus: "pending"`
5. Prevents duplicate submissions while request is pending

#### Returns

```javascript
{
  requestId: "request123",
  amountDue: 100,
  billedHours: 2,
  status: "pending"
}
```

---

### `driverCheckOutVehicle`

A wrapper function that calls `submitManualPayment` internally. Used when driver initiates checkout from their app.

---

### `confirmManualPayment`

Operator confirms a payment request, completing the session.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator (assigned to parking) |
| **Purpose** | Approve payment and end session |

#### Parameters

```javascript
{
  requestId: "request123"    // Required: Payment request to confirm
}
```

#### What It Does (Transactionally)

1. Validates operator is assigned to the parking
2. Updates `paymentRequests/{requestId}` to `status: "confirmed"`
3. Updates `sessions/{sessionId}`:
   - `status: "completed"`
   - `paymentStatus: "confirmed"`
   - `exitTime: now`
   - `durationMinutes`, `billedHours`, `feeAmount`
4. Updates `parkings/{parkingId}`:
   - `occupiedSlots--`
   - `availableSlots++`
5. Updates `bookings/{bookingId}` to `status: "completed"` (if linked)
6. Creates `payments/{paymentId}` with commission split:
   - `grossAmount`
   - `ownerAmount` (90%)
   - `platformCommission` (10%)

#### Returns

```javascript
{
  success: true,
  sessionId: "session123",
  paymentId: "payment456"
}
```

---

### `rejectManualPayment`

Operator rejects a payment request.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator (assigned to parking) |
| **Purpose** | Reject invalid payment submission |

#### Parameters

```javascript
{
  requestId: "request123",       // Required: Payment request to reject
  reason: "Invalid reference"    // Optional: Rejection reason
}
```

#### What It Does

1. Updates `paymentRequests/{requestId}` to `status: "rejected"`
2. Records rejection reason and operator who rejected
3. Session remains active (driver must resubmit)

---

### `listPendingPaymentsForDriver`

Lists all pending payment requests for the current driver.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Driver |

#### Returns

```javascript
{
  requests: [
    {
      id: "request123",
      amountDue: 100,
      parkingName: "Bole Mall Parking",
      status: "pending",
      submittedAt: timestamp
    }
  ]
}
```

---

### `listPendingPaymentsForOperator`

Lists pending payment requests for a specific parking.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator |

#### Parameters

```javascript
{
  parkingId: "parking123"    // Required: Which parking to check
}
```

---

### `getPendingPaymentForSession`

Gets the pending payment request for a specific session.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Driver or Operator |

#### Parameters

```javascript
{
  sessionId: "session123"    // Required: Session to check
}
```

---

## QR Check-In Functions

### `createParkingCheckInToken`

Operator generates a QR code for driver check-in.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator |
| **Purpose** | Create a one-time QR token for check-in |

#### Parameters

```javascript
{
  parkingId: "parking123"    // Required: Which parking
}
```

#### What It Does

1. Validates operator is assigned to the parking
2. Creates a `checkInTokens` document with:
   - `status: "active"`
   - `expiresAt: now + 5 minutes`
3. Generates a deep link URL for the QR code

#### Returns

```javascript
{
  token: "abc123",
  deepLink: "https://app.example.com/checkin?token=abc123",
  expiresAt: timestamp
}
```

---

### `confirmCheckInFromQr`

Driver confirms check-in after scanning QR code.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Driver |
| **Purpose** | Submit check-in request from QR scan |

#### Parameters

```javascript
{
  token: "abc123",           // Required: Token from QR code
  plateNumber: "AA-1234-B"   // Required: Vehicle plate number
}
```

#### What It Does

1. Validates token exists and is `active`
2. Checks token hasn't expired
3. Marks token as `used`
4. Creates `checkInRequests` document with `status: "pending"`
5. Notifies operator of pending request (via Firestore listener)

#### Returns

```javascript
{
  requestId: "request123",
  status: "pending",
  message: "Check-in request submitted. Please wait for operator approval."
}
```

---

### `approveCheckInRequest`

Operator approves a QR check-in request.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator |
| **Purpose** | Complete the check-in after driver scans QR |

#### Parameters

```javascript
{
  requestId: "request123"    // Required: Check-in request to approve
}
```

#### What It Does (Transactionally)

1. Validates operator is assigned to the parking
2. Updates `checkInRequests/{requestId}` to `status: "approved"`
3. If linked booking exists:
   - Updates booking to `status: "checked_in"`
   - Decrements `reservedSlots`, increments `occupiedSlots`
4. If no booking (walk-in):
   - Increments `occupiedSlots`, decrements `availableSlots`
5. Creates new session with `status: "active"`

---

### `rejectCheckInRequest`

Operator rejects a QR check-in request.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Operator |

#### Parameters

```javascript
{
  requestId: "request123",       // Required: Check-in request to reject
  reason: "Wrong parking"        // Optional: Rejection reason
}
```

---

## Admin + Owner Management Functions

### `createOwnerAccount`

Admin creates a new owner account.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Admin |

#### Parameters

```javascript
{
  fullName: "John Doe",          // Required
  email: "john@example.com",     // Required
  password: "securePassword",    // Required
  phone: "+251912345678",        // Optional
  bankAccountNumber: "123456789" // Optional
}
```

#### What It Does

1. Creates Firebase Auth account
2. Creates `users/{uid}` with `role: "owner"`
3. Creates `owners/{uid}` with payment details

---

### `upsertParking`

Admin or Owner creates/updates a parking location.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Admin or Owner |

#### Parameters

```javascript
{
  parkingId: "parking123",       // Optional: Provide to update existing
  name: "Bole Mall Parking",
  address: "Bole, Addis Ababa",
  slotCapacity: 50,
  hourlyRate: 50,
  location: { lat: 9.0054, lng: 38.7636 }
}
```

---

### `assignOperatorToParking`

Assign or unassign an operator to a parking.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Owner |

#### Parameters

```javascript
{
  operatorUid: "operator123",    // Required
  parkingId: "parking123",       // Required
  assign: true                   // true to assign, false to unassign
}
```

---

### `ownerCreateOperator`

Owner creates a new operator account.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Owner |

#### Parameters

```javascript
{
  fullName: "Jane Doe",
  email: "jane@example.com",
  password: "securePassword",
  phone: "+251912345678"
}
```

---

### `ownerUpdateOperatorAssignments`

Owner updates which parkings an operator can manage.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Owner |

---

### `ownerSetOperatorStatus`

Owner activates or deactivates an operator.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Owner |

#### Parameters

```javascript
{
  operatorUid: "operator123",
  status: "inactive"    // "active" or "inactive"
}
```

---

### `ownerUpdatePaymentDetails`

Owner updates their payment receiving details.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Owner |

#### Parameters

```javascript
{
  phone: "+251912345678",        // Optional: For mobile money
  bankAccountNumber: "123456789" // Optional: For bank transfer
}
```

---

### `getParkingPaymentDetails`

Get payment details for a parking (shown to drivers during payment).

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Driver |

---

## Analytics Functions

### `getAdminAnalytics`

Get platform-wide analytics for admin dashboard.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Admin |

#### Parameters

```javascript
{
  rangePreset: "7d",     // "7d" or "30d"
  fromMs: 123456789,     // Optional: Custom range start
  toMs: 123456790        // Optional: Custom range end
}
```

#### Returns

```javascript
{
  summary: {
    grossRevenue: 10000,
    ownerRevenue: 9000,
    adminCommission: 1000,
    completedSessions: 200,
    pendingPayments: 5
  },
  revenueTimeSeries: [...],
  paymentMethodBreakdown: { bank: 60, phone: 40 },
  topOwners: [...],
  topParkings: [...]
}
```

---

### `getOwnerAnalytics`

Get analytics for an owner's parkings.

| Property | Value |
|----------|-------|
| **Type** | Callable |
| **Required Role** | Owner |

#### Returns

Similar to admin analytics but filtered to owner's data, plus:
- Per-parking performance
- Owner account details (payment receiving info)

---

## Error Handling

All functions follow consistent error patterns:

| Error Code | Meaning |
|------------|---------|
| `unauthenticated` | User not logged in |
| `permission-denied` | User lacks required role |
| `not-found` | Requested resource doesn't exist |
| `already-exists` | Resource already exists |
| `failed-precondition` | Business rule violation |
| `invalid-argument` | Invalid input parameters |

---

## Related Documentation

- `docs/01-system-architecture.md` - How functions fit into the system
- `docs/07-qr-checkin-flow.md` - QR check-in flow details
- `docs/08-manual-payment-flow.md` - Payment flow details
- `docs/11-deploy-and-emulator-runbook.md` - Deploying functions