import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminArchiveOwner,
  adminRestoreOwner,
  assignOperatorToParking,
  createOwnerAccount,
  createOwnerOperator,
  dashboardQueryKeys,
  getAdminAnalytics,
  getAdminOperatorList,
  getAdminOwnerList,
  getAdminParkingList,
  getOwnerAnalytics,
  setOwnerOperatorStatus,
  updateOwnerOperatorAssignments,
  updateOwnerPaymentDetails,
  upsertParking,
} from "./dashboardApi";

function invalidateMany(queryClient, keys) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useAdminAnalytics(rangePreset = "30d", options = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.adminAnalytics(rangePreset),
    queryFn: () => getAdminAnalytics(rangePreset),
    refetchInterval: options.refetchInterval ?? 15000,
    ...options,
  });
}

export function useAdminOwners(options = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.adminOwners(),
    queryFn: getAdminOwnerList,
    refetchInterval: options.refetchInterval ?? 15000,
    ...options,
  });
}

export function useAdminParkings(options = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.adminParkings(),
    queryFn: getAdminParkingList,
    refetchInterval: options.refetchInterval ?? 15000,
    ...options,
  });
}

export function useAdminOperators(options = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.adminOperators(),
    queryFn: getAdminOperatorList,
    refetchInterval: options.refetchInterval ?? 15000,
    ...options,
  });
}

export function useOwnerAnalytics(rangePreset = "30d", options = {}) {
  return useQuery({
    queryKey: dashboardQueryKeys.ownerAnalytics(rangePreset),
    queryFn: () => getOwnerAnalytics(rangePreset),
    refetchInterval: options.refetchInterval ?? 12000,
    ...options,
  });
}

export function useCreateOwnerAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "admin", "createOwnerAccount"],
    mutationFn: createOwnerAccount,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.adminOwners(),
        dashboardQueryKeys.adminAnalytics("7d"),
        dashboardQueryKeys.adminAnalytics("30d"),
      ]);
    },
  });
}

export function useUpsertParking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "admin", "upsertParking"],
    mutationFn: upsertParking,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.adminParkings(),
        dashboardQueryKeys.adminAnalytics("7d"),
        dashboardQueryKeys.adminAnalytics("30d"),
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
      ]);
    },
  });
}

export function useAssignOperatorToParking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "admin", "assignOperatorToParking"],
    mutationFn: assignOperatorToParking,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.adminOperators(),
        dashboardQueryKeys.adminAnalytics("7d"),
        dashboardQueryKeys.adminAnalytics("30d"),
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
      ]);
    },
  });
}

export function useAdminArchiveOwner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "admin", "archiveOwner"],
    mutationFn: adminArchiveOwner,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.adminOwners(),
        dashboardQueryKeys.adminParkings(),
        dashboardQueryKeys.adminOperators(),
        dashboardQueryKeys.adminAnalytics("7d"),
        dashboardQueryKeys.adminAnalytics("30d"),
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
      ]);
    },
  });
}

export function useAdminRestoreOwner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "admin", "restoreOwner"],
    mutationFn: adminRestoreOwner,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.adminOwners(),
        dashboardQueryKeys.adminParkings(),
        dashboardQueryKeys.adminOperators(),
        dashboardQueryKeys.adminAnalytics("7d"),
        dashboardQueryKeys.adminAnalytics("30d"),
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
      ]);
    },
  });
}

export function useUpdateOwnerPaymentDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "owner", "updatePaymentDetails"],
    mutationFn: updateOwnerPaymentDetails,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
      ]);
    },
  });
}

export function useCreateOwnerOperator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "owner", "createOperator"],
    mutationFn: createOwnerOperator,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
        dashboardQueryKeys.adminOperators(),
      ]);
    },
  });
}

export function useUpdateOwnerOperatorAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "owner", "updateOperatorAssignments"],
    mutationFn: updateOwnerOperatorAssignments,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
        dashboardQueryKeys.adminOperators(),
      ]);
    },
  });
}

export function useSetOwnerOperatorStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["dashboard", "owner", "setOperatorStatus"],
    mutationFn: setOwnerOperatorStatus,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        dashboardQueryKeys.ownerAnalytics("7d"),
        dashboardQueryKeys.ownerAnalytics("30d"),
        dashboardQueryKeys.adminOperators(),
      ]);
    },
  });
}
