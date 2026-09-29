import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

export const accountOptions = (accountId: string) =>
  queryOptions({ queryKey: ["account", accountId], queryFn: () => api.getAccount(accountId) });

export const demoSettingsOptions = (accountId: string) =>
  queryOptions({
    queryKey: ["account", accountId, "demo-settings"],
    queryFn: () => api.getDemoSettings(accountId),
  });

export const balanceOptions = (accountId: string) =>
  queryOptions({
    queryKey: ["account", accountId, "balance"],
    queryFn: () => api.getBalance(accountId),
    refetchInterval: 5000,
  });

export const accountTxnsOptions = (accountId: string) =>
  queryOptions({
    queryKey: ["account", accountId, "transactions"],
    queryFn: () => api.getAccountTransactions(accountId, 50),
    refetchInterval: 5000,
  });

export const invoicesOptions = (params: { coop_id?: string; account_id?: string }) =>
  queryOptions({
    queryKey: ["invoices", params],
    queryFn: () => api.listInvoices(params),
    refetchInterval: 5000,
  });

export const invoiceOptions = (invoiceId: string) =>
  queryOptions({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.getInvoice(invoiceId),
    refetchInterval: 3000,
  });

export const coopOptions = (coopId: string) =>
  queryOptions({ queryKey: ["coop", coopId], queryFn: () => api.getCoop(coopId) });

export const coopMembersOptions = (coopId: string) =>
  queryOptions({ queryKey: ["coop", coopId, "members"], queryFn: () => api.getCoopMembers(coopId) });

export const coopMetricsOptions = (coopId: string) =>
  queryOptions({ queryKey: ["coop", coopId, "metrics"], queryFn: () => api.getCoopMetrics(coopId) });

export const coopPayoutsOptions = (coopId: string) =>
  queryOptions({ queryKey: ["coop", coopId, "payouts"], queryFn: () => api.listCoopPayouts(coopId) });

export const accountShipmentsOptions = (accountId: string) =>
  queryOptions({ queryKey: ["account", accountId, "shipments"], queryFn: () => api.listAccountShipments(accountId), refetchInterval: 10000 });

export const coopShipmentsOptions = (coopId: string) =>
  queryOptions({ queryKey: ["coop", coopId, "shipments"], queryFn: () => api.listShipments(coopId), refetchInterval: 10000 });
