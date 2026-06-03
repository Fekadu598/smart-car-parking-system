# Local Testing & Demonstration Guide: Smart Parking Features

This guide explains how to locally run, test, and demonstrate the new automated parking features. This is designed for developers, product managers, and investors to see the dynamic slotting, smart reservations, and cashless digital wallet working seamlessly under simulated local environments.

---

## 1. Setting Up the Emulated Environment

Because our billing backend, custom cron jobs, and business logic run on high-performance local Firebase emulators (with Remote Auth enabled), you can run end-to-end user journeys without incurring cloud costs.

### Quick Start Commands
1. **Start the Firebase Emulator Suite**:
   Open a terminal in the `Web App` directory and start the local emulators:
   ```bash
   firebase emulators:start --only firestore,functions
   ```
2. **Run the React Frontend Web Application**:
   Open a terminal in the `Web App` directory and start the dev server:
   ```bash
   npm run start
   ```
3. **Run the React Native Mobile Application**:
   Open a terminal in the `mobile_app` directory and start expo:
   ```bash
   npm run start
   ```

---

## 2. Walkthrough: Testing the Core Workflows

### 2.1 Cashless Digital Wallet & Real-Time Top-Ups

The digital wallet allows frictionless parking without manual currency exchanges.

#### Step-by-Step Test Procedure:
1. **Log in as a Driver** on either the Web or Mobile application.
2. Observe your **Virtual Wallet Card**. You will see that the profile is pre-seeded with a starting balance of **`$0.00 ETB`** (e.g. standard starting balance placeholder).
3. **Top Up Your Wallet**:
   * Click one of the quick top-up buttons: **`+$0.00 ETB`**, **`+$0.00 ETB`**, or **`+$0.00 ETB`**.
   * The application invokes the secure `topUpWallet` cloud function.
   * Observe the balance update on your screen instantly.
4. **Backend Verification**:
   * Open the Local Firestore Emulator Suite UI (usually at `http://localhost:4000/firestore`).
   * Navigate to the `users` collection, select your user ID, and verify the `walletBalance` field matches the exact amount in real-time.

---

### 2.2 Dynamic Spot-Specific Slotting & Navigation

Instead of checking into an arbitrary lot counter, the system assigns a specific physical spot (e.g., `A3`, `B5`) and generates dynamic step-by-step route directions.

#### Step-by-Step Test Procedure:
1. **Initiate Check-In**:
   * Open the **Operator Control Panel** on Web or Mobile.
   * Input a vehicle's Plate Number and click **Check-In (Walk-In)**.
2. **Observe Spot Assignment**:
   * The transaction queries available inventory and assigns the first vacant spot (e.g., `A1` or `B1`).
   * On the operator dashboard, the assigned spot status grid changes color instantly:
     * **Green (Available)** ➔ **Red (Occupied)** with the associated vehicle plate number visible.
3. **View Navigation Directions**:
   * The system displays dynamic routing: *"To park at Spot A1: Drive through the Entrance Gate, follow the lane to Row A, and pull into spot number 1..."*
4. **Flashing Gate Indicator**:
   * Observe the vibrant green banner at the top of the operator terminal flashing **"Gate Unlocked!"** for 5 seconds, simulating physical gate actuation.

---

### 2.3 Smart Reservations & Expiration Penalties

Reservations guarantee a spot is held for a driver but charge a cancellation fee if the driver fails to arrive, preserving lot efficiency.

#### Step-by-Step Test Procedure:
1. **Book a Spot**:
   * As a **Driver**, click **Reserve Parking Spot**.
   * Specify your vehicle plate number, future booking start time, and duration.
   * Confirm the reservation. The system transactionally reserves the spot, holds an upfront hold fee (e.g., **`$0.00 ETB`** hold fee), and issues a unique 6-character **Reservation Code** (e.g., `RES-F89`).
   * Observe the spot status grid turns **Amber (Reserved)**.
2. **Simulate a Prompt Arrival**:
   * As the **Operator**, type the driver's **Reservation Code** (`RES-F89`) or plate number in the Check-In input.
   * Click **Check-In**. The upfront hold is finalized, the spot turns **Red (Occupied)**, and the gate banner flashes green.
3. **Simulate a No-Show / Expiry**:
   * Create a new booking with a start time set to the past (or wait for the reservation grace window of 15 minutes to pass).
   * Rather than waiting for the automated 5-minute scheduler, manually trigger the expiration check by calling the test endpoint `expireBookingsManual`.
   * **Observe Expiration Penalties**:
     * The booking status transitions to `expired` in Firestore.
     * The spot is released back to **Green (Available)**.
     * The driver's user profile `walletBalance` is charged a no-show penalty (e.g., **`$0.00 ETB`** penalty), and the remaining hold balance (e.g., **`$0.00 ETB`**) is refunded back to their wallet.

---

### 2.4 Checkout & Gate Releases

Upon departure, the operator settles the session based on the elapsed duration.

#### Step-by-Step Test Procedure:
1. As the **Operator**, type the active vehicle's Plate Number in the Exit search bar.
2. The terminal displays the active elapsed time and live estimated fare:
   $$\text{Est. Fare} = \text{Elapsed Hours} \times \text{Hourly Rate} + \text{15\% VAT}$$
3. Click **⚡ Direct Checkout**.
4. The system presents the payment channel selector popup:
   * **💵 Cash**: Operator collects physical cash, clicks confirm, and completes checkout.
   * **📱 Driver Wallet**: Deducts the calculated amount instantly from the driver's database wallet.
5. The exit gate banner flashes **"Gate Unlocked!"** to authorize exit, and the spot returns to **Green (Available)** status.

---

## 3. Local Audit logs & Verification

Every transaction is recorded in a secure, append-only `audit_logs` collection. You can inspect the logs directly in the Firestore Emulator UI to verify that the balance adjustments, spot allocations, and penalty fees are recorded with exact timestamps and caller metadata.
