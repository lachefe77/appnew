function progress(order) {
  const quantity = Number(order.quantity);
  const pending = [
    'pending',
    'dispatching',
    'awaiting_confirmation',
    'scheduled',
  ].includes(order.status);
  const raw = Number(order.remains);
  const remains =
    order.status === 'completed'
      ? 0
      : pending && !order.is_dripfeed
        ? quantity
        : order.remains == null || !Number.isSafeInteger(raw)
          ? quantity
          : Math.max(0, Math.min(quantity, raw));
  const delivered = Math.max(0, quantity - remains);
  return {
    remains,
    delivered,
    percent:
      quantity > 0
        ? Math.min(100, Math.round((delivered / quantity) * 100))
        : 0,
  };
}
module.exports = { progress };
