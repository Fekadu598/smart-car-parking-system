const fs = require("fs");

const src = fs.readFileSync("functions/index.js", "utf8");
let s = src;

s = s.replace(/const \{ HttpsError, onCall \} = require\("firebase-functions\/v2\/https"\);/g, "");
s = s.replace(/const \{ onSchedule \} = require\("firebase-functions\/v2\/scheduler"\);/g, "");
s = s.replace(/const \{ logger \} = require\("firebase-functions\/v2"\);/g, "");
s = s.replace(/const REGION = "us-central1";/, "");
s = s.replace(/const CALLABLE_OPTIONS = \{ region: REGION, cors: true \};/, "");

const lines = s.split("\n");
let count = 0;
for (const line of lines) {
  const m = line.match(/^exports\.(\w+) = onCall\(CALLABLE_OPTIONS,\s*async\s*\(request\)\s*=>\s*\{$/);
  if (m) {
    count++;
    console.log("Match:", m[1]);
  }
}
console.log("Total:", count);

// Also check if CALLABLE_OPTIONS still appears in function declarations
const refCount = (s.match(/onCall\(CALLABLE_OPTIONS/g) || []).length;
console.log("References to onCall(CALLABLE_OPTIONS:", refCount);
