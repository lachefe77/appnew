const { db } = require('./db');

function seedMegaCatalog({ silent = false } = {}) {
const log = silent ? () => {} : (...a) => console.log(...a);
log('--- INICIANDO INJEÇÃO DO MEGA-CATÁLOGO ASIÁTICO & BRASILEIRO ---');

const CATEGORIES = [
  { name: 'Instagram - Seguidores', icon: 'fa-brands fa-instagram', platform: 'instagram', sort_order: 1 },
  { name: 'Instagram - Curtidas & Engajamento', icon: 'fa-solid fa-heart', platform: 'instagram', sort_order: 2 },
  { name: 'Instagram - Reels, Stories & Live', icon: 'fa-solid fa-video', platform: 'instagram', sort_order: 3 },
  { name: 'TikTok - Visualizações & FYP', icon: 'fa-brands fa-tiktok', platform: 'tiktok', sort_order: 4 },
  { name: 'TikTok - Seguidores, Curtidas & Live', icon: 'fa-solid fa-users', platform: 'tiktok', sort_order: 5 },
  { name: 'YouTube - Visualizações & Shorts', icon: 'fa-brands fa-youtube', platform: 'youtube', sort_order: 6 },
  { name: 'YouTube - Inscritos, 4.000 Horas & Likes', icon: 'fa-solid fa-circle-play', platform: 'youtube', sort_order: 7 },
  { name: 'Telegram - Membros, Views & Reações', icon: 'fa-brands fa-telegram', platform: 'telegram', sort_order: 8 },
  { name: 'Spotify, Deezer & Música', icon: 'fa-brands fa-spotify', platform: 'spotify', sort_order: 9 },
  { name: 'Kwai - Views, Seguidores & Likes', icon: 'fa-solid fa-play', platform: 'kwai', sort_order: 10 },
  { name: 'LinkedIn - Conexões, Seguidores & Endossos', icon: 'fa-brands fa-linkedin', platform: 'linkedin', sort_order: 11 },
  { name: 'Reddit - Upvotes & Karma', icon: 'fa-brands fa-reddit-alien', platform: 'reddit', sort_order: 12 },
  { name: 'Twitch & Kick - Live Viewers & Followers', icon: 'fa-brands fa-twitch', platform: 'twitch', sort_order: 13 },
  { name: 'Discord - Membros Online & Hype', icon: 'fa-brands fa-discord', platform: 'discord', sort_order: 14 },
  { name: 'X (Twitter) - Seguidores, Retweets & Likes', icon: 'fa-brands fa-x-twitter', platform: 'twitter', sort_order: 15 },
  { name: 'Threads - Seguidores & Curtidas', icon: 'fa-solid fa-at', platform: 'threads', sort_order: 16 },
  { name: 'Facebook - Páginas, Reações & Compartilhamentos', icon: 'fa-brands fa-facebook', platform: 'facebook', sort_order: 17 },
  { name: 'Pinterest - Seguidores & Repins', icon: 'fa-brands fa-pinterest', platform: 'pinterest', sort_order: 18 },
  { name: 'Tráfego Web Orgânico & Google Maps', icon: 'fa-solid fa-globe', platform: 'trafego', sort_order: 19 }
];

const catMap = {};

for (const c of CATEGORIES) {
  let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(c.name);
  if (!cat) {
    const res = db.prepare('INSERT INTO categories (name, icon, platform, sort_order) VALUES (?, ?, ?, ?)').run(c.name, c.icon, c.platform, c.sort_order);
    catMap[c.name] = res.lastInsertRowid;
  } else {
    catMap[c.name] = cat.id;
  }
}

const SERVICES = [
  // INSTAGRAM SEGUIDORES
  {
    category: 'Instagram - Seguidores',
    name: 'Instagram Seguidores [Brasileiros Reais] - Perfis com Foto e Bio (Reposição 30d)',
    platform: 'instagram',
    cost: 450, price: 1890, min: 100, max: 50000, refill: 1, avg: '5 a 20 minutos',
    desc: 'Perfis brasileiros de alta qualidade com fotos e biografia. Entrega gradual sem bloqueios. Garantia de reposição automática de 30 dias.'
  },
  {
    category: 'Instagram - Seguidores',
    name: 'Instagram Seguidores [Globais Turbo] - Velocidade Extrema 50k/dia (Não-Queda)',
    platform: 'instagram',
    cost: 250, price: 1190, min: 200, max: 200000, refill: 1, avg: 'Instantâneo (< 2 min)',
    desc: 'Injeção rápida de autoridade internacional para grandes perfis. Velocidade de até 50.000 seguidores por dia.'
  },
  {
    category: 'Instagram - Seguidores',
    name: 'Instagram Seguidores [Segmentados Femininos Brasil] - Alta Qualidade',
    platform: 'instagram',
    cost: 750, price: 2990, min: 100, max: 20000, refill: 1, avg: '10 a 45 minutos',
    desc: 'Foco exclusivo em perfis femininos reais no Brasil. Perfeito para lojas de moda, cosméticos, estética e influenciadoras.'
  },
  {
    category: 'Instagram - Seguidores',
    name: 'Instagram Seguidores [Segmentados Masculinos Brasil] - Alta Retenção',
    platform: 'instagram',
    cost: 750, price: 2990, min: 100, max: 20000, refill: 1, avg: '10 a 45 minutos',
    desc: 'Perfis masculinos brasileiros para nichos de barbearia, academia, negócios e finanças.'
  },

  // INSTAGRAM CURTIDAS & ENGAJAMENTO
  {
    category: 'Instagram - Curtidas & Engajamento',
    name: 'Instagram Curtidas [Brasileiras Reais] - Início Instantâneo (< 30s)',
    platform: 'instagram',
    cost: 150, price: 790, min: 50, max: 30000, refill: 1, avg: 'Instantâneo (< 30s)',
    desc: 'Curtidas imediatas de contas reais brasileiras para impulsionar suas postagens nas primeiras horas.'
  },
  {
    category: 'Instagram - Curtidas & Engajamento',
    name: 'Instagram Curtidas [Globais Econômicas] - Alta Velocidade',
    platform: 'instagram',
    cost: 50, price: 390, min: 100, max: 100000, refill: 0, avg: 'Instantâneo',
    desc: 'Menor custo por mil para grandes lotes de curtidas em fotos e carrosséis.'
  },
  {
    category: 'Instagram - Curtidas & Engajamento',
    name: 'Instagram Comentários [Brasileiros Personalizados] - Usuário Digita os Textos',
    platform: 'instagram',
    cost: 950, price: 3990, min: 10, max: 2000, refill: 0, avg: '15 a 60 minutos',
    desc: 'Você escreve linha por linha exatamente o que deseja que os perfis comentem na sua foto ou Reels.'
  },
  {
    category: 'Instagram - Curtidas & Engajamento',
    name: 'Instagram Comentários [Emojis Positivos & Elogios]',
    platform: 'instagram',
    cost: 350, price: 1490, min: 20, max: 5000, refill: 0, avg: '5 a 15 minutos',
    desc: 'Comentários com emojis variados (🔥👏❤️😍) para simular alta interação orgânica no post.'
  },
  {
    category: 'Instagram - Curtidas & Engajamento',
    name: 'Instagram Salvamentos & Compartilhamentos [Booster de Algoritmo]',
    platform: 'instagram',
    cost: 120, price: 690, min: 50, max: 50000, refill: 0, avg: 'Instantâneo',
    desc: 'Aumenta os indicadores de compartilhamento e salvamento para o Instagram entender o conteúdo como viral.'
  },

  // INSTAGRAM REELS, STORIES & LIVE
  {
    category: 'Instagram - Reels, Stories & Live',
    name: 'Instagram Visualizações [Reels FYP Viral] - Início em 60s',
    platform: 'instagram',
    cost: 40, price: 290, min: 500, max: 1000000, refill: 0, avg: 'Menos de 60 segundos',
    desc: 'Entrega imediata em Reels públicos para acionar o algoritmo de recomendação da aba Explorar.'
  },
  {
    category: 'Instagram - Reels, Stories & Live',
    name: 'Instagram Visualizações de Stories [Últimos 10 Stories Postados]',
    platform: 'instagram',
    cost: 100, price: 590, min: 100, max: 50000, refill: 0, avg: 'Instantâneo',
    desc: 'Visualizações distribuídas automaticamente em todos os stories ativos das últimas 24 horas.'
  },
  {
    category: 'Instagram - Reels, Stories & Live',
    name: 'Instagram Espectadores de Live [Permanência 30 Minutos]',
    platform: 'instagram',
    cost: 850, price: 3490, min: 50, max: 5000, refill: 0, avg: '2 a 5 minutos na live',
    desc: 'Contas que entram na sua transmissão ao vivo e permanecem assistindo por 30 minutos ininterruptos.'
  },
  {
    category: 'Instagram - Reels, Stories & Live',
    name: 'Instagram Votos em Enquete de Stories [Opção 1 ou 2]',
    platform: 'instagram',
    cost: 200, price: 990, min: 100, max: 10000, refill: 0, avg: '5 a 15 minutos',
    desc: 'Direciona milhares de votos para competições, enquetes de stories ou premiações online.'
  },

  // TIKTOK
  {
    category: 'TikTok - Visualizações & FYP',
    name: 'TikTok Visualizações [FYP Ultra Rápidas] - Início em 30s (Sem Queda)',
    platform: 'tiktok',
    cost: 20, price: 150, min: 1000, max: 5000000, refill: 0, avg: '30 segundos',
    desc: 'Visualizações de alta velocidade para acionar o algoritmo do Para Você nos primeiros minutos.'
  },
  {
    category: 'TikTok - Visualizações & FYP',
    name: 'TikTok Visualizações [Geolocalizadas Brasil FYP]',
    platform: 'tiktok',
    cost: 80, price: 490, min: 500, max: 1000000, refill: 0, avg: '1 a 5 minutos',
    desc: 'Visualizações exclusivas de IPs brasileiros para direcionar o vídeo para a audiência nacional.'
  },
  {
    category: 'TikTok - Seguidores, Curtidas & Live',
    name: 'TikTok Seguidores [Reais c/ Reposição 30d] - Início Rápido',
    platform: 'tiktok',
    cost: 450, price: 1990, min: 100, max: 50000, refill: 1, avg: '5 a 30 minutos',
    desc: 'Seguidores para liberar lives no TikTok (bater os 1.000 seguidores) e monetização de perfil.'
  },
  {
    category: 'TikTok - Seguidores, Curtidas & Live',
    name: 'TikTok Curtidas [Alta Retenção em Vídeos]',
    platform: 'tiktok',
    cost: 150, price: 890, min: 50, max: 50000, refill: 1, avg: 'Instantâneo',
    desc: 'Curtidas imediatas para melhorar o ranking de retenção do vídeo perante a plataforma.'
  },
  {
    category: 'TikTok - Seguidores, Curtidas & Live',
    name: 'TikTok Compartilhamentos & Salvamentos [Viral Booster]',
    platform: 'tiktok',
    cost: 60, price: 390, min: 100, max: 100000, refill: 0, avg: 'Instantâneo',
    desc: 'Multiplica a taxa de compartilhamento dos vídeos gerando tração orgânica rápida.'
  },
  {
    category: 'TikTok - Seguidores, Curtidas & Live',
    name: 'TikTok Espectadores de Live [Permanência 60 Minutos]',
    platform: 'tiktok',
    cost: 950, price: 3990, min: 50, max: 10000, refill: 0, avg: '2 a 5 minutos na live',
    desc: 'Retenção na live do TikTok para empurrar a transmissão para a aba Live Recomendadas.'
  },

  // YOUTUBE
  {
    category: 'YouTube - Visualizações & Shorts',
    name: 'YouTube Visualizações [Alta Retenção 3 a 10 Minutos] - Recomendado para SEO',
    platform: 'youtube',
    cost: 380, price: 1690, min: 500, max: 500000, refill: 1, avg: '15 a 60 minutos',
    desc: 'Tempo de exibição alto garantido. Não é ping falso, simula retenção real para ranquear no buscador.'
  },
  {
    category: 'YouTube - Visualizações & Shorts',
    name: 'YouTube Shorts [Visualizações Instantâneas FYP]',
    platform: 'youtube',
    cost: 90, price: 590, min: 500, max: 1000000, refill: 0, avg: '5 a 15 minutos',
    desc: 'Visualizações de alta velocidade para impulsionar vídeos curtos na prateleira do YouTube Shorts.'
  },
  {
    category: 'YouTube - Inscritos, 4.000 Horas & Likes',
    name: 'YouTube Inscritos [Reais para Canal] - Garantia de Não-Queda (Reposição 30d)',
    platform: 'youtube',
    cost: 850, price: 3890, min: 50, max: 20000, refill: 1, avg: '1 a 6 horas',
    desc: 'Inscritos estáveis com perfis ativos para bater a meta de 1.000 inscritos do Programa de Parcerias.'
  },
  {
    category: 'YouTube - Inscritos, 4.000 Horas & Likes',
    name: 'YouTube Pacote 4.000 Horas de Exibição [Monetização Acelerada]',
    platform: 'youtube',
    cost: 8900, price: 28900, min: 1, max: 5, refill: 1, avg: '3 a 7 dias',
    desc: 'Pacote completo de 4.000 horas em vídeos de 15 a 60 minutos para aprovação no AdSense do canal.'
  },
  {
    category: 'YouTube - Inscritos, 4.000 Horas & Likes',
    name: 'YouTube Curtidas (Likes) em Vídeos',
    platform: 'youtube',
    cost: 180, price: 990, min: 50, max: 50000, refill: 1, avg: '10 a 30 minutos',
    desc: 'Likes imediatos para vídeos e Shorts com reposição de 30 dias.'
  },
  {
    category: 'YouTube - Inscritos, 4.000 Horas & Likes',
    name: 'YouTube Espectadores de Live Stream [Permanência 60 Minutos]',
    platform: 'youtube',
    cost: 1100, price: 4990, min: 50, max: 10000, refill: 0, avg: 'Instantâneo na live',
    desc: 'Espectadores estáveis durante transmissões ao vivo para elevar a live no topo das buscas do nicho.'
  },

  // TELEGRAM
  {
    category: 'Telegram - Membros, Views & Reações',
    name: 'Telegram Membros para Canal / Grupo Público [Não-Queda]',
    platform: 'telegram',
    cost: 220, price: 990, min: 100, max: 100000, refill: 1, avg: '10 a 30 minutos',
    desc: 'Membros estáveis com avatares reais para canais de apostas, cripto, ofertas e comunidades VIP.'
  },
  {
    category: 'Telegram - Membros, Views & Reações',
    name: 'Telegram Membros para Grupo Privado (+join link)',
    platform: 'telegram',
    cost: 280, price: 1290, min: 100, max: 50000, refill: 1, avg: '15 a 45 minutos',
    desc: 'Compatível com links de convite privados fechados com símbolo (+).'
  },
  {
    category: 'Telegram - Membros, Views & Reações',
    name: 'Telegram Visualizações nas Últimas 20 Postagens do Canal',
    platform: 'telegram',
    cost: 80, price: 490, min: 100, max: 50000, refill: 0, avg: 'Instantâneo',
    desc: 'Visualizações automáticas distribuídas em todas as postagens recentes do canal.'
  },
  {
    category: 'Telegram - Membros, Views & Reações',
    name: 'Telegram Reações Positivas em Mensagens (👍🔥❤️)',
    platform: 'telegram',
    cost: 60, price: 390, min: 50, max: 20000, refill: 0, avg: 'Instantâneo',
    desc: 'Reações de emojis positivos para gerar prova social em sinais, avisos e anúncios do grupo.'
  },

  // SPOTIFY, DEEZER & MÚSICA
  {
    category: 'Spotify, Deezer & Música',
    name: 'Spotify Plays / Streams [Brasileiros Reais] - Elegíveis a Royalties',
    platform: 'spotify',
    cost: 180, price: 790, min: 1000, max: 1000000, refill: 1, avg: '12 a 24 horas',
    desc: 'Plays geolocalizados no Brasil via streaming real. Não causa retenção de repasse em distribuidoras.'
  },
  {
    category: 'Spotify, Deezer & Música',
    name: 'Spotify Seguidores para Perfil de Artista',
    platform: 'spotify',
    cost: 150, price: 690, min: 100, max: 50000, refill: 1, avg: 'Instantâneo',
    desc: 'Aumenta a autoridade do artista perante curadores de playlists editoriais.'
  },
  {
    category: 'Spotify, Deezer & Música',
    name: 'Spotify Seguidores para Playlist',
    platform: 'spotify',
    cost: 120, price: 590, min: 100, max: 50000, refill: 1, avg: 'Instantâneo',
    desc: 'Multiplica seguidores em playlists autorais para ranquear no buscador do Spotify.'
  },
  {
    category: 'Spotify, Deezer & Música',
    name: 'Deezer Reproduções / Streams [Brasil]',
    platform: 'spotify',
    cost: 250, price: 1190, min: 1000, max: 500000, refill: 1, avg: '24 horas',
    desc: 'Plays brasileiros reais para alavancar faixas de trap, rap, sertanejo e funk no Deezer.'
  },
  {
    category: 'Spotify, Deezer & Música',
    name: 'SoundCloud Plays & Reposts Globais',
    platform: 'spotify',
    cost: 80, price: 490, min: 500, max: 500000, refill: 0, avg: 'Instantâneo',
    desc: 'Reproduções rápidas e reposts para DJs e produtores de música eletrônica.'
  },

  // KWAI
  {
    category: 'Kwai - Views, Seguidores & Likes',
    name: 'Kwai Visualizações Rápidas em Vídeos',
    platform: 'kwai',
    cost: 30, price: 190, min: 1000, max: 1000000, refill: 0, avg: 'Instantâneo',
    desc: 'Visualizações imediatas para bater as metas de criadores do Kwai.'
  },
  {
    category: 'Kwai - Views, Seguidores & Likes',
    name: 'Kwai Seguidores para Perfil',
    platform: 'kwai',
    cost: 350, price: 1590, min: 100, max: 50000, refill: 1, avg: '10 a 30 minutos',
    desc: 'Seguidores estáveis para monetizar contas de criadores no Kwai Brasil.'
  },
  {
    category: 'Kwai - Views, Seguidores & Likes',
    name: 'Kwai Curtidas em Postagens',
    platform: 'kwai',
    cost: 110, price: 590, min: 50, max: 20000, refill: 0, avg: 'Instantâneo',
    desc: 'Curtidas para simular engajamento e melhorar a entrega orgânica dos vídeos.'
  },

  // LINKEDIN
  {
    category: 'LinkedIn - Conexões, Seguidores & Endossos',
    name: 'LinkedIn Conexões de 1º Grau [Perfis Corporativos]',
    platform: 'linkedin',
    cost: 950, price: 4990, min: 50, max: 5000, refill: 1, avg: '1 a 3 dias',
    desc: 'Aumente o número de conexões profissionais do seu perfil para gerar credibilidade B2B.'
  },
  {
    category: 'LinkedIn - Conexões, Seguidores & Endossos',
    name: 'LinkedIn Seguidores para Company Page Corporativa',
    platform: 'linkedin',
    cost: 650, price: 3490, min: 100, max: 20000, refill: 1, avg: '12 a 24 horas',
    desc: 'Seguidores corporativos para páginas de empresas, startups e agências no LinkedIn.'
  },
  {
    category: 'LinkedIn - Conexões, Seguidores & Endossos',
    name: 'LinkedIn Reações & Likes em Artigos e Posts (👏💡❤️)',
    platform: 'linkedin',
    cost: 450, price: 2190, min: 50, max: 10000, refill: 0, avg: '15 a 45 minutos',
    desc: 'Reações variadas para forçar o algoritmo do feed do LinkedIn a distribuir seus artigos.'
  },

  // REDDIT
  {
    category: 'Reddit - Upvotes & Karma',
    name: 'Reddit Upvotes em Postagens [Subreddits Nacionais e Gringos]',
    platform: 'reddit',
    cost: 650, price: 2990, min: 20, max: 5000, refill: 0, avg: '5 a 20 minutos',
    desc: 'Upvotes imediatos para colocar postagens no topo de subreddits específicos e atrair tráfego quente.'
  },
  {
    category: 'Reddit - Upvotes & Karma',
    name: 'Reddit Upvotes em Comentários [Top Comment Booster]',
    platform: 'reddit',
    cost: 550, price: 2490, min: 20, max: 5000, refill: 0, avg: '5 a 15 minutos',
    desc: 'Coloca seu comentário no topo de threads populares com dezenas de upvotes rápidos.'
  },

  // TWITCH & KICK
  {
    category: 'Twitch & Kick - Live Viewers & Followers',
    name: 'Twitch Espectadores de Live [Permanência 60 Minutos]',
    platform: 'twitch',
    cost: 850, price: 3490, min: 50, max: 5000, refill: 0, avg: 'Instantâneo (< 2 min)',
    desc: 'Espectadores ao vivo que entram na sua stream da Twitch e assistem por 1 hora completa.'
  },
  {
    category: 'Twitch & Kick - Live Viewers & Followers',
    name: 'Twitch Seguidores para Canal',
    platform: 'twitch',
    cost: 150, price: 790, min: 100, max: 50000, refill: 1, avg: 'Instantâneo',
    desc: 'Seguidores para alcançar o status de Afiliado da Twitch (bater os 50 seguidores).'
  },
  {
    category: 'Twitch & Kick - Live Viewers & Followers',
    name: 'Kick Espectadores de Live [Permanência 60 Minutos]',
    platform: 'twitch',
    cost: 950, price: 3990, min: 50, max: 5000, refill: 0, avg: '2 a 5 minutos',
    desc: 'Espectadores ao vivo na plataforma Kick para entrar na aba Destaques da categoria.'
  },

  // DISCORD
  {
    category: 'Discord - Membros Online & Hype',
    name: 'Discord Membros Online com Avatar Real [Permanência 14 Dias]',
    platform: 'discord',
    cost: 550, price: 2490, min: 100, max: 10000, refill: 1, avg: '10 a 30 minutos',
    desc: 'Membros que entram no seu servidor com status online configurado e avatares convincentes.'
  },
  {
    category: 'Discord - Membros Online & Hype',
    name: 'Discord Membros Offline para Volume de Servidor',
    platform: 'discord',
    cost: 250, price: 1190, min: 100, max: 30000, refill: 1, avg: '5 a 15 minutos',
    desc: 'Aumente o contador de membros do servidor para passar autoridade a novos visitantes.'
  },

  // X (TWITTER)
  {
    category: 'X (Twitter) - Seguidores, Retweets & Likes',
    name: 'X (Twitter) Seguidores para Perfil [Não-Queda]',
    platform: 'twitter',
    cost: 450, price: 1990, min: 100, max: 50000, refill: 1, avg: '15 a 45 minutos',
    desc: 'Seguidores estáveis para perfis corporativos, projetos cripto e criadores de conteúdo.'
  },
  {
    category: 'X (Twitter) - Seguidores, Retweets & Likes',
    name: 'X (Twitter) Retweets (Reposts) Instantâneos',
    platform: 'twitter',
    cost: 250, price: 1290, min: 50, max: 20000, refill: 0, avg: 'Instantâneo',
    desc: 'Multiplica o alcance de tweets e notícias nas tendências da plataforma.'
  },
  {
    category: 'X (Twitter) - Seguidores, Retweets & Likes',
    name: 'X (Twitter) Curtidas em Tweets',
    platform: 'twitter',
    cost: 180, price: 890, min: 50, max: 30000, refill: 0, avg: 'Instantâneo',
    desc: 'Likes rápidos para elevar a relevância do post nas conversas do X.'
  },

  // THREADS
  {
    category: 'Threads - Seguidores & Curtidas',
    name: 'Threads Seguidores para Perfil [Início Rápido]',
    platform: 'threads',
    cost: 350, price: 1690, min: 100, max: 50000, refill: 1, avg: '5 a 20 minutos',
    desc: 'Cresça sua presença na nova rede social de texto da Meta com entrega sem quedas.'
  },
  {
    category: 'Threads - Seguidores & Curtidas',
    name: 'Threads Curtidas em Publicações',
    platform: 'threads',
    cost: 150, price: 790, min: 50, max: 20000, refill: 0, avg: 'Instantâneo',
    desc: 'Curtidas imediatas em postagens do Threads para acionar o algoritmo de feed.'
  },

  // FACEBOOK
  {
    category: 'Facebook - Páginas, Reações & Compartilhamentos',
    name: 'Facebook Curtidas & Seguidores para Página Comercial',
    platform: 'facebook',
    cost: 380, price: 1790, min: 100, max: 50000, refill: 1, avg: '15 a 60 minutos',
    desc: 'Prova social indispensável para páginas de negócios locais, clínicas e e-commerces.'
  },
  {
    category: 'Facebook - Páginas, Reações & Compartilhamentos',
    name: 'Facebook Reações em Posts (Love, Care, Wow, Haha)',
    platform: 'facebook',
    cost: 180, price: 890, min: 50, max: 20000, refill: 0, avg: 'Instantâneo',
    desc: 'Reações afetivas personalizadas para postagens no feed do Facebook.'
  },

  // PINTEREST
  {
    category: 'Pinterest - Seguidores & Repins',
    name: 'Pinterest Seguidores para Perfil',
    platform: 'pinterest',
    cost: 350, price: 1690, min: 100, max: 30000, refill: 1, avg: '10 a 30 minutos',
    desc: 'Aumente o alcance dos seus painéis de inspiração, decoração e moda no Pinterest.'
  },
  {
    category: 'Pinterest - Seguidores & Repins',
    name: 'Pinterest Repins & Salvamentos em Pastas',
    platform: 'pinterest',
    cost: 250, price: 1190, min: 50, max: 20000, refill: 0, avg: 'Instantâneo',
    desc: 'Gera tráfego direto para blogs e e-commerces com salvamentos nas pastas dos usuários.'
  },

  // TRÁFEGO WEB & GOOGLE MAPS
  {
    category: 'Tráfego Web Orgânico & Google Maps',
    name: 'Tráfego Web Orgânico [Brasil Analytics Verificado] - 100% Google Referrer',
    platform: 'trafego',
    cost: 150, price: 790, min: 1000, max: 500000, refill: 0, avg: 'Contínuo 24 horas',
    desc: 'Visitas reais com tempo de permanência de 1 a 3 minutos registradas no Google Analytics (GA4).'
  },
  {
    category: 'Tráfego Web Orgânico & Google Maps',
    name: 'Google Maps / Meu Negócio Avaliações 5 Estrelas [Comentários Personalizados]',
    platform: 'trafego',
    cost: 1200, price: 5900, min: 5, max: 500, refill: 1, avg: '1 a 3 dias',
    desc: 'Avaliações com texto personalizado em português de contas com histórico no Google para ranquear no Maps.'
  }
];

let insertedCount = 0;
let updatedCount = 0;

for (const s of SERVICES) {
  const catId = catMap[s.category];
  if (!catId) continue;

  const existing = db.prepare('SELECT id FROM services WHERE name = ?').get(s.name);
  if (!existing) {
    db.prepare(`
      INSERT INTO services (
        category_id, name, platform, type, provider_id, provider_service_id,
        cost_per_k_cents, price_per_k_cents, min_quantity, max_quantity,
        refill_available, avg_time, description, status
      )
      VALUES (?, ?, ?, 'default', 1, 'mock_svc_' || ABS(RANDOM() % 9000), ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(catId, s.name, s.platform, s.cost, s.price, s.min, s.max, s.refill, s.avg, s.desc);
    insertedCount++;
  } else {
    db.prepare(`
      UPDATE services
      SET category_id = ?, platform = ?, cost_per_k_cents = ?, price_per_k_cents = ?,
          min_quantity = ?, max_quantity = ?, refill_available = ?, avg_time = ?, description = ?, status = 'active'
      WHERE id = ?
    `).run(catId, s.platform, s.cost, s.price, s.min, s.max, s.refill, s.avg, s.desc, existing.id);
    updatedCount++;
  }
}

const totalInDb = db.prepare('SELECT COUNT(*) as count FROM services').get().count;
const totalCats = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;

log(`✅ Injeção concluída com sucesso!`);
log(`📦 Novos serviços inseridos: ${insertedCount}`);
log(`🔄 Serviços atualizados: ${updatedCount}`);
log(`📊 Total de Categorias ativas: ${totalCats}`);
log(`🚀 Total de Serviços no Mega-Catálogo: ${totalInDb}`);

return { inserted: insertedCount, updated: updatedCount, totalServices: totalInDb, totalCategories: totalCats };
}

module.exports = { seedMegaCatalog };

if (require.main === module) {
  seedMegaCatalog();
}
