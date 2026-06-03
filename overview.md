I’m going to turn the guideline into a practical MVP architecture: product scope, roles, data model, frontend structure, Firebase setup, core flows, and what to build first. I’ll also sanity-check current React/Firebase guidance so I don’t steer you into an outdated setup.

I’ve checked one important implementation detail: for an MVP, Firebase is still a good fit, but Create React App is officially deprecated now, so I’d treat your current CRA codebase as a temporary base and plan either a light cleanup now or a Vite migration shortly after MVP stabilization.

Thought for 13s

Yes — here’s a practical step-by-step MVP architecture for ENDERASE, assuming you already have a rough React + Firebase implementation.

One important adjustment first: Create React App is now deprecated by the React team. For a rough MVP, you can keep the current CRA codebainvesting heavily in CRA-specific setup and plan a later move to Vite once the MVP is stable. Firebase remains a solid MVP backend choice, especially with Firestore, Auth, and Security Rules. ine the MVP scope first

Do not build the whole vision at once. For MVP, build only the minimum workflow that proves the product.

MVP must include
Driver can view parking locations
Driver can see available slots
Driver can reserve a slot
Operator can check in a car by plate number
Operator can check out a car
System calculates parking fee
Owner can see slot count and basic earnings
Admin can register parking owners and parking sites
Leave for later
Fancy analytics
Dynamic pricing
OCR/automatic plate recognition
Multi-city scaling complexity
Wallet/refund workflows
Advanced notifications
Offline mode
Full audit dashboards

That keeps the first release small and testable.

2. Recommended MVP system architecture

Use a simple 3-layer structure:

Frontend

React app with role-based pages:

Driver app/pages
Operator dashboard
Owner dashboard
Admin dashboard
Backend

Firebase managed services:

Firebase Authentication for login and role-linked identity
Cloud Firestore for parking, booking, vehicle session, payment, and reporting data
Cloud Functions for trusted server-side logic like fee calculation, booking expiry, revenue split, and payment verification
Firebase Storage for owner photo / ID upload if needed
Optional: Firebase Hosting for deployment
External integrations
Google Maps API for map and parking location display
Telebirr / CBE Birr integration later through Cloud Functions or webhook endpoints
For MVP, payment can first be marked as manual/confirmed by operator, then later automated

This matches Firebase’s recommended pattern of pairing Firestore with Auth and Security Rules, and reserving privileged logic for server-side environments rather than trusting the browser. e user roles for MVP

Keep roles very strict.

Admin

Can:

create owner accounts
create parking locations
assign operators
view platform commission
Owner

Can:

view only their own parking locations
see slot usage
see revenue summary
Operator

Can:

search booking by plate number
check vehicle in
check vehicle out
confirm payment
view live available slots for assigned parking site
Driver

Can:

browse parking sites on map
see available capacity
reserve slot
view booking status

Implement roles through:

Firebase Auth user
Firestore users document with role field
optionally Firebase custom claims later
4. Firestore data model for a rough MVP

Use a simple, flat model. Firestore works best when your queries are clear and document-oriented. ded collections:

users
/users/{uid}
{
  "fullName": "Abebe Kebede",
  "email": "owner@example.com",
  "role": "owner",
  "phone": "+251...",
  "ownerId": "owner_001",
  "assignedParkingIds": ["parking_001"],
  "createdAt": timestamp,
  "status": "active"
}
owners
/owners/{ownerId}
{
  "userId": "uid123",
  "fullName": "Owner Name",
  "email": "owner@example.com",
  "phone": "+251...",
  "photoUrl": "...",
  "fanNumber": "...",
  "bankAccountNumber": "...",
  "createdAt": timestamp
}
parkings
/parkings/{parkingId}
{
  "ownerId": "owner_001",
  "name": "Bole Parking Center",
  "address": "Bole, Addis Ababa",
  "location": {
    "lat": 8.99,
    "lng": 38.79
  },
  "slotCapacity": 50,
  "availableSlots": 43,
  "reservedSlots": 2,
  "occupiedSlots": 5,
  "hourlyRate": 50,
  "status": "active",
  "createdAt": timestamp
}
bookings
/bookings/{bookingId}
{
  "parkingId": "parking_001",
  "driverId": "uid_driver_1",
  "plateNumber": "AA12345",
  "status": "reserved",
  "reservedAt": timestamp,
  "expiresAt": timestamp,
  "verifiedAt": null,
  "checkInAt": null,
  "checkOutAt": null,
  "estimatedRate": 50,
  "paymentStatus": "pending"
}

Possible booking statuses:

