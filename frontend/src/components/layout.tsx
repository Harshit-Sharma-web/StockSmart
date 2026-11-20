import { Bell, Building2, ChevronDown, ChevronRight, ClipboardList, FolderOpen, LayoutDashboard, LogOut, Menu, Package, ScanLine, Search, Settings, ShoppingBag, Users, Warehouse, Workflow, X, ArrowRightLeft, ChartColumn, FileText, Truck, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi, purchasingApi } from '../api/services';
import { Brand, Loading } from './ui';
import { useAuth } from '../features/auth';
import { CartProvider, useCart } from '../features/storefront';

interface NavItem { to: string; label: string; icon: LucideIcon; admin?: boolean }
const groups: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { to: '', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/products', label: 'Products', icon: Package },
    { to: '/categories', label: 'Categories', icon: FolderOpen },
    { to: '/inventory', label: 'Inventory', icon: Warehouse },
    { to: '/locations', label: 'Stores & warehouses', icon: Building2 },
    { to: '/movements', label: 'Stock movements', icon: Workflow },
    { to: '/transfers', label: 'Stock transfers', icon: ArrowRightLeft },
  ] },
  { title: 'Operations', items: [
    { to: '/orders', label: 'Orders', icon: ClipboardList },
    { to: '/suppliers', label: 'Suppliers', icon: Truck },
    { to: '/purchases', label: 'Purchase orders', icon: ShoppingBag },
    { to: '/scanning', label: 'Barcode & RFID', icon: ScanLine },
  ] },
  { title: 'Insights', items: [
    { to: '/analytics', label: 'Analytics', icon: ChartColumn },
    { to: '/reports', label: 'Reports', icon: FileText },
    { to: '/reorder-rules', label: 'Reorder rules', icon: SlidersHorizontal },
  ] },
  { title: 'Administration', items: [
    { to: '/users', label: 'User management', icon: Users, admin: true },
    { to: '/assignments', label: 'Location assignments', icon: Building2, admin: true },
    { to: '/settings', label: 'Settings', icon: Settings },
  ] },
];

function UserMenu({ settings }: { settings: string }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  return <details className="user-menu"><summary aria-label="Account menu"><span className="avatar">{auth.profile?.username.slice(0, 2).toUpperCase()}</span><span className="account-name">{auth.profile?.username}<small>{auth.role === 'manager' ? 'Store manager' : auth.role}</small></span><ChevronDown size={15} /></summary>
    <div className="user-dropdown">
      <Link to={settings} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); }}><Settings size={16} /> Account settings</Link>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); await auth.logout(); }}><LogOut size={16} /> {busy ? 'Signing out…' : 'Sign out'}</button>
    </div></details>;
}

export function ManagementLayout() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const stock = useQuery({ queryKey: ['alerts', 'stock'], queryFn: ({ signal }) => inventoryApi.lowStock(signal) });
  const deliveries = useQuery({ queryKey: ['alerts', 'deliveries'], queryFn: ({ signal }) => purchasingApi.alerts(signal) });
  const count = (stock.data?.count || 0) + (deliveries.data?.count || 0);
  const section = location.pathname.split('/')[2] || '';
  const sectionLabel = groups.flatMap((group) => group.items).find((item) => item.to === (section ? '/' + section : ''))?.label ||
    ({ alerts: 'Alerts', 'supplier-products': 'Supplier products', 'rfid-tags': 'RFID tags' } as Record<string, string>)[section] || 'Workspace';
  return <div className="workspace">
    <a className="skip" href="#main">Skip to content</a>
    {open && <button className="sidebar-scrim" aria-label="Dismiss navigation" onClick={() => setOpen(false)} />}
    <aside className={'sidebar' + (open ? ' sidebar-open' : '')}>
      <div className="side-brand"><Link to="/manage" onClick={() => setOpen(false)}><Brand /></Link><button className="button icon nav-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={19} /></button></div>
      <nav aria-label="Management navigation">{groups.map((group) => <section key={group.title}><h2>{group.title}</h2>
        {group.items.filter((item) => !item.admin || role === 'admin').map(({ to, label, icon: Icon }) => <NavLink key={to} to={'/manage' + to} end={!to} onClick={() => setOpen(false)}><Icon size={17} /><span>{label}</span></NavLink>)}
      </section>)}</nav>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <button type="button" className="button icon nav-toggle" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}><Menu size={21} /></button>
        <div className="breadcrumbs"><Link to="/manage">Workspace</Link><ChevronRight size={13} /><span>{sectionLabel}</span></div>
        <form className="top-search" onSubmit={(event) => { event.preventDefault(); navigate('/manage/products' + (search.trim() ? '?search=' + encodeURIComponent(search.trim()) : '')); }}>
          <Search size={16} /><input placeholder="Search products…" aria-label="Search catalog" value={search} onChange={(event) => setSearch(event.target.value)} />
        </form>
        <Link className="alert-button button icon" aria-label={count ? 'Alerts, ' + count + ' items' : 'Alerts'} to="/manage/alerts"><Bell size={19} />{count > 0 && <i />}</Link>
        <UserMenu settings="/manage/settings" />
      </header>
      <main id="main" className="page"><Suspense fallback={<Loading label="Loading page" />}><Outlet /></Suspense></main>
    </div>
  </div>;
}
export function ShopLayout() {
  const { profile } = useAuth();
  return <CartProvider userId={profile!.id} key={profile!.id}><ShopShell /></CartProvider>;
}
function ShopShell() {
  const cart = useCart();
  return <div className="shop-shell"><a className="skip" href="#main">Skip to content</a><header className="shop-topbar">
    <Link to="/shop"><Brand /></Link>
    <nav aria-label="Shop navigation"><NavLink to="/shop/products">Catalog</NavLink><NavLink to="/shop/orders">My orders</NavLink></nav>
    <Link className="shop-cart button" to="/shop/cart"><ShoppingBag size={18} /> Cart {cart.items.length > 0 && <span>{cart.items.length}</span>}</Link>
    <UserMenu settings="/shop/profile" />
  </header><main id="main" className="page shop-page"><Outlet /></main></div>;
}
