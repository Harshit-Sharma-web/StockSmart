import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Plus, ScanLine, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'sonner';
import { api } from '../api/client';
import { detail, inventoryApi, ordersApi, purchasingApi, scanningApi, write } from '../api/services';
import type { Balance, DataRow, Line, Order, Product, Purchase } from '../api/types';
import { Confirm, Form, Lookup, lookup, number, select, type Field } from '../components/forms';
import { Facts, ResourceIndex, Rows } from '../components/resource';
import { Badge, Empty, Header, Issue, Loading, Modal, format } from '../components/ui';
import { useAuth } from './auth';
import { activeLocation, configs } from './configs';

export const linesSchema = z.array(z.object({
  product: z.number().int().positive(),
  quantity: z.number().int().min(1).max(1_000_000),
})).min(1).max(100).refine((lines) => new Set(lines.map((line) => line.product)).size === lines.length, 'Select each product only once.');

export function useClientKey() {
  const current = useRef<{ signature: string; key: string } | undefined>(undefined);
  return (data: unknown) => {
    const signature = JSON.stringify(data);
    if (signature !== current.current?.signature) current.current = { signature, key: crypto.randomUUID() };
    return current.current!.key;
  };
}
const activeProducts = { resource: 'products', params: { active: true } };
const blank = { product: 0, quantity: 1 };
export function Lines({ lines, change, fixed, supplier }: {
  lines: Line[]; change: (lines: Line[]) => void; fixed?: { product: number; label: string; remaining: number }[]; supplier?: number;
}) {
  const config = supplier ? { resource: 'supplier-products', params: { supplier }, show: 'product', valueKey: 'product' } : activeProducts;
  return <div className="line-editor">
    <div className="field-title">Line items</div>
    {lines.map((line, index) => {
      function update(next: Partial<Line>) { change(lines.map((value, position) => position === index ? { ...value, ...next } : value)); }
      const max = fixed?.find((choice) => choice.product === line.product)?.remaining ?? 1_000_000;
      return <div className="line-input" key={index}>
        {fixed ? <select aria-label={'Product ' + (index + 1)} value={line.product || ''} onChange={(event) => update({ product: Number(event.target.value) })}>
          <option value="">Select product</option>{fixed.map((choice) => <option key={choice.product} value={choice.product}>{choice.label} · {choice.remaining} eligible</option>)}
        </select> : <Lookup key={supplier || 'catalog'} config={config} label={'Product ' + (index + 1)} value={line.product || ''} onChange={(value) => update({ product: Number(value) })} />}
        <input type="number" min={1} max={max} aria-label={'Quantity ' + (index + 1)} value={Number.isNaN(line.quantity) ? '' : line.quantity} onChange={(event) => update({ quantity: event.target.valueAsNumber })} />
        <button className="button icon" type="button" disabled={lines.length === 1} aria-label={'Remove line ' + (index + 1)} onClick={() => change(lines.filter((_, position) => index !== position))}><Trash2 size={16} /></button>
      </div>;
    })}
    <button type="button" className="button small" disabled={lines.length >= (fixed?.length || 100)} onClick={() => change([...lines, { ...blank }])}><Plus size={15} /> Add line</button>
  </div>;
}
function validatedLines(lines: Line[], fixed?: { product: number; remaining: number }[]) {
  const check = linesSchema.safeParse(lines);
  if (!check.success) throw new Error(check.error.issues.some((issue) => issue.code === 'custom') ? 'Select each product only once.' : 'Choose a product and enter a positive whole quantity for each line.');
  if (fixed && check.data.some((line) => line.quantity > (fixed.find((option) => option.product === line.product)?.remaining || 0))) throw new Error('One or more quantities exceed the eligible amount.');
  return check.data;
}
const itemColumns = [{ key: 'product', label: 'Product ID' }, { key: 'quantity', label: 'Quantity' }];
const typeOptions = ['opening', 'receipt', 'adjustment', 'damage', 'loss'];
export function MovementForm({ close, initial }: { close: () => void; initial?: DataRow }) {
  return <Modal title="Record stock movement" onClose={close}><Form
    fields={[activeLocation(), lookup('product', 'Product', 'products', { active: true }), select('kind', 'Movement type', typeOptions, 'receipt'), number('quantity', 'Signed quantity', -1_000_000),
      { name: 'note', label: 'Reason / note', kind: 'textarea', maxLength: 250, hint: 'Required for adjustments, damage and loss.' },
      { ...number('scan', 'Scan event ID', 1, Number.MAX_SAFE_INTEGER), required: false }]}
    initial={initial} submit="Record movement" done={close} save={(data) => {
      const quantity = Number(data.quantity);
      if (!quantity) throw new Error('Quantity must be nonzero.');
      if (['opening', 'receipt'].includes(String(data.kind)) && quantity < 0) throw new Error('Opening stock and receipts require a positive quantity.');
      if (['damage', 'loss'].includes(String(data.kind)) && quantity > 0) throw new Error('Damage and loss require a negative quantity.');
      if (['adjustment', 'damage', 'loss'].includes(String(data.kind)) && !data.note) throw new Error('Enter a reason for this stock change.');
      return write('post', 'stock-movements/', data);
    }} /></Modal>;
}
export function Inventory({ movements = false }: { movements?: boolean }) {
  const [modal, setModal] = useState(false);
  const totals = useQuery({ queryKey: ['inventory', 'totals'], queryFn: ({ signal }) => inventoryApi.totals(undefined, signal), enabled: !movements });
  return <><ResourceIndex config={movements ? configs.movements : configs.balances} action={<button className="button primary" onClick={() => setModal(true)}><Plus size={17} /> Record movement</button>}
    extra={!movements && <div className="inline-summary">{totals.data && <>{Object.entries(totals.data).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{format(value)}</strong></div>)}</>}
      <Link className="button" to="/manage/reports?report=low-stock">Low-stock report</Link>
    </div>} />{modal && <MovementForm close={() => setModal(false)} />}</>;
}
export function BalanceDetail({ id }: { id: number }) {
  const [modal, setModal] = useState<'threshold' | 'movement'>();
  const query = useQuery({ queryKey: ['inventory', id], queryFn: ({ signal }) => detail<Balance>('inventory', id, signal) });
  return <><Link className="back-link" to="/manage/inventory">← Inventory</Link><Header title={'Stock balance #' + id} actions={query.data && <>
    <button className="button" onClick={() => setModal('threshold')}>Set threshold</button><button className="button primary" onClick={() => setModal('movement')}>Record movement</button>
  </>} />
    <Fetch query={query}>{(row) => <><section className="panel detail-panel"><Facts row={{ ...row }} columns={configs.balances.columns} /></section>
      <Link className="button" to={'/manage/movements?balance__location=' + row.location + '&balance__product=' + row.product}>View movement history</Link>
      {modal === 'threshold' && <Modal title="Set low-stock threshold" onClose={() => setModal(undefined)}><Form fields={[number('low_stock_threshold', 'Low-stock threshold')]} initial={{ ...row }} save={(data) => write('patch', 'inventory/' + id + '/threshold/', data)} done={() => setModal(undefined)} /></Modal>}
      {modal === 'movement' && <MovementForm initial={{ ...row }} close={() => setModal(undefined)} />}
    </>}</Fetch>
  </>;
}
interface Transfer { id: number; source: number; destination: number; status: string; created_at: string; completed_at: string | null; items: Line[] }
export function Transfers() {
  const [open, setOpen] = useState(false);
  const [lines, change] = useState<Line[]>([{ ...blank }]);
  return <>
    <ResourceIndex config={configs.transfers} action={<button className="button primary" onClick={() => { change([{ ...blank }]); setOpen(true); }}><ArrowRightLeft size={17} /> New transfer</button>} />
    {open && <Modal title="New stock transfer" onClose={() => setOpen(false)}><Form fields={[activeLocation('source', 'Source location'), activeLocation('destination', 'Destination location')]}
      submit="Create transfer" done={() => setOpen(false)} save={(data) => {
        if (data.source === data.destination) throw new Error('Select different source and destination locations.');
        return write('post', 'stock-transfers/', { ...data, items: validatedLines(lines) });
      }}><Lines lines={lines} change={change} /></Form></Modal>}
  </>;
}
export function TransferDetail({ id }: { id: number }) {
  const query = useQuery({ queryKey: ['stock-transfers', id], queryFn: ({ signal }) => detail<Transfer>('stock-transfers', id, signal) });
  const [action, setAction] = useState<'complete' | 'cancel'>();
  return <><Link className="back-link" to="/manage/transfers">← Stock transfers</Link>
    <Header title={'Transfer #' + id} actions={query.data?.status === 'pending' && <>
      <button className="button" onClick={() => setAction('cancel')}>Cancel transfer</button><button className="button primary" onClick={() => setAction('complete')}>Complete transfer</button>
    </>} /><Fetch query={query}>{(row) => <>
      <section className="panel detail-panel"><Facts row={{ ...row }} columns={configs.transfers.columns} /></section>
      <section className="panel data-panel"><Rows rows={row.items.map((line) => ({ ...line }))} columns={itemColumns} /></section>
    </>}</Fetch>
    {action && <Confirm title={action === 'complete' ? 'Complete transfer' : 'Cancel transfer'} detail={action === 'complete' ? 'Django will move the stock between these locations in one transaction.' : 'Cancel this pending stock transfer?'} confirm={() => write('post', 'stock-transfers/' + id + '/' + action + '/')} close={() => setAction(undefined)} />}
  </>;
}
export function Fetch<T>({ query, children }: { query: { data?: T; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <Issue error={query.error} retry={() => void query.refetch()} />;
  return query.data ? <>{children(query.data)}</> : <Empty />;
}
const nextOrder: Record<string, string> = { pending: 'confirmed', confirmed: 'picking', picking: 'packed', shipped: 'delivered' };
const transitionText: Record<string, string> = { confirmed: 'Confirm order', picking: 'Start picking', packed: 'Mark packed', delivered: 'Confirm delivery' };
export function OrderDetail({ id, storefront = false }: { id: number; storefront?: boolean }) {
  const query = useQuery({ queryKey: ['orders', id], queryFn: ({ signal }) => ordersApi.detail(id, signal) });
  return <><Link className="back-link" to={storefront ? '/shop/orders' : '/manage/orders'}>← {storefront ? 'My orders' : 'Orders'}</Link>
    <Fetch query={query}>{(order) => <OrderView key={id} order={order} storefront={storefront} />}</Fetch>
  </>;
}
function OrderView({ order, storefront }: { order: Order; storefront: boolean }) {
  const [modal, setModal] = useState<'cancel' | 'status' | 'ship' | 'receive-return'>();
  const base = 'orders/' + order.id + '/';
  const close = () => setModal(undefined);
  const next = nextOrder[order.status];
  const canCancel = (storefront ? ['pending', 'confirmed'] : ['pending', 'confirmed', 'picking', 'packed']).includes(order.status);
  return <>
    <Header title={'Order #' + order.id} description={'Placed ' + format(order.created_at)} actions={<>
      {canCancel && <button className="button" onClick={() => setModal('cancel')}>Cancel order</button>}
      {!storefront && next && <button className="button primary" onClick={() => setModal('status')}>{transitionText[next]}</button>}
      {!storefront && ['packed', 'partial'].includes(order.status) && <button className="button primary" onClick={() => setModal('ship')}>Ship items</button>}
      {!storefront && ['partial', 'shipped', 'delivered'].includes(order.status) && order.items.some((line) => line.shipped > line.returned) && <button className="button" onClick={() => setModal('receive-return')}>Receive inspected return</button>}
    </>} />
    <section className="panel detail-panel"><Facts row={{ ...order }} columns={configs.orders.columns} />
      <Facts row={{ ...order }} columns={['confirmed_at', 'picking_at', 'packed_at', 'shipped_at', 'delivered_at', 'cancelled_at'].filter((key) => ({ ...order } as DataRow)[key]).map((key) => ({ key, label: key.replace('_at', '').replace(/^./, (char) => char.toUpperCase()) }))} />
    </section>
    <section className="panel data-panel"><div className="section-heading"><h2>Order items</h2></div><Rows rows={order.items.map((line) => ({ ...line }))} columns={[...itemColumns, { key: 'unit_price', label: 'Unit price' }, { key: 'shipped', label: 'Shipped' }, { key: 'returned', label: 'Returned' }]} /></section>
    {order.shipments.length > 0 && <section className="panel detail-panel"><h2>Shipments</h2>{order.shipments.map((shipment) => <div key={shipment.id} className="record-block">
      <strong>Shipment #{shipment.id} · {shipment.tracking_number || 'No tracking number'}</strong><small>{format(shipment.shipped_at)}</small><Rows rows={shipment.items.map((line) => ({ ...line }))} columns={itemColumns} />
    </div>)}</section>}
    {order.returns.length > 0 && <section className="panel detail-panel"><h2>Inspected returns</h2>{order.returns.map((item) => <div className="record-block" key={item.id}><strong>{item.reason}</strong><small>{format(item.created_at)}</small><Rows rows={item.items.map((line) => ({ ...line }))} columns={itemColumns} /></div>)}</section>}
    {(modal === 'cancel' || modal === 'status') && <Confirm title={modal === 'cancel' ? 'Cancel order' : transitionText[next]} detail={modal === 'cancel' ? 'Cancel this order and release its reserved inventory?' : 'Apply this fulfillment status to the order?'} confirm={() => modal === 'status' ? write('post', base + 'status/', { status: next }) : write('post', base + 'cancel/')} close={close} />}
    {(modal === 'ship' || modal === 'receive-return') && <Fulfillment order={order} action={modal} close={close} />}
  </>;
}
function Fulfillment({ order, action, close }: { order: Order; action: 'ship' | 'receive-return'; close: () => void }) {
  const shipment = action === 'ship';
  const [partial, setPartial] = useState(!shipment);
  const [lines, change] = useState<Line[]>([{ ...blank }]);
  const requestKey = useClientKey();
  const fixed = order.items.map((line) => ({ product: line.product, label: 'Product #' + line.product, remaining: shipment ? line.quantity - line.shipped : line.shipped - line.returned })).filter((line) => line.remaining > 0);
  return <Modal title={shipment ? 'Ship order items' : 'Receive an inspected return'} onClose={close}>
    {!shipment && <p>Only record inspected, sellable units. This action restores the returned quantity to inventory.</p>}
    <Form fields={shipment ? [{ name: 'tracking_number', label: 'Tracking number', maxLength: 120 }] : [{ name: 'reason', label: 'Inspection reason', kind: 'textarea', required: true, maxLength: 250 }]}
      submit={shipment ? 'Confirm shipment' : 'Receive return'} done={close} save={(data) => {
        const payload = { ...data, ...(partial ? { items: validatedLines(lines, fixed) } : {}) };
        return write('post', 'orders/' + order.id + '/' + action + '/', { ...payload, client_key: requestKey(payload) });
      }}>
      {shipment && <label className="check-label"><input type="checkbox" checked={partial} onChange={(event) => setPartial(event.target.checked)} /> Ship selected quantities only</label>}
      {partial ? <Lines lines={lines} change={change} fixed={fixed} /> : <p>All remaining quantities will be shipped.</p>}
    </Form>
  </Modal>;
}

export function Purchases() {
  const [open, setOpen] = useState(false);
  return <><ResourceIndex config={configs.purchases} action={<button className="button primary" onClick={() => setOpen(true)}><Plus size={17} /> New purchase order</button>} />
    {open && <PurchaseEditor close={() => setOpen(false)} />}
  </>;
}
function PurchaseEditor({ order, close }: { order?: Purchase; close: () => void }) {
  const [supplier, setSupplier] = useState(order?.supplier || 0);
  const [lines, change] = useState<Line[]>(order?.items.map(({ product, quantity }) => ({ product, quantity })) || [{ ...blank }]);
  return <Modal title={order ? 'Edit draft purchase order' : 'New purchase order'} onClose={close}>
    <Form fields={[...(!order ? [activeLocation()] : []), { name: 'expected_date', label: 'Expected delivery', kind: 'date', required: true }]} initial={order ? { ...order } : undefined} done={close} submit={order ? 'Save draft' : 'Create purchase order'}
      save={(data) => {
        if (!supplier) throw new Error('Select a supplier.');
        return write(order ? 'patch' : 'post', 'purchase-orders/' + (order ? order.id + '/' : ''), { ...data, supplier, items: validatedLines(lines) });
      }}>
      <label>Supplier<Lookup config={{ resource: 'suppliers', params: { active: true } }} value={supplier || ''} label="Supplier" onChange={(value) => { setSupplier(Number(value)); change([{ ...blank }]); }} /></label>
      {supplier > 0 && <Lines lines={lines} change={change} supplier={supplier} />}
    </Form>
  </Modal>;
}
const nextPurchase: Record<string, string> = { draft: 'approved', approved: 'ordered' };
export function PurchaseDetail({ id }: { id: number }) {
  const query = useQuery({ queryKey: ['purchase-orders', id], queryFn: ({ signal }) => purchasingApi.detail(id, signal) });
  const [action, setAction] = useState<'edit' | 'receive' | 'advance' | 'cancel'>();
  return <><Link className="back-link" to="/manage/purchases">← Purchase orders</Link>
    <Fetch query={query}>{(order) => <>
      <Header title={'Purchase order #' + id} description={'Expected delivery ' + order.expected_date} actions={<>
        {order.status === 'draft' && <button className="button" onClick={() => setAction('edit')}>Edit draft</button>}
        {['draft', 'approved', 'ordered', 'partial'].includes(order.status) && <button className="button" onClick={() => setAction('cancel')}>Cancel purchase</button>}
        {nextPurchase[order.status] && <button className="button primary" onClick={() => setAction('advance')}>{order.status === 'draft' ? 'Approve order' : 'Mark ordered'}</button>}
        {['ordered', 'partial'].includes(order.status) && <button className="button primary" onClick={() => setAction('receive')}>Receive goods</button>}
      </>} />
      <section className="panel detail-panel"><Facts row={{ ...order }} columns={configs.purchases.columns} /></section>
      <section className="panel data-panel"><div className="section-heading"><h2>Purchase lines</h2></div><Rows rows={order.items.map((line) => ({ ...line, remaining: line.quantity - line.received }))} columns={[...itemColumns, { key: 'unit_cost', label: 'Unit cost' }, { key: 'received', label: 'Received' }, { key: 'remaining', label: 'Remaining' }]} /></section>
      <section className="panel detail-panel"><h2>Goods receipts</h2>{!order.receipts.length && <Empty title="No receipts recorded" />}
        {order.receipts.map((receipt) => <div className="record-block" key={receipt.id}><strong>Receipt #{receipt.id} · {format(receipt.created_at)}</strong><Rows rows={receipt.items.map((line) => ({ ...line }))} columns={itemColumns} /></div>)}
      </section>
      {action === 'edit' && <PurchaseEditor order={order} close={() => setAction(undefined)} />}
      {action === 'receive' && <ReceiveGoods order={order} close={() => setAction(undefined)} />}
      {(action === 'advance' || action === 'cancel') && <Confirm title={action === 'cancel' ? 'Cancel purchase order' : order.status === 'draft' ? 'Approve purchase order' : 'Mark as ordered'} detail="Confirm the change to this purchase order." confirm={() => write('post', 'purchase-orders/' + id + '/status/', { status: action === 'cancel' ? 'cancelled' : nextPurchase[order.status] })} close={() => setAction(undefined)} />}
    </>}</Fetch>
  </>;
}
function ReceiveGoods({ order, close }: { order: Purchase; close: () => void }) {
  const [lines, change] = useState<Line[]>([{ ...blank }]);
  const clientKey = useClientKey();
  const fixed = order.items.filter((line) => line.received < line.quantity).map((line) => ({ product: line.product, label: 'Product #' + line.product, remaining: line.quantity - line.received }));
  return <Modal title="Receive goods" onClose={close}><Form fields={[]} submit="Record receipt" done={close} save={() => {
    const items = validatedLines(lines, fixed);
    return write('post', 'purchase-orders/' + order.id + '/receive/', { items, client_key: clientKey(items) });
  }}><Lines lines={lines} change={change} fixed={fixed} /></Form></Modal>;
}
export function Scanning() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'lookup' | 'barcode' | 'rfid'>();
  const [product, setProduct] = useState<Product>();
  const [scan, setScan] = useState<DataRow>();
  const [scanAttempt, setScanAttempt] = useState(0);
  const clientKey = useClientKey();
  function startScan(kind: 'barcode' | 'rfid') {
    setScanAttempt((attempt) => attempt + 1);
    setModal(kind);
  }
  return <>
    <ResourceIndex config={configs.scans} action={<>{auth.role === 'admin' && <Link className="button" to="/manage/rfid-tags">RFID tags</Link>}
      <button className="button" onClick={() => { setProduct(undefined); setModal('lookup'); }}>Barcode lookup</button>
      <button className="button" onClick={() => startScan('rfid')}>Record RFID</button>
      <button className="button primary" onClick={() => startScan('barcode')}><ScanLine size={17} /> Record barcode</button></>}
      extra={scan && <div className="inline-summary"><p>Scan #{String(scan.id)} recorded for product #{String(scan.product)}.</p><Link className="button" to={'/manage/scanning/' + scan.id}>Open details</Link></div>} />
    {modal === 'lookup' && <Modal title="Barcode lookup" onClose={() => setModal(undefined)}><Form fields={[{ name: 'identifier', label: 'Barcode', required: true, maxLength: 80 }]} submit="Find product" save={async (data) => {
      setProduct(undefined);
      setProduct(await queryClient.fetchQuery({ queryKey: ['barcodes', data.identifier], queryFn: ({ signal }) => scanningApi.barcode(String(data.identifier), signal) }));
    }} />{product && <div className="record-block"><Link to={'/manage/products/' + product.id}>{product.name}</Link><span>{product.sku}</span><Badge value={product.active} /></div>}</Modal>}
    {(modal === 'barcode' || modal === 'rfid') && <Modal title={modal === 'rfid' ? 'Record RFID scan' : 'Record barcode scan'} onClose={() => setModal(undefined)}>
      <Form fields={[activeLocation(), { name: 'identifier', label: modal === 'rfid' ? 'RFID identifier' : 'Barcode', required: true, maxLength: modal === 'rfid' ? 64 : 80 }, ...(modal === 'rfid' ? [{ name: 'simulated', label: 'Simulated input', kind: 'checkbox', initial: true } as Field] : [])]}
        submit="Save scan" done={() => setModal(undefined)} save={async (data) => {
          if (modal === 'rfid' && !/^(?:[a-f0-9]{2}){4,32}$/i.test(String(data.identifier))) throw new Error('Enter 8 to 64 hexadecimal characters in whole bytes.');
          const payload = { ...data, kind: modal };
          const result = await api.post<DataRow>('scans/', { ...payload, client_key: clientKey({ payload, scanAttempt }) });
          if (result.status === 200) toast.info('This scan already exists. Its original record was returned.');
          setScan(result.data);
        }} />
    </Modal>}
  </>;
}
export function ScanDetail({ id }: { id: number }) {
  const query = useQuery({ queryKey: ['scans', id], queryFn: ({ signal }) => detail('scans', id, signal) });
  const [open, setOpen] = useState(false);
  return <><Link className="back-link" to="/manage/scanning">← Barcode & RFID</Link><Header title={'Scan #' + id} actions={query.data && <button className="button primary" onClick={() => setOpen(true)}>Record stock movement</button>} />
    <Fetch query={query}>{(scan) => <><section className="panel detail-panel"><Facts row={scan} columns={configs.scans.columns} /></section>
      {open && <MovementForm initial={{ scan: id, location: scan.location, product: scan.product }} close={() => setOpen(false)} />}
    </>}</Fetch>
  </>;
}


