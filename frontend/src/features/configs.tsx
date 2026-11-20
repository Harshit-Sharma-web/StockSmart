// Configurations and helper hooks for StockSmart frontend
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { detail, list, write } from '../api/services';
import type { DataRow, Location, Order, OrderLine, Product, ProductImage } from '../api/types';
import { Confirm, Form, lookup, number, options, select, type Field } from '../components/forms';
import { Rows, useMetadata, type Column, type ResourceConfig } from '../components/resource';
import { Badge, Empty, Issue, Loading, Modal, Pager, ProductPhoto } from '../components/ui';
import { Link } from 'react-router-dom';
import { useAuth } from './auth';

const text = (name: string, label: string, maxLength = 150, required = false): Field => ({ name, label, maxLength, required });
const active: Field = { name: 'active', label: 'Active', kind: 'checkbox', initial: true };
const description: Field = { name: 'description', label: 'Description', kind: 'textarea' };
const address: Field = { name: 'address', label: 'Address', kind: 'textarea' };
const money = (name: string, label: string): Field => ({ name, label, kind: 'money', required: true });

export const locationLookup = { resource: 'locations' };
export const activeLocation = (name = 'location', label = 'Location') => lookup(name, label, 'locations', { active: true });
export const productLookup = { resource: 'products' };
export const orderStatuses = ['pending', 'confirmed', 'picking', 'packed', 'partial', 'shipped', 'delivered', 'cancelled'];
export const purchaseStatuses = ['draft', 'approved', 'ordered', 'partial', 'received', 'cancelled'];
const flags = [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }];
const col = (key: string, label: string, sort = false): Column => ({ key, label, sort });
const status = (key = 'status', label = 'Status'): Column => ({ key, label, status: true });

// Helper hook to map location IDs to names
const useLocationMap = () => {
  const { data } = useQuery({ queryKey: ['locations', 'map'], queryFn: () => list<Location>('locations', { active: true }) });
  return useMemo(() => {
    const map: Record<number, string> = {};
    data?.results?.forEach((loc) => { map[loc.id] = loc.name; });
    return map;
  }, [data]);
};

// Helper hook to map product IDs to names
const useProductMap = () => {
  const { data } = useQuery({ queryKey: ['products', 'map'], queryFn: () => list<Product>('products', { active: true }) });
  return useMemo(() => {
    const map: Record<number, string> = {};
    data?.results?.forEach((prod) => { map[prod.id] = prod.name; });
    return map;
  }, [data]);
};

// Cell component for location name
const LocationCell = (row: DataRow) => {
  const map = useLocationMap();
  const locId = Number(row.location);
  return <>{map[locId] ?? locId}</>;
};

// Cell component for product summary
const ProductsCell = (row: DataRow) => {
  const orderId = typeof row.id === 'number' ? row.id : undefined;
  if (!orderId) return null;
  const { data: order } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: () => detail<Order>('orders', orderId),
    enabled: !!orderId,
  });
  const prodMap = useProductMap();
  const items: OrderLine[] = order?.items ?? [];
  const firstTwo = items.slice(0, 2);
  const displayed = firstTwo
    .map((it) => `${it.quantity} × ${prodMap[it.product] ?? 'Product ' + it.product}`)
    .join(', ');
  const more = items.length - firstTwo.length;
  return <>{displayed}{more > 0 && ` +${more} more`}</>;
};

const productFields: Field[] = [
  text('name', 'Product name', 150, true),
  text('sku', 'SKU', 48, true),
  text('category', 'Category', 120, true),
  { ...text('barcode', 'Barcode', 80), nullable: true },
  money('purchase_price', 'Purchase price'),
  money('selling_price', 'Selling price'),
  description,
  active,
];

