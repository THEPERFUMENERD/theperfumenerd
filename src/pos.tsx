import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft, Check, CircleAlert, CreditCard, ExternalLink, Minus, Plus, Printer,
  Search, ShoppingBag, Trash2, UserRound, X,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, functions } from './firebase';
import { getFragranceCategories, getProductType, isPerfumeProduct, money, type Fragrance } from './catalog';

type CartLine = { productId: string; quantity: number };
type HeldSale = { id: string; items: CartLine[]; customerName: string; customerPhone: string; createdAt: number };
type SaleItem = { productId: string; name: string; brand: string; image: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number };
type SaleReceipt = {
  saleId: string;
  receiptNumber: string;
  totalMinor: number;
  amountReceivedMinor: number;
  changeMinor: number;
  items: SaleItem[];
  createdAt: string | null;
};
type CompleteSaleRequest = {
  idempotencyKey: string;
  items: CartLine[];
  amountReceivedMinor: number;
  customer: { name: string; phone: string };
};
type DisplayItem = Pick<SaleItem, 'productId' | 'name' | 'brand' | 'image' | 'quantity' | 'unitPriceMinor' | 'lineTotalMinor'>;
type CustomerDisplayData = {
  displayToken: string;
  active: boolean;
  items: DisplayItem[];
  totalMinor: number;
  updatedAt?: unknown;
};

const HELD_SALES_KEY = 'tpn-pos-held-sales';
const DISPLAY_TOKEN_KEY = 'tpn-pos-display-token';

