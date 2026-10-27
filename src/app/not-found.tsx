import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3 py-16">
      <h1 className="font-display text-4xl">Não encontramos essa página.</h1>
      <Link href="/" className="text-copper">Voltar à vitrine</Link>
    </div>
  );
}
