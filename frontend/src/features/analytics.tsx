import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDownToLine, ArrowRight, ArrowRightLeft, BarChart3, Boxes, CircleDollarSign, ClipboardList, Package, PackageMinus, Plus, ScanLine, Store, Warehouse } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { analyticsApi, inventoryApi, list, ordersApi, purchasingApi } from '../api/services';
import type { Dashboard as DashboardData, DataRow, Params, ReportName } from '../api/types';
import { Lookup } from '../components/forms';
import { Rows, type Column } from '../components/resource';
import { Empty, Header, Issue, Loading, Pager, format } from '../components/ui';
import { errorMessage } from '../api/client';
import { configs } from './configs';

const colors = ['#365df5', '#28ad9b', '#8c78eb', '#f4a64b', '#73a4ff', '#ef7b82'];
const reportLabels: Record<ReportName, string> = {
  sales: 'Sales', inventory: 'Inventory by location', movements: 'Stock movements', products: 'Product performance',
  'low-stock': 'Low stock', 'purchase-orders': 'Purchase orders', suppliers: 'Supplier performance', reorder: 'Reorder recommendations',
};
const reportTypes = Object.keys(reportLabels) as ReportName[];
const fields: Record<ReportName, string[]> = {
  sales: ['period', 'shipments', 'units', 'revenue'],
  inventory: ['location_id', 'product_id', 'on_hand', 'reserved', 'available', 'inventory_value', 'low_stock_threshold'],
  movements: ['id', 'balance__location_id', 'balance__product_id', 'kind', 'on_hand_delta', 'reserved_delta', 'on_hand_after', 'reserved_after', 'reference', 'note', 'created_at'],
  products: ['sku', 'name', 'stock', 'units', 'revenue'],
  'low-stock': ['location_id', 'product_id', 'on_hand', 'reserved', 'available', 'low_stock_threshold'],
  'purchase-orders': ['id', 'supplier_id', 'location_id', 'expected_date', 'status', 'created_at', 'received_at'],
  suppliers: ['supplier_id', 'supplier__name', 'orders', 'completed', 'cancelled', 'on_time', 'currently_overdue'],
  reorder: ['rule', 'location', 'product', 'supplier', 'status', 'demand_window_days', 'lead_time_days', 'units_sold', 'average_daily_sales', 'safety_stock', 'reorder_point', 'available', 'inbound', 'suggested_reorder_quantity', 'slow_moving'],
};
const label = (key: string) => key.replace('balance__', '').replaceAll(/_+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
const columns = (keys: string[]): Column[] => keys.map((key) => ({ key, label: label(key), status: key === 'status' || key === 'kind' }));
const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));

