# Analytics and Commission Logic

This document explains how analytics work in the Enderase Smart Parking platform and how commissions are calculated.

## Overview

Analytics provide insights into platform performance for two user roles:

| Role | What They See |
|------|---------------|
| **Admin** | Platform-wide metrics: total revenue, all parkings, all owners, commission earned |
| **Owner** | Their own metrics: their parkings' performance, their revenue, operator productivity |

---

## Commission Policy

### The 10% Rule

The platform takes a **10% commission** on every completed payment:

```
platformCommission = grossAmount × 0.10
ownerAmount = grossAmount - platformCommission
```

### Example Calculations

| Gross Payment | Platform (10%) | Owner (90%) |
|---------------|----------------|-------------|
| 50 ETB | 5 ETB | 45 ETB |
| 100 ETB | 10 ETB | 90 ETB |
| 150 ETB | 15 ETB | 135 ETB |
| 200 ETB | 20 ETB | 180 ETB |
| 500 ETB | 50 ETB | 450 ETB |

### Where Commission is Calculated

Commission is calculated in the `confirmManualPayment` Cloud Function when a payment is confirmed:

```javascript
// In functions/index.js - confirmManualPayment
const grossAmount = session.feeAmount;
const platformCommission = Math.round(grossAmount * 0.10);
const ownerAmount = grossAmount - platformCommission;

await paymentsRef.add({
  grossAmount,
  ownerAmount,
  platformCommission,
  // ... other fields
});
```

### Historical Data Handling

The functions normalize values even if historical payment records are missing the split fields:

```javascript
// If payment record exists but lacks ownerAmount/platformCommission
if (payment.ownerAmount === undefined) {
  payment.ownerAmount = payment.grossAmount * 0.9;
  payment.platformCommission = payment.grossAmount * 0.1;
}
```

---

## Analytics Functions

### `getAdminAnalytics`

**Who can call:** Admin only

**Purpose:** Get platform-wide performance metrics

#### Parameters

```javascript
{
  rangePreset: "7d",     // "7d" or "30d"
  fromMs: 123456789,     // Optional: Custom range start (milliseconds)
  toMs: 123456790        // Optional: Custom range end (milliseconds)
}
```

#### Returns

```javascript
{
  // Summary KPIs
  summary: {
    grossRevenue: 50000,        // Total revenue in ETB
    ownerRevenue: 45000,        // Total paid to owners
    adminCommission: 5000,      // Total platform commission
    completedSessions: 1000,    // Total sessions completed
    pendingPayments: 15,        // Payments awaiting confirmation
    activeParkings: 25,         // Parkings with status "active"
    totalOperators: 50          // Total operator accounts
  },
  
  // Time series for charts
  revenueTimeSeries: [
    { date: "2024-01-01", revenue: 5000, commission: 500 },
    { date: "2024-01-02", revenue: 4500, commission: 450 },
    // ...
  ],
  
  // Payment method breakdown
  paymentMethodBreakdown: {
    bank: 60,       // 60% of payments by bank
    phone: 40       // 40% of payments by mobile money
  },
  
  // Top performers
  topOwners: [
    { id: "owner1", name: "John Doe", revenue: 10000 },
    { id: "owner2", name: "Jane Smith", revenue: 8500 },
    // ...
  ],
  
  topParkings: [
    { id: "parking1", name: "Bole Mall", revenue: 8000, sessions: 160 },
    { id: "parking2", name: "CMC Square", revenue: 6000, sessions: 120 },
    // ...
  ]
}
```

---

### `getOwnerAnalytics`

**Who can call:** Owner only

**Purpose:** Get metrics for the owner's parkings

#### Parameters

```javascript
{
  rangePreset: "7d",
  fromMs: 123456789,
  toMs: 123456790
}
```

#### Returns

```javascript
{
  // Summary KPIs (filtered to owner's data)
  summary: {
    grossRevenue: 10000,
    ownerRevenue: 9000,
    completedSessions: 200,
    pendingPayments: 3,
    activeParkings: 2,
    totalOperators: 5
  },
  
  // Time series
  revenueTimeSeries: [...],
  
  // Payment method breakdown
  paymentMethodBreakdown: { bank: 70, phone: 30 },
  
  // Per-parking performance
  parkingPerformance: [
    {
      id: "parking1",
      name: "Bole Mall Parking",
      revenue: 6000,
      sessions: 120,
      avgSessionDuration: 95,  // minutes
      utilizationRate: 0.75    // 75% average occupancy
    },
    {
      id: "parking2",
      name: "CMC Parking",
      revenue: 4000,
      sessions: 80,
      avgSessionDuration: 85,
      utilizationRate: 0.60
    }
  ],
  
  // Owner account details
  ownerDetails: {
    bankAccountNumber: "123456789",
    phone: "+251912345678",
    totalOperators: 5,
    activeOperators: 4
  }
}
```

