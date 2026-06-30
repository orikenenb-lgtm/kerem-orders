import data from "../data/products.json";

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  sku: string;
  barcode: string;
  category: string;
  emoji: string;
  image: string; // path under /public (e.g. "/products/p1.jpg"), prefix with basePath
};

// basePath-aware asset URL (site is served from /kerem-orders on GitHub Pages)
export const assetUrl = (path: string) =>
  path ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${path}` : "";

export const CATEGORIES: string[] = data.categories;
export const PRODUCTS: CatalogProduct[] = data.products as CatalogProduct[];
