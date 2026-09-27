if (!customElements.get('free-shipping-bar')) {
  customElements.define(
    'free-shipping-bar',
    class FreeShippingBar extends HTMLElement {
      static storageKey = 'free-shipping-bar-progress';

      connectedCallback() {
        const to = Number(this.dataset.progress) || 0;
        let from = to;

        try {
          const saved = sessionStorage.getItem(FreeShippingBar.storageKey);
          if (saved !== null) from = Number(saved) || 0;
          sessionStorage.setItem(FreeShippingBar.storageKey, to);
        } catch (e) {
          return;
        }

        if (from === to) return;

        // The cart re-renders this element with its final value; start it from
        // the previous value so the fill animates instead of jumping.
        this.style.setProperty('--fsb-progress', from);
        this.frame = requestAnimationFrame(() => {
          this.frame = requestAnimationFrame(() => this.style.setProperty('--fsb-progress', to));
        });
      }

      disconnectedCallback() {
        cancelAnimationFrame(this.frame);
      }
    }
  );
}
