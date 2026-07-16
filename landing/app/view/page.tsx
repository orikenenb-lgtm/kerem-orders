import PublicCatalog from "../components/PublicCatalog";

// Public catalog WITHOUT prices — safe to share with anyone.
export default function PublicViewPage() {
  return <PublicCatalog showPrices={false} />;
}
