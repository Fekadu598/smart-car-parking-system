import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { MapContainer, Marker, TileLayer, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";
import { auth, firestore } from "../firebase";
import callApi from "../lib/callApi";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { jsPDF } from "jspdf";

let qrScannerInstance = null;

function TelebirrIcon2({ className }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <rect width="40" height="40" rx="10" fill="#00AB4E" />
      <circle cx="20" cy="15" r="7" fill="white" opacity="0.95" />
      <circle cx="20" cy="15" r="4" fill="#00AB4E" />
      <text x="20" y="33" textAnchor="middle" fill="white" fontSize="7" fontWeight="800" fontFamily="sans-serif" letterSpacing="0.4">telebirr</text>
    </svg>
  )
}
function CbeBirrIcon2({ className }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <rect width="40" height="40" rx="10" fill="#7c1d6e" />
      <rect x="6" y="6" width="28" height="28" rx="6" fill="white" opacity="0.15" />
      <text x="20" y="22" textAnchor="middle" fill="white" fontSize="12" fontWeight="900" fontFamily="sans-serif">CB</text>
      <text x="20" y="34" textAnchor="middle" fill="white" fontSize="5" fontWeight="700" fontFamily="sans-serif" letterSpacing="0.6">CBE BIRR</text>
    </svg>
  )
}
function CashIcon({ className }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      <rect width="40" height="40" rx="8" fill="#ecfdf5" />
      <circle cx="20" cy="20" r="6" fill="#059669" />
      <rect x="8" y="14" width="24" height="14" rx="3" fill="#059669" opacity="0.2" />
    </svg>
  )
}
// Ethiopian license plate helpers
function formatEtPlate(v) {
  const clean = v.replace(/[\s-]/g, "").toUpperCase();
  const match = clean.match(/^([A-Z]{2})(\d{1,5})$/);
  if (!match) {
    const wide = clean.match(/^.*?([A-Z]{2}).*?(\d{1,5}).*$/);
    if (wide) return formatEtPlate(wide[1] + wide[2]);
    return clean;
  }
  const digits = match[2], prefix = match[1];
  if (digits.length <= 3) return `${prefix} ${digits}`;
  if (digits.length === 4) return `${prefix} ${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${prefix} ${digits.slice(0, 3)}-${digits.slice(3)}`;
}
function displayEtPlate(v) {
  if (!v) return "";
  return formatEtPlate(v);
}
function parkingCoords(parking) {
  if (!parking) return null;
  const loc = parking.location || {};
  const lat = loc.lat ?? loc.latitude ?? loc._lat ?? parking.lat ?? parking.latitude;
  const lng = loc.lng ?? loc.longitude ?? loc._long ?? parking.lng ?? parking.longitude;
  if (lat == null || lng == null) return null;
  return { lat: Number(lat), lng: Number(lng) };
}
const mapMarkerIcon = L.divIcon({
  className: "",
  html: '<div style="background:#4f46e5;border:3px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function OperatorHome() {
  const [assignedParkingIds, setAssignedParkingIds] = useState([]);
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [reservationCodeInput, setReservationCodeInput] = useState("");
  const [allowWalkIn, setAllowWalkIn] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);
  const [reservedBookings, setReservedBookings] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [, setPendingPayments] = useState([]);
  const [, setPendingPaymentsError] = useState("");
  const [paymentsRefreshNonce, setPaymentsRefreshNonce] = useState(0);
  const [confirmPaymentTarget, setConfirmPaymentTarget] = useState(null);

  // Checkout Receipt States
  const [receipt, setReceipt] = useState(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Custom Gate Alert Indicators
  const [gateOpen, setGateOpen] = useState(false);
  const [gateOpenMessage, setGateOpenMessage] = useState("");
  const [selectedSpotDetails, setSelectedSpotDetails] = useState(null);
  const [dialogPlateNumber, setDialogPlateNumber] = useState("");
  const [dialogReservationCode, setDialogReservationCode] = useState("");


  // Search by Plate/Reservation Checkout Dialog states
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [isCheckoutDialogOpen, setIsCheckoutDialogOpen] = useState(false);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState("cash");

  const [qrPayload, setQrPayload] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");
  const [qrRefreshNonce, setQrRefreshNonce] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");

  // Trigger temporary gate opening animation
  const triggerGateFlash = (message) => {
    setGateOpenMessage(message);
    setGateOpen(true);
    setTimeout(() => {
      setGateOpen(false);
    }, 4000);
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore.collection("users").doc(uid).onSnapshot(
      (snap) => {
        const profile = snap.exists ? snap.data() : null;
        const assigned = Array.isArray(profile?.assignedParkingIds) ? profile.assignedParkingIds : [];
        setAssignedParkingIds(assigned);
        if (!selectedParkingId && assigned.length) setSelectedParkingId(assigned[0]);
      },
      (err) => handleRealtimeError(err, "Failed to load operator profile.")
    );
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    if (!selectedParkingId) {
      setPendingPayments([]);
      return undefined;
    }
    let mounted = true;
    let timer = null;

    const loadPendingPayments = async () => {
      try {
        const response = await callApi("listPendingPaymentsForOperator", { parkingId: selectedParkingId });
        if (!mounted) return;
        setPendingPayments(Array.isArray(response?.data?.pendingPayments) ? response.data.pendingPayments : []);
        setPendingPaymentsError("");
      } catch (err) {
        if (mounted) {
          setPendingPayments([]);
          setPendingPaymentsError(err.message || "Pending payments are temporarily unavailable.");
        }
      }
    };

    loadPendingPayments();
    timer = setInterval(loadPendingPayments, 8000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [selectedParkingId, paymentsRefreshNonce]);

  useEffect(() => {
    if (!selectedParkingId) {
      setPendingRequests([]);
      return undefined;
    }
    const unsub = firestore
      .collection("checkInRequests")
      .where("parkingId", "==", selectedParkingId)
      .where("status", "==", "pending")
      .onSnapshot(
        (snapshot) => {
          const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          list.sort((a, b) => getMs(b.createdAt) - getMs(a.createdAt));
          setPendingRequests(list);
        },
        (err) => handleRealtimeError(err, "Failed to load pending requests.")
      );
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    if (!assignedParkingIds.length) {
      setParkings([]);
      return undefined;
    }
    setParkings([]);
    let mounted = true;
    const unsubscribers = assignedParkingIds.map((parkingId) =>
      firestore.collection("parkings").doc(parkingId).onSnapshot(
        (docSnap) => {
          if (!mounted) return;
          setParkings((prev) => {
            const filtered = prev.filter((p) => p.id !== parkingId);
            if (!docSnap.exists) return filtered;
            return [...filtered, { id: docSnap.id, ...docSnap.data() }].sort((a, b) => a.name.localeCompare(b.name));
          });
        },
        (err) => handleRealtimeError(err, "Failed to load assigned parking.")
      )
    );
    return () => {
      mounted = false;
      unsubscribers.forEach((fn) => fn());
    };
  }, [assignedParkingIds]);

  useEffect(() => {
    if (!selectedParkingId) {
      setActiveSessions([]);
      return undefined;
    }
    const unsub = firestore
      .collection("sessions")
      .where("parkingId", "==", selectedParkingId)
      .where("status", "==", "active")
      .orderBy("entryTime", "desc")
      .onSnapshot(
        (snapshot) => {
          setActiveSessions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        },
        (err) => handleRealtimeError(err, "Failed to load active sessions.")
      );
    return () => unsub();
  }, [selectedParkingId]);

  // Subscribe to all reserved bookings for the spot status list
  useEffect(() => {
    if (!selectedParkingId) {
      setReservedBookings([]);
      return undefined;
    }
    const unsub = firestore
      .collection("bookings")
      .where("parkingId", "==", selectedParkingId)
      .where("status", "==", "reserved")
      .onSnapshot(
        (snapshot) => {
          setReservedBookings(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        },
        (err) => console.error("Failed to load reserved bookings", err)
      );
    return () => unsub();
  }, [selectedParkingId]);

  const selectedParking = useMemo(
    () => parkings.find((parking) => parking.id === selectedParkingId) || null,
    [parkings, selectedParkingId]
  );

  useEffect(() => {
    if (!selectedParkingId) {
      setQrPayload(null);
      return undefined;
    }

    let active = true;
    let timer = null;
    const refreshQr = async () => {
      try {
        setQrLoading(true);
        const response = await callApi("createParkingCheckInToken", { parkingId: selectedParkingId });
        if (!active) return;
        setQrPayload(response.data);
        setQrError("");
      } catch (err) {
        if (!active) return;
        setQrPayload(null);
        setQrError(err.message || "QR generation is temporarily unavailable.");
      } finally {
        if (active) setQrLoading(false);
      }
    };

    refreshQr();
    timer = setInterval(refreshQr, 55000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [selectedParkingId, qrRefreshNonce]);

  const callAction = async (name, payload) => {
    setLoadingAction(name);
    try {
      const response = await callApi(name, payload);
      toast.success(`${name} success.`);
      return response.data;
    } catch (err) {
      toast.error(err.message || `${name} failed`);
      return null;
    } finally {
      setLoadingAction("");
    }
  };

  // Check In Vehicle using Reservation Code OR Plate Number
  const onCheckIn = async (e) => {
    e.preventDefault();
    const res = await callAction("checkInVehicle", {
      parkingId: selectedParkingId,
      plateNumber: plateNumber.trim(),
      reservationCode: reservationCodeInput.trim(),
      allowWalkIn
    });
    if (res?.sessionId) {
      triggerGateFlash(`Check-In Successful (Spot: ${res.spotId || "Allocated"})! Entry Gate Unlocked.`);
      setPlateNumber("");
      setReservationCodeInput("");
    }
  };

  const onApproveRequest = async (requestId) => {
    const result = await callAction("approveCheckInRequest", { requestId });
    if (result?.sessionId) {
      triggerGateFlash(`Check-In QR Approved! Entrance Gate Unlocked.`);
    }
  };

  const onRejectRequest = async (requestId) => {
    await callAction("rejectCheckInRequest", { requestId });
  };

  const onConfirmPayment = async (requestId) => {
    const result = await callAction("confirmManualPayment", { requestId });
    if (result?.feeAmount != null) {
      triggerGateFlash(`Manual Payment Confirmed! Exit Gate Opened.`);
    }
    setConfirmPaymentTarget(null);
    setPaymentsRefreshNonce((n) => n + 1);
  };


  const downloadPdfReceipt = () => {
    if (!receipt) return;
    const doc = new jsPDF({ format: "a5" });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 15;

    doc.setDrawColor(79, 70, 229);
    doc.setFillColor(79, 70, 229);
    doc.circle(12, y + 4, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text("P", 12, y + 6, { align: "center" });

    doc.setTextColor(79, 70, 229);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Enderase", 22, y + 5);

    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text("Smart Parking", 22, y + 11);

    y += 22;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PAYMENT RECEIPT", pageW / 2, y, { align: "center" });
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
      ["Parking", receipt.parkingName],
      ["Plate Number", receipt.plateNumber],
      ["Method", receipt.paymentMethod.toUpperCase()],
      ["Duration", `${receipt.durationMinutes} min (${receipt.billedHours} hr block)`],
      ["Base Fare", `${receipt.baseFare.toFixed(2)} ETB`],
      ["VAT (15%)", `${receipt.tax.toFixed(2)} ETB`],
      ["Total Charged", `${receipt.amountDue.toFixed(2)} ETB`],
    ];
    if (receipt.remainingBalance != null) {
      details.push(["Remaining Balance", `${receipt.remainingBalance.toFixed(2)} ETB`]);
    }
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
    doc.text(`Ref: CHK-${String(Date.now()).slice(-8)}`, pageW / 2, y, { align: "center" });
    doc.save(`receipt-${Date.now()}.pdf`);
  };

  // Direct checkout by operator (cash or Telebirr / CBE Birr)
  const openDirectCheckoutDialog = (session) => {
    setSearchResult(session);
    setCheckoutPaymentMethod("cash");
    setIsCheckoutDialogOpen(true);
  };

  const submitDirectCheckout = async () => {
    if (!searchResult) return;
    setLoadingAction("checkOutVehicle");
    try {
      const response = await callApi("checkOutVehicle", {
        parkingId: selectedParkingId,
        plateNumber: searchResult.plateNumber,
        paymentMethod: checkoutPaymentMethod
      });
      
      const parkingName = parkings.find(p => p.id === selectedParkingId)?.name || "Parking";
      setReceipt({ ...response.data.receipt, parkingName });
      setIsReceiptOpen(true);
      triggerGateFlash(`Vehicle Checked Out via ${checkoutPaymentMethod.toUpperCase()}! Exit Gate Unlocked.`);
      setIsCheckoutDialogOpen(false);
      setSearchQuery("");
      setSearchResult(null);
    } catch (err) {
      toast.error(err.message || "Failed to checkout vehicle.");
    } finally {
      setLoadingAction("");
    }
  };

  // Trigger local cron manually for grace period expirations

  // eslint-disable-next-line no-unused-vars
  const resolvePendingPaymentForSession = async (sessionId) => {
    setLoadingAction("getPendingPaymentForSession");
    try {
      const response = await callApi("getPendingPaymentForSession", { sessionId });
      const pendingPayment = response?.data?.pendingPayment || null;
      if (!pendingPayment) {
        toast.error("No pending payment found for this session.");
        return null;
      }
      setPendingPayments((prev) => {
        const others = prev.filter((item) => item.id !== pendingPayment.id);
        return [pendingPayment, ...others];
      });
      return pendingPayment;
    } catch (err) {
      toast.error(err.message || "Failed to resolve pending payment.");
      return null;
    } finally {
      setLoadingAction("");
    }
  };

  // In-memory calculations for spot occupancy table
  const spotStatusList = useMemo(() => {
    if (!selectedParking) return [];
    const capacity = selectedParking.slotCapacity || 10;
    const rows = ["A", "B", "C", "D", "E"];
    const list = [];

    const occupiedMap = {};
    activeSessions.forEach((s) => {
      if (s.spotId) {
        occupiedMap[s.spotId] = {
          type: "occupied",
          plate: s.plateNumber,
          id: s.id,
          driverId: s.driverId,
          entryTime: s.entryTime,
        };
      }
    });

    const reservedMap = {};
    reservedBookings.forEach((b) => {
      if (b.spotId) {
        reservedMap[b.spotId] = {
          type: "reserved",
          plate: b.plateNumber,
          code: b.reservationCode,
        };
      }
    });

    for (let i = 0; i < capacity; i++) {
      const rowIdx = Math.floor(i / 10);
      const spotNum = (i % 10) + 1;
      const rowLetter = rows[rowIdx] || "F";
      const spotId = `${rowLetter}${spotNum}`;

      let status = "available";
      let details = null;
      if (occupiedMap[spotId]) {
        status = "occupied";
        details = occupiedMap[spotId];
      } else if (reservedMap[spotId]) {
        status = "reserved";
        details = reservedMap[spotId];
      }

      list.push({ spotId, status, details });
    }
    return list;
  }, [selectedParking, activeSessions, reservedBookings]);

  // Handle local plate search
  const filteredActiveSessions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.trim().toUpperCase();
    return activeSessions.filter((s) => s.plateNumber.includes(query));
  }, [searchQuery, activeSessions]);

  const qrLink = qrPayload?.deepLink || "";
  const qrImageUrl = qrLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrLink)}`
    : "";

  // --- QR Scanner callbacks ---
  const onScanSuccess = useCallback((decodedText) => {
    setScanning(false);
    const parts = decodedText.split("|");
    if (parts.length >= 2) {
      setReservationCodeInput(parts[0]);
      setPlateNumber(parts[1]);
    } else {
      setReservationCodeInput(decodedText);
    }
    setScannerOpen(false);
    toast.success("QR scanned successfully!");
  }, []);

  const startScanner = useCallback(async () => {
    setScanning(true);
    setScannerOpen(true);
  }, []);

  const stopScanner = useCallback(async () => {
    setScanning(false);
    if (qrScannerInstance) {
      try { await qrScannerInstance.stop(); } catch (_) {}
      try { qrScannerInstance.clear(); } catch (_) {}
      qrScannerInstance = null;
    }
  }, []);

  useEffect(() => {
    return () => { stopScanner(); };
  }, [stopScanner]);

  useEffect(() => {
    if (!scannerOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode: QrCode } = await import("html5-qrcode");
        const readerEl = document.getElementById("qr-reader");
        if (!readerEl || cancelled) return;
        const scanner = new QrCode("qr-reader");
        qrScannerInstance = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (!cancelled) onScanSuccess(decodedText);
          },
          () => {}
        );
      } catch (err) {
        if (!cancelled) {
          toast.error("Camera access denied or unavailable");
          setScannerOpen(false);
          setScanning(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [scannerOpen, onScanSuccess]);

  return (
    <div className="space-y-6">
      {/* Gate Alert Flash Banner */}
      {gateOpen && (
        <div className="bg-emerald-600 text-white p-4 rounded-xl flex items-center justify-between shadow-2xl animate-bounce border border-emerald-500">
          <div className="flex items-center gap-3">
            <span className="text-2xl animate-spin">🚧</span>
            <div>
              <div className="font-extrabold text-sm uppercase tracking-widest text-emerald-100">Physical Gate Update</div>
              <div className="text-xs font-semibold mt-0.5">{gateOpenMessage}</div>
            </div>
          </div>
          <Badge className="bg-white text-emerald-800 font-black px-3.5 py-1 text-xs">UNLOCKED</Badge>
        </div>
      )}

      {/* Main Flow Banner */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="col-span-2 shadow-lg border-border/80 bg-slate-900 text-white relative overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg text-slate-200">Operator Dashboard</CardTitle>
                <CardDescription className="text-slate-400 text-xs">Live Lot Operations & Access Controls</CardDescription>
              </div>
              <Badge className="bg-indigo-600/30 text-indigo-300 border-indigo-500/20 uppercase tracking-wider text-[10px]">Active Operator</Badge>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Search active sessions & Direct checkout */}
      <Card className="animate-fade-in-up shadow-md border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle>Direct Exit Search & Checkout Gateway</CardTitle>
          <CardDescription>Search active parking sessions by vehicle plate to perform direct operator checkouts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search plate (e.g. AA 12345)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-slate-300 focus:border-indigo-500"
            />
          </div>

          {searchQuery.trim() && (
            <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/50">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Search Results ({filteredActiveSessions.length})</h3>
              {filteredActiveSessions.length === 0 ? (
                <p className="text-xs text-slate-400">No active vehicles found matching query.</p>
              ) : (
                <div className="space-y-2">
                  {filteredActiveSessions.map((session) => (
                    <div key={session.id} className="flex justify-between items-center bg-white p-3.5 rounded-lg border border-slate-200 shadow-sm">
                      <div>
                        <div className="font-bold text-sm text-slate-800">{displayEtPlate(session.plateNumber)}</div>
                        <div className="text-[10px] text-slate-500">Spot ID: <span className="font-semibold text-indigo-600">{session.spotId || "Walk-In"}</span></div>
                        <div className="text-[10px] text-slate-400">Entered: {new Date(getMs(session.entryTime)).toLocaleString()}</div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => openDirectCheckoutDialog(session)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs"
                      >
                        ⚡ Direct Checkout
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parking Location Map */}
      <Card className="animate-fade-in-up shadow-md border-border/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-indigo-500" />
            Parking Location
          </CardTitle>
          <CardDescription className="text-xs">
            {selectedParking ? selectedParking.name || "Selected Lot" : "Select a parking lot to view location"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedParkingId ? (
            <EmptyState icon="inbox" title="No parking selected" description="Choose a lot from the dropdown above." />
          ) : (() => {
            const coords = parkingCoords(selectedParking);
            if (!coords) {
              return (
                <div className="h-48 rounded-xl bg-slate-100 flex items-center justify-center text-sm text-slate-400">
                  No location data for this parking lot
                </div>
              );
            }
            return (
              <div className="h-48 rounded-xl overflow-hidden border border-slate-200 z-0">
                <MapContainer center={coords} zoom={16} scrollWheelZoom={false} style={{ width: "100%", height: "100%" }} zoomControl={true}>
                  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <Marker position={coords} icon={mapMarkerIcon} />
                  <Circle center={coords} radius={100} pathOptions={{ color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.1, weight: 2 }} />
                </MapContainer>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Dynamic 2D Visual Interactive Spot Layout Map */}
      <Card className="animate-fade-in-up shadow-md border-slate-200 bg-slate-900 border-slate-800">
        <CardHeader className="pb-1">
          <CardTitle className="text-white text-lg">2D Visual Parking Lot Layout Map</CardTitle>
          <CardDescription className="text-slate-400">Click on any visual parking spot to perform check-ins, view vehicle details, or process exit checkouts.</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
            {!selectedParkingId ? (
            <EmptyState icon="inbox" title="No parking selected" description="Choose a lot from the dropdown to view spots." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-inner sm:p-4">
              <div className="min-w-[700px] md:min-w-[950px]">
                <svg viewBox="0 0 1000 370" className="w-full h-auto select-none font-sans">
                  {/* Asphalt Road Background */}
                  <rect x="0" y="140" width="1000" height="90" fill="#1e293b" />
                  
                  {/* Central Driving Lane Divider */}
                  <line x1="0" y1="185" x2="1000" y2="185" stroke="#64748b" strokeWidth="4" strokeDasharray="12,12" />
                  
                  {/* Entrance Road Sign / Directional Arrow */}
                  <path d="M 50 185 L 80 185 M 80 185 L 72 177 M 80 185 L 72 193" stroke="#f1f5f9" strokeWidth="3" fill="none" />
                  <text x="45" y="168" fill="#94a3b8" className="text-[10px] font-black uppercase tracking-wider">Entry Flow</text>

                  {/* Exit Road Sign / Directional Arrow */}
                  <path d="M 920 185 L 950 185 M 950 185 L 942 177 M 950 185 L 942 193" stroke="#f1f5f9" strokeWidth="3" fill="none" />
                  <text x="910" y="168" fill="#94a3b8" className="text-[10px] font-black uppercase tracking-wider">Exit Flow</text>

                  {/* Entrance Gate (Left) */}
                  <g>
                    {/* Gate Pillar */}
                    <rect x="25" y="130" width="12" height="110" fill="#475569" rx="3" />
                    <circle cx="31" cy="185" r="8" fill="#3b82f6" />
                    {/* Barrier Arm */}
                    <line 
                      x1="31" y1="185" 
                      x2={gateOpen ? "31" : "120"} 
                      y2={gateOpen ? "95" : "185"} 
                      stroke={gateOpen ? "#10b981" : "#ef4444"} 
                      strokeWidth="6" 
                      className="transition-all duration-700 ease-in-out" 
                    />
                    {/* Barrier Arm Label */}
                    <text x="15" y="255" fill={gateOpen ? "#34d399" : "#f87171"} className="text-[9px] font-bold tracking-widest uppercase">
                      {gateOpen ? "🔓 ENTRANCE OPEN" : "🔒 ENTRANCE CLOSED"}
                    </text>
                  </g>

                  {/* Exit Gate (Right) */}
                  <g>
                    {/* Gate Pillar */}
                    <rect x="963" y="130" width="12" height="110" fill="#475569" rx="3" />
                    <circle cx="969" cy="185" r="8" fill="#3b82f6" />
                    {/* Barrier Arm (Opens in opposite direction, or upward) */}
                    <line 
                      x1="969" y1="185" 
                      x2={gateOpen ? "969" : "880"} 
                      y2={gateOpen ? "95" : "185"} 
                      stroke={gateOpen ? "#10b981" : "#ef4444"} 
                      strokeWidth="6" 
                      className="transition-all duration-700 ease-in-out" 
                    />
                    <text x="870" y="255" fill={gateOpen ? "#34d399" : "#f87171"} className="text-[9px] font-bold tracking-widest uppercase text-right">
                      {gateOpen ? "🔓 EXIT UNLOCKED" : "🔒 EXIT LOCKED"}
                    </text>
                  </g>

                  {/* Dynamic Slots */}
                  {spotStatusList.map((spot, idx) => {
                    const rowLetter = spot.spotId.charAt(0);
                    const spotNum = parseInt(spot.spotId.substring(1), 10);
                    const colIdx = spotNum - 1;

                    // Arrange top row: Rows A, C, E, etc.
                    // Arrange bottom row: Rows B, D, F, etc.
                    const isTop = ["A", "C", "E"].includes(rowLetter);
                    const x = 90 + colIdx * 82;
                    const y = isTop ? 15 : 245;

                    let fill = "#1e293b";
                    let stroke = "#334155";
                    let iconColor = "#94a3b8";

                    if (spot.status === "occupied") {
                      fill = "rgba(239, 68, 68, 0.08)";
                      stroke = "#ef4444";
                      iconColor = "#ef4444";
                    } else if (spot.status === "reserved") {
                      fill = "rgba(245, 158, 11, 0.08)";
                      stroke = "#f59e0b";
                      iconColor = "#f59e0b";
                    } else {
                      fill = "rgba(16, 185, 129, 0.08)";
                      stroke = "#10b981";
                      iconColor = "#10b981";
                    }

                    return (
                      <g 
                        key={spot.spotId} 
                        transform={`translate(${x}, ${y})`}
                        className="cursor-pointer group"
                        onClick={() => setSelectedSpotDetails(spot)}
                      >
                        {/* Spot Background Box */}
                        <rect 
                          x="0" 
                          y="0" 
                          width="74" 
                          height="110" 
                          fill={fill} 
                          stroke={stroke} 
                          strokeWidth="2.5" 
                          rx="8" 
                          className="transition-all duration-300 group-hover:fill-slate-900/60 group-hover:stroke-indigo-400"
                        />

                        {/* Yellow Parking Bay Outline Lines */}
                        <line x1="2" y1="0" x2="2" y2="110" stroke="#fef08a" strokeWidth="1" strokeDasharray="3,3" opacity="0.3" />
                        <line x1="72" y1="0" x2="72" y2="110" stroke="#fef08a" strokeWidth="1" strokeDasharray="3,3" opacity="0.3" />

                        {/* Spot ID Badge */}
                        <rect x="18" y="8" width="38" height="18" fill="rgba(15, 23, 42, 0.8)" rx="4" stroke={stroke} strokeWidth="1" />
                        <text x="37" y="21" fill="#f8fafc" textAnchor="middle" className="text-[10px] font-black tracking-wider">
                          {spot.spotId}
                        </text>

                        {/* Visual Occupancy Icon */}
                        {spot.status === "occupied" ? (
                          <g transform="translate(17, 34)">
                            {/* SVG Passenger Car Silhouette */}
                            <path 
                              d="M5 26 L5 23 C5 19, 8 18, 12 17 L28 17 C32 18, 35 19, 35 23 L35 26 Z M8 17 L11 9 C12 7, 14 6, 17 6 L23 6 C26 6, 28 7, 29 9 L32 17 Z" 
                              fill={iconColor} 
                            />
                            {/* Wheels */}
                            <circle cx="10" cy="27" r="4.5" fill="#0f172a" stroke={stroke} strokeWidth="1.5" />
                            <circle cx="30" cy="27" r="4.5" fill="#0f172a" stroke={stroke} strokeWidth="1.5" />
                          </g>
                        ) : spot.status === "reserved" ? (
                          <g transform="translate(23, 38)">
                            {/* SVG Calendar/Timer Icon */}
                            <rect x="0" y="3" width="28" height="24" rx="4" fill="none" stroke={iconColor} strokeWidth="2.5" />
                            <line x1="6" y1="0" x2="6" y2="5" stroke={iconColor} strokeWidth="2.5" strokeLinecap="round" />
                            <line x1="22" y1="0" x2="22" y2="5" stroke={iconColor} strokeWidth="2.5" strokeLinecap="round" />
                            <circle cx="14" cy="16" r="4.5" fill="none" stroke={iconColor} strokeWidth="2.5" />
                          </g>
                        ) : (
                          <g transform="translate(25, 40)">
                            {/* SVG Plus Sign for Empty Available Slot */}
                            <circle cx="12" cy="12" r="12" fill="none" stroke={iconColor} strokeWidth="2" strokeDasharray="3,2" />
                            <line x1="12" y1="6" x2="12" y2="18" stroke={iconColor} strokeWidth="2.5" strokeLinecap="round" />
                            <line x1="6" y1="12" x2="18" y2="12" stroke={iconColor} strokeWidth="2.5" strokeLinecap="round" />
                          </g>
                        )}

                        {/* License Plate Text display */}
                        {spot.details?.plate ? (
                          <g transform="translate(4, 86)">
                            <rect x="0" y="0" width="66" height="16" fill="rgba(15, 23, 42, 0.9)" rx="3" stroke="#f1f5f9" strokeWidth="0.5" />
                            <text x="33" y="11" fill="#fbbf24" textAnchor="middle" className="text-[8px] font-mono font-extrabold tracking-tight">
                              {displayEtPlate(spot.details.plate)}
                            </text>
                          </g>
                        ) : (
                          <text x="37" y="96" fill="#64748b" textAnchor="middle" className="text-[8px] font-bold uppercase tracking-widest opacity-80">
                            EMPTY
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operator Check-In & Refreshes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-in-up shadow-md border-border/80">
          <CardHeader>
            <CardTitle>Manual Vehicle Check-In</CardTitle>
            <CardDescription>Support reservations check-in (code input) or immediate walk-ins.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="space-y-2">
                <Label>Assigned Parking</Label>
                <Select value={selectedParkingId} onChange={(e) => setSelectedParkingId(e.target.value)} required>
                  {parkings.map((parking) => (
                    <option key={parking.id} value={parking.id}>
                      {parking.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plate Number</Label>
                  <Input value={plateNumber} onChange={(e) => {
                    let raw = e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, "");
                    const parts = raw.replace(/\s+/g, " ").split(" ");
                    if (parts.length === 2) {
                      const letters = parts[0].slice(0, 2).replace(/[^A-Z]/g, "");
                      const digits = parts[1].replace(/\D/g, "").slice(0, 5);
                      let formatted = letters;
                      if (digits.length > 0) formatted += " " + digits;
                      if (digits.length > 3) formatted = letters + " " + digits.slice(0, 3) + "-" + digits.slice(3);
                      setPlateNumber(formatted);
                    } else {
                      const cleaned = raw.replace(/[\s-]/g, "");
                      if (/^[A-Z]{0,2}$/.test(cleaned)) { setPlateNumber(cleaned); }
                      else if (/^[A-Z]{2}\d{0,5}$/.test(cleaned)) {
                        const l = cleaned.slice(0, 2);
                        const d = cleaned.slice(2);
                        let f = l + " " + d;
                        if (d.length > 3) f = l + " " + d.slice(0, 3) + "-" + d.slice(3);
                        setPlateNumber(f);
                      } else { setPlateNumber(raw); }
                    }
                  }} onBlur={() => { if (plateNumber.length > 2) setPlateNumber(formatEtPlate(plateNumber)); }} placeholder="AA 12345" />
                </div>
                
                <div className="space-y-2">
                  <Label>Reservation Code (Optional)</Label>
                  <div className="flex gap-2">
                    <Input value={reservationCodeInput} onChange={(e) => setReservationCodeInput(e.target.value.toUpperCase())} placeholder="RES-ABC12" className="flex-1" />
                    <Button type="button" variant="outline" size="sm" onClick={startScanner} className="border-slate-300 whitespace-nowrap" title="Scan QR Code">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect width="5" height="5" x="7" y="7" rx="1"/><path d="M14 17v.01"/><path d="M14 14v.01"/><path d="M14 11v.01"/><path d="M17 14v.01"/><path d="M17 11v.01"/><path d="M20 14v.01"/><path d="M20 11v.01"/></svg>
                    </Button>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowWalkIn}
                  onChange={(e) => setAllowWalkIn(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Allow Walk-In Spot Allocation (if reservation code is blank)
              </label>

              <div className="pt-2">
                <Button onClick={onCheckIn} disabled={loadingAction === "checkInVehicle"} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                  {loadingAction === "checkInVehicle" ? "Checking in..." : "Confirm Gate Access"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* QR Check-In Widget */}
        <Card className="animate-fade-in-up shadow-md border-border/80">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Driver Check-In QR</CardTitle>
              <CardDescription>Refreshes every minute for secure check-ins.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setQrRefreshNonce((n) => n + 1)} disabled={qrLoading} className="border-slate-300">
              {qrLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </CardHeader>
          <CardContent>
            {!selectedParkingId ? (
              <EmptyState icon="inbox" title="Select a parking" description="Choose a lot to generate the check-in QR code." />
            ) : qrLoading && !qrPayload ? (
              <p className="text-xs text-slate-400">Generating secure QR code...</p>
            ) : qrPayload ? (
              <div className="flex flex-col items-start gap-4 md:flex-row">
                <img src={qrImageUrl} alt="Check-in QR" width={180} height={180} className="rounded-lg border border-slate-200" />
                <div className="space-y-1.5 text-xs text-slate-600">
                  <p>Drivers scan this QR, confirm vehicle plate, and request gate entries.</p>
                  <p>Token ID: <span className="font-mono bg-slate-100 p-0.5 rounded font-bold text-slate-900">{qrPayload.tokenId}</span></p>
                  <p>Expires: <span className="font-semibold text-slate-900">{new Date(qrPayload.expiresAtMs || 0).toLocaleTimeString()}</span></p>
                  <a href={qrLink} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700 font-bold block mt-1.5">
                    Open Deep Link
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">{qrError || "QR generation offline."}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Selected Lot parameters */}
        <Card className="shadow-sm border-border/80">
          <CardHeader>
            <CardTitle>Parking Lot Counters</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedParking ? (
              <div className="space-y-2.5 text-xs">
                <div className="text-slate-600">{selectedParking.address || "No address details."}</div>
                <div className="flex flex-col gap-2">
                  <Badge variant="secondary" className="w-full text-center py-1">Available: {selectedParking.availableSlots || 0} slots</Badge>
                  <Badge variant="warning" className="w-full text-center py-1">Reserved: {selectedParking.reservedSlots || 0} slots</Badge>
                  <Badge variant="destructive" className="w-full text-center py-1">Occupied: {selectedParking.occupiedSlots || 0} slots</Badge>
                </div>
              </div>
            ) : (
              <EmptyState icon="inbox" title="No lot loaded" description="Select a parking lot to see its counters." />
            )}
          </CardContent>
        </Card>

        {/* Pending QR entries approvals */}
        <Card className="animate-fade-in-up col-span-2 shadow-sm border-border/80">
          <CardHeader>
            <CardTitle>Pending QR Check-In Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {!pendingRequests.length ? (
              <EmptyState icon="users" title="No pending requests" description="QR check-in requests from drivers appear here." />
            ) : (
              <div className="space-y-2">
                {pendingRequests.map((request) => (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 flex justify-between items-center" key={request.id}>
                    <div>
                      <div className="font-bold text-sm text-slate-800">{displayEtPlate(request.plateNumber)}</div>
                      <div className="text-[10px] text-slate-500">Driver: {request.driverUid}</div>
                      <div className="text-[10px] text-slate-400">Requested: {new Date(getMs(request.createdAt)).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => onApproveRequest(request.id)} disabled={loadingAction === "approveCheckInRequest"} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs">
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onRejectRequest(request.id)} disabled={loadingAction === "rejectCheckInRequest"} className="border-slate-300 text-slate-600 text-xs">
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog for Confirming manual payments */}
      <Dialog
        open={Boolean(confirmPaymentTarget)}
        onClose={() => setConfirmPaymentTarget(null)}
        title="Verify Transfer Payment"
      >
        {!confirmPaymentTarget ? null : (
          <div className="space-y-4 pt-4 text-slate-800">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-bold text-slate-800">{displayEtPlate(confirmPaymentTarget.plateNumber) || "Unknown Plate"}</div>
              <div className="text-xs text-slate-600 mt-1">Amount Due: <span className="font-extrabold text-indigo-700">{confirmPaymentTarget.amountDue ?? 0} ETB</span></div>
              <div className="text-xs text-slate-500">Method: {confirmPaymentTarget.method}</div>
              <div className="text-xs text-slate-500">Reference: {confirmPaymentTarget.referenceCode || "None provided"}</div>
            </div>
            
            <p className="text-xs text-slate-500 italic">Please verify that the money has reached your lot statement or terminal before clicking confirm.</p>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmPaymentTarget(null)} className="border-slate-300">
                Cancel
              </Button>
              <Button
                onClick={() => onConfirmPayment(confirmPaymentTarget.id)}
                disabled={loadingAction === "confirmManualPayment"}
                className="bg-indigo-600 text-white font-bold"
              >
                {loadingAction === "confirmManualPayment" ? "Confirming..." : "Confirm & Unlock Gate"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Dialog for Direct operator checkout (Cash or Telebirr / CBE Birr) */}
      <Dialog
        open={isCheckoutDialogOpen}
        onClose={() => setIsCheckoutDialogOpen(false)}
        title="Process Checkout Invoice"
      >
        {searchResult && (
          <div className="space-y-4 pt-4 text-slate-800">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-bold text-slate-800">{displayEtPlate(searchResult.plateNumber)}</div>
              <div className="text-xs text-slate-500 mt-0.5">Spot: {searchResult.spotId || "Walk-In"}</div>
              <div className="text-[10px] text-slate-500">Entered Lot: {new Date(getMs(searchResult.entryTime)).toLocaleString()}</div>
            </div>

            <div className="space-y-2">
              <Label>Deduction Method</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "cash", label: "Cash", icon: CashIcon, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
                  { value: "telebirr", label: "Telebirr", icon: TelebirrIcon2, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
                  { value: "cbe_birr", label: "CBE Birr", icon: CbeBirrIcon2, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => setCheckoutPaymentMethod(opt.value)}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-all ${
                      opt.disabled ? "cursor-not-allowed opacity-40" : ""
                    } ${
                      checkoutPaymentMethod === opt.value
                        ? `${opt.bg} ${opt.color} ring-2 ring-offset-1 font-semibold`
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <opt.icon className="h-6 w-6 shrink-0" />
                    <span className="font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {(checkoutPaymentMethod === "telebirr" || checkoutPaymentMethod === "cbe_birr") && (
              <p className="text-xs text-slate-500">Driver will pay via {checkoutPaymentMethod === "telebirr" ? "Telebirr" : "CBE Birr"}. Confirm receipt before unlocking.</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsCheckoutDialogOpen(false)} disabled={loadingAction === "checkOutVehicle"} className="border-slate-300">
                Cancel
              </Button>
              <Button
                onClick={submitDirectCheckout}
                disabled={loadingAction === "checkOutVehicle"}
                className="bg-emerald-600 text-white font-bold hover:bg-emerald-700"
              >
                {loadingAction === "checkOutVehicle" ? "Processing Checkout..." : "Approve & Unlock Exit Gate"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Receipt Modal */}
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
                <span className="text-slate-500">Parking</span>
                <span className="font-semibold text-indigo-700">{receipt.parkingName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Plate Number</span>
                <span className="font-semibold">{receipt.plateNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method</span>
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

            {receipt.remainingBalance != null && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-center text-xs text-emerald-800">
                <span className="font-bold">🔐 Remaining Wallet Balance:</span> {receipt.remainingBalance.toFixed(2)} ETB
              </div>
            )}

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

      {/* Dialog for 2D Interactive Spot Operations */}
      <Dialog
        open={Boolean(selectedSpotDetails)}
        onClose={() => {
          setSelectedSpotDetails(null);
          setDialogPlateNumber("");
          setDialogReservationCode("");
        }}
        title={`Spot Operations - Spot ${selectedSpotDetails?.spotId}`}
      >
        {selectedSpotDetails && (
          <div className="space-y-4 pt-4 text-slate-800">
            {selectedSpotDetails.status === "available" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs">
                  <div className="text-indigo-800 font-bold uppercase tracking-wider mb-1">Spot is Available</div>
                  <p className="text-slate-600">You can process a manual walk-in or reservation check-in for this specific spot.</p>
                </div>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Vehicle Plate Number</Label>
                    <Input
                      value={dialogPlateNumber}
                      onChange={(e) => {
                        let raw = e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, "");
                        const parts = raw.replace(/\s+/g, " ").split(" ");
                        if (parts.length === 2) {
                          const letters = parts[0].slice(0, 2).replace(/[^A-Z]/g, "");
                          const digits = parts[1].replace(/\D/g, "").slice(0, 5);
                          let formatted = letters;
                          if (digits.length > 0) formatted += " " + digits;
                          if (digits.length > 3) formatted = letters + " " + digits.slice(0, 3) + "-" + digits.slice(3);
                          setDialogPlateNumber(formatted);
                        } else {
                          const cleaned = raw.replace(/[\s-]/g, "");
                          if (/^[A-Z]{0,2}$/.test(cleaned)) { setDialogPlateNumber(cleaned); }
                          else if (/^[A-Z]{2}\d{0,5}$/.test(cleaned)) {
                            const l = cleaned.slice(0, 2);
                            const d = cleaned.slice(2);
                            let f = l + " " + d;
                            if (d.length > 3) f = l + " " + d.slice(0, 3) + "-" + d.slice(3);
                            setDialogPlateNumber(f);
                          } else { setDialogPlateNumber(raw); }
                        }
                      }} onBlur={() => { if (dialogPlateNumber.length > 2) setDialogPlateNumber(formatEtPlate(dialogPlateNumber)); }}
                      placeholder="AA 12345"
                      className="border-slate-300 focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Reservation Code (Optional)</Label>
                    <Input
                      value={dialogReservationCode}
                      onChange={(e) => setDialogReservationCode(e.target.value.toUpperCase())}
                      placeholder="RES-ABC12"
                      className="border-slate-300 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedSpotDetails(null);
                      setDialogPlateNumber("");
                      setDialogReservationCode("");
                    }}
                    className="border-slate-300"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!dialogPlateNumber.trim()) {
                        toast.error("Please enter a plate number.");
                        return;
                      }
                      setLoadingAction("checkInVehicle");
                      try {
                        const res = await callAction("checkInVehicle", {
                          parkingId: selectedParkingId,
                          plateNumber: dialogPlateNumber.trim(),
                          reservationCode: dialogReservationCode.trim(),
                          allowWalkIn: true
                        });
                        if (res?.sessionId) {
                          triggerGateFlash(`Check-In Successful! Spot: ${selectedSpotDetails.spotId}. Entrance Gate Unlocked.`);
                          setSelectedSpotDetails(null);
                          setDialogPlateNumber("");
                          setDialogReservationCode("");
                        }
                      } catch (err) {
                        toast.error(err.message || "Failed to check in.");
                      } finally {
                        setLoadingAction("");
                      }
                    }}
                    disabled={loadingAction === "checkInVehicle"}
                    className="bg-indigo-600 text-white font-bold"
                  >
                    {loadingAction === "checkInVehicle" ? "Checking in..." : "Confirm Gate Entry"}
                  </Button>
                </div>
              </div>
            )}

            {selectedSpotDetails.status === "reserved" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs space-y-2">
                  <div className="text-amber-800 font-bold uppercase tracking-widest text-[10px]">Active Reservation</div>
                  <div className="grid grid-cols-2 gap-2 text-slate-700">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-medium">Plate Number</span>
                      <div className="font-bold text-sm text-slate-900">{displayEtPlate(selectedSpotDetails.details?.plate)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-medium">Hold Code</span>
                      <div className="font-mono font-bold text-sm text-slate-900">{selectedSpotDetails.details?.code}</div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedSpotDetails(null)}
                    className="border-slate-300"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={async () => {
                      setLoadingAction("checkInVehicle");
                      try {
                        const res = await callAction("checkInVehicle", {
                          parkingId: selectedParkingId,
                          plateNumber: selectedSpotDetails.details.plate,
                          reservationCode: selectedSpotDetails.details.code,
                          allowWalkIn: false
                        });
                        if (res?.sessionId) {
                          triggerGateFlash(`Check-In Approved! Spot: ${selectedSpotDetails.spotId}. Entrance Gate Unlocked.`);
                          setSelectedSpotDetails(null);
                        }
                      } catch (err) {
                        toast.error(err.message || "Failed to check in reserved vehicle.");
                      } finally {
                        setLoadingAction("");
                      }
                    }}
                    disabled={loadingAction === "checkInVehicle"}
                    className="bg-indigo-600 text-white font-bold"
                  >
                    {loadingAction === "checkInVehicle" ? "Checking in..." : "⚡ Quick Check-in Driver"}
                  </Button>
                </div>
              </div>
            )}

            {selectedSpotDetails.status === "occupied" && (() => {
              const entryMs = getMs(selectedSpotDetails.details?.entryTime);
              const durationHrs = Math.max(0.1, (Date.now() - entryMs) / (1000 * 60 * 60));
              const hourlyRate = selectedParking?.hourlyRate || 50;
              const estimatedFee = durationHrs * hourlyRate;
              
              return (
                <div className="space-y-4">
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs space-y-3">
                    <div className="text-rose-800 font-bold uppercase tracking-widest text-[10px]">Spot Occupied</div>
                    
                    <div className="grid grid-cols-2 gap-2 text-slate-700">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-medium">Plate Number</span>
                      <div className="font-bold text-sm text-slate-900">{displayEtPlate(selectedSpotDetails.details?.plate)}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-medium">Parked Duration</span>
                        <div className="font-bold text-sm text-slate-900">{durationHrs.toFixed(2)} hrs</div>
                      </div>
                      <div className="col-span-2 border-t border-rose-200 pt-2">
                        <span className="text-[10px] text-slate-500 uppercase font-medium">Accumulated Fee</span>
                        <div className="font-black text-lg text-emerald-600">{estimatedFee.toFixed(2)} ETB</div>
                        <span className="text-[9px] text-slate-400 italic">Rate: {hourlyRate}.00 ETB/hour</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[10px] text-slate-500 uppercase font-medium">Entry Timestamp</span>
                        <div className="text-xs text-slate-800">{new Date(entryMs).toLocaleString()}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedSpotDetails(null)}
                      className="border-slate-300"
                    >
                      Close
                    </Button>
                    <Button
                      onClick={() => {
                        const spotSession = activeSessions.find(
                          (s) => s.spotId === selectedSpotDetails.spotId
                        );
                        if (spotSession) {
                          openDirectCheckoutDialog(spotSession);
                        } else {
                          // Fallback to in-memory details
                          openDirectCheckoutDialog({
                            plateNumber: selectedSpotDetails.details.plate,
                            spotId: selectedSpotDetails.spotId,
                            entryTime: selectedSpotDetails.details.entryTime,
                            driverId: selectedSpotDetails.details.driverId || null
                          });
                        }
                        setSelectedSpotDetails(null);
                      }}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
                    >
                      ⚡ Process Direct Checkout
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Dialog>

      {/* QR Scanner Dialog */}
      {scannerOpen && (
        <Dialog open={scannerOpen} onClose={() => { stopScanner(); setScannerOpen(false); }} title="Scan Driver QR Code">
          <div className="space-y-4">
            <p className="text-sm text-slate-500 text-center">Point the camera at the driver's reservation QR code</p>
            <div id="qr-reader" className="w-full max-w-sm mx-auto rounded-lg overflow-hidden border border-slate-200 bg-slate-50" style={{ minHeight: 280 }} />
            {scanning && <p className="text-xs text-center text-emerald-600 animate-pulse">Scanning...</p>}
            <Button variant="outline" onClick={() => { stopScanner(); setScannerOpen(false); }} className="w-full border-slate-300">Cancel</Button>
          </div>
        </Dialog>
      )}
    </div>
  );

}

function getMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function handleRealtimeError(err, fallbackMessage) {
  const code = err?.code || "";
  if (code === "permission-denied") {
    return;
  }
  toast.error(err?.message || fallbackMessage);
}

export default OperatorHome;
