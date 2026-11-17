import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, Heart, House,
  Menu, Minus, Plus, Search, ShoppingBag, SlidersHorizontal, Sparkles, X,
} from 'lucide-react';
import { getFragranceCategories, money, optimizedProductImage, type Fragrance } from './catalog';
import { auth, authPersistence, db, isFirebaseConfigured } from './firebase';
import { LoadedImage } from './LoadedImage';
import { applyStorefrontDiscounts } from './discounts';
import { orderApi } from './order-api';
import { getStorefrontPath, getStorefrontTab } from './routes';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { addDoc, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { defaultCollectionHeroSettings, defaultCollectionSettings, defaultFinderSettings, defaultHeroSettings, useStorefrontData, type StorefrontSettings } from './storefront-data';
const AdminPortal = lazy(() => import('./admin'));
const PosTerminal = lazy(() => import('./pos').then((module) => ({ default: module.PosTerminal })));
const PosCustomerDisplay = lazy(() => import('./pos').then((module) => ({ default: module.PosCustomerDisplay })));

type Tab = 'Home' | 'Search' | 'Wishlist' | 'Account' | 'Cart' | 'Orders';
type AdminView = 'dashboard' | 'pos' | 'customer-display' | null;
type CartLine = { id: string; quantity: number };
type Panel = 'menu' | 'detail' | 'filters' | 'finder' | 'checkout' | 'feedback' | null;
type FinderAnswers = { category: string; family: string; occasion: string; budget: string; strength: string };
const adminEmailAllowlist = new Set(['perfumenerd6@gmail.com']);
const tabNames: Tab[] = ['Home', 'Search', 'Wishlist', 'Account', 'Cart'];
const getAdminView = (pathname: string): AdminView => pathname === '/admin'
  ? 'dashboard'
  : pathname === '/admin/pos'
    ? 'pos'
    : pathname.startsWith('/pos-display/')
      ? 'customer-display'
      : null;
const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

function App() {
  const [adminView, setAdminView] = useState<AdminView>(() => getAdminView(location.pathname));
  const isAdminRoute = adminView !== null;
  const [tab, setTab] = useState<Tab>(() => getStorefrontTab(location.pathname, location.search));
  const [cart, setCart] = useState<CartLine[]>(() => readStored('tpn-cart', []));
  const [wishlist, setWishlist] = useState<string[]>(() => readStored('tpn-wishlist', []));
  const [panel, setPanel] = useState<Panel>(null);
  const [selected, setSelected] = useState<Fragrance | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('Featured');
  const [filters, setFilters] = useState({
    family: 'All families', availability: 'Any availability', brand: 'All brands',
    price: 'Any price', concentration: 'All concentrations', occasion: 'Any occasion',
  });
  const [toast, setToast] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authRevision, setAuthRevision] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminClaimLoading, setAdminClaimLoading] = useState(true);
  const [adminClaimError, setAdminClaimError] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [verificationReturn, setVerificationReturn] = useState(false);
  const { products, settings, isLoading: storefrontLoading, settingsLoading, error: storefrontError, isDemo } = useStorefrontData();
  const [finderStep, setFinderStep] = useState(0);
  const [answers, setAnswers] = useState<FinderAnswers>({ category: '', family: '', occasion: '', budget: '', strength: '' });
  const [checkoutForm, setCheckoutForm] = useState({ name: '', email: '', phone: '', address: '', city: '', region: '', postalCode: '' });

  const storefrontProducts = useMemo(
    () => applyStorefrontDiscounts(products, settings, settingsLoading),
    [products, settings, settingsLoading],
  );
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cart.reduce((total, item) => {
    const product = storefrontProducts.find((entry) => entry.id === item.id);
    return total + (product?.price ?? 0) * item.quantity;
  }, 0);
  const cartSavings = cart.reduce((total, item) => {
    const product = storefrontProducts.find((entry) => entry.id === item.id);
    return total + ((product?.originalPrice ?? product?.price ?? 0) - (product?.price ?? 0)) * item.quantity;
  }, 0);

  useEffect(() => { localStorage.setItem('tpn-cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('tpn-wishlist', JSON.stringify(wishlist)); }, [wishlist]);
  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      setAuthError('');
      setAuthRevision((revision) => revision + 1);
    }, (error) => {
      console.error('Firebase authentication state could not be loaded.', error);
      setAuthLoading(false);
      setAuthError('We could not restore your sign-in session. Please refresh and try again.');
    });
  }, []);
  useEffect(() => {
    if (!user || user.emailVerified) return;
    let active = true;
    const refreshEmailVerification = async () => {
      try {
        await user.reload();
        if (active && user.emailVerified) setAuthRevision((revision) => revision + 1);
      } catch (reason) {
        console.error('Could not refresh email verification status.', reason);
      }
    };
    const interval = window.setInterval(() => { void refreshEmailVerification(); }, 3000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshEmailVerification();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refreshEmailVerification);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refreshEmailVerification);
    };
  }, [user]);
  useEffect(() => {
    let active = true;
    if (!user) {
      setIsAdmin(false);
      setAdminClaimLoading(false);
      setAdminClaimError('');
      return;
    }
    setAdminClaimLoading(true);
    user.getIdTokenResult(true).then((token) => {
      if (!active) return;
      const verifiedAllowlistedEmail = user.emailVerified
        && token.claims.email_verified === true
        && typeof token.claims.email === 'string'
        && adminEmailAllowlist.has(token.claims.email.toLowerCase());
      setIsAdmin(token.claims.admin === true || verifiedAllowlistedEmail);
      setAdminClaimLoading(false);
      setAdminClaimError('');
    }).catch((reason: unknown) => {
      if (!active) return;
      console.error('Could not verify the administrator claim.', reason);
      setIsAdmin(false);
      setAdminClaimLoading(false);
      setAdminClaimError('Administrator access could not be verified. Please sign in again.');
    });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    const onPopState = () => {
      setAdminView(getAdminView(location.pathname));
      setTab(getStorefrontTab(location.pathname, location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('verified') !== '1') return;
    url.searchParams.delete('verified');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setVerificationReturn(true);
    setAdminView(null);
    setTab('Account');
    void auth?.currentUser?.reload().then(() => setAuthRevision((revision) => revision + 1));
  }, []);
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [panel]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const results = storefrontProducts.filter((product) => {
      const matchesQuery = !normalized || [
        product.name, product.brand, product.family, ...getFragranceCategories(product), product.concentration,
        ...product.notes, ...product.occasion,
      ].some((value) => value.toLowerCase().includes(normalized));
      const matchesCategory = category === 'All' || getFragranceCategories(product).some((item) => item === category);
      const matchesFamily = filters.family === 'All families' || product.family === filters.family;
      const matchesStock = filters.availability !== 'In stock only' || product.stock > 0;
      const matchesBrand = filters.brand === 'All brands' || product.brand === filters.brand;
      const matchesPrice = filters.price === 'Any price' || product.price <= Number(filters.price);
      const matchesConcentration = filters.concentration === 'All concentrations' || product.concentration === filters.concentration;
      const matchesOccasion = filters.occasion === 'Any occasion' || product.occasion.includes(filters.occasion);
      return matchesQuery && matchesCategory && matchesFamily && matchesStock && matchesBrand && matchesPrice && matchesConcentration && matchesOccasion;
    });
    if (sort === 'Price: low to high') results.sort((a, b) => a.price - b.price);
    if (sort === 'Price: high to low') results.sort((a, b) => b.price - a.price);
    if (sort === 'Name') results.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'Best sellers') results.sort((a, b) => Number(b.badge === 'BEST SELLER') - Number(a.badge === 'BEST SELLER'));
    if (sort === 'Newest arrivals') results.sort((a, b) => Number(b.badge === 'NEW ARRIVAL') - Number(a.badge === 'NEW ARRIVAL'));
    return results;
  }, [category, filters, query, sort, storefrontProducts]);

  const recommendations = useMemo(() => storefrontProducts.filter((product) => {
    const categoryMatch = !answers.category || getFragranceCategories(product).some((item) => item === answers.category);
    const familyMatch = !answers.family || product.family.toLowerCase().includes(answers.family.toLowerCase()) ||
      product.notes.some((note) => note.toLowerCase().includes(answers.family.toLowerCase()));
    const occasionMatch = !answers.occasion || product.occasion.includes(answers.occasion);
    const strengthMatch = !answers.strength || product.strength === answers.strength;
    const budget = answers.budget ? Number(answers.budget) : Infinity;
    return categoryMatch && familyMatch && occasionMatch && strengthMatch && product.price <= budget;
  }), [answers, storefrontProducts]);

  const navigate = useCallback((next: Tab) => {
    setAdminView(null);
    setTab(next);
    const path = next === 'Home' ? '/' : `/${next.toLowerCase()}`;
    if (`${location.pathname}${location.search}` !== path) history.pushState({ tab: next }, '', path);
    setPanel(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const clearCartAfterPayment = useCallback(() => setCart([]), []);
  const navigateAdmin = useCallback(() => {
    setAdminView('dashboard');
    history.pushState({ admin: true }, '', '/admin');
    window.scrollTo({ top: 0 });
  }, []);
  const navigatePos = useCallback(() => {
    setAdminView('pos');
    history.pushState({ admin: true, pos: true }, '', '/admin/pos');
    window.scrollTo({ top: 0 });
  }, []);
  const acknowledgeVerificationReturn = useCallback(() => setVerificationReturn(false), []);
  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db) {
      setFeedbackError('Feedback is unavailable until Firebase is configured.');
      return;
    }
    setFeedbackError('');
    setFeedbackSending(true);
    try {
      await addDoc(collection(db, 'feedback'), {
        message: feedbackText.trim(),
        name: feedbackName.trim(),
        email: feedbackEmail.trim(),
        userId: user?.uid ?? null,
        status: 'new',
        createdAt: serverTimestamp(),
      });
      setPanel(null);
      setFeedbackText('');
      setFeedbackName('');
      setFeedbackEmail('');
      setToast('Thank you. Your feedback has been sent.');
    } catch (reason) {
      console.error('Could not submit customer feedback.', reason);
      setFeedbackError('Your feedback could not be sent. Please try again.');
    } finally {
      setFeedbackSending(false);
    }
  };
  const addToCart = (product: Fragrance) => {
    if (product.stock <= 0) { setToast('This fragrance is currently out of stock.'); return; }
    setCart((current) => {
      const existing = current.find((line) => line.id === product.id);
      if (existing && existing.quantity >= product.stock) {
        setToast(`Only ${product.stock} available.`);
        return current;
      }
      return existing
        ? current.map((line) => line.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { id: product.id, quantity: 1 }];
    });
    setToast(`${product.name} added to your bag.`);
  };
  const updateQuantity = (id: string, amount: number) => {
    const product = products.find((entry) => entry.id === id);
    setCart((current) => current.flatMap((line) => {
      if (line.id !== id) return [line];
      const quantity = line.quantity + amount;
      if (quantity < 1) return [];
      if (product && quantity > product.stock) { setToast(`Only ${product.stock} available.`); return [line]; }
      return [{ ...line, quantity }];
    }));
  };
  const toggleWishlist = (id: string) => {
    const saved = wishlist.includes(id);
    setWishlist((current) => saved ? current.filter((entry) => entry !== id) : [...current, id]);
    setToast(saved ? 'Removed from your wishlist.' : 'Saved to your wishlist.');
  };
  const openProduct = (product: Fragrance) => { setSelected(product); setPanel('detail'); };
  const resetFinder = () => {
    setAnswers({ category: '', family: '', occasion: '', budget: '', strength: '' });
    setFinderStep(0);
  };
  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCheckoutError('');
    if (!isFirebaseConfigured || cart.length === 0) {
      setCheckoutError('Secure checkout is unavailable. Check your connection and try again.');
      return;
    }
    setCheckoutBusy(true);
    try {
      const result = await orderApi<{
        authorizationUrl: string;
        orderId: string;
        amountMinor: number;
      }>('/api/orders/initialize', {
        customer: checkoutForm,
        items: cart.map(({ id, quantity }) => ({ productId: id, quantity })),
      });
      if (!result.authorizationUrl || !result.orderId) {
        throw new Error('The payment service did not return a checkout link.');
      }
      sessionStorage.setItem('tpn-pending-checkout', JSON.stringify({
        orderId: result.orderId,
        email: checkoutForm.email.trim().toLowerCase(),
      }));
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      console.error('Could not initialize secure Paystack checkout.', error);
      setCheckoutError(error instanceof Error ? error.message : 'Unable to start secure checkout.');
      setCheckoutBusy(false);
    }
  };

  const card = (product: Fragrance, priority = false) => <ProductCard key={product.id} product={product} priority={priority}
    saved={wishlist.includes(product.id)} onOpen={() => openProduct(product)}
    onSave={() => toggleWishlist(product.id)} onAdd={() => addToCart(product)} />;
  const setAnswer = (key: keyof FinderAnswers, value: string) => setAnswers((current) => ({ ...current, [key]: value }));

  return (
    <div className="app-shell">
      {isDemo && <div className="demo-banner">PREVIEW COLLECTION · Sample products for development, not live inventory</div>}
      {settings.announcement && !isAdminRoute && <div className="demo-banner">{settings.announcement}</div>}
      {!isAdminRoute && <header className="site-header">
        <button className="icon-button" aria-label="Open menu" onClick={() => setPanel('menu')}><Menu size={21} /></button>
        <a className="wordmark header-wordmark" href="/" onClick={(event) => { event.preventDefault(); navigate('Home'); }}>
          <img className="header-brand-logo" src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" />
          <span className="header-wordmark-copy"><span>THE PERFUME NERD</span></span>
        </a>
        <button className="icon-button header-bag" aria-label={`Shopping bag, ${cartCount} items`} onClick={() => navigate('Cart')}>
          <ShoppingBag size={20} /><span className="bag-count">{cartCount}</span>
        </button>
      </header>}

      <main className="page-content">
        {!isAdminRoute && tab === 'Home' && <HomePage products={storefrontProducts} settings={settings} storefrontError={storefrontError} onNavigate={navigate} onNotice={() => { setFeedbackError(''); setPanel('feedback'); }}
          onCategory={(value) => { setCategory(value); navigate('Search'); }} onFinder={() => { resetFinder(); setPanel('finder'); }} card={card} />}
        {!isAdminRoute && tab === 'Search' && <section className="content-page search-page">
          <div className="collection-hero">
            <div className="collection-hero-copy"><div className="eyebrow">{settings.collectionHeroEyebrow || defaultCollectionHeroSettings.eyebrow}</div><h1>{settings.collectionHeroTitle || defaultCollectionHeroSettings.title}</h1><p>{settings.collectionHeroText || defaultCollectionHeroSettings.text}</p><div className="collection-meta"><span>{storefrontLoading ? 'A curated collection' : `${products.length} curated fragrances`}</span><i /><span>Accra, Ghana</span></div></div>
            <div className="collection-hero-image">{(settings.collectionHeroImage || products[0]?.image || defaultCollectionHeroSettings.image) && <LoadedImage key={settings.collectionHeroImage || products[0]?.image || defaultCollectionHeroSettings.image} className="" src={settings.collectionHeroImage || products[0]?.image || defaultCollectionHeroSettings.image} alt="" />}<span>{settings.collectionHeroCaption || defaultCollectionHeroSettings.caption}</span></div>
          </div>
          <div className="collection-tools">
            <label className="search-field"><Search size={19} /><input autoFocus={window.innerWidth > 620} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search scents, notes, brands..." aria-label="Search fragrances" />
              {query && <button className="bare-button" onClick={() => setQuery('')} aria-label="Clear search"><X size={17} /></button>}
            </label>
          <div className="search-tools">
            <button className="outline-button" onClick={() => setPanel('filters')}><SlidersHorizontal size={16} /> Filters</button>
            <label className="sort-control"><span>Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option>Featured</option><option>Best sellers</option><option>Newest arrivals</option><option>Price: low to high</option><option>Price: high to low</option><option>Name</option></select></label>
          </div>
          </div>
          <div className="filter-chips">{['All', 'Men', 'Women', 'Unisex'].map((item) => <button key={item} className={`chip ${category === item ? 'selected' : ''}`} onClick={() => setCategory(item)}>{item === 'All' ? 'All fragrances' : item}</button>)}</div>
          <div className="collection-results-heading"><div><span className="eyebrow">THE EDIT</span><h2>{category === 'All' ? 'Every fragrance' : `${category} fragrances`}</h2></div><p className="result-count">{storefrontLoading ? 'Loading the edit' : `${filteredProducts.length} ${filteredProducts.length === 1 ? 'fragrance' : 'fragrances'}`}</p></div>
          {filteredProducts.length ? <div className="product-grid">{filteredProducts.map((product, index) => card(product, index < 4))}</div> : storefrontLoading ? <p className="storefront-loading">Preparing your fragrance edit…</p> : <EmptyState title="No fragrances found" text="Try another search or clear your filters." action="Clear search" onAction={() => { setQuery(''); setCategory('All'); setFilters({ family: 'All families', availability: 'Any availability', brand: 'All brands', price: 'Any price', concentration: 'All concentrations', occasion: 'Any occasion' }); }} />}
        </section>}
        {!isAdminRoute && tab === 'Wishlist' && <section className="content-page"><div className="eyebrow">YOUR EDIT</div><h1>Saved scents.</h1><p className="page-intro">The fragrances you’re thinking about, all in one place.</p>
          {wishlist.length ? <div className="product-grid">{storefrontProducts.filter((item) => wishlist.includes(item.id)).map((product, index) => card(product, index < 4))}</div> : <EmptyState title="A little room for discovery." text="Save fragrances you love and find them here whenever you return." action="Explore the collection" onAction={() => navigate('Search')} />}</section>}
        {!isAdminRoute && tab === 'Account' && <AccountPage onNavigate={navigate} user={user} loading={authLoading} authError={authError} authRevision={authRevision} onAuthUpdated={() => setAuthRevision((revision) => revision + 1)} verificationReturn={verificationReturn} onVerificationReturnHandled={acknowledgeVerificationReturn} onAdmin={navigateAdmin} isAdmin={isAdmin} />}
        {!isAdminRoute && tab === 'Orders' && <OrderTrackingPage user={user} authLoading={authLoading} onPaymentConfirmed={clearCartAfterPayment} />}
        {!isAdminRoute && tab === 'Cart' && <section className="content-page cart-page"><div className="eyebrow">YOUR SELECTION</div><h1>Your bag<span className="heading-count"> ({cartCount})</span></h1>
          {cart.length === 0 ? <EmptyState title="Your bag is waiting." text="Discover something that feels like you." action="Explore fragrances" onAction={() => navigate('Search')} /> : <>
            <div className="cart-list">{cart.map((line) => {
              const product = storefrontProducts.find((item) => item.id === line.id);
              if (!product) return null;
              return <article className="cart-line" key={line.id}><button className="cart-image-button" onClick={() => openProduct(product)}><img src={product.image} alt={product.name} /></button>
                <div className="cart-details"><span className="product-brand">{product.brand}</span><button className="cart-product-name" onClick={() => openProduct(product)}>{product.name}</button><span className="product-price">{money(product.price)}{product.originalPrice !== undefined && <del>{money(product.originalPrice)}</del>}</span>
                  <div className="quantity-control"><button aria-label={`Decrease ${product.name} quantity`} onClick={() => updateQuantity(product.id, -1)}><Minus size={13} /></button><span>{line.quantity}</span><button aria-label={`Increase ${product.name} quantity`} onClick={() => updateQuantity(product.id, 1)}><Plus size={13} /></button></div></div>
                <button className="remove-button" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>Remove</button>
              </article>;
            })}</div>
            <div className="cart-summary"><div><span>Subtotal</span><strong>{money(cartTotal)}</strong></div>{cartSavings > 0 && <div className="cart-sale-savings"><span>Sale savings</span><strong>−{money(cartSavings)}</strong></div>}<p>Delivery charges are not included in the online total.</p><button className="primary-button full-button" onClick={() => { setCheckoutError(''); setPanel('checkout'); }}>Continue to checkout <ArrowRight size={16} /></button><button className="text-button centered" onClick={() => navigate('Search')}>Continue browsing</button></div>
          </>}</section>}
        {adminView === 'dashboard' && <Suspense fallback={<div className="admin-guard"><p>Opening administrator workspace…</p></div>}><AdminPortal user={user} loading={authLoading} isAdmin={isAdmin} claimLoading={adminClaimLoading} claimError={adminClaimError} onPos={navigatePos} onSignIn={() => navigate('Account')} /></Suspense>}
        {adminView === 'pos' && <Suspense fallback={<div className="admin-guard"><p>Opening the point of sale…</p></div>}><PosTerminal user={user} isAdmin={isAdmin && !adminClaimLoading} onBack={navigateAdmin} /></Suspense>}
        {adminView === 'customer-display' && <Suspense fallback={<div className="pos-customer-screen"><p>Connecting to the customer display…</p></div>}><PosCustomerDisplay sessionId={decodeURIComponent(location.pathname.slice('/pos-display/'.length))} /></Suspense>}
        {storefrontLoading && !isAdminRoute && tab === 'Home' && <p className="storefront-loading">Loading the fragrance collection…</p>}
        {storefrontError && !isAdminRoute && <p className="storefront-error" role="status">{storefrontError}</p>}
      </main>

      {!isAdminRoute && <nav className="bottom-nav" aria-label="Primary navigation">
        {tabNames.map((name) => {
          const Icon = name === 'Home' ? House : name === 'Search' ? Search : name === 'Wishlist' ? Heart : name === 'Account' ? UserIcon : ShoppingBag;
          return <button key={name} onClick={() => navigate(name)} className={`nav-item ${tab === name ? 'active' : ''}`} aria-current={tab === name ? 'page' : undefined}>
            <span className="nav-icon-wrap"><Icon size={19} strokeWidth={tab === name ? 2 : 1.7} />{name === 'Cart' && cartCount > 0 && <span className="nav-dot">{cartCount}</span>}</span><span>{name}</span>
          </button>;
        })}
      </nav>}

      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
      {panel && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
        {panel === 'menu' && <aside className="drawer left-drawer" role="dialog" aria-modal="true" aria-label="Main menu">
          <div className="drawer-top"><a className="wordmark drawer-wordmark" href="/" onClick={(e) => { e.preventDefault(); navigate('Home'); }}>
            <img className="drawer-brand-logo" src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" />
            <span className="drawer-brand-copy"><span>THE PERFUME NERD</span></span>
          </a><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close menu"><X size={20} /></button></div>
          <nav className="drawer-links">{['Home', 'Shop All', 'Orders', 'Best Sellers', 'Trending', 'New Arrivals'].map((item) =>
            <button key={item} onClick={() => { setCategory('All'); navigate(item === 'Home' ? 'Home' : item === 'Orders' ? 'Orders' : 'Search'); }}><span>{item}</span><ChevronRight size={16} /></button>)}
          </nav>
          <div className="drawer-secondary">{['About us', 'Contact us', 'Help & support', 'Delivery & returns', 'Terms & privacy'].map((item) => <button key={item} onClick={() => { setPanel(null); setToast('Business contact and policy information has not been configured.'); }}>{item}</button>)}</div>
          <p className="drawer-foot">A considered collection for every version of you.</p>
        </aside>}
        {panel === 'detail' && selected && <ProductDetail product={storefrontProducts.find((product) => product.id === selected.id) ?? selected} saved={wishlist.includes(selected.id)} onSave={() => toggleWishlist(selected.id)} onAdd={() => addToCart(storefrontProducts.find((product) => product.id === selected.id) ?? selected)} onClose={() => setPanel(null)} />}
        {panel === 'filters' && <aside className="drawer right-drawer filter-drawer" role="dialog" aria-modal="true" aria-label="Filter fragrances">
          <div className="drawer-top"><div><div className="eyebrow">REFINE YOUR SEARCH</div><h2>Filters</h2></div><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close filters"><X size={20} /></button></div>
          <label className="form-label">Brand<select value={filters.brand} onChange={(e) => setFilters((state) => ({ ...state, brand: e.target.value }))}><option>All brands</option>{[...new Set(storefrontProducts.map((product) => product.brand))].map((brand) => <option key={brand}>{brand}</option>)}</select></label>
          <label className="form-label">Maximum price<select value={filters.price} onChange={(e) => setFilters((state) => ({ ...state, price: e.target.value }))}><option>Any price</option>{['1500', '2000', '3000', '3500'].map((price) => <option key={price} value={price}>Up to {money(Number(price))}</option>)}</select></label>
          <label className="form-label">Fragrance family<select value={filters.family} onChange={(e) => setFilters((state) => ({ ...state, family: e.target.value }))}><option>All families</option>{[...new Set(storefrontProducts.map((product) => product.family))].map((family) => <option key={family}>{family}</option>)}</select></label>
          <label className="form-label">Concentration<select value={filters.concentration} onChange={(e) => setFilters((state) => ({ ...state, concentration: e.target.value }))}><option>All concentrations</option>{[...new Set(storefrontProducts.map((product) => product.concentration))].map((concentration) => <option key={concentration}>{concentration}</option>)}</select></label>
          <label className="form-label">Occasion<select value={filters.occasion} onChange={(e) => setFilters((state) => ({ ...state, occasion: e.target.value }))}><option>Any occasion</option>{[...new Set(storefrontProducts.flatMap((product) => product.occasion))].map((occasion) => <option key={occasion}>{occasion}</option>)}</select></label>
          <label className="form-label">Availability<select value={filters.availability} onChange={(e) => setFilters((state) => ({ ...state, availability: e.target.value }))}><option>Any availability</option><option>In stock only</option></select></label>
          <div className="filter-drawer-actions"><button className="text-button" onClick={() => { setFilters({ family: 'All families', availability: 'Any availability', brand: 'All brands', price: 'Any price', concentration: 'All concentrations', occasion: 'Any occasion' }); setCategory('All'); }}>Clear all</button><button className="primary-button" onClick={() => setPanel(null)}>Show {filteredProducts.length} results</button></div>
        </aside>}
        {panel === 'feedback' && <aside className="modal-card feedback-modal" role="dialog" aria-modal="true" aria-label="Send feedback">
          <button className="icon-button modal-close" onClick={() => setPanel(null)} aria-label="Close feedback form"><X size={20} /></button>
          <div className="eyebrow">WE’D LOVE TO HEAR FROM YOU</div><h2>Send us a note.</h2><p className="page-intro">Questions, feedback or a little fragrance advice—we’re listening.</p>
          <form className="feedback-form" onSubmit={submitFeedback}>
            {!user && <><label className="form-label">Your name (optional)<input maxLength={100} value={feedbackName} onChange={(e) => setFeedbackName(e.target.value)} /></label><label className="form-label">Email (optional)<input type="email" maxLength={254} value={feedbackEmail} onChange={(e) => setFeedbackEmail(e.target.value)} /></label></>}
            <label className="form-label">Your message<textarea required minLength={5} maxLength={2000} rows={5} value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} /></label>
            {feedbackError && <p className="auth-error" role="alert">{feedbackError}</p>}
            <button type="submit" className="primary-button full-button" disabled={feedbackSending}>{feedbackSending ? 'Sending…' : 'Send feedback'} <ArrowRight size={15} /></button>
          </form>
        </aside>}
        {panel === 'finder' && <aside className="modal-card finder-modal" role="dialog" aria-modal="true" aria-label="Find your signature scent">
          <button className="icon-button modal-close" onClick={() => setPanel(null)} aria-label="Close fragrance finder"><X size={20} /></button>
          <div className="eyebrow">A MOMENT OF DISCOVERY</div><h2>Find your signature scent.</h2>
          {finderStep < 5 ? <><div className="progress-track"><span style={{ width: `${(finderStep + 1) * 20}%` }} /></div><p className="step-count">STEP {finderStep + 1} OF 5</p>
            <FinderQuestion step={finderStep} answers={answers} onAnswer={setAnswer} />
            <div className="finder-actions"><button className="text-button" onClick={() => finderStep === 0 ? resetFinder() : setFinderStep((step) => step - 1)}>{finderStep === 0 ? 'Start over' : 'Back'}</button>
              <button className="primary-button" onClick={() => finderStep < 4 ? setFinderStep((step) => step + 1) : setFinderStep(5)}>Continue <ArrowRight size={15} /></button></div>
          </> : <div className="finder-results"><p className="page-intro">A few scents that might feel like you.</p><button className="text-button restart" onClick={resetFinder}>Start again</button>
            {recommendations.length ? <div className="product-grid">{recommendations.map((product, index) => card(product, index < 4))}</div> : <EmptyState title="A rare combination." text="Try changing a preference to see more of the collection." action="Edit preferences" onAction={() => setFinderStep(0)} />}</div>}
        </aside>}
        {panel === 'checkout' && <aside className="drawer right-drawer checkout-drawer" role="dialog" aria-modal="true" aria-label="Checkout">
          <div className="drawer-top"><div><div className="eyebrow">SECURE CHECKOUT</div><h2>Your delivery details</h2></div><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close checkout"><X size={20} /></button></div>
          <p className="checkout-note">Guest checkout is welcome. Your bag total is <strong>{money(cartTotal)}</strong>.</p>
          <form onSubmit={startCheckout} className="checkout-form">
            {([['name', 'Full name'], ['email', 'Email address'], ['phone', 'Phone number'], ['address', 'Delivery address'], ['city', 'City'], ['region', 'Region'], ['postalCode', 'Postal or GhanaPost GPS code']] as const).map(([field, label]) =>
              <label className="form-label" key={field}>{label}<input required={field !== 'postalCode'} type={field === 'email' ? 'email' : 'text'} autoComplete={field === 'name' ? 'name' : field === 'email' ? 'email' : field === 'phone' ? 'tel' : field === 'address' ? 'street-address' : field === 'city' ? 'address-level2' : field === 'region' ? 'address-level1' : 'postal-code'} value={checkoutForm[field]} onChange={(e) => setCheckoutForm((current) => ({ ...current, [field]: e.target.value }))} /></label>)}
            {checkoutError && <p className="checkout-error" role="alert">{checkoutError}</p>}
            <p className="checkout-note">Pay securely with Paystack. Your current sale prices, product availability and Ghana cedi total are verified before payment. Delivery charges are not included in the online total.</p>
            <button className="primary-button full-button" type="submit" disabled={checkoutBusy}>{checkoutBusy ? 'Preparing secure payment…' : 'Continue to payment'} <ArrowRight size={16} /></button>
          </form>
        </aside>}
      </div>}
    </div>
  );
}

