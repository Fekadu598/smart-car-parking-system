import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getRoleHome, sanitizeRole } from "./roleUtils";

export function RequireAuth({ user, loading }) {
  const location = useLocation();
  if (loading) return null;
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

export function RequireRole({ user, role, allowedRoles }) {
  const normalizedRole = sanitizeRole(role);
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(normalizedRole)) {
    return <Navigate to={getRoleHome(normalizedRole)} replace />;
  }
  return <Outlet />;
}

export function RedirectHome({ user, role, loading }) {
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getRoleHome(sanitizeRole(role))} replace />;
}
