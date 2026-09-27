if (!customElements.get('cart-upsell-slider')) {
  customElements.define(
    'cart-upsell-slider',
    class CartUpsellSlider extends HTMLElement {
      connectedCallback() {
        this.track = this.querySelector('[data-upsell-track]');
        this.prevButton = this.querySelector('[data-upsell-prev]');
        this.nextButton = this.querySelector('[data-upsell-next]');

        this.onClick = this.onClick.bind(this);
        this.onChange = this.onChange.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.onScroll = this.onScroll.bind(this);

        this.addEventListener('click', this.onClick);
        this.addEventListener('change', this.onChange);
        this.addEventListener('submit', this.onSubmit);
        this.track?.addEventListener('scroll', this.onScroll, { passive: true });

        this.updateArrows();
      }

      disconnectedCallback() {
        this.removeEventListener('click', this.onClick);
        this.removeEventListener('change', this.onChange);
        this.removeEventListener('submit', this.onSubmit);
        this.track?.removeEventListener('scroll', this.onScroll);
        cancelAnimationFrame(this.scrollRaf);
      }

      /* ---- Slider ---- */

      onClick(event) {
        if (event.target.closest('[data-upsell-prev]')) this.scrollBySlide(-1);
        if (event.target.closest('[data-upsell-next]')) this.scrollBySlide(1);
      }

      scrollBySlide(direction) {
        if (!this.track) return;
        const slide = this.track.firstElementChild;
        const gap = parseFloat(getComputedStyle(this.track).columnGap) || 0;
        const step = slide ? slide.getBoundingClientRect().width + gap : this.track.clientWidth;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.track.scrollBy({ left: direction * step, behavior: reduceMotion ? 'auto' : 'smooth' });
      }

      onScroll() {
        cancelAnimationFrame(this.scrollRaf);
        this.scrollRaf = requestAnimationFrame(() => this.updateArrows());
      }

      updateArrows() {
        if (!this.track || !this.prevButton || !this.nextButton) return;
        const maxScroll = this.track.scrollWidth - this.track.clientWidth;
        const position = Math.abs(this.track.scrollLeft);
        this.prevButton.toggleAttribute('disabled', position <= 1);
        this.nextButton.toggleAttribute('disabled', position >= maxScroll - 1);
      }

      /* ---- Variant selection: swap the displayed price ---- */

      onChange(event) {
        const select = event.target.closest('[data-upsell-variant]');
        if (!select) return;

        const card = select.closest('[data-upsell-form]');
        const option = select.options[select.selectedIndex];
        const priceEl = card.querySelector('[data-upsell-price]');
        const compareEl = card.querySelector('[data-upsell-compare]');

        if (priceEl && option.dataset.price) priceEl.textContent = option.dataset.price;
        if (compareEl) {
          compareEl.hidden = !option.dataset.compare;
          if (option.dataset.compare) {
            compareEl.querySelector('[data-upsell-compare-amount]').textContent = option.dataset.compare;
          }
        }
      }

      /* ---- Add to cart ---- */

      onSubmit(event) {
        const form = event.target.closest('[data-upsell-form]');
        if (!form) return;
        event.preventDefault();

        const button = form.querySelector('[data-upsell-add]');
        if (button.getAttribute('aria-disabled') === 'true') return;

        const errorEl = form.querySelector('[data-upsell-error]');
        const spinner = button.querySelector('.loading__spinner');
        errorEl.hidden = true;
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('loading');
        spinner?.classList.remove('hidden');

        const cart = this.closest('cart-drawer');
        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(form);
        if (cart && cart.getSectionsToRender) {
          formData.append(
            'sections',
            cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              errorEl.textContent = response.description || response.message;
              errorEl.hidden = false;
              return;
            }

            if (typeof publish !== 'undefined' && typeof PUB_SUB_EVENTS !== 'undefined') {
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'cart-upsell-slider',
                productVariantId: formData.get('id'),
                cartData: response,
              });
            }

            // Re-renders the whole drawer (this element included) with fresh markup.
            if (cart && cart.renderContents) cart.renderContents(response);
          })
          .catch((e) => {
            console.error(e);
            errorEl.textContent = window.cartStrings?.error || 'Something went wrong. Please try again.';
            errorEl.hidden = false;
          })
          .finally(() => {
            // On success this node is replaced; this only matters on error.
            button.removeAttribute('aria-disabled');
            button.classList.remove('loading');
            spinner?.classList.add('hidden');
          });
      }
    }
  );
}