function UserIcon({ size = 19 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>;
}

type CustomerOrder = {
  orderId: string;
  customer: { name: string; email: string; phone: string; address: string; city: string; region: string; postalCode?: string };
  items: { productId: string; name: string; brand: string; image: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  currency: 'GHS';
  totalMinor: number;
  paymentStatus: string;
  status: string;
  createdAt?: { toDate?: () => Date } | string | null;
};

function OrderTrackingPage({ user, authLoading, onPaymentConfirmed }: {
  user: User | null;
  authLoading: boolean;
  onPaymentConfirmed: () => void;
}) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [guestOrder, setGuestOrder] = useState<CustomerOrder | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [paymentNotice, setPaymentNotice] = useState('');
  const [paymentError, setPaymentError] = useState('');

  useEffect(() => {
    if (!user || !db) {
      setOrders([]);
      setOrdersLoading(false);
      return;
    }
    setOrdersLoading(true);
    const ordersQuery = query(collection(db, 'orders'), where('userId', '==', user.uid));
    return onSnapshot(ordersQuery, (snapshot) => {
      const customerOrders = snapshot.docs
        .map((entry) => ({ ...entry.data(), orderId: entry.id }) as CustomerOrder)
        .sort((left, right) => orderDate(right).getTime() - orderDate(left).getTime());
      setOrders(customerOrders);
      setOrdersLoading(false);
      setOrdersError('');
    }, (reason) => {
      console.error('Could not load customer orders.', reason);
      setOrdersError('Your orders could not be loaded. Please refresh or contact support.');
      setOrdersLoading(false);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (authLoading) return;
    const url = new URL(window.location.href);
    const reference = url.searchParams.get('reference') || url.searchParams.get('trxref');
    if (!reference) return;
    let checkout: { orderId?: string; email?: string } = {};
    try {
      checkout = JSON.parse(sessionStorage.getItem('tpn-pending-checkout') ?? '{}') as typeof checkout;
    } catch (reason) {
      console.error('The saved Paystack return details were invalid.', reason);
    }
    setOrderId(reference);
    if (checkout.orderId === reference && checkout.email) setEmail(checkout.email);
    const verify = async () => {
      try {
        const result = await orderApi<{
          orderId: string;
          paymentStatus: string;
          status: string;
        }>('/api/orders/verify', { reference, email: checkout.email ?? '' });
        if (result.paymentStatus === 'paid') {
          setPaymentNotice(`Payment received. Your order ${result.orderId} is confirmed.`);
          onPaymentConfirmed();
          setGuestOrder(null);
        } else {
          setPaymentNotice(`Payment for order ${result.orderId} is still being confirmed. You can check again below.`);
        }
      } catch (reason) {
        console.error('Could not verify the returned Paystack payment.', reason);
        setPaymentError('We could not confirm the payment yet. Your order ID is saved below; check again shortly or look up your order.');
      } finally {
        sessionStorage.removeItem('tpn-pending-checkout');
      }
    };
    void verify();
    const returnPath = getStorefrontPath(url.pathname, url.search);
    url.searchParams.delete('reference');
    url.searchParams.delete('trxref');
    window.history.replaceState(window.history.state, '', `${returnPath}${url.search}${url.hash}`);
  }, [authLoading, user?.uid, onPaymentConfirmed]);

  const lookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLookupBusy(true);
    setLookupError('');
    setGuestOrder(null);
    try {
      const guestOrder = await orderApi<CustomerOrder>('/api/orders/guest-lookup', {
        orderId: orderId.trim().toUpperCase(),
        email: email.trim().toLowerCase(),
      });
      setGuestOrder(guestOrder);
      if (guestOrder.paymentStatus === 'pending') {
        const verification = await orderApi<{
          orderId: string;
          paymentStatus: string;
          status: string;
        }>('/api/orders/verify', {
          reference: guestOrder.orderId,
          email: email.trim().toLowerCase(),
        });
        const refreshed = await orderApi<CustomerOrder>('/api/orders/guest-lookup', {
          orderId: guestOrder.orderId,
          email: email.trim().toLowerCase(),
        });
        setGuestOrder(refreshed);
        if (verification.paymentStatus === 'paid') {
          setPaymentNotice(`Payment received. Your order ${guestOrder.orderId} is confirmed.`);
          onPaymentConfirmed();
        }
      }
    } catch (reason) {
      console.error('Guest order lookup failed.', reason);
      setLookupError(reason instanceof Error && reason.message.includes('No guest order')
        ? 'No guest order matched that order ID and email.'
        : 'We could not find or refresh that order. Check the details and try again.');
    } finally {
      setLookupBusy(false);
    }
  };

  return <section className="content-page orders-page">
    <div className="eyebrow">YOUR PERFUME NERD</div><h1>Your orders.</h1>
    <p className="page-intro">Follow your fragrance delivery from payment through to your door.</p>
    {paymentNotice && <div className="order-notice success" role="status"><Check size={18} /><span>{paymentNotice}</span></div>}
    {paymentError && <p className="auth-error" role="alert">{paymentError}</p>}
    {!authLoading && user && <section className="orders-section"><div className="orders-section-heading"><h2>Account orders</h2><span>{orders.length} {orders.length === 1 ? 'order' : 'orders'}</span></div>
      {ordersError && <p className="auth-error" role="alert">{ordersError}</p>}
      {ordersLoading ? <p className="storefront-loading">Loading your orders…</p> : orders.length
        ? <div className="orders-list">{orders.map((order) => <OrderCard key={order.orderId} order={order} />)}</div>
        : <p className="admin-empty-note">Orders placed while signed in will appear here.</p>}
    </section>}
    <section className="guest-order-panel">
      <div className="orders-section-heading"><div><h2>Find an order</h2><p>Guest checkout? Enter the order ID and email used at checkout.</p></div></div>
      <form className="guest-order-form" onSubmit={lookup}>
        <label className="form-label">Order ID<input autoComplete="off" value={orderId} onChange={(event) => setOrderId(event.target.value.toUpperCase())} placeholder="TPN-YYYYMMDD-0123456789ABCDEF0123456789ABCDEF" required /></label>
        <label className="form-label">Checkout email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        {lookupError && <p className="auth-error" role="alert">{lookupError}</p>}
        <button className="primary-button" type="submit" disabled={lookupBusy}>{lookupBusy ? 'Checking order…' : 'Track order'} <ArrowRight size={15} /></button>
      </form>
      {guestOrder && <div className="orders-list"><OrderCard order={guestOrder} /></div>}
    </section>
  </section>;
}

function orderDate(order: CustomerOrder): Date {
  if (typeof order.createdAt === 'string') return new Date(order.createdAt);
  return order.createdAt?.toDate?.() ?? new Date(0);
}

function OrderCard({ order }: { order: CustomerOrder }) {
  return <article className="customer-order-card">
    <header className="customer-order-heading"><div><span className="eyebrow">ORDER ID</span><strong>{order.orderId}</strong><small>{orderDate(order).getTime() ? orderDate(order).toLocaleString() : 'Just placed'}</small></div>
      <span className={`order-status-pill ${order.paymentStatus === 'paid' ? 'paid' : ''}`}>{order.paymentStatus === 'paid' ? order.status.replaceAll('_', ' ') : order.paymentStatus.replaceAll('_', ' ')}</span>
    </header>
    <div className="customer-order-items">{order.items.map((item) => <div key={item.productId} className="customer-order-item"><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.brand} · Qty {item.quantity}</small></span><b>{money(item.lineTotalMinor / 100)}</b></div>)}</div>
    <div className="customer-order-footer"><span>{order.customer.name} · {order.customer.phone}<small>{order.customer.address}, {order.customer.city}, {order.customer.region}</small></span><strong>{money(order.totalMinor / 100)}</strong></div>
  </article>;
}

function ProductCard({ product, saved, onOpen, onSave, onAdd, priority = false }: { product: Fragrance; saved: boolean; onOpen: () => void; onSave: () => void; onAdd: () => void; priority?: boolean }) {
  return <article className="product-card">
    <div className="product-image-wrap"><button className="product-image-button" onClick={onOpen} aria-label={`View ${product.name}`}><img src={optimizedProductImage(product.image)} alt={`${product.name} by ${product.brand}`} loading={priority ? 'eager' : 'lazy'} decoding="async" /></button>
      {product.isOnSale && <span className="product-badge sale-badge">SALE</span>}
      {product.badge && <span className={`product-badge ${product.isOnSale ? 'product-badge-secondary' : ''}`}>{product.badge}</span>}
      <button className={`wishlist-toggle ${saved ? 'saved' : ''}`} onClick={onSave} aria-label={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}><Heart size={17} fill={saved ? 'currentColor' : 'none'} /></button>
      <button className="quick-add" onClick={onAdd} disabled={product.stock <= 0}>{product.stock > 0 ? <><Plus size={15} /><span>Add</span></> : 'Sold out'}</button>
    </div>
    <button className="product-copy" onClick={onOpen}><span className="product-brand">{product.brand}</span><span className="product-name">{product.name}</span><span className="product-price">{money(product.price)}{product.originalPrice !== undefined && <del>{money(product.originalPrice)}</del>}</span><span className="product-category-label">{getFragranceCategories(product).join(' · ')}</span></button>
  </article>;
}

function HomePage({ products: inventory, settings, storefrontError, onNavigate, onCategory, onFinder, onNotice, card }: {
  products: Fragrance[]; settings: StorefrontSettings; storefrontError: string; onNavigate: (tab: Tab) => void; onCategory: (category: string) => void;
  onFinder: () => void; onNotice: () => void; card: (product: Fragrance, priority?: boolean) => ReactNode;
}) {
  const heroImage = settings.heroImage || '';
  return <div className="home-page">
    <section className="hero">{heroImage && <LoadedImage key={heroImage} className="hero-image" src={heroImage} alt="A sculptural fragrance bottle in warm studio light" />}
      <div className="hero-shade" /><div className="hero-copy"><h1>{(settings.heroTitle || defaultHeroSettings.heroTitle).split('\n').map((line, index) => <Fragment key={`${index}-${line}`}>{index > 0 && <br />}{line}</Fragment>)}</h1><p>{settings.heroText || defaultHeroSettings.heroText}</p><button className="light-button" onClick={() => onNavigate('Search')}>{settings.heroButtonText || defaultHeroSettings.heroButtonText} <ArrowRight size={16} /></button></div>
      <span className="hero-caption">{settings.heroCaption || defaultHeroSettings.heroCaption}</span>
    </section>
    {storefrontError && <p className="storefront-error" role="status">{storefrontError}</p>}
    <section className="category-section section-pad"><div className="section-heading"><h2>Shop by collection</h2></div>
      <div className="category-grid">{defaultCollectionSettings.map((item) => {
        const key = item.id[0].toUpperCase() + item.id.slice(1);
        const titleField = `collection${key}Title` as 'collectionMenTitle' | 'collectionWomenTitle' | 'collectionUnisexTitle';
        const subtitleField = `collection${key}Subtitle` as 'collectionMenSubtitle' | 'collectionWomenSubtitle' | 'collectionUnisexSubtitle';
        const imageField = `collection${key}Image` as 'collectionMenImage' | 'collectionWomenImage' | 'collectionUnisexImage';
        const title = settings[titleField] || item.title;
        const subtitle = settings[subtitleField] || item.subtitle;
        const image = settings[imageField] || item.image;
        return <button className="category-card" key={item.id} onClick={() => onCategory(item.category)}>
          {image && <LoadedImage key={image} className="" src={image} alt="" />}
          <span className="category-overlay" /><span className="category-copy"><span>{title}</span><small>{subtitle}</small></span><ArrowRight className="category-arrow" size={18} />
        </button>;
      })}</div>
    </section>
    <ProductShelf title="The most loved" products={inventory.filter((item) => item.badge === 'BEST SELLER')} card={card} />
    <section className="finder-promo"><div><div className="eyebrow">{settings.finderEyebrow || defaultFinderSettings.eyebrow}</div><h2>{(settings.finderTitle || defaultFinderSettings.title).split('\n').map((line, index) => <Fragment key={`${index}-${line}`}>{index > 0 && <br />}{line}</Fragment>)}</h2><p>{settings.finderText || defaultFinderSettings.text}</p><button className="primary-button" onClick={onFinder}>{settings.finderButtonText || defaultFinderSettings.buttonText} <ArrowRight size={15} /></button></div><div className="promo-image">{(settings.finderImage || defaultFinderSettings.image) && <LoadedImage key={settings.finderImage || defaultFinderSettings.image} className="" src={settings.finderImage || defaultFinderSettings.image} alt="Perfume bottle with a soft floral arrangement" />}<span>{settings.finderCaption || defaultFinderSettings.caption}</span></div></section>
    <section className="trust-section"><div className="eyebrow">A MORE THOUGHTFUL WAY TO SHOP</div><h2>Good scent. No guesswork.</h2><div className="trust-grid"><div><span className="trust-number">01</span><h3>Find your point of view</h3><p>Explore by notes, families and the feelings you want to leave behind.</p></div><div><span className="trust-number">02</span><h3>Make it personal</h3><p>Take a moment with our fragrance finder to discover a direction.</p></div><div><span className="trust-number">03</span><h3>Shop with confidence</h3><p>We’re building a considered fragrance destination in Ghana.</p></div></div><p className="trust-disclaimer">Product availability and business services shown in this preview are sample data and require verification before launch.</p></section>
    <footer className="site-footer"><a className="wordmark footer-wordmark" href="/" onClick={(e) => { e.preventDefault(); onNavigate('Home'); }}>
      <img className="footer-brand-logo" src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" />
      <span className="footer-brand-copy"><span>THE PERFUME NERD</span></span>
    </a><p>{settings.footerText || 'Exceptional fragrance, thoughtfully found.'}</p><div className="footer-links"><button onClick={() => onNavigate('Search')}>Shop all</button><button onClick={onNotice}>Contact & feedback</button><button onClick={onNotice}>Delivery & returns</button><button onClick={onNotice}>Privacy & terms</button></div><small>© {new Date().getFullYear()} · Accra, Ghana</small></footer>
  </div>;
}

function ProductShelf({ title, products: items, card }: { title: string; products: Fragrance[]; card: (product: Fragrance, priority?: boolean) => ReactNode }) {
  return <section className="shelf-section section-pad"><div className="section-heading"><h2>{title}</h2></div>
    <div className="shelf-row">{items.map((product) => card(product))}</div></section>;
}

function ProductDetail({ product, saved, onSave, onAdd, onClose }: { product: Fragrance; saved: boolean; onSave: () => void; onAdd: () => void; onClose: () => void }) {
  return <aside className="drawer right-drawer detail-drawer" role="dialog" aria-modal="true" aria-label={`${product.name} product details`}>
    <div className="drawer-top detail-top"><button className="text-button" onClick={onClose}><ArrowLeft size={16} /> Back to collection</button><button className="icon-button" onClick={onClose} aria-label="Close product details"><X size={20} /></button></div>
    <div className="detail-image"><img src={product.image} alt={`${product.name} by ${product.brand}`} /><button className={`wishlist-toggle detail-heart ${saved ? 'saved' : ''}`} onClick={onSave} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}><Heart size={19} fill={saved ? 'currentColor' : 'none'} /></button></div>
    <div className="detail-copy"><span className="eyebrow">{product.isOnSale ? 'SALE · ' : ''}{product.brand.toUpperCase()}</span><h2>{product.name}</h2><div className="detail-price">{money(product.price)}{product.originalPrice !== undefined && <del>{money(product.originalPrice)}</del>} <span>{product.concentration}</span></div><p className="detail-description">{product.description}</p>
      <div className="detail-stock">{product.stock > 0 ? <><span className="stock-dot" /> In stock · {product.stock} in this sample inventory</> : 'Currently unavailable'}</div>
      <button className="primary-button full-button detail-add" onClick={onAdd} disabled={product.stock <= 0}>{product.stock > 0 ? 'Add to bag' : 'Sold out'} <ArrowRight size={16} /></button>
      <div className="detail-facts"><div><span>COLLECTION</span><strong>{getFragranceCategories(product).join(' · ')}</strong></div><div><span>SCENT FAMILY</span><strong>{product.family}</strong></div><div><span>SCENT PROFILE</span><strong>{product.notes.join(' · ')}</strong></div><div><span>OCCASION</span><strong>{product.occasion.join(' · ')}</strong></div><div><span>CONCENTRATION</span><strong>{product.concentration}</strong></div></div>
      <p className="sample-note">Sample product information for development preview; confirm product details, authenticity, stock, and fulfilment with the business before purchase.</p>
    </div>
  </aside>;
}

