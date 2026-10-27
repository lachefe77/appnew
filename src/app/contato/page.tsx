import { ContactForm } from "@/components/simple-forms";
import { getBrand } from "@/server/brand";

export default async function ContactPage() {
  const brand = await getBrand();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-4xl font-semibold">Contato</h1>
      <p className="text-sm text-muted">Fale com {brand.name}. O recado cai na aba Contatos do admin. Para um pedido já feito, use Suporte.</p>
      <ContactForm />
    </div>
  );
}
