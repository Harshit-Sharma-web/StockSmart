// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { api, errorMessage, session } from './api/client';
import type { DataRow, Role } from './api/types';
import { AuthProvider } from './features/auth';

const calls: { path: string; method: string; data: DataRow | undefined; authorization: unknown }[] = [];
const empty = { count: 0, next: null, previous: null, results: [] };
const paged = (...results: DataRow[]) => ({ ...empty, count: results.length, results });
const product = { id: 7, name: 'Steel mug', category: 2, description: 'Insulated mug', sku: 'MUG-7', barcode: '00007', active: true, images: [], selling_price: '12.50', purchase_price: '8.00' };
const location = { id: 4, name: 'Central Store', code: 'CENTRAL', kind: 'store', active: true, address: '' };
const supplier = { id: 5, name: 'Supply Co', active: true };
const dashboard = {
  total_products: 0, total_inventory_quantity: 0, sales_revenue: '0.00', low_stock_products: 0, active_stores: 0,
  active_warehouses: 0, pending_orders: 0, completed_orders: 0, out_of_stock_products: 0, total_inventory_value: '0.00',
  total_orders: 0, inventory_turnover: null, top_selling: [], slow_moving: [], movement_trends: [],
};
const defaultAdapter = api.defaults.adapter;
let role: Role = 'customer';
let rootAdmin = false;
let failLogin = false;
function respond(method: string, path: string, data?: DataRow): [number, unknown] {
  if (path === 'auth/login/') return failLogin ? [401, { detail: 'No active account found.' }] : [200, { access: 'test-access', refresh: 'test-refresh' }];
  if (path === 'auth/profile/') return [200, { id: 1, username: 'sam', role, email: '', first_name: '', last_name: '' }];
  if (path === 'users/' && !rootAdmin) return [403, { detail: 'Permission denied.' }];
  if (path === 'reports/dashboard/') return [200, dashboard];
  if (path === 'products/' && method === 'post') return [201, { ...data, id: 8 }];
  if (path === 'products/') return [200, paged(product)];
  if (path === 'products/7/') return [200, product];
  if (path === 'categories/') return [200, paged({ id: 2, name: 'Drinkware' })];
  if (path === 'locations/') return [200, paged(location)];
  if (path === 'suppliers/') return [200, paged(supplier)];
  if (path === 'supplier-products/') return [200, paged({ id: 22, supplier: 5, product: 7, lead_time_days: 2, unit_cost: '8.00' })];
  if (path === 'scans/' && method === 'post') return [201, { ...data, id: 32 }];
  if (path === 'orders/' && method === 'post') return [201, { id: 9 }];
  if (path === 'orders/9/') return [200, { id: 9, location: 4, total: '12.50', items: [{ product: 7, quantity: 1, shipped: 0, returned: 0, unit_price: '12.50' }], shipments: [], returns: [], created_at: '2026-11-18T06:00:00Z', status: 'pending' }];
  return [method === 'post' ? 201 : 200, empty];
}
const adapter: AxiosAdapter = async (config) => {
  const path = config.url || '';
  const method = config.method || '';
  const data = typeof config.data === 'string' ? JSON.parse(config.data) as DataRow : undefined;
  calls.push({ path, method, data, authorization: config.headers.get('Authorization') });
  const [status, responseData] = respond(method, path, data);
  const response: AxiosResponse = { data: responseData, status, statusText: String(status), headers: {}, config };
  if (status >= 400) throw new AxiosError(String(status), 'ERR_BAD_REQUEST', config, undefined, response);
  return response;
};
function mount(path: string, signedIn = true) {
  if (signedIn) session.set({ access: 'test-access', refresh: 'test-refresh' });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  calls.length = 0;
  role = 'customer';
  rootAdmin = false;
  failLogin = false;
  session.set(null);
  window.sessionStorage.clear();
  api.defaults.adapter = adapter;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); session.set(null); api.defaults.adapter = defaultAdapter; });

