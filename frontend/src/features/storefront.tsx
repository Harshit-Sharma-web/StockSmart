import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, PackageCheck, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ordersApi, productsApi } from '../api/services';
import type { Product } from '../api/types';
import { Lookup } from '../components/forms';
import { ResourceIndex } from '../components/resource';
import { Empty, Header, Issue, Pager, ProductPhoto } from '../components/ui';
import { configs } from './configs';
import { Fetch, linesSchema, useClientKey } from './workflows';

interface CartItem { product: Product; quantity: number }
interface Cart { items: CartItem[]; add: (product: Product) => void; update: (id: number, quantity: number) => void; clear: () => void }
const CartContext = createContext<Cart | undefined>(undefined);
export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('Cart provider missing');
  return cart;
}
export function CartProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const key = 'stocksmart.cart.' + userId;
  const [items, setItems] = useState<CartItem[]>(() => {
    try { const data = JSON.parse(sessionStorage.getItem(key) || '[]'); return Array.isArray(data) ? data : []; }
    catch { return []; }
  });
  useEffect(() => {
    try { if (items.length) sessionStorage.setItem(key, JSON.stringify(items)); else sessionStorage.removeItem(key); }
    catch { /* Keep the cart available in this tab. */ }
  }, [items, key]);
  return <CartContext.Provider value={{
    items,
    add(product) {
      const existing = items.find((item) => item.product.id === product.id);
      if ((!existing && items.length >= 100) || (existing && existing.quantity >= 1_000_000)) { toast.error('The cart has reached its limit.'); return; }
      setItems((current) => current.some((item) => item.product.id === product.id)
        ? current.map((item) => item.product.id === product.id ? { ...item, product, quantity: Math.min(item.quantity + 1, 1_000_000) } : item)
        : [...current, { product, quantity: 1 }]);
      toast.success(product.name + ' added to cart');
    },
    update(id, quantity) { setItems((current) => quantity === 0 ? current.filter((item) => item.product.id !== id) : current.map((item) => item.product.id === id ? { ...item, quantity } : item)); },
    clear() { setItems([]); },
  }}>{children}</CartContext.Provider>;
}
export function Storefront({ home = false }: { home?: boolean }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [available, setAvailable] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [price, setPrice] = useState({ min: '', max: '' });
  const cart = useCart();
  const query = useQuery({ queryKey: ['products', 'shop', page, search, category, location, available, sort, price], queryFn: ({ signal }) => productsApi.list({
    page, search: search || undefined, category: category || undefined, available: available || (location ? 'true' : undefined), location: location || undefined,
    ordering: sort || undefined, min_price: price.min || undefined, max_price: price.max || undefined,
  }, signal) });
  const locations = { resource: 'locations', params: { active: true, kind: 'store' } };
  return <>
    {home ? <div className="store-hero"><div><h1>Find what’s in store.</h1><p>Browse the catalog and check availability at your preferred store.</p><a className="button primary" href="#catalog">Browse products <ArrowRight size={17} /></a></div><PackageCheck size={190} strokeWidth={0.7} aria-hidden /></div> : <Header title="Product catalog" description="Find products by category, price and availability." />}
    <section id="catalog" className="catalog">
      {home && <h2>Browse products</h2>}
      <form className="toolbar panel shop-filters" onSubmit={(event) => { event.preventDefault(); setSearch(draft.trim()); setPrice({ min, max }); setPage(1); }}>
        <label className="search-box"><Search size={17} /><input aria-label="Search products" placeholder="Search products…" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <label className="filter-field">Category<Lookup label="Category" config={{ resource: 'categories' }} value={category} onChange={(value) => { setCategory(value); setPage(1); }} /></label>
        <label className="filter-field">Store<Lookup label="Store" config={locations} value={location} onChange={(value) => { setLocation(value); setPage(1); }} /></label>
        <label className="filter-field">Availability<select value={available} onChange={(event) => { setAvailable(event.target.value); setPage(1); }}><option value="">{location ? 'In selected store' : 'All products'}</option><option value="true">In stock</option><option value="false">Out of stock</option></select></label>
        <label className="filter-field">Sort by<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="">Default</option><option value="name">Name</option><option value="selling_price">Price: low to high</option><option value="-selling_price">Price: high to low</option><option value="-created_at">Newest</option></select></label>
        <label className="filter-field price-filter">Min price<input type="number" min={0} step="0.01" value={min} onChange={(event) => setMin(event.target.value)} /></label>
        <label className="filter-field price-filter">Max price<input type="number" min={0} step="0.01" value={max} onChange={(event) => setMax(event.target.value)} /></label>
        <button className="button" type="submit">Apply</button>
      </form>
      <Fetch query={query}>{(data) => data.results.length ? <>
        <div className="product-grid">{data.results.map((product) => <article className="panel product-card" key={product.id}>
          <Link to={'/shop/products/' + product.id}><ProductPhoto src={product.images[0]?.url} alt={product.images[0]?.alt_text} /></Link>
          <div><small>{product.sku}</small><h3><Link to={'/shop/products/' + product.id}>{product.name}</Link></h3><p>{product.description || ''}</p>
            <footer><strong>{product.selling_price}</strong><button className="button small" onClick={() => cart.add(product)}><ShoppingBag size={15} /> Add to cart</button></footer>
          </div>
        </article>)}</div>
        <Pager data={data} page={page} setPage={setPage} />
      </> : <Empty title="No products found" detail="Try a different search or change your filters." />}</Fetch>
    </section>
  </>;
}
export function StoreProduct({ id }: { id: number }) {
  const query = useQuery({ queryKey: ['products', id], queryFn: ({ signal }) => productsApi.detail(id, signal) });
  const cart = useCart();
  const [photo, setPhoto] = useState(0);
  return <><Link className="back-link" to="/shop/products">← Product catalog</Link><Fetch query={query}>{(product) => <>
    <div className="panel product-detail">
      <div><ProductPhoto key={photo} src={product.images[photo]?.url} alt={product.images[photo]?.alt_text} />
        {product.images.length > 1 && <div className="photo-thumbnails">{product.images.map((image, index) => <button className="button" key={image.id} aria-pressed={photo === index} onClick={() => setPhoto(index)}>Image {index + 1}</button>)}</div>}
      </div>
      <div><p className="optional">SKU {product.sku}</p><h1>{product.name}</h1><p>{product.description}</p><strong className="price">{product.selling_price}</strong>
        <button className="button primary" onClick={() => cart.add(product)}><ShoppingBag size={17} /> Add to cart</button>
      </div>
    </div>
  </>}</Fetch></>;
}
export function CartPage({ checkout = false }: { checkout?: boolean }) {
  const cart = useCart();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [store, setStore] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const key = useClientKey();
  return <>
    <Header title={checkout ? 'Checkout' : 'Shopping cart'} description={checkout ? 'Choose the store that will fulfill your order.' : 'Review your items before placing your order.'} />
    {!cart.items.length ? <section className="panel"><Empty title="Your cart is empty" detail="Add products from the catalog to continue." /><div className="empty-action"><Link className="button primary" to="/shop/products">Browse products</Link></div></section> : <div className="checkout-layout">
      <section className="panel detail-panel">{cart.items.map(({ product, quantity }) => <div className="cart-line" key={product.id}>
        <ProductPhoto src={product.images[0]?.url} alt={product.images[0]?.alt_text} /><div><Link className="row-link" to={'/shop/products/' + product.id}>{product.name}</Link><small>{product.sku} · {product.selling_price} each</small></div>
        {checkout ? <strong>× {quantity}</strong> : <><input type="number" aria-label={'Quantity for ' + product.name} min={1} max={1_000_000} value={quantity} onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isInteger(value) && value >= 1 && value <= 1_000_000) cart.update(product.id, value);
        }} /><button className="button icon" aria-label={'Remove ' + product.name} onClick={() => cart.update(product.id, 0)}><Trash2 size={17} /></button></>}
      </div>)}</section>
      <section className="panel detail-panel order-summary"><h2>Order summary</h2><div className="summary-row"><span>Items</span><strong>{cart.items.reduce((acc, item) => acc + item.quantity, 0)}</strong></div>
        <p>The order confirmation will show the total calculated using current prices.</p>
        {checkout ? <form onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const lines = linesSchema.safeParse(cart.items.map(({ product, quantity }) => ({ product: product.id, quantity })));
          if (!store || !lines.success) { setError(new Error('Choose a store and check your cart quantities.')); return; }
          const payload = { location: Number(store), items: lines.data };
          setBusy(true);
          setError(undefined);
          try {
            const order = await ordersApi.checkout({ ...payload, client_key: key(payload) });
            cart.clear();
            void cache.invalidateQueries();
            toast.success('Order placed');
            navigate('/shop/orders/' + order.id, { replace: true });
          } catch (failure) { setError(failure); }
          finally { setBusy(false); }
        }}>
          <label>Fulfillment store<Lookup label="Fulfillment store" config={{ resource: 'locations', params: { active: true, kind: 'store' } }} value={store} onChange={setStore} disabled={busy} /></label>
          {Boolean(error) && <Issue error={error} />}
          <button className="button primary" disabled={busy}>{busy ? 'Placing order…' : 'Place order'} <ArrowRight size={16} /></button>
        </form> : <Link className="button primary" to="/shop/checkout">Checkout <ArrowRight size={16} /></Link>}
      </section>
    </div>}
  </>;
}
export function MyOrders() {
  return <ResourceIndex config={{ ...configs.orders, title: 'My orders', route: '/shop/orders', description: 'Track orders, shipments and eligible cancellations.', filters: configs.orders.filters?.filter((filter) => filter.key === 'status') }} />;
}
