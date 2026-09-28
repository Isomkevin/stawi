import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const invoiceDetailOptions = (invoiceId: string) =>
  queryOptions({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.getInvoice(invoiceId),
  });

export const coopOptions = (coopId: string) =>
  queryOptions({
    queryKey: ["coop", coopId],
    queryFn: () => api.getCoop(coopId),
  });

export const coopMembersOptions = (coopId: string) =>
  queryOptions({
    queryKey: ["coop", coopId, "members"],
    queryFn: () => api.getCoopMembers(coopId),
  });

export const accountOptions = (accountId: string) =>
  queryOptions({
    queryKey: ["account", accountId],
    queryFn: () => api.getAccount(accountId),
  });
