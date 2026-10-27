export type FixtureProduct = {
  supplierSource: "CJ_BRAZIL" | "BLING_HUB";
  supplierSku: string;
  title: string;
  slug: string;
  description: string;
  category: "ferramentas" | "bem-estar" | "pet";
  supplierCostCents: number;
  stockQuantity: number;
  weightGrams: number;
};

export const FIXTURES: FixtureProduct[] = [
  {
    supplierSource: "CJ_BRAZIL",
    supplierSku: "NH-PAR-21V",
    title: "Parafusadeira 21V com maleta",
    slug: "parafusadeira-21v",
    description:
      "Parafusadeira a bateria com mandril de troca rápida, duas velocidades e maleta para guardar bits. Serve para montar móvel, cortina e suporte de TV sem cabo no meio do caminho.",
    category: "ferramentas",
    supplierCostCents: 14900,
    stockQuantity: 40,
    weightGrams: 1800,
  },
  {
    supplierSource: "CJ_BRAZIL",
    supplierSku: "NH-LAV-BAT",
    title: "Lavadora portátil de alta pressão",
    slug: "lavadora-portatil",
    description:
      "Lavadora a bateria com bico regulável para bicicleta, móvel de área externa e detalhe de carro. O tanque é pequeno de propósito: enche na torneira e leva até a garagem.",
    category: "ferramentas",
    supplierCostCents: 18900,
    stockQuantity: 22,
    weightGrams: 2400,
  },
  {
    supplierSource: "CJ_BRAZIL",
    supplierSku: "NH-NIV-12L",
    title: "Nível a laser verde 12 linhas",
    slug: "nivel-laser-12-linhas",
    description:
      "Nível a laser de linhas verdes com base magnética para marcar prateleira, quadros e piso. Estoque de demonstração abaixo do mínimo, então a vitrine deixa este item pausado.",
    category: "ferramentas",
    supplierCostCents: 12900,
    stockQuantity: 4,
    weightGrams: 700,
  },
  {
    supplierSource: "BLING_HUB",
    supplierSku: "NH-MOT-BAT",
    title: "Mini motosserra a bateria",
    slug: "mini-motosserra",
    description:
      "Motosserra compacta para poda de galho fino e corte de madeira leve. Acompanha sabre curto e protetor. Não substitui uma serra de pátio.",
    category: "ferramentas",
    supplierCostCents: 15900,
    stockQuantity: 18,
    weightGrams: 1600,
  },
  {
    supplierSource: "BLING_HUB",
    supplierSku: "NH-FEC-BIO",
    title: "Fechadura eletrônica com biometria",
    slug: "fechadura-biometrica",
    description:
      "Fechadura de sobrepor com leitura de digital, senha e chave física de reserva. A instalação pede furar a porta; o manual traz o gabarito.",
    category: "ferramentas",
    supplierCostCents: 22000,
    stockQuantity: 15,
    weightGrams: 2100,
  },
  {
    supplierSource: "CJ_BRAZIL",
    supplierSku: "NH-PIS-MSG",
    title: "Pistola massageadora muscular",
    slug: "pistola-massageadora",
    description:
      "Pistola de massagem com ponteiras para conforto muscular depois de treino ou jornada longa. É um aparelho de uso doméstico, não um tratamento clínico.",
    category: "bem-estar",
    supplierCostCents: 9900,
    stockQuantity: 30,
    weightGrams: 900,
  },
  {
    supplierSource: "CJ_BRAZIL",
    supplierSku: "NH-CER-TER",
    title: "Massageador cervical térmico",
    slug: "massageador-cervical",
    description:
      "Apoio de pescoço com calor brando e nós de massagem. Bom para usar na cadeira no fim do dia. O calor desliga sozinho no ciclo do aparelho.",
    category: "bem-estar",
    supplierCostCents: 7900,
    stockQuantity: 26,
    weightGrams: 850,
  },
  {
    supplierSource: "BLING_HUB",
    supplierSku: "NH-BOT-AR",
    title: "Bota de compressão pneumática",
    slug: "bota-compressao",
    description:
      "Par de botas que inflam e esvaziam em ciclos, para quem passa o dia em pé e quer um descanso em casa. Uso doméstico, sem promessa terapêutica.",
    category: "bem-estar",
    supplierCostCents: 24900,
    stockQuantity: 12,
    weightGrams: 2800,
  },
  {
    supplierSource: "BLING_HUB",
    supplierSku: "NH-FAI-POS",
    title: "Faixa de apoio postural",
    slug: "faixa-postural",
    description:
      "Faixa ajustável para lembrar a postura enquanto se trabalha sentado. Não é órtese médica e não corrige lesão.",
    category: "bem-estar",
    supplierCostCents: 4900,
    stockQuantity: 40,
    weightGrams: 250,
  },
  {
    supplierSource: "BLING_HUB",
    supplierSku: "NH-BEB-INOX",
    title: "Fonte bebedouro inox para gatos",
    slug: "bebedouro-inox-gatos",
    description:
      "Fonte de água em aço com filtro e fluxo contínuo. A bomba é silenciosa o bastante para ficar na sala. Lave o reservatório a cada poucos dias.",
    category: "pet",
    supplierCostCents: 8900,
    stockQuantity: 20,
    weightGrams: 1100,
  },
  {
    supplierSource: "CJ_BRAZIL",
    supplierSku: "NH-COM-WIFI",
    title: "Comedouro automático Wi-Fi",
    slug: "comedouro-wifi",
    description:
      "Comedouro com porções programadas e alerta de falta de ração. O aplicativo pede a rede de 2,4 GHz da casa.",
    category: "pet",
    supplierCostCents: 13900,
    stockQuantity: 16,
    weightGrams: 1700,
  },
  {
    supplierSource: "BLING_HUB",
    supplierSku: "NH-RAS-VAP",
    title: "Rasqueadeira a vapor recarregável",
    slug: "rasqueadeira-vapor",
    description:
      "Escova com vapor leve para soltar pelo morto na tosa de manutenção. Use no pelo seco e escovado, longe do focinho do animal.",
    category: "pet",
    supplierCostCents: 6900,
    stockQuantity: 28,
    weightGrams: 420,
  },
];
