import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/functions";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const auth = firebase.auth();
export const firestore = firebase.firestore();
export const functionsClient = firebase.app().functions("us-central1");

const USE_FUNCTIONS_EMULATOR = process.env.REACT_APP_USE_FUNCTIONS_EMULATOR === "true";
const FUNCTIONS_EMULATOR_HOST = process.env.REACT_APP_FUNCTIONS_EMULATOR_HOST || "localhost";
const FUNCTIONS_EMULATOR_PORT = Number(process.env.REACT_APP_FUNCTIONS_EMULATOR_PORT || 5001);
const AUTO_USE_EMULATOR_IN_DEV =
  process.env.NODE_ENV === "development" && process.env.REACT_APP_USE_FUNCTIONS_EMULATOR !== "false";
const SHOULD_USE_FUNCTIONS_EMULATOR = USE_FUNCTIONS_EMULATOR || AUTO_USE_EMULATOR_IN_DEV;

if (SHOULD_USE_FUNCTIONS_EMULATOR) {
  functionsClient.useEmulator(FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
  // Helpful console breadcrumb during local testing.
  // eslint-disable-next-line no-console
  console.log(`Using Functions emulator at ${FUNCTIONS_EMULATOR_HOST}:${FUNCTIONS_EMULATOR_PORT}`);
}

// Lazy RTDB accessor for legacy modules. This avoids initialization warnings
// when Realtime Database is not provisioned for this project.
let _databaseInstance = null;
export const database = {
  ref: (...args) => {
    if (!_databaseInstance) {
      // Import side-effect intentionally deferred until first use.
      // eslint-disable-next-line global-require
      require("firebase/compat/database");
      _databaseInstance = firebase.database();
    }
    return _databaseInstance.ref(...args);
  },
};

export default firebase;
