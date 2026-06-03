/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function getArg(name) {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1];
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveServiceAccount() {
  const fromArg = getArg("service-account");
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const input = fromArg || fromEnv || "serviceAccountKey.json";
  return path.resolve(process.cwd(), input);
}

async function main() {
  const dbUrl = getArg("database-url") || process.env.FIREBASE_DATABASE_URL;
  const serviceAccountPath = resolveServiceAccount();
  const dryRun = process.argv.includes("--dry-run");

  if (!dbUrl) {
    throw new Error("Missing database URL. Pass --database-url or set FIREBASE_DATABASE_URL.");
  }
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account file not found: ${serviceAccountPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: dbUrl,
  });

  const db = admin.database();
  const legacySnapshot = await db.ref("parking_slots").once("value");
  const legacy = legacySnapshot.val() || {};
  const slotEntries = Object.entries(legacy);

  if (!slotEntries.length) {
    console.log("No parking_slots records found. Nothing to migrate.");
    return;
  }

  const lots = {};
  const spots = {};

  slotEntries.forEach(([slotId, slot], idx) => {
    const lotName = slot.lotName || slot.name || "Legacy Lot";
    const derivedLotId = slot.lotId || `legacy_${slugify(lotName) || "lot"}`;

    if (!lots[derivedLotId]) {
      lots[derivedLotId] = {
        id: derivedLotId,
        name: lotName,
        lat: slot.lat || 0,
        lng: slot.lng || 0,
        totalSpots: 0,
        availableSpots: 0,
        migratedFrom: "parking_slots",
        migratedAt: Date.now(),
      };
      spots[derivedLotId] = {};
    }

    const isAvailable = slot.status === "available" || slot.availability === true;
    lots[derivedLotId].totalSpots += 1;
    if (isAvailable) lots[derivedLotId].availableSpots += 1;

    spots[derivedLotId][slotId] = {
      index: Number(slot.index) || idx + 1,
      availability: isAvailable,
      plateNumber: slot.plateNumber || "",
      entryTime: slot.entryTime || null,
      status: slot.status || (isAvailable ? "available" : "reserved"),
      migratedFrom: "parking_slots",
    };
  });

  if (dryRun) {
    console.log("Dry run only. Canonical lots to write:");
    console.log(JSON.stringify(lots, null, 2));
    console.log("Canonical spots to write:");
    console.log(JSON.stringify(spots, null, 2));
    return;
  }

  await db.ref("Parking_Lots").update(lots);
  await db.ref("Parking_Spots").update(spots);

  console.log(`Migration complete. Migrated ${slotEntries.length} legacy parking_slots records.`);
  console.log("Data written to: Parking_Lots and Parking_Spots");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
