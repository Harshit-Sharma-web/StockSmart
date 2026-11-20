import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { lazy, type ReactNode } from 'react';
import { ManagementLayout, ShopLayout } from './components/layout';
import { ResourceDetail, ResourceIndex } from './components/resource';
import { Missing } from './components/ui';
import { Account, AuthPage, Gate, useAuth } from './features/auth';

import { configs } from './features/configs';
import { BalanceDetail, Inventory, OrderDetail, PurchaseDetail, Purchases, ScanDetail, Scanning, TransferDetail, Transfers } from './features/workflows';
import { CartPage, MyOrders, Storefront, StoreProduct } from './features/storefront';

const Dashboard = lazy(() => import('./features/analytics').then((module) => ({ default: module.Dashboard })));
const Reports = lazy(() => import('./features/analytics').then((module) => ({ default: module.Reports })));
const Alerts = lazy(() => import('./features/analytics').then((module) => ({ default: module.Alerts })));

function Home() {
  return <Navigate to={useAuth().role === 'customer' ? '/shop' : '/manage'} replace />;
}
function RecordRoute({ render }: { render: (id: number) => ReactNode }) {
  const { id } = useParams();
  const integer = Number(id);
  return id && /^\d+$/.test(id) && Number.isSafeInteger(integer) && integer > 0 ? render(integer) : <Missing />;
}
const managementResources = [configs.products, configs.categories, configs.locations, configs.assignments, configs.users, configs.suppliers, configs.offers, configs.tags, configs.rules];
const adminPaths = new Set(['assignments', 'users', 'rfid-tags']);
export function App() {
  return <Routes>
    <Route path="/" element={<Gate><Home /></Gate>} />
    <Route path="/login" element={<AuthPage />} />
    <Route path="/register" element={<AuthPage register />} />
    <Route path="/unauthorized" element={<Missing denied />} />
    <Route path="/manage" element={<Gate allow={['admin', 'manager']}><ManagementLayout /></Gate>}>
      <Route index element={<Dashboard />} />
      {managementResources.map((config) => {
        const path = config.route.split('/').at(-1)!;
        const protect = (child: ReactNode) => adminPaths.has(path) ? <Gate allow={['admin']}>{child}</Gate> : child;
        return <Route path={path} key={path}>
          <Route index element={protect(<ResourceIndex key={path} config={config} />)} />
          <Route path=":id" element={protect(<RecordRoute render={(id) => <ResourceDetail key={id} id={id} config={config} />} />)} />
        </Route>;
      })}
      <Route path="inventory" element={<Inventory />} />
      <Route path="inventory/:id" element={<RecordRoute render={(id) => <BalanceDetail key={id} id={id} />} />} />
      <Route path="movements" element={<Inventory key="movements" movements />} />
      <Route path="movements/:id" element={<RecordRoute render={(id) => <ResourceDetail key={id} id={id} config={configs.movements} />} />} />
      <Route path="transfers" element={<Transfers />} />
      <Route path="transfers/:id" element={<RecordRoute render={(id) => <TransferDetail key={id} id={id} />} />} />
      <Route path="orders" element={<ResourceIndex key="orders" config={configs.orders} />} />
      <Route path="orders/:id" element={<RecordRoute render={(id) => <OrderDetail key={id} id={id} />} />} />
      <Route path="purchases" element={<Purchases />} />
      <Route path="purchases/:id" element={<RecordRoute render={(id) => <PurchaseDetail key={id} id={id} />} />} />
      <Route path="scanning" element={<Scanning />} />
      <Route path="scanning/:id" element={<RecordRoute render={(id) => <ScanDetail key={id} id={id} />} />} />
      <Route path="analytics" element={<Reports key="analytics" analytics />} />
      <Route path="reports" element={<Reports key="reports" />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="settings" element={<Account />} />
    </Route>
    <Route path="/shop" element={<Gate allow={['customer']}><ShopLayout /></Gate>}>
      <Route index element={<Storefront home />} />
      <Route path="products" element={<Storefront key="catalog" />} />
      <Route path="products/:id" element={<RecordRoute render={(id) => <StoreProduct key={id} id={id} />} />} />
      <Route path="cart" element={<CartPage key="cart" />} />
      <Route path="checkout" element={<CartPage key="checkout" checkout />} />
      <Route path="orders" element={<MyOrders />} />
      <Route path="orders/:id" element={<RecordRoute render={(id) => <OrderDetail key={id} id={id} storefront />} />} />
      <Route path="profile" element={<Account />} />
    </Route>
    <Route path="*" element={<Missing />} />
  </Routes>;
}
