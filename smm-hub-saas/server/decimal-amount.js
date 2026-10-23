function units(value) {
  if (!['string', 'number'].includes(typeof value))
    throw new Error('Valor decimal inválido.');
  const match = String(value).match(
    /^(\d{1,30})(?:\.(\d{1,30}))?(?:e([+-]?\d{1,2}))?$/i
  );
  if (!match) throw new Error('Valor decimal inválido.');
  const fraction = match[2] || '',
    shift = 18 + Number(match[3] || 0) - fraction.length;
  if (shift < 0 || shift > 48)
    throw new Error('Precisão decimal não suportada.');
  return BigInt(match[1] + fraction) * 10n ** BigInt(shift);
}
function canonical(value) {
  const amount = units(value);
  if (amount <= 0n) throw new Error('Valor deve ser positivo.');
  const integer = amount / 10n ** 18n,
    fraction = (amount % 10n ** 18n)
      .toString()
      .padStart(18, '0')
      .replace(/0+$/, '');
  return integer.toString() + (fraction ? '.' + fraction : '');
}
function atLeast(paid, expected) {
  try {
    return units(expected) > 0n && units(paid) >= units(expected);
  } catch {
    return false;
  }
}
module.exports = { units, canonical, atLeast };
