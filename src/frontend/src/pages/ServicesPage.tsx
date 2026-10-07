import CatalogItemsPage from "./CatalogItemsPage";

/** "Servicios": only SERVICE items and the categories exclusive to services. */
export default function ServicesPage() {
  return <CatalogItemsPage kind="SERVICE" />;
}
