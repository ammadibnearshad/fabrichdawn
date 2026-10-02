/* product-extras: lets product page blocks (add-ons, gift wrap) add extra lines together with
   the main product in Dawn's single Add to Cart request. assets/product-form.js calls
   collect() + add(); everything else here is shared by the blocks. */
if (!window.ProductFormExtras) {
  window.ProductFormExtras = (() => {
    const registry = new Map(); // formId -> Set of providers
    let cartPromise = null;

    // Add ?extras_debug=1 to the URL to log what is collected and sent.
    const debug = /[?&]extras_debug=1/.test(window.location.search);
    const log = (...args) => debug && console.info('[product-extras]', ...args);

    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, () => {
        cartPromise = null;
      });
    }

    // Documented Ajax endpoint (routes.cart_add_url is '/cart/add', locale-aware).
    const cartAddUrl = () => `${routes.cart_add_url}.js`;

    const jsonPost = (url, body) => {
      const config = fetchConfig('json');
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
      config.body = JSON.stringify(body);
      return fetch(url, config).then((response) => response.json());
    };

    const variantQuantity = (cart, variantId) =>
      cart.items.filter((item) => item.variant_id === variantId).reduce((sum, item) => sum + item.quantity, 0);

    const getCartElement = () => document.querySelector('cart-notification') || document.querySelector('cart-drawer');

    // Main line from Dawn's FormData: id, quantity, selling plan and string properties.
    const mainItemFrom = (formData) => {
      const item = { id: Number(formData.get('id')), quantity: parseInt(formData.get('quantity')) || 1 };
      const sellingPlan = formData.get('selling_plan');
      if (sellingPlan) item.selling_plan = Number(sellingPlan);

      const properties = {};
      for (const [name, value] of formData.entries()) {
        const match = name.match(/^properties\[(.+)\]$/);
        if (match && typeof value === 'string' && value !== '') properties[match[1]] = value;
      }
      if (Object.keys(properties).length) item.properties = properties;
      return item;
    };

    // Dawn's cart drawer / notification read `id` and `key` from a single-line add response.
    const normalize = (response, mainId, sections) => {
      const line = response.items?.find((item) => item.variant_id === mainId) || response.items?.[0] || {};
      return { ...line, id: line.variant_id ?? line.id, sections: response.sections ?? sections };
    };

    const providersFor = (formId) => Array.from(registry.get(formId) || []).sort((a, b) => a.order - b.order);

    const notifyError = (providers, message) => providers.forEach((provider) => provider.onError?.(message));

    return {
      register(formId, provider) {
        if (!registry.has(formId)) registry.set(formId, new Set());
        registry.get(formId).add(provider);
        log('registered', provider.name || 'provider', 'for form', formId);
        this.refresh(formId);
        return () => {
          registry.get(formId)?.delete(provider);
          this.refresh(formId);
        };
      },

      // Returns { items, mainProperties, providers } or null when nothing extra is selected.
      collect(form, formData) {
        const providers = providersFor(form.id).filter((provider) => provider.hasSelection());
        log('submit', form.id, '| registered:', providersFor(form.id).length, '| selected:', providers.length);
        if (!providers.length) return null;

        const hasFile = Array.from(formData.values()).some((value) => value instanceof File && value.size > 0);
        if (hasFile) {
          console.warn('product-extras: file upload properties detected, extras skipped');
          return null;
        }

        const quantity = parseInt(formData.get('quantity')) || 1;
        const items = providers.flatMap((provider) => provider.getItems(quantity));
        const mainProperties = Object.assign({}, ...providers.map((provider) => provider.getMainProperties?.() || {}));
        log('extra lines', items, '| main properties', mainProperties);
        if (!items.length && !Object.keys(mainProperties).length) return null;
        return { items, mainProperties, providers };
      },

      async add(form, formData, { items, mainProperties, providers }) {
        const main = mainItemFrom(formData);
        if (Object.keys(mainProperties).length) main.properties = { ...main.properties, ...mainProperties };

        const sections = formData.get('sections');
        const sectionsUrl = formData.get('sections_url');
        const withSections = (body) => (sections ? { ...body, sections, sections_url: sectionsUrl } : body);

        // Shopify lists newest lines first: send extras reversed and the main product last so it
        // ends up on top with its extras below in display order.
        const before = variantQuantity(await this.getCart(true), main.id);
        const body = withSections({ items: [...items].reverse().concat(main) });
        log('POST', cartAddUrl(), body);
        const response = await jsonPost(cartAddUrl(), body);
        log('response', response.status ? response : response.items);

        if (!response.status) {
          const normalized = normalize(response, main.id, null);
          document.dispatchEvent(
            new CustomEvent('product-extras:added', { detail: { formId: form.id, response: normalized } })
          );
          return normalized;
        }

        // Combined add failed: never lose the main product.
        notifyError(providers, response.description || response.message);
        const cart = await this.getCart(true);
        if (variantQuantity(cart, main.id) >= before + main.quantity) {
          const line = cart.items.find((item) => item.variant_id === main.id) || {};
          const rendered = sections
            ? await fetch(`${sectionsUrl}?sections=${sections}`).then((res) => res.json())
            : null;
          return { ...line, id: main.id, sections: rendered };
        }
        return jsonPost(cartAddUrl(), withSections({ items: [main] })).then((retry) =>
          retry.status ? retry : normalize(retry, main.id, null)
        );
      },

      // Standalone add (e.g. an add-on's own "Add" button); opens Dawn's drawer / notification.
      async addStandalone(items, sourceElement) {
        const cart = getCartElement();
        const body = { items };
        if (cart) {
          body.sections = cart.getSectionsToRender().map((section) => section.id);
          body.sections_url = window.location.pathname;
          cart.setActiveElement(sourceElement);
        }

        const response = await jsonPost(cartAddUrl(), body);
        if (response.status) return response;

        const normalized = normalize(response, items[0].id, null);
        if (!cart) {
          window.location = window.routes.cart_url;
          return normalized;
        }
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'product-extras', cartData: normalized });
        cart.classList.remove('is-empty');
        cart.renderContents(normalized);
        return normalized;
      },

      getCart(fresh = false) {
        if (fresh || !cartPromise) {
          cartPromise = fetch(`${routes.cart_url}.js`)
            .then((response) => response.json())
            .catch((error) => {
              cartPromise = null;
              throw error;
            });
        }
        return cartPromise;
      },

      mainQuantity(formId) {
        const form = document.getElementById(formId);
        return form ? parseInt(new FormData(form).get('quantity')) || 1 : 1;
      },

      // Dynamic checkout buttons skip the form, so they can't carry extras: hide or annotate them.
      refresh(formId) {
        const form = document.getElementById(formId);
        const paymentButton = form?.querySelector('.shopify-payment-button');
        if (!paymentButton) return;

        let mode = 'none';
        let note = '';
        providersFor(formId)
          .filter((provider) => provider.hasSelection())
          .forEach((provider) => {
            if (provider.checkoutBehavior === 'hide') mode = 'hide';
            else if (provider.checkoutBehavior === 'note' && mode !== 'hide') {
              mode = 'note';
              note = note || provider.checkoutNote;
            }
          });

        paymentButton.hidden = mode === 'hide';
        let noteElement = form.querySelector('.product-form__extras-note');
        if (mode === 'note' && note) {
          if (!noteElement) {
            noteElement = document.createElement('p');
            noteElement.className = 'product-form__extras-note caption-large';
            paymentButton.after(noteElement);
          }
          noteElement.textContent = note;
        } else {
          noteElement?.remove();
        }
      },

      formatMoney(cents, format) {
        return (format || '{{amount}}')
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
      },
    };
  })();
}

// Block scripts may run before this file (theme editor / quick add insert scripts without order).
document.dispatchEvent(new CustomEvent('product-extras:ready'));
