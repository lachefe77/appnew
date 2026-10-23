(() => {
  const style = document.createElement('style');
  style.textContent =
    ':focus-visible{outline:3px solid #0891b2!important;outline-offset:3px}.table-scroll{max-width:100%;overflow-x:auto}dialog{max-width:calc(100vw - 32px);max-height:90vh;overflow:auto}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}';
  document.head.append(style);
  function enhance() {
    document.querySelectorAll('.side-item:not([tabindex])').forEach((el) => {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          el.click();
        }
      });
    });
    document.querySelectorAll('table').forEach((table) => {
      if (table.parentElement.classList.contains('table-scroll')) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      table.replaceWith(wrap);
      wrap.append(table);
    });
    document.querySelectorAll('[id^="modal-"]').forEach((el) => {
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
    });
  }
  enhance();
  new MutationObserver(enhance).observe(document.body, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('keydown', (event) => {
    const modal = [...document.querySelectorAll('[id^="modal-"]')].find(
      (el) => !el.classList.contains('hidden') && el.offsetParent !== null
    );
    if (!modal) return;
    if (event.key === 'Escape') {
      modal.classList.add('hidden');
      return;
    }
    if (event.key === 'Tab') {
      const focus = [
        ...modal.querySelectorAll(
          'button,input,select,textarea,a[href],[tabindex="0"]'
        ),
      ].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focus.length) return;
      const first = focus[0],
        last = focus.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
})();
