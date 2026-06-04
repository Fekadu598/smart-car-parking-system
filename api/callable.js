const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");


// Initialize Firebase Admin
// In emulator: uses service account key if available, otherwise uses default credentials
// In production: uses default credentials automatically
if (!admin.apps.length) {
  try {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
      : null;
    admin.initializeApp(sa ? { credential: admin.credential.cert(sa) } : {});
  } catch (e) {
    admin.initializeApp();
  }
}

const db = admin.firestore();

class FunctionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "FunctionError";
  }
}


const BOOKING_TTL_MINUTES = 15;
const PLATFORM_COMMISSION_RATE = 0.1;
const FLAT_HOURLY_RATE = 50;
const QR_TOKEN_TTL_MS = 60 * 1000;
const WEB_APP_BASE_URL = (process.env.WEB_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const ARCHIVE_STATUS = "archived";
const ACTIVE_STATUS = "active";
const INACTIVE_STATUS = "inactive";
const OWNER_ARCHIVE_REASONS = {
  ACTIVE_SESSIONS: "ACTIVE_SESSIONS",
  RESERVED_BOOKINGS: "RESERVED_BOOKINGS",
  INVALID_OWNER_ROLE: "INVALID_OWNER_ROLE",
};

function nowMs() {
  return Date.now();
}

function ts(ms = nowMs()) {
  return Timestamp.fromMillis(ms);
}

function normalizePlate(plateNumber) {
  return String(plateNumber || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return null;
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function normalizeSplit(grossAmount, ownerAmount, platformCommission, tax) {
  const gross = roundMoney(grossAmount);
  const derivedTax = tax == null ? roundMoney(gross - roundMoney(gross / 1.15)) : roundMoney(tax);
  const net = roundMoney(gross - derivedTax);
  const commission = roundMoney(net * PLATFORM_COMMISSION_RATE);
  const owner = roundMoney(net - commission);

  return {
    grossAmount: gross,
    ownerAmount: ownerAmount == null ? owner : roundMoney(ownerAmount),
    platformCommission: platformCommission == null ? commission : roundMoney(platformCommission),
    adminCommissionDerived: commission,
    tax: derivedTax,
    net,
  };
}

function parseAnalyticsRange(data) {
  const preset = String(data?.rangePreset || "30d").trim().toLowerCase();
  const now = new Date();
  let from = null;
  let to = now;

  if (preset === "7d") {
    from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  } else if (preset === "30d") {
    from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  } else if (preset === "custom") {
    const fromMs = toNumber(data?.fromMs, 0);
    const toMs = toNumber(data?.toMs, 0);
    if (!fromMs || !toMs) {
      throw new FunctionError("invalid-argument", "Custom range requires fromMs and toMs.");
    }
    from = new Date(fromMs);
    to = new Date(toMs);
  } else {
    throw new FunctionError("invalid-argument", "rangePreset must be 7d, 30d, or custom.");
  }

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  if (from.getTime() > to.getTime()) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  return {
    preset,
    fromMs: from.getTime(),
    toMs: to.getTime(),
  };
}

function dayKey(ms) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayLabel(ms) {
  const d = new Date(ms);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function buildSeriesSkeleton(fromMs, toMs) {
  const map = {};
  const cursor = new Date(fromMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= toMs) {
    const ms = cursor.getTime();
    const key = dayKey(ms);
    map[key] = {
      key,
      label: dayLabel(ms),
      grossAmount: 0,
      ownerAmount: 0,
      adminCommission: 0,
      tax: 0,
      paymentsCount: 0,
    };
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

function ensureParkingInvariant(parking) {
  const available = toNumber(parking.availableSlots, 0);
  const reserved = toNumber(parking.reservedSlots, 0);
  const occupied = toNumber(parking.occupiedSlots, 0);
  const capacity = toNumber(parking.slotCapacity, 0);
  return available + reserved + occupied === capacity;
}

async function getUserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function requireRole(auth, expectedRole) {
  if (!auth?.uid) {
    throw new FunctionError("unauthenticated", "Authentication required.");
  }
  const profile = await getUserProfile(auth.uid);
  if (!profile) throw new FunctionError("failed-precondition", "User profile not found.");
  if (profile.status && profile.status !== "active") {
    throw new FunctionError("permission-denied", "User is not active.");
  }
  if (profile.role !== expectedRole) {
    throw new FunctionError("permission-denied", `Required role: ${expectedRole}`);
  }
  return profile;
}

async function assertOperatorAssigned(uid, parkingId) {
  const profile = await getUserProfile(uid);
  const assigned = Array.isArray(profile?.assignedParkingIds) ? profile.assignedParkingIds : [];
  if (!assigned.includes(parkingId)) {
    throw new FunctionError("permission-denied", "Operator is not assigned to this parking.");
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function isArchivedStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === ARCHIVE_STATUS || normalized === INACTIVE_STATUS;
}

async function getOwnerAccountRefs(ownerId) {
  const ownerRef = db.collection("owners").doc(ownerId);
  const ownerSnap = await ownerRef.get();
  if (!ownerSnap.exists) {
    throw new FunctionError("not-found", "Owner not found.");
  }
  const ownerData = ownerSnap.data() || {};
  const userCandidates = [];
  const ownerUserId = String(ownerData.userId || "").trim();
  if (ownerUserId) {
    userCandidates.push(ownerUserId);
  }

  const usersByOwnerSnap = await db.collection("users").where("ownerId", "==", ownerId).limit(20).get();
  usersByOwnerSnap.docs.forEach((doc) => {
    userCandidates.push(doc.id);
  });

  const uniqueCandidates = [...new Set(userCandidates)];
  let ownerUserRef = null;
  let ownerUserSnap = null;
  for (const candidateUid of uniqueCandidates) {
    const candidateRef = db.collection("users").doc(candidateUid);
    const candidateSnap = await candidateRef.get();
    if (!candidateSnap.exists) continue;
    const candidate = candidateSnap.data() || {};
    if (String(candidate.role || "").trim().toLowerCase() === "owner") {
      ownerUserRef = candidateRef;
      ownerUserSnap = candidateSnap;
      break;
    }
  }

  return { ownerRef, ownerSnap, ownerData, ownerUserRef, ownerUserSnap };
}

async function assertOwnerControlsParking(ownerId, parkingId) {
  const parkingSnap = await db.collection("parkings").doc(parkingId).get();
  if (!parkingSnap.exists) {
    throw new FunctionError("not-found", `Parking ${parkingId} does not exist.`);
  }
  if (String(parkingSnap.data()?.ownerId || "") !== ownerId) {
    throw new FunctionError("permission-denied", `Parking ${parkingId} is not owned by this owner.`);
  }
}

async function assertOwnerAccountActive(ownerId) {
  const ownerSnap = await db.collection("owners").doc(ownerId).get();
  if (!ownerSnap.exists) {
    throw new FunctionError("not-found", "Owner profile not found.");
  }
  if (isArchivedStatus(ownerSnap.data()?.status)) {
    throw new FunctionError("failed-precondition", "Owner account is archived.");
  }
}

async function assertDriverHasParkingAccess(driverUid, parkingId) {
  const [activeSessionSnap, paymentRequestSnap] = await Promise.all([
    db
      .collection("sessions")
      .where("driverId", "==", driverUid)
      .where("status", "==", "active")
      .limit(25)
      .get(),
    db
      .collection("paymentRequests")
      .where("driverId", "==", driverUid)
      .limit(100)
      .get(),
  ]);

  const hasActiveSession = activeSessionSnap.docs.some(
    (doc) => String(doc.data()?.parkingId || "").trim() === parkingId
  );
  const hasPendingPayment = paymentRequestSnap.docs.some((doc) => {
    const payload = doc.data();
    return String(payload?.parkingId || "").trim() === parkingId && payload?.status === "pending";
  });

  if (!hasActiveSession && !hasPendingPayment) {
    throw new FunctionError("permission-denied", "Driver does not have an active session/payment at this parking.");
  }
}

async function writeAuditLog(action, actorUid, parkingId, metadata = {}) {
  await db.collection("auditLogs").add({
    action,
    actorUid,
    parkingId: parkingId || null,
    metadata,
    createdAt: ts(),
  });
}

function createRandomToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePaymentMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  if (!["bank", "phone"].includes(method)) {
    throw new FunctionError("invalid-argument", "method must be either bank or phone.");
  }
  return method;
}

function computeSessionCharge(entryTimestamp, now) {
  const entryMs = parseTimestampMs(entryTimestamp);
  if (!entryMs) {
    throw new FunctionError("failed-precondition", "Session entry time is invalid.");
  }
  const durationMinutes = Math.max(1, Math.ceil((now - entryMs) / 60000));
  const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
  const amountDue = billedHours * FLAT_HOURLY_RATE;
  return { durationMinutes, billedHours, amountDue };
}

function isBookingExpired(booking, now = nowMs()) {
  const expiresAtMs = parseTimestampMs(booking?.expiresAt);
  return Boolean(expiresAtMs && expiresAtMs <= now);
}

async function assertPlateNotInUse(plateNumber, options = {}) {
  const normalizedPlate = normalizePlate(plateNumber);
  if (!normalizedPlate) return;
  const now = toNumber(options.now, nowMs());
  const excludeBookingId = String(options.excludeBookingId || "").trim();

  const [activeSessionSnap, reservedBookingsSnap] = await Promise.all([
    db.collection("sessions").where("plateNumber", "==", normalizedPlate).where("status", "==", "active").limit(1).get(),
    db.collection("bookings").where("plateNumber", "==", normalizedPlate).where("status", "==", "reserved").limit(40).get(),
  ]);

  if (!activeSessionSnap.empty) {
    throw new FunctionError("already-exists", "This plate already has an active parking session.");
  }

  const hasReservedConflict = reservedBookingsSnap.docs.some((doc) => {
    if (excludeBookingId && doc.id === excludeBookingId) return false;
    const booking = doc.data() || {};
    return !isBookingExpired(booking, now);
  });

  if (hasReservedConflict) {
    throw new FunctionError("already-exists", "This plate already has an active reservation.");
  }
}

async function expireReservedBookingIfExpired(bookingDoc, now = nowMs()) {
  if (!bookingDoc?.exists) return false;
  const booking = bookingDoc.data() || {};
  if (booking.status !== "reserved" || !isBookingExpired(booking, now)) return false;

  const bookingRef = bookingDoc.ref;
  const parkingRef = db.collection("parkings").doc(String(booking.parkingId || ""));
  let expired = false;

  await db.runTransaction(async (tx) => {
    const [freshBookingSnap, parkingSnap] = await Promise.all([tx.get(bookingRef), tx.get(parkingRef)]);
    if (!freshBookingSnap.exists) return;
    const freshBooking = freshBookingSnap.data() || {};
    if (freshBooking.status !== "reserved" || !isBookingExpired(freshBooking, now)) return;

    tx.update(bookingRef, { status: "expired", updatedAt: ts(now) });
    if (parkingSnap.exists) {
      tx.update(parkingRef, {
        reservedSlots: FieldValue.increment(-1),
        availableSlots: FieldValue.increment(1),
        updatedAt: ts(now),
      });
    }
    expired = true;
  });

  return expired;
}

async function submitManualPaymentRequest({ actorUid, parkingId, plateNumber, method, referenceCode }) {
  const now = nowMs();
  const sessionQuery = await db
    .collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (sessionQuery.empty) {
    throw new FunctionError("not-found", "No active session found for this vehicle.");
  }

  const sessionRef = sessionQuery.docs[0].ref;
  const normalizedReference = String(referenceCode || "").trim();
  let responseData = null;

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new FunctionError("not-found", "Session not found.");
    const session = sessionSnap.data();

    if (session.status !== "active") {
      throw new FunctionError("failed-precondition", "Session is not active.");
    }
    if (session.driverId !== actorUid) {
      throw new FunctionError("permission-denied", "Drivers can only submit payment for their own session.");
    }

    const charge = computeSessionCharge(session.entryTime, now);
    const ownerId = session.ownerId || null;

    const existingPendingQuery = db
      .collection("paymentRequests")
      .where("sessionId", "==", sessionRef.id)
      .where("status", "==", "pending")
      .limit(1);
    const existingPendingSnap = await tx.get(existingPendingQuery);
    if (!existingPendingSnap.empty) {
      throw new FunctionError("failed-precondition", "A payment request is already pending operator approval.");
    }

    const paymentRequestRef = db.collection("paymentRequests").doc();

    tx.set(
      paymentRequestRef,
      {
        sessionId: sessionRef.id,
        bookingId: session.bookingId || null,
        parkingId: session.parkingId,
        ownerId,
        driverId: actorUid,
        plateNumber: session.plateNumber,
        amountDue: charge.amountDue,
        billedHours: charge.billedHours,
        hourlyRate: FLAT_HOURLY_RATE,
        method,
        referenceCode: normalizedReference || null,
        status: "pending",
        submittedAt: ts(now),
        submittedBy: actorUid,
        confirmedAt: null,
        rejectedAt: null,
        confirmedBy: null,
        rejectedBy: null,
        rejectionReason: null,
        paymentId: null,
        createdAt: ts(now),
        updatedAt: ts(now),
      },
      { merge: false }
    );

    tx.update(sessionRef, {
      paymentStatus: "pending",
      updatedAt: ts(now),
    });

    responseData = {
      requestId: paymentRequestRef.id,
      sessionId: sessionRef.id,
      status: "pending",
      parkingId: session.parkingId,
      amountDue: charge.amountDue,
      feeAmount: charge.amountDue,
      billedHours: charge.billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
    };
  });

  return responseData;
}

async function listPendingPaymentsForOperator(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const parkingId = String(data?.parkingId || "").trim();
  if (!parkingId) throw new FunctionError("invalid-argument", "parkingId is required.");
  await assertOperatorAssigned(actorUid, parkingId);

  const snapshot = await db
    .collection("paymentRequests")
    .where("parkingId", "==", parkingId)
    .where("status", "==", "pending")
    .orderBy("submittedAt", "desc")
    .limit(200)
    .get();
  const pending = snapshot.docs.map((doc) => ({
    id: doc.id,
    sessionId: doc.data().sessionId || null,
    bookingId: doc.data().bookingId || null,
    parkingId: doc.data().parkingId || null,
    driverId: doc.data().driverId || null,
    plateNumber: doc.data().plateNumber || null,
    amountDue: toNumber(doc.data().amountDue, 0),
    billedHours: toNumber(doc.data().billedHours, 0),
    hourlyRate: toNumber(doc.data().hourlyRate, FLAT_HOURLY_RATE),
    method: doc.data().method || null,
    referenceCode: doc.data().referenceCode || null,
    submittedAtMs: parseTimestampMs(doc.data().submittedAt),
  }));

  return { parkingId, pendingPayments: pending };
}

async function listPendingPaymentsForDriver(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "driver");

  const snapshot = await db
    .collection("paymentRequests")
    .where("driverId", "==", actorUid)
    .where("status", "==", "pending")
    .orderBy("submittedAt", "desc")
    .limit(200)
    .get();
  const pending = snapshot.docs.map((doc) => ({
    id: doc.id,
    sessionId: doc.data().sessionId || null,
    parkingId: doc.data().parkingId || null,
    plateNumber: doc.data().plateNumber || null,
    amountDue: toNumber(doc.data().amountDue, 0),
    method: doc.data().method || null,
    submittedAtMs: parseTimestampMs(doc.data().submittedAt),
  }));

  return { pendingPayments: pending };
}

async function getPendingPaymentForSession(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const sessionId = String(data?.sessionId || "").trim();
  if (!sessionId) throw new FunctionError("invalid-argument", "sessionId is required.");

  const sessionSnap = await db.collection("sessions").doc(sessionId).get();
  if (!sessionSnap.exists) throw new FunctionError("not-found", "Session not found.");
  const session = sessionSnap.data();
  const parkingId = String(session.parkingId || "").trim();
  if (!parkingId) throw new FunctionError("failed-precondition", "Session parkingId is missing.");
  await assertOperatorAssigned(actorUid, parkingId);

  const snapshot = await db
    .collection("paymentRequests")
    .where("sessionId", "==", sessionId)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new FunctionError("not-found", "No pending payment request found for this session.");
  }

  const doc = snapshot.docs[0];
  const payload = doc.data();
  return {
    pendingPayment: {
      id: doc.id,
      sessionId: payload.sessionId || sessionId,
      bookingId: payload.bookingId || null,
      parkingId: payload.parkingId || parkingId,
      driverId: payload.driverId || null,
      plateNumber: payload.plateNumber || session.plateNumber || null,
      amountDue: toNumber(payload.amountDue, 0),
      billedHours: toNumber(payload.billedHours, 0),
      hourlyRate: toNumber(payload.hourlyRate, FLAT_HOURLY_RATE),
      method: payload.method || null,
      referenceCode: payload.referenceCode || null,
      submittedAtMs: parseTimestampMs(payload.submittedAt),
    },
  };
}

async function allocateSpot(parkingId, startTimeMs, endTimeMs, slotCapacity) {
  const capacity = toNumber(slotCapacity, 10);
  const rows = ["A", "B", "C", "D", "E"];
  const allSpots = [];
  for (let i = 0; i < capacity; i++) {
    const rowIdx = Math.floor(i / 10);
    const spotNum = (i % 10) + 1;
    const rowLetter = rows[rowIdx] || "F";
    allSpots.push(`${rowLetter}${spotNum}`);
  }

  // 1. Get spots occupied by active sessions
  const activeSessionsSnap = await db.collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("status", "==", "active")
    .get();
  
  const occupiedSpots = new Set();
  activeSessionsSnap.docs.forEach(doc => {
    const s = doc.data();
    if (s.spotId) occupiedSpots.add(s.spotId);
  });

  // 2. Get spots reserved by overlapping bookings
  const reservedBookingsSnap = await db.collection("bookings")
    .where("parkingId", "==", parkingId)
    .where("status", "==", "reserved")
    .get();
  
  const overlappingSpots = new Set();
  reservedBookingsSnap.docs.forEach(doc => {
    const b = doc.data();
    const bStart = parseTimestampMs(b.startTime) || parseTimestampMs(b.reservedAt);
    const bEnd = parseTimestampMs(b.endTime) || parseTimestampMs(b.expiresAt);
    if (bStart && bEnd) {
      if (bStart < endTimeMs && bEnd > startTimeMs) {
        if (b.spotId) overlappingSpots.add(b.spotId);
      }
    }
  });

  // Find first available spot
  for (const spot of allSpots) {
    if (!overlappingSpots.has(spot) && !occupiedSpots.has(spot)) {
      return spot;
    }
  }
  return null;
}

function getSpotDirections(spotId, toPedestrian = false) {
  if (!spotId) return "No spot assigned yet.";
  const match = spotId.match(/^([A-Z])(\d+)$/);
  if (!match) return `Spot ${spotId} is located in the main parking area.`;
  const row = match[1];
  const num = match[2];
  
  if (toPedestrian) {
    return `To find your car at Spot ${spotId}: Enter through the main Pedestrian Door, walk straight down the central walkway, turn into Row ${row}, and your car is at spot number ${num} on the left.`;
  } else {
    return `To park at Spot ${spotId}: Drive through the Entrance Gate, follow the lane to Row ${row}, and pull into spot number ${num} (marked in green/blue).`;
  }
}

function computeDetailedSessionCharge(entryTimestamp, now, hourlyRate = FLAT_HOURLY_RATE) {
  const entryMs = parseTimestampMs(entryTimestamp);
  if (!entryMs) {
    throw new FunctionError("failed-precondition", "Session entry time is invalid.");
  }
  const rate = toNumber(hourlyRate, FLAT_HOURLY_RATE);
  const durationMinutes = Math.max(1, Math.ceil((now - entryMs) / 60000));
  const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
  const baseFare = billedHours * rate;
  const tax = roundMoney(baseFare * 0.15);
  const amountDue = roundMoney(baseFare + tax);
  return { durationMinutes, billedHours, baseFare, tax, amountDue };
}

async function createBooking(data, auth) {
  const actorUid = auth?.uid;
  const profile = await requireRole(auth, "driver");
  const parkingId = String(data?.parkingId || "").trim();
  const plateNumber = normalizePlate(data?.plateNumber);
  
  const now = nowMs();
  const startTimeMs = toNumber(data?.startTimeMs, now);
  const endTimeMs = toNumber(data?.endTimeMs, now + 60 * 60 * 1000); // default 1 hour duration

  if (!parkingId) throw new FunctionError("invalid-argument", "parkingId is required.");
  if (!plateNumber) throw new FunctionError("invalid-argument", "plateNumber is required.");
  if (startTimeMs >= endTimeMs) {
    throw new FunctionError("invalid-argument", "End time must be after start time.");
  }

  await assertPlateNotInUse(plateNumber, { now });

  const bookingRef = db.collection("bookings").doc();
  const parkingRef = db.collection("parkings").doc(parkingId);
  const userRef = db.collection("users").doc(actorUid);
  
  const reservationFee = 20.00; // hold fee in ETB
  const reservationCode = `RES-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  let assignedSpot = null;
  let newBalance = 0;

  await db.runTransaction(async (tx) => {
    const [parkingSnap, userSnap] = await Promise.all([
      tx.get(parkingRef),
      tx.get(userRef)
    ]);

    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    if (!userSnap.exists) throw new FunctionError("not-found", "Driver profile not found.");

    const parking = parkingSnap.data();
    const user = userSnap.data();
    const currentBalance = toNumber(user.walletBalance, 100.00); // default starting balance to 100 if undefined

    if (parking.status !== "active") throw new FunctionError("failed-precondition", "Parking is not active.");
    if (toNumber(parking.availableSlots) <= 0) throw new FunctionError("resource-exhausted", "No available slots.");
    if (!ensureParkingInvariant(parking)) throw new FunctionError("failed-precondition", "Parking counters invalid.");
    if (currentBalance < reservationFee) {
      throw new FunctionError("failed-precondition", `Insufficient wallet balance. Hold fee is ${reservationFee} ETB, but your balance is ${currentBalance} ETB. Please top up.`);
    }

    // Allocate a specific spot ID for this booking window
    assignedSpot = await allocateSpot(parkingId, startTimeMs, endTimeMs, parking.slotCapacity);
    if (!assignedSpot) {
      throw new FunctionError("resource-exhausted", "No specific spots are available for this reservation window.");
    }

    newBalance = roundMoney(currentBalance - reservationFee);

    tx.set(bookingRef, {
      parkingId,
      ownerId: parking.ownerId || null,
      driverId: actorUid,
      driverEmail: profile.email || "",
      plateNumber,
      status: "reserved",
      reservedAt: ts(now),
      startTime: ts(startTimeMs),
      endTime: ts(endTimeMs),
      expiresAt: ts(startTimeMs + 15 * 60 * 1000), // grace period of 15 minutes past startTime
      checkInAt: null,
      checkOutAt: null,
      spotId: assignedSpot,
      reservationCode,
      reservationFee,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      availableSlots: FieldValue.increment(-1),
      reservedSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    tx.update(userRef, {
      walletBalance: newBalance,
      updatedAt: ts(now)
    });
  });

  await writeAuditLog("CREATE_BOOKING", actorUid, parkingId, { 
    bookingId: bookingRef.id, 
    plateNumber, 
    spotId: assignedSpot,
    reservationCode,
    reservationFee,
    newBalance
  });

  return { 
    bookingId: bookingRef.id, 
    status: "reserved", 
    spotId: assignedSpot, 
    reservationCode,
    expiresAt: startTimeMs + 15 * 60 * 1000,
    directions: getSpotDirections(assignedSpot, false),
    feeCharged: reservationFee,
    remainingBalance: newBalance
  };
}

// expireBookings moved to api/cron.js (Vercel Cron Jobs)

async function checkInVehicle(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const parkingId = String(data?.parkingId || "").trim();
  const plateNumber = normalizePlate(data?.plateNumber);
  const reservationCode = String(data?.reservationCode || "").trim();
  const allowWalkIn = !!data?.allowWalkIn;

  await assertOperatorAssigned(actorUid, parkingId);

  let bookingDoc = null;
  if (reservationCode) {
    const bookingQuery = await db
      .collection("bookings")
      .where("parkingId", "==", parkingId)
      .where("reservationCode", "==", reservationCode)
      .where("status", "==", "reserved")
      .limit(1)
      .get();
    bookingDoc = bookingQuery.empty ? null : bookingQuery.docs[0];
  } else if (plateNumber) {
    const bookingQuery = await db
      .collection("bookings")
      .where("parkingId", "==", parkingId)
      .where("plateNumber", "==", plateNumber)
      .where("status", "==", "reserved")
      .orderBy("reservedAt", "desc")
      .limit(1)
      .get();
    bookingDoc = bookingQuery.empty ? null : bookingQuery.docs[0];
  }

  let finalPlateNumber = plateNumber;
  if (bookingDoc) {
    finalPlateNumber = bookingDoc.data().plateNumber;
  }

  if (!parkingId || !finalPlateNumber) {
    throw new FunctionError("invalid-argument", "parkingId and plateNumber (or reservationCode) are required.");
  }

  const activeSessionQuery = await db
    .collection("sessions")
    .where("plateNumber", "==", finalPlateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (!activeSessionQuery.empty) throw new FunctionError("already-exists", "Vehicle already checked in.");

  const now = nowMs();
  await assertPlateNotInUse(finalPlateNumber, {
    now,
    excludeBookingId: bookingDoc ? bookingDoc.id : "",
  });

  const parkingRef = db.collection("parkings").doc(parkingId);
  const sessionRef = db.collection("sessions").doc();
  let assignedSpot = null;

  await db.runTransaction(async (tx) => {
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    if (parking.status !== "active") throw new FunctionError("failed-precondition", "Parking inactive.");
    if (!ensureParkingInvariant(parking)) throw new FunctionError("failed-precondition", "Parking counters invalid.");

    let bookingId = null;
    let driverId = null;

    if (bookingDoc) {
      const bookingRef = bookingDoc.ref;
      const currentBooking = await tx.get(bookingRef);
      if (currentBooking.exists && currentBooking.data().status === "reserved") {
        const booking = currentBooking.data();
        bookingId = bookingRef.id;
        driverId = booking.driverId || null;
        assignedSpot = booking.spotId || null;

        tx.update(bookingRef, { status: "checked_in", checkInAt: ts(now), updatedAt: ts(now) });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          occupiedSlots: FieldValue.increment(1),
          updatedAt: ts(now),
        });
      }
    }

    if (!bookingId) {
      if (!allowWalkIn) {
        throw new FunctionError("failed-precondition", "No active reservation found. Enable walk-in check-in to proceed.");
      }
      if (toNumber(parking.availableSlots) <= 0) {
        throw new FunctionError("resource-exhausted", "No available slots for walk-in check-in.");
      }

      assignedSpot = await allocateSpot(parkingId, now, now + 24 * 60 * 60 * 1000, parking.slotCapacity);
      if (!assignedSpot) {
        throw new FunctionError("resource-exhausted", "No specific spots are currently available.");
      }

      tx.update(parkingRef, {
        availableSlots: FieldValue.increment(-1),
        occupiedSlots: FieldValue.increment(1),
        updatedAt: ts(now),
      });
    }

    tx.set(sessionRef, {
      parkingId,
      bookingId,
      ownerId: parking.ownerId || null,
      driverId,
      plateNumber: finalPlateNumber,
      entryTime: ts(now),
      exitTime: null,
      durationMinutes: null,
      billedHours: null,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount: null,
      paymentStatus: "unpaid",
      status: "active",
      spotId: assignedSpot,
      checkedInBy: actorUid,
      checkedOutBy: null,
      createdAt: ts(now),
      updatedAt: ts(now),
    });
  });

  await writeAuditLog("CHECK_IN_VEHICLE", actorUid, parkingId, { 
    plateNumber: finalPlateNumber, 
    sessionId: sessionRef.id, 
    spotId: assignedSpot 
  });

  return { 
    sessionId: sessionRef.id, 
    status: "active", 
    spotId: assignedSpot, 
    directions: getSpotDirections(assignedSpot, false),
    gateOpened: true 
  };
}

async function checkOutVehicle(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const parkingId = String(data?.parkingId || "").trim();
  const plateNumber = normalizePlate(data?.plateNumber);
  const paymentMethod = String(data?.paymentMethod || "cash").trim().toLowerCase(); // "cash" or "wallet"
  if (!parkingId || !plateNumber) {
    throw new FunctionError("invalid-argument", "parkingId and plateNumber are required.");
  }

  await assertOperatorAssigned(actorUid, parkingId);

  const activeSessionQuery = await db
    .collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (activeSessionQuery.empty) {
    throw new FunctionError("not-found", "No active session found for this plate number.");
  }

  const sessionRef = activeSessionQuery.docs[0].ref;
  const now = nowMs();
  let responseData = null;

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new FunctionError("not-found", "Session not found.");
    const session = sessionSnap.data();

    if (session.status !== "active") {
      throw new FunctionError("failed-precondition", "Session is not active.");
    }

    const parkingRef = db.collection("parkings").doc(parkingId);
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    const charge = computeDetailedSessionCharge(session.entryTime, now, parking.hourlyRate);
    const amountDue = charge.amountDue;
    const netAmount = charge.baseFare;
    const platformCommission = Math.round(netAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const ownerAmount = Math.round((netAmount - platformCommission) * 100) / 100;

    let driverNewBalance = null;

    if (paymentMethod === "wallet") {
      if (!session.driverId) {
        throw new FunctionError("failed-precondition", "This session was a walk-in without a registered driver. Cannot deduct from wallet. Please pay with cash.");
      }
      const userRef = db.collection("users").doc(session.driverId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new FunctionError("not-found", "Driver profile not found.");

      const currentBalance = toNumber(userSnap.data().walletBalance, 100.00);
      if (currentBalance < amountDue) {
        throw new FunctionError("failed-precondition", `Insufficient driver wallet balance. Fee due is ${amountDue} ETB, but driver's balance is ${currentBalance} ETB. Please pay with cash.`);
      }

      driverNewBalance = roundMoney(currentBalance - amountDue);
      tx.update(userRef, {
        walletBalance: driverNewBalance,
        updatedAt: ts(now)
      });
    }

    tx.update(sessionRef, {
      status: "completed",
      exitTime: ts(now),
      durationMinutes: charge.durationMinutes,
      billedHours: charge.billedHours,
      hourlyRate: toNumber(parking.hourlyRate, FLAT_HOURLY_RATE),
      feeAmount: amountDue,
      baseFare: charge.baseFare,
      tax: charge.tax,
      paymentStatus: "confirmed",
      paymentMethod,
      checkedOutBy: actorUid,
      checkedOutByRole: "operator",
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      occupiedSlots: FieldValue.increment(-1),
      availableSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    if (session.bookingId) {
      tx.set(
        db.collection("bookings").doc(session.bookingId),
        {
          status: "completed",
          checkOutAt: ts(now),
          updatedAt: ts(now),
        },
        { merge: true }
      );
    }

    const paymentRef = db.collection("payments").doc();
    tx.set(paymentRef, {
      sessionId: sessionRef.id,
      bookingId: session.bookingId || null,
      parkingId,
      ownerId: session.ownerId || null,
      driverId: session.driverId || null,
      grossAmount: amountDue,
      baseFare: charge.baseFare,
      tax: charge.tax,
      platformCommission,
      ownerAmount,
      method: paymentMethod,
      status: "confirmed",
      paidAt: ts(now),
      confirmedBy: actorUid,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    responseData = {
      sessionId: sessionRef.id,
      paymentId: paymentRef.id,
      status: "completed",
      gateOpened: true,
      receipt: {
        durationMinutes: charge.durationMinutes,
        billedHours: charge.billedHours,
        baseFare: charge.baseFare,
        tax: charge.tax,
        amountDue,
        paymentMethod,
        plateNumber,
        remainingBalance: driverNewBalance
      }
    };
  });

  await writeAuditLog("CHECK_OUT_VEHICLE_OPERATOR", actorUid, parkingId, {
    sessionId: responseData.sessionId,
    plateNumber,
    paymentMethod,
    amountDue: responseData.receipt.amountDue
  });

  return responseData;
}

async function submitManualPayment(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "driver");

  const parkingId = String(data?.parkingId || "").trim();
  const plateNumber = normalizePlate(data?.plateNumber);
  const method = normalizePaymentMethod(data?.method || "bank");
  const referenceCode = String(data?.referenceCode || "").trim();

  if (!parkingId || !plateNumber) {
    throw new FunctionError("invalid-argument", "parkingId and plateNumber are required.");
  }

  const result = await submitManualPaymentRequest({
    actorUid,
    parkingId,
    plateNumber,
    method,
    referenceCode,
  });

  await writeAuditLog("SUBMIT_MANUAL_PAYMENT", actorUid, parkingId, {
    requestId: result.requestId,
    sessionId: result.sessionId,
    method,
    amountDue: result.amountDue,
  });
  return result;
}

async function driverCheckOutVehicle(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "driver");

  const parkingId = String(data?.parkingId || "").trim();
  const plateNumber = normalizePlate(data?.plateNumber);
  if (!parkingId || !plateNumber) throw new FunctionError("invalid-argument", "parkingId and plateNumber are required.");

  const activeSessionQuery = await db
    .collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (activeSessionQuery.empty) {
    throw new FunctionError("not-found", "No active session found for this vehicle.");
  }

  const sessionRef = activeSessionQuery.docs[0].ref;
  const now = nowMs();
  let responseData = null;

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new FunctionError("not-found", "Session not found.");
    const session = sessionSnap.data();

    if (session.status !== "active") {
      throw new FunctionError("failed-precondition", "Session is not active.");
    }
    if (session.driverId !== actorUid) {
      throw new FunctionError("permission-denied", "Drivers can only checkout their own sessions.");
    }

    const parkingRef = db.collection("parkings").doc(parkingId);
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    const charge = computeDetailedSessionCharge(session.entryTime, now, parking.hourlyRate);
    const amountDue = charge.amountDue;
    const netAmount = charge.baseFare;
    const platformCommission = Math.round(netAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const ownerAmount = Math.round((netAmount - platformCommission) * 100) / 100;

    const userRef = db.collection("users").doc(actorUid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new FunctionError("not-found", "Driver profile not found.");

    const currentBalance = toNumber(userSnap.data().walletBalance, 100.00);
    if (currentBalance < amountDue) {
      throw new FunctionError("failed-precondition", `Insufficient wallet balance. Total due is ${amountDue} ETB, but your balance is ${currentBalance} ETB. Please top up.`);
    }

    const newBalance = roundMoney(currentBalance - amountDue);

    tx.update(userRef, {
      walletBalance: newBalance,
      updatedAt: ts(now)
    });

    tx.update(sessionRef, {
      status: "completed",
      exitTime: ts(now),
      durationMinutes: charge.durationMinutes,
      billedHours: charge.billedHours,
      hourlyRate: toNumber(parking.hourlyRate, FLAT_HOURLY_RATE),
      feeAmount: amountDue,
      baseFare: charge.baseFare,
      tax: charge.tax,
      paymentStatus: "confirmed",
      paymentMethod: "wallet",
      checkedOutBy: actorUid,
      checkedOutByRole: "driver",
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      occupiedSlots: FieldValue.increment(-1),
      availableSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    if (session.bookingId) {
      tx.set(
        db.collection("bookings").doc(session.bookingId),
        {
          status: "completed",
          checkOutAt: ts(now),
          updatedAt: ts(now),
        },
        { merge: true }
      );
    }

    const paymentRef = db.collection("payments").doc();
    tx.set(paymentRef, {
      sessionId: sessionRef.id,
      bookingId: session.bookingId || null,
      parkingId,
      ownerId: session.ownerId || null,
      driverId: actorUid,
      grossAmount: amountDue,
      baseFare: charge.baseFare,
      tax: charge.tax,
      platformCommission,
      ownerAmount,
      method: "wallet",
      status: "confirmed",
      paidAt: ts(now),
      confirmedBy: actorUid,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    responseData = {
      sessionId: sessionRef.id,
      paymentId: paymentRef.id,
      status: "completed",
      gateOpened: true,
      receipt: {
        durationMinutes: charge.durationMinutes,
        billedHours: charge.billedHours,
        baseFare: charge.baseFare,
        tax: charge.tax,
        amountDue,
        paymentMethod: "wallet",
        plateNumber,
        remainingBalance: newBalance
      }
    };
  });

  await writeAuditLog("DRIVER_CHECK_OUT_WALLET", actorUid, parkingId, {
    sessionId: responseData.sessionId,
    plateNumber,
    amountDue: responseData.receipt.amountDue,
    newBalance: responseData.receipt.remainingBalance
  });

  return responseData;
}

async function topUpWallet(data, auth) {
  const actorUid = auth?.uid;
  const profile = await requireRole(auth, "driver");

  const amount = toNumber(data?.amount, 0);
  if (amount <= 0) {
    throw new FunctionError("invalid-argument", "Top-up amount must be greater than zero.");
  }

  const userRef = db.collection("users").doc(actorUid);
  const now = nowMs();
  let newBalance = 0;

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new FunctionError("not-found", "Driver profile not found.");

    const currentBalance = toNumber(userSnap.data().walletBalance, 100.00);
    newBalance = roundMoney(currentBalance + amount);

    tx.update(userRef, {
      walletBalance: newBalance,
      updatedAt: ts(now)
    });
  });

  await writeAuditLog("WALLET_TOP_UP", actorUid, null, {
    amount,
    newBalance
  });

  return {
    success: true,
    amountAdded: amount,
    newBalance
  };
}

async function expireBookingsManual(data, auth) {
  const now = ts();
  const snapshot = await db
    .collection("bookings")
    .where("status", "==", "reserved")
    .where("expiresAt", "<=", now)
    .limit(200)
    .get();

  let expiredCount = 0;
  for (const docSnap of snapshot.docs) {
    const bookingRef = docSnap.ref;
    const booking = docSnap.data();
    const parkingRef = db.collection("parkings").doc(booking.parkingId);

    await db.runTransaction(async (tx) => {
      const freshBooking = await tx.get(bookingRef);
      if (!freshBooking.exists || freshBooking.data().status !== "reserved") return;
      const parkingSnap = await tx.get(parkingRef);
      if (!parkingSnap.exists) return;

      const driverId = booking.driverId;
      const userRef = driverId ? db.collection("users").doc(driverId) : null;
      let freshUser = null;
      if (userRef) {
        freshUser = await tx.get(userRef);
      }

      tx.update(bookingRef, { status: "expired", updatedAt: ts() });
      tx.update(parkingRef, {
        reservedSlots: FieldValue.increment(-1),
        availableSlots: FieldValue.increment(1),
        updatedAt: ts(),
      });

      if (userRef && freshUser && freshUser.exists) {
          const currentBal = toNumber(freshUser.data().walletBalance, 100.00);
          const fee = toNumber(booking.reservationFee, 20.00);
          tx.update(userRef, {
            walletBalance: roundMoney(currentBal - fee),
            updatedAt: ts()
          });
        }
      });
      expiredCount += 1;
    }

    return { expiredCount };
}

async function confirmManualPayment(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const requestId = String(data?.requestId || "").trim();
  if (!requestId) throw new FunctionError("invalid-argument", "requestId is required.");

  const paymentRequestRef = db.collection("paymentRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await paymentRequestRef.get();
  if (!preSnap.exists) throw new FunctionError("not-found", "Payment request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(paymentRequestRef);
    if (!reqSnap.exists) throw new FunctionError("not-found", "Payment request not found.");
    const paymentRequest = reqSnap.data();

    if (paymentRequest.status === "confirmed") {
      responseData = {
        requestId,
        sessionId: paymentRequest.sessionId,
        paymentId: paymentRequest.paymentId || requestId,
        status: "confirmed",
        amountDue: paymentRequest.amountDue,
        alreadyConfirmed: true,
      };
      return;
    }
    if (paymentRequest.status !== "pending") {
      throw new FunctionError("failed-precondition", "Only pending payment requests can be confirmed.");
    }

    const sessionRef = db.collection("sessions").doc(paymentRequest.sessionId);
    const parkingRef = db.collection("parkings").doc(paymentRequest.parkingId);
    const bookingRef = paymentRequest.bookingId ? db.collection("bookings").doc(paymentRequest.bookingId) : null;
    const paymentRef = db.collection("payments").doc(requestId);

    const [sessionSnap, parkingSnap] = await Promise.all([tx.get(sessionRef), tx.get(parkingRef)]);
    if (!sessionSnap.exists) throw new FunctionError("not-found", "Session not found.");
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");

    const session = sessionSnap.data();
    if (session.status !== "active") {
      throw new FunctionError("failed-precondition", "Session is already closed.");
    }

    const charge = computeDetailedSessionCharge(session.entryTime, now, FLAT_HOURLY_RATE);
    const feeAmount = charge.amountDue;
    const netAmount = charge.baseFare;
    const platformCommission = Math.round(netAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const ownerAmount = Math.round((netAmount - platformCommission) * 100) / 100;

    tx.update(sessionRef, {
      status: "completed",
      exitTime: ts(now),
      durationMinutes: charge.durationMinutes,
      billedHours: charge.billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount,
      baseFare: charge.baseFare,
      tax: charge.tax,
      paymentStatus: "confirmed",
      checkedOutBy: actorUid,
      checkedOutByRole: "operator",
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      occupiedSlots: FieldValue.increment(-1),
      availableSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    if (bookingRef) {
      tx.set(
        bookingRef,
        {
          status: "completed",
          checkOutAt: ts(now),
          updatedAt: ts(now),
        },
        { merge: true }
      );
    }

    tx.set(
      paymentRef,
      {
        sessionId: sessionRef.id,
        bookingId: paymentRequest.bookingId || null,
        parkingId: paymentRequest.parkingId,
        ownerId: paymentRequest.ownerId || null,
        driverId: paymentRequest.driverId || null,
        grossAmount: feeAmount,
        baseFare: charge.baseFare,
        tax: charge.tax,
        platformCommission,
        ownerAmount,
        method: paymentRequest.method || "manual",
        status: "confirmed",
        paidAt: ts(now),
        confirmedBy: actorUid,
        createdAt: ts(now),
        updatedAt: ts(now),
      },
      { merge: true }
    );

    tx.update(paymentRequestRef, {
      status: "confirmed",
      amountDue: feeAmount,
      billedHours: charge.billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
      confirmedAt: ts(now),
      confirmedBy: actorUid,
      rejectionReason: null,
      rejectedAt: null,
      rejectedBy: null,
      paymentId: paymentRef.id,
      updatedAt: ts(now),
    });

    responseData = {
      requestId,
      sessionId: sessionRef.id,
      paymentId: paymentRef.id,
      status: "confirmed",
      feeAmount,
      billedHours: charge.billedHours,
    };
  });

  await writeAuditLog("CONFIRM_MANUAL_PAYMENT", actorUid, preSnap.data().parkingId, {
    requestId,
    sessionId: responseData?.sessionId || null,
    paymentId: responseData?.paymentId || null,
    feeAmount: responseData?.feeAmount || null,
  });

  return responseData;
}

async function rejectManualPayment(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const requestId = String(data?.requestId || "").trim();
  const reason = String(data?.reason || "Payment not verified").trim();
  if (!requestId) throw new FunctionError("invalid-argument", "requestId is required.");

  const paymentRequestRef = db.collection("paymentRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await paymentRequestRef.get();
  if (!preSnap.exists) throw new FunctionError("not-found", "Payment request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(paymentRequestRef);
    if (!reqSnap.exists) throw new FunctionError("not-found", "Payment request not found.");
    const paymentRequest = reqSnap.data();

    if (paymentRequest.status === "rejected") {
      responseData = { requestId, status: "rejected", alreadyRejected: true };
      return;
    }
    if (paymentRequest.status !== "pending") {
      throw new FunctionError("failed-precondition", "Only pending payment requests can be rejected.");
    }

    const sessionRef = db.collection("sessions").doc(paymentRequest.sessionId);
    tx.update(paymentRequestRef, {
      status: "rejected",
      rejectionReason: reason,
      rejectedBy: actorUid,
      rejectedAt: ts(now),
      updatedAt: ts(now),
    });
    tx.set(
      sessionRef,
      {
        paymentStatus: "unpaid",
        updatedAt: ts(now),
      },
      { merge: true }
    );

    responseData = { requestId, status: "rejected" };
  });

  await writeAuditLog("REJECT_MANUAL_PAYMENT", actorUid, preSnap.data().parkingId, {
    requestId,
    reason,
  });
  return responseData;
}

async function getAdminAnalytics(data, auth) {
  await requireRole(auth, "admin");
  const range = parseAnalyticsRange(data || {});

  const [ownersSnap, parkingsSnap, operatorsSnap, paymentsSnap, sessionsSnap, pendingRequestsSnap] = await Promise.all([
    db.collection("owners").get(),
    db.collection("parkings").get(),
    db.collection("users").where("role", "==", "operator").get(),
    db.collection("payments").where("status", "==", "confirmed").get(),
    db.collection("sessions").where("status", "==", "completed").get(),
    db.collection("paymentRequests").where("status", "==", "pending").get(),
  ]);

  const owners = ownersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const parkings = parkingsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const operators = operatorsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const sessions = sessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const allPayments = paymentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const ownerNameById = {};
  owners.forEach((owner) => {
    ownerNameById[owner.ownerId || owner.id] = owner.fullName || owner.email || owner.ownerId || owner.id;
  });
  const parkingNameById = {};
  parkings.forEach((parking) => {
    parkingNameById[parking.id] = parking.name || parking.id;
  });

  const filteredPayments = allPayments.filter((payment) => {
    const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
    return paidAtMs && paidAtMs >= range.fromMs && paidAtMs <= range.toMs;
  });

  let totalGrossRevenue = 0;
  let totalOwnerRevenue = 0;
  let totalAdminCommission = 0;
  let totalTax = 0;
  const methodMap = {};
  const ownersAgg = {};
  const parkingsAgg = {};
  const seriesMap = buildSeriesSkeleton(range.fromMs, range.toMs);

  const paymentsTable = filteredPayments
    .map((payment) => {
      const split = normalizeSplit(payment.grossAmount, payment.ownerAmount, payment.platformCommission, payment.tax);
      const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
      const method = String(payment.method || "unknown").toLowerCase();

      totalGrossRevenue += split.grossAmount;
      totalOwnerRevenue += split.ownerAmount;
      totalAdminCommission += split.adminCommissionDerived;
      totalTax += split.tax;

      if (!methodMap[method]) methodMap[method] = { method, amount: 0, count: 0 };
      methodMap[method].amount += split.grossAmount;
      methodMap[method].count += 1;

      const ownerId = String(payment.ownerId || "unknown");
      if (!ownersAgg[ownerId]) {
        ownersAgg[ownerId] = {
          ownerId,
          ownerName: ownerNameById[ownerId] || ownerId,
          grossAmount: 0,
          ownerAmount: 0,
          adminCommission: 0,
          tax: 0,
          paymentsCount: 0,
        };
      }
      ownersAgg[ownerId].grossAmount += split.grossAmount;
      ownersAgg[ownerId].ownerAmount += split.ownerAmount;
      ownersAgg[ownerId].adminCommission += split.adminCommissionDerived;
      ownersAgg[ownerId].tax += split.tax;
      ownersAgg[ownerId].paymentsCount += 1;

      const parkingId = String(payment.parkingId || "unknown");
      if (!parkingsAgg[parkingId]) {
        parkingsAgg[parkingId] = {
          parkingId,
          parkingName: parkingNameById[parkingId] || parkingId,
          grossAmount: 0,
          ownerAmount: 0,
          adminCommission: 0,
          tax: 0,
          paymentsCount: 0,
        };
      }
      parkingsAgg[parkingId].grossAmount += split.grossAmount;
      parkingsAgg[parkingId].ownerAmount += split.ownerAmount;
      parkingsAgg[parkingId].adminCommission += split.adminCommissionDerived;
      parkingsAgg[parkingId].tax += split.tax;
      parkingsAgg[parkingId].paymentsCount += 1;

      if (paidAtMs) {
        const key = dayKey(paidAtMs);
        if (seriesMap[key]) {
          seriesMap[key].grossAmount += split.grossAmount;
          seriesMap[key].ownerAmount += split.ownerAmount;
          seriesMap[key].adminCommission += split.adminCommissionDerived;
          seriesMap[key].tax += split.tax;
          seriesMap[key].paymentsCount += 1;
        }
      }

      return {
        paymentId: payment.id,
        parkingId: payment.parkingId || "",
        parkingName: parkingNameById[payment.parkingId] || payment.parkingId || "unknown",
        ownerId: payment.ownerId || "",
        ownerName: ownerNameById[payment.ownerId] || payment.ownerId || "unknown",
        grossAmount: split.grossAmount,
        ownerAmount: split.ownerAmount,
        adminCommission: split.adminCommissionDerived,
        tax: split.tax,
        method,
        paidAtMs: paidAtMs || 0,
      };
    })
    .sort((a, b) => b.paidAtMs - a.paidAtMs)
    .slice(0, 150);

  return {
    range,
    summary: {
      owners: owners.length,
      operators: operators.length,
      parkings: parkings.length,
      activeParkings: parkings.filter((parking) => parking.status === "active").length,
      totalConfirmedPayments: filteredPayments.length,
      totalCompletedSessions: sessions.length,
      pendingPaymentRequests: pendingRequestsSnap.size,
      totalGrossRevenue: roundMoney(totalGrossRevenue),
      totalOwnerRevenue: roundMoney(totalOwnerRevenue),
      totalAdminCommission: roundMoney(totalAdminCommission),
      totalTax: roundMoney(totalTax),
    },
    revenueSeries: Object.values(seriesMap).sort((a, b) => a.key.localeCompare(b.key)),
    paymentMethodBreakdown: Object.values(methodMap).sort((a, b) => b.amount - a.amount),
    topOwners: Object.values(ownersAgg).sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 10),
    topParkings: Object.values(parkingsAgg).sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 10),
    paymentsTable,
  };
}

async function getOwnerAnalytics(data, auth) {
  const ownerProfile = await requireRole(auth, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new FunctionError("failed-precondition", "Owner profile is missing ownerId.");
  const range = parseAnalyticsRange(data || {});

  const [ownerSnap, parkingsSnap, operatorsSnap, sessionsSnap, paymentsSnap, pendingRequestsSnap] = await Promise.all([
    db.collection("owners").doc(ownerId).get(),
    db.collection("parkings").where("ownerId", "==", ownerId).get(),
    db.collection("users").where("ownerId", "==", ownerId).where("role", "==", "operator").get(),
    db.collection("sessions").where("ownerId", "==", ownerId).get(),
    db.collection("payments").where("ownerId", "==", ownerId).where("status", "==", "confirmed").get(),
    db.collection("paymentRequests").where("ownerId", "==", ownerId).where("status", "==", "pending").get(),
  ]);

  const ownerAccount = ownerSnap.exists ? ownerSnap.data() : {};
  if (isArchivedStatus(ownerAccount.status)) {
    throw new FunctionError("failed-precondition", "Owner account is archived. Contact admin to restore access.");
  }
  const parkings = parkingsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const ownedParkingIds = new Set(parkings.map((parking) => String(parking.id || "").trim()).filter(Boolean));
  const operators = operatorsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const sessions = sessionsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((session) => ownedParkingIds.has(String(session.parkingId || "").trim()));
  const allPayments = paymentsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((payment) => ownedParkingIds.has(String(payment.parkingId || "").trim()));
  const pendingRequests = pendingRequestsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((requestDoc) => ownedParkingIds.has(String(requestDoc.parkingId || "").trim()));

  const parkingNameById = {};
  parkings.forEach((parking) => {
    parkingNameById[parking.id] = parking.name || parking.id;
  });

  const filteredPayments = allPayments.filter((payment) => {
    const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
    return paidAtMs && paidAtMs >= range.fromMs && paidAtMs <= range.toMs;
  });

  const filteredCompletedSessions = sessions.filter((session) => {
    if (session.status !== "completed") return false;
    const exitMs = parseTimestampMs(session.exitTime || session.updatedAt || session.createdAt);
    return exitMs && exitMs >= range.fromMs && exitMs <= range.toMs;
  });

  let totalGrossRevenue = 0;
  let totalOwnerRevenue = 0;
  let totalAdminCommission = 0;
  let totalTax = 0;
  const methodMap = {};
  const parkingAgg = {};
  const seriesMap = buildSeriesSkeleton(range.fromMs, range.toMs);

  const paymentsTable = filteredPayments
    .map((payment) => {
      const split = normalizeSplit(payment.grossAmount, payment.ownerAmount, payment.platformCommission, payment.tax);
      const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
      const method = String(payment.method || "unknown").toLowerCase();

      totalGrossRevenue += split.grossAmount;
      totalOwnerRevenue += split.ownerAmount;
      totalAdminCommission += split.adminCommissionDerived;
      totalTax += split.tax;

      if (!methodMap[method]) methodMap[method] = { method, amount: 0, count: 0 };
      methodMap[method].amount += split.grossAmount;
      methodMap[method].count += 1;

      const parkingId = String(payment.parkingId || "unknown");
      if (!parkingAgg[parkingId]) {
        parkingAgg[parkingId] = {
          parkingId,
          parkingName: parkingNameById[parkingId] || parkingId,
          grossAmount: 0,
          ownerAmount: 0,
          adminCommission: 0,
          tax: 0,
          paymentsCount: 0,
          sessionsCount: 0,
        };
      }
      parkingAgg[parkingId].grossAmount += split.grossAmount;
      parkingAgg[parkingId].ownerAmount += split.ownerAmount;
      parkingAgg[parkingId].adminCommission += split.adminCommissionDerived;
      parkingAgg[parkingId].tax += split.tax;
      parkingAgg[parkingId].paymentsCount += 1;

      if (paidAtMs) {
        const key = dayKey(paidAtMs);
        if (seriesMap[key]) {
          seriesMap[key].grossAmount += split.grossAmount;
          seriesMap[key].ownerAmount += split.ownerAmount;
          seriesMap[key].adminCommission += split.adminCommissionDerived;
          seriesMap[key].tax += split.tax;
          seriesMap[key].paymentsCount += 1;
        }
      }

      return {
        paymentId: payment.id,
        parkingId: payment.parkingId || "",
        parkingName: parkingNameById[payment.parkingId] || payment.parkingId || "unknown",
        grossAmount: split.grossAmount,
        ownerAmount: split.ownerAmount,
        adminCommission: split.adminCommissionDerived,
        tax: split.tax,
        method,
        paidAtMs: paidAtMs || 0,
      };
    })
    .sort((a, b) => b.paidAtMs - a.paidAtMs)
    .slice(0, 150);

  filteredCompletedSessions.forEach((session) => {
    const parkingId = String(session.parkingId || "unknown");
    if (!parkingAgg[parkingId]) {
      parkingAgg[parkingId] = {
        parkingId,
        parkingName: parkingNameById[parkingId] || parkingId,
        grossAmount: 0,
        ownerAmount: 0,
        adminCommission: 0,
        tax: 0,
        paymentsCount: 0,
        sessionsCount: 0,
      };
    }
    parkingAgg[parkingId].sessionsCount += 1;
  });

  const totalCapacity = parkings.reduce((acc, parking) => acc + toNumber(parking.slotCapacity, 0), 0);
  const totalAvailable = parkings.reduce((acc, parking) => acc + toNumber(parking.availableSlots, 0), 0);
  const totalReserved = parkings.reduce((acc, parking) => acc + toNumber(parking.reservedSlots, 0), 0);
  const totalOccupied = parkings.reduce((acc, parking) => acc + toNumber(parking.occupiedSlots, 0), 0);

  return {
    ownerId,
    ownerAccount: {
      ownerId,
      fullName: ownerAccount.fullName || ownerProfile.fullName || "",
      email: ownerAccount.email || ownerProfile.email || "",
      phone: ownerAccount.phone || ownerProfile.phone || "",
      bankAccountNumber: ownerAccount.bankAccountNumber || "",
    },
    range,
    summary: {
      ownedParkings: parkings.length,
      activeOperators: operators.filter((operator) => operator.status === "active").length,
      inactiveOperators: operators.filter((operator) => operator.status !== "active").length,
      totalCapacity,
      totalAvailable,
      totalReserved,
      totalOccupied,
      pendingPaymentRequests: pendingRequests.length,
      totalCompletedSessions: filteredCompletedSessions.length,
      totalGrossRevenue: roundMoney(totalGrossRevenue),
      totalOwnerRevenue: roundMoney(totalOwnerRevenue),
      totalAdminCommission: roundMoney(totalAdminCommission),
      totalTax: roundMoney(totalTax),
    },
    revenueSeries: Object.values(seriesMap).sort((a, b) => a.key.localeCompare(b.key)),
    paymentMethodBreakdown: Object.values(methodMap).sort((a, b) => b.amount - a.amount),
    parkingsTable: Object.values(parkingAgg).sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 30),
    paymentsTable,
    operators: operators.map((operator) => ({
      id: operator.id,
      fullName: operator.fullName || "",
      email: operator.email || "",
      status: operator.status || "inactive",
      assignedParkingIds: (Array.isArray(operator.assignedParkingIds) ? operator.assignedParkingIds : []).filter(
        (parkingId) => ownedParkingIds.has(String(parkingId || "").trim())
      ),
    })),
    parkings: parkings.map((parking) => ({
      id: parking.id,
      name: parking.name || parking.id,
      address: parking.address || "",
      status: parking.status || "inactive",
      slotCapacity: toNumber(parking.slotCapacity, 0),
      availableSlots: toNumber(parking.availableSlots, 0),
      reservedSlots: toNumber(parking.reservedSlots, 0),
      occupiedSlots: toNumber(parking.occupiedSlots, 0),
      hourlyRate: toNumber(parking.hourlyRate, FLAT_HOURLY_RATE),
    })),
  };
}

async function createOwnerAccount(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "admin");

  const fullName = String(data?.fullName || "").trim();
  const email = normalizeEmail(data?.email);
  const password = String(data?.password || "").trim();
  const phone = String(data?.phone || "").trim();
  const bankAccountNumber = String(data?.bankAccountNumber || "").trim();

  if (!fullName || !email || !password) {
    throw new FunctionError("invalid-argument", "fullName, email, and password are required.");
  }
  if (password.length < 6) {
    throw new FunctionError("invalid-argument", "Password must be at least 6 characters.");
  }

  let ownerAuthUser = null;
  try {
    ownerAuthUser = await admin.auth().createUser({
      email,
      password,
      displayName: fullName,
    });
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new FunctionError("already-exists", "Email is already in use.");
    }
    throw new FunctionError("internal", "Failed to create owner auth account.");
  }

  const ownerUid = ownerAuthUser.uid;
  const ownerId = `owner_${ownerUid}`;
  const ownerRef = db.collection("owners").doc(ownerId);
  const userRef = db.collection("users").doc(ownerUid);
  const now = nowMs();

  await db.runTransaction(async (tx) => {
    tx.set(
      userRef,
      {
        fullName,
        email,
        phone,
        role: "owner",
        status: "active",
        ownerId,
        assignedParkingIds: [],
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(
      ownerRef,
      {
        ownerId,
        userId: ownerUid,
        fullName,
        email,
        phone,
        bankAccountNumber,
        status: "active",
        createdAt: ts(now),
        updatedAt: ts(now),
      },
      { merge: true }
    );
  });

  await writeAuditLog("CREATE_OWNER_ACCOUNT", actorUid, null, { ownerId, ownerUid, email });
  return { ownerId, userId: ownerUid, email };
}

async function adminArchiveOwner(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "admin");

  const ownerId = String(data?.ownerId || "").trim();
  const reason = String(data?.reason || "").trim();
  if (!ownerId) {
    throw new FunctionError("invalid-argument", "ownerId is required.");
  }

  const { ownerRef, ownerSnap, ownerData, ownerUserRef, ownerUserSnap } = await getOwnerAccountRefs(ownerId);
  if (!ownerUserRef || !ownerUserSnap?.exists) {
    throw new FunctionError("failed-precondition", "Owner auth profile was not found.", {
      reason: OWNER_ARCHIVE_REASONS.INVALID_OWNER_ROLE,
      ownerId,
    });
  }
  const ownerUser = ownerUserSnap.data() || {};
  if (String(ownerUser.role || "").trim().toLowerCase() !== "owner") {
    throw new FunctionError("failed-precondition", "Target user is not an owner.", {
      reason: OWNER_ARCHIVE_REASONS.INVALID_OWNER_ROLE,
      ownerId,
    });
  }

  const [activeSessionsSnap, reservedBookingsSnap, parkingsSnap, operatorsSnap] = await Promise.all([
    db.collection("sessions").where("ownerId", "==", ownerId).where("status", "==", "active").limit(1).get(),
    db.collection("bookings").where("ownerId", "==", ownerId).where("status", "==", "reserved").limit(400).get(),
    db.collection("parkings").where("ownerId", "==", ownerId).get(),
    db.collection("users").where("ownerId", "==", ownerId).where("role", "==", "operator").get(),
  ]);

  if (!activeSessionsSnap.empty) {
    throw new FunctionError(
      "failed-precondition",
      "Cannot deactivate owner while active sessions exist. Complete checkout first.",
      { reason: OWNER_ARCHIVE_REASONS.ACTIVE_SESSIONS, ownerId }
    );
  }
  const now = nowMs();
  const expiredReservedBookings = reservedBookingsSnap.docs.filter((doc) => isBookingExpired(doc.data() || {}, now));
  for (const expiredBooking of expiredReservedBookings) {
    await expireReservedBookingIfExpired(expiredBooking, now);
  }

  const blockingReservedBookings = reservedBookingsSnap.docs.filter((doc) => !isBookingExpired(doc.data() || {}, now));
  if (blockingReservedBookings.length) {
    throw new FunctionError(
      "failed-precondition",
      "Cannot deactivate owner while reserved bookings exist. Complete or cancel active reservations first.",
      { reason: OWNER_ARCHIVE_REASONS.RESERVED_BOOKINGS, ownerId }
    );
  }

  const parkings = parkingsSnap.docs.map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() || {} }));
  const operators = operatorsSnap.docs.map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() || {} }));

  const restoreSnapshot = {
    version: 1,
    capturedAt: ts(),
    ownerStatus: String(ownerData.status || ACTIVE_STATUS).trim().toLowerCase() || ACTIVE_STATUS,
    ownerUserStatus: String(ownerUser.status || ACTIVE_STATUS).trim().toLowerCase() || ACTIVE_STATUS,
    parkingStates: parkings.map((parking) => ({
      parkingId: parking.id,
      status: String(parking.data.status || INACTIVE_STATUS).trim().toLowerCase(),
    })),
    operatorStates: operators.map((operator) => ({
      operatorUid: operator.id,
      status: String(operator.data.status || INACTIVE_STATUS).trim().toLowerCase(),
      assignedParkingIds: normalizeStringArray(operator.data.assignedParkingIds),
    })),
  };

  await db.runTransaction(async (tx) => {
    const [freshOwnerSnap, freshOwnerUserSnap] = await Promise.all([tx.get(ownerRef), tx.get(ownerUserRef)]);
    if (!freshOwnerSnap.exists) throw new FunctionError("not-found", "Owner not found.");
    if (!freshOwnerUserSnap.exists) throw new FunctionError("not-found", "Owner auth profile not found.");

    const currentOwner = freshOwnerSnap.data() || {};
    const currentOwnerUser = freshOwnerUserSnap.data() || {};
    const currentOwnerStatus = String(currentOwner.status || "").trim().toLowerCase();
    const currentUserStatus = String(currentOwnerUser.status || "").trim().toLowerCase();
    if (currentOwnerStatus === ARCHIVE_STATUS || currentUserStatus === INACTIVE_STATUS) {
      return;
    }

    tx.set(
      ownerRef,
      {
        status: ARCHIVE_STATUS,
        archivedAt: ts(now),
        archivedBy: actorUid,
        archiveReason: reason || null,
        restoreSnapshot,
        updatedAt: ts(now),
      },
      { merge: true }
    );

    tx.set(
      ownerUserRef,
      {
        status: INACTIVE_STATUS,
        lifecycleStatus: ARCHIVE_STATUS,
        archivedAt: now,
        archivedBy: actorUid,
        archiveReason: reason || null,
        updatedAt: now,
      },
      { merge: true }
    );

    parkings.forEach((parking) => {
      tx.set(
        parking.ref,
        {
          status: INACTIVE_STATUS,
          archivedAt: ts(now),
          archivedBy: actorUid,
          archivedOwnerId: ownerId,
          updatedAt: ts(now),
        },
        { merge: true }
      );
    });

    operators.forEach((operator) => {
      tx.set(
        operator.ref,
        {
          status: INACTIVE_STATUS,
          assignedParkingIds: [],
          archivedAt: now,
          archivedBy: actorUid,
          archivedOwnerId: ownerId,
          updatedAt: now,
        },
        { merge: true }
      );
    });
  });

  await writeAuditLog("ADMIN_ARCHIVE_OWNER", actorUid, null, {
    ownerId,
    reason: reason || null,
    parkingsAffected: parkings.length,
    operatorsAffected: operators.length,
  });

  return {
    ownerId,
    status: ARCHIVE_STATUS,
    parkingsAffected: parkings.length,
    operatorsAffected: operators.length,
  };
}

