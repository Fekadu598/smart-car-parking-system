/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function getArg(name) {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function loadCredential() {
  const serviceAccountPath = getArg("service-account");
  if (!serviceAccountPath) return admin.credential.applicationDefault();
  const resolved = path.resolve(process.cwd(), serviceAccountPath);
  if (!fs.existsSync(resolved)) throw new Error(`Service account not found: ${resolved}`);
  const json = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return admin.credential.cert(json);
}

async function main() {
  const projectId = getArg("project-id") || "digital-parking-f9d2c";
  admin.initializeApp({ credential: loadCredential(), projectId });
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  const parkings = [
    {
      id: "lot_01",
      name: "Bole Main Parking",
      address: "Bole, Addis Ababa",
      status: "active",
      slotCapacity: 20,
      availableSlots: 20,
      reservedSlots: 0,
      occupiedSlots: 0,
      hourlyRate: 50,
      location: { lat: 8.997, lng: 38.786 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "lot_02",
      name: "Piassa Center Parking",
      address: "Piassa, Addis Ababa",
      status: "active",
      slotCapacity: 15,
      availableSlots: 15,
      reservedSlots: 0,
      occupiedSlots: 0,
      hourlyRate: 40,
      location: { lat: 9.038, lng: 38.745 },
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const lot of parkings) {
    await db.collection("parkings").doc(lot.id).set(lot, { merge: true });
    console.log(`Seeded parkings/${lot.id}`);
  }

  await db.collection("users").doc("LrKuXGlpkYe3Z3fbr2JlmKQyarg1").set(
    {
      assignedParkingIds: ["lot_01", "lot_02"],
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  console.log("Updated operator assignment for test user.");
}

main()
  .then(() => {
    console.log("Phase 2 seed complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
