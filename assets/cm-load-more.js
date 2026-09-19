/*
  Cambridge collection pagination.

  <cm-load-more>     Appends the next page of products into #product-grid using
                     the Section Rendering API. Falls back to a plain link to
                     ?page=N when JS is unavailable.
  <cm-product-count> Mirrors Dawn's #ProductCount so the "Products : N" line
                     above the toolbar stays correct after AJAX filtering.

  Both re-initialise automatically after facets.js replaces
  #ProductGridContainer, because connectedCallback runs on the new nodes.
*/

class CMLoadMore extends HTMLElement {
  constructor() {
    super();
    this.onClick = this.onClick.bind(this);
    this.observer = null;
    this.abortController = null;
  }

  connectedCallback() {
    this.button = this.querySelector('.cm-load-more__button');
    this.statusViewed = this.querySelector('[data-viewed]');
    this.statusTotal = this.querySelector('[data-total]');
    this.bar = this.querySelector('.cm-load-more__bar');
    this.barFill = this.querySelector('.cm-load-more__bar span');
    this.spinner = this.querySelector('.loading__spinner');

    this.sectionId = this.dataset.sectionId;
    this.total = parseInt(this.dataset.total, 10) || 0;
    this.viewed = parseInt(this.dataset.viewed, 10) || 0;
    this.mode = this.dataset.paginationType || 'load_more';

    if (!this.button) return;

    this.button.addEventListener('click', this.onClick);

    if (this.mode === 'infinite') {
      this.setUpObserver();
    }
  }