async function adminRestoreOwner(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "admin");

  const ownerId = String(data?.ownerId || "").trim();
  if (!ownerId) {
    throw new FunctionError("invalid-argument", "ownerId is required.");
  }

  const { ownerRef, ownerSnap, ownerData, ownerUserRef, ownerUserSnap } = await getOwnerAccountRefs(ownerId);
  if (!ownerUserRef || !ownerUserSnap?.exists) {
    throw new FunctionError("failed-precondition", "Owner auth profile was not found.");
  }

  const restoreSnapshot = ownerData.restoreSnapshot || {};
  const parkingStates = Array.isArray(restoreSnapshot.parkingStates) ? restoreSnapshot.parkingStates : [];
  const operatorStates = Array.isArray(restoreSnapshot.operatorStates) ? restoreSnapshot.operatorStates : [];
  const parkingStateById = {};
  parkingStates.forEach((item) => {
    const parkingId = String(item?.parkingId || "").trim();
    if (!parkingId) return;
    parkingStateById[parkingId] = String(item?.status || INACTIVE_STATUS).trim().toLowerCase();
  });
  const operatorStateById = {};
  operatorStates.forEach((item) => {
    const operatorUid = String(item?.operatorUid || "").trim();
    if (!operatorUid) return;
    operatorStateById[operatorUid] = {
      status: String(item?.status || INACTIVE_STATUS).trim().toLowerCase(),
      assignedParkingIds: normalizeStringArray(item?.assignedParkingIds),
    };
  });

  const [parkingsSnap, operatorsSnap] = await Promise.all([
    db.collection("parkings").where("ownerId", "==", ownerId).get(),
    db.collection("users").where("ownerId", "==", ownerId).where("role", "==", "operator").get(),
  ]);
  const parkingIdSet = new Set(parkingsSnap.docs.map((doc) => doc.id));

  const now = nowMs();
  await db.runTransaction(async (tx) => {
    const [freshOwnerSnap, freshOwnerUserSnap] = await Promise.all([tx.get(ownerRef), tx.get(ownerUserRef)]);
    if (!freshOwnerSnap.exists) throw new FunctionError("not-found", "Owner not found.");
    if (!freshOwnerUserSnap.exists) throw new FunctionError("not-found", "Owner auth profile not found.");

    tx.set(
      ownerRef,
      {
        status: ACTIVE_STATUS,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        restoredAt: ts(now),
        restoredBy: actorUid,
        updatedAt: ts(now),
      },
      { merge: true }
    );

    tx.set(
      ownerUserRef,
      {
        status: ACTIVE_STATUS,
        lifecycleStatus: ACTIVE_STATUS,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        restoredAt: now,
        restoredBy: actorUid,
        updatedAt: now,
      },
      { merge: true }
    );

    parkingsSnap.docs.forEach((parkingDoc) => {
      const restoredStatus = parkingStateById[parkingDoc.id] || INACTIVE_STATUS;
      tx.set(
        parkingDoc.ref,
        {
          status: restoredStatus,
          archivedAt: null,
          archivedBy: null,
          archivedOwnerId: null,
          restoredAt: ts(now),
          restoredBy: actorUid,
          updatedAt: ts(now),
        },
        { merge: true }
      );
    });

    operatorsSnap.docs.forEach((operatorDoc) => {
      const restoreState = operatorStateById[operatorDoc.id] || { status: INACTIVE_STATUS, assignedParkingIds: [] };
      const restoredAssignedParkingIds = normalizeStringArray(restoreState.assignedParkingIds).filter((parkingId) =>
        parkingIdSet.has(parkingId)
      );
      tx.set(
        operatorDoc.ref,
        {
          status: restoreState.status || INACTIVE_STATUS,
          assignedParkingIds: restoredAssignedParkingIds,
          archivedAt: null,
          archivedBy: null,
          archivedOwnerId: null,
          restoredAt: now,
          restoredBy: actorUid,
          updatedAt: now,
        },
        { merge: true }
      );
    });
  });

  await writeAuditLog("ADMIN_RESTORE_OWNER", actorUid, null, {
    ownerId,
    restoredParkings: parkingsSnap.size,
    restoredOperators: operatorsSnap.size,
  });

  return {
    ownerId,
    status: ACTIVE_STATUS,
    restoredParkings: parkingsSnap.size,
    restoredOperators: operatorsSnap.size,
  };
}