it('redirects an anonymous deep link and signs a customer in with an authenticated profile read', async () => {
  mount('/manage/inventory', false);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Username'), 'sam');
  await user.type(screen.getByLabelText('Password'), 'example-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: 'Find what’s in store.' })).toBeInTheDocument();
  expect(calls.find((call) => call.path === 'auth/profile/')?.authorization).toBe('Bearer test-access');
  expect(screen.queryByRole('navigation', { name: 'Management navigation' })).not.toBeInTheDocument();
});
it('shows an API login rejection without losing the form', async () => {
  failLogin = true;
  mount('/login', false);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Username'), 'sam');
  await user.type(screen.getByLabelText('Password'), 'wrong-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No active account found.');
});
it('restores a manager session and hides administrator navigation', async () => {
  role = 'manager';
  mount('/manage');
  const nav = await screen.findByRole('navigation', { name: 'Management navigation' });
  expect(within(nav).getByText('Purchase orders')).toBeInTheDocument();
  expect(within(nav).queryByText('User management')).not.toBeInTheDocument();
  expect(await screen.findByText('No sales in this period', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(await screen.findByText('No orders in this period')).toBeInTheDocument();
});
it('rejects a customer entering a management route', async () => {
  mount('/manage/products');
  expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  expect(calls.some((call) => call.path === 'products/')).toBe(false);
});
it('uses the administrator capability returned by Django even for a default superuser profile', async () => {
  rootAdmin = true;
  mount('/manage/users');
  expect(await screen.findByRole('heading', { name: 'User management' })).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Management navigation' })).getByText('User management')).toBeInTheDocument();
});
it('validates and creates a product using decimal strings and the selected category', async () => {
  role = 'admin';
  mount('/manage/products');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add product' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Create product' }));
  expect(await within(dialog).findByText('Product name is required')).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText('Product name'), 'Pour-over kit');
  await user.type(within(dialog).getByLabelText('SKU'), 'POUR-1');
  // Category dropdown removed; using free‑text entry
  await user.type(within(dialog).getByLabelText('Category'), 'DynamicCategory');
  await user.type(within(dialog).getByLabelText('Purchase price'), '9.50');
  await user.type(within(dialog).getByLabelText('Selling price'), '15.00');
  await user.click(within(dialog).getByRole('button', { name: 'Create product' }));
  await vi.waitFor(() => expect(calls.find((call) => call.path === 'products/' && call.method === 'post')?.data).toMatchObject({ category: expect.any(String), sku: 'POUR-1', selling_price: '15.00', barcode: null }));
});
it('validates movement direction and posts a signed stock adjustment', async () => {
  role = 'manager';
  mount('/manage/movements');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Record movement' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('option', { name: /Steel mug/ });
  await within(dialog).findByRole('option', { name: 'Central Store' });
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Location' }), '4');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Product' }), '7');
  await user.type(within(dialog).getByLabelText('Signed quantity'), '-3');
  await user.click(within(dialog).getByRole('button', { name: 'Record movement' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('require a positive quantity');
  await user.selectOptions(within(dialog).getByLabelText('Movement type'), 'adjustment');
  await user.type(within(dialog).getByLabelText(/Reason \/ note/), 'Count correction');
  await user.click(within(dialog).getByRole('button', { name: 'Record movement' }));
  await vi.waitFor(() => expect(calls.find((call) => call.path === 'stock-movements/' && call.method === 'post')?.data).toMatchObject({ location: 4, product: 7, kind: 'adjustment', quantity: -3 }));
});
it('adds a catalog item to the cart and places an idempotent order for a selected store', async () => {
  mount('/shop/products');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add to cart' }));
  await user.click(screen.getByRole('link', { name: /Cart/ }));
  await user.click(await screen.findByRole('link', { name: 'Checkout' }));
  await screen.findByRole('option', { name: 'Central Store' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Fulfillment store' }), '4');
  await user.click(screen.getByRole('button', { name: 'Place order' }));
  expect(await screen.findByRole('heading', { name: 'Order #9' })).toBeInTheDocument();
  expect(calls.find((call) => call.path === 'orders/' && call.method === 'post')?.data).toEqual({ location: 4, items: [{ product: 7, quantity: 1 }], client_key: expect.any(String) });
});
it('creates a purchase draft using supplier product IDs instead of offer IDs', async () => {
  role = 'manager';
  mount('/manage/purchases');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New purchase order' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('option', { name: 'Central Store' });
  await within(dialog).findByRole('option', { name: 'Supply Co' });
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Location' }), '4');
  await user.type(within(dialog).getByLabelText('Expected delivery'), '2026-12-01');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Supplier' }), '5');
  await within(dialog).findByRole('option', { name: '7' });
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Product 1' }), '7');
  await user.click(within(dialog).getByRole('button', { name: 'Create purchase order' }));
  await vi.waitFor(() => expect(calls.find((call) => call.path === 'purchase-orders/' && call.method === 'post')?.data).toEqual({ location: 4, supplier: 5, expected_date: '2026-12-01', items: [{ product: 7, quantity: 1 }] }));
});
it('lets an operator record two intentional scans of the same barcode', async () => {
  role = 'manager';
  mount('/manage/scanning');
  const user = userEvent.setup();
  for (let index = 0; index < 2; index += 1) {
    await user.click(await screen.findByRole('button', { name: 'Record barcode' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Central Store' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Location' }), '4');
    await user.type(within(dialog).getByLabelText('Barcode'), '00007');
    await user.click(within(dialog).getByRole('button', { name: 'Save scan' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }
  const scans = calls.filter((call) => call.path === 'scans/' && call.method === 'post');
  expect(scans).toHaveLength(2);
  expect(scans[1].data?.client_key).not.toBe(scans[0].data?.client_key);
  expect(scans[1].data).toMatchObject({ kind: 'barcode', identifier: '00007', location: 4 });
});
it('formats nested Django validation and network errors', async () => {
  const instance = axios.create({ adapter: async (config) => {
    throw new AxiosError('validation', 'ERR_BAD_REQUEST', config, undefined, { status: 400, headers: {}, statusText: 'Bad Request', config, data: { items: [{ quantity: ['Too large.'] }] } });
  } });
  const error = await instance.post('/test/').catch((error: unknown) => error);
  expect(errorMessage(error)).toBe('items › quantity: Too large.');
  expect(errorMessage(new AxiosError('network'))).toMatch(/Unable to reach/);
});
