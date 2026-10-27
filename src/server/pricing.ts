export type PricedProduct = {
  suggestedRetailCents: number;
  platformWholesaleCents: number;
  supplierCostCents: number;
  bundleQty: number | null;
  bundlePriceCents: number | null;
};

export function quoteLine(product: PricedProduct, quantity: number, saleUnitCents?: number) {
  const unit = saleUnitCents ?? product.suggestedRetailCents;
  let sale = unit * quantity;
  const bundleApplies =
    saleUnitCents == null &&
    product.bundleQty != null &&
    product.bundlePriceCents != null &&
    product.bundleQty > 1 &&
    quantity >= product.bundleQty;
  if (bundleApplies && product.bundleQty && product.bundlePriceCents) {
    const bundles = Math.floor(quantity / product.bundleQty);
    const rest = quantity % product.bundleQty;
    sale = bundles * product.bundlePriceCents + rest * unit;
  }
  return {
    sale,
    wholesale: product.platformWholesaleCents * quantity,
    cost: product.supplierCostCents * quantity,
    unitSale: Math.max(1, Math.round(sale / quantity)),
  };
}

export function bundleLabel(product: PricedProduct) {
  if (!product.bundleQty || !product.bundlePriceCents || product.bundleQty < 2) return null;
  return { qty: product.bundleQty, priceCents: product.bundlePriceCents };
}
