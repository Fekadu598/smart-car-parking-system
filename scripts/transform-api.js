const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(__dirname, "../functions/index.js");
const destPath = path.resolve(__dirname, "../api/callable.js");

let src = fs.readFileSync(sourcePath, "utf8").replace(/\r/g, "");

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

// Remove region and options constants
src = src.replace(/const REGION = "us-central1";/, "");
src = src.replace(/const CALLABLE_OPTIONS = \{ region: REGION, cors: true \};/, "");

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

// Replace HttpsError with FunctionError
src = src.replace(/new HttpsError\(/g, "new FunctionError(");

// Remove the scheduled expireBookings
src = src.replace(
  /exports\.expireBookings = onSchedule\([\s\S]*?return null;\s*\n\}\);\n/,
  "// expireBookings moved to api/cron.js (Vercel Cron Jobs)\n"
);

// Now transform each onCall function
const lines = src.split("\n");
const result = [];
const handlerNames = [];
let i = 0;

function countBraces(line) {
  let d = 0, p = 0;
  for (const ch of line) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
    else if (ch === '(') p++;
    else if (ch === ')') p--;
  }
  return { d, p };
}

while (i < lines.length) {
  const line = lines[i];
  const fnMatch = line.match(/^exports\.(\w+) = onCall\(CALLABLE_OPTIONS,\s*async\s*\(request\)\s*=>\s*\{$/);
  if (fnMatch) {
    const fnName = fnMatch[1];
    handlerNames.push(fnName);
    result.push(`async function ${fnName}(data, auth) {`);
    i++;

    let braceDepth = 1;

    while (i < lines.length && braceDepth > 0) {
      const bodyLine = lines[i];
      const { d, p } = countBraces(bodyLine);
      braceDepth += d;

      if (braceDepth === 0) {
        const trimmed = bodyLine.trim();
        if (trimmed === "});" || trimmed === "})") {
          result.push("}");
        } else if (trimmed.startsWith("});")) {
          result.push(bodyLine.replace("});", "}"));
        } else if (trimmed.startsWith("})")) {
          result.push(bodyLine.replace("})", "}"));
        } else {
          result.push(bodyLine);
        }
      } else {
        result.push(bodyLine);
      }

      i++;
    }
  } else {
    result.push(line);
    i++;
  }
}

let transformed = result.join("\n");

// Additional replacements
transformed = transformed
  .replace(/request\.auth\?\.uid/g, "auth?.uid")
  .replace(/request\.data\?\./g, "data?.")
  .replace(/request\.data\s*\|\|/g, "data ||")
  .replace(/request\.data([^?_a-zA-Z0-9])/g, "data$1")
  .replace(/auth\?\.uid \?\. \?/g, "auth?.uid")
  .replace(/requireRole\(request,\s*/g, "requireRole(auth, ")
  .replace(/request\.rawRequest\.get\("origin"\)/g, "WEB_APP_BASE_URL");

// Fix: ensure WEB_APP_BASE_URL constant uses process.env
// (already defined in original)

// Add FunctionError class
const classDef = `

class FunctionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "FunctionError";
  }
}
`;

transformed = transformed.replace("const db = admin.firestore();", "const db = admin.firestore();" + classDef);

// Remove the old context-based requireRole (it uses `context` param)
transformed = transformed.replace(
  /async function requireRole\(context, expectedRole\) \{[\s\S]*?^return profile;\s*\n\}/m,
  ""
);

// Replace the WEB_APP_BASE_URL definition to use process.env
// Original: const WEB_APP_BASE_URL = (process.env.WEB_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
// Already correct

// Clean up empty lines
transformed = transformed.replace(/\n{4,}/g, "\n\n\n");

// Add handler map and export
const handlerMap = `

const handlers = {
  ${handlerNames.join(",\n  ")},
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

fs.writeFileSync(destPath, transformed + handlerMap, "utf8");
console.log("Created api/callable.js - " + fs.statSync(destPath).size + " bytes");
console.log("Handlers (" + handlerNames.length + "): " + handlerNames.join(", "));
