import { prisma } from "./db";

export function clientIp(request: Request) {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim().slice(0, 64) ?? "";
  return (request.headers.get("x-real-ip") ?? "").trim().slice(0, 64);
}

function isPrivate(ip: string) {
  return !ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

async function lookupGeo(ip: string) {
  const empty = { city: null as string | null, region: null as string | null, lat: null as number | null, lng: null as number | null };
  if (isPrivate(ip)) return empty;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return empty;
    const body = (await response.json()) as { success?: boolean; city?: string; region?: string; latitude?: number; longitude?: number };
    if (!body.success) return empty;
    return {
      city: body.city?.slice(0, 80) ?? null,
      region: body.region?.slice(0, 80) ?? null,
      lat: typeof body.latitude === "number" ? body.latitude : null,
      lng: typeof body.longitude === "number" ? body.longitude : null,
    };
  } catch {
    return empty;
  }
}

export async function recordAccess(userId: string, request: Request, kind: "register" | "login") {
  const ip = clientIp(request) || "desconhecido";
  const geo = await lookupGeo(ip);
  await prisma.loginEvent.create({
    data: { userId, ip, kind, city: geo.city, region: geo.region, lat: geo.lat, lng: geo.lng },
  });
  const place = {
    lastLoginAt: new Date(),
    lastLoginIp: ip,
    lastCity: geo.city,
    lastRegion: geo.region,
    lastLat: geo.lat,
    lastLng: geo.lng,
  };
  await prisma.user.update({
    where: { id: userId },
    data: kind === "register"
      ? { ...place, registeredIp: ip, registeredCity: geo.city, registeredRegion: geo.region, registeredLat: geo.lat, registeredLng: geo.lng }
      : place,
  });
}