function ProductPhotos({ row }: { row: DataRow }) {
  const product = Number(row.id);
  const auth = useAuth();
  const canAdd = useMetadata('product-images', auth.role === 'manager', 'POST');
  const [create, setCreate] = useState(false);
  const [remove, setRemove] = useState<number>();
  const [edit, setEdit] = useState<ProductImage>();
  const canEdit = useMetadata('product-images/' + (edit?.id || 0), Boolean(edit && auth.role === 'manager'), 'PUT');
  const fields: Field[] = [{ name: 'url', label: 'Image URL', kind: 'url', required: true, maxLength: 500 }, text('alt_text', 'Alternative text')];
  const images = row.images as ProductImage[] | undefined;
  return (
    <section className="panel detail-panel">
      <div className="section-heading"><h2>Product images</h2>{(auth.role === 'admin' || canAdd) && <button className="button" onClick={() => setCreate(true)}>Add image</button>}</div>
      {!images?.length ? <Empty title="No images yet" detail="Product images are managed by URL." /> : <div className="image-list">{images.map((image) => (
        <div key={image.id}>
          <ProductPhoto src={image.url} alt={image.alt_text} />
          {auth.role === 'admin' && (<>
            <button className="button small" onClick={() => setEdit(image)}>Edit image</button>
            <button className="button small" onClick={() => setRemove(image.id)}>Remove</button>
          </>)}
          {auth.role === 'manager' && (<button className="button small" onClick={() => setEdit(image)}>Image details</button>)}
        </div>
      ))}</div>}
      {create && <Modal title="Add image" onClose={() => setCreate(false)}><Form fields={fields} save={(data) => write('post', 'product-images/', { ...data, product })} done={() => setCreate(false)} /></Modal>}
      {edit && <Modal title="Image details" onClose={() => setEdit(undefined)}>{auth.role === 'admin' || canEdit ? <Form fields={fields} initial={{ ...edit }} save={(data) => write('patch', 'product-images/' + edit.id + '/', data)} done={() => setEdit(undefined)} /> : <ProductPhoto src={edit.url} alt={edit.alt_text} />}</Modal>}
      {remove && <Confirm title="Remove image" detail="Remove this image from the catalog?" confirm={() => write('delete', 'product-images/' + remove + '/')} close={() => setRemove(undefined)} />}
    </section>
  );
}

function SupplierExtras({ row }: { row: DataRow }) {
  const [page, setPage] = useState(1);
  const supplier = Number(row.id);
  const offers = useQuery({ queryKey: ['supplier-products', supplier, page], queryFn: ({ signal }) => list('supplier-products', { supplier, page }, signal) });
  return (
    <section className="panel detail-panel">
      <div className="section-heading"><h2>Supplier products</h2><Link className="button" to={'/manage/supplier-products?supplier=' + supplier}>Manage offers</Link></div>
      {offers.isPending && <Loading />}{offers.isError && <Issue error={offers.error} />}
      {offers.data && <>
        <Rows rows={offers.data.results} columns={[col('product', 'Product'), col('unit_cost', 'Unit cost'), col('lead_time_days', 'Lead time (days)')]} link={(offer) => '/manage/supplier-products/' + offer.id} />
        <Pager data={offers.data} page={page} setPage={setPage} />
      </>}
    </section>
  );
}

const locationFilter = { key: 'location', label: 'Location', lookup: locationLookup };
const productFilter = { key: 'product', label: 'Product', lookup: productLookup };
const statusFilter = (values: string[]) => ({ key: 'status', label: 'Status', options: options(...values) });
const supplierFilter = { key: 'supplier', label: 'Supplier', lookup: { resource: 'suppliers' } };