---

## Frontend Implementation

### Where Analytics Are Displayed

| Page | File | Role |
|------|------|------|
| Admin Dashboard | `src/pages/AdminHome.js` | Admin |
| Owner Dashboard | `src/pages/OwnerHome.js` | Owner |

### UI Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Charts | Recharts | Line charts, bar charts, pie charts |
| Tables | TanStack Table | Sortable, filterable data tables |
| Formatting | Intl.NumberFormat | Currency (ETB), percentages |
| Dates | Date methods / date-fns | Date formatting and manipulation |

### Example: Admin Dashboard

```javascript
import { useAdminAnalytics } from '../../lib/serverState/dashboardHooks';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function AdminDashboard() {
  const [range, setRange] = useState('7d');
  const { data, isLoading, error } = useAdminAnalytics({ rangePreset: range });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard 
          title="Gross Revenue" 
          value={formatCurrency(data.summary.grossRevenue)} 
        />
        <KPICard 
          title="Platform Commission" 
          value={formatCurrency(data.summary.adminCommission)} 
        />
        <KPICard 
          title="Completed Sessions" 
          value={data.summary.completedSessions} 
        />
        <KPICard 
          title="Active Parkings" 
          value={data.summary.activeParkings} 
        />
      </div>

      {/* Revenue Chart */}
      <div className="mt-8">
        <h2>Revenue Trend</h2>
        <LineChart data={data.revenueTimeSeries}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="revenue" stroke="#8884d8" />
        </LineChart>
      </div>

      {/* Top Parkings Table */}
      <div className="mt-8">
        <h2>Top Parkings</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Revenue</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {data.topParkings.map(parking => (
              <tr key={parking.id}>
                <td>{parking.name}</td>
                <td>{formatCurrency(parking.revenue)}</td>
                <td>{parking.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Currency formatter
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-ET', {
    style: 'currency',
    currency: 'ETB',
    minimumFractionDigits: 0
  }).format(amount);
}
```

---

## Supported Time Ranges

| Preset | Description | Use Case |
|--------|-------------|----------|
| `7d` | Last 7 days | Weekly review, recent trends |
| `30d` | Last 30 days | Monthly review, broader patterns |

### Custom Ranges

The API also supports custom date ranges:

```javascript
getAdminAnalytics({
  fromMs: startDate.getTime(),
  toMs: endDate.getTime()
})
```

---

## Investor-Friendly KPIs

The analytics are designed to answer key investor questions:

### Revenue Metrics

| KPI | What It Shows |
|-----|---------------|
| **Gross Revenue** | Total money collected from drivers |
| **Owner Revenue** | Money paid out to parking owners |
| **Admin Commission** | Platform's revenue (10% of gross) |

### Operational Metrics

| KPI | What It Shows |
|-----|---------------|
| **Completed Sessions** | How many parking sessions ended successfully |
| **Pending Payments** | Payments awaiting operator confirmation |
| **Active Parkings** | Parking locations currently operating |
| **Total Operators** | Staff managing parking operations |

### Efficiency Metrics

| KPI | What It Shows |
|-----|---------------|
| **Utilization Rate** | How full parkings are on average |
| **Avg Session Duration** | How long vehicles typically park |
| **Revenue per Parking** | Average revenue per location |

---

## Data Sources

Analytics are computed from these collections:

| Collection | Used For |
|------------|----------|
| `payments` | Revenue, commission calculations |
| `sessions` | Session counts, durations |
| `parkings` | Parking counts, utilization |
| `users` | Operator counts |
| `paymentRequests` | Pending payment counts |

### Query Patterns

```javascript
// Get payments in date range
const payments = await db.collection('payments')
  .where('paidAt', '>=', startDate)
  .where('paidAt', '<=', endDate)
  .get();

// Get sessions in date range
const sessions = await db.collection('sessions')
  .where('status', '==', 'completed')
  .where('exitTime', '>=', startDate)
  .where('exitTime', '<=', endDate)
  .get();
```

---

## Performance Considerations

### Caching

Analytics queries are cached by TanStack Query:

- `staleTime: 30000` - Data is fresh for 30 seconds
- Background refetch keeps data updated
- Manual refresh available via button

### Aggregation

For large datasets, consider:

1. **Pre-computed aggregates** - Store daily/weekly totals
2. **Scheduled functions** - Calculate metrics nightly
3. **Pagination** - Limit table results

---

## Related Documentation

- `docs/06-cloud-functions-api.md` - Analytics function reference
- `docs/09-state-management-query-pattern.md` - How analytics are fetched
- `docs/08-manual-payment-flow.md` - How payments are created
- `docs/13-investor-demo-script.md` - Presenting analytics to investors