/* product-extras: "Add-on products" block (snippets/product-add-ons.liquid).
   Each card has its own Add to cart button; the main product form is not involved. */
if (!customElements.get('product-add-ons')) {
  customElements.define(
    'product-add-ons',
    class ProductAddOns extends HTMLElement {
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
          this.config = JSON.parse(this.querySelector('[data-add-ons-config]').textContent);
        } catch (e) {
          return;
        }

        this.initialized = true;
        this.extras = window.ProductFormExtras;
        this.status = this.querySelector('[data-status]');
        this.cards = Array.from(this.querySelectorAll('[data-add-on]')).map((el) => this.initCard(el));

        this.abortController = new AbortController();
        const { signal } = this.abortController;
        this.addEventListener('change', this.onChange.bind(this), { signal });
        this.addEventListener('click', this.onClick.bind(this), { signal });
        document.addEventListener(
          'shopify:block:select',
          (event) => {
            if (event.detail.blockId === this.dataset.blockId) this.scrollIntoView({ block: 'nearest' });
          },
          { signal }
        );

        if (this.config.sync && typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          this.unsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => this.onMainVariantChange(data));
        }
        if (this.config.sync) this.syncOptions(this.config.mainVariantOptions);
      }

      disconnectedCallback() {
        this.abortController?.abort();
        this.unsubscribe?.();
        this.initialized = false;
      }

      initCard(el) {
        let variants = [];
        let optionNames = [];
        try {
          variants = JSON.parse(el.querySelector('[data-variants]').textContent);
          optionNames = JSON.parse(el.dataset.optionNames || '[]');
        } catch (e) {}

        const card = {
          el,
          variants,
          optionNames,
          variant: variants.find((variant) => variant.id === Number(el.dataset.variantId)) || variants[0],
          button: el.querySelector('[data-add-on-button]'),
          combined: el.querySelector('[data-variant-select]'),
          selects: Array.from(el.querySelectorAll('[data-option-index]')),
        };

        // Separate selects: disable values that no available variant has.
        card.selects.forEach((select, index) => {
          Array.from(select.options).forEach((option) => {
            option.disabled = !variants.some((variant) => variant.available && variant.options[index] === option.value);
          });
        });
        return card;
      }

      cardFor(target) {
        return this.cards.find((card) => card.el.contains(target));
      }

      onChange(event) {
        const card = this.cardFor(event.target);
        if (!card || !(event.target === card.combined || card.selects.includes(event.target))) return;
        this.resolveVariant(card);
        this.showStatus('');
      }

      onClick(event) {
        const button = event.target.closest('[data-add-on-button]');
        const card = button && this.cardFor(button);
        if (card) this.addToCart(card);
      }

      resolveVariant(card) {
        if (card.combined) {
          card.variant = card.variants.find((variant) => variant.id === Number(card.combined.value));
        } else {
          const values = card.selects.map((select) => select.value);
          card.variant = card.variants.find((variant) => variant.options.every((value, i) => value === values[i]));
        }
        this.renderCard(card);
      }

      renderCard(card) {
        const { variant, button } = card;
        const available = Boolean(variant?.available);
        card.el.classList.toggle('add-on-card--unavailable', !available);
        if (button) {
          button.disabled = !available;
          button.querySelector('span').textContent = available ? this.config.strings.add : this.config.strings.soldOut;
        }
        if (!variant) return;

        card.el.dataset.variantId = variant.id;
        const price = card.el.querySelector('.price');
        if (!price) return;
        const format = (cents) => this.extras.formatMoney(cents, this.config.moneyFormat);
        price.classList.toggle('price--on-sale', variant.compare_at_price > variant.price);
        price.classList.toggle('price--sold-out', !available);
        price
          .querySelectorAll('.price__regular .price-item--regular, .price__sale .price-item--sale')
          .forEach((node) => (node.textContent = format(variant.price)));
        const compare = price.querySelector('.price__sale s.price-item--regular');
        if (compare && variant.compare_at_price) compare.textContent = format(variant.compare_at_price);
      }

      onMainVariantChange(data) {
        const productInfo = this.closest('product-info');
        if (!data?.variant || (productInfo && productInfo.sectionId !== data.sectionId)) return;
        this.syncOptions(data.variant.options);
      }

      // Pre-select the add-on value matching the main product's same-named option (e.g. Size).
      syncOptions(mainValues) {
        if (!Array.isArray(mainValues)) return;
        const mainNames = (this.config.mainOptions || []).map((name) => name.toLowerCase());

        this.cards.forEach((card) => {
          const wanted = card.optionNames
            .map((name, index) => {
              const mainIndex = mainNames.indexOf(name.toLowerCase());
              return mainIndex === -1 ? null : { index, value: String(mainValues[mainIndex]).toLowerCase() };
            })
            .filter(Boolean);
          if (!wanted.length) return;

          if (card.combined) {
            const match = card.variants.find(
              (variant) =>
                variant.available && wanted.every(({ index, value }) => variant.options[index].toLowerCase() === value)
            );
            if (!match) return;
            card.combined.value = match.id;
          } else {
            let changed = false;
            wanted.forEach(({ index, value }) => {
              const select = card.selects[index];
              const option = select && Array.from(select.options).find((opt) => opt.value.toLowerCase() === value);
              if (option && !option.disabled) {
                select.value = option.value;
                changed = true;
              }
            });
            if (!changed) return;
          }
          this.resolveVariant(card);
        });
      }

      async addToCart(card) {
        const { button } = card;
        if (!card.variant?.available || button.getAttribute('aria-disabled') === 'true') return;

        const label = button.querySelector('span');
        const spinner = button.querySelector('.loading__spinner');
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('loading');
        spinner?.classList.remove('hidden');
        this.showStatus('');

        const item = {
          id: card.variant.id,
          quantity: this.config.quantityMode === 'match' ? this.extras.mainQuantity(this.config.formId) : 1,
        };
        if (this.config.propertyFor) item.properties = { _add_on_for: this.config.propertyFor };

        try {
          const response = await this.extras.addStandalone([item], button);
          if (response.status) {
            this.showStatus(response.description || response.message);
          } else {
            label.textContent = this.config.strings.added;
            setTimeout(() => (label.textContent = this.config.strings.add), 2000);
          }
        } catch (error) {
          console.error(error);
        } finally {
          button.removeAttribute('aria-disabled');
          button.classList.remove('loading');
          spinner?.classList.add('hidden');
        }
      }

      showStatus(message) {
        if (this.status) this.status.textContent = message ? this.config.strings.error.replace('[message]', message) : '';
      }
    }
  );
}
