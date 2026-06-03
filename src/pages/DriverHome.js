import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { QRCodeSVG } from "qrcode.react";
import * as qrLib from "qrcode";
import { Circle, GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { toast } from "sonner";
import { auth, firestore, functionsClient } from "../firebase";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";

const SEEDED_IDS = ["lot_01", "lot_02"];

function formatDate(value) {
  if (!value) return "N/A";
  const ms = value?.toMillis ? value.toMillis() : value;
  return new Date(ms).toLocaleString();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function getSpotDirectionsClient(spotId, toPedestrian = false) {
  if (!spotId) return "";
  const match = spotId.match(/^([A-Z])(\d+)$/);
  if (!match) return `Spot ${spotId} is located in the main parking area.`;
  const row = match[1];
  const num = match[2];
  if (toPedestrian) {
    return `To find your car at Spot ${spotId}: Enter through the main Pedestrian Door, walk straight down the central walkway, turn into Row ${row}, and your car is at spot number ${num} on the left.`;
  } else {
    return `To park at Spot ${spotId}: Drive through the Entrance Gate, follow the lane to Row ${row}, and pull into spot number ${num} (marked in green/blue).`;
  }
}

function TelebirrIcon({ className }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <rect width="40" height="40" rx="10" fill="#00AB4E" />
      <circle cx="20" cy="15" r="7" fill="white" opacity="0.95" />
      <circle cx="20" cy="15" r="4" fill="#00AB4E" />
      <text x="20" y="33" textAnchor="middle" fill="white" fontSize="7" fontWeight="800" fontFamily="sans-serif" letterSpacing="0.4">telebirr</text>
    </svg>
  )
}
function CbeBirrIcon({ className }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <rect width="40" height="40" rx="10" fill="#7c1d6e" />
      <circle cx="20" cy="20" r="12" fill="white" opacity="0.15" />
      <text x="20" y="24" textAnchor="middle" fill="white" fontSize="14" fontWeight="900" fontFamily="sans-serif" letterSpacing="-0.5">CBE</text>
      <rect x="10" y="30" width="20" height="1.5" rx="0.75" fill="#e8b84b" opacity="0.9" />
      <text x="20" y="37" textAnchor="middle" fill="#e8b84b" fontSize="4.5" fontWeight="800" fontFamily="sans-serif" letterSpacing="1.2">BIRR</text>
    </svg>
  )
}

