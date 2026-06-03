import { z } from "zod";
import { auth, firestore } from "../../firebase";
import callApi from "../callApi";

const adminAnalyticsSchema = z.object({
  range: z.object({
    preset: z.string(),
    fromMs: z.number(),
    toMs: z.number(),
  }),
  summary: z.object({
    owners: z.number(),
    operators: z.number(),
    parkings: z.number(),
    activeParkings: z.number(),
    totalConfirmedPayments: z.number(),
    totalCompletedSessions: z.number(),
    pendingPaymentRequests: z.number(),
    totalGrossRevenue: z.number(),
    totalOwnerRevenue: z.number(),
    totalAdminCommission: z.number(),
    totalTax: z.number(),
  }),
  revenueSeries: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      paymentsCount: z.number(),
    }),
  ),
  paymentMethodBreakdown: z.array(
    z.object({ method: z.string(), amount: z.number(), count: z.number() }),
  ),
  topOwners: z.array(
    z.object({
      ownerId: z.string(),
      ownerName: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      paymentsCount: z.number(),
    }),
  ),
  topParkings: z.array(
    z.object({
      parkingId: z.string(),
      parkingName: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      paymentsCount: z.number(),
    }),
  ),
  paymentsTable: z.array(
    z.object({
      paymentId: z.string(),
      parkingId: z.string(),
      parkingName: z.string(),
      ownerId: z.string(),
      ownerName: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      method: z.string(),
      paidAtMs: z.number(),
    }),
  ),
});

const ownerAnalyticsSchema = z.object({
  ownerId: z.string(),
  ownerAccount: z.object({
    ownerId: z.string(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
    bankAccountNumber: z.string(),
  }),
  range: z.object({
    preset: z.string(),
    fromMs: z.number(),
    toMs: z.number(),
  }),
  summary: z.object({
    ownedParkings: z.number(),
    activeOperators: z.number(),
    inactiveOperators: z.number(),
    totalCapacity: z.number(),
    totalAvailable: z.number(),
    totalReserved: z.number(),
    totalOccupied: z.number(),
    pendingPaymentRequests: z.number(),
    totalCompletedSessions: z.number(),
    totalGrossRevenue: z.number(),
    totalOwnerRevenue: z.number(),
    totalAdminCommission: z.number(),
    totalTax: z.number(),
  }),
  revenueSeries: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      paymentsCount: z.number(),
    }),
  ),
  paymentMethodBreakdown: z.array(
    z.object({ method: z.string(), amount: z.number(), count: z.number() }),
  ),
  parkingsTable: z.array(
    z.object({
      parkingId: z.string(),
      parkingName: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      paymentsCount: z.number(),
      sessionsCount: z.number(),
    }),
  ),
  paymentsTable: z.array(
    z.object({
      paymentId: z.string(),
      parkingId: z.string(),
      parkingName: z.string(),
      grossAmount: z.number(),
      ownerAmount: z.number(),
      adminCommission: z.number(),
      tax: z.number(),
      method: z.string(),
      paidAtMs: z.number(),
    }),
  ),
  operators: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      email: z.string(),
      status: z.string(),
      assignedParkingIds: z.array(z.string()),
    }),
  ),
  parkings: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      address: z.string(),
      status: z.string(),
      slotCapacity: z.number(),
      availableSlots: z.number(),
      reservedSlots: z.number(),
      occupiedSlots: z.number(),
      hourlyRate: z.number(),
    }),
  ),
});

