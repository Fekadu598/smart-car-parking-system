import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, Home, QrCode, XCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { firestore } from "../firebase";
import callApi from "../lib/callApi";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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

function DriverCheckInConfirm() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const token = params.get("token") || "";
  const plateParam = params.get("plate") || "";
  const codeParam = params.get("code") || "";

  const [plateNumber, setPlateNumber] = useState(plateParam);
  const [requestId, setRequestId] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [requestPayload, setRequestPayload] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!requestId) return undefined;
    const unsub = firestore.collection("checkInRequests").doc(requestId).onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const payload = snap.data();
        setRequestPayload(payload);
        setRequestStatus(payload.status || "");
      },
      (err) => toast.error(err.message || "Failed to read check-in request status.")
    );
    return () => unsub();
  }, [requestId]);

  const confirmCheckIn = async (event) => {
    event.preventDefault();

    if (!token && !codeParam) {
      toast.error("Missing QR link or reservation code. Please scan the operator's QR or use 'Check In Now' from your reservation.");
      return;
    }
    if (!plateNumber.trim()) {
      toast.error("Please enter your plate number.");
      return;
    }

    setLoading(true);
    try {
      const response = await callApi("confirmCheckInFromQr", { token: token || codeParam, plateNumber });
      setRequestId(response.data.requestId);
      setRequestStatus(response.data.status);
      toast.success("Check-in request sent. Please wait for operator approval.");
    } catch (err) {
      toast.error(err.message || "Failed to confirm check-in.");
    } finally {
      setLoading(false);
    }
  };

  const renderStatus = () => {
    if (!requestStatus) return null;
    if (requestStatus === "pending") {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 text-amber-500" />
          <p className="font-semibold text-amber-800">Waiting for operator approval</p>
          <p className="mt-1 text-xs text-amber-600">This page updates automatically once the operator responds.</p>
        </div>
      );
    }
    if (requestStatus === "approved") {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
            <CheckCircle className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
            <p className="font-semibold text-emerald-800">Approved! Your parking session has started.</p>
          </div>
          <Button className="w-full" onClick={() => navigate("/driver/home")}>
            <Home className="mr-2 h-4 w-4" />
            Go to Driver Home
          </Button>
        </div>
      );
    }
    if (requestStatus === "rejected") {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <XCircle className="mx-auto mb-2 h-8 w-8 text-red-500" />
          <p className="font-semibold text-red-800">Request rejected</p>
          <p className="mt-1 text-xs text-red-600">Please re-scan a fresh QR code from the operator.</p>
        </div>
      );
    }
    if (requestStatus === "expired") {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <QrCode className="mx-auto mb-2 h-8 w-8 text-amber-500" />
          <p className="font-semibold text-amber-800">QR token expired</p>
          <p className="mt-1 text-xs text-amber-600">Ask the operator to refresh the QR code and scan again.</p>
        </div>
      );
    }
    return <Badge variant="secondary">Status: {requestStatus}</Badge>;
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-4">
      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Confirm Parking Check-In</CardTitle>
          <CardDescription>{codeParam ? "Your reservation is ready — confirm your plate to request check-in." : "Scan operator QR, confirm your plate, then wait for operator approval."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && !codeParam ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              Missing QR token. Please scan again.
            </div>
          ) : null}

          {codeParam && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700">
              <span className="font-semibold">Reservation:</span> <span className="font-mono">{codeParam}</span>
            </div>
          )}

          {!requestId && (
            <form onSubmit={confirmCheckIn} className="space-y-3">
              <div className="space-y-2">
                <Label>Plate Number</Label>
                <Input
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  onBlur={(e) => { const f = formatEtPlate(e.target.value); if (f) setPlateNumber(f); }}
                  placeholder="AA 345-78"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || (!token && !codeParam)}>
                {loading ? "Confirming..." : "Request Check-In"}
              </Button>
            </form>
          )}

          {requestPayload && (
            <div className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
              Parking: {requestPayload.parkingId} | Request: {requestId}
            </div>
          )}
          {renderStatus()}
        </CardContent>
      </Card>
    </div>
  );
}

export default DriverCheckInConfirm;
