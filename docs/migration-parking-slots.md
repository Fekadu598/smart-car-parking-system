# parking_slots Migration Runbook

This migration converts legacy `parking_slots` data into canonical:

- `Parking_Lots`
- `Parking_Spots`

## Prerequisites

1. A Firebase service account key JSON file with Realtime Database write permission.
2. Database URL (for example: `https://<project-id>-default-rtdb.firebaseio.com`).

## Steps

1. Install dependencies:
   - `npm install`
2. Run dry-run first:
   - `node scripts/migrateParkingSlotsToCanonical.js --database-url <DB_URL> --service-account <PATH_TO_SERVICE_ACCOUNT_JSON> --dry-run`
3. Run migration:
   - `node scripts/migrateParkingSlotsToCanonical.js --database-url <DB_URL> --service-account <PATH_TO_SERVICE_ACCOUNT_JSON>`
4. Verify in Firebase console:
   - `Parking_Lots` created with `totalSpots` and `availableSpots`
   - `Parking_Spots/<lotId>/<spotId>` created
5. After verification, retire/backup legacy `parking_slots`.

## Notes

- The migration does not delete `parking_slots`; deletion is a manual step after validation.
- Legacy records are tagged with `migratedFrom: "parking_slots"`.