async function createParkingCheckInToken(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const parkingId = String(data?.parkingId || "").trim();
  if (!parkingId) throw new FunctionError("invalid-argument", "parkingId is required.");
  await assertOperatorAssigned(actorUid, parkingId);

  const now = nowMs();
  const token = createRandomToken();
  const tokenRef = db.collection("checkInTokens").doc(token);
  const requestOrigin = (WEB_APP_BASE_URL || WEB_APP_BASE_URL).replace(/\/+$/, "");
  const deepLink = `${requestOrigin}/driver/checkin-confirm?token=${encodeURIComponent(token)}`;

  await tokenRef.set({
    tokenId: token,
    parkingId,
    operatorUid: actorUid,
    status: "active",
    expiresAt: ts(now + QR_TOKEN_TTL_MS),
    usedAt: null,
    usedByDriverUid: null,
    requestId: null,
    createdAt: ts(now),
    updatedAt: ts(now),
  });

  await writeAuditLog("CREATE_PARKING_CHECKIN_TOKEN", actorUid, parkingId, { tokenId: token });
  return { tokenId: token, parkingId, expiresAtMs: now + QR_TOKEN_TTL_MS, deepLink };
}

async function confirmCheckInFromQr(data, auth) {
  const actorUid = auth?.uid;
  const driverProfile = await requireRole(auth, "driver");

  const tokenId = String(data?.token || "").trim();
  const plateNumber = normalizePlate(data?.plateNumber);
  if (!tokenId || !plateNumber) {
    throw new FunctionError("invalid-argument", "token and plateNumber are required.");
  }

  const tokenRef = db.collection("checkInTokens").doc(tokenId);
  const now = nowMs();
  let responseData = null;

  await db.runTransaction(async (tx) => {
    const tokenSnap = await tx.get(tokenRef);
    if (!tokenSnap.exists) throw new FunctionError("not-found", "Invalid QR token.");
    const token = tokenSnap.data();
    const tokenExpiresMs = parseTimestampMs(token.expiresAt);
    if (token.status === "used" && token.usedByDriverUid === actorUid && token.requestId) {
      responseData = { requestId: token.requestId, status: "pending", parkingId: token.parkingId };
      return;
    }
    if (token.status !== "active" || tokenExpiresMs <= now) {
      tx.update(tokenRef, { status: "expired", updatedAt: ts(now) });
      throw new FunctionError("failed-precondition", "QR token expired. Ask operator to refresh.");
    }

    const parkingRef = db.collection("parkings").doc(token.parkingId);
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    const parking = parkingSnap.data();
    if (parking.status !== "active") throw new FunctionError("failed-precondition", "Parking inactive.");
    if (toNumber(parking.availableSlots) <= 0) throw new FunctionError("resource-exhausted", "No available slots.");
    if (!ensureParkingInvariant(parking)) throw new FunctionError("failed-precondition", "Parking counters invalid.");

    const existingRequestQuery = db
      .collection("checkInRequests")
      .where("driverUid", "==", actorUid)
      .where("status", "==", "pending")
      .limit(20);
    const existingRequestSnap = await tx.get(existingRequestQuery);
    const existingRequest = existingRequestSnap.docs.find((doc) => doc.data().parkingId === token.parkingId);
    if (existingRequest) {
      tx.update(tokenRef, {
        status: "used",
        usedAt: ts(now),
        usedByDriverUid: actorUid,
        requestId: existingRequest.id,
        updatedAt: ts(now),
      });
      responseData = { requestId: existingRequest.id, status: "pending", parkingId: token.parkingId };
      return;
    }

    const existingBookingQuery = db
      .collection("bookings")
      .where("driverId", "==", actorUid)
      .where("status", "==", "reserved")
      .orderBy("reservedAt", "desc")
      .limit(20);
    const existingBookingSnap = await tx.get(existingBookingQuery);

    let bookingDoc = null;
    existingBookingSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (!bookingDoc && data.parkingId === token.parkingId && data.plateNumber === plateNumber) {
        bookingDoc = doc;
      }
    });

    let bookingRef = bookingDoc ? bookingDoc.ref : null;
    const activeSessionByPlateQuery = db
      .collection("sessions")
      .where("plateNumber", "==", plateNumber)
      .where("status", "==", "active")
      .limit(1);
    const activeSessionByPlateSnap = await tx.get(activeSessionByPlateQuery);
    if (!activeSessionByPlateSnap.empty) {
      throw new FunctionError("already-exists", "This plate already has an active parking session.");
    }

    const reservedByPlateQuery = db
      .collection("bookings")
      .where("plateNumber", "==", plateNumber)
      .where("status", "==", "reserved")
      .limit(40);
    const reservedByPlateSnap = await tx.get(reservedByPlateQuery);
    const hasReservedConflict = reservedByPlateSnap.docs.some((doc) => {
      if (bookingDoc && doc.id === bookingDoc.id) return false;
      const reservedBooking = doc.data() || {};
      return !isBookingExpired(reservedBooking, now);
    });
    if (hasReservedConflict) {
      throw new FunctionError("already-exists", "This plate already has an active reservation.");
    }

    let autoCreatedBooking = false;
    if (!bookingRef) {
      bookingRef = db.collection("bookings").doc();
      autoCreatedBooking = true;
      tx.set(bookingRef, {
        parkingId: token.parkingId,
        ownerId: parking.ownerId || null,
        driverId: actorUid,
        driverEmail: driverProfile.email || "",
        plateNumber,
        status: "reserved",
        reservedAt: ts(now),
        expiresAt: ts(now + BOOKING_TTL_MINUTES * 60 * 1000),
        checkInAt: null,
        checkOutAt: null,
        createdAt: ts(now),
        updatedAt: ts(now),
      });
      tx.update(parkingRef, {
        availableSlots: FieldValue.increment(-1),
        reservedSlots: FieldValue.increment(1),
        updatedAt: ts(now),
      });
    }

    const requestRef = db.collection("checkInRequests").doc();
    tx.set(requestRef, {
      requestId: requestRef.id,
      parkingId: token.parkingId,
      ownerId: parking.ownerId || null,
      operatorUid: token.operatorUid || null,
      driverUid: actorUid,
      bookingId: bookingRef.id,
      plateNumber,
      tokenId,
      autoCreatedBooking,
      status: "pending",
      createdAt: ts(now),
      updatedAt: ts(now),
      approvedAt: null,
      rejectedAt: null,
      rejectedReason: null,
    });

    tx.update(tokenRef, {
      status: "used",
      usedAt: ts(now),
      usedByDriverUid: actorUid,
      requestId: requestRef.id,
      updatedAt: ts(now),
    });

    responseData = { requestId: requestRef.id, status: "pending", parkingId: token.parkingId };
  });

  await writeAuditLog("CONFIRM_CHECKIN_FROM_QR", actorUid, responseData?.parkingId, {
    requestId: responseData?.requestId || null,
    plateNumber,
  });
  return responseData;
}

