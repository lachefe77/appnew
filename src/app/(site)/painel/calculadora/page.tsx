import { Calculator } from "@/components/calculator"

export const dynamic = "force-dynamic"

export default function CalculatorPage() {
  return (
    <section className="mx-auto max-w-md px-4 py-8">
      <h1 className="font-display text-5xl uppercase">Calculadora</h1>
      <p className="mt-2 text-sm text-mist">
        Duas odds e um stake. A conta é a mesma do motor: o lucro típico fica em 2% a 3%, e acima de 7% é raro.
      </p>
      <div className="mt-6">
        <Calculator />
      </div>
    </section>
  )
}
