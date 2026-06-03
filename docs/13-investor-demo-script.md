# Investor Demo Script

Use this as a simple narrative for non-technical stakeholders.

## 60-Second Pitch

Enderase is a role-based smart parking operations platform that connects drivers, operators, owners, and admins in one system.  
It reduces parking friction with digital reservation, QR-assisted check-in, controlled manual payment confirmation, and real-time analytics.

## Business Value Story

- **Drivers** reserve quickly and know where to go.
- **Operators** run secure check-in/checkout with auditability.
- **Owners** monitor parking performance and operator productivity.
- **Admins** track platform-wide revenue and guaranteed 10% commission.

## Suggested Live Demo Flow (7-10 minutes)

1. **Driver signup/login**
   - show easy onboarding
2. **Driver reservation**
   - choose parking on map
   - create booking
3. **Operator check-in**
   - either manual plate check-in or QR request approval
4. **Driver payment submit**
   - choose bank/phone method and send proof
5. **Operator payment confirm**
   - finalize session and counters
6. **Owner dashboard**
   - show parking performance + payout-oriented metrics
7. **Admin dashboard**
   - show platform totals + exact 10% commission analytics

## Credibility Points to Mention

- Backend-enforced transactional state transitions via Cloud Functions
- Firestore security rules with role-based data access
- Audit logging for operational accountability
- Emulator-first development and CLI-based deployment pipeline

## Q&A Ready Answers

- **How is fraud reduced?**  
  Payment requires operator confirmation before session completion.

- **How is overbooking prevented?**  
  Reservation/check-in counters are updated transactionally in server functions.

- **How does scaling work?**  
  Architecture is serverless (Firebase), with clear role and data boundaries.

