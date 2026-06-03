# Firestore Data Model

This document describes how data is organized in the Firestore database for the Enderase Smart Parking platform.

## What is Firestore?

Firestore is a NoSQL document database provided by Firebase. Unlike traditional SQL databases:

- Data is stored in **collections** (like tables) containing **documents** (like rows)
- Documents contain **fields** (like columns) with values
- Documents can contain **subcollections** for nested data
- Data is synchronized in real-time to connected clients

### Key Concepts

| Concept | Analogy | Example |
|---------|---------|---------|
| **Collection** | Table in SQL | `users`, `parkings`, `bookings` |
| **Document** | Row in SQL | A single user, a single parking |
| **Field** | Column in SQL | `name`, `email`, `status` |
| **Document ID** | Primary key | Auto-generated or custom (like user UID) |

---

## Canonical Collections

The platform uses the following main collections:

| Collection | Purpose | Who Uses It |
|------------|---------|-------------|
| `users` | User profiles and roles | All users |
| `owners` | Owner-specific details | Owners |
| `parkings` | Parking locations | Owners, Operators, Drivers |
| `bookings` | Parking reservations | Drivers, Operators |
| `sessions` | Active parking sessions | Operators, Drivers |
| `paymentRequests` | Pending payment submissions | Drivers, Operators |
| `payments` | Completed transactions | Owners, Admins |
| `checkInTokens` | QR code tokens | Operators |
| `checkInRequests` | QR check-in requests | Drivers, Operators |
| `auditLogs` | System activity records | Admins |

---

## Key Entity Contracts

### `parkings/{parkingId}`

Parking locations where vehicles can be parked.

```javascript
{
  ownerId: "owner123",           // Which owner owns this parking
  name: "Bole Mall Parking",     // Display name
  address: "Bole, Addis Ababa",  // Physical address
  status: "active",              // active | inactive
  
  // Slot Management
  slotCapacity: 50,              // Total parking slots
  availableSlots: 30,            // Currently free
  reservedSlots: 10,             // Reserved by bookings
  occupiedSlots: 10,             // Currently in use
  
  // Pricing
  hourlyRate: 50,                // ETB per hour
  
  // Location
  location: {
    lat: 9.0054,
    lng: 38.7636
  }
}
```

#### Slot Invariant (Important!)

The following equation must always be true:

```
availableSlots + reservedSlots + occupiedSlots = slotCapacity
```

| Slot Type | Meaning |
|-----------|---------|
| `availableSlots` | Free slots anyone can book |
| `reservedSlots` | Slots with active bookings not yet checked in |
| `occupiedSlots` | Slots with active sessions (vehicles parked) |

#### How Slots Change

| Action | Effect on Counters |
|--------|-------------------|
| Driver creates booking | `reservedSlots++`, `availableSlots--` |
| Booking expires | `reservedSlots--`, `availableSlots++` |
| Check-in | `reservedSlots--`, `occupiedSlots++` |
| Check-out | `occupiedSlots--`, `availableSlots++` |

---

### `bookings/{bookingId}`

Reservations made by drivers before arriving at parking.

```javascript
{
  parkingId: "parking123",       // Which parking
  ownerId: "owner123",           // Owner of the parking
  driverId: "driver456",         // Who made the booking
  plateNumber: "AA-1234-B",      // Vehicle identifier
  
  status: "reserved",            // reserved | expired | checked_in | cancelled | completed
  
  // Timestamps
  reservedAt: timestamp,         // When booking was made
  expiresAt: timestamp,          // When booking expires (usually 30 min)
  checkInAt: timestamp,          // When vehicle arrived (null if not checked in)
  checkOutAt: timestamp          // When vehicle left (null if not completed)
}
```

#### Booking Status Lifecycle

```
reserved → checked_in → completed
    ↓           ↓
  expired    cancelled
```

| Status | Meaning |
|--------|---------|
| `reserved` | Active booking, waiting for check-in |
| `expired` | Booking timed out without check-in |
| `checked_in` | Vehicle arrived and is parked |
| `cancelled` | Driver cancelled the booking |
| `completed` | Vehicle checked out, session ended |

---

### `sessions/{sessionId}`

Records of vehicles currently or previously parked.

```javascript
{
  parkingId: "parking123",       // Where the vehicle is parked
  bookingId: "booking789",       // Linked booking (null for walk-ins)
  ownerId: "owner123",           // Owner of the parking
  driverId: "driver456",         // Who parked the vehicle
  plateNumber: "AA-1234-B",      // Vehicle identifier
  
  // Timing
  entryTime: timestamp,          // When vehicle entered
  exitTime: timestamp,           // When vehicle left (null if active)
  durationMinutes: 120,          // Total parking duration
  billedHours: 2,                // Hours charged (rounded up)
  hourlyRate: 50,                // Rate at time of entry
  
  // Payment
  feeAmount: 100,                // Total fee in ETB
  paymentStatus: "unpaid",       // unpaid | pending | confirmed
  
  // Status
  status: "active",              // active | completed
  
  // Operator tracking
  checkedInBy: "operator123",    // Who checked in the vehicle
  checkedOutBy: "operator456"    // Who checked out (null if active)
}
```

#### Session Status

| Status | Meaning |
|--------|---------|
| `active` | Vehicle is currently parked |
| `completed` | Vehicle has left, session ended |

#### Payment Status

