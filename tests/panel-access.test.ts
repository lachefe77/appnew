import { describe, expect, it } from "vitest"
import { decidePanelAccess, type GrantSnapshot } from "@/server/panel-access"

const now = new Date("2026-11-10T12:00:00.000Z")

function grant(partial: Partial<GrantSnapshot>): GrantSnapshot {
  return {
    status: "ativo",
    startsAt: new Date("2026-11-01T00:00:00.000Z"),
    endsAt: new Date("2026-12-01T00:00:00.000Z"),
    ...partial,
  }
}

function decide(overrides: Partial<Parameters<typeof decidePanelAccess>[0]>) {
  return decidePanelAccess({
    banned: false,
    siteOnline: true,
    signalsVisible: true,
    now,
    grants: [],
    ...overrides,
  })
}

describe("acesso ao painel", () => {
  it("fecha sem plano", () => {
    expect(decide({})).toEqual({ open: false, reason: "sem_plano" })
  })

  it("abre com plano vigente", () => {
    expect(decide({ grants: [grant({})] })).toEqual({ open: true })
  })

  it("fecha plano congelado", () => {
    expect(decide({ grants: [grant({ status: "congelado" })] })).toEqual({ open: false, reason: "congelado" })
  })

  it("um plano ativo vence um congelado antigo", () => {
    expect(decide({ grants: [grant({ status: "congelado" }), grant({})] })).toEqual({ open: true })
  })

  it("fecha plano removido", () => {
    expect(decide({ grants: [grant({ status: "removido" })] })).toEqual({ open: false, reason: "removido" })
  })

  it("fecha plano vencido", () => {
    expect(
      decide({
        grants: [grant({ endsAt: new Date("2026-11-01T00:00:00.000Z") })],
      }),
    ).toEqual({ open: false, reason: "expirado" })
  })

  it("o status do site fecha mesmo com plano", () => {
    expect(decide({ signalsVisible: false, grants: [grant({})] })).toEqual({
      open: false,
      reason: "painel_desligado",
    })
  })

  it("manutenção fecha o painel", () => {
    expect(decide({ siteOnline: false, grants: [grant({})] })).toEqual({ open: false, reason: "manutencao" })
  })

  it("conta suspensa não entra na grade", () => {
    expect(decide({ banned: true, grants: [grant({})] })).toEqual({ open: false, reason: "banido" })
  })
})
