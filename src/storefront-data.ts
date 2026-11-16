import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { products as demoProducts, type Fragrance } from './catalog';

export type StorefrontSettings = {
  heroTitle?: string;
  heroText?: string;
  heroImage?: string;
  heroCaption?: string;
  heroButtonText?: string;
  collectionMenTitle?: string;
  collectionMenSubtitle?: string;
  collectionMenImage?: string;
  collectionWomenTitle?: string;
  collectionWomenSubtitle?: string;
  collectionWomenImage?: string;
  collectionUnisexTitle?: string;
  collectionUnisexSubtitle?: string;
  collectionUnisexImage?: string;
  finderEyebrow?: string;
  finderTitle?: string;
  finderText?: string;
  finderButtonText?: string;
  finderImage?: string;
  finderCaption?: string;
  collectionHeroEyebrow?: string;
  collectionHeroTitle?: string;
  collectionHeroText?: string;
  collectionHeroImage?: string;
  collectionHeroCaption?: string;
  discountMode?: 'none' | 'all' | 'selected';
  discountPercentage?: number;
  discountProducts?: { productId: string; salePrice: number }[];
  announcement?: string;
  footerText?: string;
};

export const defaultHeroSettings: Required<Pick<
  StorefrontSettings,
  'heroTitle' | 'heroText' | 'heroImage' | 'heroCaption' | 'heroButtonText'
>> = {
  heroTitle: 'Discover your\nsignature scent.',
  heroText: 'Helping you smell Luxurious on a Budget',
  heroImage: '',
  heroCaption: 'THE ART OF SCENT · ACCRA, GHANA',
  heroButtonText: 'Explore the collection',
};

export const defaultCollectionSettings = [
  {
    id: 'men',
    category: 'Men',
    title: 'For him',
    subtitle: 'Considered, confident, unforgettable.',
    image: '',
  },
  {
    id: 'women',
    category: 'Women',
    title: 'For her',
    subtitle: 'A scent that says everything.',
    image: '',
  },
  {
    id: 'unisex',
    category: 'Unisex',
    title: 'For everyone',
    subtitle: 'Beyond the expected.',
    image: '',
  },
] as const;

export const defaultFinderSettings = {
  eyebrow: 'A LITTLE HELP FINDING YOUR WAY',
  title: 'There’s a scent\nthat feels like you.',
  text: 'Tell us what you love. We’ll make a few thoughtful suggestions.',
  buttonText: 'Find your signature scent',
  image: '',
  caption: 'YOUR SCENT STORY STARTS HERE',
};

export const defaultCollectionHeroSettings = {
  eyebrow: 'THE PERFUME NERD · FRAGRANCE HOUSE',
  title: 'Find the scent that feels like you.',
  text: 'Explore a considered edit of fragrances for every mood, moment and side of you.',
  image: '',
  caption: 'THE SIGNATURE EDIT',
};

const productsCacheKey = 'tpn-storefront-products-v1';
const settingsCacheKey = 'tpn-storefront-settings-v1';

function readCache<T,>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch (reason) {
    console.error(`Could not read the cached storefront data (${key}).`, reason);
    return fallback;
  }
}

export function cacheStorefrontSettings(settings: Partial<StorefrontSettings>) {
  try {
    const current = readCache<StorefrontSettings>(settingsCacheKey, {});
    localStorage.setItem(settingsCacheKey, JSON.stringify({ ...current, ...settings }));
  } catch (reason) {
    console.error('Could not update the cached storefront settings.', reason);
  }
}

export function useStorefrontData() {
  const [cachedProducts] = useState<Fragrance[]>(() => db ? readCache(productsCacheKey, []) : []);
  const [cachedSettings] = useState<StorefrontSettings>(() => db ? readCache(settingsCacheKey, {}) : {});
  const [products, setProducts] = useState<Fragrance[]>(db ? cachedProducts : demoProducts);
  const [settings, setSettings] = useState<StorefrontSettings>(cachedSettings);
  const [isLoading, setIsLoading] = useState(Boolean(db && cachedProducts.length === 0));
  const [settingsLoading, setSettingsLoading] = useState(Boolean(db && Object.keys(cachedSettings).length === 0));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }

    let productsReady = cachedProducts.length > 0;
    let settingsReady = Object.keys(cachedSettings).length > 0;
    const finishLoading = () => {
      if (productsReady && settingsReady) setIsLoading(false);
    };
    const productsQuery = query(collection(db, 'products'), where('visible', '==', true));
    const stopProducts = onSnapshot(productsQuery, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache) return;
      const currentProducts = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as Fragrance);
      setProducts(currentProducts);
      if (!snapshot.metadata.fromCache) {
        try {
          localStorage.setItem(productsCacheKey, JSON.stringify(currentProducts));
        } catch (reason) {
          console.error('Could not cache the latest storefront products.', reason);
        }
      }
      productsReady = true;
      finishLoading();
      setError('');
    }, (reason) => {
      console.error('Could not load the live fragrance collection.', reason);
      setError('The live collection could not be loaded. Please try again later.');
      productsReady = true;
      finishLoading();
    });
    const stopSettings = onSnapshot(doc(db, 'storeSettings', 'public'), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache) return;
      const currentSettings = snapshot.exists() ? snapshot.data() as StorefrontSettings : {};
      setSettings(currentSettings);
      if (!snapshot.metadata.fromCache) {
        cacheStorefrontSettings(currentSettings);
        settingsReady = true;
        setSettingsLoading(false);
        finishLoading();
        setError('');
      }
    }, (reason) => {
      console.error('Could not load live storefront settings.', reason);
      setError('Some storefront content could not be loaded.');
      settingsReady = true;
      setSettingsLoading(false);
      finishLoading();
    });

    return () => {
      stopProducts();
      stopSettings();
    };
  }, []);

  return { products, settings, isLoading, settingsLoading, error, isDemo: !db };
}