  disconnectedCallback() {
    if (this.button) this.button.removeEventListener('click', this.onClick);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  setUpObserver() {
    if (!('IntersectionObserver' in window)) return;

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.loading && this.dataset.nextUrl) {
            this.loadNext();
          }
        });
      },
      { rootMargin: '400px 0px' }
    );

    this.observer.observe(this);
  }

  onClick(event) {
    event.preventDefault();
    this.loadNext();
  }

  get grid() {
    return document.getElementById('product-grid');
  }

  setLoading(isLoading) {
    this.loading = isLoading;
    this.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (this.button) this.button.classList.toggle('cm-load-more__button--loading', isLoading);
    if (this.spinner) this.spinner.classList.toggle('hidden', !isLoading);
  }

  buildSectionUrl(nextUrl) {
    const url = new URL(nextUrl, window.location.origin);
    url.searchParams.set('section_id', this.sectionId);
    return url.toString();
  }

  loadNext() {
    const nextUrl = this.dataset.nextUrl;
    if (!nextUrl || this.loading) return;

    this.setLoading(true);

    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    fetch(this.buildSectionUrl(nextUrl), { signal: this.abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(response.status);
        return response.text();
      })
      .then((text) => this.append(text, nextUrl))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        console.error('cm-load-more:', error);
        // Fall back to a full page load so the shopper is never stuck.
        window.location.href = nextUrl;
      })
      .finally(() => {
        this.abortController = null;
        this.setLoading(false);
      });
  }

  append(html, nextUrl) {
    const grid = this.grid;
    if (!grid) return;

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const sourceGrid = parsed.getElementById('product-grid');
    const newItems = sourceGrid ? Array.from(sourceGrid.querySelectorAll('.grid__item')) : [];

    if (newItems.length === 0) {
      this.finish();
      return;
    }

    const fragment = document.createDocumentFragment();
    newItems.forEach((item) => {
      // Scroll-reveal animations are cancelled: these nodes arrive mid-scroll.
      item.classList.remove('scroll-trigger', 'animate--slide-in');
      item.removeAttribute('data-cascade');
      fragment.appendChild(item);
    });

    const firstNewItem = fragment.firstElementChild;
    grid.appendChild(fragment);

    this.viewed += newItems.length;
    this.updateStatus();
    this.updateHistory(nextUrl);

    // Next page link comes from the freshly rendered section.
    const nextLoadMore = parsed.querySelector('cm-load-more');
    const newNextUrl = nextLoadMore ? nextLoadMore.dataset.nextUrl : '';

    if (newNextUrl) {
      this.dataset.nextUrl = newNextUrl;
      if (this.button) this.button.setAttribute('href', newNextUrl);
    } else {
      this.finish();
    }

    const focusTarget = firstNewItem && firstNewItem.querySelector('.cm-card__title-link');
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  finish() {
    this.dataset.nextUrl = '';
    if (this.button) this.button.hidden = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  updateStatus() {
    if (this.statusViewed) this.statusViewed.textContent = this.viewed;
    if (this.statusTotal) this.statusTotal.textContent = this.total;

    const percent = this.total > 0 ? Math.min(100, (this.viewed / this.total) * 100) : 100;
    if (this.barFill) this.barFill.style.width = `${percent}%`;
    if (this.bar) this.bar.setAttribute('aria-valuenow', this.viewed);
  }

  updateHistory(nextUrl) {
    if (!window.history || !window.history.replaceState) return;

    const loaded = new URL(nextUrl, window.location.origin);
    const page = loaded.searchParams.get('page');
    if (!page) return;

    // Keep whatever filter and sort params are on the current URL.
    const current = new URL(window.location.href);
    current.searchParams.set('page', page);
    window.history.replaceState({}, '', current.toString());
  }
}

if (!customElements.get('cm-load-more')) {
  customElements.define('cm-load-more', CMLoadMore);
}

class CMProductCount extends HTMLElement {
  constructor() {
    super();
    this.observer = null;
  }

  connectedCallback() {
    this.output = this.querySelector('[data-cm-count]');
    this.source = document.getElementById('ProductCount');

    if (!this.output || !this.source) return;

    this.sync();

    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(this.source, {
      attributes: true,
      attributeFilter: ['data-product-count'],
    });
  }

  disconnectedCallback() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  sync() {
    const count = this.source.dataset.productCount;
    if (count !== undefined && count !== '') this.output.textContent = count;
  }
}

if (!customElements.get('cm-product-count')) {
  customElements.define('cm-product-count', CMProductCount);
}

/*
  Optional grid column switcher. It writes CSS custom properties onto the
  `.cm-collection` wrapper, which lives outside #ProductGridContainer, so the
  chosen column count survives facets AJAX re-renders and Load More appends.
*/
class CMGridSwitcher extends HTMLElement {
  constructor() {
    super();
    this.onClick = this.onClick.bind(this);
  }

  connectedCallback() {
    this.wrapper = this.closest('.cm-collection');
    if (!this.wrapper) return;

    this.mobileGroup = this.querySelector('.cm-switcher__group--mobile');
    this.desktopGroup = this.querySelector('.cm-switcher__group--desktop');

    this.apply('mobile', this.read('mobile') || this.dataset.defaultMobile);
    this.apply('desktop', this.read('desktop') || this.dataset.defaultDesktop);

    this.addEventListener('click', this.onClick);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
  }

  storageKey(scope) {
    return `cm-grid-cols-${scope}`;
  }

  read(scope) {
    try {
      return window.localStorage.getItem(this.storageKey(scope));
    } catch (error) {
      return null;
    }
  }

  write(scope, value) {
    try {
      window.localStorage.setItem(this.storageKey(scope), value);
    } catch (error) {
      // Private mode or blocked storage: the choice just does not persist.
    }
  }

  onClick(event) {
    const button = event.target.closest('.cm-switcher__button');
    if (!button) return;

    const scope = button.closest('.cm-switcher__group--mobile') ? 'mobile' : 'desktop';
    this.apply(scope, button.dataset.cols);
    this.write(scope, button.dataset.cols);
  }

  apply(scope, cols) {
    if (!cols) return;

    this.wrapper.style.setProperty(`--cm-cols-${scope}`, cols);
    this.wrapper.classList.add('cm-collection--switched');

    const group = scope === 'mobile' ? this.mobileGroup : this.desktopGroup;
    if (!group) return;

    group.querySelectorAll('.cm-switcher__button').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.cols === String(cols) ? 'true' : 'false');
    });
  }
}

if (!customElements.get('cm-grid-switcher')) {
  customElements.define('cm-grid-switcher', CMGridSwitcher);
}
