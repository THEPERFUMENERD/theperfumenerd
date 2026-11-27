import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Banknote, CalendarDays, Check, ChevronDown, ClipboardList, Clock3, Image as ImageIcon, ImagePlus, LayoutDashboard, MessageSquare, Package, PackageX, Percent, Plus, Printer, Save, Search, Settings, ShoppingBag, ShoppingCart, Trash2, TrendingUp, Truck, Users, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from './firebase';
import { orderApi } from './order-api';
import { filterOrdersByDateRange, formatOrderDateTime, formatOrderDay, formatOrderId, groupOrdersByDay, isFulfillmentAttended, localDateInputValue, searchOrders } from './order-management';
import { getAdminOverviewMetrics, getRecentRevenue, revenueBarHeight } from './admin-overview';
import { LoadedImage } from './LoadedImage';
import { fragranceCategories, fragranceFamilies, getFragranceCategories, getFragranceFamilies, getProductType, isPerfumeProduct, money, productTypes, products as sampleProducts, type Fragrance, type FragranceFamily } from './catalog';
import { cacheStorefrontSettings, defaultCollectionHeroSettings, defaultCollectionSettings, defaultFinderSettings, defaultHeroSettings, type StorefrontSettings } from './storefront-data';

type AdminSection = 'overview' | 'products' | 'orders' | 'users' | 'discount-sales' | 'website-images' | 'storefront' | 'feedback';
type ImageUploadTarget = 'hero' | 'collectionHero' | 'collectionMen' | 'collectionWomen' | 'collectionUnisex' | 'finder';
type UploadTarget = 'product' | ImageUploadTarget;
type FeedbackItem = { id: string; message: string; name?: string; email?: string; status: string; createdAt?: { toDate: () => Date } };
type ProductDraft = Omit<Fragrance, 'id'> & { id: string; visible?: boolean };
type UploadError = Error & { code?: string };
type AdminOrder = {
  orderId: string;
  customer: { name: string; email: string; phone: string; address: string; city: string; region: string; postalCode?: string };
  items: { productId: string; name: string; brand: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  totalMinor: number;
  paymentStatus: string;
  status: string;
  createdAt?: { toDate?: () => Date };
};
type AdminSale = {
  id: string;
  totalMinor: number;
  paymentStatus: string;
  status: string;
  createdAt?: { toDate?: () => Date };
};
type AdminUser = { uid: string; name: string; email: string; phoneNumber: string; createdAt: string };
const blankProduct: ProductDraft = {
  id: '', name: '', brand: '', price: 0, category: 'Unisex', categories: ['Unisex'], productType: 'Perfume', family: 'Woody', families: ['Woody'],
  strength: 'Moderate', concentration: 'Eau de Parfum', notes: [], occasion: [],
  description: '', image: '', badge: '', stock: 0,
};
const makeSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uploadError = (message: string, code: string): UploadError => Object.assign(new Error(message), { code });
const websiteImageFields: (keyof StorefrontSettings)[] = [
  'heroImage', 'heroTitle', 'heroText', 'heroCaption', 'heroButtonText',
  'collectionMenTitle', 'collectionMenSubtitle', 'collectionMenImage',
  'collectionWomenTitle', 'collectionWomenSubtitle', 'collectionWomenImage',
  'collectionUnisexTitle', 'collectionUnisexSubtitle', 'collectionUnisexImage',
  'finderEyebrow', 'finderTitle', 'finderText', 'finderButtonText', 'finderImage', 'finderCaption',
  'collectionHeroEyebrow', 'collectionHeroTitle', 'collectionHeroText', 'collectionHeroImage', 'collectionHeroCaption',
];

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
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [sales, setSales] = useState<AdminSale[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [nextUsersPage, setNextUsersPage] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(blankProduct);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printStartDate, setPrintStartDate] = useState('');
  const [printEndDate, setPrintEndDate] = useState('');
  const [printSelectingEnd, setPrintSelectingEnd] = useState(false);
  const [printCalendarMonth, setPrintCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
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
    const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const stopOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map((entry) => ({ ...entry.data(), orderId: entry.id }) as AdminOrder));
    }, (reason) => {
      console.error('Admin order listener failed.', reason);
      setError('Could not load customer orders. Publish the latest Firestore rules and confirm administrator access.');
    });
    const salesQuery = query(collection(db, 'sales'), orderBy('createdAt', 'desc'));
    const stopSales = onSnapshot(salesQuery, (snapshot) => {
      setSales(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as AdminSale));
    }, (reason) => {
      console.error('Admin POS sales listener failed.', reason);
      setError('Could not load POS sales for the dashboard. Confirm administrator access and Firestore rules.');
    });
    return () => { stopProducts(); stopSettings(); stopFeedback(); stopOrders(); stopSales(); };
  }, [isAdmin]);

  useEffect(() => {
    if (section !== 'users' || !isAdmin) return;
    let active = true;
    setUsersLoading(true);
    setError('');
    orderApi<{ users: AdminUser[]; nextPageToken: string | null; totalUsers: number }>(
      '/api/admin/users',
      {},
    ).then((data) => {
      if (!active) return;
      setAdminUsers(data.users);
      setTotalUsers(data.totalUsers);
      setNextUsersPage(data.nextPageToken);
    }).catch((reason: unknown) => {
      console.error('Could not load registered customer accounts.', reason);
      if (active) setError('The registered user list could not be loaded. Confirm administrator access and the order API deployment.');
    }).finally(() => {
      if (active) setUsersLoading(false);
    });
    return () => { active = false; };
  }, [section, isAdmin]);

  useEffect(() => {
    if (section !== 'overview' || !isAdmin || totalUsers !== null) return;
    let active = true;
    setUsersLoading(true);
    orderApi<{ users: AdminUser[]; nextPageToken: string | null; totalUsers: number }>(
      '/api/admin/users',
      {},
    ).then((data) => {
      if (!active) return;
      setTotalUsers(data.totalUsers);
      setAdminUsers(data.users);
      setNextUsersPage(data.nextPageToken);
    }).catch((reason: unknown) => {
      console.error('Could not load the dashboard customer count.', reason);
      if (active) setError('Customer account totals are temporarily unavailable.');
    }).finally(() => {
      if (active) setUsersLoading(false);
    });
    return () => { active = false; };
  }, [section, isAdmin, totalUsers]);

  const visibleProducts = useMemo(() => products.filter((item) =>
    `${item.name} ${item.brand}`.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const filteredOrders = useMemo(() => searchOrders(orders, orderSearch), [orders, orderSearch]);
  const groupedOrders = useMemo(() => groupOrdersByDay(filteredOrders), [filteredOrders]);
  const selectedPrintOrders = useMemo(
    () => filterOrdersByDateRange(orders, printStartDate, printEndDate || printStartDate),
    [orders, printStartDate, printEndDate],
  );
  const selectedPrintOrderGroups = useMemo(() => groupOrdersByDay(selectedPrintOrders), [selectedPrintOrders]);
  const newFeedbackCount = feedback.filter((item) => item.status === 'new').length;
  const todayKey = localDateInputValue(new Date());
  const overviewMetrics = useMemo(() => getAdminOverviewMetrics(orders, sales, todayKey), [orders, sales, todayKey]);
  const revenueHistory = useMemo(() => getRecentRevenue(orders, sales, todayKey), [orders, sales, todayKey]);
  const maxDailyRevenue = Math.max(...revenueHistory.map((entry) => entry.revenueMinor), 0);
  const lowStockProducts = products
    .filter((product) => (product as Fragrance & { visible?: boolean }).visible !== false && product.stock <= 3)
    .sort((left, right) => left.stock - right.stock);
  const liveProductCount = products.filter((product) => (product as Fragrance & { visible?: boolean }).visible !== false).length;
  const outOfStockCount = lowStockProducts.filter((product) => product.stock === 0).length;
  const fail = (reason: unknown, fallback: string) => {
    console.error(fallback, reason);
    setError(fallback);
  };
  const clearAlerts = () => { setError(''); setMessage(''); setUploadFeedback(null); };
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
  const toggleProductFamily = (family: FragranceFamily) => {
    const currentFamilies = getFragranceFamilies(draft);
    const families = currentFamilies.includes(family)
      ? currentFamilies.filter((item) => item !== family)
      : [...currentFamilies, family];
    setError('');
    setDraft((current) => ({ ...current, family: families.join(', '), families }));
  };
  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    if (!db || !user) {
      setError('Your administrator session is unavailable. Sign in again before saving this product.');
      return;
    }
    const id = draft.id || makeSlug(draft.name);
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id)) {
      setError('Use a product name that creates a URL-friendly ID with at least two characters.');
      return;
    }
    const productType = getProductType(draft);
    const isPerfume = isPerfumeProduct(draft);
    const families = isPerfume ? getFragranceFamilies(draft) : [];
    if (!productTypes.includes(draft.productType ?? 'Perfume')
      || !draft.name.trim() || !draft.brand.trim()
      || (isPerfume && (families.length === 0 || !draft.concentration.trim()))) {
      setError(isPerfume
        ? 'Complete the product name, brand, fragrance family, and concentration before saving.'
        : 'Choose a valid product type and complete the product name and brand before saving.');
      return;
    }
    if (!Number.isSafeInteger(Number(draft.price)) || Number(draft.price) < 0) {
      setError('Enter a valid product price in whole Ghana cedis.');
      return;
    }
    if (!Number.isSafeInteger(Number(draft.stock)) || Number(draft.stock) < 0) {
      setError('Enter a valid whole-number stock quantity.');
      return;
    }
    try {
      const imageUrl = new URL(draft.image.trim());
      if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') throw new Error('Unsupported image URL protocol.');
    } catch {
      setError('Add a valid product image URL or upload an image before saving.');
      return;
    }
    setBusy(true);
    try {
      const { id: _id, ...data } = draft;
      const categories = getFragranceCategories(data);
      if (!data.badge) delete data.badge;
      await setDoc(doc(db, 'products', id), {
        ...data,
        productType,
        family: families.join(', '),
        families,
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
  const uploadImage = async (file: File | undefined, target: UploadTarget) => {
    if (!file) return;
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = target === 'product'
      ? import.meta.env.VITE_CLOUDINARY_PRODUCT_UPLOAD_PRESET || import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
      : import.meta.env.VITE_CLOUDINARY_STOREFRONT_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset || !user) {
      const text = !user
        ? 'Your administrator session is unavailable. Sign in again before uploading an image.'
        : 'Image uploads are not configured. Add the Cloudinary cloud name and product upload preset to .env.local, run the Cloudinary setup command, then restart the app.';
      setError(text);
      setUploadFeedback({ type: 'error', text });
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      const text = 'Choose a JPG, PNG, or WebP image under 5 MB.';
      setError(text);
      setUploadFeedback({ type: 'error', text });
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
      if (target === 'product') {
        setDraft((current) => ({ ...current, image: uploadedUrl }));
      } else {
        const imageField = target === 'hero' ? 'heroImage' : target === 'finder' ? 'finderImage' : `${target}Image` as keyof StorefrontSettings;
        setSettingsDraft((current) => ({ ...current, [imageField]: uploadedUrl }));
      }
      const text = target === 'product'
        ? 'Image uploaded to Cloudinary. Save the product to publish it.'
        : 'Image uploaded to Cloudinary. Publish the website images to make it live.';
      setMessage(text);
      setUploadFeedback({ type: 'success', text });
    } catch (reason: unknown) {
      const code = typeof reason === 'object' && reason !== null && 'code' in reason
        ? String(reason.code) : '';
      if (code === 'canceled') {
        const text = 'Image upload canceled.';
        setMessage(text);
        setUploadFeedback({ type: 'error', text });
      } else if (code === 'network-request-failed') {
        const text = 'The connection to Cloudinary failed. Check your network and Cloudinary availability.';
        fail(reason, text);
        setUploadFeedback({ type: 'error', text });
      } else {
        const text = reason instanceof Error
          ? `Cloudinary upload failed${code ? ` (${code})` : ''}: ${reason.message}`
          : `Cloudinary upload failed${code ? ` (${code})` : ''}. Check Cloudinary configuration and try again.`;
        fail(reason, text);
        setUploadFeedback({ type: 'error', text });
      }
    } finally {
      if (uploadRequest.current === request) uploadRequest.current = null;
      setUploading(false);
      setUploadTarget(null);
      setUploadProgress(0);
    }
  };
  const saveSettings = async (event: FormEvent<HTMLFormElement>, fields: (keyof StorefrontSettings)[]) => {
    event.preventDefault();
    if (!db || !user) return;
    setBusy(true);
    clearAlerts();
    try {
      const updatedSettings = Object.fromEntries(fields.map((field) => [field, settingsDraft[field] ?? '']));
      await setDoc(doc(db, 'storeSettings', 'public'), {
        ...updatedSettings,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
      cacheStorefrontSettings(updatedSettings);
      setMessage(fields.includes('heroImage')
        ? 'Website images and homepage header published.'
        : 'Storefront content saved and published.');
    } catch (reason) {
      fail(reason, 'Storefront settings could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const saveDiscountSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !user) return;
    const mode = settingsDraft.discountMode ?? 'none';
    const percentage = Number(settingsDraft.discountPercentage);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const discountProducts = settingsDraft.discountProducts ?? [];
    if (mode === 'all' && (!Number.isSafeInteger(percentage) || percentage < 1 || percentage > 95)) {
      setError('Choose an all-products discount between 1% and 95%.');
      return;
    }
    if (mode === 'selected') {
      if (discountProducts.length === 0) {
        setError('Add at least one published product before activating selected-product sales.');
        return;
      }
      const invalid = discountProducts.some((item) => {
        const product = productsById.get(item.productId);
        const salePrice = Math.round(Number(item.salePrice));
        return !product || (product as Fragrance & { visible?: boolean }).visible !== true
          || !Number.isFinite(item.salePrice) || salePrice < 1 || salePrice >= product.price;
      });
      if (invalid) {
        setError('Each sale price must be a whole Ghana cedi below the current price of a published product. Remove unavailable products or update their sale price.');
        return;
      }
    }
    setBusy(true);
    clearAlerts();
    try {
      await setDoc(doc(db, 'storeSettings', 'public'), {
        discountMode: mode,
        discountPercentage: Number.isSafeInteger(percentage) ? percentage : 15,
        discountProducts: discountProducts.map((item) => ({
          productId: item.productId,
          salePrice: Math.round(Number(item.salePrice)),
        })),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
      cacheStorefrontSettings({
        discountMode: mode,
        discountPercentage: Number.isSafeInteger(percentage) ? percentage : 15,
        discountProducts: discountProducts.map((item) => ({
          productId: item.productId,
          salePrice: Math.round(Number(item.salePrice)),
        })),
      });
      setMessage(mode === 'none' ? 'Discount sales are now turned off.' : 'Discount sale published. Storefront prices are updating live.');
    } catch (reason) {
      fail(reason, 'Discount sale settings could not be published.');
    } finally {
      setBusy(false);
    }
  };
  const imageUploadControl = (target: ImageUploadTarget, label: string) => <>
    <label className="admin-upload-button"><ImagePlus size={17} />{uploadTarget === target ? `Uploading… ${uploadProgress}%` : label}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void uploadImage(event.currentTarget.files?.[0], target); event.currentTarget.value = ''; }} disabled={uploading} /></label>
    {uploadTarget === target && <div className="admin-upload-status" role="status"><progress max="100" value={uploadProgress} /><span>{uploadProgress}% uploaded</span><button type="button" className="text-button" onClick={() => uploadRequest.current?.abort()}>Cancel upload</button></div>}
  </>;
  const updateFeedbackStatus = async (item: FeedbackItem, status: 'read' | 'resolved') => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'feedback', item.id), { status, updatedAt: serverTimestamp() });
    } catch (reason) {
      fail(reason, 'Feedback status could not be updated.');
    }
  };
  const updateOrderStatus = async (orderId: string, status: string) => {
    setUpdatingOrderId(orderId);
    clearAlerts();
    try {
      const result = await orderApi<{ smsStatus: string }>('/api/admin/orders/status', { orderId, status });
      setMessage(`Order ${orderId} updated.`);
      if (result.smsStatus === 'failed') {
        setError('The order status was updated, but its SMS notification could not be sent.');
      }
    } catch (reason) {
      fail(reason, 'Order status could not be updated. Confirm the order is paid and try again.');
    } finally {
      setUpdatingOrderId(null);
    }
  };
  const loadMoreUsers = async () => {
    if (!nextUsersPage) return;
    setUsersLoading(true);
    clearAlerts();
    try {
      const data = await orderApi<{
        users: AdminUser[];
        nextPageToken: string | null;
        totalUsers: number;
      }>('/api/admin/users', { pageToken: nextUsersPage });
      setAdminUsers((current) => [...current, ...data.users]);
      setTotalUsers(data.totalUsers);
      setNextUsersPage(data.nextPageToken);
    } catch (reason) {
      fail(reason, 'More registered users could not be loaded.');
    } finally {
      setUsersLoading(false);
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
  useEffect(() => {
    if (!printDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPrintDialogOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [printDialogOpen]);
  useEffect(() => {
    if (!printDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPrintDialogOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [printDialogOpen]);
  const selectPrintCalendarDate = (date: string) => {
    if (!printSelectingEnd || !printStartDate) {
      setPrintStartDate(date);
      setPrintEndDate('');
      setPrintSelectingEnd(true);
      return;
    }
    if (date < printStartDate) {
      setPrintStartDate(date);
      setPrintEndDate('');
      return;
    }
    setPrintEndDate(date);
    setPrintSelectingEnd(false);
  };
  const resetPrintDateRange = () => {
    setPrintStartDate('');
    setPrintEndDate('');
    setPrintSelectingEnd(false);
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
  if (!isFirebaseConfigured || !db) return <main className="admin-guard"><p>Firebase Firestore must be configured for the admin workspace.</p></main>;

  const sections: { id: AdminSection; label: string; icon: typeof Package }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'discount-sales', label: 'Discount Sales', icon: Percent },
    { id: 'website-images', label: 'Website Images', icon: ImageIcon },
    { id: 'storefront', label: 'Storefront', icon: Settings },
    { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  ];
  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/" aria-label="The Perfume Nerd storefront"><img src="/IMAGES/PERFUME-NERD-LOGO.png" alt="" /><span>THE PERFUME NERD<small>ADMIN STUDIO</small></span></a>
      <div className="admin-menu-label">WORKSPACE</div>
      <nav className="admin-nav"><button onClick={onPos}><ShoppingCart size={17} />Point of Sale</button>{sections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'selected' : ''} onClick={() => { setSection(id); setEditing(false); clearAlerts(); }}><Icon size={17} />{label}{id === 'feedback' && newFeedbackCount > 0 && <span className="admin-nav-count">{newFeedbackCount}</span>}{id === 'orders' && orders.filter((order) => order.paymentStatus === 'paid' && order.status !== 'delivered').length > 0 && <span className="admin-nav-count">{orders.filter((order) => order.paymentStatus === 'paid' && order.status !== 'delivered').length}</span>}</button>)}</nav>
      <div className="admin-sidebar-bottom"><span className="admin-user-avatar">{(user.displayName || user.email || 'A').slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName || 'Administrator'}</strong><small>{user.email}</small></div></div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><div><span className="eyebrow">THE PERFUME NERD</span><h1>{sections.find((item) => item.id === section)?.label}</h1></div><div className="admin-top-actions"><a className="outline-button admin-store-link" href="/" onClick={(event) => { event.preventDefault(); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}><ArrowLeft size={15} /> View storefront</a><button className="admin-signout" onClick={() => void logoutAdmin()}>Sign out</button></div></header>
      {(error || message) && <div className={`admin-alert ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || message}<button onClick={clearAlerts} aria-label="Dismiss message"><X size={15} /></button></div>}
      {section === 'overview' && <section className="admin-content admin-overview-content">
        <div className="admin-welcome admin-overview-welcome"><div><div className="admin-overview-kicker"><span className="admin-live-dot" /> LIVE STORE OVERVIEW <span>ACCRA · GHANA</span></div><h2>Good to have you back.</h2><p>Your sales, orders and store operations at a glance.</p></div><div className="admin-overview-actions"><span className="admin-overview-date">{new Intl.DateTimeFormat(undefined, { timeZone: 'Africa/Accra', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span><button className="primary-button" onClick={newProduct}><Plus size={16} /> Add a product</button></div></div>
        <div className="admin-overview-section-label"><span>BUSINESS PERFORMANCE</span><small>All revenue in Ghana cedis · paid orders and completed POS sales</small></div>
        <div className="admin-stat-grid admin-overview-stats">
          <article className="admin-stat-revenue"><span><Banknote size={16} /> TOTAL REVENUE</span><strong>{money(overviewMetrics.revenueMinor / 100)}</strong><small>All-time confirmed sales</small></article>
          <article className="admin-stat-today"><span><TrendingUp size={16} /> TODAY'S REVENUE</span><strong>{money(overviewMetrics.todayRevenueMinor / 100)}</strong><small>Accra business day</small></article>
          <article><span><ClipboardList size={16} /> TOTAL ORDERS</span><strong>{overviewMetrics.totalOrders}</strong><small>Online orders + POS sales</small></article>
          <article><span><Clock3 size={16} /> TODAY'S ORDERS</span><strong>{overviewMetrics.todayOrders}</strong><small>{overviewMetrics.posSalesToday} POS sales today</small></article>
          <article><span><Truck size={16} /> TO FULFIL</span><strong>{overviewMetrics.activeFulfillment}</strong><small>Paid, not yet delivered</small></article>
          <article><span><Clock3 size={16} /> AWAITING PAYMENT</span><strong>{overviewMetrics.pendingPayment}</strong><small>Online payment pending</small></article>
          <article><span><ShoppingCart size={16} /> POS SALES TODAY</span><strong>{overviewMetrics.posSalesToday}</strong><small>Completed cash transactions</small></article>
          <article><span><ShoppingBag size={16} /> LIVE PRODUCTS</span><strong>{liveProductCount}</strong><small>Published in the storefront</small></article>
          <article><span><PackageX size={16} /> LOW STOCK</span><strong>{lowStockProducts.length}</strong><small>Visible products with 3 or fewer</small></article>
          <article><span><PackageX size={16} /> OUT OF STOCK</span><strong>{outOfStockCount}</strong><small>Visible items unavailable to buy</small></article>
          <article><span><MessageSquare size={16} /> NEW FEEDBACK</span><strong>{newFeedbackCount}</strong><small>Messages awaiting review</small></article>
          <article><span><Users size={16} /> CUSTOMERS</span><strong>{totalUsers === null ? (usersLoading ? '…' : 'Not available') : totalUsers}</strong><small>Registered accounts</small></article>
        </div>
        <div className="admin-overview-main-grid">
          <section className="admin-panel admin-revenue-panel">
            <div className="admin-panel-heading"><div><span className="admin-panel-kicker">REVENUE</span><h3>Last seven days</h3></div><span className="admin-panel-period">GHS</span></div>
            <div className="admin-revenue-chart" role="img" aria-label="Daily confirmed online and POS revenue for the last seven days">
              {revenueHistory.map(({ date, revenueMinor }) => <div className="admin-revenue-day" key={date} title={`${formatOrderDay(date)}: ${money(revenueMinor / 100)}`}>
                <div className="admin-revenue-bar-track"><span className={revenueMinor > 0 ? 'has-revenue' : ''} style={{ height: `${revenueBarHeight(revenueMinor, maxDailyRevenue)}%` }} /></div>
                <small>{new Intl.DateTimeFormat(undefined, { timeZone: 'Africa/Accra', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`))}</small>
                <strong>{money(revenueMinor / 100)}</strong>
              </div>)}
            </div>
            <p className="admin-chart-caption">Revenue counts successful online payments and completed POS cash sales only.</p>
          </section>
          <section className="admin-panel admin-activity-panel">
            <div className="admin-panel-heading"><div><span className="admin-panel-kicker">ORDER ACTIVITY</span><h3>Recent orders</h3></div><button className="text-button" onClick={() => setSection('orders')}>View all <ArrowRight size={14} /></button></div>
            {orders.slice(0, 5).map((order) => <button type="button" className="admin-overview-order" key={order.orderId} onClick={() => setSection('orders')}>
              <span className={`admin-activity-indicator ${order.paymentStatus === 'paid' ? 'paid' : ''}`} />
              <span className="admin-overview-order-copy"><strong>{order.customer.name || 'Customer order'}</strong><small>{formatOrderId(order.orderId)} · {formatOrderDateTime(order.createdAt)}</small></span>
              <span className="admin-overview-order-total">{money(order.totalMinor / 100)}<small>{order.paymentStatus.replaceAll('_', ' ')}</small></span>
            </button>)}
            {orders.length === 0 && <p className="admin-empty-note">New online orders will appear here.</p>}
          </section>
        </div>
        <div className="admin-overview-lower-grid">
          <section className="admin-panel admin-inventory-panel">
            <div className="admin-panel-heading"><div><span className="admin-panel-kicker">INVENTORY</span><h3>Stock watch</h3></div><button className="text-button" onClick={() => setSection('products')}>Manage products <ArrowRight size={14} /></button></div>
            {lowStockProducts.slice(0, 5).map((product) => <div className="admin-stock-row" key={product.id}><span className={`admin-stock-indicator ${product.stock === 0 ? 'empty' : ''}`} /><span><strong>{product.name}</strong><small>{product.brand}</small></span><b className={product.stock === 0 ? 'out' : ''}>{product.stock === 0 ? 'Out of stock' : `${product.stock} left`}</b></div>)}
            {lowStockProducts.length === 0 && <p className="admin-empty-note">No visible products are at low stock.</p>}
          </section>
          <section className="admin-panel admin-feedback-panel">
            <div className="admin-panel-heading"><div><span className="admin-panel-kicker">CUSTOMER VOICE</span><h3>Latest feedback</h3></div><button className="text-button" onClick={() => setSection('feedback')}>Open inbox <ArrowRight size={14} /></button></div>
            {feedback.slice(0, 3).map((item) => <article className="admin-feedback-mini" key={item.id}><span className={`feedback-status ${item.status}`}>{item.status}</span><p>{item.message}</p><small>{item.name || 'Guest'}{item.email ? ` · ${item.email}` : ''}</small></article>)}
            {feedback.length === 0 && <p className="admin-empty-note">Customer feedback from the storefront will appear here.</p>}
          </section>
        </div>
        <section className="admin-overview-quick-links"><span>STORE STATUS</span><b>{settings.heroTitle ? 'Storefront content published' : 'Storefront content needs attention'}</b><button className="text-button" onClick={() => setSection('storefront')}>Review storefront <ArrowRight size={14} /></button><button className="admin-sample-link" onClick={seedSamples} disabled={busy}>Import development sample products</button></section>
      </section>}
      {section === 'products' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Product catalog</h2><p>Changes publish to the storefront as soon as they’re saved.</p></div>{!editing && <button className="primary-button" onClick={newProduct}><Plus size={16} /> Add product</button>}</div>
        {editing ? <form className="admin-form admin-panel" noValidate onSubmit={saveProduct}><div className="admin-panel-heading"><h3>{draft.id ? 'Edit fragrance' : 'Add fragrance'}</h3><button type="button" className="icon-button" onClick={() => setEditing(false)} aria-label="Close product form"><X size={19} /></button></div>
          <div className="admin-form-grid"><label className="form-label">Product name<input required value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value, id: current.id || makeSlug(e.target.value) }))} /></label><label className="form-label">Brand<input required value={draft.brand} onChange={(e) => setDraft((current) => ({ ...current, brand: e.target.value }))} /></label>
            <label className="form-label">Product type<select value={getProductType(draft)} onChange={(event) => {
              const productType = event.target.value as typeof productTypes[number];
              setDraft((current) => ({
                ...current,
                productType,
                family: productType === 'Perfume' ? 'Woody' : '',
                families: productType === 'Perfume' ? ['Woody'] : [],
                strength: 'Moderate',
                concentration: productType === 'Perfume' ? 'Eau de Parfum' : '',
                notes: [],
                occasion: [],
              }));
            }}>{productTypes.map((productType) => <option key={productType} value={productType}>{productType}</option>)}</select></label>
            <label className="form-label">Price (GH₵)<input required type="number" min="0" step="1" value={draft.price} onChange={(e) => setDraft((current) => ({ ...current, price: Number(e.target.value) }))} /></label><label className="form-label">Stock quantity<input required type="number" min="0" step="1" value={draft.stock} onChange={(e) => setDraft((current) => ({ ...current, stock: Number(e.target.value) }))} /></label>
            <fieldset className="admin-category-field"><legend>Categories <span>Select all that apply</span></legend><div className="admin-category-options">{fragranceCategories.map((category) => <label key={category}><input type="checkbox" checked={getFragranceCategories(draft).includes(category)} onChange={() => toggleProductCategory(category)} /><span>{category}</span></label>)}</div></fieldset>
            {isPerfumeProduct(draft) && <><div className="form-label admin-family-field"><span>Fragrance family</span><details className="admin-family-select"><summary aria-label="Choose fragrance families"><span>{getFragranceFamilies(draft).join(', ') || 'Choose one or more families'}</span><ChevronDown size={15} /></summary><div className="admin-family-options">{fragranceFamilies.map((family) => <label key={family}><input type="checkbox" checked={getFragranceFamilies(draft).includes(family)} onChange={() => toggleProductFamily(family)} />{family}</label>)}</div></details><small>Select one or more families.</small></div>
            <label className="form-label">Concentration<input required value={draft.concentration} onChange={(e) => setDraft((current) => ({ ...current, concentration: e.target.value }))} /></label></>}
            <label className="form-label">Collection badge<select value={draft.badge || ''} onChange={(e) => setDraft((current) => ({ ...current, badge: e.target.value || undefined }))}><option value="">No badge</option><option>BEST SELLER</option><option>TRENDING</option><option>NEW ARRIVAL</option><option>ICONIC</option></select></label><label className="form-label">Product ID<input required pattern="[a-z0-9][a-z0-9-]{1,79}" value={draft.id} onChange={(e) => setDraft((current) => ({ ...current, id: makeSlug(e.target.value) }))} /></label>
            <label className="form-label admin-span-two">Main product image URL<input required type="url" value={draft.image} onChange={(e) => setDraft((current) => ({ ...current, image: e.target.value }))} /></label>
            <label className="admin-upload-button"><ImagePlus size={17} />{uploadTarget === 'product' ? `Uploading… ${uploadProgress}%` : 'Upload product image (max 5 MB)'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void uploadImage(e.currentTarget.files?.[0], 'product'); e.currentTarget.value = ''; }} disabled={uploading} /></label>
            {uploadFeedback && <p className={`admin-upload-feedback ${uploadFeedback.type}`} role={uploadFeedback.type === 'error' ? 'alert' : 'status'}>{uploadFeedback.text}</p>}
            {uploadTarget === 'product' && <div className="admin-upload-status" role="status"><progress max="100" value={uploadProgress} /><span>{uploadProgress}% uploaded</span><button type="button" className="text-button" onClick={() => uploadRequest.current?.abort()}>Cancel upload</button></div>}
            {draft.image && <div className="admin-image-preview admin-product-image-preview"><img src={draft.image} alt="Product image preview" /><span>Product image preview</span></div>}
            <label className="admin-checkbox"><input type="checkbox" checked={draft.visible !== false} onChange={(e) => setDraft((current) => ({ ...current, visible: e.target.checked }))} /> Show this product in the storefront</label>
          </div><div className="admin-form-actions"><button type="button" className="outline-button" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="primary-button" disabled={busy || uploading}><Save size={15} />{busy ? 'Saving…' : 'Save product'}</button></div>
        </form> : <div className="admin-panel"><div className="admin-list-toolbar"><label className="admin-search"><Search size={16} /><input placeholder="Search products or brands" value={search} onChange={(e) => setSearch(e.target.value)} /></label><span>{visibleProducts.length} products</span></div>
          <div className="admin-product-list">{visibleProducts.map((product) => <article className="admin-product-row" key={product.id}><img src={product.image} alt="" /><div className="admin-product-info"><strong>{product.name}</strong><span>{product.brand} · {getFragranceCategories(product).join(', ')}{!isPerfumeProduct(product) ? ` · ${getProductType(product)}` : ''}</span><small>{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</small></div><b>{money(product.price)}</b><span className={`visibility-pill ${(product as Fragrance & { visible?: boolean }).visible === false ? 'hidden' : ''}`}>{(product as Fragrance & { visible?: boolean }).visible === false ? 'Hidden' : 'Live'}</span><button className="outline-button admin-edit-button" onClick={() => editProduct(product)}>Edit</button><button className="icon-button admin-delete-button" onClick={() => void removeProduct(product)} aria-label={`Delete ${product.name}`}><Trash2 size={16} /></button></article>)}{visibleProducts.length === 0 && <p className="admin-empty-note">No matching products. Add a fragrance or import development samples.</p>}</div></div>}
      </section>}
      {section === 'orders' && <section className="admin-content admin-orders-content"><div className="admin-section-heading"><div><h2>Customer orders</h2><p>Payment-confirmed orders and delivery details, updating live.</p></div><span className="feedback-count">{orders.length} total</span></div>
        <div className="admin-order-toolbar">
          <label className="admin-search"><Search size={16} /><input aria-label="Search orders" placeholder="Search order ID, customer, email or phone" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} /></label>
          <button type="button" className="outline-button admin-print-trigger" onClick={() => setPrintDialogOpen(true)}><Printer size={16} /> Print / Save daily PDF</button>
        </div>
        {groupedOrders.length > 0 ? groupedOrders.map(({ date, orders: dayOrders }) => <section className="admin-order-day" key={date}>
          <header className="admin-order-day-heading"><h3>{date === 'unknown' ? 'Date unavailable' : formatOrderDay(date)}</h3><span>{dayOrders.length} {dayOrders.length === 1 ? 'order' : 'orders'}</span></header>
          <div className="admin-orders-list">{dayOrders.map((order) => {
            const attended = isFulfillmentAttended(order.status);
            return <article className={`admin-order-card${attended ? ' attended' : ''}`} key={order.orderId}>
              <div className="admin-order-card-top">
                <details className="admin-order-disclosure">
                  <summary className="admin-order-summary"><span><small>ORDER ID</small><strong>{formatOrderId(order.orderId)}</strong></span><strong className="admin-order-summary-total">{money(order.totalMinor / 100)}</strong><ChevronDown size={17} className="admin-order-chevron" aria-hidden="true" /></summary>
                  <div className="admin-order-expanded">
                    <header className="admin-order-heading"><div><span className="eyebrow">ORDER DETAILS</span><strong>{formatOrderId(order.orderId)}</strong><small>{formatOrderDateTime(order.createdAt)}</small></div>
                      <div className="admin-order-controls"><span className={`order-status-pill ${order.paymentStatus === 'paid' ? 'paid' : ''}`}>{order.paymentStatus.replaceAll('_', ' ')}</span>
                        <label className="admin-status-select"><span>Fulfillment</span><select aria-label={`Update status for ${formatOrderId(order.orderId)}`} value={order.status} disabled={updatingOrderId !== null || order.paymentStatus !== 'paid'} onChange={(event) => void updateOrderStatus(order.orderId, event.target.value)}>
                          {!['paid_needs_review', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered'].includes(order.status) && <option value={order.status}>{order.status.replaceAll('_', ' ')}</option>}
                          {order.status === 'paid_needs_review' && <option value="paid_needs_review">Needs stock review</option>}
                          {['processing', 'ready_for_dispatch', 'dispatched', 'delivered'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                        </select></label>
                      </div>
                    </header>
                    <div className="admin-order-details"><section><h3>Customer & delivery</h3><p><strong>{order.customer.name}</strong></p><p>{order.customer.email} · {order.customer.phone}</p><p>{order.customer.address}, {order.customer.city}, {order.customer.region}{order.customer.postalCode ? ` · ${order.customer.postalCode}` : ''}</p></section>
                      <section><h3>Items purchased</h3>{order.items.map((item) => <p className="admin-order-item" key={item.productId}><span>{item.name} · {item.brand} × {item.quantity}</span><strong>{money(item.lineTotalMinor / 100)}</strong></p>)}</section>
                    </div>
                    <footer className="admin-order-total"><span>{order.paymentStatus === 'paid' ? 'Amount paid · GHS' : 'Payment · GHS'}</span><strong>{money(order.totalMinor / 100)}</strong></footer>
                  </div>
                </details>
                {order.paymentStatus === 'paid' && (attended
                  ? <span className="admin-order-attended" role="status"><Check size={15} /> Attended to</span>
                  : order.status === 'processing' && <button type="button" className="admin-order-ready-button" disabled={updatingOrderId !== null} onClick={() => void updateOrderStatus(order.orderId, 'ready_for_dispatch')}><Truck size={15} />{updatingOrderId === order.orderId ? 'Updating…' : 'Ready to dispatch'}</button>)}
              </div>
            </article>;
          })}</div>
        </section>) : <div className="admin-panel admin-empty-note">{orders.length === 0 ? 'Customer orders will appear here after checkout.' : 'No orders match your search.'}</div>}
        <div className="admin-order-print-sheet" aria-hidden="true">
          <h1>THE PERFUME NERD | Daily Orders</h1>
          <h2>{printStartDate ? (printEndDate ? `${formatOrderDay(printStartDate)} – ${formatOrderDay(printEndDate)}` : formatOrderDay(printStartDate)) : 'No dates selected'}</h2>
          <p>{selectedPrintOrders.length} {selectedPrintOrders.length === 1 ? 'order' : 'orders'} across {selectedPrintOrderGroups.length} {selectedPrintOrderGroups.length === 1 ? 'day' : 'days'}</p>
          {selectedPrintOrderGroups.map(({ date, orders: dayOrders }) => <section className="admin-order-print-day" key={date}>
            <h3>{formatOrderDay(date)}</h3>
            {dayOrders.map((order) => <article className="admin-order-print-card" key={order.orderId}>
            <header><div><strong>{formatOrderId(order.orderId)}</strong><small>{formatOrderDateTime(order.createdAt)}</small></div><strong>{money(order.totalMinor / 100)}</strong></header>
            <p><strong>{order.customer.name}</strong><br />{order.customer.email} · {order.customer.phone}<br />{order.customer.address}, {order.customer.city}, {order.customer.region}{order.customer.postalCode ? ` · ${order.customer.postalCode}` : ''}</p>
            <ul>{order.items.map((item) => <li key={item.productId}>{item.name} · {item.brand} × {item.quantity} · {money(item.lineTotalMinor / 100)}</li>)}</ul>
            <footer>{order.paymentStatus.replaceAll('_', ' ')} · {order.status.replaceAll('_', ' ')}</footer>
            </article>)}
          </section>)}
        </div>
      </section>}
      {section === 'users' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Registered users</h2><p>Customer accounts and saved contact numbers.</p></div><span className="feedback-count">{totalUsers === null ? (usersLoading ? 'Loading…' : 'Not available') : `${totalUsers} total`}</span></div>
        <div className="admin-users-list">{adminUsers.map((account) => <article className="admin-user-row" key={account.uid}><span className="admin-user-avatar">{(account.name || account.email || 'U').slice(0, 1).toUpperCase()}</span><div><strong>{account.name || 'Name not provided'}</strong><span>{account.email || 'No email'} · {account.phoneNumber || 'No phone number'}</span></div></article>)}
          {usersLoading && <div className="admin-panel admin-empty-note">Loading customer accounts…</div>}
          {!usersLoading && adminUsers.length === 0 && <div className="admin-panel admin-empty-note">No registered users were found.</div>}
        </div>
        {nextUsersPage && <button className="outline-button admin-load-more" onClick={() => void loadMoreUsers()} disabled={usersLoading}>Load more users</button>}
      </section>}
      {section === 'discount-sales' && <section className="admin-content">
          <div className="admin-section-heading"><div><h2>Discount Sales</h2><p>Choose one live sale type. Storefront prices and cart totals update from published prices.</p></div></div>
          <form className="discount-sales-form" onSubmit={(event) => void saveDiscountSettings(event)}>
            <section className="admin-panel discount-mode-card">
              <div className="admin-panel-heading"><div><h3>All products</h3><span>Apply one percentage discount across every published fragrance.</span></div>
                <button type="button" className={`discount-switch ${settingsDraft.discountMode === 'all' ? 'enabled' : ''}`} role="switch" aria-checked={settingsDraft.discountMode === 'all'} aria-label="Enable all-products discount" onClick={() => setSettingsDraft((current) => ({ ...current, discountMode: current.discountMode === 'all' ? 'none' : 'all' }))}><span /></button>
              </div>
              <label className="discount-percent-control"><span>Discount percentage <strong>{settingsDraft.discountPercentage ?? 15}%</strong></span><input aria-label="All-products discount percentage" type="range" min="1" max="95" step="1" value={settingsDraft.discountPercentage ?? 15} onChange={(event) => setSettingsDraft((current) => ({ ...current, discountPercentage: Number(event.target.value) }))} /><span className="discount-percent-limits"><small>1%</small><small>95%</small></span></label>
              <p className="discount-hint">Prices are rounded to the nearest whole Ghana cedi after the discount is calculated.</p>
            </section>
            <section className="admin-panel discount-mode-card">
              <div className="admin-panel-heading"><div><h3>Selected products</h3><span>Add published products and set each sale price yourself.</span></div>
                <button type="button" className={`discount-switch ${settingsDraft.discountMode === 'selected' ? 'enabled' : ''}`} role="switch" aria-checked={settingsDraft.discountMode === 'selected'} aria-label="Enable selected-product discounts" onClick={() => setSettingsDraft((current) => ({ ...current, discountMode: current.discountMode === 'selected' ? 'none' : 'selected' }))}><span /></button>
              </div>
              <label className="form-label discount-product-picker">Add a published product<select value="" onChange={(event) => {
                const product = products.find((item) => item.id === event.target.value);
                if (!product) return;
                setSettingsDraft((current) => ({
                  ...current,
                  discountProducts: [...(current.discountProducts ?? []), {
                    productId: product.id,
                    salePrice: Math.max(1, Math.round(product.price * 0.85)),
                  }],
                }));
              }}>
                <option value="">Choose a product to add</option>
                {products.filter((product) => (product as Fragrance & { visible?: boolean }).visible === true
                  && !(settingsDraft.discountProducts ?? []).some((item) => item.productId === product.id))
                  .map((product) => <option key={product.id} value={product.id}>{product.name} · {product.brand}</option>)}
              </select></label>
              <div className="discount-product-list">
                {(settingsDraft.discountProducts ?? []).map((item) => {
                  const product = products.find((entry) => entry.id === item.productId);
                  return <article className="discount-product-row" key={item.productId}>
                    <div className="discount-product-copy"><strong>{product?.name || 'Product unavailable'}</strong><span>{product ? `${product.brand} · Current ${money(product.price)}` : 'Remove this entry or republish the product.'}</span></div>
                    <label className="discount-sale-price">Sale price (GH₵)<input type="number" min="1" max={product ? Math.ceil(product.price) - 1 : undefined} step="1" value={item.salePrice} onChange={(event) => setSettingsDraft((current) => ({
                      ...current,
                      discountProducts: (current.discountProducts ?? []).map((entry) => entry.productId === item.productId
                        ? { ...entry, salePrice: Number(event.target.value) }
                        : entry),
                    }))} /></label>
                    <button type="button" className="icon-button discount-remove" aria-label={`Remove ${product?.name || 'product'} from discounts`} onClick={() => setSettingsDraft((current) => ({
                      ...current,
                      discountProducts: (current.discountProducts ?? []).filter((entry) => entry.productId !== item.productId),
                    }))}><Trash2 size={16} /></button>
                  </article>;
                })}
                {(settingsDraft.discountProducts ?? []).length === 0 && <p className="admin-empty-note">No products added yet. Choose from published products above.</p>}
              </div>
            </section>
            <div className="admin-form-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => setSettingsDraft(settings)}>Discard changes</button><button type="submit" className="primary-button" disabled={busy}><Save size={15} />{busy ? 'Publishing…' : 'Publish discount sale'}</button></div>
          </form>
      </section>}
      {section === 'website-images' && <section className="admin-content">
        <div className="admin-section-heading"><div><h2>Website Images</h2><p>Customize the homepage header, collection cards, and fragrance finder. Preview your changes before publishing.</p></div></div>
        <form className="admin-panel admin-website-form" onSubmit={(event) => void saveSettings(event, websiteImageFields)}>
          <div className="website-image-layout">
            <div className="website-image-fields">
              <div className="admin-panel-heading"><h3>Homepage header content</h3></div>
              <label className="form-label">Header headline<textarea rows={2} maxLength={120} value={settingsDraft.heroTitle ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, heroTitle: event.target.value }))} placeholder={defaultHeroSettings.heroTitle} /><small>Use a new line to control where the headline wraps.</small></label>
              <label className="form-label">Supporting text<textarea rows={3} maxLength={240} value={settingsDraft.heroText ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, heroText: event.target.value }))} placeholder={defaultHeroSettings.heroText} /></label>
              <label className="form-label">Button text<input maxLength={40} value={settingsDraft.heroButtonText ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, heroButtonText: event.target.value }))} placeholder={defaultHeroSettings.heroButtonText} /></label>
              <label className="form-label">Image URL<input type="url" value={settingsDraft.heroImage ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, heroImage: event.target.value }))} placeholder="Paste an image URL or upload an image" /></label>
              {imageUploadControl('hero', 'Upload header image (max 5 MB)')}
              <label className="form-label">Small image caption<input maxLength={100} value={settingsDraft.heroCaption ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, heroCaption: event.target.value }))} placeholder={defaultHeroSettings.heroCaption} /></label>
              <button type="button" className="text-button website-reset-image" onClick={() => setSettingsDraft((current) => ({ ...current, heroImage: '' }))}>Remove header image</button>
            </div>
            <section className="website-image-preview-panel" aria-label="Live homepage header preview">
              <div className="admin-panel-heading"><h3>Live preview</h3><span><Check size={13} /> Updates as you edit</span></div>
              <div className="hero website-hero-preview">
                {settingsDraft.heroImage && <LoadedImage key={settingsDraft.heroImage} className="hero-image" src={settingsDraft.heroImage} alt="" />}
                <div className="hero-shade" />
                <div className="hero-copy">
                  <h1>{(settingsDraft.heroTitle || defaultHeroSettings.heroTitle).split('\n').map((line, index) => <Fragment key={`${index}-${line}`}>{index > 0 && <br />}{line}</Fragment>)}</h1>
                  <p>{settingsDraft.heroText || defaultHeroSettings.heroText}</p>
                  <span className="light-button">{settingsDraft.heroButtonText || defaultHeroSettings.heroButtonText} <ArrowRight size={14} /></span>
                </div>
                <span className="hero-caption">{settingsDraft.heroCaption || defaultHeroSettings.heroCaption}</span>
              </div>
              <p className="website-preview-note">The preview is scaled to fit. Changes appear on the storefront after publishing.</p>
            </section>
          </div>
          <div className="website-content-editor">
            <section className="website-content-group">
              <div className="admin-panel-heading"><h3>Shop collection page header</h3><span>Edit the header shown at the top of the collection and search page.</span></div>
              <div className="website-collection-hero-grid">
                <div>
                  <label className="form-label">Eyebrow text<input maxLength={70} value={settingsDraft.collectionHeroEyebrow ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, collectionHeroEyebrow: event.target.value }))} placeholder={defaultCollectionHeroSettings.eyebrow} /></label>
                  <label className="form-label">Headline<input maxLength={100} value={settingsDraft.collectionHeroTitle ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, collectionHeroTitle: event.target.value }))} placeholder={defaultCollectionHeroSettings.title} /></label>
                  <label className="form-label">Supporting text<textarea rows={3} maxLength={240} value={settingsDraft.collectionHeroText ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, collectionHeroText: event.target.value }))} placeholder={defaultCollectionHeroSettings.text} /></label>
                  <label className="form-label">Image URL<input type="url" value={settingsDraft.collectionHeroImage ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, collectionHeroImage: event.target.value }))} placeholder="Paste an image URL or upload" /></label>
                  {imageUploadControl('collectionHero', 'Upload collection page image')}
                  <label className="form-label">Image caption<input maxLength={100} value={settingsDraft.collectionHeroCaption ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, collectionHeroCaption: event.target.value }))} placeholder={defaultCollectionHeroSettings.caption} /></label>
                </div>
                <div className="website-collection-hero-preview">
                  <div className="collection-hero">
                    <div className="collection-hero-copy"><div className="eyebrow">{settingsDraft.collectionHeroEyebrow || defaultCollectionHeroSettings.eyebrow}</div><h1>{settingsDraft.collectionHeroTitle || defaultCollectionHeroSettings.title}</h1><p>{settingsDraft.collectionHeroText || defaultCollectionHeroSettings.text}</p><div className="collection-meta"><span>12 curated fragrances</span><i /><span>Accra, Ghana</span></div></div>
                    <div className="collection-hero-image"><LoadedImage key={settingsDraft.collectionHeroImage || products[0]?.image || defaultCollectionHeroSettings.image} className="" src={settingsDraft.collectionHeroImage || products[0]?.image || defaultCollectionHeroSettings.image} alt="" /><span>{settingsDraft.collectionHeroCaption || defaultCollectionHeroSettings.caption}</span></div>
                  </div>
                  <p className="website-preview-note">Preview of the collection page header. Changes appear on the storefront after publishing.</p>
                </div>
              </div>
            </section>
            <section className="website-content-group">
              <div className="admin-panel-heading"><h3>Shop by collection</h3><span>Edit the image and copy for each collection card.</span></div>
              <div className="website-collection-grid">{defaultCollectionSettings.map((item) => {
                const key = item.id[0].toUpperCase() + item.id.slice(1);
                const prefix = `collection${key}` as 'collectionMen' | 'collectionWomen' | 'collectionUnisex';
                const titleField = `${prefix}Title` as 'collectionMenTitle' | 'collectionWomenTitle' | 'collectionUnisexTitle';
                const subtitleField = `${prefix}Subtitle` as 'collectionMenSubtitle' | 'collectionWomenSubtitle' | 'collectionUnisexSubtitle';
                const imageField = `${prefix}Image` as 'collectionMenImage' | 'collectionWomenImage' | 'collectionUnisexImage';
                const image = String(settingsDraft[imageField] || item.image);
                return <article className="website-collection-editor" key={item.id}>
                  <div className="website-collection-preview">{image && <LoadedImage key={image} className="" src={image} alt="" />}<span>{settingsDraft[titleField] || item.title}</span></div>
                  <label className="form-label">Card title<input maxLength={50} value={String(settingsDraft[titleField] ?? '')} onChange={(event) => setSettingsDraft((current) => ({ ...current, [titleField]: event.target.value }))} placeholder={item.title} /></label>
                  <label className="form-label">Supporting text<input maxLength={100} value={String(settingsDraft[subtitleField] ?? '')} onChange={(event) => setSettingsDraft((current) => ({ ...current, [subtitleField]: event.target.value }))} placeholder={item.subtitle} /></label>
                  <label className="form-label">Image URL<input type="url" value={String(settingsDraft[imageField] ?? '')} onChange={(event) => setSettingsDraft((current) => ({ ...current, [imageField]: event.target.value }))} placeholder="Paste an image URL or upload" /></label>
                  {imageUploadControl(prefix, `Upload ${item.category.toLowerCase()} collection image`)}
                </article>;
              })}</div>
            </section>
            <section className="website-content-group website-finder-editor">
              <div className="admin-panel-heading"><h3>Fragrance finder feature</h3><span>Edit the promotional text and image.</span></div>
              <div className="website-finder-grid">
                <div>
                  <label className="form-label">Eyebrow text<input maxLength={70} value={settingsDraft.finderEyebrow ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, finderEyebrow: event.target.value }))} placeholder={defaultFinderSettings.eyebrow} /></label>
                  <label className="form-label">Headline<textarea rows={2} maxLength={120} value={settingsDraft.finderTitle ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, finderTitle: event.target.value }))} placeholder={defaultFinderSettings.title} /><small>Use a new line to control where the headline wraps.</small></label>
                  <label className="form-label">Supporting text<textarea rows={3} maxLength={240} value={settingsDraft.finderText ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, finderText: event.target.value }))} placeholder={defaultFinderSettings.text} /></label>
                  <label className="form-label">Button text<input maxLength={50} value={settingsDraft.finderButtonText ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, finderButtonText: event.target.value }))} placeholder={defaultFinderSettings.buttonText} /></label>
                  <label className="form-label">Image URL<input type="url" value={settingsDraft.finderImage ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, finderImage: event.target.value }))} placeholder="Paste an image URL or upload" /></label>
                  {imageUploadControl('finder', 'Upload fragrance finder image')}
                  <label className="form-label">Image caption<input maxLength={100} value={settingsDraft.finderCaption ?? ''} onChange={(event) => setSettingsDraft((current) => ({ ...current, finderCaption: event.target.value }))} placeholder={defaultFinderSettings.caption} /></label>
                </div>
                <div className="website-finder-preview">{(settingsDraft.finderImage || defaultFinderSettings.image) && <LoadedImage key={settingsDraft.finderImage || defaultFinderSettings.image} className="" src={settingsDraft.finderImage || defaultFinderSettings.image} alt="" />}<span>{settingsDraft.finderCaption || defaultFinderSettings.caption}</span></div>
              </div>
            </section>
          </div>
          <div className="admin-form-actions"><button type="button" className="outline-button" onClick={() => setSettingsDraft(settings)} disabled={busy || uploading}>Discard changes</button><button className="primary-button" type="submit" disabled={busy || uploading}><Save size={15} />{busy ? 'Publishing…' : 'Publish website images'}</button></div>
        </form>
      </section>}
      {section === 'storefront' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Storefront presentation</h2><p>Update your promotional announcement and footer introduction.</p></div></div><form className="admin-panel admin-settings-form" onSubmit={(event) => void saveSettings(event, ['announcement', 'footerText'])}>
        <label className="form-label">Announcement bar text<input value={settingsDraft.announcement || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, announcement: e.target.value }))} placeholder="A short store announcement" /></label>
        <label className="form-label">Footer introduction<input value={settingsDraft.footerText || ''} onChange={(e) => setSettingsDraft((current) => ({ ...current, footerText: e.target.value }))} placeholder="Exceptional fragrance, thoughtfully found." /></label>
        <div className="admin-form-actions"><button type="button" className="outline-button" onClick={() => setSettingsDraft(settings)}>Discard changes</button><button className="primary-button" type="submit" disabled={busy || uploading}><Save size={15} />{busy ? 'Publishing…' : 'Publish storefront'}</button></div>
      </form></section>}
      {section === 'feedback' && <section className="admin-content"><div className="admin-section-heading"><div><h2>Customer feedback</h2><p>Messages submitted from the storefront, updating live.</p></div><span className="feedback-count">{newFeedbackCount} new</span></div>
        <div className="admin-feedback-list">{feedback.map((item) => <article className="admin-feedback-card" key={item.id}><div className="admin-feedback-head"><div><span className={`feedback-status ${item.status}`}>{item.status}</span><h3>{item.name || 'Guest customer'}</h3><p>{item.email || 'No email provided'}{item.createdAt ? ` · ${item.createdAt.toDate().toLocaleString()}` : ''}</p></div></div><blockquote>{item.message}</blockquote><div className="admin-feedback-actions">{item.status !== 'resolved' && <button className="outline-button" onClick={() => void updateFeedbackStatus(item, 'resolved')}><Check size={14} /> Mark resolved</button>}{item.status === 'new' && <button className="text-button" onClick={() => void updateFeedbackStatus(item, 'read')}>Mark as read</button>}</div></article>)}{feedback.length === 0 && <div className="admin-panel admin-empty-note">No feedback yet. Customer messages from the main storefront will appear here.</div>}</div>
      </section>}
      {printDialogOpen && <AdminPrintReportDialog
        startDate={printStartDate}
        endDate={printEndDate}
        selectingEnd={printSelectingEnd}
        month={printCalendarMonth}
        orderCount={selectedPrintOrders.length}
        onSelectDate={selectPrintCalendarDate}
        onChangeMonth={setPrintCalendarMonth}
        onResetRange={resetPrintDateRange}
        onClose={() => setPrintDialogOpen(false)}
        onPrint={() => window.print()}
      />}
    </div>
  </main>;
}

