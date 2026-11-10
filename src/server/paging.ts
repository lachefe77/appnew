export function pageWindow(raw: string | undefined, size = 20) {
  const page = Math.max(1, Number(raw) || 1)
  return { page, take: size, skip: (page - 1) * size }
}