const ownerSchema = z.object({
  id: z.string(),
  ownerId: z.string().optional(),
  userId: z.string().optional(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  status: z.string().optional(),
});

const parkingSchema = z.object({
  id: z.string(),
  ownerId: z.string().optional(),
  name: z.string().optional(),
  address: z.string().optional(),
  status: z.string().optional(),
  slotCapacity: z.number().optional(),
  availableSlots: z.number().optional(),
  reservedSlots: z.number().optional(),
  occupiedSlots: z.number().optional(),
  hourlyRate: z.number().optional(),
});

const operatorSchema = z.object({
  id: z.string(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
  ownerId: z.string().optional(),
  assignedParkingIds: z.array(z.string()).optional(),
});

const rangePresetSchema = z.enum(["7d", "30d"]);

export const dashboardQueryKeys = {
  adminAnalytics: (preset, uid) => ["dashboard", uid || auth.currentUser?.uid || "anon", "admin", "analytics", preset || "30d"],
  adminOwners: (uid) => ["dashboard", uid || auth.currentUser?.uid || "anon", "admin", "owners"],
  adminParkings: (uid) => ["dashboard", uid || auth.currentUser?.uid || "anon", "admin", "parkings"],
  adminOperators: (uid) => ["dashboard", uid || auth.currentUser?.uid || "anon", "admin", "operators"],
  ownerAnalytics: (preset, uid) => ["dashboard", uid || auth.currentUser?.uid || "anon", "owner", "analytics", preset || "30d"],
};

function parseRangePreset(input) {
  return rangePresetSchema.parse(input || "30d");
}

function mapDocs(snapshot, schema) {
  return snapshot.docs.map((doc) => schema.parse({ id: doc.id, ...doc.data() }));
}

export async function getAdminAnalytics(rangePreset) {
  const result = await callApi("getAdminAnalytics", { rangePreset: parseRangePreset(rangePreset) });
  return adminAnalyticsSchema.parse(result.data);
}

export async function getOwnerAnalytics(rangePreset) {
  const result = await callApi("getOwnerAnalytics", { rangePreset: parseRangePreset(rangePreset) });
  return ownerAnalyticsSchema.parse(result.data);
}

export async function getAdminOwnerList() {
  const snap = await firestore.collection("owners").get();
  return mapDocs(snap, ownerSchema)
    .map((owner) => ({
      id: owner.id,
      ownerId: owner.ownerId || owner.id,
      fullName: owner.fullName || "",
      email: owner.email || "",
      phone: owner.phone || "",
      bankAccountNumber: owner.bankAccountNumber || "",
      status: owner.status || "active",
    }))
    .sort((a, b) => String(a.fullName || a.email).localeCompare(String(b.fullName || b.email)));
}

export async function getAdminParkingList() {
  const snap = await firestore.collection("parkings").get();
  return mapDocs(snap, parkingSchema)
    .map((parking) => ({
      id: parking.id,
      ownerId: parking.ownerId || "",
      name: parking.name || "",
      address: parking.address || "",
      status: parking.status || "inactive",
      slotCapacity: Number(parking.slotCapacity || 0),
      availableSlots: Number(parking.availableSlots || 0),
      reservedSlots: Number(parking.reservedSlots || 0),
      occupiedSlots: Number(parking.occupiedSlots || 0),
      hourlyRate: Number(parking.hourlyRate || 0),
    }))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

export async function getAdminOperatorList() {
  const snap = await firestore.collection("users").where("role", "==", "operator").get();
  return mapDocs(snap, operatorSchema)
    .map((operator) => ({
      id: operator.id,
      fullName: operator.fullName || "",
      email: operator.email || "",
      status: operator.status || "inactive",
      ownerId: operator.ownerId || "",
      assignedParkingIds: Array.isArray(operator.assignedParkingIds) ? operator.assignedParkingIds : [],
    }))
    .sort((a, b) => String(a.fullName || a.email).localeCompare(String(b.fullName || b.email)));
}

export async function createOwnerAccount(input) {
  const payload = z
    .object({
      fullName: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      phone: z.string().optional().default(""),
      bankAccountNumber: z.string().optional().default(""),
    })
    .parse(input);
  const result = await callApi("createOwnerAccount", payload);
  return z.object({ ownerId: z.string(), userId: z.string(), email: z.string() }).parse(result.data);
}

export async function upsertParking(input) {
  const payload = z
    .object({
      parkingId: z.string().optional(),
      ownerId: z.string().min(1),
      name: z.string().min(1),
      address: z.string().optional().default(""),
      status: z.string().optional().default("active"),
      slotCapacity: z.number().nonnegative(),
      availableSlots: z.number().nonnegative(),
      reservedSlots: z.number().nonnegative(),
      occupiedSlots: z.number().nonnegative(),
      hourlyRate: z.number().nonnegative(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .parse(input);
  const result = await callApi("upsertParking", payload);
  return z.object({ parkingId: z.string(), status: z.string() }).parse(result.data);
}

export async function assignOperatorToParking(input) {
  const payload = z
    .object({ operatorUid: z.string().min(1), parkingId: z.string().min(1), assign: z.boolean().default(true) })
    .parse(input);
  const result = await callApi("assignOperatorToParking", payload);
  return z.object({ operatorUid: z.string(), parkingId: z.string(), assign: z.boolean() }).parse(result.data);
}

export async function adminArchiveOwner(input) {
  const payload = z.object({ ownerId: z.string().min(1), reason: z.string().optional() }).parse(input);
  const result = await callApi("adminArchiveOwner", payload);
  return z
    .object({
      ownerId: z.string(),
      status: z.string(),
      parkingsAffected: z.number().optional(),
      operatorsAffected: z.number().optional(),
    })
    .parse(result.data);
}

export async function adminRestoreOwner(input) {
  const payload = z.object({ ownerId: z.string().min(1) }).parse(input);
  const result = await callApi("adminRestoreOwner", payload);
  return z
    .object({
      ownerId: z.string(),
      status: z.string(),
      restoredParkings: z.number().optional(),
      restoredOperators: z.number().optional(),
    })
    .parse(result.data);
}

export async function updateOwnerPaymentDetails(input) {
  const payload = z.object({ phone: z.string().optional(), bankAccountNumber: z.string().optional() }).parse(input || {});
  const result = await callApi("ownerUpdatePaymentDetails", payload);
  return z
    .object({ ownerId: z.string(), phone: z.string().nullable(), bankAccountNumber: z.string().nullable(), updatedAtMs: z.number() })
    .parse(result.data);
}

export async function createOwnerOperator(input) {
  const payload = z
    .object({
      fullName: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      phone: z.string().optional(),
      assignedParkingIds: z.array(z.string().min(1)).min(1),
    })
    .parse(input);
  const result = await callApi("ownerCreateOperator", payload);
  return z
    .object({ operatorUid: z.string(), ownerId: z.string(), assignedParkingIds: z.array(z.string()), status: z.string() })
    .parse(result.data);
}

export async function updateOwnerOperatorAssignments(input) {
  const payload = z
    .object({ operatorUid: z.string().min(1), assignedParkingIds: z.array(z.string().min(1)).min(1) })
    .parse(input);
  const result = await callApi("ownerUpdateOperatorAssignments", payload);
  return z.object({ operatorUid: z.string(), assignedParkingIds: z.array(z.string()) }).parse(result.data);
}

export async function setOwnerOperatorStatus(input) {
  const payload = z.object({ operatorUid: z.string().min(1), status: z.enum(["active", "inactive"]) }).parse(input);
  const result = await callApi("ownerSetOperatorStatus", payload);
  return z.object({ operatorUid: z.string(), status: z.enum(["active", "inactive"]) }).parse(result.data);
}

export const dashboardFormatters = {
  currency: new Intl.NumberFormat("en-ET", {
    style: "currency",
    currency: "ETB",
    maximumFractionDigits: 2,
  }),
  number: new Intl.NumberFormat("en-ET", {
    maximumFractionDigits: 0,
  }),
  dateTime: new Intl.DateTimeFormat("en-ET", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

export function getCurrentUserId() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("User is not authenticated.");
  return uid;
}