function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="panel chart-panel"><div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><BarChart3 size={17} /></div>{children}</section>;
}
function SalesChart({ rows }: { rows: DataRow[] }) {
  if (!rows.length) return <Empty title="No sales in this period" detail="Sales appear after an order ships." />;
  const data = rows.map((row) => ({ ...row, revenue: Number(row.revenue), label: shortDate(String(row.period)) }));
  return <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
    <defs><linearGradient id="sales-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4268ff" stopOpacity={0.25} /><stop offset="100%" stopColor="#4268ff" stopOpacity={0.03} /></linearGradient></defs>
    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--line)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} /><YAxis axisLine={false} tickLine={false} /><Tooltip />
    <Area name="Revenue" type="monotone" dataKey="revenue" stroke="#365df5" strokeWidth={2.5} fill="url(#sales-gradient)" isAnimationActive={false} dot={data.length === 1} />
  </AreaChart></ResponsiveContainer></div>;
}
const cards = [
  { key: 'total_products', title: 'Total products', icon: Package, tone: 'blue', link: '/manage/products' },
  { key: 'total_inventory_quantity', title: 'On-hand units', icon: Boxes, tone: 'teal', link: '/manage/inventory' },
  { key: 'sales_revenue', title: 'Sales revenue', icon: CircleDollarSign, tone: 'violet', link: '/manage/reports?report=sales' },
  { key: 'low_stock_products', title: 'Low-stock products', icon: PackageMinus, tone: 'orange', link: '/manage/reports?report=low-stock' },
  { key: 'active_stores', title: 'Active stores', icon: Store, tone: 'blue', link: '/manage/locations?kind=store' },
  { key: 'active_warehouses', title: 'Active warehouses', icon: Warehouse, tone: 'teal', link: '/manage/locations?kind=warehouse' },
  { key: 'pending_orders', title: 'Orders in progress', icon: ClipboardList, tone: 'violet', link: '/manage/orders' },
  { key: 'out_of_stock_products', title: 'Out of stock', icon: Activity, tone: 'orange', link: '/manage/inventory' },
] as const;
export function Dashboard() {
  const [location, setLocation] = useState('');
  const params: Params = { location: location || undefined };
  const overview = useQuery({ queryKey: ['dashboard', params], queryFn: ({ signal }) => analyticsApi.dashboard(params, signal) });
  const sales = useQuery({ queryKey: ['report', 'sales', params], queryFn: ({ signal }) => analyticsApi.report('sales', { ...params, group: 'week' }, signal) });
  const orders = useQuery({ queryKey: ['recent', 'orders', params], queryFn: ({ signal }) => ordersApi.list({ ...params, ordering: '-created_at' }, signal) });
  const low = useQuery({ queryKey: ['dashboard', 'low-stock', params], queryFn: ({ signal }) => analyticsApi.report('low-stock', params, signal) });
  const reorder = useQuery({ queryKey: ['dashboard', 'reorder', params], queryFn: ({ signal }) => analyticsApi.report('reorder', params, signal) });
  const moves = useQuery({ queryKey: ['dashboard', 'movement', params], queryFn: ({ signal }) => list('stock-movements', { balance__location: location || undefined, ordering: '-created_at' }, signal) });
  const locations = useQuery({ queryKey: ['dashboard', 'locations'], queryFn: ({ signal }) =>
    list('locations', { active: true }, signal) });
  const cardsData = overview.data;
  const status = cardsData ? [
    { name: 'In progress', value: cardsData.pending_orders },
    { name: 'Delivered', value: cardsData.completed_orders },
    { name: 'Cancelled', value: cardsData.total_orders - cardsData.pending_orders - cardsData.completed_orders },
  ].filter((entry) => entry.value > 0) : [];
  return <>
    <Header title="Dashboard" description="Inventory, sales and fulfillment across your locations." actions={<div className="dashboard-filter"><Lookup config={{ resource: 'locations' }} label="All locations" value={location} onChange={setLocation} /></div>} />
    <div className="dashboard-meta"><span><span className="period-indicator" /> Last 30 days</span><button className="button small" onClick={() => void overview.refetch()}>Refresh overview</button></div>
    {overview.isPending && <Loading label="Loading dashboard metrics" />}
    {overview.isError && <Issue error={overview.error} retry={() => void overview.refetch()} />}
    {cardsData && <><div className="metrics">{cards.map(({ key, title, icon: Icon, tone, link }) => <Link to={link} className="panel metric" key={key}>
      <div><span className={'metric-icon ' + tone}><Icon size={19} /></span><ArrowRight size={15} className="metric-arrow" /></div>
      <span>{title}</span><strong>{format(cardsData[key])}</strong>
    </Link>)}</div><div className="inline-summary dashboard-summary">
      <div><span>Inventory value</span><strong>{format(cardsData.total_inventory_value)}</strong></div>
      <div><span>Total orders</span><strong>{format(cardsData.total_orders)}</strong></div>
      <div><span>Inventory turnover</span><strong>{cardsData.inventory_turnover ?? '—'}</strong></div>
    </div></>}
    <div className="charts-grid">
      <ChartPanel title="Sales trends" subtitle="Weekly shipped revenue">{sales.isPending ? <Loading /> : sales.isError ? <Issue error={sales.error} retry={() => void sales.refetch()} /> : <SalesChart rows={sales.data?.results || []} />}</ChartPanel>
      <ChartPanel title="Order status" subtitle="Orders created in the selected period">
        {overview.isPending ? <Loading /> : overview.isError ? <Issue error={overview.error} /> : status.length ? <>
          <div className="chart donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={status} dataKey="value" nameKey="name" innerRadius="63%" outerRadius="92%" paddingAngle={3} isAnimationActive={false}>{status.map((entry, index) => <Cell key={entry.name} fill={colors[index]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
          <div className="chart-legend">{status.map((entry, index) => <span key={entry.name}><i style={{ background: colors[index] }} />{entry.name} <b>{entry.value}</b></span>)}</div>
        </> : <Empty title="No orders in this period" />}
      </ChartPanel>
    </div>
    <div className="quick-links"><Link to="/manage/movements"><Plus size={17} /> Record stock movement</Link><Link to="/manage/transfers"><ArrowRightLeft size={17} /> Transfer stock</Link><Link to="/manage/scanning"><ScanLine size={17} /> Scan a product</Link></div>
    <div className="dashboard-tables">
      <OverviewTable title="Recent orders" to="/manage/orders" query={orders} cols={configs.orders.columns.filter((column) => ['id', 'status', 'total'].includes(column.key))} rowLink={(row) => '/manage/orders/' + row.id} />
      <OverviewTable title="Low-stock alerts" to="/manage/reports?report=low-stock" query={low} cols={columns(['product_id', 'location_id', 'available'])} />
      <OverviewTable title="Recent stock movements" to="/manage/movements" query={moves} cols={columns(['id', 'kind', 'on_hand_delta'])} rowLink={(row) => '/manage/movements/' + row.id} />
      <OverviewTable title="Reorder recommendations" to="/manage/reports?report=reorder" query={reorder} cols={columns(['product', 'status', 'suggested_reorder_quantity'])} />
    </div>
    <div className="charts-grid">
      <ChartPanel title="Top-selling products" subtitle="Units shipped">
        <BarSeries data={cardsData?.top_selling || []} axis="name" value="units" color={colors[0]} />
      </ChartPanel>
      <ChartPanel title="Stock movement trends" subtitle="Net units by day">
        <BarSeries data={movementTotals(cardsData)} axis="label" value="units" color={colors[1]} />
      </ChartPanel>
    </div>
    <ChartPanel title="Inventory distribution" subtitle="Current on-hand units for locations on this page"><Distribution locations={locations.data?.results.filter((row) => !location || String(row.id) === location) || []} /></ChartPanel>
  </>;
}
function movementTotals(data?: DashboardData) {
  const grouped = new Map<string, number>();
  data?.movement_trends.forEach((row) => grouped.set(row.period, (grouped.get(row.period) || 0) + row.net_units));
  return Array.from(grouped, ([period, units]) => ({ label: shortDate(period), units }));
}
function Distribution({ locations }: { locations: DataRow[] }) {
  const ids = locations.map((item) => Number(item.id));
  const query = useQuery({
    queryKey: ['inventory', 'distribution', ids], enabled: Boolean(ids.length),
    queryFn: async ({ signal }) => Promise.all(locations.map(async (location) => ({ name: String(location.name), units: (await inventoryApi.totals({ location: Number(location.id) }, signal)).on_hand }))),
  });
  if (query.isError) return <Issue error={query.error} />;
  if (ids.length && query.isPending) return <Loading />;
  return <BarSeries data={query.data || []} axis="name" value="units" color={colors[1]} />;
}
function BarSeries({ data, axis, value, color }: { data: DataRow[]; axis: string; value: string; color: string }) {
  if (!data.length) return <Empty title="No data to chart" />;
  return <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--line)" /><XAxis dataKey={axis} tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip />
    <Bar dataKey={value} name="Units" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
  </BarChart></ResponsiveContainer></div>;
}
function OverviewTable({ title, to, query, cols, rowLink }: {
  title: string; to: string; query: { isPending: boolean; isError: boolean; error: unknown; data?: { results: object[] } }; cols: Column[]; rowLink?: (row: DataRow) => string;
}) {
  return <section className="panel data-panel"><div className="section-heading"><h2>{title}</h2><Link to={to}>View all <ArrowRight size={14} /></Link></div>
    {query.isPending ? <Loading /> : query.isError ? <Issue error={query.error} /> : <Rows rows={(query.data?.results || []).slice(0, 5).map((row) => ({ ...row }))} columns={cols} link={rowLink} />}
  </section>;
}

