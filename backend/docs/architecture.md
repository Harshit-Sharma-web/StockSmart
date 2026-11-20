# StockSmart backend architecture

The location model represents both stores and warehouses. Managers receive individual location assignments. Product barcodes live on the product as optional unique identifiers. RFID tags are independent identifiers associated with products. Low-stock and overdue alerts are derived from current balances and purchase state so reads reflect committed actions.

## Entity relationships

```mermaid
erDiagram
    USER ||--o{ LOCATION_ASSIGNMENT : receives
    LOCATION ||--o{ LOCATION_ASSIGNMENT : scopes
    CATEGORY ||--o{ PRODUCT : groups
    PRODUCT ||--o{ PRODUCT_IMAGE : displays
    PRODUCT ||--o{ BALANCE : stocked_as
    LOCATION ||--o{ BALANCE : holds
    BALANCE ||--o{ MOVEMENT : records
    USER ||--o{ MOVEMENT : performs
    LOCATION ||--o{ TRANSFER : sends
    LOCATION ||--o{ TRANSFER : receives
    TRANSFER ||--|{ TRANSFER_ITEM : contains
    PRODUCT ||--o{ TRANSFER_ITEM : moved_as
    USER ||--o{ ORDER : places
    LOCATION ||--o{ ORDER : fulfills
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : sold_as
    ORDER ||--o{ SHIPMENT : splits_into
    SHIPMENT ||--|{ SHIPMENT_ITEM : contains
    ORDER_ITEM ||--o{ SHIPMENT_ITEM : fulfills
    ORDER ||--o{ STOCK_RETURN : accepts
    STOCK_RETURN ||--|{ STOCK_RETURN_ITEM : contains
    ORDER_ITEM ||--o{ STOCK_RETURN_ITEM : returns
    SUPPLIER ||--o{ SUPPLIER_PRODUCT : offers
    PRODUCT ||--o{ SUPPLIER_PRODUCT : sourced_as
    SUPPLIER ||--o{ PURCHASE_ORDER : supplies
    LOCATION ||--o{ PURCHASE_ORDER : receives
    PURCHASE_ORDER ||--|{ PURCHASE_ITEM : contains
    PRODUCT ||--o{ PURCHASE_ITEM : purchased_as
    PURCHASE_ORDER ||--o{ RECEIPT : receives
    RECEIPT ||--|{ RECEIPT_ITEM : contains
    PURCHASE_ITEM ||--o{ RECEIPT_ITEM : settles
    PRODUCT ||--o{ RFID_TAG : identifies
    RFID_TAG o|--o{ SCAN_EVENT : reads
    PRODUCT ||--o{ SCAN_EVENT : identifies
    LOCATION ||--o{ SCAN_EVENT : hosts
    LOCATION ||--o{ REORDER_RULE : configures
    SUPPLIER_PRODUCT ||--o{ REORDER_RULE : supplies
```

## Request and stock flow

```mermaid
flowchart TD
    C[API client or scanner] --> A[DRF authentication and permissions]
    A --> V[Serializer and location validation]
    V --> S[Domain service]
    S --> T[Atomic MySQL transaction]
    T --> L[Lock order or purchase, then locations in ID order]
    L --> I[Validate availability and quantities]
    I --> B[Update balances, movement ledger and business records]
    B --> K[Commit]
    K --> R[Fresh API reads and CSV reports]
    I --> X[Reject and roll back]
    V --> E[Record identifier scan]
    E -. matched scan reference .-> S
```

Location locks serialize stock writers at the same location and protect the creation of the first balance. A balance lock guards ledger updates. Multi-location transfers acquire locks in sorted order and apply both movements before committing. Orders and purchase orders also lock their own workflow rows before transitions to make same-key retries safe. Purchase receipt, shipment and scan keys are unique within their business scope. Checkout locks the customer row to serialize checkout retries for the same customer.

Store managers read only records within assignments. Customer orders are scoped by owner. Managers with explicit Django model permissions can write shared catalog metadata. Purchase costs are omitted from customer catalog responses.
