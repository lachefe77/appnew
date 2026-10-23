function escapeText(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
}
/**
 * SMM HUB SAAS - COMPLETE ENTERPRISE SUITE CLIENT LOGIC
 */

const state = {
  token: localStorage.getItem('smm_token') || null,
  user: null,
  currentView: 'dashboard',
  storefrontPlatform: 'all',
  adminPrivacyMode: false,
  currency: 'BRL',
  exchangeRates: { BRL: 1.0, USD: 0.18, EUR: 0.16 }, // Dynamic multipliers
  categories: [],
  services: [],
  selectedService: null,
  activePixInvoice: null,
  activeCryptoInvoice: null,
  appliedCoupon: null,
  orders: [],
  ordersFilter: 'all',
  ordersSearch: '',
  affiliateStats: null,
  subscriptions: [],
  childPanels: [],
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  const urlParams = new URLSearchParams(window.location.search);
  const refParam = urlParams.get('ref');
  if (refParam) {
    localStorage.setItem('smm_ref', refParam.toUpperCase());
    const regRefInput = document.getElementById('reg-ref');
    if (regRefInput) regRefInput.value = refParam.toUpperCase();
  }

  localStorage.removeItem('smmhub_theme');

  if (state.token) {
    await fetchUserProfile();
  } else {
    state.user = null;
  }
  if(!state.user)return;

  await loadCategoriesAndServices();

  navigateTo(location.hash.slice(1) || 'dashboard');

  setupSmartLinkInspector();

  setInterval(() => {
    if (state.token && state.currentView === 'orders') {
      loadUserOrders(false);
    }
    if (state.token && state.currentView === 'admin-dashboard') {
      loadAdminMetrics();
    }
  }, 7000);
});

function setupEventListeners() {
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('main-sidebar');
  if (btnToggleSidebar && sidebar) {
    btnToggleSidebar.addEventListener('click', () => {
      sidebar.classList.toggle('-translate-x-full');
    });
  }

  const btnUserMenu = document.getElementById('btn-user-menu');
  const userDropdown = document.getElementById('user-dropdown');
  if (btnUserMenu && userDropdown) {
    btnUserMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      userDropdown.classList.add('hidden');
    });
  }
}

// --- API HELPER ---
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if(['/api/auth/login','/api/auth/register'].includes(endpoint))headers['X-Session-Transport']='cookie';
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const config = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) {
    config.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(endpoint, config);
    const data = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'Erro na requisição.'), {
        status: res.status,
        needs_2fa: data.needs_2fa,
      });
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// --- CURRENCY CONVERTER ---
function formatPrice(centsBRL) {
  const brl = centsBRL / 100;
  if (state.currency === 'USD') {
    return `$ ${(brl * (state.exchangeRates.USD || 0.18)).toFixed(2)}`;
  }
  if (state.currency === 'EUR') {
    return `€ ${(brl * (state.exchangeRates.EUR || 0.16)).toFixed(2)}`;
  }
  if (state.currency === 'USDT') {
    return `₮ ${(brl / 5.6).toFixed(2)}`;
  }
  return `R$ ${brl.toFixed(2).replace('.', ',')}`;
}

function changeCurrency(curr) {
  state.currency = curr;
  updateUserUI();
  if (state.selectedService) onServiceChanged();
  if (state.currentView === 'services') renderCatalogTable();
  if (state.currentView === 'orders') renderOrdersTable();
  if (state.currentView === 'storefront') renderStorefrontCards();
  showToast(`Moeda de exibição alterada para ${curr}.`, 'info');
}

// --- ANNOUNCEMENTS ---
async function loadActiveAnnouncement() {
  try {
    const data = await apiCall('/api/announcements/active');
    if (data.announcement) {
      const banner = document.getElementById('announcement-banner');
      banner.classList.remove('hidden');
      document.getElementById('announcement-badge').innerText =
        data.announcement.badge || 'HOT';
      document.getElementById('announcement-title').innerText =
        data.announcement.title;
      document.getElementById('announcement-message').innerText =
        data.announcement.message;
    }
  } catch (err) {}
}

// --- AUTHENTICATION ---
async function fetchUserProfile() {
  try {
    const data = await apiCall('/api/auth/me');
    state.user = data.user;
    state.affiliateStats = data.affiliate;
    updateUserUI();
  } catch (err) {
    if (err.status === 401) logout();
    else
      showToast(
        'Não foi possível atualizar o perfil. Tente novamente.',
        'error'
      );
  }
}

function updateUserUI() {
  const sfBalance = document.getElementById('storefront-wallet-balance');
  const fastBalance = document.getElementById('fast-user-balance-display');

  if (!state.user) {
    document.getElementById('topbar-user-name').innerText = 'Convidado';
    document.getElementById('topbar-balance').innerText = 'R$ 0,00';
    if (sfBalance) sfBalance.innerText = 'R$ 0,00';
    if (fastBalance) fastBalance.innerText = 'R$ 0,00';
    document.getElementById('admin-nav-section')?.classList.add('hidden');
    return;
  }

  const formattedBal = formatPrice(state.user.balance_cents || 0);
  document.getElementById('topbar-user-name').innerText =
    state.user.name.split(' ')[0];
  document.getElementById('dropdown-user-email').innerText = state.user.email;
  document.getElementById('dropdown-user-tier').innerText =
    `NÍVEL ${state.user.tier || 'VIP'}`;

  const tierBadge = document.getElementById('topbar-tier-badge');
  if (tierBadge) tierBadge.innerText = state.user.tier || 'VIP';

  document.getElementById('topbar-balance').innerText = formattedBal;
  if (sfBalance) sfBalance.innerText = formattedBal;
  if (fastBalance) fastBalance.innerText = formattedBal;

  const adminNav = document.getElementById('admin-nav-section');
  if (['admin', 'ceo'].includes(state.user.role)) {
    adminNav?.classList.remove('hidden');
  } else {
    adminNav?.classList.add('hidden');
  }
  document.getElementById('support-nav-section')?.classList.toggle('hidden',!['support','admin','ceo'].includes(state.user.role));

  const keyDisplay = document.getElementById('api-key-display');
  if (keyDisplay) keyDisplay.value = state.user.api_key;

  const affInput = document.getElementById('affiliate-link-input');
  if (affInput && state.user.ref_code) {
    affInput.value = `${window.location.origin}/?ref=${state.user.ref_code}`;
  }

  // Render recent orders on storefront
  renderStorefrontRecentOrders();
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const data = await apiCall('/api/auth/login', 'POST', {
      email,
      password,
      totp_code: document.getElementById('login-factor')?.value || undefined,
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('smm_token', data.token);
    closeAuthModal();
    await fetchUserProfile();
    showToast(`Bem-vindo, ${state.user.name}!`, 'success');
    navigateTo('new-order');
  } catch (err) {
    if (err.needs_2fa) {
      const input = document.getElementById('login-factor');
      input.closest('label').classList.remove('hidden');
      input.focus();
    }
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const ref =
    document.getElementById('reg-ref').value || localStorage.getItem('smm_ref');

  try {
    const data = await apiCall('/api/auth/register', 'POST', {
      name,
      email,
      password,
      ref,
      consent_terms:
        document.getElementById('reg-consent-terms')?.checked === true,
      captcha_token:
        document.getElementById('form-register')?.dataset.captchaToken,
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('smm_token', data.token);
    closeAuthModal();
    await fetchUserProfile();
    showToast('Conta criada com sucesso!', 'success');
    navigateTo('new-order');
  } catch (err) {
  } finally {
    window.resetRegistrationCaptcha?.(document.getElementById('form-register'));
  }
}

async function quickLogin(email, password) {
  try {
    const data = await apiCall('/api/auth/login', 'POST', { email, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('smm_token', data.token);
    closeAuthModal();
    await fetchUserProfile();
    showToast(`Conectado como: ${state.user.name}`, 'info');
    navigateTo('new-order');
  } catch (err) {}
}

function logout() {
  if (state.token)
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + state.token },
    }).catch(() => {});
  state.token = null;
  state.user = null;
  localStorage.removeItem('smm_token');
  updateUserUI();
  showToast('Desconectado com sucesso.', 'info');
  location.replace('/login.html');
}

function openAuthModal() {
  document.getElementById('modal-auth').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('modal-auth').classList.add('hidden');
}

function openTermsModal() {
  document.getElementById('modal-terms').classList.remove('hidden');
}

function closeTermsModal() {
  document.getElementById('modal-terms').classList.add('hidden');
}

function toggleAuthTab(tab) {
  const formLogin = document.getElementById('form-login');
  const formReg = document.getElementById('form-register');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');

  if (tab === 'login') {
    formLogin.classList.remove('hidden');
    formReg.classList.add('hidden');
    tabLogin.className =
      'flex-1 pb-2 font-bold text-cyan-400 border-b-2 border-cyan-400';
    tabReg.className = 'flex-1 pb-2 font-bold text-gray-400 hover:text-white';
    document.getElementById('auth-modal-title').innerText = 'Acesse o SMM HUB';
  } else {
    formLogin.classList.add('hidden');
    formReg.classList.remove('hidden');
    tabReg.className =
      'flex-1 pb-2 font-bold text-cyan-400 border-b-2 border-cyan-400';
    tabLogin.className = 'flex-1 pb-2 font-bold text-gray-400 hover:text-white';
    document.getElementById('auth-modal-title').innerText =
      'Crie Sua Conta Grátis';
  }
}

// --- NAVIGATION ---
function navigateTo(viewName) {
  if (viewName === 'storefront' || viewName === 'theme-showroom') viewName = 'dashboard';
  const panelTarget=document.getElementById('view-'+viewName);
  if(!panelTarget){showToast('Esta área não está disponível.','error');return;}
  history.replaceState(null,'','#'+viewName);
  document.getElementById('panel-main')?.scrollTo(0,0);
  // Segregate Admin Area: If attempting to access admin without admin role, trigger Admin Gate
  if (viewName.startsWith('admin-')) {
    if (!state.user || !['admin', 'ceo'].includes(state.user.role)) {
      openAdminGate();
      return;
    }
  }

  state.currentView = viewName;

  document
    .querySelectorAll('.view-panel')
    .forEach((el) => el.classList.add('hidden'));

  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
  }

  document.querySelectorAll('.nav-link').forEach((btn) => {
    if (btn.getAttribute('data-view') === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const sidebar = document.getElementById('main-sidebar');
  if (sidebar && window.innerWidth < 1024) {
    sidebar.classList.add('-translate-x-full');
  }

  if (viewName === 'dashboard') window.loadPanelDashboard?.();
  if (viewName === 'combos') window.loadPanelCombos?.();
  if (viewName === 'orders') loadUserOrders();
  if (viewName === 'services') renderCatalogTable();
  if (viewName === 'wallet') loadWalletTransactions();
  if (viewName === 'subscriptions') loadSubscriptions();
  if (viewName === 'child-panels') loadChildPanels();
  if (viewName === 'affiliates') loadAffiliatesData();
  if (viewName === 'admin-dashboard') loadAdminMetrics();
  if (viewName === 'admin-users') loadAdminUsers();
  if (viewName === 'admin-providers') loadAdminProviders();
  if (viewName === 'admin-services') loadAdminServices();
  if (viewName === 'admin-orders') loadAdminOrders();
  if (viewName === 'missions') loadMissions();
  if (viewName === 'agency') loadSubAccounts();
  if (viewName === 'blog') loadBlogPosts();
  if (viewName === 'leaderboard') loadLeaderboard();

}

// --- STOREFRONT / NEW ORDER ---
async function loadCategoriesAndServices() {
  try {
    const [catData, servData] = await Promise.all([
      apiCall('/api/services/categories'),
      apiCall('/api/services'),
    ]);

    state.categories = catData.categories;
    state.services = servData.services;

    populateCategoriesDropdown();
    populateSubscriptionServicesDropdown();
  } catch (err) {}
}

function isServiceInPlatform(s, plat) {
  if (!plat || plat === 'all') return true;
  const p = (s.platform || '').toLowerCase();
  const n = (s.name || '').toLowerCase();
  if (plat === 'deezer') return p === 'deezer' || n.includes('deezer');
  if (plat === 'soundcloud')
    return p === 'soundcloud' || n.includes('soundcloud');
  if (plat === 'kick') return p === 'kick' || n.includes('kick');
  if (plat === 'twitch') return p === 'twitch' || n.includes('twitch');
  if (plat === 'web' || plat === 'trafego')
    return (
      p === 'web' ||
      p === 'trafego' ||
      n.includes('tráfego') ||
      n.includes('trafego') ||
      n.includes('google maps')
    );
  if (plat === 'twitter')
    return (
      p === 'twitter' || n.includes('twitter') || n.includes('x (twitter)')
    );
  return p === plat;
}

function filterPlatform(platform) {
  document.querySelectorAll('.platform-btn').forEach((btn) => {
    if (btn.getAttribute('data-platform') === platform) {
      btn.classList.add('active', 'bg-gray-800/80', 'border-cyan-500/50');
      btn.classList.remove('bg-gray-900/60', 'border-gray-800');
    } else {
      btn.classList.remove('active', 'bg-gray-800/80', 'border-cyan-500/50');
      btn.classList.add('bg-gray-900/60', 'border-gray-800');
    }
  });

  populateCategoriesDropdown(platform === 'all' ? null : platform);
}

function populateCategoriesDropdown(platformFilter = null) {
  const catSelect = document.getElementById('order-category-select');
  catSelect.innerHTML =
    '<option value="">-- Selecione uma Categoria --</option>';

  const filtered = platformFilter
    ? state.categories.filter((c) => {
        const cp = (c.platform || '').toLowerCase();
        const cn = (c.name || '').toLowerCase();
        if (platformFilter === 'deezer')
          return (
            cp === 'deezer' || cn.includes('deezer') || cn.includes('música')
          );
        if (platformFilter === 'soundcloud')
          return (
            cp === 'soundcloud' ||
            cn.includes('soundcloud') ||
            cn.includes('música')
          );
        if (platformFilter === 'kick')
          return cp === 'kick' || cn.includes('kick');
        if (platformFilter === 'twitch')
          return cp === 'twitch' || cn.includes('twitch');
        if (platformFilter === 'web' || platformFilter === 'trafego')
          return (
            cp === 'web' ||
            cp === 'trafego' ||
            cn.includes('tráfego') ||
            cn.includes('trafego')
          );
        if (platformFilter === 'twitter')
          return cp === 'twitter' || cn.includes('twitter');
        return cp === platformFilter;
      })
    : state.categories;

  filtered.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = c.name;
    catSelect.appendChild(opt);
  });

  if (filtered.length > 0) {
    catSelect.value = filtered[0].id;
    onCategoryChanged();
  }
}

function onCategoryChanged() {
  const catId = parseInt(
    document.getElementById('order-category-select').value,
    10
  );
  const servSelect = document.getElementById('order-service-select');
  servSelect.innerHTML = '<option value="">-- Selecione o Serviço --</option>';

  if (!catId) return;

  const servicesInCat = state.services.filter((s) => s.category_id === catId);
  servicesInCat.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = `${escapeText(s.name)} - ${formatPrice(s.price_per_k_cents)}/1k`;
    servSelect.appendChild(opt);
  });

  if (servicesInCat.length > 0) {
    servSelect.value = servicesInCat[0].id;
    onServiceChanged();
  }
}

function onServiceChanged() {
  const servId = parseInt(
    document.getElementById('order-service-select').value,
    10
  );
  const service = state.services.find((s) => s.id === servId);
  state.selectedService = service;

  const specEmpty = document.getElementById('service-spec-empty');
  const specContent = document.getElementById('service-spec-content');
  const commentsBox = document.getElementById('order-comments-box');

  if (!service) {
    specEmpty.classList.remove('hidden');
    specContent.classList.add('hidden');
    commentsBox.classList.add('hidden');
    return;
  }

  specEmpty.classList.add('hidden');
  specContent.classList.remove('hidden');

  document.getElementById('spec-rate').innerText = formatPrice(
    service.price_per_k_cents
  );
  document.getElementById('spec-time').innerText =
    service.avg_time || 'Não informado pelo fornecedor';

  const refillBadge = document.getElementById('spec-refill');
  if (service.refill_available) {
    refillBadge.className =
      'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400';
    refillBadge.innerText = 'Disponível — consulte as condições';
  } else {
    refillBadge.className =
      'px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-400';
    refillBadge.innerText = 'Sem Reposição';
  }

  document.getElementById('spec-desc').innerText =
    service.description || 'Nenhuma restrição adicional informada.';
  document.getElementById('order-qty-limits').innerText =
    `Mín: ${service.min_quantity.toLocaleString()} | Máx: ${service.max_quantity.toLocaleString()}`;

  const qtyInput = document.getElementById('order-qty-input');
  qtyInput.min = service.min_quantity;
  qtyInput.max = service.max_quantity;
  if (!qtyInput.value || parseInt(qtyInput.value, 10) < service.min_quantity) {
    qtyInput.value = service.min_quantity;
  }

  if (service.type === 'custom_comments') {
    commentsBox.classList.remove('hidden');
  } else {
    commentsBox.classList.add('hidden');
  }

  calculateOrderPrice();
}

function toggleDripFeedInputs() {
  const toggle = document.getElementById('order-dripfeed-toggle');
  const box = document.getElementById('order-dripfeed-inputs');
  if (toggle.checked) {
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

async function applyCoupon() {
  const code = document.getElementById('order-coupon-input').value.trim();
  if (!code) return;

  const qty =
    parseInt(document.getElementById('order-qty-input').value, 10) || 0;
  if (!state.selectedService || qty <= 0) {
    showToast(
      'Selecione o serviço e a quantidade antes de aplicar o cupom.',
      'error'
    );
    return;
  }

  const rawTotalCents = Math.round(
    (state.selectedService.price_per_k_cents * qty) / 1000
  );

  try {
    const data = await apiCall('/api/coupons/validate', 'POST', {
      code,
      order_amount_cents: rawTotalCents,
    });

    state.appliedCoupon = data;
    const feedback = document.getElementById('coupon-feedback');
    feedback.classList.remove('hidden');
    feedback.innerText = `Cupom ${escapeText(data.code)} aplicado: Desconto de ${data.discount_formatted}!`;
    showToast('Cupom aplicado com sucesso!', 'success');
    calculateOrderPrice();
  } catch (err) {}
}

let quoteTimer, quoteSequence = 0;
function calculateOrderPrice() {
  const sequence = ++quoteSequence;
  clearTimeout(quoteTimer);
  const preview = document.getElementById('order-total-preview');
  const input = {service_id: Number(document.getElementById('order-service-select').value), quantity: Number(document.getElementById('order-qty-input').value), link: document.getElementById('order-link-input').value.trim(), coupon_code: state.appliedCoupon?.code, comments:document.getElementById('order-comments-input').value, is_dripfeed: document.getElementById('order-dripfeed-toggle').checked?1:0,dripfeed_runs:Number(document.getElementById('order-drip-runs').value),dripfeed_interval:Number(document.getElementById('order-drip-interval').value)};
  if (!input.service_id || !input.quantity || !input.link) {preview.textContent = 'Informe quantidade e link';return;}
  preview.textContent = 'Calculando…';
  quoteTimer = setTimeout(async () => {
    try {
      const response = await fetch('/api/orders/quote', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token},body:JSON.stringify(input)});
      const data = await response.json();
      if (sequence === quoteSequence) preview.textContent = response.ok ? formatPrice(data.charge_cents) : data.error;
    } catch {if(sequence===quoteSequence)preview.textContent='Não foi possível consultar o preço';}
  }, 250);
}

async function handleCreateOrder(e) {
  e.preventDefault();
  if (!state.token) {
    openAuthModal();
    return;
  }

  const serviceId = parseInt(
    document.getElementById('order-service-select').value,
    10
  );
  const link = document.getElementById('order-link-input').value.trim();
  const quantity = parseInt(
    document.getElementById('order-qty-input').value,
    10
  );
  const comments = document.getElementById('order-comments-input').value;

  const isDripfeed = document.getElementById('order-dripfeed-toggle').checked;
  const dripRuns = isDripfeed
    ? parseInt(document.getElementById('order-drip-runs').value, 10)
    : 1;
  const dripInterval = isDripfeed
    ? parseInt(document.getElementById('order-drip-interval').value, 10)
    : 0;

  const btnSubmit = document.getElementById('btn-submit-order');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i><span>Despachando...</span>';

  try {
    const clientField = document.getElementById('agency-client-select');
    const data = await apiCall('/api/orders', 'POST', {
      service_id: serviceId,
      link,
      quantity,
      comments: comments || undefined,
      coupon_code: state.appliedCoupon?.code || undefined,
      is_dripfeed: isDripfeed ? 1 : 0,
      dripfeed_runs: dripRuns,
      dripfeed_interval: dripInterval,
      client_id: clientField && clientField.value ? Number(clientField.value) : undefined,
    });

    showToast(`Ordem #${data.order.id} despachada com sucesso!`, 'success');
    if (Number.isSafeInteger(data.new_balance_cents))
      state.user.balance_cents = data.new_balance_cents;
    updateUserUI();

    document.getElementById('order-link-input').value = '';
    state.appliedCoupon = null;
    document.getElementById('coupon-feedback').classList.add('hidden');
    navigateTo('orders');
  } catch (err) {
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML =
      '<i class="fa-solid fa-paper-plane"></i><span>Enviar Pedido Imediato</span>';
  }
}

// --- LUCKY WHEEL (ROLETA DA SORTE) ---
function openLuckyWheelModal() {
  document.getElementById('modal-lucky-wheel').classList.remove('hidden');
  checkSpinStatus();
}

function closeLuckyWheelModal() {
  document.getElementById('modal-lucky-wheel').classList.add('hidden');
}

async function checkSpinStatus() {
  try {
    const data = await apiCall('/api/gamification/status');
    const btn = document.getElementById('btn-spin-wheel');
    const msg = document.getElementById('wheel-status-msg');

    if (!data.can_spin) {
      btn.disabled = true;
      btn.className =
        'w-full py-3.5 bg-gray-800 text-gray-500 font-bold text-xs rounded-xl cursor-not-allowed';
      btn.innerText = 'Giro Já Realizado Hoje';
      msg.innerText = `Próximo giro disponível em ${Math.ceil(data.next_spin_in_seconds / 3600)} horas.`;
    } else {
      btn.disabled = false;
      btn.className =
        'w-full py-3.5 bg-gradient-to-r from-amber-400 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 text-black font-black text-sm rounded-xl shadow-lg transition active:scale-95';
      btn.innerText = 'Girar Agora Gratuitamente';
      msg.innerText = 'Você tem 1 giro grátis disponível!';
    }
  } catch (err) {}
}

async function handleSpinWheel() {
  const wheel = document.getElementById('wheel-visual');
  const btn = document.getElementById('btn-spin-wheel');
  btn.disabled = true;

  // Animate spinning
  const randomRotation = 1440 + Math.floor(Math.random() * 360);
  wheel.style.transform = `rotate(${randomRotation}deg)`;

  try {
    const data = await apiCall('/api/gamification/spin', 'POST');
    setTimeout(() => {
      showToast(data.message, 'success');
      state.user.balance_cents = data.new_balance_cents;
      updateUserUI();
      checkSpinStatus();
    }, 2800);
  } catch (err) {
    wheel.style.transform = 'none';
    btn.disabled = false;
  }
}

// --- SUBSCRIPTIONS (AUTO-LIKES) ---
function populateSubscriptionServicesDropdown() {
  const select = document.getElementById('sub-service-select');
  if (!select) return;
  select.innerHTML = '';
  state.services.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = `[${s.platform.toUpperCase()}] ${escapeText(s.name)} - ${formatPrice(s.price_per_k_cents)}/1k`;
    select.appendChild(opt);
  });
}