export function Reports({ analytics = false }: { analytics?: boolean }) {
  const [url, setUrl] = useSearchParams();
  const selected = url.get('report') as ReportName;
  const report = reportTypes.includes(selected) ? selected : 'sales';
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [group, setGroup] = useState('day');
  const [applied, setApplied] = useState<Params>({});
  const [validation, setValidation] = useState('');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const data = useQuery({ queryKey: ['report', report, page, applied], queryFn: ({ signal }) => analyticsApi.report(report, { ...applied, page }, signal) });
  function update(key: string, value: string) {
    const next = new URLSearchParams(url);
    next.set(key, value);
    if (key !== 'page') next.delete('page');
    setUrl(next);
  }
  return <>
    <Header title={analytics ? 'Analytics' : 'Reports'} description={analytics ? 'Explore sales, product performance and replenishment.' : 'Filter and export operational reports.'} actions={<button className="button" disabled={busy || data.isError} onClick={async () => {
      setBusy(true);
      try { await analyticsApi.download(report, applied); toast.success('CSV downloaded'); }
      catch (error) { toast.error(errorMessage(error)); }
      finally { setBusy(false); }
    }}><ArrowDownToLine size={16} /> {busy ? 'Downloading…' : 'Export CSV'}</button>} />
    <div className="report-tabs" aria-label="Available reports">{reportTypes.map((item) => <button className={item === report ? 'selected' : ''} key={item} onClick={() => update('report', item)}>{reportLabels[item]}</button>)}</div>
    <form className="toolbar panel" onSubmit={(event) => {
      event.preventDefault();
      if (start && end && (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365)) { setValidation('Choose an ordered date range of at most 366 days.'); return; }
      setValidation('');
      setApplied({ location: location || undefined, start: start || undefined, end: end || undefined, group });
      update('page', '1');
    }}>
      <label className="filter-field">Location<Lookup config={{ resource: 'locations' }} label="Location" value={location} onChange={setLocation} /></label>
      <label className="filter-field">Start date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label className="filter-field">End date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      {report === 'sales' && <label className="filter-field">Group by<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>}
      <button className="button primary">Apply filters</button>
      {validation && <div role="alert" className="field-error">{validation}</div>}
    </form>
    {report === 'reorder' && <p className="report-note">Recommendations use observed sales, lead time and safety stock. Rules with a short observation history show insufficient data.</p>}
    {data.isPending && <Loading />}
    {data.isError && <Issue error={data.error} retry={() => void data.refetch()} />}
    {data.data && <>
      {analytics && report === 'sales' && <ChartPanel title="Shipped sales"><SalesChart rows={data.data.results} /></ChartPanel>}
      <section className="panel data-panel"><div className="section-heading"><h2>{reportLabels[report]}</h2></div>
        <Rows rows={data.data.results} columns={columns(fields[report])} />
        <Pager data={data.data} page={page} setPage={(value) => update('page', String(value))} />
      </section>
    </>}
  </>;
}
export function Alerts() {
  const stock = useQuery({ queryKey: ['alerts', 'stock'], queryFn: ({ signal }) => inventoryApi.lowStock(signal) });
  const deliveries = useQuery({ queryKey: ['alerts', 'deliveries'], queryFn: ({ signal }) => purchasingApi.alerts(signal) });
  return <><Header title="Alerts" description="Review low-stock items and overdue deliveries." />
    <div className="dashboard-tables">
      <OverviewTable title="Low stock" to="/manage/reports?report=low-stock" query={stock} cols={columns(['product', 'location', 'available'])} />
      <OverviewTable title="Overdue deliveries" to="/manage/purchases" query={deliveries} cols={columns(['id', 'supplier', 'expected_date'])} rowLink={(row) => '/manage/purchases/' + row.id} />
    </div>
  </>;
}
