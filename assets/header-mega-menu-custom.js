/*
  <mega-menu-item>

  Opens a top-level header menu on hover / keyboard focus and closes it on
  mouseleave, Escape, a click outside, or focus moving out of the item.

  The trigger stays a real <a>, so the top-level item still navigates and is
  still crawlable. On touch devices (hover: none) the first tap opens the
  panel and the second tap follows the link.

  Used by snippets/header-mega-menu-custom.liquid when "Open menus on hover"
  is enabled. In click mode the snippet renders Dawn's <details> markup
  instead and this element is never used (<mega-menu-panel> below still is).
*/
if (!customElements.get('mega-menu-item')) {
  class MegaMenuItem extends HTMLElement {
    connectedCallback() {
      this.trigger = this.querySelector('[data-mega-trigger]');
      this.openDelay = Number(this.dataset.openDelay) || 0;
      this.closeDelay = Number(this.dataset.closeDelay) || 200;
      this.openTimer = null;
      this.closeTimer = null;

      this.onEnter = this.onEnter.bind(this);
      this.onLeave = this.onLeave.bind(this);
      this.onFocusIn = this.onFocusIn.bind(this);
      this.onFocusOut = this.onFocusOut.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onTriggerClick = this.onTriggerClick.bind(this);
      this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);

      this.addEventListener('mouseenter', this.onEnter);
      this.addEventListener('mouseleave', this.onLeave);
      this.addEventListener('focusin', this.onFocusIn);
      this.addEventListener('focusout', this.onFocusOut);
      this.addEventListener('keydown', this.onKeydown);
      this.trigger?.addEventListener('click', this.onTriggerClick);
    }

    disconnectedCallback() {
      clearTimeout(this.openTimer);
      clearTimeout(this.closeTimer);
      this.removeEventListener('mouseenter', this.onEnter);
      this.removeEventListener('mouseleave', this.onLeave);
      this.removeEventListener('focusin', this.onFocusIn);
      this.removeEventListener('focusout', this.onFocusOut);
      this.removeEventListener('keydown', this.onKeydown);
      this.trigger?.removeEventListener('click', this.onTriggerClick);
      document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    }

    get isTouch() {
      return window.matchMedia('(hover: none)').matches;
    }

    onEnter() {
      if (this.isTouch) return;
      clearTimeout(this.closeTimer);

      // Sliding sideways from an already open menu should feel instant.
      const delay = document.querySelector('mega-menu-item[open]') ? 0 : this.openDelay;
      this.openTimer = setTimeout(() => this.open(), delay);
    }

    onLeave() {
      if (this.isTouch) return;
      clearTimeout(this.openTimer);
      this.closeTimer = setTimeout(() => this.close(), this.closeDelay);
    }

    onFocusIn() {
      clearTimeout(this.closeTimer);
      this.open();
    }

    onFocusOut(event) {
      if (this.contains(event.relatedTarget)) return;
      this.close();
    }

    onKeydown(event) {
      if (event.key !== 'Escape') return;
      this.close();
      this.trigger?.focus();
    }

    // No hover on touch, so the first tap opens and the second follows the link.
    onTriggerClick(event) {
      if (!this.isTouch) return;
      if (this.hasAttribute('open')) return;
      event.preventDefault();
      this.open();
    }

    onDocumentPointerDown(event) {
      if (this.contains(event.target)) return;
      this.close();
    }

    open() {
      if (this.hasAttribute('open')) return;

      document.querySelectorAll('mega-menu-item[open]').forEach((item) => {
        if (item !== this) item.close();
      });

      this.setAttribute('open', '');
      this.trigger?.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', this.onDocumentPointerDown);
    }

    close() {
      clearTimeout(this.openTimer);
      document.removeEventListener('pointerdown', this.onDocumentPointerDown);
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.trigger?.setAttribute('aria-expanded', 'false');
      this.querySelector('mega-menu-panel')?.reset?.();
    }
  }

  customElements.define('mega-menu-item', MegaMenuItem);
}

/*
  <mega-menu-panel>

  Swaps the image group inside a mega menu panel when a 2nd / 3rd-level link
  is hovered or focused. Links carry data-mega-media="<key>", image groups
  carry data-mega-media-group="<key>"; inactive groups are `inert` and hidden
  with CSS. Resets to the default group when the menu closes.

  Works in both open modes (hover <mega-menu-item> and click <details>).
*/
if (!customElements.get('mega-menu-panel')) {
  class MegaMenuPanel extends HTMLElement {
    static HOVER_DELAY = 90;

    connectedCallback() {
      this.groups = Array.from(this.querySelectorAll('[data-mega-media-group]'));
      if (this.groups.length < 2) return;

      this.defaultKey = this.dataset.defaultMedia;
      this.activeKey = this.defaultKey;
      this.hoverTimer = null;

      this.onPointerOver = this.onPointerOver.bind(this);
      this.onFocusIn = this.onFocusIn.bind(this);
      this.onToggle = this.onToggle.bind(this);

      this.addEventListener('mouseover', this.onPointerOver);
      this.addEventListener('focusin', this.onFocusIn);

      // Click mode: reset when Dawn's <details> closes.
      this.details = this.closest('details');
      this.details?.addEventListener('toggle', this.onToggle);
    }

    disconnectedCallback() {
      clearTimeout(this.hoverTimer);
      this.removeEventListener('mouseover', this.onPointerOver);
      this.removeEventListener('focusin', this.onFocusIn);
      this.details?.removeEventListener('toggle', this.onToggle);
    }

    // Short intent delay so sweeping the pointer across links towards the
    // images doesn't flicker through every group on the way.
    onPointerOver(event) {
      if (event.target.closest('.mega-custom__media')) {
        clearTimeout(this.hoverTimer);
        return;
      }

      const target = event.target.closest('[data-mega-media]');
      if (!target) return;

      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => this.show(target.dataset.megaMedia), MegaMenuPanel.HOVER_DELAY);
    }

    onFocusIn(event) {
      const target = event.target.closest('[data-mega-media]');
      if (!target) return;
      clearTimeout(this.hoverTimer);
      this.show(target.dataset.megaMedia);
    }

    onToggle() {
      if (!this.details.open) this.reset();
    }

    show(key) {
      if (!this.groups || key === this.activeKey) return;

      const next =
        this.groups.find((group) => group.dataset.megaMediaGroup === key) ||
        this.groups.find((group) => group.dataset.megaMediaGroup === this.defaultKey);
      if (!next) return;

      this.groups.forEach((group) => {
        group.inert = group !== next;
      });
      this.activeKey = next.dataset.megaMediaGroup;
    }

    reset() {
      clearTimeout(this.hoverTimer);
      this.show(this.defaultKey);
    }
  }

  customElements.define('mega-menu-panel', MegaMenuPanel);
}
