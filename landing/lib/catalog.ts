import data from "../data/products.json";

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  sku: string;
  barcode: string;
  category: string;
  emoji: string;
};

export const CATEGORIES: string[] = data.categories;
export const PRODUCTS: CatalogProduct[] = data.products as CatalogProduct[];