async function handleCreateSubscription(e) {
  e.preventDefault();
  const serviceId = document.getElementById('sub-service-select').value;
  const username = document.getElementById('sub-username').value;
  const postsLimit = document.getElementById('sub-posts-limit').value;
  const minQty = document.getElementById('sub-min-qty').value;
  const maxQty = document.getElementById('sub-max-qty').value;

  try {
    const data = await apiCall('/api/subscriptions', 'POST', {
      service_id: serviceId,
      username,
      posts_limit: postsLimit,
      min_quantity: minQty,
      max_quantity: maxQty,
    });

    showToast(data.message, 'success');
    document.getElementById('sub-username').value = '';
    loadSubscriptions();
  } catch (err) {}
}

async function loadSubscriptions() {
  if (!state.token) return;
  const tbody = document.getElementById('subscriptions-table-body');
  try {
    const data = await apiCall('/api/subscriptions');
    if (!data.subscriptions || data.subscriptions.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="p-8 text-center text-gray-500">Nenhuma assinatura ativa. Cadastre seu perfil acima!</td></tr>';
      return;
    }

    tbody.innerHTML = data.subscriptions
      .map(
        (s) => `
      <tr class="hover:bg-gray-800/30">
        <td class="p-4 font-mono text-gray-400">#${s.id}</td>
        <td class="p-4 font-bold text-cyan-400 font-mono">@${escapeText(s.username)}</td>
        <td class="p-4 font-semibold text-gray-200">${escapeText(s.service_name)}${s.last_message ? `<div class="text-[10px] text-amber-300">Última tentativa: ${escapeText(s.last_message)}</div>` : ''}</td>
        <td class="p-4 font-mono">${s.posts_delivered} / ${s.posts_limit}</td>
        <td class="p-4 font-mono text-gray-400">${s.min_quantity} - ${s.max_quantity}</td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-400'}">
            ${escapeText(s.status)}
          </span>
        </td>
        <td class="p-4 text-right">
          <button data-action="handleToggleSubscription" data-event="click" data-args="${escapeText(JSON.stringify([s.id]))}" class="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-[11px] rounded border border-gray-700">
            ${s.status === 'active' ? 'Pausar' : 'Ativar'}
          </button>
        </td>
      </tr>
    `
      )
      .join('');
  } catch (err) {}
}

async function handleToggleSubscription(id) {
  try {
    const data = await apiCall(`/api/subscriptions/${id}/toggle`, 'POST');
    showToast(data.message, 'success');
    loadSubscriptions();
  } catch (err) {}
}

// --- CHILD PANELS (WHITE-LABEL) ---
async function handleCreateChildPanel(e) {
  e.preventDefault();
  const domain = document.getElementById('cp-domain').value;
  const panelName = document.getElementById('cp-name').value;
  const adminUser = document.getElementById('cp-admin').value;
  const currency = document.getElementById('cp-currency').value;

  try {
    const data = await apiCall('/api/child-panels', 'POST', {
      domain,
      panel_name: panelName,
      admin_user: adminUser,
      currency,
    });

    showToast(data.message, 'success');
    if (Number.isSafeInteger(data.new_balance_cents))
      state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    document.getElementById('cp-domain').value = '';
    document.getElementById('cp-name').value = '';
    loadChildPanels();
  } catch (err) {}
}

async function loadChildPanels() {
  if (!state.token) return;
  const tbody = document.getElementById('child-panels-table-body');
  try {
    const data = await apiCall('/api/child-panels');
    if (!data.panels || data.panels.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="p-8 text-center text-gray-500">Nenhum sub-painel alugado. Comece seu próprio negócio acima!</td></tr>';
      return;
    }

    tbody.innerHTML = data.panels
      .map(
        (p) => `
      <tr class="hover:bg-gray-800/30">
        <td class="p-4 font-mono text-gray-400">#${p.id}</td>
        <td class="p-4 font-bold text-cyan-400 font-mono">${escapeText(p.domain)}</td>
        <td class="p-4 font-semibold text-gray-200">${escapeText(p.panel_name)}</td>
        <td class="p-4 font-mono text-emerald-400">${escapeText(p.currency)}</td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">${escapeText(p.status)}</span>
        </td>
        <td class="p-4 text-right font-mono text-[10px] text-gray-400">Aguarda configuração</td>
      </tr>
    `
      )
      .join('');
  } catch (err) {}
}

// --- MASS ORDER SUBMIT ---
async function handleMassOrderSubmit(e) {
  e.preventDefault();
  if (!state.token) {
    openAuthModal();
    return;
  }

  const textarea = document.getElementById('mass-order-textarea');
  const rawText = textarea.value.trim();
  if (!rawText) return;

  const btn = document.getElementById('btn-submit-mass');
  btn.disabled = true;
  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Processando lote...';

  try {
    const data = await apiCall('/api/orders/mass', 'POST', {
      raw_text: rawText,
    });
    showToast(data.message, 'success');
    state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    textarea.value = '';
    navigateTo('orders');
  } catch (err) {
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="fa-solid fa-bolt mr-1"></i>Processar Todos os Pedidos em Lote';
  }
}

// --- AFFILIATES VIEW ---
async function loadAffiliatesData() {
  if (!state.token) return;
  await fetchUserProfile();
  if (state.affiliateStats) {
    document.getElementById('affiliate-total-referred').innerText =
      state.affiliateStats.total_referred || 0;
    document.getElementById('affiliate-total-commissions').innerText =
      state.affiliateStats.total_commissions_formatted || 'R$ 0,00';
  }
}

function copyAffiliateLink() {
  const input = document.getElementById('affiliate-link-input');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Link de convite copiado!', 'success');
}

// --- ORDERS TRACKING VIEW ---
async function loadUserOrders(showLoading = true) {
  if (!state.token) {
    await quickLogin('demo@smmhub.com', 'demo123');
  }
  const tbody = document.getElementById('orders-table-body');
  if (showLoading) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="p-8 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando pedidos...</td></tr>';
  }

  try {
    const params = new URLSearchParams();
    if (state.ordersFilter !== 'all')
      params.append('status', state.ordersFilter);
    if (state.ordersSearch) params.append('search', state.ordersSearch);

    const data = await apiCall(`/api/orders?${params.toString()}`);
    state.orders = data.orders;
    renderOrdersTable();
  } catch (err) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="p-8 text-center text-red-400">Falha ao carregar ordens.</td></tr>';
  }
}

