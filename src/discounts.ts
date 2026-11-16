import type { Fragrance } from './catalog';
import type { StorefrontSettings } from './storefront-data';

export function applyStorefrontDiscounts(
  products: Fragrance[],
  settings: StorefrontSettings,
  settingsLoading: boolean,
): Fragrance[] {
  if (settingsLoading || settings.discountMode === 'none') return products;

  if (settings.discountMode === 'all') {
    const percentage = settings.discountPercentage;
    if (typeof percentage !== 'number' || !Number.isSafeInteger(percentage) || percentage < 1 || percentage > 95) return products;
    return products.map((product) => {
      const salePrice = Math.round(product.price * (1 - percentage / 100));
      return salePrice < product.price
        ? { ...product, originalPrice: product.price, price: salePrice, isOnSale: true }
        : product;
    });
  }

  if (settings.discountMode !== 'selected' || !Array.isArray(settings.discountProducts)) return products;
  const salePrices = new Map<string, number>();
  settings.discountProducts.forEach((entry) => {
    if (entry && typeof entry.productId === 'string' && Number.isFinite(entry.salePrice)) {
      salePrices.set(entry.productId, Math.round(entry.salePrice));
    }
  });
  return products.map((product) => {
    const salePrice = salePrices.get(product.id);
    return salePrice !== undefined && salePrice >= 1 && salePrice < product.price
      ? { ...product, originalPrice: product.price, price: salePrice, isOnSale: true }
      : product;
  });
}