async function approveCheckInRequest(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const requestId = String(data?.requestId || "").trim();
  if (!requestId) throw new FunctionError("invalid-argument", "requestId is required.");

  const checkInRequestRef = db.collection("checkInRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await checkInRequestRef.get();
  if (!preSnap.exists) throw new FunctionError("not-found", "Check-in request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(checkInRequestRef);
    if (!reqSnap.exists) throw new FunctionError("not-found", "Check-in request not found.");
    const checkInRequest = reqSnap.data();
    if (checkInRequest.status !== "pending") {
      throw new FunctionError("failed-precondition", "Request is no longer pending.");
    }

    const parkingRef = db.collection("parkings").doc(checkInRequest.parkingId);
    const bookingRef = db.collection("bookings").doc(checkInRequest.bookingId);
    const sessionRef = db.collection("sessions").doc();

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    const parking = parkingSnap.data();
    if (parking.status !== "active") throw new FunctionError("failed-precondition", "Parking inactive.");
    if (!ensureParkingInvariant(parking)) throw new FunctionError("failed-precondition", "Parking counters invalid.");

    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new FunctionError("not-found", "Booking not found for check-in request.");
    const booking = bookingSnap.data();
    if (booking.status !== "reserved") {
      throw new FunctionError("failed-precondition", "Booking is not reserved anymore.");
    }

    const activeSessionQuery = db
      .collection("sessions")
      .where("plateNumber", "==", checkInRequest.plateNumber)
      .where("status", "==", "active")
      .limit(1);
    const activeSessionSnap = await tx.get(activeSessionQuery);
    if (!activeSessionSnap.empty) throw new FunctionError("already-exists", "Vehicle already checked in.");

    tx.update(bookingRef, {
      status: "checked_in",
      checkInAt: ts(now),
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      reservedSlots: FieldValue.increment(-1),
      occupiedSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    tx.set(sessionRef, {
      parkingId: checkInRequest.parkingId,
      bookingId: checkInRequest.bookingId,
      ownerId: checkInRequest.ownerId || booking.ownerId || null,
      driverId: checkInRequest.driverUid,
      plateNumber: checkInRequest.plateNumber,
      entryTime: ts(now),
      exitTime: null,
      durationMinutes: null,
      billedHours: null,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount: null,
      paymentStatus: "unpaid",
      status: "active",
      checkedInBy: actorUid,
      checkedOutBy: null,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    tx.update(checkInRequestRef, {
      status: "approved",
      approvedBy: actorUid,
      approvedAt: ts(now),
      sessionId: sessionRef.id,
      updatedAt: ts(now),
    });

    responseData = { requestId, sessionId: sessionRef.id, status: "approved", parkingId: checkInRequest.parkingId };
  });

  await writeAuditLog("APPROVE_CHECKIN_REQUEST", actorUid, responseData?.parkingId, {
    requestId,
    sessionId: responseData?.sessionId || null,
  });
  return responseData;
}

async function rejectCheckInRequest(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "operator");

  const requestId = String(data?.requestId || "").trim();
  if (!requestId) throw new FunctionError("invalid-argument", "requestId is required.");

  const checkInRequestRef = db.collection("checkInRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await checkInRequestRef.get();
  if (!preSnap.exists) throw new FunctionError("not-found", "Check-in request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(checkInRequestRef);
    if (!reqSnap.exists) throw new FunctionError("not-found", "Check-in request not found.");
    const checkInRequest = reqSnap.data();
    if (checkInRequest.status !== "pending") {
      throw new FunctionError("failed-precondition", "Request is no longer pending.");
    }
    const parkingRef = db.collection("parkings").doc(checkInRequest.parkingId);
    const bookingRef = db.collection("bookings").doc(checkInRequest.bookingId);

    tx.update(checkInRequestRef, {
      status: "rejected",
      rejectedBy: actorUid,
      rejectedAt: ts(now),
      rejectedReason: String(data?.reason || "Operator rejected"),
      updatedAt: ts(now),
    });

    if (checkInRequest.autoCreatedBooking) {
      const bookingSnap = await tx.get(bookingRef);
      if (bookingSnap.exists && bookingSnap.data().status === "reserved") {
        tx.update(bookingRef, {
          status: "cancelled",
          updatedAt: ts(now),
        });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          availableSlots: FieldValue.increment(1),
          updatedAt: ts(now),
        });
      }
    }

    responseData = { requestId, status: "rejected", parkingId: checkInRequest.parkingId };
  });

  await writeAuditLog("REJECT_CHECKIN_REQUEST", actorUid, responseData?.parkingId, { requestId });
  return responseData;
}

async function createOwnerProfile(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "admin");

  const ownerId = String(data?.ownerId || "").trim();
  const userId = String(data?.userId || "").trim();
  const fullName = String(data?.fullName || "").trim();
  const email = String(data?.email || "").trim();
  const phone = String(data?.phone || "").trim();
  const bankAccountNumber = String(data?.bankAccountNumber || "").trim();

  if (!ownerId || !userId || !fullName || !email) {
    throw new FunctionError("invalid-argument", "ownerId, userId, fullName, and email are required.");
  }

  const ownerRef = db.collection("owners").doc(ownerId);
  const userRef = db.collection("users").doc(userId);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new FunctionError("not-found", "Target user not found.");

    tx.set(
      ownerRef,
      {
        ownerId,
        userId,
        fullName,
        email,
        phone,
        bankAccountNumber,
        status: "active",
        createdAt: ts(),
        updatedAt: ts(),
      },
      { merge: true }
    );

    tx.set(
      userRef,
      {
        role: "owner",
        ownerId,
        status: "active",
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  });

  await writeAuditLog("CREATE_OWNER_PROFILE", actorUid, null, { ownerId, userId });
  return { ownerId, userId, status: "active" };
}

