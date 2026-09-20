/**
 * <hover-menu> - opens the header's inline dropdown / mega menus on hover.
 *
 * Wraps Dawn's existing <header-menu><details> markup, so keyboard, touch and
 * screen-reader behaviour stay exactly as the theme ships them:
 *   - mouse (fine pointer, >= 990px): hover opens with intent delay, leaving closes
 *   - touch / coarse pointer:         unchanged, tap toggles the <details>
 *   - keyboard:                       unchanged, Enter toggles, Escape closes
 */
if (!customElements.get('hover-menu')) {
  class HoverMenu extends HTMLElement {
    connectedCallback() {
      this.openDelay = Number(this.dataset.openDelay) || 70;
      this.closeDelay = Number(this.dataset.closeDelay) || 240;
      this.hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
      this.desktopQuery = window.matchMedia('(min-width: 990px)');
      this.controller = new AbortController();
      this.openTimer = null;
      this.closeTimer = null;

      const { signal } = this.controller;

      this.querySelectorAll('.header__inline-menu > ul > li').forEach((item) => {
        const details = item.querySelector('header-menu > details');

        item.addEventListener('pointerenter', (event) => this.onPointerEnter(event, details), { signal });

        if (!details) return;

        item.addEventListener('pointerleave', (event) => this.onPointerLeave(event), { signal });

        const summary = details.querySelector('summary');
        if (summary) summary.addEventListener('click', (event) => this.onSummaryClick(event, details), { signal });
      });

      this.hideOnScrollHandler = () => this.closeAll();
      window.addEventListener('pageshow', this.hideOnScrollHandler, { signal });
    }

    disconnectedCallback() {
      clearTimeout(this.openTimer);
      clearTimeout(this.closeTimer);
      this.controller.abort();
    }

    get hoverEnabled() {
      return this.hoverQuery.matches && this.desktopQuery.matches;
    }

    isMousePointer(event) {
      return this.hoverEnabled && event.pointerType !== 'touch' && event.pointerType !== 'pen';
    }

    onPointerEnter(event, details) {
      if (!this.isMousePointer(event)) return;

      clearTimeout(this.openTimer);
      clearTimeout(this.closeTimer);

      // A top-level item without a panel: close whatever is open.
      if (!details) {
        this.closeAll();
        return;
      }

      if (details.open) return;

      // Moving sideways between menus should feel instant.
      const delay = this.querySelector('details[open]') ? 0 : this.openDelay;
      this.openTimer = setTimeout(() => this.open(details), delay);
    }

    onPointerLeave(event) {
      if (!this.isMousePointer(event)) return;

      clearTimeout(this.openTimer);
      this.closeTimer = setTimeout(() => this.closeAll(), this.closeDelay);
    }

    onSummaryClick(event, details) {
      // event.detail === 0 means keyboard activation - keep the native toggle.
      if (event.detail === 0 || !this.hoverEnabled) return;

      const url = details.querySelector('summary').dataset.href;
      if (!url) return;

      event.preventDefault();

      if (!details.open) {
        this.open(details);
        return;
      }

      window.location.href = url;
    }

    open(details) {
      this.closeAll(details);
      details.open = true;
      this.setExpanded(details, true);
    }

    closeAll(except) {
      this.querySelectorAll('details[open]').forEach((details) => {
        if (details === except) return;
        details.open = false;
        this.setExpanded(details, false);
      });
    }

    setExpanded(details, isOpen) {
      const summary = details.querySelector('summary');
      if (summary) summary.setAttribute('aria-expanded', isOpen);
    }
  }

  customElements.define('hover-menu', HoverMenu);
}
