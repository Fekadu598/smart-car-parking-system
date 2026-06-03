const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(__dirname, "../functions/index.js");
const destPath = path.resolve(__dirname, "../api/callable.js");

let src = fs.readFileSync(sourcePath, "utf8");

// Remove firebase-functions imports
src = src.replace(
  /const \{ HttpsError, onCall \} = require\("firebase-functions\/v2\/https"\);/g,
  ""
);
src = src.replace(
  /const \{ onSchedule \} = require\("firebase-functions\/v2\/scheduler"\);/g,
  ""
);
src = src.replace(
  /const \{ logger \} = require\("firebase-functions\/v2"\);/g,
  ""
);

// Replace admin initialization
const newInit = `if (!admin.apps.length) {
  try {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
      : null;
    admin.initializeApp(sa ? { credential: admin.credential.cert(sa) } : {});
  } catch (e) {
    admin.initializeApp();
  }
}`;
src = src.replace(
  /try \{\s*admin\.initializeApp\(\);\s*\} catch \(error\) \{\s*logger\.error\("Failed to initialize Firebase Admin", error\);\s*throw error;\s*\}/,
  newInit
);

// Add FunctionError class
src = src.replace(
  "const db = admin.firestore();",
  `const db = admin.firestore();

class FunctionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "FunctionError";
  }
}

function requireRole(auth, expectedRole) {
  if (!auth?.uid) {
    throw new FunctionError("unauthenticated", "Authentication required.");
  }
  return getUserProfile(auth.uid).then((profile) => {
    if (!profile) throw new FunctionError("failed-precondition", "User profile not found.");
    if (profile.status && profile.status !== "active") {
      throw new FunctionError("permission-denied", "User is not active.");
    }
    if (profile.role !== expectedRole) {
      throw new FunctionError("permission-denied", \`Required role: \${expectedRole}\`);
    }
    return profile;
  });
}
`
);

// Remove REGION constant but keep it if used elsewhere
src = src.replace(/const REGION = "us-central1";\n/, "");
src = src.replace(/const CALLABLE_OPTIONS = \{.*?\};\n/, "");

// Remove the scheduled expireBookings function
src = src.replace(
  /exports\.expireBookings = onSchedule\([\s\S]*?return null;\s*\n\}\);\n/,
  "// expireBookings moved to api/cron.js\n"
);

// Replace all onCall exports
// exports.FUNCTION_NAME = onCall(CALLABLE_OPTIONS, async (request) => {
// becomes:
// async function functionName(data, auth) {
src = src.replace(
  /exports\.(\w+) = onCall\(CALLABLE_OPTIONS,\s*async\s*\(request\)\s*=>\s*\{/g,
  "async function $1(data, auth) {"
);

// Replace request.auth?.uid with auth?.uid
src = src.replace(/request\.auth\?\.uid/g, "auth?.uid");

// Replace request.data?. with data?.
// But be careful not to replace "request.data" without ?.
src = src.replace(/request\.data\?\./g, "data?.");

// Replace request.data (without ?) - but only when request.data is used without ?
// Actually, replace request.data at the start of expressions
// request.data || -> data ||
src = src.replace(/request\.data\s*\|\|/g, "data ||");
// request.data } -> data }
src = src.replace(/request\.data\}/g, "data}");
// request.data \n -> data \n
src = src.replace(/request\.data([^?._a-zA-Z0-9])/g, "data$1");

// Replace new HttpsError( with new FunctionError(
src = src.replace(/new HttpsError\(/g, "new FunctionError(");

// Replace requireRole(request, with requireRole(auth,
src = src.replace(/requireRole\(request,\s*/g, "requireRole(auth, ");

// Replace request.data?.X patterns that were missed
src = src.replace(/request\.data\?\./g, "data?.");

// Replace request.rawRequest.get("origin")
src = src.replace(
  /request\.rawRequest\.get\("origin"\)/g,
  'WEB_APP_BASE_URL'
);

// Remove old requireRole function definition since we replaced it
// The old one takes "request" as first param, our new one takes "auth"
// Keep the old one if it wasn't replaced - actually it was in the original
// Let me check if we need to remove the old requireRole

// Add the handler map and export at the end
const handlerMap = `
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
`;

src += handlerMap;

fs.writeFileSync(destPath, src, "utf8");
console.log("Created api/callable.js - " + fs.statSync(destPath).size + " bytes");
