import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Dialog } from "../components/ui/dialog";
import { SkeletonCard } from "../components/ui/skeleton";
import {
  useAdminArchiveOwner,
  useAdminAnalytics,
  useAdminOperators,
  useAdminOwners,
  useAdminParkings,
  useAdminRestoreOwner,
  useAssignOperatorToParking,
  useCreateOwnerAccount,
  useUpsertParking,
} from "../lib/serverState/dashboardHooks";
import { dashboardFormatters } from "../lib/serverState/dashboardApi";

function AdminHome() {
  const [rangePreset, setRangePreset] = useState("30d");

  const analyticsQuery = useAdminAnalytics(rangePreset);
  const ownersQuery = useAdminOwners();
  const parkingsQuery = useAdminParkings();
  const operatorsQuery = useAdminOperators();

  const createOwnerMutation = useCreateOwnerAccount();
  const upsertParkingMutation = useUpsertParking();
  const assignMutation = useAssignOperatorToParking();
  const archiveOwnerMutation = useAdminArchiveOwner();
  const restoreOwnerMutation = useAdminRestoreOwner();

  const owners = useMemo(() => ownersQuery.data || [], [ownersQuery.data]);
  const parkings = useMemo(() => parkingsQuery.data || [], [parkingsQuery.data]);
  const operators = useMemo(() => operatorsQuery.data || [], [operatorsQuery.data]);
  const analytics = analyticsQuery.data;

  const [ownerForm, setOwnerForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    bankAccountNumber: "",
  });

  const [parkingForm, setParkingForm] = useState({
    parkingId: "",
    ownerId: "",
    name: "",
    address: "",
    status: "active",
    slotCapacity: 20,
    availableSlots: 20,
    reservedSlots: 0,
    occupiedSlots: 0,
    hourlyRate: 50,
    lat: "",
    lng: "",
  });

  const [assignmentForm, setAssignmentForm] = useState({
    operatorUid: "",
    parkingId: "",
    assign: true,
  });
  const [ownerLifecycleDialog, setOwnerLifecycleDialog] = useState({ open: false, mode: "archive", owner: null });
  const [archiveReason, setArchiveReason] = useState("");
  const [lifecycleNotice, setLifecycleNotice] = useState({ type: "", message: "" });

  useEffect(() => {
    if (!parkingForm.ownerId && owners.length) {
      setParkingForm((prev) => ({ ...prev, ownerId: owners[0].ownerId || owners[0].id }));
    }
  }, [owners, parkingForm.ownerId]);

  const submitOwner = async (event) => {
    event.preventDefault();
    try {
      const data = await createOwnerMutation.mutateAsync(ownerForm);
      toast.success(`Owner created: ${data.email}`);
      setOwnerForm({ fullName: "", email: "", password: "", phone: "", bankAccountNumber: "" });
      setParkingForm((prev) => ({ ...prev, ownerId: data.ownerId }));
    } catch (error) {
      toast.error(error.message || "Failed to create owner account.");
    }
  };

  const submitParking = async (event) => {
    event.preventDefault();
    const lat = Number(parkingForm.lat);
    const lng = Number(parkingForm.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error("Latitude and longitude are required.");
      return;
    }
    if (lat < -90 || lat > 90) {
      toast.error("Latitude must be between -90 and 90.");
      return;
    }
    if (lng < -180 || lng > 180) {
      toast.error("Longitude must be between -180 and 180.");
      return;
    }

    try {
      const data = await upsertParkingMutation.mutateAsync({
        ...parkingForm,
        lat,
        lng,
      });
      toast.success(`Parking saved: ${data.parkingId}`);
      setParkingForm((prev) => ({ ...prev, parkingId: data.parkingId }));
    } catch (error) {
      toast.error(error.message || "Failed to save parking.");
    }
  };

  const submitAssignment = async (event) => {
    event.preventDefault();
    try {
      await assignMutation.mutateAsync(assignmentForm);
      toast.success("Operator assignment updated.");
    } catch (error) {
      toast.error(error.message || "Failed to update assignment.");
    }
  };

  const openOwnerLifecycleDialog = (mode, owner) => {
    setLifecycleNotice({ type: "", message: "" });
    setArchiveReason("");
    setOwnerLifecycleDialog({ open: true, mode, owner });
  };

  const closeOwnerLifecycleDialog = () => {
    if (archiveOwnerMutation.isPending || restoreOwnerMutation.isPending) return;
    setOwnerLifecycleDialog({ open: false, mode: "archive", owner: null });
    setArchiveReason("");
  };

  const executeOwnerLifecycle = async () => {
    const owner = ownerLifecycleDialog.owner;
    if (!owner) return;

    try {
      if (ownerLifecycleDialog.mode === "archive") {
        const response = await archiveOwnerMutation.mutateAsync({
          ownerId: owner.ownerId || owner.id,
          reason: archiveReason.trim() || undefined,
        });
        setLifecycleNotice({
          type: "success",
          message: `Owner deactivated. Parkings affected: ${response.parkingsAffected || 0}, operators affected: ${response.operatorsAffected || 0}.`,
        });
        toast.success("Owner deactivated.");
      } else {
        const response = await restoreOwnerMutation.mutateAsync({ ownerId: owner.ownerId || owner.id });
        setLifecycleNotice({
          type: "success",
          message: `Owner reactivated. Parkings restored: ${response.restoredParkings || 0}, operators restored: ${response.restoredOperators || 0}.`,
        });
        toast.success("Owner reactivated.");
      }
      setOwnerLifecycleDialog({ open: false, mode: "archive", owner: null });
      setArchiveReason("");
    } catch (error) {
      const message = error?.message || "Owner lifecycle action failed.";
      setLifecycleNotice({ type: "error", message });
      toast.error(message);
    }
  };

  const topOwnerColumns = useMemo(
    () => [
      { header: "Owner", accessorKey: "ownerName" },
      {
        header: "Gross",
        accessorKey: "grossAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.grossAmount || 0),
      },
      {
        header: "Admin 10%",
        accessorKey: "adminCommission",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.adminCommission || 0),
      },
      {
        header: "Payments",
        accessorKey: "paymentsCount",
      },
    ],
    []
  );

  const topParkingColumns = useMemo(
    () => [
      { header: "Parking", accessorKey: "parkingName" },
      {
        header: "Gross",
        accessorKey: "grossAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.grossAmount || 0),
      },
      {
        header: "Admin 10%",
        accessorKey: "adminCommission",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.adminCommission || 0),
      },
      {
        header: "Payments",
        accessorKey: "paymentsCount",
      },
    ],
    []
  );

  const paymentsColumns = useMemo(
    () => [
      { header: "Parking", accessorKey: "parkingName" },
      { header: "Owner", accessorKey: "ownerName" },
      {
        header: "Gross",
        accessorKey: "grossAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.grossAmount || 0),
      },
      {
        header: "Admin 10%",
        accessorKey: "adminCommission",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.adminCommission || 0),
      },
      {
        header: "Paid At",
        accessorKey: "paidAtMs",
        cell: ({ row }) => dashboardFormatters.dateTime.format(new Date(row.original.paidAtMs || 0)),
      },
    ],
    []
  );

  const summary = analytics?.summary;
  const lifecycleOwnerId = ownerLifecycleDialog.owner?.ownerId || ownerLifecycleDialog.owner?.id || "";
  const lifecycleParkings = parkings.filter((parking) => String(parking.ownerId || "") === lifecycleOwnerId);
  const lifecycleOperators = operators.filter((operator) => String(operator.ownerId || "") === lifecycleOwnerId);

  return (
    <div className="space-y-6">
      <Card className="border-0 bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-white">Admin Management</CardTitle>
          <CardDescription className="text-white/80">Dashboard analytics, owner lifecycle, and parking operations.</CardDescription>
        </CardHeader>
      </Card>

      {lifecycleNotice.message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            lifecycleNotice.type === "error"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-emerald-300 bg-emerald-50 text-emerald-700"
          }`}
        >
          {lifecycleNotice.message}
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Analytics
              <Badge variant="success" dot pulse>Live</Badge>
            </CardTitle>
            <CardDescription>Revenue and commission breakdown across all parking points.</CardDescription>
          </div>
          <Select value={rangePreset} onChange={(e) => setRangePreset(e.target.value)}>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </Select>
        </CardHeader>
        <CardContent className="space-y-6">
          {analyticsQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : null}
          {analyticsQuery.error ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{analyticsQuery.error.message}</div>
          ) : null}

          {summary ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard title="Gross Revenue" value={dashboardFormatters.currency.format(summary.totalGrossRevenue)} accent="blue" />
                <StatCard title="Admin 10%" value={dashboardFormatters.currency.format(summary.totalAdminCommission)} accent="amber" />
                <StatCard title="Owner Share" value={dashboardFormatters.currency.format(summary.totalOwnerRevenue)} accent="green" />
                <StatCard title="Pending Requests" value={dashboardFormatters.number.format(summary.pendingPaymentRequests)} accent="rose" />
                <StatCard title="Confirmed Payments" value={dashboardFormatters.number.format(summary.totalConfirmedPayments)} accent="purple" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Revenue Trend (Gross / Owner / Admin)">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={analytics.revenueSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => dashboardFormatters.currency.format(value)} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
                      <Legend />
                      <Line type="monotone" dataKey="grossAmount" stroke="#2563eb" strokeWidth={2} name="Gross" dot={false} />
                      <Line type="monotone" dataKey="ownerAmount" stroke="#16a34a" strokeWidth={2} name="Owner" dot={false} />
                      <Line type="monotone" dataKey="adminCommission" stroke="#f59e0b" strokeWidth={2} name="Admin 10%" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Payment Method Breakdown">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={analytics.paymentMethodBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="method" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => dashboardFormatters.currency.format(value)} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
                      <Legend />
                      <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} name="Amount" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <ChartCard title="Composition (Owner vs Admin)">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={analytics.revenueSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => dashboardFormatters.currency.format(value)} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
                    <Legend />
                    <Area type="monotone" dataKey="ownerAmount" stackId="1" stroke="#16a34a" fill="#16a34a" fillOpacity={0.3} name="Owner" />
                    <Area type="monotone" dataKey="adminCommission" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} name="Admin 10%" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <DataTableCard title="Top Owners" columns={topOwnerColumns} data={analytics.topOwners} emptyLabel="No owner revenue in range." />
                <DataTableCard title="Payments Drill-Down" columns={paymentsColumns} data={analytics.paymentsTable} emptyLabel="No payments in range." />
              </div>

              <DataTableCard title="All Parking Points" columns={topParkingColumns} data={analytics.topParkings} emptyLabel="No parking revenue in range." />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle>Owner Lifecycle Controls</CardTitle>
          <CardDescription>Deactivate blocks owner access, inactivates owned parkings, and deactivates assigned operators while preserving historical revenue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!owners.length ? (
            <EmptyState icon="users" title="No owners found" description="Create an owner account to get started." />
          ) : (
            owners.map((owner) => {
              const ownerId = owner.ownerId || owner.id;
              const archived = String(owner.status || "").toLowerCase() === "archived";
              return (
                <div key={owner.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <div className="font-medium">{owner.fullName || owner.email || ownerId}</div>
                    <div className="text-xs text-muted-foreground">
                      {owner.email || "no-email"} | Status: {owner.status || "active"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {archived ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openOwnerLifecycleDialog("restore", owner)}
                        disabled={archiveOwnerMutation.isPending || restoreOwnerMutation.isPending}
                      >
                        Reactivate Owner
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openOwnerLifecycleDialog("archive", owner)}
                        disabled={archiveOwnerMutation.isPending || restoreOwnerMutation.isPending}
                      >
                        Deactivate Owner
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Create Owner Account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitOwner} className="space-y-3">
              <Field label="Full Name"><Input value={ownerForm.fullName} onChange={(e) => setOwnerForm({ ...ownerForm, fullName: e.target.value })} required /></Field>
              <Field label="Email"><Input type="email" value={ownerForm.email} onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })} required /></Field>
              <Field label="Temporary Password"><Input type="password" value={ownerForm.password} onChange={(e) => setOwnerForm({ ...ownerForm, password: e.target.value })} required /></Field>
              <Field label="Phone"><Input value={ownerForm.phone} onChange={(e) => setOwnerForm({ ...ownerForm, phone: e.target.value })} /></Field>
              <Field label="Bank Account"><Input value={ownerForm.bankAccountNumber} onChange={(e) => setOwnerForm({ ...ownerForm, bankAccountNumber: e.target.value })} /></Field>
              <Button className="w-full" disabled={createOwnerMutation.isPending}>{createOwnerMutation.isPending ? "Creating..." : "Create Owner"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create / Update Parking</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitParking} className="space-y-3">
              <Field label="Parking ID (optional)"><Input value={parkingForm.parkingId} onChange={(e) => setParkingForm({ ...parkingForm, parkingId: e.target.value })} /></Field>
              <Field label="Owner">
                <Select value={parkingForm.ownerId} onChange={(e) => setParkingForm({ ...parkingForm, ownerId: e.target.value })} required>
                  <option value="">Choose owner...</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.ownerId || owner.id}>{owner.fullName || owner.ownerId} ({owner.email || "no-email"})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Parking Name"><Input value={parkingForm.name} onChange={(e) => setParkingForm({ ...parkingForm, name: e.target.value })} required /></Field>
              <Field label="Address"><Input placeholder="Human-readable address (e.g. Bole, Addis Ababa)" value={parkingForm.address} onChange={(e) => setParkingForm({ ...parkingForm, address: e.target.value })} required /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Latitude">
                  <Input
                    type="number"
                    step="any"
                    placeholder="e.g. 9.025"
                    value={parkingForm.lat}
                    onChange={(e) => setParkingForm({ ...parkingForm, lat: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Longitude">
                  <Input
                    type="number"
                    step="any"
                    placeholder="e.g. 38.7469"
                    value={parkingForm.lng}
                    onChange={(e) => setParkingForm({ ...parkingForm, lng: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Capacity"><Input type="number" value={parkingForm.slotCapacity} onChange={(e) => setParkingForm({ ...parkingForm, slotCapacity: Number(e.target.value || 0) })} /></Field>
                <Field label="Available"><Input type="number" value={parkingForm.availableSlots} onChange={(e) => setParkingForm({ ...parkingForm, availableSlots: Number(e.target.value || 0) })} /></Field>
                <Field label="Reserved"><Input type="number" value={parkingForm.reservedSlots} onChange={(e) => setParkingForm({ ...parkingForm, reservedSlots: Number(e.target.value || 0) })} /></Field>
                <Field label="Occupied"><Input type="number" value={parkingForm.occupiedSlots} onChange={(e) => setParkingForm({ ...parkingForm, occupiedSlots: Number(e.target.value || 0) })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Hourly Rate"><Input type="number" value={parkingForm.hourlyRate} onChange={(e) => setParkingForm({ ...parkingForm, hourlyRate: Number(e.target.value || 0) })} /></Field>
                <Field label="Status">
                  <Select value={parkingForm.status} onChange={(e) => setParkingForm({ ...parkingForm, status: e.target.value })}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </Select>
                </Field>
              </div>
              <Button className="w-full" disabled={upsertParkingMutation.isPending}>{upsertParkingMutation.isPending ? "Saving..." : "Save Parking"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign Operator</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitAssignment} className="space-y-3">
              <Field label="Operator">
                <Select value={assignmentForm.operatorUid} onChange={(e) => setAssignmentForm({ ...assignmentForm, operatorUid: e.target.value })} required>
                  <option value="">Choose operator...</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>{operator.email || operator.fullName || operator.id}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Parking">
                <Select value={assignmentForm.parkingId} onChange={(e) => setAssignmentForm({ ...assignmentForm, parkingId: e.target.value })} required>
                  <option value="">Choose parking...</option>
                  {parkings.map((parking) => (
                    <option key={parking.id} value={parking.id}>{parking.name || parking.id}</option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={assignmentForm.assign} onChange={(e) => setAssignmentForm({ ...assignmentForm, assign: e.target.checked })} className="h-4 w-4 rounded border-border" />
                Assign (uncheck to remove)
              </label>
              <Button className="w-full" disabled={assignMutation.isPending}>{assignMutation.isPending ? "Saving..." : "Save Assignment"}</Button>
            </form>

            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Current Operators</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {operators.map((operator) => (
                  <div key={operator.id} className="rounded-md bg-muted px-2 py-1">
                    <span className="font-medium">{operator.email || operator.id}</span>: {(operator.assignedParkingIds || []).join(", ") || "none"}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={ownerLifecycleDialog.open}
        onClose={closeOwnerLifecycleDialog}
        title={ownerLifecycleDialog.mode === "archive" ? "Deactivate Owner" : "Reactivate Owner"}
      >
        {!ownerLifecycleDialog.owner ? null : (
          <div className="space-y-4 text-sm">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="font-medium">{ownerLifecycleDialog.owner.fullName || ownerLifecycleDialog.owner.email || lifecycleOwnerId}</div>
              <div className="text-xs text-muted-foreground">Owner ID: {lifecycleOwnerId}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Parkings affected: {lifecycleParkings.length} | Operators affected: {lifecycleOperators.length}
              </div>
            </div>

            {ownerLifecycleDialog.mode === "archive" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Deactivation is blocked when this owner has active sessions or unexpired reserved bookings.
                </p>
                <Field label="Reason (optional)">
                  <Input value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="Compliance hold, account closure, etc." />
                </Field>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reactivate will restore parkings/operators from the last deactivate snapshot.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeOwnerLifecycleDialog} disabled={archiveOwnerMutation.isPending || restoreOwnerMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant={ownerLifecycleDialog.mode === "archive" ? "destructive" : "secondary"}
                onClick={executeOwnerLifecycle}
                disabled={archiveOwnerMutation.isPending || restoreOwnerMutation.isPending}
              >
                {ownerLifecycleDialog.mode === "archive"
                  ? archiveOwnerMutation.isPending
                    ? "Deactivating..."
                    : "Confirm Deactivate"
                  : restoreOwnerMutation.isPending
                  ? "Reactivating..."
                  : "Confirm Reactivate"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatCard({ title, value, accent = "blue" }) {
  const accentStyles = {
    blue: "border-l-4 border-l-blue-500",
    green: "border-l-4 border-l-emerald-500",
    amber: "border-l-4 border-l-amber-500",
    rose: "border-l-4 border-l-rose-500",
    purple: "border-l-4 border-l-purple-500",
  };
  const badgeVariants = {
    blue: "default",
    green: "success",
    amber: "warning",
    rose: "destructive",
    purple: "premium",
  };
  return (
    <Card className={accentStyles[accent] || accentStyles.blue}>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="font-heading text-2xl font-bold text-slate-900">{value}</span>
          <Badge variant={badgeVariants[accent] || "secondary"} dot>{accent === "blue" ? "Revenue" : accent === "green" ? "Net" : accent === "amber" ? "Fee" : accent === "rose" ? "Open" : "Done"}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
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
                      <td key={cell.id} className="whitespace-nowrap px-3 py-2.5 text-sm">
                        {flexRender(cell.column.columnDef.cell ?? cell.column.columnDef.accessorKey, cell.getContext())}
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

export default AdminHome;