function updateOrderFilterCounters() {
  const allOrders = state.orders || [];
  const counts = {
    all: allOrders.length,
    pending: allOrders.filter((o) => o.status === 'pending').length,
    in_progress: allOrders.filter(
      (o) => o.status === 'in_progress' || o.status === 'processing'
    ).length,
    completed: allOrders.filter((o) => o.status === 'completed').length,
    canceled: allOrders.filter(
      (o) => o.status === 'canceled' || o.status === 'failed'
    ).length,
  };

  const btnAll = document.querySelector('.order-filter-btn[data-status="all"]');
  if (btnAll) btnAll.innerText = `Todos (${counts.all})`;
  const btnPending = document.querySelector(
    '.order-filter-btn[data-status="pending"]'
  );
  if (btnPending) btnPending.innerText = `Pendentes (${counts.pending})`;
  const btnInProgress = document.querySelector(
    '.order-filter-btn[data-status="in_progress"]'
  );
  if (btnInProgress)
    btnInProgress.innerText = `Em Andamento (${counts.in_progress})`;
  const btnCompleted = document.querySelector(
    '.order-filter-btn[data-status="completed"]'
  );
  if (btnCompleted) btnCompleted.innerText = `Concluídos (${counts.completed})`;
  const btnCanceled = document.querySelector(
    '.order-filter-btn[data-status="canceled"]'
  );
  if (btnCanceled) btnCanceled.innerText = `Cancelados (${counts.canceled})`;
}