async function upsertParking(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "admin");

  const parkingIdInput = String(data?.parkingId || "").trim();
  const ownerId = String(data?.ownerId || "").trim();
  const name = String(data?.name || "").trim();
  const address = String(data?.address || "").trim();
  const status = String(data?.status || "active").trim();
  const slotCapacity = toNumber(data?.slotCapacity, 0);
  const availableSlots = toNumber(data?.availableSlots, slotCapacity);
  const reservedSlots = toNumber(data?.reservedSlots, 0);
  const occupiedSlots = toNumber(data?.occupiedSlots, 0);
  const hourlyRate = toNumber(data?.hourlyRate, 50);
  const lat = toNumber(data?.lat, null);
  const lng = toNumber(data?.lng, null);

  if (!ownerId || !name) throw new FunctionError("invalid-argument", "ownerId and name are required.");
  if (slotCapacity < 0 || hourlyRate < 0) throw new FunctionError("invalid-argument", "slotCapacity/hourlyRate must be non-negative.");
  if (availableSlots + reservedSlots + occupiedSlots !== slotCapacity) {
    throw new FunctionError("invalid-argument", "Parking counters must satisfy available+reserved+occupied=slotCapacity.");
  }

  const ownerSnap = await db.collection("owners").doc(ownerId).get();
  if (!ownerSnap.exists) {
    throw new FunctionError("not-found", "Owner account not found.");
  }
  if (isArchivedStatus(ownerSnap.data()?.status)) {
    throw new FunctionError("failed-precondition", "Cannot create or update parking for an archived owner.");
  }

  const parkingRef = parkingIdInput ? db.collection("parkings").doc(parkingIdInput) : db.collection("parkings").doc();
  await parkingRef.set(
    {
      ownerId,
      name,
      address,
      status,
      slotCapacity,
      availableSlots,
      reservedSlots,
      occupiedSlots,
      hourlyRate,
      location: lat != null && lng != null ? { lat, lng } : null,
      updatedAt: ts(),
      createdAt: ts(),
    },
    { merge: true }
  );

  await writeAuditLog("UPSERT_PARKING", actorUid, parkingRef.id, { ownerId });
  return { parkingId: parkingRef.id, status };
}

