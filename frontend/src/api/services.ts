import { api } from './client';
import type { Balance, Category, Dashboard, DataRow, Location, Offer, Order, Page, Params, Product, Profile, Purchase, ReportName, Supplier, Tokens, User } from './types';

export const resources = {
  products: 'products', categories: 'categories', images: 'product-images', locations: 'locations',
  assignments: 'location-assignments', users: 'users', balances: 'inventory', movements: 'stock-movements',
  transfers: 'stock-transfers', orders: 'orders', suppliers: 'suppliers', offers: 'supplier-products',
  purchases: 'purchase-orders', tags: 'rfid-tags', scans: 'scans', rules: 'reorder-rules',
} as const;
export type Resource = typeof resources[keyof typeof resources];

export async function get<T>(path: string, params?: Params, signal?: AbortSignal) {
  return (await api.get<T>(path, { params, signal })).data;
}
export const list = <T = DataRow>(resource: Resource | string, params?: Params, signal?: AbortSignal) =>
  get<Page<T>>(resource + '/', params, signal);
export const detail = <T = DataRow>(resource: Resource, id: number, signal?: AbortSignal) =>
  get<T>(resource + '/' + id + '/', undefined, signal);
export async function write<T = DataRow>(method: 'post' | 'patch' | 'delete', path: string, data?: unknown) {
  return (await api.request<T>({ method, url: path, data })).data;
}
export const authApi = {
  login: (data: unknown) => write<Tokens>('post', 'auth/login/', data),
  register: (data: unknown) => write<Profile>('post', 'auth/register/', data),
  profile: (signal?: AbortSignal) => get<Profile>('auth/profile/', undefined, signal),
  update: (data: unknown) => write<Profile>('patch', 'auth/profile/', data),
  password: (data: unknown) => write('post', 'auth/change-password/', data),
  logout: (refresh: string) => write('post', 'auth/logout/', { refresh }),
};
export const usersApi = { detail: (id: number, signal?: AbortSignal) => detail<User>('users', id, signal) };
export const locationsApi = { list: (params?: Params, signal?: AbortSignal) => list<Location>('locations', params, signal) };
export const productsApi = {
  list: (params?: Params, signal?: AbortSignal) => list<Product>('products', params, signal),
  detail: (id: number, signal?: AbortSignal) => detail<Product>('products', id, signal),
  categories: (signal?: AbortSignal) => list<Category>('categories', undefined, signal),
};
export const inventoryApi = {
  lowStock: (signal?: AbortSignal) => list<Balance>('inventory/low-stock', undefined, signal),
  totals: (params?: Params, signal?: AbortSignal) => get<{ on_hand: number; reserved: number; available: number }>('inventory/totals/', params, signal),
};
export const ordersApi = {
  list: (params?: Params, signal?: AbortSignal) => list<Order>('orders', params, signal),
  detail: (id: number, signal?: AbortSignal) => detail<Order>('orders', id, signal),
  checkout: (data: unknown) => write<Order>('post', 'orders/', data),
};
export const suppliersApi = {
  detail: (id: number, signal?: AbortSignal) => detail<Supplier>('suppliers', id, signal),
  offers: (supplier: number, signal?: AbortSignal) => list<Offer>('supplier-products', { supplier }, signal),
};
export const purchasingApi = {
  detail: (id: number, signal?: AbortSignal) => detail<Purchase>('purchase-orders', id, signal),
  alerts: (signal?: AbortSignal) => list<Purchase>('purchase-orders/delivery-alerts', undefined, signal),
};
export const scanningApi = { barcode: (barcode: string, signal?: AbortSignal) => get<Product>('barcodes/' + encodeURIComponent(barcode) + '/', undefined, signal) };
export const analyticsApi = {
  dashboard: (params?: Params, signal?: AbortSignal) => get<Dashboard>('reports/dashboard/', params, signal),
  report: (report: ReportName, params?: Params, signal?: AbortSignal) => list<DataRow>('reports/' + report, params, signal),
  async download(report: ReportName, params: Params) {
    const { data } = await api.get<Blob>('reports/' + report + '/', { params: { ...params, export: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const element = document.createElement('a');
    element.href = url;
    element.download = report + '.csv';
    element.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
