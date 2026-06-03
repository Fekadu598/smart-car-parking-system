# Enderase Smart Parking Docs

Welcome to the Enderase Smart Parking Management System documentation! This folder contains comprehensive guides to help you understand, develop, and operate the parking platform.

## What is Enderase?

Enderase is a **smart parking management platform** built for the Ethiopian market. It connects four types of users:

- **Drivers** - People who want to find and reserve parking spots
- **Operators** - Parking attendants who manage check-in/checkout at parking locations
- **Owners** - Business owners who own parking facilities
- **Admins** - Platform administrators who oversee the entire system

The platform handles the complete parking lifecycle: finding parking, reserving spots, checking in vehicles, processing payments, and generating analytics.

---

## Start Here (New Developers)

If you're new to the project, read these documents in order:

1. **`docs/02-getting-started-local.md`** - Set up the project on your computer
2. **`docs/03-environment-variables.md`** - Configure your development environment
3. **`docs/11-deploy-and-emulator-runbook.md`** - Learn how to run and deploy the app

---

## Product + Architecture

Understand how the system is built:

- **`docs/01-system-architecture.md`** - High-level overview of technologies and design decisions
- **`docs/05-firestore-data-model.md`** - Database structure and how data is organized
- **`docs/06-cloud-functions-api.md`** - Backend API reference for all server operations

---

## Core Business Flows

Learn how the main features work:

- **`docs/04-auth-and-role-guards.md`** - User authentication and role-based access control
- **`docs/07-qr-checkin-flow.md`** - How drivers check in using QR codes
- **`docs/08-manual-payment-flow.md`** - How payments are processed and confirmed

---

## Frontend Engineering

Understand the React application:

- **`docs/09-state-management-query-pattern.md`** - How data is managed in the frontend
- **`docs/10-analytics-and-commission.md`** - Dashboard analytics and revenue calculations

---

## Operations

For running and maintaining the system:

- **`docs/12-troubleshooting.md`** - Common problems and their solutions

---

## Investor Demo Support

- **`docs/13-investor-demo-script.md`** - Guide for presenting the platform to stakeholders

