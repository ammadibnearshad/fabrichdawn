/* product-extras: "Gift wrap" block (snippets/product-gift-wrap.liquid).
   Registers the gift wrap line with ProductFormExtras so Dawn's Add to Cart includes it, and marks
   the main product line with a visible "Gift wrap" property. */
if (!customElements.get('product-gift-wrap')) {
  customElements.define(
    'product-gift-wrap',
    class ProductGiftWrap extends HTMLElement {
      connectedCallback() {
        if (this.initialized) return;
        // Scripts can run out of order (theme editor / quick add): wait for the shared helper.
        if (!window.ProductFormExtras) {
          document.addEventListener('product-extras:ready', () => this.isConnected && this.connectedCallback(), {
            once: true,
          });
          return;
        }

        try {
          this.config = JSON.parse(this.querySelector('[data-gift-wrap-config]').textContent);
        } catch (e) {
          return;
        }
        this.initialized = true;
        this.extras = window.ProductFormExtras;
        this.checkbox = this.querySelector('[data-gift-wrap-checkbox]');
        this.status = this.querySelector('[data-status]');
        this.message = this.querySelector('[data-message]');
        this.to = this.querySelector('[data-to]');
        this.from = this.querySelector('[data-from]');
        this.count = this.querySelector('[data-count]');
        this.inCart = false;
        this.cartChecked = false;
        this.variant = this.config.variants.find((variant) => variant.id === this.selectedVariantId()) ||
          this.config.variants.find((variant) => variant.available);

        this.abortController = new AbortController();
        const { signal } = this.abortController;
        this.addEventListener('change', this.onChange.bind(this), { signal });
        this.message?.addEventListener('input', () => this.updateCount(), { signal });
        document.addEventListener(
          'shopify:block:select',
          (event) => {
            if (event.detail.blockId === this.dataset.blockId) this.scrollIntoView({ block: 'nearest' });
          },
          { signal }
        );

        // Once per order: check the cart lazily, the first time the block is seen, and after cart changes.
        if (this.config.quantityMode === 'once') {
          this.observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            this.observer.disconnect();
            this.checkCart();
          });
          this.observer.observe(this);

          if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
            this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, () => {
              if (this.cartChecked) this.checkCart(true);
            });
          }
        }

        this.unregister = this.extras.register(this.config.formId, {
          order: 20,
          checkoutBehavior: this.config.checkoutBehavior,
          checkoutNote: this.config.checkoutNote,
          hasSelection: () => this.isActive(),
          getItems: (quantity) => (this.addsWrapLine() ? [this.line(quantity)] : []),
          getMainProperties: () => (this.isActive() ? this.mainProperties() : {}),
          onError: (message) => this.showStatus(this.config.strings.error.replace('[message]', message)),
        });

        this.updateCount();
      }

      disconnectedCallback() {
        this.abortController?.abort();
        this.observer?.disconnect();
        this.unsubscribe?.();
        this.unregister?.();
        this.initialized = false;
      }

      isActive() {
        return Boolean(this.checkbox.checked && this.variant?.available);
      }

      // Once per order: when the wrap is already in the cart, only the main line gets marked.
      addsWrapLine() {
        return this.isActive() && !(this.config.quantityMode === 'once' && this.inCart);
      }

      messagesOnMain() {
        return this.config.messageTarget === 'main' || !this.addsWrapLine();
      }

      mainProperties() {
        const properties = this.messagesOnMain() ? this.messageProperties() : {};
        const { name } = this.config.mainProperty;
        if (name) {
          properties[name] = this.config.variants.length > 1 ? this.variant.title : this.config.strings.yes;
        }
        return properties;
      }

      selectedVariantId() {
        const input = this.querySelector('[data-wrap-variant]:checked, select[data-wrap-variant]');
        return input ? Number(input.value) : null;
      }

      line(mainQuantity) {
        const item = { id: this.variant.id, quantity: this.config.quantityMode === 'match' ? mainQuantity : 1 };
        const properties = this.messagesOnMain() ? {} : this.messageProperties();
        if (this.config.propertyFor) properties._gift_wrap_for = this.config.propertyFor;
        if (Object.keys(properties).length) item.properties = properties;
        return item;
      }

      messageProperties() {
        const { strings } = this.config;
        const properties = {};
        const add = (key, field) => {
          const value = field?.value.trim();
          if (value) properties[key] = value;
        };
        add(strings.message, this.message);
        add(strings.to, this.to);
        add(strings.from, this.from);
        return properties;
      }

      onChange(event) {
        if (event.target.matches('[data-wrap-variant]')) {
          this.variant = this.config.variants.find((variant) => variant.id === Number(event.target.value));
          this.renderPrice();
        }
        if (event.target === this.checkbox) {
          this.showStatus('');
          if (this.checkbox.checked && this.config.quantityMode === 'once' && !this.cartChecked) this.checkCart();
        }
        this.extras.refresh(this.config.formId);
      }

      renderPrice() {
        if (!this.variant) return;
        const priceText =
          this.variant.price === 0
            ? this.config.strings.free
            : this.extras.formatMoney(this.variant.price, this.config.moneyFormat);
        const fill = (text) => (text || '').replace(/\[price\]/g, priceText);

        this.querySelector('[data-price]').textContent = priceText;
        this.querySelector('[data-title]').textContent = fill(this.config.title);
        const description = this.querySelector('[data-description]');
        if (description) description.textContent = fill(this.config.description);
      }

      async checkCart(fresh = false) {
        try {
          const cart = await this.extras.getCart(fresh);
          this.cartChecked = true;
          this.inCart = cart.items.some((item) => item.product_id === this.config.productId);
        } catch (error) {
          console.error(error);
          return;
        }

        this.classList.toggle('gift-wrap--in-cart', this.inCart);
        // Keep any add-to-cart error visible; only swap the "already added" message.
        if (this.inCart) this.showStatus(this.config.strings.alreadyAdded);
        else if (this.status?.textContent === this.config.strings.alreadyAdded) this.showStatus('');
        this.extras.refresh(this.config.formId);
      }

      updateCount() {
        if (this.count && this.message) this.count.textContent = this.message.value.length;
      }

      showStatus(message) {
        if (this.status) this.status.textContent = message;
      }
    }
  );
}
