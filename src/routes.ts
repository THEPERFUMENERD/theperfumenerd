export type StorefrontTab = 'Home' | 'Search' | 'Wishlist' | 'Account' | 'Cart' | 'Orders' | 'About' | 'Contact' | 'Support';

const tabNames: StorefrontTab[] = ['Home', 'Search', 'Wishlist', 'Account', 'Cart'];
const infoPages: StorefrontTab[] = ['About', 'Contact', 'Support'];

export function getStorefrontTab(pathname: string, search = ''): StorefrontTab {
  const searchParams = new URLSearchParams(search);
  if (pathname === '/orders'
    || (pathname === '/' && (searchParams.has('reference') || searchParams.has('trxref')))) {
    return 'Orders';
  }
  return [...tabNames, ...infoPages].find((item) => item.toLowerCase() === pathname.split('/')[1]) ?? 'Home';
}

export function getStorefrontPath(pathname: string, search = ''): string {
  const searchParams = new URLSearchParams(search);
  return pathname === '/' && (searchParams.has('reference') || searchParams.has('trxref'))
    ? '/orders'
    : pathname;
}