reserved
expired
verified
checked_in
checked_out
cancelled
sessions

This tracks the real parking stay.

/sessions/{sessionId}
{
  "parkingId": "parking_001",
  "bookingId": "booking_001",
  "plateNumber": "AA12345",
  "operatorCheckInId": "uid_operator_1",
  "operatorCheckOutId": null,
  "entryTime": timestamp,
  "exitTime": null,
  "durationMinutes": null,
  "hourlyRate": 50,
  "feeAmount": null,
  "paymentStatus": "pending",
  "paymentMethod": null,
  "status": "active"
}
payments
/payments/{paymentId}
{
  "sessionId": "session_001",
  "parkingId": "parking_001",
  "ownerId": "owner_001",
  "grossAmount": 150,
  "platformCommission": 15,
  "ownerAmount": 135,
  "method": "manual",
  "provider": "telebirr",
  "status": "confirmed",
  "paidAt": timestamp,
  "confirmedBy": "uid_operator_1"
}
dailyReports

Optional derived collection, updated by Cloud Functions.

/dailyReports/{parkingId_yyyy_mm_dd}
{
  "parkingId": "parking_001",
  "date": "2026-04-06",
  "totalSessions": 35,
  "grossRevenue": 5200,
  "ownerRevenue": 4680,
  "platformRevenue": 520
}
5. Frontend app structure

Because it is already React-based, organize by feature, not by file type.

Suggested structure:

src/
  app/
    router.jsx
    auth.jsx
    providers.jsx

  features/
    auth/
    map/
    parkings/
    bookings/
    sessions/
    payments/
    admin/
    owner/
    operator/
    driver/

  components/
    ui/
    forms/
    layout/

  services/
    firebase/
      config.js
      auth.js
      firestore.js
      functions.js
    api/
    maps/

  hooks/
  utils/
  constants/
Key screens
Driver
Login/Register
Map View
Parking Details
Reserve Slot
My Booking
Operator
Login
Check In / Check Out page
Plate number lookup
Live slot status
Payment confirmation page
Owner
Dashboard
Revenue summary
Slot overview
Parking profile
Admin
Dashboard
Register Owner
Register Parking
Assign Operator
6. MVP workflow architecture
Flow A: Driver reserves a slot
Driver opens map
Frontend reads parkings
Driver selects a parking site
App checks availableSlots > 0
User submits plate number and reserves
Cloud Function creates booking
Cloud Function decrements availableSlots and increments reservedSlots
Booking gets an expiry time, for example 15 minutes

Do booking creation in a transaction to avoid overselling slots. Firestore best practices emphasize careful data design and query-safe access patterns; transactions are the right fit for this kind of inventory decrement. B: Operator verifies arrival

Driver arrives
Operator enters plate number
System searches bookings where:
plateNumber == input
parkingId == currentParking
status == reserved
If valid and not expired:
booking becomes checked_in
create session
decrement reservedSlots
increment occupiedSlots
Flow C: Operator checks out vehicle
Operator enters plate number
System finds active session
Cloud Function calculates duration and fee
Operator confirms payment
System creates payment
Session becomes checked_out
occupiedSlots decreases
availableSlots increases
Flow D: Owner/Admin reporting

Use precomputed totals or simple aggregation:

total active slots
today’s revenue
total sessions
commission split

For rough MVP, calculate basic totals on demand or via lightweight Cloud Functions.

7. Put sensitive logic in Cloud Functions, not React

Anything that affects money, slot counts, or trust should not live only in the browser.

Put these in Cloud Functions
create booking
expire booking
check in vehicle
check out vehicle
calculate fee
split revenue 10/90
verify payment callback later
generate daily summary
Keep in React
form input
dashboards
list/map display
role-based routing
realtime UI updates

This is important because browser clients can be tampered with. Firebase docs note that trusted server-side clients bypass Firestore Rules, which is exactly why privileged operations belong in controlled backend environments with IAM and server credentials, not in public client code. urity model for MVP

This is where many Firebase MVPs go wrong.

Authentication

Use Firebase Auth with:

email/password for admin, owner, operator
phone or email for drivers later
for rough MVP, even all-email auth is fine
Authorization

Use Firestore Security Rules:

admin can access all
owner can only access their own parking docs and reports
operator can only access assigned parking docs
driver can only access their own bookings

Firebase explicitly recommends pairing Auth with Firestore Security Rules for role- and user-based access control. access logic:

users/{uid}: user can read own profile
bookings/{bookingId}: driver reads own, operator reads if assigned to same parking, admin reads all
parkings/{parkingId}: public read for driver list/map, restricted write
payments/{paymentId}: owner reads only their parking’s payments, operator may create, admin reads all
Validation rules

