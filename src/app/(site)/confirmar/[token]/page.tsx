import { confirmEmail } from "@/server/accounts"

export const dynamic = "force-dynamic"

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await confirmEmail(token)
  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-5xl uppercase">E-mail</h1>
      <p className="mt-4 text-sm">{result.ok ? "E-mail confirmado." : result.error}</p>
    </section>
  )
}
