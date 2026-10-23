(() => {
  const forms = Array.from(
    document.querySelectorAll('#register-form,#form-register')
  );
  if (!forms.length) return;
  const widgets = new WeakMap();
  window.resetRegistrationCaptcha = (form) => {
    const widget = widgets.get(form);
    if (widget) {
      widget.client.reset(widget.id);
      form.dataset.captchaToken = '';
    }
  };
  async function init() {
    const response = await fetch('/api/auth/public-config');
    if (!response.ok)
      throw new Error('Não foi possível carregar a verificação.');
    const { captcha } = await response.json();
    if (captcha.provider === 'none') return;
    if (
      !captcha.site_key ||
      !['turnstile', 'hcaptcha'].includes(captcha.provider)
    )
      throw new Error('Verificação de cadastro não configurada.');
    const script = document.createElement('script');
    script.src =
      captcha.provider === 'turnstile'
        ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        : 'https://js.hcaptcha.com/1/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error('Não foi possível carregar a verificação.'));
      document.head.append(script);
    });
    const client =
      captcha.provider === 'turnstile' ? window.turnstile : window.hcaptcha;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || widgets.has(entry.target)) continue;
        const form = entry.target,
          container = document.createElement('div');
        container.style.margin = '12px 0';
        form.insertBefore(container, form.querySelector('[type="submit"]'));
        const id = client.render(container, {
          sitekey: captcha.site_key,
          callback: (token) => {
            form.dataset.captchaToken = token;
          },
          'expired-callback': () => {
            form.dataset.captchaToken = '';
          },
          'error-callback': () => {
            form.dataset.captchaToken = '';
          },
        });
        widgets.set(form, { client, id });
        observer.unobserve(form);
      }
    });
    forms.forEach((form) => observer.observe(form));
  }
  init().catch((error) => {
    for (const form of forms) {
      const status = document.createElement('p');
      status.setAttribute('role', 'alert');
      status.textContent = error.message;
      form.append(status);
    }
  });
})();
