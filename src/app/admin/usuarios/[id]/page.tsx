import Link from "next/link";
import { notFound } from "next/navigation";
import { AdjustForm } from "@/components/adjust-form";
import { ProfileForm, UserControl } from "@/components/simple-forms";
import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { roleLabel } from "@/server/roles";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      orders: { orderBy: { createdAt: "desc" }, take: 12, include: { items: true } },
      referrals: { select: { id: true, name: true, email: true } },
    },
  });
  if (!user) notFound();
  const desk = actor.role === "MASTER" || actor.role === "ADMIN";
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted">{roleLabel(user.role)}</p>
        <h1 className="text-3xl font-semibold">{user.name}</h1>
        <p className="text-sm text-muted">{user.email} · {user.phone ?? "sem telefone"} · saldo {formatBRL(Number(user.wallet?.balanceCents ?? 0))}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-4 text-sm">
          <p className="font-medium">Cadastro</p>
          <p className="mt-2">Registrado em {when(user.createdAt)}</p>
          <p>IP do cadastro: {user.registeredIp ?? "ainda não capturado"}</p>
          <p>{place(user.registeredCity, user.registeredRegion)}</p>
          <AccessMap lat={user.registeredLat} lng={user.registeredLng} label="Mapa do cadastro" />
        </div>
        <div className="rounded-2xl border border-line bg-card p-4 text-sm">
          <p className="font-medium">Último acesso</p>
          <p className="mt-2">{user.lastLoginAt ? when(user.lastLoginAt) : "Sem login registrado"}</p>
          <p>IP: {user.lastLoginIp ?? "ainda não capturado"}</p>
          <p>{place(user.lastCity, user.lastRegion)}</p>
          <AccessMap lat={user.lastLat} lng={user.lastLng} label="Mapa do último acesso" />
        </div>
      </div>
      {desk ? <ProfileForm userId={user.id} name={user.name} email={user.email} phone={user.phone ?? ""} /> : null}
      {desk ? <UserControl userId={user.id} role={user.role} note={user.note ?? ""} /> : <p className="text-sm text-muted">{user.note}</p>}
      {desk && user.wallet ? <AdjustForm userId={user.id} /> : null}
      {user.referrals.length > 0 ? (
        <p className="text-sm">Indicados: {user.referrals.map((item) => item.name).join(", ")}</p>
      ) : null}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {user.orders.map((order) => (
          <li key={order.id} className="flex justify-between gap-3 px-4 py-3">
            <Link className="text-pine" href={`/admin/pedidos/${order.publicCode}`}>{order.publicCode}</Link>
            <span>{formatBRL(order.totalSaleCents)} · {order.paymentStatus}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function when(date: Date) {
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function place(city: string | null, region: string | null) {
  if (!city && !region) return "Cidade ainda não localizada.";
  return [city, region].filter(Boolean).join(" · ");
}

function AccessMap({ lat, lng, label }: { lat: number | null; lng: number | null; label: string }) {
  if (lat == null || lng == null) {
    return <p className="mt-2 text-muted">Sem mapa. O IP é de rede local ou não devolveu coordenada.</p>;
  }
  const bbox = `${lng - 0.08},${lat - 0.08},${lng + 0.08},${lat + 0.08}`;
  return (
    <iframe
      title={label}
      className="mt-3 h-52 w-full rounded-xl border border-line"
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lng}`}
    />
  );
}