Rules should enforce:

required fields exist
role cannot be spoofed by client
driver cannot change payment status
owner cannot edit another owner’s parking
slot values cannot go negative
9. Slot management strategy

Do not model each slot as a separate document for MVP unless you truly need numbered spaces.

Use aggregate counters on each parking:

slotCapacity
availableSlots
reservedSlots
occupiedSlots

This is much simpler.

Later, if you need named slots like A1, A2, B3, then add a parkingSlots collection.

For now:

reservation decreases availability
check-in moves reserved -> occupied
check-out moves occupied -> available
booking expiry moves reserved -> available
10. Payment strategy for MVP

For MVP, I strongly recommend 2 phases.

Phase 1: semi-manual payment
Operator collects payment physically or through Telebirr/CBE Birr
Operator marks payment as received
System stores payment record and revenue split

This gets the product working fast.

Phase 2: integrated digital payment
Driver pays through Telebirr / CBE Birr
Provider calls webhook
Cloud Function verifies transaction
System marks payment confirmed automatically

Do not block MVP on payment gateway complexity.

11. Reporting model

For rough MVP, expose only simple dashboards.

Owner dashboard
today’s occupied slots
today’s revenue
this week revenue
active bookings
current available slots
Admin dashboard
total parkings
total owners
total platform revenue
total bookings
commission collected
Operator view
live slot counts
current active sessions
today’s completed checkouts

You do not need BI-level analytics yet.

12. Suggested development phases
Phase 1: foundation
clean current CRA app structure
add Firebase Auth
create Firestore schema
add role-based routing
seed sample parking locations
Phase 2: core parking flow
map page
parking list/details
booking creation
operator verification
session check-in/check-out
fee calculation
Phase 3: dashboards
owner dashboard
admin dashboard
operator live board
Phase 4: security hardening
Firestore rules
input validation
Cloud Functions for trusted writes
booking expiry job
Phase 5: deployment and test
Firebase Hosting
test users for each role
staging dataset
manual QA with real scenarios
13. Concrete MVP backlog

Here is the exact build order I would use.

Week 1 equivalent scope
Firebase project setup
Auth setup
users / parkings collections
basic admin seed data
route guards by role
Next
Driver map and parking list
reserve booking flow
booking expiration logic
Next
Operator check-in
session creation
operator check-out
fee computation
Next
owner dashboard
admin commission dashboard
Then
security rules
logs
edge case handling
deployment
14. Key edge cases to support from day one

Even in MVP, handle these:

driver books but never arrives
booking expires
operator enters wrong plate number
no slots left
double booking race condition
vehicle enters without reservation
operator forgets checkout
payment marked but session not closed
owner has multiple parking sites

For walk-in vehicles with no reservation:

operator can create a direct session at entry
system still tracks fee and occupancy

That will make the app usable in the real world.

15. My recommended technical decisions
Keep now
Firebase
Firestore
React
Google Maps
Add
Cloud Functions
Firestore transactions
Security Rules
role-based route guards
Avoid for MVP
microservices
custom Node backend unless needed
Redux unless app state becomes messy
per-slot IoT sensor integration
complex event bus
After MVP
migrate from CRA to Vite
add real payment callbacks
add notifications
add plate recognition
add better analytics
16. The simplest “good enough” architecture diagram
React App
  ├─ Driver UI
  ├─ Operator UI
  ├─ Owner UI
  └─ Admin UI

      ↓ uses

Firebase Auth
      ↓
Firestore
  ├─ users
  ├─ owners
  ├─ parkings
  ├─ bookings
  ├─ sessions
  ├─ payments
  └─ dailyReports

      ↑
Cloud Functions
  ├─ createBooking
  ├─ expireBooking
  ├─ checkInVehicle
  ├─ checkOutVehicle
  ├─ calculateFee
  └─ splitRevenue

External APIs
  ├─ Google Maps API
  ├─ Telebirr
  └─ CBE Birr
17. Best architectural recommendation for your exact case

Because you already have a rough CRA + Firebase implementation, I would do this:

Do not rewrite yet
Clean the codebase into feature folders
Move business logic out of components
Add Firestore collections above
Implement Cloud Functions for booking/check-in/check-out/payment
Lock data with Security Rules
Ship internal MVP
Only then migrate CRA to Vite

That gives you the fastest route to a usable product without wasting effort.

If you want, I can turn this next into a full folder structure + Firestore schema + security rules draft + screen-by-screen MVP checklist.