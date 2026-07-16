import PublicCatalog from "../components/PublicCatalog";

// Public catalog WITH prices — the owner shares this link deliberately.
export default function PublicPricesPage() {
  return <PublicCatalog showPrices={true} />;
}
