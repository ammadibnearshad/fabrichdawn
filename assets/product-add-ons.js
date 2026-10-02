/* product-extras: "Add-on products" block (snippets/product-add-ons.liquid).
   Registers checked add-ons with ProductFormExtras so Dawn's Add to Cart includes them. */
if (!customElements.get('product-add-ons')) {
  customElements.define(
    'product-add-ons',
    class ProductAddOns extends HTMLElement {
      connectedCallback() {
        try {
          this.config = JSON.parse(this.querySelector('[data-add-ons-config]').textContent);
        } catch (e) {
          return;
        }
        if (!window.ProductFormExtras) return;

        this.extras = window.ProductFormExtras;
        this.mainPrice = this.config.mainPrice;
        this.status = this.querySelector('[data-status]');
        this.totalLine = this.querySelector('[data-total-line]');
        this.cards = Array.from(this.querySelectorAll('[data-add-on]')).map((el) => this.initCard(el));

        this.abortController = new AbortController();
        const { signal } = this.abortController;
        this.addEventListener('change', this.onChange.bind(this), { signal });
        this.addEventListener('click', this.onClick.bind(this), { signal });
        document.addEventListener(
          'change',
          (event) => {
            if (event.target.name === 'quantity' && event.target.form?.id === this.config.formId) this.updateTotal();
          },
          { signal }
        );
        document.addEventListener(
          'shopify:block:select',
          (event) => {
            if (event.detail.blockId === this.dataset.blockId) this.scrollIntoView({ block: 'nearest' });
          },
          { signal }
        );

        this.unsubscribers = [];
        if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          this.unsubscribers.push(
            subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => this.onMainVariantChange(data)),
            subscribe(PUB_SUB_EVENTS.quantityUpdate, () => this.updateTotal())
          );
        }

        this.unregister = this.extras.register(this.config.formId, {
          order: 10,
          checkoutBehavior: this.config.checkoutBehavior,
          checkoutNote: this.config.checkoutNote,
          hasSelection: () => this.selected().length > 0,
          getItems: (quantity) => this.selected().map((card) => this.lineFor(card, quantity)),
          onError: (message) => this.showStatus(message),
        });

        if (this.config.sync) this.syncOptions(this.config.mainVariantOptions);
        this.updateTotal();
      }

      disconnectedCallback() {
        this.abortController?.abort();
        this.unsubscribers?.forEach((unsubscribe) => unsubscribe());
        this.unregister?.();
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
          checkbox: el.querySelector('[data-add-on-checkbox]'),
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

      selected() {
        return this.cards.filter((card) => card.checkbox?.checked && card.variant?.available);
      }

      lineFor(card, mainQuantity) {
        const item = { id: card.variant.id, quantity: this.config.quantityMode === 'match' ? mainQuantity : 1 };
        if (this.config.propertyFor) item.properties = { _add_on_for: this.config.propertyFor };
        return item;
      }

      onChange(event) {
        const card = this.cardFor(event.target);
        if (!card) return;
        if (event.target === card.combined || card.selects.includes(event.target)) this.resolveVariant(card);
        this.showStatus('');
        this.extras.refresh(this.config.formId);
        this.updateTotal();
      }

      onClick(event) {
        const card = this.cardFor(event.target);
        if (!card) return;

        if (event.target.closest('[data-add-on-button]')) {
          this.addSingle(card);
          return;
        }

        // Whole card toggles the checkbox, except its own interactive elements.
        if (!card.checkbox || card.checkbox.disabled || event.target.closest('a, button, select, input, label')) return;
        card.checkbox.click();
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
        const { variant } = card;
        const available = Boolean(variant?.available);
        card.el.classList.toggle('add-on-card--unavailable', !available);
        if (card.checkbox) {
          card.checkbox.disabled = !available;
          if (!available) card.checkbox.checked = false;
        }
        if (card.button) card.button.disabled = !available;
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
        this.mainPrice = data.variant.price;
        if (this.config.sync) this.syncOptions(data.variant.options);
        this.updateTotal();
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
        this.extras.refresh(this.config.formId);
      }

      async addSingle(card) {
        const { button } = card;
        if (!card.variant?.available || button.getAttribute('aria-disabled') === 'true') return;

        const spinner = button.querySelector('.loading__spinner');
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('loading');
        spinner?.classList.remove('hidden');
        this.showStatus('');

        try {
          const quantity = this.extras.mainQuantity(this.config.formId);
          const response = await this.extras.addStandalone([this.lineFor(card, quantity)], button);
          if (response.status) this.showStatus(response.description || response.message);
        } catch (error) {
          console.error(error);
        } finally {
          button.removeAttribute('aria-disabled');
          button.classList.remove('loading');
          spinner?.classList.add('hidden');
        }
      }

      updateTotal() {
        if (!this.totalLine) return;
        const selected = this.selected();
        this.totalLine.hidden = selected.length === 0;
        if (!selected.length) return;

        const quantity = this.extras.mainQuantity(this.config.formId);
        const addOnQuantity = this.config.quantityMode === 'match' ? quantity : 1;
        const total = selected.reduce((sum, card) => sum + card.variant.price * addOnQuantity, this.mainPrice * quantity);
        this.totalLine.querySelector('[data-total]').textContent = this.extras.formatMoney(total, this.config.moneyFormat);
      }

      showStatus(message) {
        if (this.status) this.status.textContent = message ? this.config.strings.error.replace('[message]', message) : '';
      }
    }
  );
}
