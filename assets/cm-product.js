/*
  Cambridge product page behaviour.

  Loaded by sections/main-product.liquid only when one of the features below is
  switched on. The size chart modal needs no JavaScript here: it is built on
  Dawn's <modal-opener> / <modal-dialog> pair from global.js, so focus trap,
  Esc, outside-click and focus restore already work.

  Custom elements defined:
  - cm-sticky-atc   sticky add to cart bar, driven by Dawn's pub/sub
  - cm-size-guard   requires an explicit size choice before add to cart
  - cm-native-share device share sheet, shown only where supported
  - cm-gallery-dots  mobile gallery pagination, driven by Dawn's slider-component

  Every registration is guarded so theme-editor re-renders and Dawn's product
  swap (which replaces the whole <product-info>) never double-define anything.
*/

(function () {
  'use strict';

  // PUB_SUB_EVENTS is a top-level `const` in Dawn's constants.js, so it lives in
  // the global lexical scope rather than on `window`.
  const VARIANT_CHANGE =
    typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS.variantChange ? PUB_SUB_EVENTS.variantChange : 'variant-change';

  /* ------------------------------------------------------------ Sticky ATC */

  if (!customElements.get('cm-sticky-atc')) {
    customElements.define(
      'cm-sticky-atc',
      class CmStickyAtc extends HTMLElement {
        constructor() {
          super();
          this.observer = null;
          this.footerObserver = null;
          this.unsubscribe = null;
          this.anchorVisible = true;
          this.footerVisible = false;
        }

        connectedCallback() {
          this.sectionId = this.dataset.section;
          this.requireSize = this.dataset.requireSize === 'true';
          this.submitButton = this.querySelector('[data-cm-sticky-submit]');
          this.priceTarget = this.querySelector('[data-cm-sticky-price]');
          this.variantTarget = this.querySelector('[data-cm-sticky-variant]');

          this.mainSubmit = document.getElementById(`ProductSubmitButton-${this.sectionId}`);
          if (!this.mainSubmit) return;

          this.watchAnchor();
          this.watchFooter();

          this.unsubscribe =
            typeof window.subscribe === 'function'
              ? window.subscribe(VARIANT_CHANGE, this.onVariantChange.bind(this))
              : null;

          this.addEventListener('click', this.onClick);
        }

        disconnectedCallback() {
          this.observer?.disconnect();
          this.footerObserver?.disconnect();
          this.unsubscribe?.();
          this.removeEventListener('click', this.onClick);
        }

        watchAnchor() {
          this.observer = new IntersectionObserver(
            (entries) => {
              this.anchorVisible = entries[0].isIntersecting;
              this.render();
            },
            { rootMargin: '0px 0px -10% 0px' }
          );
          this.observer.observe(this.mainSubmit);
        }

        watchFooter() {
          const footer = document.querySelector('.footer, #shopify-section-footer');
          if (!footer) return;

          this.footerObserver = new IntersectionObserver((entries) => {
            this.footerVisible = entries[0].isIntersecting;
            this.render();
          });
          this.footerObserver.observe(footer);
        }

        render() {
          const shouldShow = !this.anchorVisible && !this.footerVisible;

          if (shouldShow) {
            this.hidden = false;
            // Let the element paint before transitioning it in.
            requestAnimationFrame(() => this.classList.add('is-visible'));
          } else {
            this.classList.remove('is-visible');
            this.hidden = true;
          }
        }

        onVariantChange(event) {
          const { sectionId, html, variant } = event.data || {};
          if (sectionId !== this.sectionId) return;

          const newPrice = html?.getElementById(`price-${sectionId}`);
          if (newPrice && this.priceTarget) this.priceTarget.innerHTML = newPrice.innerHTML;

          if (this.variantTarget) this.variantTarget.textContent = variant?.title ?? '';

          if (this.submitButton) {
            const soldOut = !variant || variant.available === false;
            this.submitButton.disabled = soldOut;
            const label = this.submitButton.querySelector('span');
            if (label && window.variantStrings) {
              label.textContent = soldOut ? window.variantStrings.soldOut : window.variantStrings.addToCart;
            }
          }
        }

        onClick = (event) => {
          if (!this.requireSize) return;
          if (!event.target.closest('[data-cm-sticky-submit]')) return;

          const guard = document.querySelector(`cm-size-guard[data-section="${this.sectionId}"]`);
          if (!guard || guard.hasSelection) return;

          // Nothing chosen yet: send the shopper to the picker instead of the cart.
          event.preventDefault();
          guard.showMessage();
          guard.scrollToPicker();
        };
      }
    );
  }

  /* ------------------------------------------------------------ Size guard */

  if (!customElements.get('cm-size-guard')) {
    customElements.define(
      'cm-size-guard',
      class CmSizeGuard extends HTMLElement {
        constructor() {
          super();
          this.hasSelection = false;
        }

        connectedCallback() {
          this.sectionId = this.dataset.section;
          this.optionName = (this.dataset.optionName || '').toLowerCase();
          this.errorEl = this.querySelector('[data-cm-guard-error]');
          this.submitButton = this.querySelector('.product-form__submit');
          this.variantSelects = document.getElementById(`variant-selects-${this.sectionId}`);

          if (!this.submitButton || !this.variantSelects) return;

          this.lock();

          this.onOptionChange = this.onOptionChange.bind(this);
          this.onSubmitAttempt = this.onSubmitAttempt.bind(this);

          this.variantSelects.addEventListener('change', this.onOptionChange);
          this.addEventListener('click', this.onSubmitAttempt, true);
        }

        disconnectedCallback() {
          this.variantSelects?.removeEventListener('change', this.onOptionChange);
          this.removeEventListener('click', this.onSubmitAttempt, true);
        }

        get picker() {
          const groups = this.variantSelects?.querySelectorAll('fieldset, .product-form__input--dropdown') || [];
          return Array.from(groups).find((group) => {
            const input = group.querySelector('input, select');
            const name = input?.dataset.optionName || group.querySelector('legend, label')?.textContent || '';
            return name.trim().toLowerCase() === this.optionName;
          });
        }

        lock() {
          this.submitButton.setAttribute('aria-disabled', 'true');
          this.submitButton.classList.add('cm-size-guard__locked');
        }

        unlock() {
          this.hasSelection = true;
          this.submitButton.removeAttribute('aria-disabled');
          this.submitButton.classList.remove('cm-size-guard__locked');
          this.hideMessage();
        }

        onOptionChange(event) {
          const name = (event.target.dataset?.optionName || '').toLowerCase();
          // Any deliberate choice in the picker counts, including a colour swap.
          if (!this.optionName || !name || name === this.optionName) this.unlock();
        }

        onSubmitAttempt(event) {
          if (this.hasSelection) return;
          if (!event.target.closest('.product-form__submit')) return;

          event.preventDefault();
          event.stopPropagation();
          this.showMessage();
          this.scrollToPicker();
        }

        showMessage() {
          if (!this.errorEl) return;
          this.errorEl.hidden = false;
        }

        hideMessage() {
          if (!this.errorEl) return;
          this.errorEl.hidden = true;
        }

        scrollToPicker() {
          const picker = this.picker;
          if (!picker) return;

          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          picker.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
          picker.querySelector('input, select')?.focus({ preventScroll: true });
        }
      }
    );
  }

  /* ---------------------------------------------------------- Native share */

  if (!customElements.get('cm-native-share')) {
    customElements.define(
      'cm-native-share',
      class CmNativeShare extends HTMLElement {
        connectedCallback() {
          if (!navigator.share) return;

          this.hidden = false;
          this.button = this.querySelector('button');
          this.onClick = this.onClick.bind(this);
          this.button?.addEventListener('click', this.onClick);
        }

        disconnectedCallback() {
          this.button?.removeEventListener('click', this.onClick);
        }

        onClick() {
          navigator
            .share({ title: this.dataset.title, url: this.dataset.url })
            .catch(() => {
              /* Shopper dismissed the sheet. */
            });
        }
      }
    );
  }

  /* ---------------------------------------------------------- Gallery dots */

  // Sits inside Dawn's <slider-component> and mirrors its `slideChanged` event.
  // Dots are rebuilt from the live slide list, because a variant change adds,
  // removes and reorders gallery items in place (product-info.js updateMedia).
  if (!customElements.get('cm-gallery-dots')) {
    customElements.define(
      'cm-gallery-dots',
      class CmGalleryDots extends HTMLElement {
        connectedCallback() {
          this.slider = this.closest('slider-component');
          this.list = this.slider && this.slider.querySelector('.product__media-list');
          if (!this.list) return;

          this.onSlideChanged = (event) => this.setActive(event.detail.currentPage - 1);
          this.onClick = (event) => {
            const dot = event.target.closest('[data-index]');
            if (dot) this.goTo(Number(dot.dataset.index));
          };

          this.slider.addEventListener('slideChanged', this.onSlideChanged);
          this.addEventListener('click', this.onClick);
          this.mutationObserver = new MutationObserver(() => this.render());
          this.mutationObserver.observe(this.list, { childList: true });
          this.render();
        }

        disconnectedCallback() {
          if (this.slider) this.slider.removeEventListener('slideChanged', this.onSlideChanged);
          this.removeEventListener('click', this.onClick);
          if (this.mutationObserver) this.mutationObserver.disconnect();
        }

        getSlides() {
          return Array.from(this.list.querySelectorAll(':scope > .product__media-item'));
        }

        render() {
          const slides = this.getSlides();
          this.hidden = slides.length < 2;
          const template = this.dataset.label || '[index]';

          this.replaceChildren(
            ...slides.map((_, index) => {
              const dot = document.createElement('button');
              dot.type = 'button';
              dot.className = 'cm-gallery-dots__dot';
              dot.dataset.index = index;
              dot.setAttribute('aria-label', template.replace('[index]', index + 1));
              return dot;
            })
          );

          const index = this.slider.slider ? Math.round(this.slider.slider.scrollLeft / (slides[0]?.clientWidth || 1)) : 0;
          this.setActive(index);
        }

        setActive(index) {
          Array.from(this.children).forEach((dot, i) => {
            if (i === index) {
              dot.setAttribute('aria-current', 'true');
            } else {
              dot.removeAttribute('aria-current');
            }
          });
        }

        goTo(index) {
          const slides = this.getSlides();
          if (!slides[index] || !this.slider.slider) return;
          this.slider.slider.scrollTo({ left: slides[index].offsetLeft - slides[0].offsetLeft });
          this.setActive(index);
        }
      }
    );
  }

  /* ------------------------------------------------------------- Copy link */

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-cm-copy-link]');
    if (!trigger || !navigator.clipboard) return;

    event.preventDefault();
    navigator.clipboard.writeText(trigger.href).then(() => {
      trigger.classList.add('cm-share__link--copied');
      setTimeout(() => trigger.classList.remove('cm-share__link--copied'), 2000);
    });
  });
})();
