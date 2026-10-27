import { JobForm } from "@/components/simple-forms";

export default function JobsPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-4xl font-semibold">Trabalhe conosco</h1>
      <p className="text-sm text-muted">Envie currículo para galpão, suporte ou comercial. PDF ou Word, até 5 MB. A equipe vê o arquivo na aba Currículos.</p>
      <JobForm />
    </div>
  );
}
