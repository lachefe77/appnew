const limits = {
  freeze_mode: [0, 1, true],
  allow_synthetic_proof: [0, 0, true],
  cashback_pct: [0, 20],
  affiliate_l1_pct: [0, 10],
  affiliate_l2_pct: [0, 5],
  affiliate_l3_pct: [0, 3],
  affiliate_l4_pct: [0, 2],
  min_account_hours: [0, 8760],
  current_usd_brl: [0.01, 1000],
  min_deposit_brl: [1, 10000],
};
function validateSettings(updates) {
  if (
    !updates ||
    typeof updates !== 'object' ||
    Array.isArray(updates) ||
    !Object.keys(updates).length
  )
    throw new Error('Payload inválido.');
  for (const [key, value] of Object.entries(updates)) {
    const rule = limits[key],
      number = Number(value);
    if (
      !rule ||
      !['string', 'number'].includes(typeof value) ||
      String(value).trim() === '' ||
      !Number.isFinite(number) ||
      number < rule[0] ||
      number > rule[1] ||
      (rule[2] && !Number.isInteger(number))
    )
      throw new Error('Configuração inválida: ' + key);
  }
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, String(Number(value))])
  );
}
module.exports = { limits, validateSettings };