| Status | Meaning |
|--------|---------|
| `unpaid` | No payment submitted yet |
| `pending` | Payment request submitted, awaiting confirmation |
| `confirmed` | Payment confirmed by operator |

---

### `paymentRequests/{requestId}`

Payment submissions from drivers awaiting operator confirmation.

```javascript
{
  sessionId: "session123",       // Which session this is for
  bookingId: "booking789",       // Linked booking (if any)
  parkingId: "parking123",       // Which parking
  ownerId: "owner123",           // Owner of the parking
  driverId: "driver456",         // Who submitted the payment
  plateNumber: "AA-1234-B",      // Vehicle identifier
  
  // Amount
  amountDue: 100,                // Total in ETB
  billedHours: 2,                // Hours charged
  hourlyRate: 50,                // Rate used
  
  // Payment Method
  method: "bank",                // bank | phone
  referenceCode: "TXN123456",    // Transaction reference (optional)
  
  // Status
  status: "pending",             // pending | confirmed | rejected
  
  // Timestamps
  submittedAt: timestamp,
  reviewedAt: timestamp,         // When operator decided (null if pending)
  
  // Operator decision
  reviewedBy: "operator123",     // Who reviewed (null if pending)
  rejectionReason: "Invalid reference"  // If rejected
}
```

#### Payment Request Status

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting operator review |
| `confirmed` | Operator approved, payment complete |
| `rejected` | Operator rejected, driver must resubmit |

---

### `payments/{paymentId}`

Final settled payment records for completed transactions.

```javascript
{
  sessionId: "session123",       // Which session was paid
  bookingId: "booking789",       // Linked booking (if any)
  parkingId: "parking123",       // Which parking
  driverId: "driver456",         // Who paid
  ownerId: "owner123",           // Who received payment
  
  // Amount breakdown
  grossAmount: 100,              // Total paid
  ownerAmount: 90,               // Owner's share (90%)
  platformCommission: 10,        // Admin's share (10%)
  
  // Timestamps
  paidAt: timestamp              // When payment was confirmed
}
```

#### Commission Calculation

```
platformCommission = grossAmount × 0.10
ownerAmount = grossAmount - platformCommission
```

---

### `checkInTokens/{tokenId}`

QR code tokens generated by operators for driver check-in.

```javascript
{
  parkingId: "parking123",       // Which parking this token is for
  operatorUid: "operator123",    // Who generated the token
  
  expiresAt: timestamp,          // When token expires (usually 5 min)
  status: "active"               // active | used | expired
}
```

#### Token Status

| Status | Meaning |
|--------|---------|
| `active` | Token is valid and can be used |
| `used` | Token was used for a check-in |
| `expired` | Token timed out without use |

---

### `checkInRequests/{requestId}`

Requests created when drivers scan QR codes.

```javascript
{
  parkingId: "parking123",       // Which parking
  driverUid: "driver456",        // Who scanned the QR
  plateNumber: "AA-1234-B",      // Vehicle to check in
  tokenId: "token789",           // The QR token used
  
  bookingId: "booking789",       // Linked booking (if any)
  ownerId: "owner123",           // Owner of the parking
  
  status: "pending",             // pending | approved | rejected | expired
  
  // Timestamps
  requestedAt: timestamp,
  reviewedAt: timestamp,
  
  // Operator decision
  reviewedBy: "operator123",
  rejectionReason: "Wrong parking"
}
```

---

### `auditLogs/{logId}`

Records of important system actions for accountability.

```javascript
{
  action: "booking_created",     // What happened
  actorId: "driver456",          // Who did it
  actorRole: "driver",           // Their role
  targetId: "booking789",        // What was affected
  targetType: "booking",         // Type of target
  
  details: {                     // Additional context
    parkingId: "parking123",
    plateNumber: "AA-1234-B"
  },
  
  timestamp: timestamp,
  ipAddress: "192.168.1.1"
}
```

---

## Security Rules

### Overview

Firestore security rules control who can read and write documents. The rules file is `firestore.rules`.

### Key Principles

1. **Protected collections** - Business collections cannot be written directly by clients
2. **Role-based access** - Users can only read data relevant to their role
3. **All writes through functions** - Data modifications happen via Cloud Functions

### Access Patterns by Role

| Role | Can Read | Can Write |
|------|----------|-----------|
| **Driver** | Own bookings, sessions, payment requests | None (uses Cloud Functions) |
| **Operator** | Assigned parking's data | None (uses Cloud Functions) |
| **Owner** | Own parkings, operators, analytics | None (uses Cloud Functions) |
| **Admin** | All collections | None (uses Cloud Functions) |

### Example Rule

```javascript
// Drivers can only read their own bookings
match /bookings/{bookingId} {
  allow read: if request.auth.uid == resource.data.driverId;
  allow write: if false;  // All writes through Cloud Functions
}
```

---

## Data Relationships

```
users (driver) ──creates──> bookings ──becomes──> sessions
                                │                    │
                                │                    │
                                └──links to──> paymentRequests
                                              │
                                              └──becomes──> payments
                                                           │
parkings <──belongs to── owners                              │
    │                                                        │
    └──has──> checkInTokens ──scanned──> checkInRequests ──┘
```

---

## Related Documentation

- `docs/01-system-architecture.md` - How the database fits into the system
- `docs/06-cloud-functions-api.md` - How data is modified
- `docs/07-qr-checkin-flow.md` - How check-in tokens and requests work
- `docs/08-manual-payment-flow.md` - How payments are processed