import { notFound } from "next/navigation";
import HomePage from "../../page";
import { categoryLabel } from "@/lib/format";

const known = new Set(["ferramentas", "bem-estar", "pet"]);

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ q?: string; ordem?: string }>;
}) {
  const { category } = await params;
  if (!known.has(category)) notFound();
  const query = await searchParams;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{categoryLabel(category)}</p>
      <HomePage searchParams={Promise.resolve({ ...query, categoria: category })} />
    </div>
  );
}