function formatMinor(amount: number) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function parseMoneyMinor(value: string) {
  const match = /^(?:\d+)(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

function getCashSaleErrorMessage(reason: unknown) {
  const code = typeof reason === 'object' && reason !== null && 'code' in reason
    ? String(reason.code).replace(/^functions\//, '')
    : '';
  const message = reason instanceof Error ? reason.message.trim() : '';

  if (code === 'permission-denied') {
    return 'The secure POS service denied this account. Confirm administrator access and Firebase rules.';
  }
  if (code === 'unauthenticated') {
    return 'Your administrator session has expired. Sign in again before completing this sale.';
  }
  if (code === 'failed-precondition' || code === 'invalid-argument' || code === 'already-exists') {
    return message || 'The sale details could not be validated. Check the cart and cash received.';
  }
  if (code === 'not-found' && message.includes('selected product is no longer available')) {
    return message;
  }
  if (code === 'not-found') {
    return 'The POS cash-sale service was not found in this Firebase project. Deploy the latest Firebase Functions and confirm the storefront uses the same project.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'The POS service could not be reached. Check the connection and Firebase Functions status, then retry.';
  }

  const diagnostic = [code && `(${code})`, message && ` ${message}`].filter(Boolean).join('');
  return `The sale could not be confirmed${diagnostic ? ` ${diagnostic}` : ''}. Your cart remains open; retrying will safely reuse its transaction reference.`;
}

function makeDisplayToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readHeldSales(): HeldSale[] {
  try {
    const stored = sessionStorage.getItem(HELD_SALES_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((sale): sale is HeldSale =>
      typeof sale.id === 'string' && Array.isArray(sale.items)
      && typeof sale.createdAt === 'number') : [];
  } catch {
    return [];
  }
}

export function PosTerminal({ user, isAdmin, onBack }: {
  user: User | null;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const [products, setProducts] = useState<Fragrance[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [heldSales, setHeldSales] = useState<HeldSale[]>(readHeldSales);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [saleError, setSaleError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [displayReady, setDisplayReady] = useState(false);
  const pendingSaleId = useRef<string | null>(null);
  const pendingSaleFingerprint = useRef<string | null>(null);
  const displayToken = useRef('');
  const searchRef = useRef<HTMLInputElement>(null);

  const clearPendingSale = () => {
    pendingSaleId.current = null;
    pendingSaleFingerprint.current = null;
  };

  if (!displayToken.current && typeof window !== 'undefined') {
    const savedToken = sessionStorage.getItem(DISPLAY_TOKEN_KEY);
    displayToken.current = savedToken || makeDisplayToken();
    sessionStorage.setItem(DISPLAY_TOKEN_KEY, displayToken.current);
  }

  useEffect(() => {
    if (!db || !isAdmin) {
      setLoading(false);
      setCatalogError('A secure administrator session is required to load POS inventory.');
      return;
    }
    const liveProducts = query(collection(db, 'products'), where('visible', '==', true));
    return onSnapshot(liveProducts, (snapshot) => {
      setProducts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Fragrance));
      setCatalogError('');
      setLoading(false);
    }, (reason) => {
      console.error('POS inventory subscription failed.', reason);
      const code = typeof reason === 'object' && reason !== null && 'code' in reason
        ? String(reason.code) : '';
      setCatalogError(code.includes('permission-denied')
        ? 'Inventory access was denied. Publish the latest Firestore rules and confirm administrator access.'
        : 'Live products could not be loaded. Check the Firebase connection and Firestore rules.');
      setLoading(false);
    });
  }, [isAdmin]);

  useEffect(() => {
    sessionStorage.setItem(HELD_SALES_KEY, JSON.stringify(heldSales));
  }, [heldSales]);

  useEffect(() => {
    if (!db || !user || !isAdmin || !displayToken.current) return;
    let active = true;
    const reference = doc(db, 'posCustomerDisplays', displayToken.current);
    setDoc(reference, {
      displayToken: displayToken.current,
      active: true,
      items: [],
      totalMinor: 0,
      updatedAt: serverTimestamp(),
    }).then(() => {
      if (active) setDisplayReady(true);
    }).catch((reason: unknown) => {
      console.error('Could not initialize the POS customer display.', reason);
      if (active) {
        const code = typeof reason === 'object' && reason !== null && 'code' in reason
          ? String(reason.code) : '';
        setSaleError(code.includes('permission-denied')
          ? 'Customer display access was denied. Publish the latest firestore.rules, including the posCustomerDisplays rule.'
          : 'The customer display could not be started. Check the Firebase connection and try again.');
      }
    });
    return () => { active = false; };
  }, [user, isAdmin]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const cartDetails = useMemo(() => cart.flatMap((line) => {
    const product = productById.get(line.productId);
    if (!product) return [];
    const unitPriceMinor = Math.round(product.price * 100);
    return [{ ...line, product, unitPriceMinor, lineTotalMinor: unitPriceMinor * line.quantity }];
  }), [cart, productById]);
  const subtotalMinor = cartDetails.reduce((total, item) => total + item.lineTotalMinor, 0);
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === 'All' || getFragranceCategories(product).some((item) => item === category);
      const matchesSearch = !term || [
        product.name, product.brand, product.concentration, getProductType(product), product.id,
      ].some((value) => value.toLowerCase().includes(term));
      return matchesCategory && matchesSearch;
    });
  }, [products, search, category]);

  useEffect(() => {
    if (!db || !displayReady || !displayToken.current) return;
    const items: DisplayItem[] = cartDetails.map(({ product, quantity, unitPriceMinor, lineTotalMinor }) => ({
      productId: product.id,
      name: product.name,
      brand: product.brand,
      image: product.image,
      quantity,
      unitPriceMinor,
      lineTotalMinor,
    }));
    void setDoc(doc(db, 'posCustomerDisplays', displayToken.current), {
      displayToken: displayToken.current,
      active: true,
      items,
      totalMinor: subtotalMinor,
      updatedAt: serverTimestamp(),
    }).catch((reason: unknown) => {
      console.error('Could not update the POS customer display.', reason);
      const code = typeof reason === 'object' && reason !== null && 'code' in reason
        ? String(reason.code) : '';
      setSaleError(code.includes('permission-denied')
        ? 'Customer display access was denied. Publish the latest firestore.rules, including the posCustomerDisplays rule.'
        : 'Cart changes could not be shared with the customer display. Check the Firebase connection and try again.');
    });
  }, [cartDetails, displayReady, subtotalMinor]);

  const addProduct = (product: Fragrance) => {
    if (!Number.isSafeInteger(product.stock) || product.stock < 1) {
      setSaleError(`${product.name} is out of stock.`);
      return;
    }
    setSaleError('');
    setCart((current) => {
      const found = current.find((line) => line.productId === product.id);
      if (found && found.quantity >= product.stock) {
        setSaleError(`Only ${product.stock} ${product.name} available.`);
        return current;
      }
      return found
        ? current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { productId: product.id, quantity: 1 }];
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    const product = productById.get(productId);
    setCart((current) => current.flatMap((line) => {
      if (line.productId !== productId) return [line];
      const next = line.quantity + delta;
      if (next < 1) return [];
      if (product && next > product.stock) {
        setSaleError(`Only ${product.stock} ${product.name} available.`);
        return [line];
      }
      return [{ ...line, quantity: next }];
    }));
  };

  const holdSale = () => {
    if (!cart.length) return;
    const held: HeldSale = {
      id: crypto.randomUUID(),
      items: cart,
      customerName,
      customerPhone,
      createdAt: Date.now(),
    };
    setHeldSales((current) => [held, ...current]);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCashReceived('');
    clearPendingSale();
    setSaleError('');
  };

  const resumeSale = (sale: HeldSale) => {
    if (cart.length && !window.confirm('Replace the current cart with this held sale? The current cart will be cleared.')) return;
    const adjusted = sale.items.flatMap((line) => {
      const product = productById.get(line.productId);
      if (!product || product.stock < 1) return [];
      return [{ ...line, quantity: Math.min(line.quantity, product.stock) }];
    });
    const changed = adjusted.length !== sale.items.length
      || adjusted.some((line, index) => line.quantity !== sale.items[index]?.quantity);
    setCart(adjusted);
    setCustomerName(sale.customerName);
    setCustomerPhone(sale.customerPhone);
    setHeldSales((current) => current.filter((entry) => entry.id !== sale.id));
    setSaleError(changed ? 'Held cart rechecked against current stock; unavailable quantities were reduced.' : '');
    setCashReceived('');
    clearPendingSale();
  };

  const removeFromCart = (productId: string) => {
    setCart((current) => current.filter((line) => line.productId !== productId));
    clearPendingSale();
  };

  const completeCashSale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!functions || !user || !isAdmin || busy || cartDetails.length === 0) return;
    const received = parseMoneyMinor(cashReceived);
    if (received === null) {
      setSaleError('Enter cash received using a valid amount, for example 200 or 200.50.');
      return;
    }
    if (received < subtotalMinor) {
      setSaleError(`Cash received is less than the ${formatMinor(subtotalMinor)} due.`);
      return;
    }
    const saleRequest = {
      items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
      amountReceivedMinor: received,
      customer: { name: customerName.trim(), phone: customerPhone.trim() },
    };
    const fingerprint = JSON.stringify(saleRequest);
    if (pendingSaleFingerprint.current !== fingerprint) {
      pendingSaleId.current = crypto.randomUUID();
      pendingSaleFingerprint.current = fingerprint;
    }
    const idempotencyKey = pendingSaleId.current ?? crypto.randomUUID();
    pendingSaleId.current = idempotencyKey;
    setBusy(true);
    setSaleError('');
    try {
      const completeSale = httpsCallable<CompleteSaleRequest, SaleReceipt>(functions, 'completePosCashSale');
      const result = await completeSale({
        idempotencyKey,
        ...saleRequest,
      });
      setReceipt(result.data);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setCashReceived('');
      clearPendingSale();
      searchRef.current?.focus();
    } catch (reason) {
      console.error('Trusted POS cash sale failed.', reason);
      setSaleError(getCashSaleErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const customerDisplayUrl = displayToken.current
    ? `${window.location.origin}/?pos-display=${encodeURIComponent(displayToken.current)}` : '';

  if (!user || !isAdmin) return <main className="admin-guard"><section className="admin-access-card">
    <span className="eyebrow">THE PERFUME NERD · POINT OF SALE</span>
    <h1>Administrator access required.</h1>
    <p>The sales terminal requires a verified administrator session.</p>
    <button className="outline-button" onClick={onBack}><ArrowLeft size={15} /> Return to admin</button>
  </section></main>;

  return <main className="pos-shell">
    <header className="pos-header">
      <a className="pos-brand" href="/admin" onClick={(event) => { event.preventDefault(); onBack(); }}>
        <img src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" />
        <span>THE PERFUME NERD<small>POINT OF SALE</small></span>
      </a>
      <div className="pos-header-actions">
        <a className="pos-display-link" href={customerDisplayUrl} target="_blank" rel="noreferrer" aria-disabled={!displayReady}>
          <ExternalLink size={16} /> Customer display
        </a>
        <span className="pos-cashier"><UserRound size={15} />{user.displayName || user.email}</span>
        <button className="pos-exit" onClick={onBack}><ArrowLeft size={15} /> Admin</button>
      </div>
    </header>

    <div className="pos-workspace">
      <section className="pos-catalog">
        <div className="pos-catalog-heading">
          <div><span className="pos-eyebrow">LIVE STORE INVENTORY</span><h1>New sale</h1></div>
          <span className="pos-product-count">{loading ? 'Loading products…' : `${filteredProducts.length} products`}</span>
        </div>
        <label className="pos-search"><Search size={18} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, brand or product code" aria-label="Search POS products" /><kbd>F2</kbd></label>
        <div className="pos-categories" aria-label="Product categories">
          {['All', 'Men', 'Women', 'Unisex'].map((item) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item === 'All' ? 'All fragrances' : item}</button>)}
        </div>
        {catalogError && <p className="pos-error" role="alert"><CircleAlert size={16} />{catalogError}</p>}
        {loading ? <div className="pos-empty">Loading the shared product catalogue…</div> :
          filteredProducts.length ? <div className="pos-product-grid">{filteredProducts.map((product) => {
            const available = Number.isSafeInteger(product.stock) ? product.stock : 0;
            return <button className="pos-product-card" key={product.id} onClick={() => addProduct(product)} disabled={available < 1}>
              <span className="pos-product-image"><img src={product.image} alt="" loading="lazy" /></span>
              <span className="pos-product-info"><strong>{product.name}</strong><small>{product.brand} · {isPerfumeProduct(product) ? product.concentration : getProductType(product)}</small><span className="pos-product-bottom"><b>{money(product.price)}</b><small className={available < 4 ? 'low-stock' : ''}>{available > 0 ? `${available} in stock` : 'Out of stock'}</small></span></span>
            </button>;
          })}</div> : <div className="pos-empty">{products.length === 0
            ? 'No live products are available. Add and publish fragrances in the admin product catalogue.'
            : 'No products match this search.'}</div>}
      </section>

      <aside className="pos-cart-panel">
        <div className="pos-cart-heading"><div><span className="pos-eyebrow">CURRENT TRANSACTION</span><h2>Sale <span>· {cart.reduce((sum, item) => sum + item.quantity, 0)} items</span></h2></div>
          <button className="pos-clear" onClick={() => { if (!cart.length || window.confirm('Clear every item from this sale?')) { setCart([]); setCashReceived(''); clearPendingSale(); } }} disabled={!cart.length} aria-label="Clear sale"><Trash2 size={16} /></button>
        </div>
        <div className="pos-customer-fields">
          <label>Customer name <input value={customerName} maxLength={100} onChange={(event) => setCustomerName(event.target.value)} placeholder="Optional" /></label>
          <label>Phone number <input type="tel" value={customerPhone} maxLength={32} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="pos-cart-lines">
          {cartDetails.map(({ product, quantity, unitPriceMinor, lineTotalMinor }) => <article className="pos-cart-line" key={product.id}>
            <img src={product.image} alt="" />
            <div className="pos-line-detail"><strong>{product.name}</strong><small>{formatMinor(unitPriceMinor)} each</small><div className="pos-quantity">
              <button onClick={() => changeQuantity(product.id, -1)} aria-label={`Decrease ${product.name}`}><Minus size={13} /></button><span>{quantity}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label={`Increase ${product.name}`}><Plus size={13} /></button>
            </div></div>
            <div className="pos-line-total"><b>{formatMinor(lineTotalMinor)}</b><button onClick={() => removeFromCart(product.id)} aria-label={`Remove ${product.name}`}><X size={14} /></button></div>
          </article>)}
          {!cart.length && <div className="pos-cart-empty"><ShoppingBag size={24} /><p>Your sale is empty.</p><span>Select a fragrance to add it here.</span></div>}
        </div>
        {saleError && <p className="pos-error" role="alert"><CircleAlert size={16} />{saleError}</p>}
        <div className="pos-total-row"><span>Subtotal</span><strong>{formatMinor(subtotalMinor)}</strong></div>
        <div className="pos-total-row pos-grand-total"><span>Total due</span><strong>{formatMinor(subtotalMinor)}</strong></div>
        <form className="pos-payment-form" onSubmit={(event) => void completeCashSale(event)}>
          <label>Cash received (GH₵)<input type="text" inputMode="decimal" autoComplete="off" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="0.00" disabled={!cart.length || busy} /></label>
          {parseMoneyMinor(cashReceived) !== null && parseMoneyMinor(cashReceived)! >= subtotalMinor && subtotalMinor > 0 &&
            <div className="pos-change">Change due <strong>{formatMinor(parseMoneyMinor(cashReceived)! - subtotalMinor)}</strong></div>}
          <button className="pos-pay-button" type="submit" disabled={!cart.length || busy || !functions}>
            <CreditCard size={17} />{busy ? 'Confirming sale…' : 'Complete cash sale'}
          </button>
        </form>
        <div className="pos-hold-row"><button onClick={holdSale} disabled={!cart.length}>Hold sale</button><span>{heldSales.length} held</span></div>
        {heldSales.length > 0 && <div className="pos-held-list" aria-label="Held sales">{heldSales.map((sale) => <div key={sale.id}>
          <span><strong>{sale.customerName || 'Walk-in customer'}</strong><small>{sale.items.reduce((sum, item) => sum + item.quantity, 0)} items · {new Date(sale.createdAt).toLocaleTimeString()}</small></span>
          <button onClick={() => resumeSale(sale)}>Resume</button>
        </div>)}</div>}
      </aside>
    </div>

    {receipt && <div className="pos-receipt-backdrop" role="presentation">
      <section className="pos-receipt" role="dialog" aria-modal="true" aria-labelledby="pos-receipt-title">
        <button className="pos-receipt-close" onClick={() => setReceipt(null)} aria-label="Close receipt"><X size={18} /></button>
        <div className="pos-receipt-print">
          <img src="/IMAGES/PERFUME-NERD-LOGO.png" alt="The Perfume Nerd" />
          <h2 id="pos-receipt-title">THE PERFUME NERD</h2><p>Thank you for your purchase.</p>
          <hr /><div><span>Receipt</span><strong>{receipt.receiptNumber}</strong></div>
          <div><span>Date</span><strong>{receipt.createdAt ? new Date(receipt.createdAt).toLocaleString() : new Date().toLocaleString()}</strong></div>
          <div><span>Cashier</span><strong>{user.displayName || user.email}</strong></div><hr />
          {receipt.items.map((item) => <div className="pos-receipt-item" key={item.productId}>
            <span>{item.name} × {item.quantity}<small>{item.brand}</small></span><strong>{formatMinor(item.lineTotalMinor)}</strong>
          </div>)}
          <hr /><div><span>Total paid</span><strong>{formatMinor(receipt.totalMinor)}</strong></div>
          <div><span>Cash received</span><strong>{formatMinor(receipt.amountReceivedMinor)}</strong></div>
          <div><span>Change</span><strong>{formatMinor(receipt.changeMinor)}</strong></div>
          <hr /><small>Payment: Cash · GHS</small>
        </div>
        <div className="pos-receipt-actions"><button className="pos-pay-button" onClick={() => window.print()}><Printer size={16} /> Print receipt</button><button className="outline-button" onClick={() => setReceipt(null)}><Check size={16} /> Done</button></div>
      </section>
    </div>}
  </main>;
}

export function PosCustomerDisplay({ sessionId }: { sessionId: string }) {
  const [display, setDisplay] = useState<CustomerDisplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [displayError, setDisplayError] = useState(false);

  useEffect(() => {
    if (!db || !/^[0-9a-f]{64}$/.test(sessionId)) {
      setLoading(false);
      setUnavailable(true);
      return;
    }
    return onSnapshot(doc(db, 'posCustomerDisplays', sessionId), (snapshot) => {
      if (!snapshot.exists() || snapshot.data().displayToken !== sessionId || snapshot.data().active !== true) {
        setUnavailable(true);
        setDisplay(null);
      } else {
        setUnavailable(false);
        setDisplay(snapshot.data() as CustomerDisplayData);
      }
      setLoading(false);
    }, (reason) => {
      console.error('Customer display could not load its live cart.', reason);
      setUnavailable(true);
      const code = typeof reason === 'object' && reason !== null && 'code' in reason
        ? String(reason.code) : '';
      setDisplayError(code.includes('permission-denied'));
      setLoading(false);
    });
  }, [sessionId]);

  return <main className="pos-customer-screen">
    <header><img src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" /><span>THE PERFUME NERD<small>YOUR IN-STORE SELECTION</small></span></header>
    {loading ? <section className="pos-customer-empty">Connecting to your in-store selection…</section> :
      unavailable ? <section className="pos-customer-empty">{displayError
        ? 'Customer display access is blocked. Ask the administrator to publish the latest Firestore rules.'
        : 'This customer display session is unavailable.'}</section> :
        <section className="pos-customer-content">
          <div className="pos-customer-title"><span>YOUR SELECTION</span><h1>Take a moment with your choices.</h1></div>
          {display?.items.length ? <>
            <div className="pos-customer-items">{display.items.map((item) => <article key={item.productId}>
              <img src={item.image} alt="" /><div><strong>{item.name}</strong><small>{item.brand} · Qty {item.quantity}</small></div><b>{formatMinor(item.lineTotalMinor)}</b>
            </article>)}</div>
            <div className="pos-customer-total"><span>Total due</span><strong>{formatMinor(display.totalMinor)}</strong></div>
          </> : <div className="pos-customer-empty"><ShoppingBag size={28} /><p>Your fragrance selection will appear here.</p></div>}
          <p className="pos-customer-note">Please confirm your selection with our fragrance consultant.</p>
        </section>}
  </main>;
}