async function assignOperatorToParking(data, auth) {
  const actorUid = auth?.uid;
  await requireRole(auth, "admin");

  const operatorUid = String(data?.operatorUid || "").trim();
  const parkingId = String(data?.parkingId || "").trim();
  const assign = data?.assign !== false;
  if (!operatorUid || !parkingId) throw new FunctionError("invalid-argument", "operatorUid and parkingId are required.");

  const userRef = db.collection("users").doc(operatorUid);
  const parkingRef = db.collection("parkings").doc(parkingId);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new FunctionError("not-found", "Operator user not found.");
    const role = userSnap.data().role;
    if (role !== "operator") throw new FunctionError("failed-precondition", "Target user is not an operator.");

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new FunctionError("not-found", "Parking not found.");
    const parkingOwnerId = String(parkingSnap.data()?.ownerId || "").trim();
    if (!parkingOwnerId) {
      throw new FunctionError("failed-precondition", "Parking ownerId is missing.");
    }
    const ownerRef = db.collection("owners").doc(parkingOwnerId);
    const ownerSnap = await tx.get(ownerRef);
    if (!ownerSnap.exists) {
      throw new FunctionError("not-found", "Parking owner not found.");
    }
    if (assign && isArchivedStatus(ownerSnap.data()?.status)) {
      throw new FunctionError("failed-precondition", "Cannot assign operators to an archived owner.");
    }

    tx.update(userRef, {
      assignedParkingIds: assign ? FieldValue.arrayUnion(parkingId) : FieldValue.arrayRemove(parkingId),
      updatedAt: Date.now(),
    });
  });

  await writeAuditLog("ASSIGN_OPERATOR_TO_PARKING", actorUid, parkingId, { operatorUid, assign });
  return { operatorUid, parkingId, assign };
}