function AdminPrintReportDialog({ startDate, endDate, selectingEnd, month, orderCount, onSelectDate, onChangeMonth, onResetRange, onClose, onPrint }: {
  startDate: string;
  endDate: string;
  selectingEnd: boolean;
  month: Date;
  orderCount: number;
  onSelectDate: (date: string) => void;
  onChangeMonth: (month: Date) => void;
  onResetRange: () => void;
  onClose: () => void;
  onPrint: () => void;
}) {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = monthStart.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const end = endDate || startDate;
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
  const rangeLabel = !startDate
    ? 'Choose a start date'
    : endDate
    ? `${formatOrderDay(startDate)} – ${formatOrderDay(endDate)}`
    : `${formatOrderDay(startDate)} · ${selectingEnd ? 'Choose an end date' : 'Single-day report'}`;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="admin-print-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-print-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-print-title">
        <button type="button" className="icon-button admin-print-close" aria-label="Close print dialog" onClick={onClose}><X size={18} /></button>
        <span className="eyebrow">ORDER REPORT</span><h2 id="admin-print-title">Choose report dates</h2>
        <p className="admin-print-instructions">{selectingEnd ? 'Select a start date, then choose an end date to include every day in between.' : 'Date range selected. Choose another date to start a new range or print the report.'}</p>
        <div className="admin-calendar">
          <div className="admin-calendar-heading">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => onChangeMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ArrowLeft size={17} /></button>
            <strong>{monthLabel}</strong>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => onChangeMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ArrowRight size={17} /></button>
          </div>
          <div className="admin-calendar-grid" role="group" aria-label={monthLabel}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="admin-calendar-weekday" key={day}>{day}</span>)}
            {cells.map((day, index) => {
              if (!day) return <span className="admin-calendar-empty" aria-hidden="true" key={`empty-${index}`} />;
              const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = Boolean(startDate) && (date === startDate || (Boolean(endDate) && date === endDate));
              const isInRange = Boolean(startDate) && date >= startDate && date <= end;
              return <button type="button" aria-pressed={isSelected} aria-label={formatOrderDay(date)} className={`admin-calendar-day${isSelected ? ' selected' : ''}${isInRange ? ' in-range' : ''}`} key={date} onClick={() => onSelectDate(date)}>{day}</button>;
            })}
          </div>
          <div className="admin-calendar-footer"><div className="admin-calendar-range"><CalendarDays size={16} /><span>{rangeLabel}</span></div><button type="button" className="text-button" onClick={onResetRange}>Clear dates</button></div>
        </div>
        <p className="admin-print-count">{orderCount} {orderCount === 1 ? 'order' : 'orders'} in this date range. The printout includes orders for each day.</p>
        <div className="admin-form-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={!orderCount || !startDate || selectingEnd} onClick={onPrint}><ArrowDownToLine size={16} /> Print / Save PDF</button></div>
      </section>
    </div>,
    document.body,
  );
}
