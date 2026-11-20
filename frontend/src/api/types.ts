export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }
export type Role = 'admin' | 'manager' | 'customer';
export interface Profile { id: number; username: string; first_name: string; last_name: string; email: string; role: Role }
export interface User extends Profile { is_active: boolean }
export interface Tokens { access: string; refresh: string }
export interface Location { id: number; code: string; name: string; kind: 'store' | 'warehouse'; address: string; active: boolean }
export interface Category { id: number; name: string; description: string }
export interface ProductImage { id: number; url: string; alt_text: string }
export interface Product { id: number; category: number; sku: string; name: string; description: string; barcode: string | null; purchase_price?: string; selling_price: string; active: boolean; images: ProductImage[] }
export interface Balance { id: number; location: number; product: number; on_hand: number; reserved: number; available: number; low_stock_threshold: number }
export interface Line { product: number; quantity: number }
export interface OrderLine extends Line { shipped: number; returned: number; unit_price: string }
export interface Shipment { id: number; tracking_number: string; shipped_at: string; items: Line[] }
export interface StockReturn { id: number; reason: string; created_at: string; items: Line[] }
export interface Order { id: number; customer: number; location: number; status: string; total: string; created_at: string; confirmed_at: string | null; picking_at: string | null; packed_at: string | null; shipped_at: string | null; delivered_at: string | null; cancelled_at: string | null; items: OrderLine[]; shipments: Shipment[]; returns: StockReturn[] }
export interface PurchaseLine extends Line { received: number; unit_cost: string }
export interface Purchase { id: number; location: number; supplier: number; expected_date: string; created_at: string; status: string; items: PurchaseLine[]; receipts: { id: number; created_at: string; actor: number; items: Line[] }[] }
export interface Supplier { id: number; name: string; contact_name: string; email: string; phone: string; address: string; active: boolean }
export interface Offer { id: number; supplier: number; product: number; unit_cost: string; lead_time_days: number }
export interface Dashboard {
  total_products: number; active_stores: number; active_warehouses: number; total_inventory_quantity: number;
  total_inventory_value: string; low_stock_products: number; out_of_stock_products: number; total_orders: number;
  pending_orders: number; completed_orders: number; sales_revenue: string; inventory_turnover: string | null;
  top_selling: { id: number; name: string; units: number; revenue: string }[];
  slow_moving: { id: number; name: string; units: number; stock: number }[];
  movement_trends: { period: string; kind: string; events: number; net_units: number }[];
}
export type Params = Record<string, string | number | boolean | undefined>;
export type DataRow = Record<string, unknown>;
export type ReportName = 'sales' | 'inventory' | 'movements' | 'products' | 'low-stock' | 'purchase-orders' | 'suppliers' | 'reorder';