function DriverHome() {
  const mapRef = useRef(null);
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  
  // Custom Booking Window Inputs
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [activeBookings, setActiveBookings] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [pendingPaymentRequests, setPendingPaymentRequests] = useState([]);
  const [pendingPaymentsError, setPendingPaymentsError] = useState("");
  const [localPendingSessionIds, setLocalPendingSessionIds] = useState({});
  const [paymentDestination, setPaymentDestination] = useState({ phone: "", bankAccountNumber: "" });
  const [loadingPaymentDestination, setLoadingPaymentDestination] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState("");
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [checkoutSession, setCheckoutSession] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [referenceCode, setReferenceCode] = useState("");
  const [reservePaymentMethod, setReservePaymentMethod] = useState("telebirr");
  const [reservationConfirm, setReservationConfirm] = useState(null);

  // Checkout Receipt States
  const [receipt, setReceipt] = useState(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  const mapsApiKey = (process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "").trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: "driver-map-script",
    googleMapsApiKey: mapsApiKey,
  });

  // Subscribe to Wallet Balance in real-time
  useEffect(() => {
    const unsub = firestore
      .collection("parkings")
      .where("status", "==", "active")
      .onSnapshot(
        (snapshot) => {
          const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          list.sort((a, b) => {
            const aIdx = SEEDED_IDS.indexOf(a.id);
            const bIdx = SEEDED_IDS.indexOf(b.id);
            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;
            return String(a.name || a.id).localeCompare(String(b.name || b.id));
          });
          setParkings(list);
          if (!selectedParkingId && list.length) setSelectedParkingId(list[0].id);
        },
        (err) => toast.error(err.message || "Failed to load parking locations.")
      );
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore
      .collection("bookings")
      .where("driverId", "==", uid)
      .where("status", "in", ["reserved", "checked_in"])
      .onSnapshot(
        (snapshot) => {
          const now = Date.now();
          const list = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((booking) => {
              if (booking.status !== "reserved") return true;
              const expiresMs = toMs(booking.expiresAt);
              return !expiresMs || expiresMs > now;
            });
          setActiveBookings(list);
        },
        (err) => toast.error(err.message || "Failed to load active bookings.")
      );
    return () => unsub();
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer = null;

    const loadPending = async () => {
      try {
        const callable = functionsClient.httpsCallable("listPendingPaymentsForDriver");
        const response = await callable({});
        if (!mounted) return;
        const list = Array.isArray(response?.data?.pendingPayments) ? response.data.pendingPayments : [];
        setPendingPaymentRequests(list);
        setPendingPaymentsError("");
        const sessionLookup = {};
        list.forEach((item) => {
          if (item.sessionId) {
            sessionLookup[item.sessionId] = true;
          }
        });
        setLocalPendingSessionIds((prev) => ({ ...prev, ...sessionLookup }));
      } catch (err) {
        if (mounted) {
          setPendingPaymentsError(err.message || "Pending payments are temporarily unavailable.");
          setPendingPaymentRequests([]);
        }
      }
    };

    loadPending();
    timer = setInterval(loadPending, 8000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  // Auto-expire reservations when their time is up
  useEffect(() => {
    let timer = null;

    const expirePast = async () => {
      try {
        const callable = functionsClient.httpsCallable("expireBookingsManual");
        await callable({});
      } catch (_) {
        // silently ignore — function may not be deployed locally
      }
    };

    expirePast();
    timer = setInterval(expirePast, 30000);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore
      .collection("sessions")
      .where("driverId", "==", uid)
      .where("status", "==", "active")
      .onSnapshot(
        (snapshot) => setActiveSessions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
        (err) => toast.error(err.message || "Failed to load active sessions.")
      );
    return () => unsub();
  }, []);

  const selectedParking = useMemo(
    () => parkings.find((p) => p.id === selectedParkingId) || null,
    [parkings, selectedParkingId]
  );
  const mapPoints = useMemo(
    () =>
      parkings
        .map((p) => ({ parking: p, coords: parkingCoords(p) }))
        .filter((x) => x.coords),
    [parkings]
  );

  const mapCenter = useMemo(() => {
    const selected = parkingCoords(selectedParking);
    if (selected) return selected;
    if (mapPoints.length) return mapPoints[0].coords;
    return { lat: 8.997, lng: 38.786 };
  }, [mapPoints, selectedParking]);

  useEffect(() => {
    const selected = parkingCoords(selectedParking);
    const map = mapRef.current;
    if (!selected || !map) return;

    // Premium auto-centering & close-up pin focusing
    map.panTo(selected);
    map.setZoom(16);
  }, [selectedParking]);

  // Wallet Top-Up Trigger
  // Reserve Slot with Custom Start & End Times
  const reserveSlot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const now = Date.now();
      const startMs = startTime ? new Date(startTime).getTime() : now;
      const endMs = endTime ? new Date(endTime).getTime() : now + 60 * 60 * 1000;
      
      if (startMs >= endMs) {
        toast.error("End time must be after start time.");
        setLoading(false);
        return;
      }

      const callable = functionsClient.httpsCallable("createBooking");
      const response = await callable({
        parkingId: selectedParkingId,
        plateNumber,
        startTimeMs: startMs,
        endTimeMs: endMs,
        paymentMethod: reservePaymentMethod,
      });
      
      setReservationConfirm({
        spotId: response.data.spotId,
        reservationCode: response.data.reservationCode,
        plateNumber,
        paymentMethod: reservePaymentMethod,
        startTime: startTime || new Date(startMs).toISOString().slice(0, 16),
        endTime: endTime || new Date(endMs).toISOString().slice(0, 16),
        parkingName: parkings.find(p => p.id === selectedParkingId)?.name || "Parking",
      });
      setPlateNumber("");
      setStartTime("");
      setEndTime("");
    } catch (err) {
      toast.error(err.message || "Failed to create booking.");
    } finally {
      setLoading(false);
    }
  };

  const downloadReservePdfReceipt = async () => {
    if (!reservationConfirm) return;
    const r = reservationConfirm;
    const doc = new jsPDF({ format: "a5" });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 15;

    // Logo — simple parking P icon
    doc.setDrawColor(79, 70, 229);
    doc.setFillColor(79, 70, 229);
    doc.circle(12, y + 4, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text("P", 12, y + 6, { align: "center" });

    // Brand name
    doc.setTextColor(79, 70, 229);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Enderase", 22, y + 5);

    // Tagline — branding concept
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text("Smart Parking", 22, y + 11);

    y += 22;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("RESERVATION CONFIRMATION", pageW / 2, y, { align: "center" });
    y += 8;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, pageW / 2, y, { align: "center" });
    y += 10;
    doc.setDrawColor(100);
    doc.line(10, y, pageW - 10, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("RESERVATION DETAILS", pageW / 2, y, { align: "center" });
    y += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const details = [
      ["Parking", r.parkingName],
      ["Plate Number", r.plateNumber],
      ["Payment Method", r.paymentMethod === "telebirr" ? "Telebirr" : "CBE Birr"],
      ["Start Time", r.startTime],
      ["End Time", r.endTime],
      ["Spot", r.spotId],
      ["Reservation Code", r.reservationCode],
      ["Hold Fee", "20.00 ETB"],
    ];
    details.forEach(([label, value]) => {
      doc.text(label, 15, y);
      doc.text(value, pageW - 15, y, { align: "right" });
      y += 6;
    });
    y += 4;
    doc.setDrawColor(100);
    doc.line(10, y, pageW - 10, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Hold Fee: 20.00 ETB", pageW / 2, y, { align: "center" });
    y += 8;
    // QR code in PDF
    try {
      const qrDataUrl = await qrLib.toDataURL(`${r.reservationCode}|${r.plateNumber}`, { width: 120, margin: 1 });
      const qrSize = 40;
      const qrX = (pageW - qrSize) / 2;
      doc.addImage(qrDataUrl, "PNG", qrX, y, qrSize, qrSize);
      y += qrSize + 4;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6);
      doc.setTextColor(100);
      doc.text("Show this QR at the gate for quick check-in", pageW / 2, y, { align: "center" });
      y += 6;
    } catch (_) {}
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text("Thank you for choosing Enderase!", pageW / 2, y, { align: "center" });
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Ref: RES-${String(Date.now()).slice(-8)}`, pageW / 2, y, { align: "center" });
    doc.save(`reservation-${Date.now()}.pdf`);
  };

  // Instant checkout using Wallet Balance
  const payWithWalletAndCheckout = async (session, method = "telebirr") => {
    setCheckoutLoadingId(session.id);
    try {
      const callable = functionsClient.httpsCallable("driverCheckOutVehicle");
      const response = await callable({
        parkingId: session.parkingId,
        plateNumber: session.plateNumber,
        paymentMethod: method
      });
      
      toast.success(`Checked out successfully using Digital Wallet (${method === "telebirr" ? "Telebirr" : "CBE Birr"})!`);
      setReceipt(response.data.receipt);
      setIsReceiptOpen(true);
    } catch (err) {
      toast.error(err.message || "Failed to checkout.");
    } finally {
      setCheckoutLoadingId("");
    }
  };

  const openPaymentDialog = async (session) => {
    setCheckoutSession(session);
    setPaymentMethod("bank");
    setReferenceCode("");
    setPaymentDestination({ phone: "", bankAccountNumber: "" });
    setIsPaymentDialogOpen(true);

    setLoadingPaymentDestination(true);
    try {
      const callable = functionsClient.httpsCallable("getParkingPaymentDetails");
      const response = await callable({ parkingId: session.parkingId });
      setPaymentDestination({
        phone: response?.data?.phone || "",
        bankAccountNumber: response?.data?.bankAccountNumber || "",
      });
    } catch (err) {
      toast.error(err.message || "Failed to load payment destination details.");
    } finally {
      setLoadingPaymentDestination(false);
    }
  };

  const closePaymentDialog = () => {
    setIsPaymentDialogOpen(false);
    setCheckoutSession(null);
    setReferenceCode("");
    setPaymentMethod("bank");
  };

  const submitManualPayment = async () => {
    if (!checkoutSession) return;
    setCheckoutLoadingId(checkoutSession.id);
    try {
      const callable = functionsClient.httpsCallable("submitManualPayment");
      const response = await callable({
        parkingId: checkoutSession.parkingId,
        plateNumber: checkoutSession.plateNumber,
        method: paymentMethod,
        referenceCode: referenceCode.trim(),
      });
      toast.success(`Payment submitted. Awaiting operator confirmation. Amount: ${response.data.amountDue} ETB`);
      setLocalPendingSessionIds((prev) => ({ ...prev, [checkoutSession.id]: true }));
      closePaymentDialog();
    } catch (err) {
      toast.error(err.message || "Failed to submit payment.");
    } finally {
      setCheckoutLoadingId("");
    }
  };

  const downloadPdfReceipt = () => {
    if (!receipt) return;
    const doc = new jsPDF({ format: "a5" });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 15;

    // Logo — simple parking P icon
    doc.setDrawColor(79, 70, 229);
    doc.setFillColor(79, 70, 229);
    doc.circle(12, y + 4, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text("P", 12, y + 6, { align: "center" });

    // Brand name
    doc.setTextColor(79, 70, 229);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Enderase", 22, y + 5);

    // Tagline — branding concept
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text("Smart Parking", 22, y + 11);

    y += 22;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PARKING RECEIPT", pageW / 2, y, { align: "center" });
    y += 8;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, pageW / 2, y, { align: "center" });
    y += 10;
    doc.setDrawColor(100);
    doc.line(10, y, pageW - 10, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("PAYMENT DETAILS", pageW / 2, y, { align: "center" });
    y += 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const details = [
      ["Method", receipt.paymentMethod.toUpperCase()],
      ["Plate Number", receipt.plateNumber || ""],
      ["Duration", `${receipt.durationMinutes} min (${receipt.billedHours} hr block)`],
      ["Base Fare", `${receipt.baseFare.toFixed(2)} ETB`],
      ["VAT (15%)", `${receipt.tax.toFixed(2)} ETB`],
      ["Total Charged", `${receipt.amountDue.toFixed(2)} ETB`],
    ];
    details.forEach(([label, value]) => {
      doc.text(label, 15, y);
      doc.text(value, pageW - 15, y, { align: "right" });
      y += 6;
    });
    y += 4;
    doc.setDrawColor(100);
    doc.line(10, y, pageW - 10, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Total: ${receipt.amountDue.toFixed(2)} ETB`, pageW / 2, y, { align: "center" });
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text("Thank you for choosing Enderase!", pageW / 2, y, { align: "center" });
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Ref: MOCK-${String(Date.now()).slice(-8)}`, pageW / 2, y, { align: "center" });
    doc.save(`receipt-${Date.now()}.pdf`);
  };

  const hasActiveSession = activeSessions.length > 0;
  const checkedInBookings = activeBookings.filter(b => b.status === "checked_in");
  const allActive = [...activeSessions, ...checkedInBookings.filter(s => !activeSessions.find(a => a.id === s.id))];
  const hasReservedBooking = activeBookings.some((booking) => booking.status === "reserved");
  const flowState = hasActiveSession ? "Approved / Active Session" : checkedInBookings.length ? "Vehicle Inside / Awaiting Checkout" : hasReservedBooking ? "Reserve Complete / Awaiting Check-In" : "Reserve";

  // Navigation Directions Calculations
  const textDirections = useMemo(() => {
    if (activeSessions.length > 0) {
      const s = activeSessions[0];
      if (s.spotId) {
        return {
          spotId: s.spotId,
          driving: getSpotDirectionsClient(s.spotId, false),
          walking: getSpotDirectionsClient(s.spotId, true)
        };
      }
    }
    if (activeBookings.length > 0) {
      const b = activeBookings[0];
      if (b.spotId) {
        return {
          spotId: b.spotId,
          driving: getSpotDirectionsClient(b.spotId, false),
          walking: getSpotDirectionsClient(b.spotId, true)
        };
      }
    }
    return null;
  }, [activeSessions, activeBookings]);

  return (
    <div className="space-y-6">

      {/* ─── Hero Header ─── */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 p-6 text-white shadow-lg">
        <div className="absolute -top-6 -right-6 h-32 w-32 rounded-full bg-white/5 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">My Dashboard</h1>
              <p className="text-sm text-indigo-200 mt-0.5">Enderase — Smart Parking</p>
            </div>
            <Badge className={`px-3 py-1 text-xs font-bold uppercase shadow-sm ${hasActiveSession ? "bg-emerald-400 text-emerald-900" : hasReservedBooking ? "bg-amber-400 text-amber-900" : "bg-white/20 text-white"}`}>
              {flowState}
            </Badge>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-white/10 p-3 backdrop-blur-sm">
              <p className="text-xs text-indigo-200 font-medium uppercase tracking-wider">Active Sessions</p>
              <p className="text-2xl font-bold mt-0.5">{allActive.length}</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3 backdrop-blur-sm">
              <p className="text-xs text-indigo-200 font-medium uppercase tracking-wider">Reservations</p>
              <p className="text-2xl font-bold mt-0.5">{activeBookings.length}</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3 backdrop-blur-sm">
              <p className="text-xs text-indigo-200 font-medium uppercase tracking-wider">Pending Confirmations</p>
              <p className="text-2xl font-bold mt-0.5">{pendingPaymentRequests.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Navigation Directions ─── */}
      {textDirections && (
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-50/30 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Navigation — Spot {textDirections.spotId}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white/70 p-3 text-xs text-emerald-900 border border-emerald-100">
              <span className="font-bold block mb-0.5">🚘 Driving</span>
              {textDirections.driving}
            </div>
            <div className="rounded-lg bg-white/70 p-3 text-xs text-emerald-900 border border-emerald-100">
              <span className="font-bold block mb-0.5">🚶 Walking</span>
              {textDirections.walking}
            </div>
          </div>
        </div>
      )}

      {/* ─── Main Grid: Map + Reserve ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Map */}
        <Card className="shadow-md border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Select Parking Location</CardTitle>
            <CardDescription className="text-xs">Click a parking or marker to select</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {parkings.map((parking) => (
                <button
                  key={parking.id}
                  type="button"
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                    parking.id === selectedParkingId
                      ? "border-indigo-500 bg-indigo-50/70 text-indigo-800 ring-2 ring-indigo-500/20 font-semibold"
                      : "border-border bg-white hover:border-indigo-300 hover:bg-indigo-50/20"
                  }`}
                  onClick={() => setSelectedParkingId(parking.id)}
                >
                  <span className="text-slate-800">{parking.name}</span>
                  <span className="text-slate-400 ml-1">{parking.availableSlots ?? 0} slots</span>
                </button>
              ))}
            </div>

            {!mapsApiKey ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">Google Maps API key is missing in `.env`.</div>
            ) : loadError ? (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">Failed to load Google Maps. Check key restrictions/billing.</div>
            ) : isLoaded ? (
              <GoogleMap
                mapContainerStyle={{ width: "100%", height: "300px", borderRadius: "12px" }}
                center={mapCenter}
                zoom={13}
                onLoad={(map) => { mapRef.current = map; }}
                options={{ streetViewControl: false, mapTypeControl: false }}
              >
                {parkingCoords(selectedParking) && (
                  <Circle
                    center={parkingCoords(selectedParking)}
                    radius={1000}
                    options={{ strokeColor: "#4f46e5", strokeOpacity: 0.9, strokeWeight: 2, fillColor: "#4f46e5", fillOpacity: 0.12 }}
                  />
                )}
                {mapPoints.map(({ parking, coords }) => (
                  <Marker
                    key={parking.id}
                    position={coords}
                    title={parking.name}
                    onClick={() => setSelectedParkingId(parking.id)}
                    icon={{ url: parking.id === selectedParkingId ? "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" : "http://maps.google.com/mapfiles/ms/icons/red-dot.png" }}
                  />
                ))}
              </GoogleMap>
            ) : (
              <div className="text-xs text-slate-500">Loading map...</div>
            )}

            {selectedParking && (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                <Badge className="bg-indigo-50 text-indigo-700 border-indigo-100 text-[10px]">{selectedParking.hourlyRate || 50} ETB/hr</Badge>
                <Badge variant="secondary" className="text-[10px]">{selectedParking.availableSlots || 0}/{selectedParking.slotCapacity || 0} available</Badge>
                <span className="text-slate-400 truncate ml-auto">{selectedParking.address || ""}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reserve Form */}
        <Card className="shadow-md border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reserve a Slot</CardTitle>
            <CardDescription className="text-xs">20.00 ETB hold fee required</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={reserveSlot} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className="text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} required className="text-xs" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Plate Number</Label>
                <Input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} placeholder="AA 12345" required className="text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Payment Method</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: "telebirr", label: "Telebirr", icon: TelebirrIcon, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
                    { value: "cbe_birr", label: "CBE Birr", icon: CbeBirrIcon, color: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setReservePaymentMethod(opt.value)}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-xs transition-all ${
                        reservePaymentMethod === opt.value
                          ? `${opt.bg} ${opt.color} ring-2 ring-offset-1 font-semibold`
                          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <opt.icon className="h-5 w-5 shrink-0" />
                      <span className="font-medium">{opt.label}</span>
                      {reservePaymentMethod === opt.value && (
                        <svg className="ml-auto h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <Button disabled={loading || !selectedParkingId} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm">
                {loading ? "Processing Booking..." : "Reserve & Pay 20.00 ETB"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* ─── Active Sessions (cards with actions) ─── */}
      {allActive.length > 0 && (
        <Card className="shadow-md border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active Parking Sessions</CardTitle>
            <CardDescription className="text-xs">{allActive.length} session{allActive.length > 1 ? "s" : ""} in progress</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {allActive.map((session) => {
              const isRealSession = session.status === "active" && session.entryTime;
              const hasPendingPayment =
                Boolean(pendingPaymentRequests.find((item) => item.sessionId === session.id)) ||
                Boolean(localPendingSessionIds[session.id]);
              const isActiveSession = session.status === "active" || session.status === "checked_in";
              const canCheckout = isActiveSession && session.paymentStatus !== "confirmed" && !hasPendingPayment;
              return (
                <div key={session.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm">
                        {session.plateNumber?.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-slate-800">{session.plateNumber}</p>
                        <p className="text-xs text-slate-500">Spot {session.spotId || "Walk-In"} · {isRealSession ? formatDate(session.entryTime) : ""}</p>
                      </div>
                    </div>
                    <Badge className={`text-[10px] uppercase ${session.status === "checked_in" ? "bg-amber-100 text-amber-800" : "bg-indigo-600 text-white"}`}>
                      {session.status === "checked_in" ? "Inside" : session.status}
                    </Badge>
                  </div>
                  {hasPendingPayment ? (
                    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">Payment submitted — waiting for operator confirmation.</div>
                  ) : isRealSession ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button size="sm" disabled={!canCheckout || checkoutLoadingId === session.id} onClick={() => payWithWalletAndCheckout(session, "telebirr")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                      ><TelebirrIcon className="h-3.5 w-3.5 mr-1" /> Telebirr</Button>
                      <Button size="sm" disabled={!canCheckout || checkoutLoadingId === session.id} onClick={() => payWithWalletAndCheckout(session, "cbe_birr")}
                        className="bg-purple-700 hover:bg-purple-800 text-white text-xs font-semibold"
                      ><CbeBirrIcon className="h-3.5 w-3.5 mr-1" /> CBE Birr</Button>
                      <Button size="sm" variant="outline" disabled={!canCheckout || checkoutLoadingId === session.id} onClick={() => openPaymentDialog(session)}
                        className="border-slate-300 text-slate-700 text-xs"
                      >Manual Checkout</Button>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">Vehicle inside. Checkout options appear once operator confirms.</div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ─── Tables Grid: Reservations + Pending ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DataTableCard
          title="My Reservations"
          columns={[
            { accessorKey: "plateNumber", header: "Plate", cell: (info) => <span className="font-semibold text-slate-800">{info.getValue()}</span> },
            { accessorKey: "reservationCode", header: "Code", cell: (info) => <span className="font-mono text-indigo-600 font-bold">{info.getValue()}</span> },
            { accessorKey: "spotId", header: "Spot" },
            { accessorKey: "status", header: "Status", cell: (info) => (
              <Badge className={`text-[10px] uppercase ${info.getValue() === "reserved" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"}`}>{info.getValue()}</Badge>
            )},
            { accessorKey: "expiresAt", header: "Expires", cell: (info) => <span className="text-slate-500">{formatDate(info.getValue())}</span> },
          ]}
          data={activeBookings}
          emptyLabel="No active reservations."
        />

        <DataTableCard
          title="Pending Operator Confirmations"
          columns={[
            { accessorKey: "plateNumber", header: "Plate", cell: (info) => <span className="font-semibold text-slate-800">{info.getValue() || "Unknown"}</span> },
            { accessorKey: "amountDue", header: "Amount", cell: (info) => <span className="font-bold text-indigo-700">{info.getValue() ?? 0} ETB</span> },
            { accessorKey: "method", header: "Method" },
            { accessorKey: "referenceCode", header: "Ref", cell: (info) => <span className="font-mono text-xs">{info.getValue() || "—"}</span> },
            { id: "submittedAt", header: "Submitted", accessorFn: (row) => formatDate(row.submittedAtMs || row.submittedAt), cell: (info) => <span className="text-slate-500">{info.getValue()}</span> },
          ]}
          data={pendingPaymentRequests}
          emptyLabel={pendingPaymentsError || "No pending manual payment requests."}
        />
      </div>

      {/* Reservation Confirmation Dialog */}
      <Dialog open={!!reservationConfirm} onClose={() => setReservationConfirm(null)} title="Reservation Confirmed">
        {reservationConfirm && (
          <div className="space-y-3 pt-3 text-slate-800">
            <div className="text-center pb-2 border-b border-dashed border-slate-200">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 mb-1">
                <svg className="w-5 h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="font-bold text-base">Reservation Successful!</h3>
              <p className="text-[10px] text-slate-500">Enderase — Smart Parking</p>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Parking</span><span className="font-semibold">{reservationConfirm.parkingName}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Spot</span><span className="font-semibold text-indigo-600">{reservationConfirm.spotId}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Plate Number</span><span className="font-semibold">{reservationConfirm.plateNumber}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Payment Method</span><span className="font-semibold">{reservationConfirm.paymentMethod === "telebirr" ? "Telebirr" : "CBE Birr"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Code</span><span className="font-mono font-bold text-indigo-600">{reservationConfirm.reservationCode}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Start</span><span>{reservationConfirm.startTime}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">End</span><span>{reservationConfirm.endTime}</span></div>
              <div className="border-t border-slate-200 pt-1.5 mt-1.5 flex justify-between">
                <span className="text-slate-500">Hold Fee</span>
                <span className="font-bold text-emerald-600">20.00 ETB</span>
              </div>
            </div>

            <div className="flex justify-center py-1">
              <div className="rounded-lg border border-slate-200 bg-white p-1.5">
                <QRCodeSVG value={`${reservationConfirm.reservationCode}|${reservationConfirm.plateNumber}`} size={120} level="M" />
              </div>
            </div>
            <p className="text-center text-[10px] text-slate-400 -mt-1">Show this QR at the gate for quick check-in</p>

            <div className="flex flex-col gap-1.5 pt-1">
              <Button onClick={downloadReservePdfReceipt} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold w-full">
                Download PDF Receipt
              </Button>
              <Button onClick={() => setReservationConfirm(null)} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold w-full">
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Manual Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onClose={closePaymentDialog} title="Complete Manual Payment">
        {!checkoutSession ? null : (
          <div className="space-y-4 pt-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-semibold text-slate-800">{checkoutSession.plateNumber}</div>
              <div className="text-xs text-slate-500 mt-0.5">Parking ID: {checkoutSession.parkingId}</div>
              <div className="text-[11px] text-slate-500">Entry: {formatDate(checkoutSession.entryTime)}</div>
            </div>

            <div className="space-y-2">
              <Label>Select Manual Route</Label>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="bank">Bank Transfer</option>
                <option value="phone">Phone Payment</option>
              </Select>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="font-bold text-slate-800 mb-1">Send to Operator Details:</div>
              {loadingPaymentDestination ? (
                <div className="text-slate-400">Fetching details...</div>
              ) : paymentMethod === "bank" ? (
                <div className="text-slate-600 space-y-0.5">
                  <div>🏦 Bank Account: <span className="font-mono font-bold text-indigo-600">{paymentDestination.bankAccountNumber || "Pending setup"}</span></div>
                  <div className="text-[10px] text-slate-400">Transfer ETB amount to this bank account before submitting.</div>
                </div>
              ) : (
                <div className="text-slate-600 space-y-0.5">
                  <div>📱 Operator Phone: <span className="font-bold text-indigo-600">{paymentDestination.phone || "Pending setup"}</span></div>
                  <div className="text-[10px] text-slate-400">Send Mobile Money to this phone number.</div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Reference Receipt Code (Required)</Label>
              <Input
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                placeholder="Slip ID / transaction ID"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closePaymentDialog} disabled={checkoutLoadingId === checkoutSession.id} className="border-slate-300 text-slate-700">
                Cancel
              </Button>
              <Button onClick={submitManualPayment} disabled={checkoutLoadingId === checkoutSession.id || !referenceCode.trim()} className="bg-indigo-600 text-white font-semibold">
                {checkoutLoadingId === checkoutSession.id ? "Submitting..." : "Complete Manual Checkout"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Gorgeous Detailed Receipt Modal */}
      <Dialog open={isReceiptOpen} onClose={() => setIsReceiptOpen(false)} title="Checkout Successful">
        {receipt && (
          <div className="space-y-4 pt-4 text-slate-800">
            <div className="text-center pb-3 border-b border-dashed border-slate-200">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-2">
                <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Payment Invoice Receipt</h3>
              <p className="text-xs text-slate-500">Enderase — Smart Parking</p>
            </div>

            <div className="space-y-2 bg-slate-50 p-4 rounded-lg text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Parking Fee Method</span>
                <span className="font-semibold text-indigo-700 uppercase">{receipt.paymentMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Parked Duration</span>
                <span className="font-semibold">{receipt.durationMinutes} min ({receipt.billedHours} hr block)</span>
              </div>
              <div className="flex justify-between border-t border-slate-200/50 pt-2 mt-2">
                <span className="text-slate-500">Base Fare (Flat hourly)</span>
                <span className="font-semibold">{receipt.baseFare.toFixed(2)} ETB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">VAT Tax (15%)</span>
                <span className="font-semibold">{receipt.tax.toFixed(2)} ETB</span>
              </div>
              
              <div className="flex justify-between border-t-2 border-dashed border-slate-200 pt-2.5 mt-2.5 text-base font-extrabold text-slate-900">
                <span>Total Amount Charged</span>
                <span>{receipt.amountDue.toFixed(2)} ETB</span>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-center text-xs text-emerald-800">
              <span className="font-bold">🔐 Remaining Wallet Balance:</span> {receipt.remainingBalance.toFixed(2)} ETB
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={downloadPdfReceipt} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold w-full">
                Download PDF Receipt
              </Button>
              <Button onClick={() => setIsReceiptOpen(false)} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold w-full">
                Close & Return
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function parkingCoords(parking) {
  if (!parking) return null;
  const loc = parking.location || {};
  const lat =
    toNumber(loc.lat) ??
    toNumber(loc.latitude) ??
    toNumber(loc._lat) ??
    toNumber(parking.lat) ??
    toNumber(parking.latitude);
  const lng =
    toNumber(loc.lng) ??
    toNumber(loc.longitude) ??
    toNumber(loc._long) ??
    toNumber(parking.lng) ??
    toNumber(parking.longitude);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function DataTableCard({ title, columns, data, emptyLabel }) {
  const [sorting, setSorting] = useState([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
      <CardContent>
        {!data.length ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-auto">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-border bg-slate-50/80">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-600"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted()] ?? ""}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, i) => (
                  <tr key={row.id} className={`border-b border-border/50 transition-colors hover:bg-slate-50 ${i % 2 === 1 ? "bg-slate-50/40" : ""}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DriverHome;
