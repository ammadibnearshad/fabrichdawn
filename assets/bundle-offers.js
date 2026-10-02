/* bundle-offers: quantity-break tier selector (snippets/bundle-offers.liquid).
   Quantity is submitted by the checked radio itself; this only refreshes prices
   on variant change, announces the selection and handles theme editor selects. */
if (!customElements.get('bundle-offers')) {
  customElements.define(
    'bundle-offers',
    class BundleOffers extends HTMLElement {
      connectedCallback() {
        try {
          this.config = JSON.parse(this.querySelector('[data-bundle-config]').textContent);
        } catch (e) {
          return;
        }

        this.tiers = Array.from(this.querySelectorAll('.bundle-tier'));
        this.live = this.querySelector('[data-bundle-live]');
        this.onChange = this.onChange.bind(this);
        this.onBlockSelect = this.onBlockSelect.bind(this);

        this.addEventListener('change', this.onChange);
        document.addEventListener('shopify:block:select', this.onBlockSelect);

        if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          this.unsubscribe = subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => {
            const productInfo = this.closest('product-info');
            if (!data?.variant || (productInfo && productInfo.sectionId !== data.sectionId)) return;
            this.update(data.variant);
          });
        }

        // Fixed-amount discounts are entered in store currency; convert for Markets.
        if (this.rate() !== 1) this.update(this.config.variant);

        this.ensureVisibleSelection();
      }

      disconnectedCallback() {
        this.removeEventListener('change', this.onChange);
        document.removeEventListener('shopify:block:select', this.onBlockSelect);
        this.unsubscribe?.();
      }

      rate() {
        return parseFloat(window.Shopify?.currency?.rate) || 1;
      }

      // A tier hidden on this device must not stay checked, or its quantity would be submitted unseen.
      ensureVisibleSelection() {
        const checked = this.querySelector('.bundle-tier__input:checked');
        if (checked && checked.closest('.bundle-tier').offsetParent !== null) return;
        const firstVisible = this.tiers.find((tier) => tier.offsetParent !== null);
        if (firstVisible) firstVisible.querySelector('.bundle-tier__input').checked = true;
      }

      update(variant) {
        const { savingsFormat, strings, tiers } = this.config;
        const price = variant.price;
        // Bundle discount only: reference is the selling price, never compare-at.
        const compareUnit = price;
        const fixedRate = 100 * this.rate();

        this.tiers.forEach((el, i) => {
          const tier = tiers[i];
          if (!tier) return;
          const { q, type, value } = tier;
          const fixed = Math.round(value * fixedRate);

          let total = price * q;
          if (type === 'percent') total = Math.round((total * Math.max(100 - value, 0)) / 100);
          else if (type === 'fixed_total') total -= fixed;
          else if (type === 'fixed_item') total = Math.max(price - fixed, 0) * q;
          else if (type === 'bundle_price') total = fixed;
          total = Math.max(total, 0);

          const compare = compareUnit * q;
          const saved = Math.max(compare - total, 0);
          const percent = compare ? Math.round((saved * 100) / compare) : 0;
          const amount = this.formatMoney(saved);
          const fill = (text) =>
            (text || '')
              .replace(/\[quantity\]/g, q)
              .replace(/\[amount\]/g, amount)
              .replace(/\[percent\]/g, percent);

          this.setText(el, '[data-title]', fill(tier.title));
          this.setText(el, '[data-subtitle]', fill(tier.subtitle));
          this.setText(el, '[data-price]', this.formatMoney(total));
          this.setText(el, '[data-compare-value]', this.formatMoney(compare));
          el.querySelector('[data-compare]')?.toggleAttribute('hidden', compare <= total);

          const savings = el.querySelector('[data-savings]');
          if (savings) {
            savings.textContent = fill(savingsFormat === 'amount' ? strings.saveAmount : strings.savePercent);
            savings.toggleAttribute('hidden', saved === 0);
          }

          const img = el.querySelector('.bundle-tier__img--variant');
          const src = variant.featured_image?.src;
          if (img && src) {
            img.removeAttribute('srcset');
            img.src = `${src}${src.includes('?') ? '&' : '?'}width=${img.getAttribute('width') * 2}`;
          }
        });
      }

      setText(root, selector, text) {
        const node = root.querySelector(selector);
        if (node) node.textContent = text;
      }

      onChange(event) {
        if (!event.target.classList.contains('bundle-tier__input') || !this.live) return;
        const tier = event.target.closest('.bundle-tier');
        this.live.textContent = this.config.strings.selected
          .replace('[title]', tier.querySelector('[data-title]')?.textContent.trim() || '')
          .replace('[price]', tier.querySelector('[data-price]')?.textContent.trim() || '');
      }

      onBlockSelect(event) {
        const tier = this.querySelector(`[data-block-id="${event.detail.blockId}"]`);
        if (!tier) return;
        tier.querySelector('.bundle-tier__input').checked = true;
        tier.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }

      formatMoney(cents) {
        const format = this.config.format || '{{amount}}';
        return format
          .replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
            const noDecimals = key.includes('no_decimals');
            let [thousands, decimal] = [',', '.'];
            if (key.includes('comma_separator')) [thousands, decimal] = ['.', ','];
            else if (key.includes('apostrophe')) [thousands, decimal] = ["'", '.'];
            else if (key.includes('period_and_space')) [thousands, decimal] = [' ', '.'];
            else if (key.includes('space_separator')) [thousands, decimal] = [' ', ','];

            const [whole, fraction] = (cents / 100).toFixed(noDecimals ? 0 : 2).split('.');
            return whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (fraction ? decimal + fraction : '');
          })
          .replace(/<[^>]*>/g, '');
      }
    }
  );
}
