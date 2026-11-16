import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { products as demoProducts, type Fragrance } from './catalog';

export type StorefrontSettings = {
  heroTitle?: string;
  heroText?: string;
  heroImage?: string;
  heroCaption?: string;
  announcement?: string;
  footerText?: string;
};

export function useStorefrontData() {
  const [products, setProducts] = useState<Fragrance[]>(db ? [] : demoProducts);
  const [settings, setSettings] = useState<StorefrontSettings>({});
  const [isLoading, setIsLoading] = useState(Boolean(db));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db) {
      setIsLoading(false);
      return;
    }

    let productsReady = false;
    let settingsReady = false;
    const finishLoading = () => {
      if (productsReady && settingsReady) setIsLoading(false);
    };
    const productsQuery = query(collection(db, 'products'), where('visible', '==', true));
    const stopProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as Fragrance));
      productsReady = true;
      finishLoading();
      setError('');
    }, (reason) => {
      console.error('Could not load the live fragrance collection.', reason);
      setError('The live collection could not be loaded. Please try again later.');
      productsReady = true;
      finishLoading();
    });
    const stopSettings = onSnapshot(doc(db, 'storeSettings', 'public'), (snapshot) => {
      setSettings(snapshot.exists() ? snapshot.data() as StorefrontSettings : {});
      settingsReady = true;
      finishLoading();
      setError('');
    }, (reason) => {
      console.error('Could not load live storefront settings.', reason);
      setError('Some storefront content could not be loaded.');
      settingsReady = true;
      finishLoading();
    });

    return () => {
      stopProducts();
      stopSettings();
    };
  }, []);

  return { products, settings, isLoading, error, isDemo: !db };
}
