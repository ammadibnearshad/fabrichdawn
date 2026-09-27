if (!customElements.get('cart-expiry-timer')) {
  customElements.define(
    'cart-expiry-timer',
    class CartExpiryTimer extends HTMLElement {
      static storageKey = 'dcart-expiry-end';

      connectedCallback() {
        this.display = this.querySelector('[data-timer-display]');
        if (!this.display) return;
        this.duration = parseInt(this.dataset.duration, 10) || 600;

        let saved = 0;
        try {
          saved = parseInt(sessionStorage.getItem(CartExpiryTimer.storageKey), 10);
        } catch (e) {}
        this.end = saved && saved > Date.now() ? saved : this.resetEnd();

        this.tick = this.tick.bind(this);
        this.tick();
        this.interval = setInterval(this.tick, 1000);
      }

      disconnectedCallback() {
        clearInterval(this.interval);
      }

      resetEnd() {
        const end = Date.now() + this.duration * 1000;
        try {
          sessionStorage.setItem(CartExpiryTimer.storageKey, end);
        } catch (e) {}
        return end;
      }

      tick() {
        let remaining = Math.round((this.end - Date.now()) / 1000);
        if (remaining <= 0) {
          this.end = this.resetEnd();
          remaining = this.duration;
        }
        const m = String(Math.floor(remaining / 60)).padStart(2, '0');
        const s = String(remaining % 60).padStart(2, '0');
        this.display.textContent = `${m}:${s}`;
      }
    }
  );
}
