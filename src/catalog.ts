export const fragranceCategories = ['Men', 'Women', 'Unisex'] as const;
export type FragranceCategory = (typeof fragranceCategories)[number];

export type Fragrance = {
  id: string;
  name: string;
  brand: string;
  price: number;
  category: FragranceCategory;
  categories?: FragranceCategory[];
  family: string;
  strength: 'Soft' | 'Moderate' | 'Strong';
  concentration: string;
  notes: string[];
  occasion: string[];
  description: string;
  image: string;
  badge?: string;
  stock: number;
};

export const getFragranceCategories = (
  product: Pick<Fragrance, 'category' | 'categories'>,
): FragranceCategory[] => {
  const categories = Array.isArray(product.categories)
    ? product.categories.filter((value): value is FragranceCategory =>
      fragranceCategories.includes(value as FragranceCategory))
    : [];
  return categories.length ? [...new Set(categories)] : [product.category];
};

const image = (id: string, width = 720) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;

// Clearly marked demo catalogue; replace with verified business inventory before launch.
export const products: Fragrance[] = [
  { id: 'oud-wood', name: 'Oud Wood', brand: 'Tom Ford', price: 1890, category: 'Unisex', family: 'Woody', strength: 'Strong', concentration: 'Eau de Parfum', notes: ['Oud', 'Cardamom', 'Sandalwood'], occasion: ['Evening', 'Special occasions'], description: 'A modern, quietly confident take on rare oud, softened by warm woods and spice.', image: image('photo-1594035910387-fea47794261f'), badge: 'BEST SELLER', stock: 8 },
  { id: 'good-girl', name: 'Good Girl', brand: 'Carolina Herrera', price: 1450, category: 'Women', family: 'Floral', strength: 'Moderate', concentration: 'Eau de Parfum', notes: ['Jasmine', 'Tonka bean', 'Cocoa'], occasion: ['Date night', 'Evening'], description: 'An expressive contrast of luminous florals and deep, sensual warmth.', image: image('photo-1541643600914-78b084683601'), badge: 'TRENDING', stock: 12 },
  { id: 'sauvage', name: 'Sauvage', brand: 'Dior', price: 1580, category: 'Men', family: 'Fresh', strength: 'Strong', concentration: 'Eau de Parfum', notes: ['Bergamot', 'Sichuan pepper', 'Ambroxan'], occasion: ['Everyday', 'All-purpose'], description: 'Fresh bergamot meets a confident, mineral trail inspired by open horizons.', image: image('photo-1592945403244-b3fbafd7f539'), badge: 'BEST SELLER', stock: 5 },
  { id: 'baccarat-rouge', name: 'Baccarat Rouge 540', brand: 'Maison Francis Kurkdjian', price: 3200, category: 'Unisex', family: 'Amber', strength: 'Strong', concentration: 'Eau de Parfum', notes: ['Saffron', 'Amberwood', 'Jasmine'], occasion: ['Special occasions', 'Evening'], description: 'Airy florals and amber woods create a radiant, unmistakable signature.', image: image('photo-1592945403244-b3fbafd7f539'), badge: 'ICONIC', stock: 4 },
  { id: 'black-opium', name: 'Black Opium', brand: 'Yves Saint Laurent', price: 1640, category: 'Women', family: 'Vanilla', strength: 'Strong', concentration: 'Eau de Parfum', notes: ['Coffee', 'Vanilla', 'White flowers'], occasion: ['Date night', 'Evening'], description: 'A captivating blend of dark coffee, white flowers and enveloping vanilla.', image: image('photo-1595425970377-c9703cf48b6d'), stock: 9 },
  { id: 'bleu', name: 'Bleu de Chanel', brand: 'Chanel', price: 1760, category: 'Men', family: 'Woody', strength: 'Moderate', concentration: 'Eau de Parfum', notes: ['Citrus', 'Incense', 'Cedar'], occasion: ['Office', 'All-purpose'], description: 'Refined woods and bright citrus compose a polished, versatile fragrance.', image: image('photo-1594035910387-fea47794261f'), stock: 7 },
  { id: 'delina', name: 'Delina', brand: 'Parfums de Marly', price: 2650, category: 'Women', family: 'Floral', strength: 'Moderate', concentration: 'Eau de Parfum', notes: ['Rhubarb', 'Turkish rose', 'Musk'], occasion: ['Everyday', 'Special occasions'], description: 'A vibrant, romantic rose fragrance with a playful fruit opening.', image: image('photo-1594035910387-fea47794261f'), badge: 'NEW ARRIVAL', stock: 3 },
  { id: 'erba-pura', name: 'Erba Pura', brand: 'Xerjoff', price: 2900, category: 'Unisex', family: 'Citrus', strength: 'Moderate', concentration: 'Eau de Parfum', notes: ['Mediterranean citrus', 'Fruits', 'White musk'], occasion: ['Everyday', 'All-purpose'], description: 'A joyful burst of sunlit fruit balanced by a soft, lasting musk.', image: image('photo-1541643600914-78b084683601'), badge: 'NEW ARRIVAL', stock: 6 },
];

export const money = (amount: number) =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(amount);
