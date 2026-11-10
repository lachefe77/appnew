"use client"

import { useEffect, useState } from "react"

type Note = { id: string; body: string; createdAt: string; author: string; mine: boolean }

export function SupportThread({ initial, status }: { initial: Note[]; status: string }) {
  const [notes, setNotes] = useState(initial)
  const [state, setState] = useState(status)
  const [body, setBody] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/suporte")
      if (!response.ok) return
      const data = (await response.json()) as { notes: Note[]; status?: string }
      setNotes(data.notes)
      if (data.status) setState(data.status)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [])

  async function send() {
    setError("")
    const response = await fetch("/api/suporte", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    })
    const data = (await response.json()) as { error?: string; notes?: Note[]; status?: string }
    if (!response.ok) {
      setError(data.error ?? "Não enviou.")
      return
    }
    setBody("")
    if (data.notes) setNotes(data.notes)
    if (data.status) setState(data.status)
  }

  return (
    <div>
      <p className="mb-3 text-sm text-mist">{state === "resolvido" ? "A moderação marcou esta conversa como resolvida." : "Conversa aberta com a moderação."}</p>
      <div className="space-y-2">
        {notes.map((note) => (
          <article key={note.id} className={`max-w-xl rounded-xl border border-line px-4 py-3 text-sm ${note.mine ? "ml-auto bg-[#e7f6ee]" : "bg-white"}`}>
            <p className="text-xs text-mist">{note.mine ? "Você" : note.author}</p>
            <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
          </article>
        ))}
        {!notes.length ? <p className="text-sm text-mist">Nenhuma mensagem ainda. Escreva para a moderação.</p> : null}
      </div>
      {error ? <p className="mt-3 text-sm text-[#8d2b2b]">{error}</p> : null}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <textarea className="field min-h-20" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Mensagem" />
        <button className="btn-primary self-end" type="submit">
          Enviar
        </button>
      </form>
    </div>
  )
}
