import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { ArrowLeft, Check, ImagePlus, LayoutDashboard, MessageSquare, Package, Plus, Save, Search, Settings, ShoppingCart, Trash2, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { auth, db, functions, isFirebaseConfigured } from './firebase';
import { fragranceCategories, getFragranceCategories, money, products as sampleProducts, type Fragrance } from './catalog';
import type { StorefrontSettings } from './storefront-data';

type AdminSection = 'overview' | 'products' | 'storefront' | 'feedback';
type FeedbackItem = { id: string; message: string; name?: string; email?: string; status: string; createdAt?: { toDate: () => Date } };
type ProductDraft = Omit<Fragrance, 'id'> & { id: string; visible?: boolean };
type UploadError = Error & { code?: string };
const blankProduct: ProductDraft = {
  id: '', name: '', brand: '', price: 0, category: 'Unisex', categories: ['Unisex'], family: 'Woody',
  strength: 'Moderate', concentration: 'Eau de Parfum', notes: [], occasion: [],
  description: '', image: '', badge: '', stock: 0,
};
const makeSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uploadError = (message: string, code: string): UploadError => Object.assign(new Error(message), { code });

export default function AdminPortal({ user, loading, isAdmin, claimLoading, claimError, onPos, onSignIn }: {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  claimLoading: boolean;
  claimError: string;
  onPos: () => void;
  onSignIn: () => void;
}) {
  const [section, setSection] = useState<AdminSection>('overview');
  const [products, setProducts] = useState<Fragrance[]>([]);
  const [settings, setSettings] = useState<StorefrontSettings>({});
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(blankProduct);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<'product' | 'hero' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [settingsDraft, setSettingsDraft] = useState<StorefrontSettings>({});
  const uploadRequest = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => { uploadRequest.current?.abort(); }, []);

  useEffect(() => {
    if (!db || !isAdmin) return;
    const stopProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
      setProducts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Fragrance));
    }, (reason) => {
      console.error('Admin product listener failed.', reason);
      setError('Could not load products. Confirm your admin access and Firestore rules.');
    });
    const stopSettings = onSnapshot(doc(db, 'storeSettings', 'public'), (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() as StorefrontSettings : {};
      setSettings(data);
      setSettingsDraft(data);
    }, (reason) => {
      console.error('Admin settings listener failed.', reason);
      setError('Could not load storefront settings.');
    });
    const feedbackQuery = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(100));
    const stopFeedback = onSnapshot(feedbackQuery, (snapshot) => {
      setFeedback(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as FeedbackItem));
    }, (reason) => {
      console.error('Admin feedback listener failed.', reason);
      setError('Could not load customer feedback. Confirm the feedback collection rules.');
    });
    return () => { stopProducts(); stopSettings(); stopFeedback(); };
  }, [isAdmin]);

  const visibleProducts = useMemo(() => products.filter((item) =>
    `${item.name} ${item.brand}`.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const newFeedbackCount = feedback.filter((item) => item.status === 'new').length;
  const fail = (reason: unknown, fallback: string) => {
    console.error(fallback, reason);
    setError(fallback);
  };
  const clearAlerts = () => { setError(''); setMessage(''); };
  const newProduct = () => {
    clearAlerts();
    setDraft({ ...blankProduct });
    setEditing(true);
    setSection('products');
  };
  const editProduct = (product: Fragrance) => {
    clearAlerts();
    const categories = getFragranceCategories(product);
    setDraft({ ...product, id: product.id, category: categories[0], categories });
    setEditing(true);
  };
  const toggleProductCategory = (category: Fragrance['category']) => {
    const currentCategories = getFragranceCategories(draft);
    if (currentCategories.includes(category)) {
      if (currentCategories.length === 1) {
        setError('Select at least one category for this fragrance.');
        return;
      }
      const categories = currentCategories.filter((item) => item !== category);
      setError('');
      setDraft((current) => ({ ...current, category: categories[0], categories }));
      return;
    }
    const categories = [...currentCategories, category];
    setError('');
    setDraft((current) => ({ ...current, category: categories[0], categories }));
  };
  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !user) return;
    const id = draft.id || makeSlug(draft.name);
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id)) {
      setError('Use a product name that creates a URL-friendly ID with at least two characters.');
      return;
    }
    if (!draft.image.trim()) {
      setError('Add a product image URL or upload an image before saving.');
      return;
    }
    setBusy(true);
    clearAlerts();
    try {
      const { id: _id, ...data } = draft;
      const categories = getFragranceCategories(data);
      if (!data.badge) delete data.badge;
      await setDoc(doc(db, 'products', id), {
        ...data,
        categories,
        category: categories[0],
        name: data.name.trim(),
        brand: data.brand.trim(),
        price: Math.round(Number(data.price)),
        stock: Math.max(0, Math.round(Number(data.stock))),
        notes: Array.isArray(data.notes) ? data.notes : [],
        occasion: Array.isArray(data.occasion) ? data.occasion : [],
        visible: data.visible !== false,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      setMessage('Product saved. Storefront updates are live.');
      setEditing(false);
      setDraft(blankProduct);
    } catch (reason) {
      fail(reason, 'The product could not be saved. Check Firebase admin access and try again.');
    } finally {
      setBusy(false);
    }
  };
  const removeProduct = async (product: Fragrance) => {
    if (!db || !window.confirm(`Permanently remove ${product.name} from the live catalog?`)) return;
    clearAlerts();
    try {
      await deleteDoc(doc(db, 'products', product.id));
      setMessage(`${product.name} was removed from the live catalog.`);
    } catch (reason) {
      fail(reason, 'The product could not be removed.');
    }
  };
  const uploadImage = async (file: File | undefined, target: 'product' | 'hero') => {
    if (!file) return;
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = target === 'product'
      ? import.meta.env.VITE_CLOUDINARY_PRODUCT_UPLOAD_PRESET
      : import.meta.env.VITE_CLOUDINARY_STOREFRONT_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset || !user) {
      setError('Cloudinary image uploads are not configured. Run the Cloudinary setup command and reload the admin page.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG, or WebP image under 5 MB.');
      return;
    }
    setUploading(true);
    setUploadTarget(target);
    setUploadProgress(0);
    clearAlerts();
    let request: XMLHttpRequest | null = null;
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('upload_preset', uploadPreset);

      request = new XMLHttpRequest();
      uploadRequest.current = request;
      const uploadedUrl = await new Promise<string>((resolve, reject) => {
        const cloudinaryRequest = request;
        if (!cloudinaryRequest) {
          reject(uploadError('The upload request could not be started.', 'request-not-created'));
          return;
        }
        cloudinaryRequest.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`);
        cloudinaryRequest.timeout = 120_000;
        cloudinaryRequest.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(Math.floor(event.loaded / event.total * 100));
        };
        cloudinaryRequest.onload = () => {
          let result: unknown;
          try {
            result = JSON.parse(cloudinaryRequest.responseText);
          } catch {
            reject(uploadError('Cloudinary returned an unreadable response.', 'invalid-response'));
            return;
          }
          if (cloudinaryRequest.status >= 200 && cloudinaryRequest.status < 300
            && typeof result === 'object' && result !== null
            && 'secure_url' in result && typeof result.secure_url === 'string') {
            resolve(result.secure_url);
            return;
          }
          const message = typeof result === 'object' && result !== null && 'error' in result
            && typeof result.error === 'object' && result.error !== null
            && 'message' in result.error && typeof result.error.message === 'string'
            ? result.error.message : `Cloudinary rejected the upload (HTTP ${cloudinaryRequest.status}).`;
          reject(uploadError(message, `cloudinary/${cloudinaryRequest.status}`));
        };
        cloudinaryRequest.onerror = () => reject(uploadError('The connection to Cloudinary failed.', 'network-request-failed'));
        cloudinaryRequest.ontimeout = () => reject(uploadError('The Cloudinary upload timed out after 2 minutes.', 'timeout'));
        cloudinaryRequest.onabort = () => reject(uploadError('The upload was canceled.', 'canceled'));
        cloudinaryRequest.send(body);
      });
      if (target === 'product') setDraft((current) => ({ ...current, image: uploadedUrl }));
      else setSettingsDraft((current) => ({ ...current, heroImage: uploadedUrl }));
      setMessage(target === 'product'
        ? 'Image uploaded to Cloudinary. Save the product to publish it.'
        : 'Hero image uploaded to Cloudinary. Save storefront content to publish it.');
    } catch (reason: unknown) {
      const code = typeof reason === 'object' && reason !== null && 'code' in reason
        ? String(reason.code) : '';
      if (code === 'canceled') {
        setMessage('Image upload canceled.');
      } else if (code === 'network-request-failed') {
        fail(reason, 'The connection to Cloudinary failed. Check your network and Cloudinary availability.');
      } else {
        fail(reason, reason instanceof Error
          ? `Cloudinary upload failed${code ? ` (${code})` : ''}: ${reason.message}`
          : `Cloudinary upload failed${code ? ` (${code})` : ''}. Check Cloudinary configuration and try again.`);
      }
    } finally {
      if (uploadRequest.current === request) uploadRequest.current = null;
      setUploading(false);
      setUploadTarget(null);
      setUploadProgress(0);
    }
  };
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !user) return;
    setBusy(true);
    clearAlerts();
    try {
      await setDoc(doc(db, 'storeSettings', 'public'), {
        ...settingsDraft,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
      setMessage('Storefront content saved and published.');
    } catch (reason) {
      fail(reason, 'Storefront settings could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const updateFeedbackStatus = async (item: FeedbackItem, status: 'read' | 'resolved') => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'feedback', item.id), { status, updatedAt: serverTimestamp() });
    } catch (reason) {
      fail(reason, 'Feedback status could not be updated.');
    }
  };
  const logoutAdmin = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (reason) {
      fail(reason, 'Could not sign out. Please try again.');
    }
  };
  const seedSamples = async () => {
    if (!db || !window.confirm('Import the clearly labelled development sample catalog into Firestore? Remove sample records before opening the store to customers.')) return;
    const firestore = db;
    setBusy(true);
    clearAlerts();
    try {
      await Promise.all(sampleProducts.map((product) => {
        const { id, ...data } = product;
        return setDoc(doc(firestore, 'products', id), {
          ...data, visible: true, isDevelopmentSample: true,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user?.uid,
        }, { merge: true });
      }));
      setMessage('Development sample catalog imported. Replace it with verified business inventory before launch.');
    } catch (reason) {
      fail(reason, 'Sample products could not be imported.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || claimLoading) return <main className="admin-guard"><p>Checking secure administrator access…</p></main>;
  if (!user) return <main className="admin-guard"><section className="admin-access-card"><span className="eyebrow">THE PERFUME NERD · ADMIN</span><h1>Administrator sign-in.</h1><p>Sign in with your designated admin account, then return here. Admin access is verified using a server-issued Firebase claim.</p><button className="primary-button" onClick={onSignIn}>Go to account sign-in <ArrowLeft size={16} /></button></section></main>;
  if (!isAdmin) return <main className="admin-guard"><section className="admin-access-card"><span className="eyebrow">RESTRICTED AREA</span><h1>Admin access required.</h1><p>This account does not have the trusted administrator claim. Contact your project administrator to provision your account securely.</p>{claimError && <p className="auth-error" role="alert">{claimError}</p>}<button className="outline-button" onClick={onSignIn}>Return to account</button></section></main>;
  if (!isFirebaseConfigured || !db || !functions) return <main className="admin-guard"><p>Firebase Firestore and Functions must be configured for the admin workspace.</p></main>;

  const sections: { id: AdminSection; label: string; icon: typeof Package }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'storefront', label: 'Storefront', icon: Settings },
    { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  ];
  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/" aria-label="The Perfume Nerd storefront"><img src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" /><span>THE PERFUME NERD<small>ADMIN STUDIO</small></span></a>
      <div className="admin-menu-label">WORKSPACE</div>
      <nav className="admin-nav"><button onClick={onPos}><ShoppingCart size={17} />Point of Sale</button>{sections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => { setSection(id); setEditing(false); clearAlerts(); }}><Icon size={17} />{label}{id === 'feedback' && newFeedbackCount > 0 && <span className="admin-nav-count">{newFeedbackCount}</span>}</button>)}</nav>
      <div className="admin-sidebar-bottom"><span className="admin-user-avatar">{(user.displayName || user.email || 'A').slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName || 'Administrator'}</strong><small>{user.email}</small></div></div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><div><span className="eyebrow">THE PERFUME NERD</span><h1>{sections.find((item) => item.id === section)?.label}</h1></div><div className="admin-top-actions"><a className="outline-button admin-store-link" href="/" onClick={(event) => { event.preventDefault(); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}><ArrowLeft size={15} /> View storefront</a><button className="admin-signout" onClick={() => void logoutAdmin()}>Sign out</button></div></header>
      {(error || message) && <div className={`admin-alert ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || message}<button onClick={clearAlerts} aria-label="Dismiss message"><X size={15} /></button></div>}
      {section === 'overview' && <section className="admin-content"><div className="admin-welcome"><div><div className="eyebrow">STORE CONTROL CENTER</div><h2>Good to have you back.</h2><p>Manage your storefront and follow up on customer feedback.</p></div><button className="primary-button" onClick={newProduct}><Plus size={16} /> Add a product</button></div>
        <div className="admin-stat-grid"><article><span>LIVE PRODUCTS</span><strong>{products.filter((item) => (item as Fragrance & { visible?: boolean }).visible !== false).length}</strong><small>In your catalog</small></article><article><span>OUT OF STOCK</span><strong>{products.filter((item) => item.stock <= 0).length}</strong><small>Review availability</small></article><article><span>NEW FEEDBACK</span><strong>{newFeedbackCount}</strong><small>Awaiting review</small></article><article><span>STORE CONTENT</span><strong>{settings.heroTitle ? 'Ready' : 'Draft'}</strong><small>Homepage presentation</small></article></div>
        <div className="admin-overview-grid"><section className="admin-panel"><div className="admin-panel-heading"><h3>Recent products</h3><button className="text-button" onClick={() => setSection('products')}>Manage all <ArrowLeft size={14} /></button></div>{products.slice(0, 5).map((product) => <div className="admin-mini-product" key={product.id}><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.brand}</small></span><b>{money(product.price)}</b></div>)}{products.length === 0 && <p className="admin-empty-note">No products yet. Add verified products or import the development samples.</p>}</section>
          <section className="admin-panel"><div className="admin-panel-heading"><h3>Latest feedback</h3><button className="text-button" onClick={() => setSection('feedback')}>Open inbox <ArrowLeft size={14} /></button></div>{feedback.slice(0, 4).map((item) => <article className="admin-feedback-mini" key={item.id}><span className={`feedback-status ${item.status}`}>{item.status}</span><p>{item.message}</p><small>{item.name || 'Guest'}{item.email ? ` · ${item.email}` : ''}</small></article>)}{feedback.length === 0 && <p className="admin-empty-note">Customer feedback sent from the storefront will appear here live.</p>}</section>
        </div><button className="admin-sample-link" onClick={seedSamples} disabled={busy}>Import development sample products</button>
      </section>}
      {section === 'products' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Product catalog</h2><p>Changes publish to the storefront as soon as they’re saved.</p></div>{!editing && <button className="primary-button" onClick={newProduct}><Plus size={16} /> Add product</button>}</div>
        {editing ? <form className="admin-form admin-panel" onSubmit={saveProduct}><div className="admin-panel-heading"><h3>{draft.id ? 'Edit fragrance' : 'Add fragrance'}</h3><button type="button" className="icon-button" onClick={() => setEditing(false)} aria-label="Close product form"><X size={19} /></button></div>
          <div className="admin-form-grid"><label className="form-label">Product name<input required value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value, id: current.id || makeSlug(e.target.value) }))} /></label><label className="form-label">Brand<input required value={draft.brand} onChange={(e) => setDraft((current) => ({ ...current, brand: e.target.value }))} /></label>
            <label className="form-label">Price (GH₵)<input required type="number" min="0" step="1" value={draft.price} onChange={(e) => setDraft((current) => ({ ...current, price: Number(e.target.value) }))} /></label><label className="form-label">Stock quantity<input required type="number" min="0" step="1" value={draft.stock} onChange={(e) => setDraft((current) => ({ ...current, stock: Number(e.target.value) }))} /></label>
            <fieldset className="admin-category-field"><legend>Categories <span>Select all that apply</span></legend><div className="admin-category-options">{fragranceCategories.map((category) => <label key={category}><input type="checkbox" checked={getFragranceCategories(draft).includes(category)} onChange={() => toggleProductCategory(category)} /><span>{category}</span></label>)}</div></fieldset><label className="form-label">Fragrance family<input required value={draft.family} onChange={(e) => setDraft((current) => ({ ...current, family: e.target.value }))} /></label>
            <label className="form-label">Concentration<input required value={draft.concentration} onChange={(e) => setDraft((current) => ({ ...current, concentration: e.target.value }))} /></label>
            <label className="form-label">Collection badge<select value={draft.badge || ''} onChange={(e) => setDraft((current) => ({ ...current, badge: e.target.value || undefined }))}><option value="">No badge</option><option>BEST SELLER</option><option>TRENDING</option><option>NEW ARRIVAL</option><option>ICONIC</option></select></label><label className="form-label">Product ID<input required pattern="[a-z0-9][a-z0-9-]{1,79}" value={draft.id} onChange={(e) => setDraft((current) => ({ ...current, id: makeSlug(e.target.value) }))} /></label>
            <label className="form-label admin-span-two">Main product image URL<input required type="url" value={draft.image} onChange={(e) => setDraft((current) => ({ ...current, image: e.target.value }))} /></label>
            <label className="admin-upload-button"><ImagePlus size={17} />{uploadTarget === 'product' ? `Uploading… ${uploadProgress}%` : 'Upload product image (max 5 MB)'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void uploadImage(e.currentTarget.files?.[0], 'product'); e.currentTarget.value = ''; }} disabled={uploading} /></label>
            {uploadTarget === 'product' && <div className="admin-upload-status" role="status"><progress max="100" value={uploadProgress} /><span>{uploadProgress}% uploaded</span><button type="button" className="text-button" onClick={() => uploadRequest.current?.abort()}>Cancel upload</button></div>}
            {draft.image && <div className="admin-image-preview admin-product-image-preview"><img src={draft.image} alt="Product image preview" /><span>Product image preview</span></div>}
            <label className="admin-checkbox"><input type="checkbox" checked={draft.visible !== false} onChange={(e) => setDraft((current) => ({ ...current, visible: e.target.checked }))} /> Show this product in the storefront</label>
          </div><div className="admin-form-actions"><button type="button" className="outline-button" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="primary-button" disabled={busy || uploading}><Save size={15} />{busy ? 'Saving…' : 'Save product'}</button></div>
        </form> : <div className="admin-panel"><div className="admin-list-toolbar"><label className="admin-search"><Search size={16} /><input placeholder="Search products or brands" value={search} onChange={(e) => setSearch(e.target.value)} /></label><span>{visibleProducts.length} products</span></div>
          <div className="admin-product-list">{visibleProducts.map((product) => <article className="admin-product-row" key={product.id}><img src={product.image} alt="" /><div className="admin-product-info"><strong>{product.name}</strong><span>{product.brand} · {getFragranceCategories(product).join(', ')}</span><small>{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</small></div><b>{money(product.price)}</b><span className={`visibility-pill ${(product as Fragrance & { visible?: boolean }).visible === false ? 'hidden' : ''}`}>{(product as Fragrance & { visible?: boolean }).visible === false ? 'Hidden' : 'Live'}</span><button className="outline-button admin-edit-button" onClick={() => editProduct(product)}>Edit</button><button className="icon-button admin-delete-button" onClick={() => void removeProduct(product)} aria-label={`Delete ${product.name}`}><Trash2 size={16} /></button></article>)}{visibleProducts.length === 0 && <p className="admin-empty-note">No matching products. Add a fragrance or import development samples.</p>}</div></div>}
      </section>}
      {section === 'storefront' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Storefront presentation</h2><p>Update your homepage introduction and promotional announcement.</p></div></div><form className="admin-panel admin-settings-form" onSubmit={saveSettings}>
        <label className="form-label">Announcement bar text<input value={settingsDraft.announcement || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, announcement: e.target.value }))} placeholder="A short store announcement" /></label>
        <label className="form-label">Homepage hero heading<input value={settingsDraft.heroTitle || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, heroTitle: e.target.value }))} placeholder="Discover your signature scent." /></label>
        <label className="form-label">Homepage supporting text<textarea rows={3} value={settingsDraft.heroText || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, heroText: e.target.value }))} placeholder="A short brand introduction" /></label>
        <label className="form-label">Hero image URL<input type="url" value={settingsDraft.heroImage || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, heroImage: e.target.value }))} placeholder="https://…" /></label>
        <label className="admin-upload-button"><ImagePlus size={17} />{uploadTarget === 'hero' ? `Uploading… ${uploadProgress}%` : 'Upload homepage hero image (max 5 MB)'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void uploadImage(e.currentTarget.files?.[0], 'hero'); e.currentTarget.value = ''; }} disabled={uploading} /></label>
        {uploadTarget === 'hero' && <div className="admin-upload-status" role="status"><progress max="100" value={uploadProgress} /><span>{uploadProgress}% uploaded</span><button type="button" className="text-button" onClick={() => uploadRequest.current?.abort()}>Cancel upload</button></div>}
        <label className="form-label">Hero caption<input value={settingsDraft.heroCaption || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, heroCaption: e.target.value }))} placeholder="THE ART OF SCENT · ACCRA, GHANA" /></label>
        <label className="form-label">Footer introduction<input value={settingsDraft.footerText || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, footerText: e.target.value }))} placeholder="Exceptional fragrance, thoughtfully found." /></label>
        {settingsDraft.heroImage && <div className="admin-image-preview"><img src={settingsDraft.heroImage} alt="Homepage hero preview" /><span>Current preview</span></div>}
        <div className="admin-form-actions"><button type="button" className="outline-button" onClick={() => setSettingsDraft(settings)}>Discard changes</button><button className="primary-button" type="submit" disabled={busy || uploading}><Save size={15} />{busy ? 'Publishing…' : 'Publish storefront'}</button></div>
      </form></section>}
      {section === 'feedback' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Customer feedback</h2><p>Messages submitted from the storefront, updating live.</p></div><span className="feedback-count">{newFeedbackCount} new</span></div>
        <div className="admin-feedback-list">{feedback.map((item) => <article className="admin-feedback-card" key={item.id}><div className="admin-feedback-head"><div><span className={`feedback-status ${item.status}`}>{item.status}</span><h3>{item.name || 'Guest customer'}</h3><p>{item.email || 'No email provided'}{item.createdAt ? ` · ${item.createdAt.toDate().toLocaleString()}` : ''}</p></div></div><blockquote>{item.message}</blockquote><div className="admin-feedback-actions">{item.status !== 'resolved' && <button className="outline-button" onClick={() => void updateFeedbackStatus(item, 'resolved')}><Check size={14} /> Mark resolved</button>}{item.status === 'new' && <button className="text-button" onClick={() => void updateFeedbackStatus(item, 'read')}>Mark as read</button>}</div></article>)}{feedback.length === 0 && <div className="admin-panel admin-empty-note">No feedback yet. Customer messages from the main storefront will appear here.</div>}</div>
      </section>}
    </div>
  </main>;
}