export const configs: Record<string, ResourceConfig> = {
  products: {
    title: 'Products',
    singular: 'Product',
    route: '/manage/products',
    resource: 'products',
    description: 'Manage your catalog, pricing and product identifiers.',
    search: true,
    fields: productFields,
    deleteLabel: 'Deactivate product',
    writeRole: 'catalog',
    columns: [col('name', 'Product', true), col('sku', 'SKU'), col('category', 'Category ID'), col('selling_price', 'Selling price', true), status('active'), col('created_at', 'Created', true)],
    filters: [{ key: 'category', label: 'Category', lookup: { resource: 'categories' } }, { key: 'active', label: 'Status', options: flags }, { key: 'min_price', label: 'Min price', type: 'number' }, { key: 'max_price', label: 'Max price', type: 'number' }, { key: 'available', label: 'Availability', options: [{ value: 'true', label: 'In stock' }, { value: 'false', label: 'Out of stock' }] }],
    detailExtra: (row) => <ProductPhotos row={row} />,
  },
  categories: {
    title: 'Categories',
    singular: 'Category',
    route: '/manage/categories',
    resource: 'categories',
    description: 'Organize products into groups.',
    search: true,
    fields: [text('name', 'Category name', 120, true), description],
    deleteLabel: 'Delete category',
    writeRole: 'catalog',
    columns: [col('name', 'Category'), col('description', 'Description')],
  },
  locations: {
    title: 'Stores & warehouses',
    singular: 'Location',
    route: '/manage/locations',
    resource: 'locations',
    description: 'View the stores and warehouses in your workspace.',
    search: true,
    fields: [text('name', 'Location name', 150, true), text('code', 'Location code', 32, true), select('kind', 'Type', ['store', 'warehouse']), address, active],
    deleteLabel: 'Deactivate location',
    writeRole: 'admin',
    filters: [{ key: 'kind', label: 'Type', options: options('store', 'warehouse') }, { key: 'active', label: 'Status', options: flags }],
    columns: [col('name', 'Location'), col('code', 'Code'), status('kind', 'Type'), col('address', 'Address'), status('active')],
  },
  assignments: {
    title: 'Location assignments',
    singular: 'Assignment',
    route: '/manage/assignments',
    resource: 'location-assignments',
    description: 'Grant store managers access to individual locations.',
    fields: [lookup('user', 'Store manager', 'users', { role: 'manager', is_active: true }, 'username'), lookup('location', 'Location', 'locations')],
    deleteLabel: 'Remove assignment',
    writeRole: 'admin',
    filters: [locationFilter, { key: 'user', label: 'Manager', lookup: { resource: 'users', params: { role: 'manager' }, show: 'username' } }],
    columns: [col('id', 'Assignment'), col('user', 'User ID'), col('location', 'Location ID')],
  },
  users: {
    title: 'User management',
    singular: 'User',
    route: '/manage/users',
    resource: 'users',
    description: 'Manage account roles and activation.',
    search: true,
    create: false,
    writeRole: 'admin',
    editFields: [text('first_name', 'First name'), text('last_name', 'Last name'), { name: 'email', label: 'Email', kind: 'email' }, select('role', 'Role', ['admin', 'manager', 'customer']), { ...active, name: 'is_active' }],
    filters: [{ key: 'role', label: 'Role', options: options('admin', 'manager', 'customer') }, { key: 'is_active', label: 'Status', options: flags }],
    columns: [col('username', 'Username'), col('email', 'Email'), status('role', 'Role'), status('is_active')],
  },
  suppliers: {
    title: 'Suppliers',
    singular: 'Supplier',
    route: '/manage/suppliers',
    resource: 'suppliers',
    description: 'View supplier contacts, offers, and account status.',
    search: true,
    writeRole: 'admin',
    deleteLabel: 'Deactivate supplier',
    fields: [text('name', 'Supplier name', 150, true), text('contact_name', 'Contact name'), { name: 'email', label: 'Email', kind: 'email' }, text('phone', 'Phone', 50), address, active],
    filters: [{ key: 'active', label: 'Status', options: flags }],
    columns: [col('name', 'Supplier'), col('contact_name', 'Contact'), col('email', 'Email'), col('phone', 'Phone'), status('active')],
    detailExtra: (row) => <SupplierExtras row={row} />, 
  },
  offers: {
    title: 'Supplier products',
    singular: 'Supplier offer',
    route: '/manage/supplier-products',
    resource: 'supplier-products',
    description: 'Associate a supplier with products, costs and lead times.',
    writeRole: 'admin',
    deleteLabel: 'Delete offer',
    fields: [lookup('supplier', 'Supplier', 'suppliers'), lookup('product', 'Product', 'products'), money('unit_cost', 'Unit cost'), number('lead_time_days', 'Lead time (days)', 0, 2147483647)],
    filters: [supplierFilter, productFilter],
    columns: [col('id', 'Offer'), col('supplier', 'Supplier ID'), col('product', 'Product ID'), col('unit_cost', 'Unit cost'), col('lead_time_days', 'Lead time (days)')],
  },
  balances: {
    title: 'Inventory',
    singular: 'Stock balance',
    route: '/manage/inventory',
    resource: 'inventory',
    description: 'Track on-hand, reserved and available stock across locations.',
    filters: [locationFilter, productFilter],
    columns: [col('id', 'Balance', true), col('product', 'Product ID'), col('location', 'Location ID'), col('on_hand', 'On hand', true), col('reserved', 'Reserved', true), col('available', 'Available'), col('low_stock_threshold', 'Low-stock threshold')],
  },
  movements: {
    title: 'Stock movements',
    singular: 'Movement',
    route: '/manage/movements',
    resource: 'stock-movements',
    description: 'Audit stock receipts, adjustments, transfers and order activity.',
    sort: '-created_at',
    filters: [{ ...locationFilter, key: 'balance__location' }, { ...productFilter, key: 'balance__product' }, { key: 'kind', label: 'Type', options: options('opening', 'receipt', 'adjustment', 'damage', 'loss', 'transfer_out', 'transfer_in', 'reserve', 'release', 'ship', 'return') }],
    columns: [col('id', 'Movement', true), status('kind', 'Type'), col('product', 'Product ID'), col('location', 'Location ID'), col('on_hand_delta', 'On-hand Δ'), col('reserved_delta', 'Reserved Δ'), col('created_at', 'Recorded', true)],
    detailExtra: (row) => (
      <div className="panel detail-panel">
        <p>On hand after movement: {String(row.on_hand_after)}</p>
        <p>Reserved after movement: {String(row.reserved_after)}</p>
        <p>Reference: {String(row.reference || '—')}</p>
        <p>Note: {String(row.note || '—')}</p>
      </div>
    ),
  },
  transfers: {
    title: 'Stock transfers',
    singular: 'Transfer',
    route: '/manage/transfers',
    resource: 'stock-transfers',
    description: 'Move available stock between your assigned locations.',
    filters: [{ ...locationFilter, key: 'source', label: 'Source' }, { ...locationFilter, key: 'destination', label: 'Destination' }, statusFilter(['pending', 'completed', 'cancelled'])],
    columns: [col('id', 'Transfer'), col('source', 'Source ID'), col('destination', 'Destination ID'), status(), col('created_at', 'Created'), col('completed_at', 'Completed')],
  },
  orders: {
    title: 'Orders',
    singular: 'Order',
    route: '/manage/orders',
    resource: 'orders',
    description: 'Review orders and manage fulfillment for your locations.',
    sort: '-created_at',
    filters: [locationFilter, statusFilter(orderStatuses)],
    columns: [col('id', 'Order', true), { key: 'products', label: 'Products', render: ProductsCell }, { key: 'location', label: 'Location', render: LocationCell }, status(), col('total', 'Order total', true), col('created_at', 'Placed', true)],
  },
  purchases: {
    title: 'Purchase orders',
    singular: 'Purchase order',
    route: '/manage/purchases',
    resource: 'purchase-orders',
    description: 'Plan replenishment, approve purchases and receive goods.',
    sort: '-created_at',
    filters: [locationFilter, supplierFilter, statusFilter(purchaseStatuses)],
    columns: [col('id', 'Purchase order'), col('supplier', 'Supplier ID'), col('location', 'Location ID'), status(), col('expected_date', 'Expected date', true), col('created_at', 'Created', true)],
  },
  scans: {
    title: 'Barcode & RFID',
    singular: 'Scan',
    route: '/manage/scanning',
    resource: 'scans',
    description: 'Look up barcodes and review recorded identifier scans.',
    sort: '-created_at',
    filters: [locationFilter, productFilter, { key: 'kind', label: 'Type', options: options('barcode', 'rfid') }, { key: 'simulated', label: 'Source', options: [{ value: 'true', label: 'Simulated' }, { value: 'false', label: 'Recorded' }] }],
    columns: [col('identifier', 'Identifier'), status('kind', 'Type'), col('product', 'Product ID'), col('location', 'Location ID'), { key: 'simulated', label: 'Source', render: (row) => <Badge value={row.simulated ? 'simulated' : 'recorded'} /> }, col('created_at', 'Scanned', true)],
  },
  tags: {
    title: 'RFID tags',
    singular: 'RFID tag',
    route: '/manage/rfid-tags',
    resource: 'rfid-tags',
    description: 'Register product identifiers for RFID readers.',
    search: true,
    writeRole: 'admin',
    deleteLabel: 'Deactivate tag',
    fields: [text('identifier', 'Hexadecimal identifier', 64, true), lookup('product', 'Product', 'products', { active: true }), active],
    editFields: [active],
    filters: [productFilter, { key: 'active', label: 'Status', options: flags }],
    columns: [col('identifier', 'Identifier'), col('product', 'Product ID'), status('active'), col('created_at', 'Registered')],
  },
  rules: {
    title: 'Reorder rules',
    singular: 'Reorder rule',
    route: '/manage/reorder-rules',
    resource: 'reorder-rules',
    description: 'Configure safety stock, supplier lead time and demand windows.',
    writeRole: 'operator',
    deleteLabel: 'Delete rule',
    fields: [activeLocation(), lookup('offer', 'Supplier product offer', 'supplier-products', undefined, 'id'), { ...number('safety_stock', 'Safety stock'), initial: 0 }, { ...number('demand_window_days', 'Demand window (days)', 1, 365), initial: 30 }, { ...number('target_stock', 'Target stock'), initial: 0 }, { ...number('lead_time_override_days', 'Lead time override (days)', 0, 32767), required: false, nullable: true }],
    filters: [locationFilter, { key: 'offer', label: 'Supplier offer', lookup: { resource: 'supplier-products', show: 'id' } }],
    columns: [col('id', 'Rule'), col('location', 'Location ID'), col('offer', 'Offer ID'), col('safety_stock', 'Safety stock'), col('target_stock', 'Target stock'), col('demand_window_days', 'Demand window'), col('lead_time_override_days', 'Lead time override')],
  },
};
