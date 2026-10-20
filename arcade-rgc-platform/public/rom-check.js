// CRCs identify the original KOF 2002 romset and required Neo Geo system ROMs.
// Reference: FBNeo src/burn/drv/neogeo/d_neogeo.cpp (kof2002 / neogeo).
export function inspectZip(buffer) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("Diretório ZIP inválido.");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw Error("ZIP dividido não é suportado.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    total = 0;
  const entries = [];
  if (count > 2048) throw Error("ZIP contém arquivos demais.");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw Error("Diretório ZIP truncado.");
    const flags = view.getUint16(offset + 8, true),
      size = view.getUint32(offset + 24, true),
      n = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    if (flags & 1) throw Error("ZIP com senha não é suportado.");
    if (offset + 46 + n + extra + comment > end)
      throw Error("Entrada ZIP inválida.");
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + n),
    );
    if (name.includes("..") || name.includes("\\") || name.startsWith("/"))
      throw Error("Nome de arquivo inválido no ZIP.");
    entries.push({
      name,
      size,
      crc: view
        .getUint32(offset + 16, true)
        .toString(16)
        .padStart(8, "0"),
    });
    total += size;
    offset += 46 + n + extra + comment;
  }
  if (total > 160 * 1024 * 1024)
    throw Error("Conteúdo descompactado excede o limite.");
  return entries;
}
export const biosFiles = [
  ["sm1.sm1", "94416d67", 131072],
  ["sfix.sfix", "c2ea0cfd", 131072],
  ["000-lo.lo", "5a86cff2", 131072],
];
const knownBios = new Set([
  "91b64be3",
  "9036d879",
  "c7f2fa45",
  "e72943de",
  "acede59c",
  "9fb0abe4",
  "62f021f4",
  "0c12c2ad",
  "f0e8f27d",
  "d27a71f1",
  "16d0c132",
  "a4e8b9b3",
]);
export function validateBios(entries) {
  const missing = biosFiles.filter(
    ([, crc, size]) => !entries.some((e) => e.crc === crc && e.size === size),
  );
  if (missing.length)
    throw Error(
      "BIOS incompatível com FBNeo. Faltam: " +
        missing.map(([n, c]) => n + " (CRC " + c + ")").join(", ") +
        ". Selecione outro neogeo.zip compatível.",
    );
  if (!entries.some((e) => knownBios.has(e.crc)))
    throw Error(
      "BIOS de sistema Neo Geo não reconhecida. Use neogeo.zip compatível com FBNeo.",
    );
  return true;
}
export function validateRom(entries) {
  const required = [
    ["265-p1.p1", "9ede7323"],
    ["265-p2.sp2", "327266b8"],
    ["265-c1.c1", "2b65a656"],
    ["265-c2.c2", "adf18983"],
    ["265-c3.c3", "875e9fd7"],
    ["265-c4.c4", "2da13947"],
    ["265-c5.c5", "61bd165d"],
    ["265-c6.c6", "03fdd1eb"],
    ["265-c7.c7", "1a2749d8"],
    ["265-c8.c8", "ab0bb549"],
    ["265-m1.m1", "85aaa632"],
    ["265-v1.v1", "15e8f3f5"],
    ["265-v2.v2", "da41d6f9"],
  ];
  const missing = required.filter(
    ([, crc]) => !entries.some((e) => e.crc === crc),
  );
  if (missing.length)
    throw Error(
      "ROM incompatível com KOF 2002 original. Verifique " +
        missing.map(([name]) => name).join(", ") +
        ". Magic Plus usa outro romset.",
    );
  return true;
}