function renderOrdersTable() {
  updateOrderFilterCounters();
  const tbody = document.getElementById('orders-table-body');
  if (!state.orders || state.orders.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="p-10 text-center text-gray-500"><i class="fa-solid fa-box-open text-3xl mb-2 block"></i>Nenhum pedido encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = state.orders
    .map((o) => {
      const statusBadges = {
        pending:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-pending">Pendente</span>',
        dispatching:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-processing">Enviando</span>',
        processing:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-processing">Processando</span>',
        in_progress:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-in_progress">Em Andamento</span>',
        awaiting_confirmation:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-processing">Em confirmação</span>',
        completed:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-completed">Concluído</span>',
        partial:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-partial">Parcial</span>',
        canceled:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-canceled">Cancelado</span>',
        failed:
          '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-failed">Falhou</span>',
      };

      const statusBadge =
        statusBadges[o.status] ||
        `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-300">${escapeText(o.status)}</span>`;
      const dripBadge = o.is_dripfeed
        ? `<span class="block text-[9px] text-cyan-400 font-mono">Drip: ${o.dripfeed_completed_runs || 0}/${o.dripfeed_runs}</span>`
        : '';

      const refillBtn =
        o.status === 'completed' && o.refill_available
          ? `<button data-action="handleRequestRefill" data-event="click" data-args="${escapeText(JSON.stringify([o.id]))}" class="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold text-[10px]">Repor</button>`
          : '';

      const receiptBtn = `<a href="/api/orders/${o.id}/receipt" target="_blank" class="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] font-bold border border-gray-700 inline-block"><i class="fa-solid fa-receipt mr-1"></i>Comprovante</a>`;

      const reviewBtn =
        o.status === 'completed'
          ? `<button data-action="promptReviewOrder" data-event="click" data-args="${escapeText(JSON.stringify([o.id]))}" class="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold inline-block ml-1"><i class="fa-solid fa-star"></i></button>`
          : '';
      const delivered = Math.max(0, o.quantity - (o.remains || 0));
      const followBtn = `<button type="button" data-follow="ficha" data-id="${o.id}" class="px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold">Ficha</button>`;
      const againBtn = `<button type="button" data-follow="reorder" data-id="${o.id}" class="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 text-[10px] font-bold">De novo</button>`;
      const cancelBtn =
        o.status === 'pending' && o.cancel_available
          ? `<button type="button" data-follow="cancel" data-id="${o.id}" class="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-[10px] font-bold">Cancelar</button>`
          : '';

      return `
      <tr class="hover:bg-gray-800/30 transition">
        <td class="p-4 font-mono font-bold text-gray-300">#${o.id}</td>
        <td class="p-4 max-w-xs truncate font-semibold text-gray-200" title="${escapeText(o.service_name)}">
          ${escapeText(o.service_name)}
          ${dripBadge}
        </td>
        <td class="p-4 max-w-[180px] truncate font-mono text-cyan-400">
          <a href="${o.link}" target="_blank" rel="noopener" class="hover:underline flex items-center space-x-1">
            <span class="truncate">${o.link}</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px] shrink-0"></i>
          </a>
        </td>
        <td class="p-4 font-mono font-bold">${o.quantity.toLocaleString()}</td>
        <td class="p-4 font-mono font-bold text-emerald-400">${formatPrice(o.charge_cents)}</td>
        <td class="p-4">${statusBadge}<span class="block text-[10px] text-gray-500">${delivered.toLocaleString()}/${o.quantity.toLocaleString()}</span></td>
        <td class="p-4 text-right space-x-1">
          ${followBtn}
          ${againBtn}
          ${cancelBtn}
          ${receiptBtn}
          ${refillBtn}
          ${reviewBtn}
        </td>
      </tr>
    `;
    })
    .join('');
}

async function promptReviewOrder(orderId) {
  const stars = prompt(
    `Deixe sua avaliação de 1 a 5 estrelas para a ordem #${orderId}:`,
    '5'
  );
  if (!stars) return;
  const comment = prompt(
    'Deixe um comentário público opcional sobre a velocidade e qualidade da entrega:',
    'Excelente entrega, muito rápido!'
  );

  try {
    const data = await apiCall('/api/reviews', 'POST', {
      order_id: orderId,
      rating: parseInt(stars, 10),
      comment,
    });
    showToast(data.message, 'success');
  } catch (err) {}
}

function filterOrdersStatus(status) {
  state.ordersFilter = status;
  document.querySelectorAll('.order-filter-btn').forEach((btn) => {
    if (btn.getAttribute('data-status') === status) {
      btn.className =
        'order-filter-btn active px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 text-white';
    } else {
      btn.className =
        'order-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:bg-gray-800';
    }
  });
  loadUserOrders();
}

function onOrderSearchChanged() {
  state.ordersSearch = document
    .getElementById('order-search-input')
    .value.trim();
  loadUserOrders(false);
}

async function handleRequestRefill(orderId) {
  try {
    const detail=await apiCall(`/api/orders/${orderId}`);let batch_run;
    if(detail.order.is_dripfeed){const answer=prompt('Qual lote precisa de reposição? Informe o número entre 1 e '+detail.order.dripfeed_runs+'.');if(answer===null)return;batch_run=Number(answer);}
    const data = await apiCall(`/api/orders/${orderId}/refill`, 'POST',{batch_run});
    showToast(data.message, 'success');
  } catch (err) {}
}

// --- CATALOG TABLE ---
function renderCatalogTable() {
  const tbody = document.getElementById('catalog-table-body');
  if (!state.services || state.services.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="p-6 text-center text-gray-500">Nenhum serviço catalogado.</td></tr>';
    return;
  }

  tbody.innerHTML = state.services
    .map((s) => {
      const refillBadge = s.refill_available
        ? '<span class="text-emerald-400 font-bold">Sim</span>'
        : '<span class="text-gray-500">Não</span>';

      const starsRating = `<span class="text-amber-400 font-bold"><i class="fa-solid fa-star text-[10px] mr-1"></i>${Number(s.avg_rating || 5.0).toFixed(1)}</span>`;

      return `
      <tr class="hover:bg-gray-800/30 transition">
        <td class="p-4 font-mono text-gray-400">#${s.id}</td>
        <td class="p-4 uppercase font-bold text-gray-300 text-[10px] tracking-wider">${escapeText(s.platform)}</td>
        <td class="p-4 font-semibold text-gray-200">${escapeText(s.name)}${s.unstable ? ' <span class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px]">Instável</span>' : ''}</td>
        <td class="p-4 font-mono font-bold text-emerald-400">${formatPrice(s.price_per_k_cents)}</td>
        <td class="p-4">${starsRating}</td>
        <td class="p-4 font-mono text-gray-400">${s.min_quantity} / ${s.max_quantity.toLocaleString()}</td>
        <td class="p-4 text-gray-400">${s.avg_time || '5-30 min'}</td>
        <td class="p-4 text-center">${refillBadge}</td>
      </tr>
    `;
    })
    .join('');
}

function filterCatalogTable() {
  const query = document
    .getElementById('services-catalog-search')
    .value.toLowerCase();
  const rows = document.querySelectorAll('#catalog-table-body tr');
  rows.forEach((r) => {
    const text = r.innerText.toLowerCase();
    r.style.display = text.includes(query) ? '' : 'none';
  });
}

// --- WALLET & PAYMENTS (PIX & CRIPTO) ---
function togglePaymentMethod(method) {
  const tabPix = document.getElementById('tab-pay-pix');
  const tabCrypto = document.getElementById('tab-pay-crypto');
  const boxPix = document.getElementById('container-pay-pix');
  const boxCrypto = document.getElementById('container-pay-crypto');

  if (method === 'pix') {
    tabPix.className =
      'px-6 py-2.5 border-b-2 border-emerald-400 text-emerald-400 flex items-center space-x-2';
    tabCrypto.className =
      'px-6 py-2.5 text-gray-400 hover:text-white flex items-center space-x-2';
    boxPix.classList.remove('hidden');
    boxCrypto.classList.add('hidden');
  } else {
    tabCrypto.className =
      'px-6 py-2.5 border-b-2 border-amber-400 text-amber-400 flex items-center space-x-2';
    tabPix.className =
      'px-6 py-2.5 text-gray-400 hover:text-white flex items-center space-x-2';
    boxCrypto.classList.remove('hidden');
    boxPix.classList.add('hidden');
  }
}

function setDepositAmount(val) {
  document.getElementById('deposit-amount-input').value = val;
}

async function generatePixInvoice() {
  if (!state.token) {
    openAuthModal();
    return;
  }

  const input = document.getElementById('deposit-amount-input');
  const amount = parseFloat(input.value);

  if (isNaN(amount) || amount < 5) {
    showToast('O valor mínimo para recarga via Pix é de R$ 5,00.', 'error');
    return;
  }

  try {
    const data = await apiCall('/api/wallet/pix/create', 'POST', { amount });
    state.activePixInvoice = data.invoice;

    document.getElementById('pix-placeholder').classList.add('hidden');
    const pixResult = document.getElementById('pix-result');
    pixResult.classList.remove('hidden');

    document.getElementById('pix-amount-badge').innerText =
      data.invoice.amount_formatted;
    document.getElementById('pix-qrcode-img').src =
      data.invoice.qr_code_data_url;
    document.getElementById('pix-copia-cola-input').value =
      data.invoice.copy_paste;

    showToast('Cobrança criada. O saldo entra quando o pagamento for confirmado.', 'success');
    const status = document.getElementById('pix-status') || document.createElement('p');
    status.id = 'pix-status';
    status.textContent = 'Aguardando confirmação do gateway.';
    pixResult.append(status);
    const txid = data.invoice.txid;
    const timer = setInterval(async () => {
      try {
        const current = await apiCall('/api/wallet/pix/status/' + encodeURIComponent(txid));
        status.textContent = current.status === 'paid' ? 'Pagamento confirmado.' : 'Aguardando confirmação do gateway.';
        if (current.status === 'paid') {
          clearInterval(timer);
          state.user.balance_cents = current.current_balance_cents;
          updateUserUI();
          loadWalletTransactions();
        }
      } catch (error) {
        status.textContent = error.message || 'Não foi possível consultar a cobrança.';
      }
    }, 5000);
  } catch (err) {
    showToast(err.message || 'Recebimento Pix ainda indisponível.', 'error');
  }
}

function copyPixCode() {
  const input = document.getElementById('pix-copia-cola-input');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Código Pix copiado!', 'success');
}

async function simulatePixPayment() {
  if (!state.activePixInvoice) return;

  try {
    const data = await apiCall('/api/wallet/pix/simulate-pay', 'POST', {
      txid: state.activePixInvoice.txid,
    });

    state.user.balance_cents = data.result.new_balance_cents;
    updateUserUI();
    playAudioFeedback('cash');
    showToast(data.message, 'success');

    document.getElementById('pix-placeholder').classList.remove('hidden');
    document.getElementById('pix-result').classList.add('hidden');
    state.activePixInvoice = null;

    loadWalletTransactions();
  } catch (err) {}
}

async function generateCryptoInvoice() {
  const currency = document.getElementById('crypto-currency-select').value;
  const amountUsd = document.getElementById('crypto-amount-usd').value;

  try {
    const data = await apiCall('/api/wallet/crypto/create', 'POST', {
      currency,
      amount_usd: amountUsd,
    });

    state.activeCryptoInvoice = data.invoice;
    document.getElementById('crypto-placeholder').classList.add('hidden');
    const resBox = document.getElementById('crypto-result');
    resBox.classList.remove('hidden');

    document.getElementById('crypto-brl-preview').innerText =
      `${data.invoice.amount_crypto} ${data.invoice.currency} (${data.invoice.amount_brl_formatted})`;
    document.getElementById('crypto-qrcode-img').src =
      data.invoice.qr_code_data_url;
    document.getElementById('crypto-wallet-input').value =
      data.invoice.wallet_address;

    showToast('Cobrança cripto criada. O saldo entra depois da confirmação da rede.', 'success');
    const status = document.getElementById('crypto-status') || document.createElement('p');
    status.id = 'crypto-status';
    status.textContent = 'Aguardando confirmação. Esta tela não marca a cobrança como paga sozinha.';
    resBox.append(status);
  } catch (err) {
    showToast(err.message || 'Recebimento cripto ainda indisponível.', 'error');
  }
}

async function simulateCryptoPayment() {
  if (!state.activeCryptoInvoice) return;

  try {
    const data = await apiCall('/api/wallet/crypto/simulate-pay', 'POST', {
      txid: state.activeCryptoInvoice.txid,
    });

    state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    showToast(data.message, 'success');

    document.getElementById('crypto-placeholder').classList.remove('hidden');
    document.getElementById('crypto-result').classList.add('hidden');
    state.activeCryptoInvoice = null;

    loadWalletTransactions();
  } catch (err) {}
}

async function loadWalletTransactions() {
  if (!state.token) return;
  const tbody = document.getElementById('wallet-transactions-body');
  try {
    const data = await apiCall('/api/wallet/transactions');
    if (!data.transactions || data.transactions.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="py-4 text-center text-gray-500">Nenhuma movimentação registrada.</td></tr>';
      return;
    }

    tbody.innerHTML = data.transactions
      .map((t) => {
        const isPositive = t.amount_cents > 0;
        const amountFormatted = `${isPositive ? '+' : ''}${formatPrice(t.amount_cents)}`;
        const balanceAfter = formatPrice(t.balance_after_cents);
        const colorClass = isPositive ? 'text-emerald-400' : 'text-red-400';

        return `
        <tr class="hover:bg-gray-800/30">
          <td class="py-2.5 text-gray-400">${new Date(t.created_at).toLocaleString('pt-BR')}</td>
          <td class="py-2.5 text-gray-300 uppercase text-[10px] font-bold">${t.type}</td>
          <td class="py-2.5 text-gray-200 font-sans">${escapeText(t.description)}</td>
          <td class="py-2.5 text-right font-bold ${colorClass}">${amountFormatted}</td>
          <td class="py-2.5 text-right text-gray-300 font-bold">${balanceAfter}</td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {}
}

// --- FLOATING CHAT ---
function toggleFloatingChat() {
  const popup = document.getElementById('floating-chat-popup');
  popup.classList.toggle('hidden');
}

// --- FAVORITE SERVICES ---
async function toggleFavoriteCurrentService() {
  if (!state.selectedService) return;
  try {
    const data = await apiCall(
      `/api/services/${state.selectedService.id}/favorite`,
      'POST'
    );
    showToast(data.message, 'info');
  } catch (err) {}
}

// --- API DOCS VIEW ---
function copyApiKey() {
  const input = document.getElementById('api-key-display');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Chave de API copiada!', 'success');
}

async function regenerateApiKey() {
  if (!confirm('Deseja regenerar sua chave de API?')) return;
  try {
    const data = await apiCall('/api/auth/regenerate-api-key', 'POST');
    state.user.api_key = data.api_key;
    document.getElementById('api-key-display').value = data.api_key;
    showToast(data.message, 'success');
  } catch (err) {}
}

// --- ADMIN DASHBOARD & DRE ---
async function loadAdminMetrics() {
  if (!state.user || !['admin', 'ceo'].includes(state.user.role)) return;

  try {
    const data = await apiCall('/api/admin/metrics');

    document.getElementById('admin-kpi-deposits').innerText =
      data.deposits.total_deposited_formatted;
    document.getElementById('admin-kpi-deposits-count').innerText =
      `${data.deposits.count} recargas aprovadas`;

    document.getElementById('admin-kpi-revenue').innerText =
      data.orders.total_revenue_formatted;
    document.getElementById('admin-kpi-orders-count').innerText =
      `${data.orders.total} ordens (${data.orders.active} ativas)`;

    document.getElementById('admin-kpi-profit').innerText =
      data.orders.total_profit_formatted;
    document.getElementById('admin-kpi-margin').innerText =
      `Margem bruta média: ${data.orders.margin_pct}%`;

    document.getElementById('admin-kpi-liability').innerText =
      data.users.total_balance_formatted;
    document.getElementById('admin-exchange-rate-display').innerText =
      data.exchange_rate_usd;

    const vaultGrid = document.getElementById('admin-providers-vault-grid');
    vaultGrid.innerHTML = data.providers
      .map(
        (p) => `
      <div class="bg-gray-900/80 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <span class="text-xs font-bold text-gray-300 block">${escapeText(p.name)}</span>
          <span class="text-[10px] text-gray-500 uppercase">${p.is_mock ? 'Simulador Ativo (Localhost)' : 'API Live'}</span>
        </div>
        <div class="text-right">
          <div class="text-base font-extrabold text-cyan-400 font-mono">$ ${Number(p.balance_upstream).toFixed(2)} ${escapeText(p.currency)}</div>
          <span class="text-[10px] text-emerald-400 font-bold">Saldo Disponível</span>
        </div>
      </div>
    `
      )
      .join('');
  } catch (err) {}
}

async function promptUpdateExchangeRate() {
  const current = document.getElementById(
    'admin-exchange-rate-display'
  ).innerText;
  const newRate = prompt(
    'Digite a taxa USD/BRL (ou deixe vazio para buscar ao vivo):',
    current
  );
  try {
    const data = await apiCall('/api/admin/update-exchange-rate', 'POST', {
      rate: newRate || undefined,
    });
    showToast(data.message, 'success');
    loadAdminMetrics();
  } catch (err) {}
}

// --- ADMIN USERS ---
async function loadAdminUsers() {
  if (!state.user || !['admin', 'ceo'].includes(state.user.role)) return;
  const tbody = document.getElementById('admin-users-table-body');
  try {
    const data = await apiCall('/api/admin/users');
    tbody.innerHTML = data.users
      .map((u) => {
        const balanceBRL = (u.balance_cents / 100).toFixed(2).replace('.', ',');
        return `
        <tr class="hover:bg-gray-800/30">
          <td class="p-4 font-mono text-gray-400">#${u.id}</td>
          <td class="p-4">
            <div class="font-bold text-gray-200">${escapeText(u.name)}</div>
            <div class="text-gray-400 text-[11px]">${escapeText(u.email)}</div>
          </td>
          <td class="p-4 font-mono font-bold text-emerald-400">R$ ${balanceBRL}</td>
          <td class="p-4 uppercase font-bold text-[10px] text-cyan-400">${u.tier || 'VIP'}</td>
          <td class="p-4 font-mono text-pink-400 text-[11px]">${u.ref_code || '-'}</td>
          <td class="p-4">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}">
              ${escapeText(u.status)}
            </span>
          </td>
          <td class="p-4 text-right space-x-2">
            <button data-action="promptAdjustBalance" data-event="click" data-args="${escapeText(JSON.stringify([u.id, 'Cliente']))}" class="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-[11px] font-bold">
              Ajustar Saldo
            </button>
          </td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {}
}

async function promptAdjustBalance(userId, userName) {
  const val = prompt(
    `Digite o valor em R$ para creditar (ou debitar -) para ${userName}:`,
    '50.00'
  );
  if (!val) return;

  try {
    const data = await apiCall(
      `/api/admin/users/${userId}/adjust-balance`,
      'POST',
      {
        amount_brl: val,
        reason: 'Ajuste manual via Painel do Administrador',
      }
    );
    showToast(data.message, 'success');
    loadAdminUsers();
  } catch (err) {}
}

// --- ADMIN PROVEDORES ---
function openNewProviderModal() {
  const modal = document.getElementById('modal-provider');
  if (modal) modal.classList.remove('hidden');
}

function closeProviderModal() {
  const modal = document.getElementById('modal-provider');
  if (modal) modal.classList.add('hidden');
}

async function handleSaveProvider(e) {
  e.preventDefault();
  const name = document.getElementById('prov-name').value;
  const api_url = document.getElementById('prov-url').value;
  const api_key = document.getElementById('prov-key').value;
  const currency = document.getElementById('prov-currency').value;
  const exchange_rate = document.getElementById('prov-rate').value;
  const is_mock = document.getElementById('prov-mock').value === '1';

  try {
    const res = await apiCall('/api/admin/providers', 'POST', {
      name,
      api_url,
      api_key,
      currency,
      exchange_rate,
      is_mock,
    });
    showToast(res.message, 'success');
    closeProviderModal();
    loadAdminProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleTestProviderBalance(id) {
  try {
    showToast('Consultando saldo na API do fornecedor...', 'info');
    const res = await apiCall(
      `/api/admin/providers/${id}/test-balance`,
      'POST'
    );
    const latencyInfo = res.latency_ms ? ` (${res.latency_ms}ms)` : '';
    showToast(
      `${escapeText(res.message)} Saldo: ${escapeText(res.currency)} ${Number(res.balance).toFixed(2)}${latencyInfo}`,
      'success'
    );
    loadAdminProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDeleteProvider(id, name) {
  if (
    !confirm(
      `Tem certeza que deseja remover ou desativar o provedor "${name}"?`
    )
  )
    return;
  try {
    const res = await apiCall(`/api/admin/providers/${id}`, 'DELETE');
    showToast(res.message, 'success');
    loadAdminProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function promptUpdateProviderKey(id, name) {
  const newKey = prompt(`Cole a Chave de API (API Key) para "${name}":`);
  if (!newKey || !newKey.trim()) return;

  try {
    const res = await apiCall(`/api/admin/providers/${id}/update-key`, 'POST', {
      api_key: newKey.trim(),
    });
    showToast(res.message, 'success');
    await handleTestProviderBalance(id);
    loadAdminProviders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminProviders() {
  if (!state.user || !['admin', 'ceo'].includes(state.user.role)) return;
  const tbody = document.getElementById('admin-providers-table-body');
  try {
    const data = await apiCall('/api/admin/providers');
    tbody.innerHTML = data.providers
      .map(
        (p) => `
      <tr class="hover:bg-gray-800/30">
        <td class="p-4 font-mono text-gray-400">#${p.id}</td>
        <td class="p-4 font-bold text-gray-200">${escapeText(p.name)}</td>
        <td class="p-4 font-mono text-cyan-400 truncate max-w-xs" title="${p.api_url}">${p.api_url}</td>
        <td class="p-4 font-mono">R$ ${p.exchange_rate}</td>
        <td class="p-4 font-mono font-bold text-emerald-400">$ ${Number(p.balance_upstream).toFixed(2)}</td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.is_mock ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}">
            ${p.is_mock ? 'Simulado' : 'Live Real'}
          </span>
        </td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}">${escapeText(p.status)}</span>
        </td>
        <td class="p-4 text-right space-x-1 whitespace-nowrap">
          <button data-action="promptUpdateProviderKey" data-event="click" data-args="${escapeText(JSON.stringify([p.id, 'Provedor']))}" class="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[11px] font-bold" title="Inserir / Alterar Chave de API">
            <i class="fa-solid fa-key mr-1"></i>Chave
          </button>
          <button data-action="handleTestProviderBalance" data-event="click" data-args="${escapeText(JSON.stringify([p.id]))}" class="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[11px] font-bold" title="Testar Saldo">
            <i class="fa-solid fa-wallet mr-1"></i>Saldo
          </button>
          <button data-action="handleSyncUpstreamServices" data-event="click" data-args="${escapeText(JSON.stringify([p.id, 'Provedor']))}" class="px-2 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-[11px] font-bold" title="Importar Serviços">
            <i class="fa-solid fa-cloud-arrow-down mr-1"></i>Sincronizar
          </button>
          <button data-action="handleDeleteProvider" data-event="click" data-args="${escapeText(JSON.stringify([p.id, 'Provedor']))}" class="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[11px] font-bold" title="Excluir">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `
      )
      .join('');
  } catch (err) {}
}

async function handleSyncUpstreamServices(providerId, providerName) {
  const markup = prompt(
    `Sincronizar catálogo com "${providerName}". Digite a margem %:`,
    '200'
  );
  if (!markup) return;

  try {
    const data = await apiCall('/api/admin/services/sync-upstream', 'POST', {
      provider_id: providerId,
      markup_pct: markup,
    });
    showToast(data.message, 'success');
    await loadCategoriesAndServices();
    loadAdminServices();
  } catch (err) {}
}

// --- ADMIN SERVICES ---
async function loadAdminServices() {
  if (!state.user || !['admin', 'ceo'].includes(state.user.role)) return;
  const tbody = document.getElementById('admin-services-table-body');
  try {
    const data = await apiCall('/api/admin/services');
    tbody.innerHTML = data.services
      .map((s) => {
        const costBRL = (s.cost_per_k_cents / 100).toFixed(2).replace('.', ',');
        const priceBRL = (s.price_per_k_cents / 100)
          .toFixed(2)
          .replace('.', ',');
        const profitBRL = ((s.price_per_k_cents - s.cost_per_k_cents) / 100)
          .toFixed(2)
          .replace('.', ',');
        const marginPct =
          s.cost_per_k_cents > 0
            ? Math.round(
                ((s.price_per_k_cents - s.cost_per_k_cents) /
                  s.cost_per_k_cents) *
                  100
              )
            : 0;

        return `
        <tr class="hover:bg-gray-800/30">
          <td class="p-4 font-mono text-gray-400">#${s.id}</td>
          <td class="p-4 font-semibold text-gray-200">
            ${escapeText(s.name)}
            <span class="block text-[10px] text-gray-500 font-mono">Primário: #${s.provider_id} | Backup: #${s.backup_provider_id || 'Nenhum'}</span>
          </td>
          <td class="p-4 font-mono text-red-400">R$ ${costBRL}</td>
          <td class="p-4 font-mono text-cyan-400 font-bold">R$ ${priceBRL}</td>
          <td class="p-4 font-mono text-emerald-400 font-bold">+R$ ${profitBRL}</td>
          <td class="p-4 font-mono text-emerald-300 font-bold">${marginPct}%</td>
          <td class="p-4 text-right">
            <button data-action="promptEditServicePrice" data-event="click" data-args="${escapeText(JSON.stringify([s.id, 'Serviço', s.cost_per_k_cents, s.price_per_k_cents]))}" class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-700 text-[11px]">
              Editar Preço
            </button>
          </td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {}
}

async function promptEditServicePrice(
  serviceId,
  serviceName,
  currentCostCents,
  currentPriceCents
) {
  const currentPriceBRL = (currentPriceCents / 100).toFixed(2);
  const newPriceBRL = prompt(
    `Novo preço de venda por 1.000 para "${serviceName}" (Custo: R$ ${(currentCostCents / 100).toFixed(2)}):`,
    currentPriceBRL
  );
  if (!newPriceBRL) return;

  const newPriceCents = Math.round(parseFloat(newPriceBRL) * 100);
  if (isNaN(newPriceCents) || newPriceCents <= 0) return;

  try {
    const s = state.services.find((item) => item.id === serviceId);
    await apiCall(`/api/admin/services/${serviceId}`, 'PUT', {
      name: s.name,
      cost_per_k_cents: currentCostCents,
      price_per_k_cents: newPriceCents,
      min_quantity: s.min_quantity,
      max_quantity: s.max_quantity,
      refill_available: s.refill_available,
      status: s.status,
      description: s.description,
    });

    showToast('Preço de venda atualizado com sucesso!', 'success');
    await loadCategoriesAndServices();
    loadAdminServices();
  } catch (err) {}
}

async function promptBulkMarkup() {
  const pct = prompt(
    'Digite o percentual de margem para aplicar em TODOS os serviços (ex: 200):',
    '200'
  );
  if (!pct) return;

  try {
    const data = await apiCall('/api/admin/services/bulk-markup', 'POST', {
      markup_pct: pct,
    });
    showToast(data.message, 'success');
    await loadCategoriesAndServices();
    loadAdminServices();
  } catch (err) {}
}

// --- ADMIN ALL ORDERS ---
async function loadAdminOrders() {
  if (!state.user || !['admin', 'ceo'].includes(state.user.role)) return;
  const tbody = document.getElementById('admin-orders-table-body');
  try {
    const data = await apiCall('/api/admin/orders');
    tbody.innerHTML = data.orders
      .map((o) => {
        const chargeBRL = (o.charge_cents / 100).toFixed(2).replace('.', ',');
        const profitBRL = (o.profit_cents / 100).toFixed(2).replace('.', ',');

        return `
        <tr class="hover:bg-gray-800/30">
          <td class="p-4 font-mono text-gray-400">#${o.id}</td>
          <td class="p-4">
            <div class="font-bold text-gray-200">${escapeText(o.user_name)}</div>
            <div class="text-[10px] text-gray-500">${escapeText(o.user_email)}</div>
          </td>
          <td class="p-4 max-w-xs truncate text-gray-300 font-semibold">${escapeText(o.service_name)}</td>
          <td class="p-4 font-mono">${o.quantity.toLocaleString()}</td>
          <td class="p-4 font-mono text-cyan-400">R$ ${chargeBRL}</td>
          <td class="p-4 font-mono text-emerald-400 font-bold">+R$ ${profitBRL}</td>
          <td class="p-4 text-gray-400 text-[11px]">${o.provider_name || 'N/A'}</td>
          <td class="p-4 uppercase text-[10px] font-bold text-amber-400">${escapeText(o.status)}</td>
          <td class="p-4 text-right space-x-1">
            <button data-action="handleAdminForceRefund" data-event="click" data-args="${escapeText(JSON.stringify([o.id]))}" class="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold">
              Estornar
            </button>
            <button data-action="handleAdminRetry" data-event="click" data-args="${escapeText(JSON.stringify([o.id]))}" class="px-2 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-[10px] font-bold">
              Reenviar
            </button>
          </td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {}
}

async function handleAdminForceRefund(orderId) {
  if (!confirm(`Deseja cancelar a ordem #${orderId} e estornar o saldo?`))
    return;
  try {
    const data = await apiCall(
      `/api/admin/orders/${orderId}/force-refund`,
      'POST'
    );
    showToast(data.message, 'success');
    loadAdminOrders();
  } catch (err) {}
}

async function handleAdminRetry(orderId) {
  try {
    const data = await apiCall(`/api/admin/orders/${orderId}/retry`, 'POST');
    showToast(data.message, 'success');
    loadAdminOrders();
  } catch (err) {}
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');

  const colors = {
    success:
      'bg-emerald-950 border-emerald-500/50 text-emerald-200 glow-emerald',
    error: 'bg-red-950 border-red-500/50 text-red-200',
    info: 'bg-cyan-950 border-cyan-500/50 text-cyan-200 glow-cyan',
  };

  const icons = {
    success: '<i class="fa-solid fa-circle-check text-emerald-400"></i>',
    error: '<i class="fa-solid fa-triangle-exclamation text-red-400"></i>',
    info: '<i class="fa-solid fa-circle-info text-cyan-400"></i>',
  };

  toast.className = `pointer-events-auto flex items-center space-x-3 p-4 rounded-xl border shadow-2xl text-xs font-medium transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span class="text-base">${icons[type] || icons.info}</span>
    <span class="flex-1">${escapeText(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// ELITE SUITE: MISSIONS & GAMIFICATION
// ==========================================
async function loadMissions() {
  const container = document.getElementById('missions-list-container');
  try {
    const data = await apiCall('/api/missions');
    if (!data.missions || data.missions.length === 0) {
      container.innerHTML =
        '<div class="col-span-2 text-center text-gray-500 py-8">Nenhuma missão ativa no momento.</div>';
      return;
    }

    container.innerHTML = data.missions
      .map((m) => {
        const isClaimed = m.is_claimed;
        const isCompleted = m.is_completed;
        const rewardFormatted = `R$ ${(m.reward_cents / 100).toFixed(2).replace('.', ',')}`;

        let btnHtml = '';
        if (isClaimed) {
          btnHtml = `<span class="px-3 py-1 bg-gray-800 text-gray-500 rounded-lg text-xs font-bold">Resgatado</span>`;
        } else if (isCompleted) {
          btnHtml = `
          <button data-action="handleClaimMission" data-event="click" data-args="${escapeText(JSON.stringify([m.id]))}" class="px-4 py-1.5 bg-gradient-to-r from-amber-400 to-yellow-400 text-black font-extrabold text-xs rounded-xl shadow-md transition active:scale-95 animate-pulse">
            Resgatar ${rewardFormatted}
          </button>
        `;
        } else {
          btnHtml = `<span class="text-xs text-gray-400 font-mono">${m.user_value} / ${m.target_value}</span>`;
        }

        return `
        <div class="card-cyber rounded-2xl p-5 border border-gray-800 space-y-3 relative">
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
              ${m.badge || 'MISSÃO'}
            </span>
            <span class="text-xs font-bold text-emerald-400 font-mono">+${rewardFormatted}</span>
          </div>
          <div>
            <h4 class="text-sm font-bold text-white">${escapeText(m.title)}</h4>
            <p class="text-xs text-gray-400 mt-1">${escapeText(m.description)}</p>
          </div>
          <div class="space-y-1">
            <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div class="bg-gradient-to-r from-amber-500 to-yellow-400 h-2 rounded-full transition-all duration-500" style="width: ${m.percent}%"></div>
            </div>
            <div class="flex items-center justify-between pt-1">
              <span class="text-[10px] text-gray-500 font-bold">${m.percent}% concluído</span>
              ${btnHtml}
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  } catch (err) {}
}

async function handleClaimMission(missionId) {
  try {
    const data = await apiCall(`/api/missions/${missionId}/claim`, 'POST');
    showToast(data.message, 'success');
    state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    loadMissions();
  } catch (err) {}
}

// ==========================================
// ELITE SUITE: AGENCY & SUB-ACCOUNTS
// ==========================================
async function loadSubAccounts() {
  const tbody = document.getElementById('sub-accounts-table-body');
  try {
    const data = await apiCall('/api/agency/sub-accounts');
    const countEl = document.getElementById('sub-accounts-count');
    if (countEl) countEl.innerText = `${data.sub_accounts.length} ativas`;

    if (!data.sub_accounts || data.sub_accounts.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="p-6 text-center text-gray-500">Nenhum membro ou subconta cadastrada ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = data.sub_accounts
      .map(
        (s) => `
      <tr class="hover:bg-gray-800/30">
        <td class="p-4 font-bold text-white">${escapeText(s.name)}</td>
        <td class="p-4 text-gray-300 font-mono">${escapeText(s.email)}</td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.can_order ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}">
            ${s.can_order ? 'Permitido' : 'Bloqueado'}
          </span>
        </td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.can_view_balance ? 'bg-cyan-500/10 text-cyan-400' : 'bg-gray-800 text-gray-400'}">
            ${s.can_view_balance ? 'Visível' : 'Oculto'}
          </span>
        </td>
        <td class="p-4"><span class="text-emerald-400 font-bold uppercase text-[10px]">Ativo</span></td>
        <td class="p-4 text-right">
          <button data-action="handleDeleteSubAccount" data-event="click" data-args="${escapeText(JSON.stringify([s.id]))}" class="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-[10px] font-bold">
            Remover
          </button>
        </td>
      </tr>
    `
      )
      .join('');
  } catch (err) {}
}

function openSubAccountModal() {
  document.getElementById('modal-sub-account').classList.remove('hidden');
}

function closeSubAccountModal() {
  document.getElementById('modal-sub-account').classList.add('hidden');
}

async function handleCreateSubAccount() {
  const name = document.getElementById('sub-name').value;
  const email = document.getElementById('sub-email').value;
  const password = document.getElementById('sub-password').value;
  const can_order = document.getElementById('sub-perm-order').checked;
  const can_view_history = document.getElementById('sub-perm-history').checked;
  const can_view_balance = document.getElementById('sub-perm-balance').checked;

  try {
    const data = await apiCall('/api/agency/sub-accounts', 'POST', {
      name,
      email,
      password,
      can_order,
      can_view_history,
      can_view_balance,
    });
    showToast(data.message, 'success');
    closeSubAccountModal();
    loadSubAccounts();
  } catch (err) {}
}

async function handleDeleteSubAccount(id) {
  if (!confirm('Deseja realmente remover esta subconta?')) return;
  try {
    const data = await apiCall(`/api/agency/sub-accounts/${id}`, 'DELETE');
    showToast(data.message, 'success');
    loadSubAccounts();
  } catch (err) {}
}

async function generateAgencyReport() {
  const orderId = document.getElementById('report-order-id').value;
  const agencyName =
    document.getElementById('report-agency-name').value || 'Agência Digital';
  const clientBrand =
    document.getElementById('report-client-brand').value || 'Campanha';

  if (!orderId) {
    showToast('Informe o ID de uma ordem concluída.', 'error');
    return;
  }

  const url = `/api/agency/white-label-report/${encodeURIComponent(orderId)}?agency_name=${encodeURIComponent(agencyName)}&client_brand=${encodeURIComponent(clientBrand)}`;
  await downloadAuthenticatedFile(url, 'relatorio-' + orderId + '.html');
}

// ==========================================
// ELITE SUITE: PUBLIC ORDER TRACKER
// ==========================================
async function handlePublicTrack() {
  const input = document.getElementById('public-track-input').value.trim();
  if (!input) {
    showToast('Informe o código ou link da ordem para rastrear.', 'error');
    return;
  }

  const resultBox = document.getElementById('public-track-result');
  resultBox.classList.remove('hidden');
  resultBox.innerHTML =
    '<div class="text-center text-gray-400 py-4"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Consultando status da ordem...</div>';

  try {
    const data = await apiCall(`/api/track/${encodeURIComponent(input)}`);
    const o = data.order;

    const statusBadges = {
      pending:
        '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400">Pendente</span>',
      in_progress:
        '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 animate-pulse">Em Entrega</span>',
      completed:
        '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">Concluído 100%</span>',
      canceled:
        '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400">Cancelado</span>',
    };

    resultBox.innerHTML = `
      <div class="bg-gray-900/80 border border-gray-800 rounded-xl p-4 space-y-4">
        <div class="flex items-center justify-between border-b border-gray-800 pb-3">
          <div>
            <span class="text-xs text-gray-400 font-mono">Pedido #${o.id} • ${o.platform.toUpperCase()}</span>
            <h4 class="text-sm font-bold text-white mt-0.5">${escapeText(o.service_name)}</h4>
          </div>
          <div>${statusBadges[o.status] || o.status}</div>
        </div>

        <div class="space-y-1">
          <div class="flex justify-between text-xs text-gray-400">
            <span>Progresso da Entrega</span>
            <span class="font-bold text-cyan-400 font-mono">${o.delivered} / ${o.quantity} (${o.percent}%)</span>
          </div>
          <div class="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
            <div class="bg-gradient-to-r from-cyan-500 to-emerald-400 h-3 rounded-full transition-all duration-500" style="width: ${o.percent}%"></div>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs pt-2">
          <div class="bg-gray-950 p-2 rounded-lg border border-gray-800">
            <span class="text-[10px] text-gray-500 uppercase block">Início</span>
            <span class="font-mono text-gray-300 font-bold">${o.start_count}</span>
          </div>
          <div class="bg-gray-950 p-2 rounded-lg border border-gray-800">
            <span class="text-[10px] text-gray-500 uppercase block">Quantidade</span>
            <span class="font-mono text-cyan-400 font-bold">${o.quantity}</span>
          </div>
          <div class="bg-gray-950 p-2 rounded-lg border border-gray-800">
            <span class="text-[10px] text-gray-500 uppercase block">Entregues</span>
            <span class="font-mono text-emerald-400 font-bold">${o.delivered}</span>
          </div>
          <div class="bg-gray-950 p-2 rounded-lg border border-gray-800">
            <span class="text-[10px] text-gray-500 uppercase block">Restantes</span>
            <span class="font-mono text-amber-400 font-bold">${o.remains}</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    resultBox.innerHTML = `<div class="p-4 bg-red-950/40 border border-red-500/30 rounded-xl text-center text-xs text-red-300">${escapeText(err.message)}</div>`;
  }
}

// ==========================================
// ELITE SUITE: BLOG & SEO ARTICLES
// ==========================================
async function loadBlogPosts() {
  const container = document.getElementById('blog-articles-container');
  try {
    const data = await apiCall('/api/blog');
    if (!data.posts || data.posts.length === 0) {
      container.innerHTML =
        '<div class="text-center text-gray-500 py-8">Nenhum artigo disponível no momento.</div>';
      return;
    }

    container.innerHTML = data.posts
      .map(
        (p) => `
      <div class="card-cyber rounded-2xl p-6 border border-gray-800 space-y-3 hover:border-cyan-500/40 transition">
        <div class="flex items-center space-x-2 text-xs">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400">${escapeText(p.category)}</span>
          <span class="text-gray-500">•</span>
          <span class="text-gray-400">${p.read_time_minutes} min de leitura</span>
        </div>
        <h3 class="text-lg font-bold text-white">${escapeText(p.title)}</h3>
        <p class="text-xs text-gray-300 leading-relaxed">${p.meta_description}</p>
        <button data-action="readSingleArticle" data-event="click" data-args="${escapeText(JSON.stringify([p.slug]))}" class="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center space-x-1">
          <span>Ler Artigo Completo</span>
          <i class="fa-solid fa-arrow-right text-[10px]"></i>
        </button>
      </div>
    `
      )
      .join('');
  } catch (err) {}
}

async function readSingleArticle(slug) {
  try {
    const data = await apiCall(`/api/blog/${slug}`);
    const post = data.post;
    const container = document.getElementById('blog-articles-container');
    container.innerHTML = `
      <div class="card-cyber rounded-2xl p-6 sm:p-8 border border-gray-800 space-y-6">
        <button data-action="loadBlogPosts" data-event="click" data-args="${escapeText(JSON.stringify([]))}" class="text-xs text-cyan-400 hover:underline flex items-center space-x-1">
          <i class="fa-solid fa-arrow-left"></i>
          <span>Voltar para Todos os Artigos</span>
        </button>
        <div class="space-y-2 border-b border-gray-800 pb-4">
          <span class="px-2.5 py-1 rounded text-xs font-bold bg-purple-500/20 text-purple-400">${escapeText(post.category)}</span>
          <h1 class="text-2xl font-black text-white">${escapeText(post.title)}</h1>
          <div class="text-xs text-gray-400">Por ${post.author} • ${new Date(post.created_at).toLocaleDateString('pt-BR')}</div>
        </div>
        <div class="text-sm text-gray-200 leading-relaxed space-y-4">
          <p class="text-base text-gray-300 font-medium">${post.meta_description}</p>
          <div class="p-4 bg-gray-900 rounded-xl border border-gray-800 text-gray-300 leading-loose">
            ${post.content}
          </div>
        </div>
        <div class="p-4 bg-cyan-950/40 border border-cyan-500/30 rounded-xl flex items-center justify-between">
          <span class="text-xs text-cyan-300 font-bold">Quer acelerar seus resultados nas redes sociais?</span>
          <button data-action="navigateTo" data-event="click" data-args="${escapeText(JSON.stringify(['new-order']))}" class="px-4 py-2 bg-cyan-500 text-black font-extrabold text-xs rounded-xl">
            Ver Catálogo de Serviços
          </button>
        </div>
      </div>
    `;
  } catch (err) {}
}

// ==========================================
// ELITE SUITE: FAST CHECKOUT (ONE-PAGE SEM LOGIN)
// ==========================================
let activeFastCheckout = null;

function openFastCheckoutModal() {
  document.getElementById('modal-fast-checkout').classList.remove('hidden');
  document.getElementById('fast-step-form').classList.remove('hidden');
  document.getElementById('fast-step-pix').classList.add('hidden');

  // Pre-fill user data if logged in
  if (state.user) {
    const emailInput = document.getElementById('fast-email');
    if (
      emailInput &&
      (!emailInput.value || emailInput.value === 'seu@email.com')
    ) {
      emailInput.value = state.user.email;
    }
    const balanceDisplay = document.getElementById('fast-user-balance-display');
    if (balanceDisplay) {
      balanceDisplay.innerText = formatPrice(state.user.balance_cents || 0);
    }
  }

  populateFastServicesDropdown();
}

function closeFastCheckoutModal() {
  document.getElementById('modal-fast-checkout').classList.add('hidden');
}

function populateFastServicesDropdown() {
  const select = document.getElementById('fast-service-select');
  if (!select) return;
  select.innerHTML = state.services
    .map(
      (s) => `
    <option value="${s.id}" data-price="${s.price_per_k_cents}" data-min="${s.min_quantity}" data-max="${s.max_quantity}">
      [${s.platform.toUpperCase()}] ${escapeText(s.name)} - ${formatPrice(s.price_per_k_cents)} / 1k
    </option>
  `
    )
    .join('');
  calculateFastPrice();
}

function calculateFastPrice() {
  const select = document.getElementById('fast-service-select');
  const qtyInput = document.getElementById('fast-qty');
  const priceDisplay = document.getElementById('fast-price-display');
  const btnWalletPay = document.getElementById('btn-fast-wallet-pay');
  if (!select || !select.selectedOptions[0]) return;

  const opt = select.selectedOptions[0];
  const pricePerK = parseInt(opt.getAttribute('data-price'), 10) || 1000;
  const qty = parseInt(qtyInput.value, 10) || 1000;

  const totalCents = Math.max(50, Math.round((pricePerK * qty) / 1000));
  priceDisplay.innerText = formatPrice(totalCents);

  if (btnWalletPay) {
    const userBalance = state.user ? state.user.balance_cents || 0 : 0;
    if (userBalance >= totalCents) {
      btnWalletPay.classList.remove('opacity-50', 'pointer-events-none');
      btnWalletPay.innerHTML = `<i class="fa-solid fa-bolt"></i><span>Pagar ${formatPrice(totalCents)} com Saldo da Carteira (1-Clique)</span>`;
    } else {
      btnWalletPay.classList.add('opacity-50');
      btnWalletPay.innerHTML = `<i class="fa-solid fa-wallet"></i><span>Saldo insuficiente (${formatPrice(userBalance)}) - Pague com Pix abaixo</span>`;
    }
  }
}

async function handlePayWithWalletFast() {
  const serviceId = document.getElementById('fast-service-select').value;
  const link = document.getElementById('fast-link').value.trim();
  const quantity = document.getElementById('fast-qty').value;
  const coupon = document.getElementById('fast-coupon').value.trim();

  if (!serviceId || !link) {
    showToast('Informe o link do perfil, canal ou post.', 'error');
    return;
  }

  const btn = document.getElementById('btn-fast-wallet-pay');
  btn.disabled = true;
  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Processando debito na carteira...';

  try {
    const data = await apiCall('/api/fast-checkout/pay-with-wallet', 'POST', {
      service_id: serviceId,
      link,
      quantity,
      coupon_code: coupon,
    });

    state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    playAudioFeedback('cash');
    showToast(data.message, 'success');
    closeFastCheckoutModal();
    navigateTo('orders');
    await loadUserOrders(true);
  } catch (err) {
  } finally {
    btn.disabled = false;
    calculateFastPrice();
  }
}

async function handleGenerateFastPix() {
  const serviceId = document.getElementById('fast-service-select').value;
  const link = document.getElementById('fast-link').value.trim();
  const quantity = document.getElementById('fast-qty').value;
  const email = (
    document.getElementById('fast-email').value ||
    (state.user ? state.user.email : 'demo@smmhub.com')
  ).trim();
  const whatsapp = document.getElementById('fast-whatsapp').value.trim();
  const coupon = document.getElementById('fast-coupon').value.trim();

  if (!serviceId || !link) {
    showToast('Preencha o link para prosseguir.', 'error');
    return;
  }

  try {
    const data = await apiCall('/api/fast-checkout/init', 'POST', {
      service_id: serviceId,
      link,
      quantity,
      buyer_email: email,
      buyer_whatsapp: whatsapp,
      coupon_code: coupon,
    });

    activeFastCheckout = data;

    document.getElementById('fast-step-form').classList.add('hidden');
    document.getElementById('fast-step-pix').classList.remove('hidden');

    document.getElementById('fast-qrcode-img').src = data.qr_code_data_url;
    document.getElementById('fast-pix-val-display').innerText =
      data.amount_formatted;
    document.getElementById('fast-copypaste-input').value = data.copy_paste;

    if (data.temporary_password) {
      document.getElementById('fast-temp-pass-box').classList.remove('hidden');
      document.getElementById('fast-temp-pass').innerText =
        data.temporary_password;
    } else {
      document.getElementById('fast-temp-pass-box').classList.add('hidden');
    }

    showToast('Pix Copia e Cola gerado com sucesso!', 'success');
  } catch (err) {}
}

function copyFastPixCode() {
  const input = document.getElementById('fast-copypaste-input');
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast('Código Pix copiado!', 'success');
}

async function simulateFastPayment() {
  if (!activeFastCheckout) return;
  try {
    const data = await apiCall('/api/fast-checkout/simulate-pay', 'POST', {
      session_id: activeFastCheckout.session_id,
    });

    if (data.token) {
      state.token = data.token;
      localStorage.setItem('smm_token', data.token);
    }
    if (data.user) {
      state.user = data.user;
    }

    await fetchUserProfile();
    playAudioFeedback('cash');
    showToast(data.message, 'success');
    closeFastCheckoutModal();

    // Switch directly to orders view and load orders so user immediately sees their order in the table!
    navigateTo('orders');
    await loadUserOrders(true);
  } catch (err) {}
}

function quickDepositFromStorefront(amount) {
  navigateTo('wallet');
  setDepositAmount(amount);
  generatePixInvoice();
}

async function renderStorefrontRecentOrders() {
  const container = document.getElementById('storefront-recent-orders-list');
  const box = document.getElementById('storefront-recent-orders-box');
  if (!container || !box) return;

  try {
    const data = await apiCall('/api/orders?limit=4');
    const orders = data.orders || [];
    if (orders.length === 0) {
      box.classList.add('hidden');
      return;
    }

    box.classList.remove('hidden');
    container.innerHTML = orders
      .map((o) => {
        const statusBadges = {
          pending:
            '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-pending">Pendente</span>',
          in_progress:
            '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-in_progress">Em Andamento</span>',
          completed:
            '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-completed">Concluído</span>',
          canceled:
            '<span class="px-2 py-0.5 rounded text-[10px] font-bold badge-canceled">Cancelado</span>',
        };
        const badge =
          statusBadges[o.status] ||
          `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-300">${escapeText(o.status)}</span>`;

        return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-gray-900/90 border border-gray-800 text-xs gap-2">
          <div class="flex items-center space-x-2.5">
            <span class="font-mono font-bold text-gray-400">#${o.id}</span>
            <span class="font-bold text-white">${escapeText(o.service_name)}</span>
            <span class="text-gray-400 font-mono">(${o.quantity.toLocaleString('pt-BR')} un)</span>
          </div>
          <div class="flex items-center space-x-3">
            <a href="${o.link}" target="_blank" rel="noopener" class="text-cyan-400 hover:underline font-mono truncate max-w-[160px] sm:max-w-xs">${o.link}</a>
            <span class="font-bold text-emerald-400 font-mono">${formatPrice(o.charge_cents)}</span>
            ${badge}
            <a href="/api/orders/${o.id}/receipt" target="_blank" class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-[10px]">Recibo</a>
          </div>
        </div>
      `;
      })
      .join('');
  } catch (err) {
    box.classList.add('hidden');
  }
}

// ==========================================
// ELITE SUITE: LIVE SOCIAL PROOF TICKER (FOMO)
// ==========================================
let socialProofIndex = 0;
let socialProofEvents = [];

async function startSocialProofStream() {
  try {
    const data = await apiCall('/api/social-proof/recent');
    socialProofEvents = data.events || [];
    if (socialProofEvents.length === 0) return;

    setInterval(() => {
      displayNextSocialProof();
    }, 14000);

    setTimeout(() => {
      displayNextSocialProof();
    }, 3000);
  } catch (err) {}
}

function displayNextSocialProof() {
  if (!socialProofEvents || socialProofEvents.length === 0) return;
  const ev = socialProofEvents[socialProofIndex % socialProofEvents.length];
  socialProofIndex++;

  const toast = document.getElementById('social-proof-toast');
  if (!toast) return;

  document.getElementById('sp-name').innerText = ev.user_name;
  document.getElementById('sp-time').innerText = ev.time_ago || 'agora mesmo';
  document.getElementById('sp-desc').innerText =
    `comprou ${Number(ev.quantity).toLocaleString('pt-BR')} ${escapeText(ev.service_name)}`;
  document.getElementById('sp-city').innerText = ev.city || 'Brasil';

  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.remove('translate-y-4', 'opacity-0');
  }, 50);

  setTimeout(() => {
    hideSocialProofToast();
  }, 6000);
}

function hideSocialProofToast() {
  const toast = document.getElementById('social-proof-toast');
  if (!toast) return;
  toast.classList.add('translate-y-4', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 400);
}

// ==========================================
// ELITE SUITE: SMART LINK INSPECTOR
// ==========================================
function setupSmartLinkInspector() {
  const linkInput = document.getElementById('order-link-input');
  const previewBox = document.getElementById('link-preview-box');
  const previewUser = document.getElementById('link-preview-username');
  if (!linkInput) return;

  linkInput.addEventListener('input', () => {
    if (!linkInput.value.trim() && previewBox) {
      previewBox.classList.add('hidden');
    }
  });

  linkInput.addEventListener('blur', async () => {
    const val = linkInput.value.trim();
    if (!val || val.length < 4) {
      if (previewBox) previewBox.classList.add('hidden');
      return;
    }

    const plat = state.selectedService
      ? state.selectedService.platform
      : 'geral';
    try {
      const data = await apiCall('/api/link/inspect', 'POST', {
        url: val,
        platform: plat,
      });
      if (data.cleaned_url && data.cleaned_url !== val) {
        linkInput.value = data.cleaned_url;
      }
      if (previewBox && previewUser) {
        let handle = val
          .replace(
            /https?:\/\/(www\.)?(instagram|tiktok|twitter|x)\.com\//i,
            ''
          )
          .replace(/[\/\?].*$/, '')
          .replace('@', '');
        previewUser.innerText = `@${handle || 'perfil_destino'}`;
        previewBox.classList.remove('hidden');
      }
      if (data.preview && data.preview.note) {
        showToast(data.preview.note, 'info');
      }
    } catch (err) {}
  });
}

// ==========================================
// SEGREGATED ADMIN PORTAL & ADMIN GATE
// ==========================================
function openAdminGate() {
  if (state.user && state.user.role === 'admin') {
    navigateTo('admin-dashboard');
    return;
  }
  document.getElementById('modal-admin-gate').classList.remove('hidden');
}

function closeAdminGate() {
  document.getElementById('modal-admin-gate').classList.add('hidden');
}

async function handleAdminGateLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-gate-email').value.trim();
  const password = document.getElementById('admin-gate-password').value;

  try {
    const data = await apiCall('/api/auth/login', 'POST', { email, password });
    if (data.user.role !== 'admin') {
      showToast(
        'Acesso negado: Esta conta não possui privilégios de administrador.',
        'error'
      );
      return;
    }

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('smm_token', data.token);
    updateUserUI();
    closeAdminGate();
    showToast('Acesso de Administrador autenticado com sucesso!', 'success');
    navigateTo('admin-dashboard');
  } catch (err) {}
}

function exitAdminPortal() {
  navigateTo('storefront');
  showToast('Você retornou à visualização de cliente.', 'info');
}

function toggleAdminPrivacy() {
  state.adminPrivacyMode = !state.adminPrivacyMode;
  const targets = [
    'admin-kpi-deposits',
    'admin-kpi-revenue',
    'admin-kpi-profit',
    'admin-kpi-liability',
  ];

  targets.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (state.adminPrivacyMode) el.classList.add('blur-md');
      else el.classList.remove('blur-md');
    }
  });

  const btnLabel = document.getElementById('admin-privacy-label');
  if (btnLabel) {
    btnLabel.innerText = state.adminPrivacyMode
      ? 'Modo Sigilo (Ativo)'
      : 'Modo Sigilo (Blur)';
  }
}

async function downloadAuthenticatedFile(url, filename) {
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + state.token },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Não foi possível baixar o arquivo.');
    }
    const objectUrl = URL.createObjectURL(await response.blob()),
      link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast('Arquivo baixado.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}
async function downloadDatabaseBackup() {
  if (!state.token) return;
  await downloadAuthenticatedFile(
    '/api/admin/backup-db',
    'smmhub-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite'
  );
}

// ==========================================
// HANDCRAFTED HUMAN STOREFRONT LOGIC
// ==========================================
async function loadStorefrontNetworkStatus() {
  const container = document.getElementById('storefront-network-grid');
  if (!container) return;

  try {
    const data = await apiCall('/api/services/network-status');
    const icons = {
      instagram: 'fa-brands fa-instagram text-pink-500',
      tiktok: 'fa-brands fa-tiktok text-cyan-400',
      youtube: 'fa-brands fa-youtube text-red-500',
      telegram: 'fa-brands fa-telegram text-sky-400',
      spotify: 'fa-brands fa-spotify text-emerald-400',
      deezer: 'fa-solid fa-music text-amber-400',
      soundcloud: 'fa-brands fa-soundcloud text-orange-500',
      linkedin: 'fa-brands fa-linkedin text-blue-500',
      reddit: 'fa-brands fa-reddit text-orange-500',
      discord: 'fa-brands fa-discord text-indigo-400',
      twitch: 'fa-brands fa-twitch text-purple-400',
      kick: 'fa-solid fa-bolt text-emerald-400',
      twitter: 'fa-brands fa-x-twitter text-gray-200',
      threads: 'fa-brands fa-threads text-gray-300',
      facebook: 'fa-brands fa-facebook text-blue-600',
      pinterest: 'fa-brands fa-pinterest text-red-600',
      web: 'fa-solid fa-globe text-cyan-400',
      kwai: 'fa-solid fa-play text-orange-400',
    };

    container.innerHTML = data.networks
      .map(
        (n) => `
      <div class="bg-gray-950/80 border border-gray-800/80 rounded-xl p-3 flex flex-col justify-between space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <i class="${icons[n.platform] || 'fa-solid fa-server'} text-sm"></i>
            <span class="text-xs font-bold text-white">${escapeText(n.name)}</span>
          </div>
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        </div>
        <div>
          <span class="text-[10px] font-bold text-emerald-400 block">${n.label}</span>
          <span class="text-[9px] text-gray-400 block">${n.speed}</span>
        </div>
      </div>
    `
      )
      .join('');
  } catch (err) {}
}

function onStorefrontSearch(val) {
  state.storefrontSearch = (val || '').toLowerCase().trim();
  renderStorefrontCards();
  populateTacticalStorefront();
}

function filterStorefrontPlatform(plat) {
  state.storefrontPlatform = plat;
  document.querySelectorAll('.sf-plat-btn').forEach((btn) => {
    if (btn.getAttribute('data-plat') === plat) {
      btn.className =
        'sf-plat-btn active px-3.5 py-2 rounded-xl bg-gray-800 border border-cyan-500/50 text-white font-bold text-xs flex items-center space-x-1.5 transition';
    } else {
      btn.className =
        'sf-plat-btn px-3.5 py-2 rounded-xl bg-gray-900 border border-gray-800 text-gray-300 hover:text-white font-bold text-xs flex items-center space-x-1.5 transition';
    }
  });
  renderStorefrontCards();
  populateTacticalStorefront();
}

function renderStorefrontCards() {
  const container = document.getElementById('storefront-cards-container');
  if (!container || !state.services) return;

  const filtered = state.services.filter((s) => {
    const matchPlat = isServiceInPlatform(s, state.storefrontPlatform);
    if (!matchPlat) return false;
    if (state.storefrontSearch) {
      const q = state.storefrontSearch;
      const text =
        `${escapeText(s.name)} ${escapeText(s.platform)} ${s.description || ''} ${s.category_name || ''}`.toLowerCase();
      return text.includes(q);
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="col-span-3 text-center text-gray-500 py-12">Nenhum serviço encontrado para este filtro ou pesquisa.</div>';
    return;
  }

  const platformIcons = {
    instagram: 'fa-brands fa-instagram text-pink-500',
    tiktok: 'fa-brands fa-tiktok text-cyan-400',
    youtube: 'fa-brands fa-youtube text-red-500',
    telegram: 'fa-brands fa-telegram text-sky-400',
    spotify: 'fa-brands fa-spotify text-emerald-400',
    deezer: 'fa-solid fa-music text-amber-400',
    soundcloud: 'fa-brands fa-soundcloud text-orange-500',
    linkedin: 'fa-brands fa-linkedin text-blue-500',
    reddit: 'fa-brands fa-reddit text-orange-500',
    discord: 'fa-brands fa-discord text-indigo-400',
    twitch: 'fa-brands fa-twitch text-purple-400',
    kick: 'fa-solid fa-bolt text-emerald-400',
    twitter: 'fa-brands fa-x-twitter text-gray-200',
    threads: 'fa-brands fa-threads text-gray-300',
    facebook: 'fa-brands fa-facebook text-blue-600',
    pinterest: 'fa-brands fa-pinterest text-red-600',
    web: 'fa-solid fa-globe text-cyan-400',
    kwai: 'fa-solid fa-play text-orange-400',
  };

  const handcraftedBadges = [
    {
      text: '🔥 MAIS VENDIDO',
      color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    },
    {
      text: '⚡ ENTREGA RÁPIDA',
      color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    },
    {
      text: '🇧🇷 100% BRASILEIROS',
      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    {
      text: '🛡️ REPOSIÇÃO 30D',
      color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    },
  ];

  container.innerHTML = filtered
    .map((s, idx) => {
      const badge = handcraftedBadges[idx % handcraftedBadges.length];
      const initialQty = Math.max(1000, s.min_quantity);
      const initialPriceCents = Math.round(
        (s.price_per_k_cents * initialQty) / 1000
      );

      return `
      <div class="card-cyber rounded-3xl p-6 border border-gray-800 space-y-5 flex flex-col justify-between hover:border-gray-700 transition relative group">
        
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${badge.color}">
              ${badge.text}
            </span>
            <div class="flex items-center space-x-1.5 text-xs text-gray-400">
              <i class="${platformIcons[s.platform] || 'fa-solid fa-server'} text-base"></i>
              <span class="capitalize font-bold text-gray-300">${escapeText(s.platform)}</span>
            </div>
          </div>

          <div>
            <h3 class="text-base font-extrabold text-white group-hover:text-cyan-400 transition leading-snug">
              ${escapeText(s.name)}
            </h3>
            <p class="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
              ${s.description || 'Entrega gradual de alta retenção, sem queda, compatível com o algoritmo da plataforma.'}
            </p>
          </div>

          <!-- Quantity Slider Control -->
          <div class="space-y-1.5 pt-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-400">Quantidade Desejada:</span>
              <span id="sf-qty-display-${s.id}" class="font-bold text-cyan-400 font-mono">${initialQty.toLocaleString('pt-BR')}</span>
            </div>
            <input type="range" id="sf-slider-${s.id}" min="${s.min_quantity}" max="${Math.min(20000, s.max_quantity)}" step="250" value="${initialQty}" data-action="updateStorefrontSlider" data-event="input" data-args="${escapeText(JSON.stringify([s.id, s.price_per_k_cents]))}" class="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400">
            <div class="flex justify-between text-[10px] text-gray-500 font-mono">
              <span>${s.min_quantity}</span>
              <span>10.000</span>
              <span>${Math.min(20000, s.max_quantity).toLocaleString('pt-BR')}</span>
            </div>
          </div>

          <!-- Order Bump Checkbox -->
          <div class="p-3 bg-gray-950/80 rounded-xl border border-gray-800/80 text-xs">
            <label class="flex items-start space-x-2.5 cursor-pointer">
              <input type="checkbox" id="sf-bump-${s.id}" data-action="updateStorefrontSlider" data-event="change" data-args="${escapeText(JSON.stringify([s.id, s.price_per_k_cents]))}" class="rounded border-gray-700 bg-gray-900 text-cyan-400 mt-0.5">
              <div class="leading-tight">
                <span class="text-white font-bold">+ 500 Curtidas Brasileiras (+ R$ 6,90)</span>
                <span class="block text-[10px] text-gray-400 mt-0.5">Turbine o alcance do post com engajamento simultâneo.</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Price & Buy Button Footer -->
        <div class="pt-4 border-t border-gray-800/80 space-y-3">
          <div class="flex items-baseline justify-between">
            <span class="text-xs text-gray-400">Total com Desconto:</span>
            <div id="sf-price-display-${s.id}" class="text-2xl font-black text-emerald-400 font-mono">
              ${formatPrice(initialPriceCents)}
            </div>
          </div>

          <button data-action="buyStorefrontService" data-event="click" data-args="${escapeText(JSON.stringify([s.id]))}" class="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-black text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 active:scale-95">
            <i class="fa-brands fa-pix text-base"></i>
            <span>Comprar Agora com Pix</span>
          </button>
        </div>

      </div>
    `;
    })
    .join('');
}

function updateStorefrontSlider(serviceId, pricePerK) {
  const slider = document.getElementById(`sf-slider-${serviceId}`);
  const qtyDisplay = document.getElementById(`sf-qty-display-${serviceId}`);
  const priceDisplay = document.getElementById(`sf-price-display-${serviceId}`);
  const bumpCheck = document.getElementById(`sf-bump-${serviceId}`);

  if (!slider) return;
  const qty = parseInt(slider.value, 10);
  qtyDisplay.innerText = qty.toLocaleString('pt-BR');

  // Progressive volume discount calculation
  let rate = pricePerK;
  if (qty >= 10000)
    rate = Math.round(pricePerK * 0.85); // 15% off
  else if (qty >= 5000)
    rate = Math.round(pricePerK * 0.9); // 10% off
  else if (qty >= 2500) rate = Math.round(pricePerK * 0.95); // 5% off

  let totalCents = Math.round((rate * qty) / 1000);
  if (bumpCheck && bumpCheck.checked) {
    totalCents += 690;
  }

  priceDisplay.innerText = formatPrice(totalCents);
}

function buyStorefrontService(serviceId) {
  const slider = document.getElementById(`sf-slider-${serviceId}`);
  const bumpCheck = document.getElementById(`sf-bump-${serviceId}`);

  openFastCheckoutModal();

  const select = document.getElementById('fast-service-select');
  if (select) {
    select.value = serviceId;
  }
  const qtyInput = document.getElementById('fast-qty');
  if (qtyInput && slider) {
    qtyInput.value = slider.value;
  }

  calculateFastPrice();
}

// ==========================================
// TACTICAL COMMAND DECK WORKBENCH (MESA DE DESPACHO)
// ==========================================
let tacticalActivePlatform = 'instagram';
let tacticalSelectedService = null;
let tacticalSelectedQty = 1000;

function populateTacticalStorefront() {
  // 2. Render Platform Orbit Dial
  const dialContainer = document.getElementById('storefront-dial-platforms');
  if (dialContainer) {
    const platforms = [
      {
        id: 'instagram',
        label: 'Instagram',
        icon: 'fa-brands fa-instagram',
        color: 'text-pink-500',
      },
      {
        id: 'tiktok',
        label: 'TikTok',
        icon: 'fa-brands fa-tiktok',
        color: 'text-cyan-400',
      },
      {
        id: 'youtube',
        label: 'YouTube',
        icon: 'fa-brands fa-youtube',
        color: 'text-red-500',
      },
      {
        id: 'telegram',
        label: 'Telegram',
        icon: 'fa-brands fa-telegram',
        color: 'text-sky-400',
      },
      {
        id: 'spotify',
        label: 'Spotify',
        icon: 'fa-brands fa-spotify',
        color: 'text-emerald-400',
      },
      {
        id: 'twitter',
        label: 'X (Twitter)',
        icon: 'fa-brands fa-x-twitter',
        color: 'text-gray-200',
      },
      {
        id: 'facebook',
        label: 'Facebook',
        icon: 'fa-brands fa-facebook',
        color: 'text-blue-500',
      },
      {
        id: 'kwai',
        label: 'Kwai',
        icon: 'fa-solid fa-play',
        color: 'text-orange-400',
      },
      {
        id: 'twitch',
        label: 'Twitch',
        icon: 'fa-brands fa-twitch',
        color: 'text-purple-400',
      },
      {
        id: 'web',
        label: 'Web Traffic',
        icon: 'fa-solid fa-globe',
        color: 'text-cyan-400',
      },
    ];

    dialContainer.innerHTML = platforms
      .map((p) => {
        const isAct = p.id === tacticalActivePlatform;
        return `
        <button type="button" data-action="onTacticalPlatformSelect" data-event="click" data-args="${escapeText(JSON.stringify([p.id]))}" id="tactical-plat-${p.id}" class="tactical-plat-btn p-3 rounded-2xl border flex flex-col items-center justify-center space-y-1.5 transition ${isAct ? 'bg-cyan-500/10 border-cyan-500 ring-2 ring-cyan-500/40 text-white' : 'bg-gray-900/80 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'}">
          <i class="${p.icon} ${p.color} text-lg"></i>
          <span class="text-[10px] font-extrabold uppercase tracking-tight">${p.label}</span>
        </button>
      `;
      })
      .join('');
  }

  // 3. Populate Services for default platform
  filterTacticalServicesByPlatform(tacticalActivePlatform);

  // 4. Set initial quantity
  setTacticalQty(1000, false);
}

function onTacticalPlatformSelect(platformId) {
  tacticalActivePlatform = platformId;
  document.querySelectorAll('.tactical-plat-btn').forEach((btn) => {
    btn.className =
      'tactical-plat-btn p-3 rounded-2xl border flex flex-col items-center justify-center space-y-1.5 transition bg-gray-900/80 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700';
  });
  const act = document.getElementById(`tactical-plat-${platformId}`);
  if (act) {
    act.className =
      'tactical-plat-btn p-3 rounded-2xl border flex flex-col items-center justify-center space-y-1.5 transition bg-cyan-500/10 border-cyan-500 ring-2 ring-cyan-500/40 text-white';
  }

  filterTacticalServicesByPlatform(platformId);
}

function filterTacticalServicesByPlatform(platformId) {
  const select = document.getElementById('storefront-tactical-service-select');
  if (!select || !state.services) return;

  const filtered = state.services.filter((s) =>
    isServiceInPlatform(s, platformId)
  );
  const listToRender = filtered.length > 0 ? filtered : state.services;

  select.innerHTML = listToRender
    .map(
      (s) => `
    <option value="${s.id}">
      ${escapeText(s.name)} - ${formatPrice(s.price_per_k_cents)}/1k (Mín: ${s.min_quantity})
    </option>
  `
    )
    .join('');

  if (listToRender.length > 0) {
    select.value = listToRender[0].id;
  }
  onTacticalServiceChanged();
}

function onTacticalServiceChanged() {
  const select = document.getElementById('storefront-tactical-service-select');
  if (!select) return;

  const sId = parseInt(select.value, 10);
  tacticalSelectedService =
    state.services.find((s) => s.id === sId) || state.services[0];

  if (!tacticalSelectedService) return;

  // Update slider bounds
  const slider = document.getElementById('tactical-qty-slider');
  if (slider) {
    slider.min = tacticalSelectedService.min_quantity || 100;
    slider.max = Math.min(tacticalSelectedService.max_quantity || 50000, 50000);
    if (tacticalSelectedQty < slider.min) tacticalSelectedQty = slider.min;
    if (tacticalSelectedQty > slider.max) tacticalSelectedQty = slider.max;
    slider.value = tacticalSelectedQty;
  }

  // Update Raio-X
  const specName = document.getElementById('tactical-spec-name');
  if (specName) specName.innerText = tacticalSelectedService.name;

  const pricePerK = document.getElementById('tactical-price-per-k');
  if (pricePerK)
    pricePerK.innerText = formatPrice(
      tacticalSelectedService.price_per_k_cents
    );

  const refillTag = document.getElementById('tactical-refill-tag');
  if (refillTag) {
    refillTag.innerText = tacticalSelectedService.refill
      ? 'REPOSIÇÃO GARANTIDA'
      : 'ENTREGA DIRETA';
  }

  // Update placeholder based on service
  const linkInput = document.getElementById('storefront-tactical-link');
  if (linkInput) {
    const plat = (tacticalSelectedService.platform || '').toLowerCase();
    if (plat === 'telegram')
      linkInput.placeholder = 'https://t.me/seu_canal ou @seucanal';
    else if (plat === 'instagram')
      linkInput.placeholder = 'https://instagram.com/seu_perfil ou @perfil';
    else if (plat === 'tiktok')
      linkInput.placeholder = 'https://tiktok.com/@usuario ou link do vídeo';
    else if (plat === 'youtube')
      linkInput.placeholder =
        'https://youtube.com/watch?v=... ou link do canal';
    else if (plat === 'spotify')
      linkInput.placeholder = 'https://open.spotify.com/track/...';
    else linkInput.placeholder = 'https://... link de destino';
  }

  calculateTacticalPrice();
}

function setTacticalQty(qty, recalculate = true) {
  tacticalSelectedQty = parseInt(qty, 10);

  const slider = document.getElementById('tactical-qty-slider');
  if (slider) slider.value = tacticalSelectedQty;

  const display = document.getElementById('tactical-qty-display');
  if (display)
    display.innerText = `${tacticalSelectedQty.toLocaleString('pt-BR')} un`;

  // Highlight active button
  document.querySelectorAll('.tactical-qty-btn').forEach((btn) => {
    const val = parseInt(btn.innerText.replace('.', '').trim(), 10);
    if (val === tacticalSelectedQty) {
      btn.className =
        'tactical-qty-btn active py-2 bg-gray-800 text-white font-mono text-xs font-black rounded-xl border border-cyan-500/50 transition';
    } else {
      btn.className =
        'tactical-qty-btn py-2 bg-gray-900 hover:bg-gray-800 text-gray-300 font-mono text-xs font-bold rounded-xl border border-gray-800 transition';
    }
  });

  if (recalculate) calculateTacticalPrice();
}

function onTacticalSliderInput(val) {
  setTacticalQty(val, true);
}

function onTacticalLinkInput(val) {
  const status = document.getElementById('tactical-link-status');
  if (!status) return;

  const clean = (val || '').trim();
  if (clean.length === 0) {
    status.innerHTML =
      '<i class="fa-solid fa-shield-check mr-1"></i>100% Seguro (Zero Senhas)';
    status.className = 'text-emerald-400 font-bold text-[11px]';
  } else if (
    clean.startsWith('http') ||
    clean.startsWith('@') ||
    clean.startsWith('t.me')
  ) {
    status.innerHTML =
      '<i class="fa-solid fa-check-circle mr-1"></i>Link Validado pelo Radar';
    status.className = 'text-cyan-400 font-bold text-[11px]';
  } else {
    status.innerHTML =
      '<i class="fa-solid fa-circle-info mr-1"></i>Cole o link completo ou @usuario';
    status.className = 'text-amber-400 font-bold text-[11px]';
  }
}

function calculateTacticalPrice() {
  if (!tacticalSelectedService) return;

  const baseRate = tacticalSelectedService.price_per_k_cents;
  let finalRate = baseRate;

  // Wholesale scale discounts
  const badge = document.getElementById('tactical-volume-badge');
  if (tacticalSelectedQty >= 10000) {
    finalRate = Math.round(baseRate * 0.85); // 15% OFF
    if (badge) {
      badge.innerText = '🔥 15% OFF ATACADO';
      badge.className =
        'px-2 py-0.5 rounded text-[10px] font-black uppercase bg-pink-500/20 text-pink-400 border border-pink-500/30';
    }
  } else if (tacticalSelectedQty >= 5000) {
    finalRate = Math.round(baseRate * 0.9); // 10% OFF
    if (badge) {
      badge.innerText = '⚡ 10% OFF ATACADO';
      badge.className =
        'px-2 py-0.5 rounded text-[10px] font-black uppercase bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
    }
  } else if (tacticalSelectedQty >= 2500) {
    finalRate = Math.round(baseRate * 0.95); // 5% OFF
    if (badge) {
      badge.innerText = '✨ 5% OFF VOLUME';
      badge.className =
        'px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    }
  } else {
    if (badge) {
      badge.innerText = 'VOLUME PADRÃO';
      badge.className =
        'px-2 py-0.5 rounded text-[10px] font-black uppercase bg-gray-800 text-gray-400 border border-gray-700';
    }
  }

  const totalCents = Math.round((finalRate * tacticalSelectedQty) / 1000);
  const finalPriceEl = document.getElementById('tactical-final-price');
  if (finalPriceEl) {
    finalPriceEl.innerText = formatPrice(totalCents);
  }

  // Update Wallet button state
  const btnWallet = document.getElementById('btn-tactical-wallet-buy');
  if (btnWallet) {
    const userBalance = (state.user && state.user.balance_cents) || 0;
    if (userBalance >= totalCents && totalCents > 0) {
      btnWallet.className =
        'w-full py-4 bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-black font-black text-sm uppercase tracking-wider rounded-2xl transition flex items-center justify-center space-x-2.5 shadow-xl shadow-cyan-500/20 active:scale-95 cursor-pointer';
      btnWallet.innerHTML = `<i class="fa-solid fa-bolt text-base"></i><span>Despachar com Saldo da Carteira (1-Clique) - Saldo R$ ${(userBalance / 100).toFixed(2).replace('.', ',')}</span>`;
      btnWallet.disabled = false;
    } else {
      btnWallet.className =
        'w-full py-4 bg-gray-800 hover:bg-gray-700 text-cyan-400 border border-cyan-500/30 font-black text-xs uppercase tracking-wider rounded-2xl transition flex items-center justify-center space-x-2.5 active:scale-95 cursor-pointer';
      btnWallet.innerHTML = `<i class="fa-solid fa-wallet text-sm"></i><span>Depositar na Carteira (+ Saldo) ou Pagar no Pix Abaixo</span>`;
      btnWallet.disabled = false;
    }
  }
}

async function handleTacticalWalletDispatch() {
  if (!state.token) {
    openAuthModal();
    return;
  }

  if (!tacticalSelectedService) {
    showToast('Selecione um serviço primeiro.', 'error');
    return;
  }

  const linkInput = document.getElementById('storefront-tactical-link');
  const link = (linkInput ? linkInput.value : '').trim();

  if (!link) {
    showToast(
      'Informe o link do perfil, canal ou publicação para receber os itens.',
      'error'
    );
    if (linkInput) linkInput.focus();
    return;
  }

  const baseRate = tacticalSelectedService.price_per_k_cents;
  let finalRate = baseRate;
  if (tacticalSelectedQty >= 10000) finalRate = Math.round(baseRate * 0.85);
  else if (tacticalSelectedQty >= 5000) finalRate = Math.round(baseRate * 0.9);
  else if (tacticalSelectedQty >= 2500) finalRate = Math.round(baseRate * 0.95);
  const totalCents = Math.round((finalRate * tacticalSelectedQty) / 1000);

  const userBalance = (state.user && state.user.balance_cents) || 0;
  if (userBalance < totalCents) {
    showToast(
      'Saldo insuficiente na carteira. Adicione saldo ou pague via Pix instantâneo.',
      'info'
    );
    navigateTo('wallet');
    return;
  }

  try {
    const btn = document.getElementById('btn-tactical-wallet-buy');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Despachando ordem nos servidores...';
    }

    const res = await apiCall('/api/fast-checkout/pay-with-wallet', 'POST', {
      service_id: tacticalSelectedService.id,
      link: link,
      quantity: tacticalSelectedQty,
    });

    playAudioFeedback('cash');
    state.user.balance_cents = res.new_balance_cents;
    updateUserUI();

    showToast(`🚀 Pedido #${res.order_id} Despachado com Sucesso!`, 'success');

    if (linkInput) linkInput.value = '';
    renderStorefrontRecentOrders();

    if (state.token) loadUserOrders(false);
  } catch (err) {
    showToast(err.message || 'Erro ao despachar com saldo.', 'error');
  } finally {
    calculateTacticalPrice();
  }
}

function handleTacticalPixDispatch() {
  if (!tacticalSelectedService) return;

  const linkInput = document.getElementById('storefront-tactical-link');
  const link = linkInput ? linkInput.value.trim() : '';

  openFastCheckoutModal();

  const select = document.getElementById('fast-service-select');
  if (select) select.value = tacticalSelectedService.id;

  const qtyInput = document.getElementById('fast-qty');
  if (qtyInput) qtyInput.value = tacticalSelectedQty;

  const fastLink = document.getElementById('fast-link');
  if (fastLink && link) fastLink.value = link;

  calculateFastPrice();
}

function toggleStorefrontCatalogView() {
  const cardsWrapper = document.getElementById('storefront-cards-view-wrapper');
  const consoleView = document.getElementById('storefront-tactical-console');
  const btnToggle = document.getElementById('btn-toggle-sf-view');

  if (!cardsWrapper || !consoleView) return;

  const isCardsHidden = cardsWrapper.classList.contains('hidden');

  if (isCardsHidden) {
    cardsWrapper.classList.remove('hidden');
    consoleView.classList.add('hidden');
    if (btnToggle) {
      btnToggle.innerHTML =
        '<i class="fa-solid fa-sliders text-cyan-400"></i><span>Voltar para Mesa de Despacho Tática</span>';
    }
  } else {
    cardsWrapper.classList.add('hidden');
    consoleView.classList.remove('hidden');
    if (btnToggle) {
      btnToggle.innerHTML =
        '<i class="fa-solid fa-table-cells text-cyan-400"></i><span>Alternar para Galeria de Cards</span>';
    }
  }
}

function updateResellerCalculator() {
  const qtySlider = document.getElementById('calc-qty-slider');
  const priceSlider = document.getElementById('calc-price-slider');
  if (!qtySlider || !priceSlider) return;

  const qty = parseInt(qtySlider.value, 10);
  const retailPricePerK = parseFloat(priceSlider.value);

  document.getElementById('calc-qty-label').innerText =
    `${qty.toLocaleString('pt-BR')} un`;
  document.getElementById('calc-price-label').innerText =
    `R$ ${retailPricePerK.toFixed(2).replace('.', ',')}`;

  // Average SMM Hub wholesale cost is around R$ 18.00 per 1.000 for high quality
  const wholesaleRatePerK = 18.0;
  const totalCost = (wholesaleRatePerK * qty) / 1000;
  const totalRevenue = (retailPricePerK * qty) / 1000;
  const netProfit = Math.max(0, totalRevenue - totalCost);

  document.getElementById('calc-cost-display').innerText =
    `R$ ${totalCost.toFixed(2).replace('.', ',')}`;
  document.getElementById('calc-revenue-display').innerText =
    `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`;
  document.getElementById('calc-profit-display').innerText =
    `+ R$ ${netProfit.toFixed(2).replace('.', ',')}`;
}

function buyStorefrontBundle(bundleId) {
  openFastCheckoutModal();
  const select = document.getElementById('fast-service-select');
  const qtyInput = document.getElementById('fast-qty');
  const linkInput = document.getElementById('fast-link');

  if (bundleId === 1) {
    // Influencer Start
    if (select) select.value = '1';
    if (qtyInput) qtyInput.value = '1000';
    if (linkInput) linkInput.placeholder = 'https://instagram.com/seu_perfil';
  } else if (bundleId === 2) {
    // TikTok Viral
    if (select) select.value = '5';
    if (qtyInput) qtyInput.value = '10000';
    if (linkInput) linkInput.placeholder = 'https://tiktok.com/@user/video/123';
  } else if (bundleId === 3) {
    // Spotify Artista
    if (select) select.value = '12';
    if (qtyInput) qtyInput.value = '5000';
    if (linkInput) linkInput.placeholder = 'https://open.spotify.com/track/...';
  }
  calculateFastPrice();
  showToast(
    'Combo selecionado com sucesso! Preencha o link para pagar com Pix.',
    'success'
  );
}

// ==========================================
// MASTERCLASS: SYNTHETIC AUDIO ENGINE (ZERO EXTERNAL ASSETS)
// ==========================================
function playAudioFeedback(type = 'click') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === 'click') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } else if (type === 'win') {
      const notes = [440, 554.37, 659.25, 880]; // A major arpeggio
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + idx * 0.08 + 0.25
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.25);
      });
    } else if (type === 'jackpot') {
      const fanfare = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      fanfare.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + idx * 0.1 + 0.4
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.1);
        osc.stop(ctx.currentTime + idx * 0.1 + 0.4);
      });
    } else if (type === 'cash') {
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(987.77, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(
        1318.51,
        ctx.currentTime + 0.1
      );
      gain1.gain.setValueAtTime(0.25, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1567.98, ctx.currentTime + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(
        2093.0,
        ctx.currentTime + 0.22
      );
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.08);
      osc2.stop(ctx.currentTime + 0.55);
    }
  } catch (e) {}
}

// ==========================================
// MASTERCLASS: MONTHLY LEADERBOARD
// ==========================================
async function loadLeaderboard() {
  try {
    const data = await apiCall('/api/leaderboard');
    const label = document.getElementById('leaderboard-month-label');
    if (label) label.innerText = data.month_name.toUpperCase();

    const podium = document.getElementById('leaderboard-podium');
    const tbody = document.getElementById('leaderboard-table-body');

    const top3 = data.leaderboard.slice(0, 3);
    const rest = data.leaderboard.slice(3);

    const podiumColors = [
      {
        border: 'border-yellow-400/60',
        bg: 'bg-yellow-500/10',
        text: 'text-yellow-400',
        icon: 'fa-crown',
      },
      {
        border: 'border-slate-300/60',
        bg: 'bg-slate-300/10',
        text: 'text-slate-300',
        icon: 'fa-medal',
      },
      {
        border: 'border-amber-700/60',
        bg: 'bg-amber-700/10',
        text: 'text-amber-500',
        icon: 'fa-award',
      },
    ];

    if (podium) {
      podium.innerHTML = top3
        .map((b, idx) => {
          const col = podiumColors[idx] || podiumColors[0];
          return `
          <div class="card-cyber rounded-3xl p-6 border ${col.border} ${col.bg} text-center space-y-3 relative">
            <div class="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-2xl ${col.text} bg-black/40 border ${col.border}">
              <i class="fa-solid ${col.icon}"></i>
            </div>
            <div>
              <span class="text-xs font-black uppercase tracking-wider ${col.text}">#${b.rank} Lugar</span>
              <h3 class="text-base font-extrabold text-white mt-1">${b.user_masked}</h3>
              <span class="text-[10px] text-gray-400 font-bold uppercase">${escapeText(b.tier)}</span>
            </div>
            <div class="p-2.5 bg-black/60 rounded-xl border border-gray-800">
              <span class="text-[10px] text-gray-400 block">Volume do Mês:</span>
              <span class="text-base font-black text-emerald-400 font-mono">${b.total_spent_formatted}</span>
            </div>
            <div class="px-2 py-1 rounded-lg bg-yellow-500/20 text-yellow-300 text-[11px] font-bold">
              ${b.prize}
            </div>
          </div>
        `;
        })
        .join('');
    }

    if (tbody) {
      if (rest.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="p-4 text-center text-gray-500">Nenhum outro cliente classificado neste mês ainda.</td></tr>';
      } else {
        tbody.innerHTML = rest
          .map(
            (b) => `
          <tr class="hover:bg-gray-800/30">
            <td class="p-4 font-bold text-gray-400 font-mono">#${b.rank}</td>
            <td class="p-4 font-bold text-white">${b.user_masked}</td>
            <td class="p-4 text-gray-300 text-[10px] uppercase font-bold">${escapeText(b.tier)}</td>
            <td class="p-4 text-gray-400 font-mono">${b.total_orders} ordens</td>
            <td class="p-4 text-right font-extrabold text-emerald-400 font-mono">${b.total_spent_formatted}</td>
          </tr>
        `
          )
          .join('');
      }
    }
  } catch (err) {}
}

// ==========================================
// MASTERCLASS: LOOTBOX / CAIXA MISTERIOSA
// ==========================================
async function handleOpenLootbox() {
  playAudioFeedback('click');
  const animBox = document.getElementById('lootbox-anim-box');
  const btn = document.getElementById('btn-open-lootbox');
  const banner = document.getElementById('lootbox-result-banner');

  if (animBox) {
    animBox.classList.add('rotate-12', 'scale-110');
  }

  try {
    const data = await apiCall('/api/lootbox/open', 'POST');

    // Play celebratory sound based on prize
    if (data.prize_cents >= 5000) {
      playAudioFeedback('jackpot');
    } else {
      playAudioFeedback('win');
    }

    setTimeout(() => {
      if (animBox) animBox.classList.remove('rotate-12', 'scale-110');
    }, 400);

    if (banner) {
      banner.classList.remove('hidden');
      document.getElementById('lootbox-prize-display').innerText =
        data.prize_formatted;
      document.getElementById('lootbox-prize-desc').innerText =
        data.prize_label;
    }

    state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    showToast(data.message, 'success');
  } catch (err) {
    if (animBox) animBox.classList.remove('rotate-12', 'scale-110');
  }
}

// ==========================================
// MASTERCLASS: EMERGENCY FREEZE TOGGLE
// ==========================================
async function toggleEmergencyFreeze() {
  playAudioFeedback('click');
  try {
    const data = await apiCall('/api/security/freeze-toggle', 'POST');
    showToast(data.message, data.is_frozen ? 'error' : 'success');

    const label = document.getElementById('admin-freeze-label');
    const btn = document.getElementById('btn-admin-freeze');
    if (label && btn) {
      if (data.is_frozen) {
        label.innerText = 'Congelar Pedidos (ATIVO)';
        btn.className =
          'px-3 py-1.5 bg-red-600 border border-red-400 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 animate-pulse';
      } else {
        label.innerText = 'Congelar Pedidos (Off)';
        btn.className =
          'px-3 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 rounded-xl text-xs font-bold transition flex items-center space-x-1.5';
      }
    }
  } catch (err) {}
}