async function ownerCreateOperator(data, auth) {
  const actorUid = auth?.uid;
  const ownerProfile = await requireRole(auth, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();

  if (!ownerId) throw new FunctionError("failed-precondition", "Owner profile is missing ownerId.");
  await assertOwnerAccountActive(ownerId);

  const email = normalizeEmail(data?.email);
  const fullName = String(data?.fullName || "").trim();
  const password = String(data?.password || "").trim();
  const phone = String(data?.phone || "").trim();
  const assignedParkingIdsRaw = Array.isArray(data?.assignedParkingIds) ? data.assignedParkingIds : [];
  const assignedParkingIds = [...new Set(assignedParkingIdsRaw.map((id) => String(id || "").trim()).filter(Boolean))];

  if (!email || !fullName || !password) {
    throw new FunctionError("invalid-argument", "email, fullName, and password are required.");
  }
  if (password.length < 6) {
    throw new FunctionError("invalid-argument", "Password must be at least 6 characters.");
  }
  if (!assignedParkingIds.length) {
    throw new FunctionError("invalid-argument", "At least one parking assignment is required.");
  }

  for (const parkingId of assignedParkingIds) {
    await assertOwnerControlsParking(ownerId, parkingId);
  }

  let targetAuthUser = null;
  try {
    targetAuthUser = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new FunctionError("internal", "Failed to lookup operator account.");
    }
  }

  if (!targetAuthUser) {
    targetAuthUser = await admin.auth().createUser({
      email,
      password,
      displayName: fullName,
    });
  }

  const operatorUid = targetAuthUser.uid;
  const operatorRef = db.collection("users").doc(operatorUid);

  await db.runTransaction(async (tx) => {
    const operatorSnap = await tx.get(operatorRef);
    const existing = operatorSnap.exists ? operatorSnap.data() : null;

    if (existing?.role && existing.role !== "operator") {
      throw new FunctionError("failed-precondition", "Existing user is not an operator.");
    }
    if (existing?.ownerId && existing.ownerId !== ownerId) {
      throw new FunctionError("permission-denied", "Operator is already bound to a different owner.");
    }

    tx.set(
      operatorRef,
      {
        fullName,
        email,
        phone,
        role: "operator",
        status: "active",
        ownerId,
        assignedParkingIds,
        createdByOwnerUid: actorUid,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  });

  await writeAuditLog("OWNER_CREATE_OPERATOR", actorUid, null, { operatorUid, ownerId, assignedParkingIds });
  return { operatorUid, ownerId, assignedParkingIds, status: "active" };
}

async function ownerUpdateOperatorAssignments(data, auth) {
  const actorUid = auth?.uid;
  const ownerProfile = await requireRole(auth, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new FunctionError("failed-precondition", "Owner profile is missing ownerId.");
  await assertOwnerAccountActive(ownerId);

  const operatorUid = String(data?.operatorUid || "").trim();
  const assignedParkingIdsRaw = Array.isArray(data?.assignedParkingIds) ? data.assignedParkingIds : [];
  const assignedParkingIds = [...new Set(assignedParkingIdsRaw.map((id) => String(id || "").trim()).filter(Boolean))];

  if (!operatorUid) throw new FunctionError("invalid-argument", "operatorUid is required.");
  if (!assignedParkingIds.length) {
    throw new FunctionError("invalid-argument", "At least one parking assignment is required.");
  }

  for (const parkingId of assignedParkingIds) {
    await assertOwnerControlsParking(ownerId, parkingId);
  }

  const operatorRef = db.collection("users").doc(operatorUid);
  await db.runTransaction(async (tx) => {
    const operatorSnap = await tx.get(operatorRef);
    if (!operatorSnap.exists) throw new FunctionError("not-found", "Operator user not found.");
    const operator = operatorSnap.data();
    if (operator.role !== "operator") throw new FunctionError("failed-precondition", "Target user is not an operator.");
    if (String(operator.ownerId || "") !== ownerId) {
      throw new FunctionError("permission-denied", "This operator does not belong to this owner.");
    }

    tx.update(operatorRef, {
      assignedParkingIds,
      updatedAt: Date.now(),
    });
  });

  await writeAuditLog("OWNER_UPDATE_OPERATOR_ASSIGNMENTS", actorUid, null, { operatorUid, ownerId, assignedParkingIds });
  return { operatorUid, assignedParkingIds };
}

async function ownerSetOperatorStatus(data, auth) {
  const actorUid = auth?.uid;
  const ownerProfile = await requireRole(auth, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new FunctionError("failed-precondition", "Owner profile is missing ownerId.");
  await assertOwnerAccountActive(ownerId);

  const operatorUid = String(data?.operatorUid || "").trim();
  const status = String(data?.status || "").trim().toLowerCase();
  if (!operatorUid) throw new FunctionError("invalid-argument", "operatorUid is required.");
  if (!["active", "inactive"].includes(status)) {
    throw new FunctionError("invalid-argument", "status must be active or inactive.");
  }

  const operatorRef = db.collection("users").doc(operatorUid);
  await db.runTransaction(async (tx) => {
    const operatorSnap = await tx.get(operatorRef);
    if (!operatorSnap.exists) throw new FunctionError("not-found", "Operator user not found.");
    const operator = operatorSnap.data();
    if (operator.role !== "operator") throw new FunctionError("failed-precondition", "Target user is not an operator.");
    if (String(operator.ownerId || "") !== ownerId) {
      throw new FunctionError("permission-denied", "This operator does not belong to this owner.");
    }

    tx.update(operatorRef, {
      status,
      updatedAt: Date.now(),
    });
  });

  await writeAuditLog("OWNER_SET_OPERATOR_STATUS", actorUid, null, { operatorUid, ownerId, status });
  return { operatorUid, status };
}

async function ownerUpdatePaymentDetails(data, auth) {
  const actorUid = auth?.uid;
  const ownerProfile = await requireRole(auth, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new FunctionError("failed-precondition", "Owner profile is missing ownerId.");
  await assertOwnerAccountActive(ownerId);

  const phone = String(data?.phone || "").trim();
  const bankAccountNumber = String(data?.bankAccountNumber || "").trim();
  if (!phone && !bankAccountNumber) {
    throw new FunctionError("invalid-argument", "At least one of phone or bankAccountNumber is required.");
  }

  const ownerRef = db.collection("owners").doc(ownerId);
  const userRef = db.collection("users").doc(actorUid);
  const now = nowMs();

  await db.runTransaction(async (tx) => {
    const ownerSnap = await tx.get(ownerRef);
    if (!ownerSnap.exists) throw new FunctionError("not-found", "Owner profile document not found.");

    const updatePayload = {
      updatedAt: ts(now),
    };
    if (data?.phone !== undefined) updatePayload.phone = phone;
    if (data?.bankAccountNumber !== undefined) updatePayload.bankAccountNumber = bankAccountNumber;

    tx.set(ownerRef, updatePayload, { merge: true });
    if (data?.phone !== undefined) {
      tx.set(userRef, { phone, updatedAt: Date.now() }, { merge: true });
    }
  });

  await writeAuditLog("OWNER_UPDATE_PAYMENT_DETAILS", actorUid, null, {
    ownerId,
    updatedPhone: data?.phone !== undefined,
    updatedBankAccountNumber: data?.bankAccountNumber !== undefined,
  });

  return {
    ownerId,
    phone: data?.phone !== undefined ? phone : null,
    bankAccountNumber: data?.bankAccountNumber !== undefined ? bankAccountNumber : null,
    updatedAtMs: now,
  };
}

async function getParkingPaymentDetails(data, auth) {
  const actorUid = auth?.uid;
  if (!actorUid) {
    throw new FunctionError("unauthenticated", "Authentication required.");
  }

  const parkingId = String(data?.parkingId || "").trim();
  if (!parkingId) {
    throw new FunctionError("invalid-argument", "parkingId is required.");
  }

  const profile = await getUserProfile(actorUid);
  if (!profile) {
    throw new FunctionError("failed-precondition", "User profile not found.");
  }
  if (profile.status && profile.status !== "active") {
    throw new FunctionError("permission-denied", "User is not active.");
  }

  const allowedRoles = ["driver", "operator", "owner", "admin"];
  if (!allowedRoles.includes(profile.role)) {
    throw new FunctionError("permission-denied", "Role not allowed.");
  }

  if (profile.role === "operator") {
    await assertOperatorAssigned(actorUid, parkingId);
  } else if (profile.role === "owner") {
    const ownerId = String(profile.ownerId || "").trim();
    if (!ownerId) {
      throw new FunctionError("failed-precondition", "Owner profile is missing ownerId.");
    }
    await assertOwnerControlsParking(ownerId, parkingId);
  } else if (profile.role === "driver") {
    await assertDriverHasParkingAccess(actorUid, parkingId);
  }

  const parkingSnap = await db.collection("parkings").doc(parkingId).get();
  if (!parkingSnap.exists) {
    throw new FunctionError("not-found", "Parking not found.");
  }
  const parking = parkingSnap.data();
  const ownerId = String(parking.ownerId || "").trim();
  if (!ownerId) {
    return { parkingId, ownerId: null, phone: "", bankAccountNumber: "" };
  }

  const ownerSnap = await db.collection("owners").doc(ownerId).get();
  const owner = ownerSnap.exists ? ownerSnap.data() : {};

  return {
    parkingId,
    ownerId,
    phone: String(owner.phone || "").trim(),
    bankAccountNumber: String(owner.bankAccountNumber || "").trim(),
  };
}


const handlers = {
  listPendingPaymentsForOperator,
  listPendingPaymentsForDriver,
  getPendingPaymentForSession,
  createBooking,
  checkInVehicle,
  checkOutVehicle,
  submitManualPayment,
  driverCheckOutVehicle,
  topUpWallet,
  expireBookingsManual,
  confirmManualPayment,
  rejectManualPayment,
  getAdminAnalytics,
  getOwnerAnalytics,
  createOwnerAccount,
  adminArchiveOwner,
  adminRestoreOwner,
  createParkingCheckInToken,
  confirmCheckInFromQr,
  approveCheckInRequest,
  rejectCheckInRequest,
  createOwnerProfile,
  upsertParking,
  assignOperatorToParking,
  ownerCreateOperator,
  ownerUpdateOperatorAssignments,
  ownerSetOperatorStatus,
  ownerUpdatePaymentDetails,
  getParkingPaymentDetails,
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed", status: "UNIMPLEMENTED" } });
  }

  const functionName = req.query.name;
  if (!functionName || !handlers[functionName]) {
    return res.status(400).json({ error: { message: "Unknown function: " + functionName, status: "INVALID_ARGUMENT" } });
  }

  const authHeader = req.headers.authorization;
  let auth = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split("Bearer ")[1];
      const decoded = await admin.auth().verifyIdToken(token);
      auth = { uid: decoded.uid, token: decoded };
    } catch (e) {
      return res.status(401).json({ error: { message: "Unauthorized", status: "UNAUTHENTICATED" } });
    }
  }

  const data = (req.body && req.body.data) || req.body || {};

  try {
    const result = await handlers[functionName](data, auth);
    return res.status(200).json({ data: result });
  } catch (error) {
    if (error instanceof FunctionError) {
      return res.status(400).json({
        error: { message: error.message, status: error.code, details: error.details }
      });
    }
    console.error("Error in " + functionName + ":", error);
    return res.status(500).json({
      error: { message: "Internal server error", status: "INTERNAL" }
    });
  }
};
