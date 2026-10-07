import CatalogItemsPage from "./CatalogItemsPage";

/** "Productos": only PRODUCT items and the categories exclusive to products. */
export default function ProductsPage() {
  return <CatalogItemsPage kind="PRODUCT" />;
}
