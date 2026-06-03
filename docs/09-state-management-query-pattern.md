# State Management Pattern

This document explains how data is managed in the Enderase Smart Parking frontend application.

## Overview

The app uses a **hybrid approach** to state management, choosing the best tool for each use case:

| Data Type | Management Tool | Why |
|-----------|-----------------|-----|
| Server data (dashboards, analytics) | TanStack Query | Caching, automatic refetching, optimistic updates |
| Real-time data (sessions, requests) | Firestore listeners | Live updates without polling |
| Form inputs | Local useState | Simple, isolated state |

---

## Why This Hybrid Approach?

### The Problem

Different parts of the app have different data needs:

| Use Case | Need | Best Tool |
|----------|------|-----------|
| Admin dashboard | Fetch data on load, refresh periodically | TanStack Query |
| Operator queue | See new requests instantly | Firestore listeners |
| Login form | Temporary input state | Local useState |

### The Solution

Use the right tool for each job:

- **TanStack Query** for report-heavy, periodically-refreshed data
- **Firestore listeners** for operations that need instant updates
- **useState** for transient UI state

---

## TanStack Query Layer

### What is TanStack Query?

TanStack Query (formerly React Query) is a library for managing server state in React applications. It handles:

- **Caching** - Stores fetched data to avoid redundant requests
- **Background updates** - Refreshes data automatically
- **Optimistic updates** - Shows changes before server confirms
- **Error handling** - Retries failed requests

### File Structure

```
src/lib/serverState/
├── queryClient.js      # Query client configuration
├── dashboardApi.js     # API functions (calling Cloud Functions)
└── dashboardHooks.js   # Custom React hooks for components
```

### queryClient.js

Configures the TanStack Query client with sensible defaults:

```javascript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // Data is fresh for 30 seconds
      gcTime: 5 * 60 * 1000,       // Keep unused data for 5 minutes
      refetchOnWindowFocus: false, // Don't refetch when tab gains focus
      retry: 1,                    // Only retry failed requests once
    },
  },
});
```

### Configuration Explained

| Option | Value | Purpose |
|--------|-------|---------|
| `staleTime` | 30 seconds | How long before data is considered "old" |
| `gcTime` | 5 minutes | How long to keep unused data in cache |
| `refetchOnWindowFocus` | false | Don't refresh when user switches tabs |
| `retry` | 1 | Retry failed requests once |

### dashboardApi.js

Contains functions that call Cloud Functions:

```javascript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

// Get admin analytics
export const fetchAdminAnalytics = async (params) => {
  const fn = httpsCallable(functions, 'getAdminAnalytics');
  const result = await fn(params);
  return result.data;
};

// Create owner account
export const createOwner = async (params) => {
  const fn = httpsCallable(functions, 'createOwnerAccount');
  const result = await fn(params);
  return result.data;
};

// Upsert parking
export const upsertParking = async (params) => {
  const fn = httpsCallable(functions, 'upsertParking');
  const result = await fn(params);
  return result.data;
};
```

### dashboardHooks.js

Custom React hooks that use TanStack Query:

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminAnalytics, createOwner, upsertParking } from './dashboardApi';

// Hook for fetching admin analytics
export const useAdminAnalytics = (params) => {
  return useQuery({
    queryKey: ['adminAnalytics', params],
    queryFn: () => fetchAdminAnalytics(params),
    enabled: !!params.rangePreset, // Only run if params exist
  });
};

// Hook for creating an owner
export const useCreateOwner = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createOwner,
    onSuccess: () => {
      // Invalidate and refetch owners list
      queryClient.invalidateQueries({ queryKey: ['owners'] });
    },
  });
};

// Hook for upserting a parking
export const useUpsertParking = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: upsertParking,
    onSuccess: () => {
      // Invalidate parkings list
      queryClient.invalidateQueries({ queryKey: ['parkings'] });
    },
  });
};
```

### Query Keys

Query keys uniquely identify each query. They're used for:

- Caching data
- Invalidating caches after mutations
- Sharing data between components

**Naming Convention:**
```javascript
// Simple key
['owners']

// Key with parameters
['adminAnalytics', { rangePreset: '7d' }]

