export function LookupForm({ email, cpf }: { email: string; cpf: string }) {
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" action="/meus-pedidos">
      <input className="field" name="email" type="email" required defaultValue={email} placeholder="E-mail" />
      <input className="field" name="cpf" required defaultValue={cpf} placeholder="CPF" />
      <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Buscar</button>
    </form>
  );
}
