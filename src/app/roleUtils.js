export const FALLBACK_ROLE = "driver";
export const ALLOWED_ROLES = ["admin", "owner", "operator", "driver"];

export const ROLE_HOME = {
  admin: "/admin/home",
  owner: "/owner/home",
  operator: "/operator/home",
  driver: "/driver/home",
};

const ROLE_PREFIX = {
  admin: "/admin",
  owner: "/owner",
  operator: "/operator",
  driver: "/driver",
};

export function sanitizeRole(inputRole) {
  if (typeof inputRole !== "string") return FALLBACK_ROLE;
  const normalizedRole = inputRole.trim().toLowerCase();
  return ALLOWED_ROLES.includes(normalizedRole) ? normalizedRole : FALLBACK_ROLE;
}

export function getRoleHome(role) {
  return ROLE_HOME[sanitizeRole(role)];
}

export function isSafeInternalPath(path) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

export function canRoleAccessPath(role, path) {
  const normalizedRole = sanitizeRole(role);
  if (!isSafeInternalPath(path)) return false;

  if (normalizedRole === "admin") return true;

  const rolePrefix = ROLE_PREFIX[normalizedRole];
  if (!rolePrefix) return false;

  return path === rolePrefix || path.startsWith(`${rolePrefix}/`);
}
