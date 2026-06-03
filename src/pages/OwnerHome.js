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
import { SkeletonCard } from "../components/ui/skeleton";
import {
  useCreateOwnerOperator,
  useOwnerAnalytics,
  useSetOwnerOperatorStatus,
  useUpdateOwnerOperatorAssignments,
  useUpdateOwnerPaymentDetails,
} from "../lib/serverState/dashboardHooks";
import { dashboardFormatters } from "../lib/serverState/dashboardApi";

function OwnerHome() {
  const [rangePreset, setRangePreset] = useState("30d");
  const analyticsQuery = useOwnerAnalytics(rangePreset);

  const updatePaymentMutation = useUpdateOwnerPaymentDetails();
  const createOperatorMutation = useCreateOwnerOperator();
  const updateAssignmentsMutation = useUpdateOwnerOperatorAssignments();
  const setStatusMutation = useSetOwnerOperatorStatus();

  const analytics = analyticsQuery.data;
  const summary = analytics?.summary;
  const ownerAccount = analytics?.ownerAccount || { phone: "", bankAccountNumber: "" };
  const operators = useMemo(() => analytics?.operators || [], [analytics?.operators]);
  const parkings = useMemo(() => analytics?.parkings || [], [analytics?.parkings]);

  const [paymentForm, setPaymentForm] = useState({ phone: "", bankAccountNumber: "" });
  const [operatorForm, setOperatorForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    assignedParkingIds: [],
  });
  const [operatorAssignmentsDraft, setOperatorAssignmentsDraft] = useState({});

  useEffect(() => {
    setPaymentForm({
      phone: ownerAccount.phone || "",
      bankAccountNumber: ownerAccount.bankAccountNumber || "",
    });
  }, [ownerAccount.bankAccountNumber, ownerAccount.phone]);

  useEffect(() => {
    setOperatorAssignmentsDraft((prev) => {
      const next = { ...prev };
      operators.forEach((operator) => {
        if (!next[operator.id]) {
          next[operator.id] = Array.isArray(operator.assignedParkingIds) ? operator.assignedParkingIds : [];
        }
      });
      Object.keys(next).forEach((operatorId) => {
        if (!operators.some((operator) => operator.id === operatorId)) {
          delete next[operatorId];
        }
      });
      return next;
    });
  }, [operators]);

  const handleCreateOperator = async (event) => {
    event.preventDefault();
    try {
      const response = await createOperatorMutation.mutateAsync(operatorForm);
      toast.success(`Operator created: ${response.operatorUid}`);
      setOperatorForm({
        fullName: "",
        email: "",
        password: "",
        phone: "",
        assignedParkingIds: [],
      });
    } catch (error) {
      toast.error(error.message || "Failed to create operator.");
    }
  };

  const handleSavePaymentDetails = async (event) => {
    event.preventDefault();
    try {
      await updatePaymentMutation.mutateAsync(paymentForm);
      toast.success("Payment destination details updated.");
    } catch (error) {
      toast.error(error.message || "Failed to update payment details.");
    }
  };

  const toggleParkingAssignment = (parkingId) => {
    setOperatorForm((prev) => {
      const selected = prev.assignedParkingIds.includes(parkingId);
      return {
        ...prev,
        assignedParkingIds: selected
          ? prev.assignedParkingIds.filter((id) => id !== parkingId)
          : [...prev.assignedParkingIds, parkingId],
      };
    });
  };

  const toggleOperatorParkingDraft = (operatorUid, parkingId) => {
    setOperatorAssignmentsDraft((prev) => {
      const current = prev[operatorUid] || [];
      const selected = current.includes(parkingId);
      return {
        ...prev,
        [operatorUid]: selected ? current.filter((id) => id !== parkingId) : [...current, parkingId],
      };
    });
  };

  const handleSaveOperatorAssignments = async (operatorUid) => {
    try {
      await updateAssignmentsMutation.mutateAsync({
        operatorUid,
        assignedParkingIds: operatorAssignmentsDraft[operatorUid] || [],
      });
      toast.success("Operator assignments updated.");
    } catch (error) {
      toast.error(error.message || "Failed to update assignments.");
    }
  };

  const handleToggleOperatorStatus = async (operatorUid, status) => {
    try {
      await setStatusMutation.mutateAsync({ operatorUid, status });
      toast.success(`Operator set to ${status}.`);
    } catch (error) {
      toast.error(error.message || "Failed to update status.");
    }
  };

  const parkingColumns = useMemo(
    () => [
      { header: "Parking", accessorKey: "parkingName" },
      { header: "Sessions", accessorKey: "sessionsCount" },
      {
        header: "Gross",
        accessorKey: "grossAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.grossAmount || 0),
      },
      {
        header: "VAT (15%)",
        accessorKey: "tax",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.tax || 0),
      },
      {
        header: "Admin 10%",
        accessorKey: "adminCommission",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.adminCommission || 0),
      },
      {
        header: "Owner (net)",
        accessorKey: "ownerAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.ownerAmount || 0),
      },
    ],
    []
  );

  const paymentsColumns = useMemo(
    () => [
      { header: "Parking", accessorKey: "parkingName" },
      {
        header: "Gross (incl. VAT)",
        accessorKey: "grossAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.grossAmount || 0),
      },
      {
        header: "VAT (15%)",
        accessorKey: "tax",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.tax || 0),
      },
      {
        header: "Owner (net)",
        accessorKey: "ownerAmount",
        cell: ({ row }) => dashboardFormatters.currency.format(row.original.ownerAmount || 0),
      },
      {
        header: "Paid At",
        accessorKey: "paidAtMs",
        cell: ({ row }) => dashboardFormatters.dateTime.format(new Date(row.original.paidAtMs || 0)),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Owner Operations</CardTitle>
          <CardDescription>Analytics and operator management powered by TanStack Query and callable aggregations.</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Analytics</CardTitle>
            <CardDescription>Revenue trends, payment mix, and parking performance in real-time windows.</CardDescription>
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                <StatCard title="Owner Revenue" value={dashboardFormatters.currency.format(summary.totalOwnerRevenue)} />
                <StatCard title="Gross Revenue" value={dashboardFormatters.currency.format(summary.totalGrossRevenue)} />
                <StatCard title="Tax (VAT 15%)" value={dashboardFormatters.currency.format(summary.totalTax)} />
                <StatCard title="Admin 10%" value={dashboardFormatters.currency.format(summary.totalAdminCommission)} />
                <StatCard title="Completed Sessions" value={dashboardFormatters.number.format(summary.totalCompletedSessions)} />
                <StatCard title="Pending Payment Requests" value={dashboardFormatters.number.format(summary.pendingPaymentRequests)} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Revenue Trend (Gross / VAT / Admin / Owner)">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={analytics.revenueSeries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value) => dashboardFormatters.currency.format(value)} />
                      <Legend />
                      <Line type="monotone" dataKey="grossAmount" stroke="#2563eb" strokeWidth={2} name="Gross" />
                      <Line type="monotone" dataKey="tax" stroke="#dc2626" strokeWidth={2} name="VAT (15%)" />
                      <Line type="monotone" dataKey="adminCommission" stroke="#f59e0b" strokeWidth={2} name="Admin 10%" />
                      <Line type="monotone" dataKey="ownerAmount" stroke="#16a34a" strokeWidth={2} name="Owner (net)" />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Payment Method Breakdown">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={analytics.paymentMethodBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="method" />
                      <YAxis />
                      <Tooltip formatter={(value) => dashboardFormatters.currency.format(value)} />
                      <Legend />
                      <Bar dataKey="amount" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <ChartCard title="Revenue Composition Breakdown">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={analytics.revenueSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value) => dashboardFormatters.currency.format(value)} />
                    <Legend />
                    <Area type="monotone" dataKey="tax" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.3} name="VAT (15%)" />
                    <Area type="monotone" dataKey="adminCommission" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} name="Admin 10%" />
                    <Area type="monotone" dataKey="ownerAmount" stackId="1" stroke="#16a34a" fill="#16a34a" fillOpacity={0.3} name="Owner (net)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <DataTableCard title="Parking Performance" columns={parkingColumns} data={analytics.parkingsTable || []} emptyLabel="No parking revenue data in selected range." />
                <DataTableCard title="Payments Drill-Down" columns={paymentsColumns} data={analytics.paymentsTable || []} emptyLabel="No payments in selected range." />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Payment Destination Details</CardTitle>
            <CardDescription>Drivers see these details in checkout before payment submission.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSavePaymentDetails} className="space-y-4">
              <Field label="Phone Payment Number"><Input value={paymentForm.phone} onChange={(e) => setPaymentForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="+251..." /></Field>
              <Field label="Bank Account Number"><Input value={paymentForm.bankAccountNumber} onChange={(e) => setPaymentForm((prev) => ({ ...prev, bankAccountNumber: e.target.value }))} placeholder="Bank account for transfer" /></Field>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Current: Phone {ownerAccount.phone || "not set"} | Bank {ownerAccount.bankAccountNumber || "not set"}
              </div>
              <Button className="w-full" disabled={updatePaymentMutation.isPending}>{updatePaymentMutation.isPending ? "Saving..." : "Save Payment Details"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Operator</CardTitle>
            <CardDescription>Create a new operator account and assign parking access instantly.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateOperator} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full Name"><Input name="fullName" value={operatorForm.fullName} onChange={(e) => setOperatorForm({ ...operatorForm, fullName: e.target.value })} required /></Field>
                <Field label="Email"><Input type="email" name="email" value={operatorForm.email} onChange={(e) => setOperatorForm({ ...operatorForm, email: e.target.value })} autoComplete="email" required /></Field>
                <Field label="Temporary Password"><Input type="password" name="password" value={operatorForm.password} onChange={(e) => setOperatorForm({ ...operatorForm, password: e.target.value })} autoComplete="new-password" minLength={6} required /></Field>
                <Field label="Phone (Optional)"><Input name="phone" value={operatorForm.phone} onChange={(e) => setOperatorForm({ ...operatorForm, phone: e.target.value })} /></Field>
              </div>

              <div className="space-y-2">
                <Label>Assigned Parkings</Label>
              {!parkings.length ? (
                  <EmptyState icon="inbox" title="No parkings yet" description="Owned parkings will appear here once assigned." />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {parkings.map((parking) => {
                      const checked = operatorForm.assignedParkingIds.includes(parking.id);
                      return (
                        <label key={parking.id} className={`cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border hover:bg-accent"}`}>
                          <input type="checkbox" className="mr-2 h-4 w-4 align-middle" checked={checked} onChange={() => toggleParkingAssignment(parking.id)} />
                          {parking.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <Button className="w-full" disabled={createOperatorMutation.isPending || !parkings.length}>{createOperatorMutation.isPending ? "Creating..." : "Create Operator"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Owned Parkings</CardTitle>
            <CardDescription>Live slot distribution for your parking locations.</CardDescription>
          </CardHeader>
          <CardContent>
            {!parkings.length ? (
              <EmptyState icon="inbox" title="No parking sites" description="Parkings linked to your profile will show here." />
            ) : (
              <div className="space-y-3">
                {parkings.map((parking) => (
                  <div key={parking.id} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{parking.name}</div>
                        <div className="text-xs text-muted-foreground">{parking.address || "No address"}</div>
                      </div>
                      <Badge variant={parking.status === "active" ? "success" : "secondary"}>{parking.status || "unknown"}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">Capacity: {parking.slotCapacity || 0}</Badge>
                      <Badge>Available: {parking.availableSlots || 0}</Badge>
                      <Badge variant="warning">Reserved: {parking.reservedSlots || 0}</Badge>
                      <Badge variant="destructive">Occupied: {parking.occupiedSlots || 0}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owned Operators</CardTitle>
            <CardDescription>Manage assignments and activation status per operator.</CardDescription>
          </CardHeader>
          <CardContent>
            {!operators.length ? (
              <EmptyState icon="users" title="No operators" description="Create an operator to manage your parkings." />
            ) : (
              <div className="space-y-3">
                {operators.map((operator) => (
                  <div key={operator.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{operator.fullName || operator.email}</div>
                        <div className="text-xs text-muted-foreground">{operator.email}</div>
                      </div>
                      <Badge variant={operator.status === "active" ? "success" : "destructive"}>{operator.status || "unknown"}</Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {parkings.map((parking) => {
                        const checked = (operatorAssignmentsDraft[operator.id] || []).includes(parking.id);
                        return (
                          <label key={`${operator.id}:${parking.id}`} className={`cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors ${checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border hover:bg-accent"}`}>
                            <input type="checkbox" className="mr-1 h-3.5 w-3.5 align-middle" checked={checked} onChange={() => toggleOperatorParkingDraft(operator.id, parking.id)} />
                            {parking.name}
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={updateAssignmentsMutation.isPending} onClick={() => handleSaveOperatorAssignments(operator.id)}>
                        {updateAssignmentsMutation.isPending ? "Saving..." : "Save Assignments"}
                      </Button>
                      <Button
                        size="sm"
                        variant={operator.status === "active" ? "destructive" : "secondary"}
                        disabled={setStatusMutation.isPending}
                        onClick={() => handleToggleOperatorStatus(operator.id, operator.status === "active" ? "inactive" : "active")}
                      >
                        {setStatusMutation.isPending ? "Updating..." : operator.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
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
                  <tr key={headerGroup.id} className="border-b border-border">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="cursor-pointer whitespace-nowrap px-2 py-2 text-left font-semibold"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-2 py-2">
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

export default OwnerHome;