function FinderQuestion({ step, answers, onAnswer }: { step: number; answers: FinderAnswers; onAnswer: (key: keyof FinderAnswers, value: string) => void }) {
  const questions: { key: keyof FinderAnswers; title: string; options: string[] }[] = [
    { key: 'category', title: 'Who are you shopping for?', options: ['Men', 'Women', 'Unisex'] },
    { key: 'family', title: 'What draws you in?', options: ['Sweet', 'Fresh', 'Woody', 'Spicy', 'Floral', 'Oud', 'Citrus', 'Vanilla'] },
    { key: 'occasion', title: 'Where will your scent take you?', options: ['Everyday', 'Office', 'Date night', 'Special occasions', 'All-purpose'] },
    { key: 'budget', title: 'What feels comfortable?', options: ['1000', '1800', '2600', '3500'] },
    { key: 'strength', title: 'How do you like to be remembered?', options: ['Soft', 'Moderate', 'Strong'] },
  ];
  const question = questions[step];
  return <div className="finder-question"><h3>{question.title}</h3><div className="choice-grid">{question.options.map((option) => {
    const value = question.key === 'budget' ? option : option;
    const label = question.key === 'budget' ? `Under ${money(Number(option))}` : option;
    return <button key={option} className={`choice-button ${answers[question.key] === value ? 'chosen' : ''}`} onClick={() => onAnswer(question.key, value)}>{label}{answers[question.key] === value && <Check size={16} />}</button>;
  })}</div></div>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><Sparkles size={21} /></span><h2>{title}</h2><p>{text}</p><button className="outline-button" onClick={onAction}>{action} <ArrowRight size={15} /></button></div>;
}