// Key with ID
['parking', parkingId]
```

### Mutation Discipline

All business mutations happen via Cloud Functions, then query invalidation refreshes views:

```
User action → Mutation (Cloud Function) → Success → Invalidate queries → Refetch
```

**Example:**
```javascript
const { mutate: createOwner } = useCreateOwner();

// In component
const handleCreateOwner = (data) => {
  createOwner(data, {
    onSuccess: () => {
      toast.success('Owner created successfully');
      // Query invalidation happens automatically in the hook
    },
    onError: (error) => {
      toast.error(`Failed to create owner: ${error.message}`);
    }
  });
};
```

---

## Firestore Realtime Listeners

### When to Use

Use Firestore listeners for data that changes frequently and needs instant updates:

| Use Case | Why Listener? |
|----------|---------------|
| Operator's pending check-in requests | New requests appear instantly |
| Operator's pending payments queue | See new submissions immediately |
| Driver's active session | Duration updates in real-time |
| Parking slot counters | See availability changes |

### How Listeners Work

```javascript
import { onSnapshot, query, where, collection } from 'firebase/firestore';
import { db } from '../../firebase';

// Set up listener
const q = query(
  collection(db, 'checkInRequests'),
  where('parkingId', '==', parkingId),
  where('status', '==', 'pending')
);

const unsubscribe = onSnapshot(q, (snapshot) => {
  const requests = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  setPendingRequests(requests);
});

// Clean up when component unmounts
return () => unsubscribe();
```

### In a React Component

```javascript
import { useEffect, useState } from 'react';
import { onSnapshot, query, where, collection } from 'firebase/firestore';
import { db } from '../../firebase';

function OperatorQueue({ parkingId }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'checkInRequests'),
      where('parkingId', '==', parkingId),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPendingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (error) => {
        console.error('Listener error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [parkingId]);

  if (loading) return <div>Loading...</div>;

  return (
    <ul>
      {pendingRequests.map(request => (
        <li key={request.id}>{request.plateNumber}</li>
      ))}
    </ul>
  );
}
```

---

## Local useState for Forms

### When to Use

Use `useState` for:

- Form input values
- Modal open/close state
- Temporary UI state
- Loading indicators

### Example: Login Form

```javascript
import { useState } from 'react';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      {error && <div className="error">{error}</div>}
      <button type="submit" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
```

---

## Decision Matrix

When adding new data to the app, use this decision tree:

```
Does the data need real-time updates?
├── Yes → Use Firestore listener
└── No → Does it come from a Cloud Function?
         ├── Yes → Use TanStack Query
         └── No → Is it temporary UI state?
                  ├── Yes → Use useState
                  └── No → Consider context or other state management
```

### Examples

| Data | Real-time? | From Function? | Temporary? | Solution |
|------|------------|----------------|------------|----------|
| Admin analytics | No | Yes | No | TanStack Query |
| Pending check-in requests | Yes | No | No | Firestore listener |
| Login form inputs | No | No | Yes | useState |
| Driver's active session | Yes | No | No | Firestore listener |
| Owner's parkings list | No | Yes | No | TanStack Query |
| Modal open state | No | No | Yes | useState |

---

## Best Practices

### TanStack Query

| Practice | Why |
|----------|-----|
| Use query keys consistently | Enables proper caching and invalidation |
| Invalidate after mutations | Keeps data fresh |
| Handle loading and error states | Better user experience |
| Use enabled option | Prevents unnecessary requests |

### Firestore Listeners

| Practice | Why |
|----------|-----|
| Always clean up listeners | Prevents memory leaks |
| Handle errors | Prevents silent failures |
| Use query filters | Reduces data transfer |
| Consider security rules | Listeners respect Firestore rules |

### Local State

| Practice | Why |
|----------|-----|
| Keep state minimal | Reduces complexity |
| Derive when possible | Avoids synchronization issues |
| Lift state up when needed | Enables sharing between components |

---

## Related Documentation

- `docs/01-system-architecture.md` - Overall system design
- `docs/06-cloud-functions-api.md` - Functions called by the API layer
- `docs/10-analytics-and-commission.md` - How analytics data is fetched and displayed