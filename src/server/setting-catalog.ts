export type SettingKind = "text" | "longtext" | "number" | "boolean"

export type SettingItem = {
  key: string
  label: string
  group: "status" | "textos" | "parametros"
  kind: SettingKind
  defaultValue: string
  hint?: string
}

export const SETTING_CATALOG: SettingItem[] = [
  {
    key: "site.online",
    label: "Site no ar",
    group: "status",
    kind: "boolean",
    defaultValue: "true",
    hint: "Desligado, o público vê a manutenção. A entrada continua no ar.",
  },
  {
    key: "site.registrationOpen",
    label: "Cadastro aberto",
    group: "status",
    kind: "boolean",
    defaultValue: "true",
    hint: "Desligado, ninguém cria conta nova.",
  },
  {
    key: "site.signalsVisible",
    label: "Painel de sinais visível",
    group: "status",
    kind: "boolean",
    defaultValue: "true",
    hint: "Desligado, a grade fecha mesmo com plano ativo.",
  },
  {
    key: "site.noticesVisible",
    label: "Avisos visíveis",
    group: "status",
    kind: "boolean",
    defaultValue: "true",
    hint: "Desligado, os avisos publicados somem do site.",
  },
  {
    key: "plan.defaultDurationDays",
    label: "Duração padrão ao conceder (dias)",
    group: "parametros",
    kind: "number",
    defaultValue: "30",
    hint: "Usada quando o plano não tem duração própria.",
  },
  {
    key: "money.currency",
    label: "Moeda padrão",
    group: "parametros",
    kind: "text",
    defaultValue: "BRL",
    hint: "Três letras. A banca nova nasce nesta moeda.",
  },
  {
    key: "brand.name",
    label: "Nome da casa",
    group: "textos",
    kind: "text",
    defaultValue: "Fut Surebet",
  },
  {
    key: "brand.tagline",
    label: "Linha da casa",
    group: "textos",
    kind: "text",
    defaultValue: "Casa de sinais com plano explícito.",
  },
  {
    key: "home.kicker",
    label: "Rótulo do início",
    group: "textos",
    kind: "text",
    defaultValue: "Casa de sinais",
  },
  {
    key: "home.title",
    label: "Título do início",
    group: "textos",
    kind: "longtext",
    defaultValue: "O painel abre quando o plano está ativo",
  },
  {
    key: "home.lead",
    label: "Texto do início",
    group: "textos",
    kind: "longtext",
    defaultValue:
      "Crie a conta, entre e acompanhe a situação do plano. Sem plano ativo, a grade de sinais fica fechada.",
  },
  {
    key: "home.sports",
    label: "Esportes em preparação",
    group: "textos",
    kind: "text",
    defaultValue: "Futebol, Basquete, Tênis, Vôlei",
    hint: "Separe por vírgula.",
  },
  {
    key: "home.step1Title",
    label: "Passo 1, título",
    group: "textos",
    kind: "text",
    defaultValue: "Conta",
  },
  {
    key: "home.step1Body",
    label: "Passo 1, texto",
    group: "textos",
    kind: "longtext",
    defaultValue: "O cadastro libera o acesso. A grade continua fechada.",
  },
  {
    key: "home.step2Title",
    label: "Passo 2, título",
    group: "textos",
    kind: "text",
    defaultValue: "Plano",
  },
  {
    key: "home.step2Body",
    label: "Passo 2, texto",
    group: "textos",
    kind: "longtext",
    defaultValue: "Um plano ativo, concedido na administração, abre o painel.",
  },
  {
    key: "home.step3Title",
    label: "Passo 3, título",
    group: "textos",
    kind: "text",
    defaultValue: "Grade",
  },
  {
    key: "home.step3Body",
    label: "Passo 3, texto",
    group: "textos",
    kind: "longtext",
    defaultValue: "Os sinais entram na grade. Esta versão ainda não traz odds ao vivo.",
  },
  {
    key: "plans.title",
    label: "Título dos planos",
    group: "textos",
    kind: "text",
    defaultValue: "Planos",
  },
  {
    key: "plans.lead",
    label: "Texto dos planos",
    group: "textos",
    kind: "longtext",
    defaultValue:
      "O preço e a duração saem da administração. A cobrança por Pix e cripto ainda não está nesta versão.",
  },
  {
    key: "plans.closedNote",
    label: "Nota de compra fechada",
    group: "textos",
    kind: "text",
    defaultValue: "A compra ainda não está aberta.",
  },
  {
    key: "panel.lockedTitle",
    label: "Título do painel fechado",
    group: "textos",
    kind: "text",
    defaultValue: "Painel fechado",
  },
  {
    key: "panel.lockedBody",
    label: "Texto do painel fechado",
    group: "textos",
    kind: "longtext",
    defaultValue:
      "Os sinais ficam disponíveis com um plano ativo e com o painel ligado na administração.",
  },
  {
    key: "panel.emptyTitle",
    label: "Título da grade vazia",
    group: "textos",
    kind: "text",
    defaultValue: "Grade vazia",
  },
  {
    key: "panel.emptyBody",
    label: "Texto da grade vazia",
    group: "textos",
    kind: "longtext",
    defaultValue: "O plano está ativo. Não há odds ao vivo nesta versão.",
  },
  {
    key: "panel.filtersNote",
    label: "Nota dos filtros",
    group: "textos",
    kind: "text",
    defaultValue: "Filtros de casas, stake e lucro entram com a grade.",
  },
  {
    key: "site.maintenanceTitle",
    label: "Título da manutenção",
    group: "textos",
    kind: "text",
    defaultValue: "Casa fechada",
  },
  {
    key: "site.maintenanceBody",
    label: "Texto da manutenção",
    group: "textos",
    kind: "longtext",
    defaultValue:
      "O Fut Surebet está fora do ar para o público. O acesso de administração continua pela entrada.",
  },
  {
    key: "site.footer",
    label: "Rodapé",
    group: "textos",
    kind: "longtext",
    defaultValue: "Fut Surebet. Textos, planos e status saem da administração.",
  },
  {
    key: "auth.registerClosed",
    label: "Aviso de cadastro fechado",
    group: "textos",
    kind: "longtext",
    defaultValue: "O cadastro está fechado.",
  },
  {
    key: "auth.loginLead",
    label: "Texto da entrada",
    group: "textos",
    kind: "longtext",
    defaultValue: "Use o e-mail e a senha da sua conta.",
  },
  {
    key: "auth.registerLead",
    label: "Texto do cadastro",
    group: "textos",
    kind: "longtext",
    defaultValue: "A conta nova entra sem plano. O painel de sinais começa fechado.",
  },
]

export function catalogDefault(key: string) {
  return SETTING_CATALOG.find((item) => item.key === key)?.defaultValue ?? ""
}
