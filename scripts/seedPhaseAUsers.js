/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function getArg(name) {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1];
}

function resolveServiceAccountPath() {
  const argPath = getArg("service-account");
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!argPath && !envPath) return null;
  return path.resolve(process.cwd(), argPath || envPath);
}

function loadCredential() {
  const serviceAccountPath = resolveServiceAccountPath();
  if (!serviceAccountPath) {
    return admin.credential.applicationDefault();
  }
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account file not found: ${serviceAccountPath}`);
  }
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  return admin.credential.cert(serviceAccount);
}

async function main() {
  const projectId = getArg("project-id") || process.env.REACT_APP_FIREBASE_PROJECT_ID || "digital-parking-f9d2c";
  const dryRun = process.argv.includes("--dry-run");

  admin.initializeApp({
    credential: loadCredential(),
    projectId,
  });

  const firestore = admin.firestore();
  const now = Date.now();

  const users = [
    {
      uid: "0OU0SmOULTT7Y9Jl4h1R6UMIIWg1",
      fullName: "Admin Test User",
      email: "admin@test.com",
      role: "admin",
      status: "active",
      ownerId: null,
      assignedParkingIds: [],
    },
    {
      uid: "MsYkrSAEFFh9uD8A0tM32rWpkGv2",
      fullName: "Owner Test User",
      email: "owner@test.com",
      role: "owner",
      status: "active",
      ownerId: "owner_001",
      assignedParkingIds: [],
    },
    {
      uid: "LrKuXGlpkYe3Z3fbr2JlmKQyarg1",
      fullName: "Operator Test User",
      email: "operator@test.com",
      role: "operator",
      status: "active",
      ownerId: null,
      assignedParkingIds: ["lot_01"],
    },
    {
      uid: "NXpi2UJe8gMdXin8MINLky7dHGC3",
      fullName: "Driver Test User",
      email: "driver@test.com",
      role: "driver",
      status: "active",
      ownerId: null,
      assignedParkingIds: [],
    },
  ];

  for (const user of users) {
    const payload = {
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      ownerId: user.ownerId,
      assignedParkingIds: user.assignedParkingIds,
      createdAt: now,
      updatedAt: now,
    };

    if (dryRun) {
      console.log(`[DRY RUN] users/${user.uid}`, payload);
      continue;
    }

    await firestore.collection("users").doc(user.uid).set(payload, { merge: true });
    console.log(`Seeded users/${user.uid} (${user.role})`);
  }
}

main()
  .then(() => {
    console.log("Phase A user seed complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Phase A user seed failed:", error.message);
    console.error(
      "Tip: provide admin credentials with --service-account <path-to-json> or set FIREBASE_SERVICE_ACCOUNT_PATH."
    );
    process.exit(1);
  });