function AccountPage({ onNavigate, user, loading, authError, authRevision, onAuthUpdated, verificationReturn, onVerificationReturnHandled, onAdmin, isAdmin }: {
  onNavigate: (tab: Tab) => void;
  user: User | null;
  loading: boolean;
  authError: string;
  authRevision: number;
  onAuthUpdated: () => void;
  verificationReturn: boolean;
  onVerificationReturnHandled: () => void;
  onAdmin: () => void;
  isAdmin: boolean;
}) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [verificationSignal, setVerificationSignal] = useState(0);
  const hasPendingVerification = useRef(false);

  useEffect(() => {
    if (!verificationReturn) return;
    hasPendingVerification.current = true;
    onVerificationReturnHandled();
    setVerificationSignal((signal) => signal + 1);
  }, [verificationReturn, onVerificationReturnHandled]);

  useEffect(() => {
    if (user && !user.emailVerified) hasPendingVerification.current = true;
    if (!user?.emailVerified || !hasPendingVerification.current) return;
    hasPendingVerification.current = false;
    const timer = window.setTimeout(() => onNavigate('Home'), 4000);
    return () => window.clearTimeout(timer);
  }, [user, authRevision, verificationSignal, onNavigate]);

  const begin = () => {
    setError('');
    setMessage('');
    setBusy(true);
  };
  const end = () => setBusy(false);
  const showError = (reason: unknown) => {
    console.error('Firebase authentication request failed.', reason);
    const code = typeof reason === 'object' && reason !== null && 'code' in reason
      ? String(reason.code) : '';
    const errors: Record<string, string> = {
      'auth/email-already-in-use': 'An account already uses this email. Try signing in instead.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/invalid-credential': 'That email and password combination could not be verified.',
      'auth/weak-password': 'Choose a stronger password with at least 6 characters.',
      'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
      'auth/network-request-failed': 'A network error interrupted the request. Check your connection and try again.',
      'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
      'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups and try again.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase Authentication yet.',
      'auth/account-exists-with-different-credential': 'An account with this email already uses another sign-in method.',
    };
    setError(errors[code] ?? 'We could not complete sign-in. Please check your details and try again.');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) return;
    begin();
    try {
      await authPersistence;
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setMessage('If an account exists for that email, a password reset link is on its way.');
      } else if (mode === 'sign-up') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        hasPendingVerification.current = true;
        await sendEmailVerification(credential.user, { url: `${window.location.origin}/account?verified=1` });
        setMessage('Your account is ready. Check your inbox for the email verification link.');
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (reason) {
      showError(reason);
    } finally {
      end();
    }
  };
  const googleSignIn = async () => {
    if (!auth) return;
    begin();
    try {
      await authPersistence;
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (reason) {
      showError(reason);
    } finally {
      end();
    }
  };
  const resendVerification = async () => {
    if (!auth || !user) return;
    begin();
    try {
      hasPendingVerification.current = true;
      await sendEmailVerification(user, { url: `${window.location.origin}/account?verified=1` });
      setMessage('A new verification email has been sent.');
    } catch (reason) {
      showError(reason);
    } finally {
      end();
    }
  };
  const refreshVerification = async () => {
    if (!auth || !user) return;
    begin();
    try {
      await user.reload();
      onAuthUpdated();
      setMessage(user.emailVerified ? 'Your email is verified.' : 'Your email is not verified yet. Check your inbox, then try again.');
    } catch (reason) {
      showError(reason);
    } finally {
      end();
    }
  };
  const logout = async () => {
    if (!auth) return;
    begin();
    try {
      await signOut(auth);
      setMessage('You have signed out.');
      setPassword('');
    } catch (reason) {
      showError(reason);
    } finally {
      end();
    }
  };

  return <section className="content-page account-page">
    <div className="eyebrow">YOUR PERFUME NERD</div><h1>Your account.</h1>
    <p className="page-intro">Sign in to keep your fragrance journey close.</p>
    {loading ? <div className="account-card" role="status"><div className="account-mark"><UserIcon size={25} /></div><p>Checking your account…</p></div> :
      user ? <div className="account-card signed-in-card">
        <div className="account-mark"><UserIcon size={25} /></div>
        <h2>Welcome{user.displayName ? `, ${user.displayName}` : ''}.</h2>
        {user.emailVerified ? <p className="verification-state verified"><Check size={15} /> Verified</p> :
          <div className="verification-panel"><p>Your email address is not verified yet. Please check your inbox.</p>
            <div className="account-actions"><button className="outline-button" onClick={resendVerification} disabled={busy}>Resend verification</button><button className="text-button" onClick={refreshVerification} disabled={busy}>I’ve verified</button></div>
          </div>}
        <AccountDetails user={user} onProfileSaved={onAuthUpdated} />
        {message && <p className="auth-message" role="status">{message}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {authError && <p className="auth-error" role="alert">{authError}</p>}
        {isAdmin && <button className="outline-button admin-account-link" onClick={onAdmin}>Open admin portal <ArrowRight size={15} /></button>}
        <button className="text-button sign-out-button" onClick={logout} disabled={busy}>{busy ? 'Please wait…' : 'Sign out'}</button>
      </div> :
        <div className="account-card auth-card">
          {!isFirebaseConfigured ? <>
            <div className="account-mark"><UserIcon size={25} /></div><h2>Connect your Firebase project.</h2>
            <p>Add your Firebase <strong>web app configuration</strong> to a local <code>.env.local</code> file, then restart the development server. Do not use a service-account key here.</p>
            <p className="auth-setup-help">Enable Email/Password and Google under Firebase Console → Authentication → Sign-in method. See <code>.env.example</code> for the required variable names.</p>
          </> : <>
            <div className="auth-mode-tabs" role="tablist" aria-label="Account options">
              <button type="button" className={mode === 'sign-in' ? 'selected' : ''} onClick={() => { setMode('sign-in'); setError(''); setMessage(''); }}>Sign in</button>
              <button type="button" className={mode === 'sign-up' ? 'selected' : ''} onClick={() => { setMode('sign-up'); setError(''); setMessage(''); }}>Create account</button>
            </div>
            <div className="auth-heading"><h2>{mode === 'reset' ? 'Reset your password.' : mode === 'sign-up' ? 'A lovely place to begin.' : 'Welcome back.'}</h2><p>{mode === 'reset' ? 'We’ll email you a secure password reset link.' : mode === 'sign-up' ? 'Create an account to make your scent journey yours.' : 'Sign in to return to your fragrance edit.'}</p></div>
            <form className="auth-form" onSubmit={submit}>
              {mode === 'sign-up' && <label className="form-label">Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>}
              <label className="form-label">Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              {mode !== 'reset' && <label className="form-label">Password<input type="password" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>}
              {error && <p className="auth-error" role="alert">{error}</p>}
              {message && <p className="auth-message" role="status">{message}</p>}
              <button className="primary-button full-button auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'reset' ? 'Send reset link' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</button>
            </form>
            {mode === 'sign-in' && <button className="text-button forgot-password" onClick={() => { setMode('reset'); setError(''); setMessage(''); }}>Forgot your password?</button>}
            {mode === 'reset' && <button className="text-button forgot-password" onClick={() => { setMode('sign-in'); setError(''); setMessage(''); }}>Back to sign in</button>}
            {mode !== 'reset' && <><div className="auth-divider"><span>OR</span></div>
              <button className="google-button" type="button" onClick={googleSignIn} disabled={busy}><GoogleMark /> Continue with Google</button>
            </>}
          </>}
          {authError && <p className="auth-error" role="alert">{authError}</p>}
        </div>}
    <div className="account-links"><button onClick={() => onNavigate('Cart')}><span><ShoppingBag size={17} /> Your shopping bag</span><ChevronRight size={17} /></button><button onClick={() => onNavigate('Wishlist')}><span><Heart size={17} /> Your wishlist</span><ChevronRight size={17} /></button></div>
  </section>;
}

type AccountProfile = {
  name: string;
  phoneNumber: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
};

function AccountDetails({ user, onProfileSaved }: { user: User; onProfileSaved: () => void }) {
  const [profile, setProfile] = useState<AccountProfile>({
    name: user.displayName ?? '',
    phoneNumber: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setProfile({
      name: user.displayName ?? '',
      phoneNumber: '',
      address: '',
      city: '',
      region: '',
      postalCode: '',
    });
    setError('');
    if (!db) {
      setLoading(false);
      setError('Account details are unavailable because Firebase is not configured.');
      return () => { active = false; };
    }

    setLoading(true);
    getDoc(doc(db, 'users', user.uid)).then((snapshot) => {
      if (!active || !snapshot.exists()) return;
      const data = snapshot.data();
      setProfile({
        name: typeof data.name === 'string' ? data.name : user.displayName ?? '',
        phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : '',
        address: typeof data.address === 'string' ? data.address : '',
        city: typeof data.city === 'string' ? data.city : '',
        region: typeof data.region === 'string' ? data.region : '',
        postalCode: typeof data.postalCode === 'string' ? data.postalCode : '',
      });
    }).catch((reason: unknown) => {
      console.error('Could not load the customer account profile.', reason);
      if (active) setError('Your saved details could not be loaded. Please try again.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user]);

  const updateField = (field: keyof AccountProfile, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db) {
      setError('Account details cannot be saved because Firebase is not configured.');
      return;
    }
    const details: AccountProfile = {
      name: profile.name.trim(),
      phoneNumber: profile.phoneNumber.trim(),
      address: profile.address.trim(),
      city: profile.city.trim(),
      region: profile.region.trim(),
      postalCode: profile.postalCode.trim(),
    };
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await setDoc(doc(db, 'users', user.uid), {
        ...details,
        updatedAt: serverTimestamp(),
      });
      if (details.name !== user.displayName) await updateProfile(user, { displayName: details.name });
      setProfile(details);
      setSaved(true);
      onProfileSaved();
    } catch (reason) {
      console.error('Could not save the customer account profile.', reason);
      setError('Your account details could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="account-details" aria-labelledby="account-details-title">
    <div className="account-details-heading">
      <h3 id="account-details-title">Account details</h3>
      <p>Keep your contact and delivery information up to date.</p>
    </div>
    <form className="account-details-form" onSubmit={saveProfile}>
      <label className="form-label">Full name
        <input autoComplete="name" maxLength={100} value={profile.name} onChange={(event) => updateField('name', event.target.value)} required />
      </label>
      <label className="form-label">Email address
        <input type="email" autoComplete="email" value={user.email ?? ''} readOnly />
      </label>
      <label className="form-label">Phone number
        <input type="tel" autoComplete="tel" maxLength={32} value={profile.phoneNumber} onChange={(event) => updateField('phoneNumber', event.target.value)} />
      </label>
      <label className="form-label account-address-field">Street address
        <input autoComplete="street-address" maxLength={200} value={profile.address} onChange={(event) => updateField('address', event.target.value)} />
      </label>
      <label className="form-label">City or town
        <input autoComplete="address-level2" maxLength={100} value={profile.city} onChange={(event) => updateField('city', event.target.value)} />
      </label>
      <label className="form-label">Region
        <input autoComplete="address-level1" maxLength={100} value={profile.region} onChange={(event) => updateField('region', event.target.value)} />
      </label>
      <label className="form-label">Postal or GhanaPost GPS code
        <input autoComplete="postal-code" maxLength={32} value={profile.postalCode} onChange={(event) => updateField('postalCode', event.target.value)} />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {saved && <p className="auth-message" role="status">Your account details have been saved.</p>}
      <button className="primary-button full-button account-save-button" type="submit" disabled={loading || saving || !db}>
        {loading ? 'Loading details…' : saving ? 'Saving details…' : 'Save account details'}
      </button>
    </form>
  </section>;
}

function GoogleMark() {
  return <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.1A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.8a12 12 0 0 1 0-7.6v-5.1H5.8a20 20 0 0 0 0 17.8l6.8-5.1Z"/><path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.8-5.8A19.4 19.4 0 0 0 24 4 20 20 0 0 0 5.8 15.1l6.8 5.1c1.6-4.8 6.1-8.4 11.4-8.4Z"/></svg>;
}

export default App;
