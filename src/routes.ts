export type StorefrontTab = 'Home' | 'Search' | 'Wishlist' | 'Account' | 'Cart' | 'Orders';

const tabNames: StorefrontTab[] = ['Home', 'Search', 'Wishlist', 'Account', 'Cart'];

export function getStorefrontTab(pathname: string, search = ''): StorefrontTab {
  const searchParams = new URLSearchParams(search);
  if (pathname === '/orders'
    || (pathname === '/' && (searchParams.has('reference') || searchParams.has('trxref')))) {
    return 'Orders';
  }
  return tabNames.find((item) => item.toLowerCase() === pathname.split('/')[1]) ?? 'Home';
}

export function getStorefrontPath(pathname: string, search = ''): string {
  const searchParams = new URLSearchParams(search);
  return pathname === '/' && (searchParams.has('reference') || searchParams.has('trxref'))
    ? '/orders'
    : pathname;
}
