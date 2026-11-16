// Decorative emoji for the home page category tiles (always aria-hidden — the
// tile's accessible name is the real category name). Keys are the category
// names exactly as catalog_public_categories() returns them; anything not
// listed (a category the manager adds later) gets the generic teddy.
const MAP: Record<string, string> = {
  "מוצרי בנים": "🚀",
  "מוצרי בנות": "🦄",
  "מוצרי תליה": "📌",
  "מוצרי תליה מותגים": "🌟",
  "כדורים": "⚽",
  "רובים": "🔫",
  "חוברות ומדברות": "📒",
  "חוברות ומדבקות": "📒",
  "מוצרי תינוקות": "🍼",
  "מכוניות שלט": "🏎️",
  "סליים": "🧪",
  "מותגים": "✨",
  "קלפים ושקיות": "🃏",
  "מוצרי קופה": "🍭",
  "סקוויזי וסקוצי": "🍡",
  "נדו ודמפלינג": "🥟",
  "סביבונים": "🌀",
  "50 אחוז הנחה": "🏷️",
  "הפתעות": "🎁",
  "לגו מותגים": "🧱",
  "מוצרי אופניים": "🚲",
  "סחורה חדשה 1": "🆕",
  "עגלות בובה": "🎀",
};

export const FALLBACK_EMOJI = "🧸";

export function categoryEmoji(name: string): string {
  return MAP[name.trim()] ?? FALLBACK_EMOJI;
}

/** The two real categories the home page may highlight — only when present. */
export const NEW_STOCK_CATEGORY = "סחורה חדשה 1";
export const SALE_CATEGORY = "50 אחוז הנחה";
