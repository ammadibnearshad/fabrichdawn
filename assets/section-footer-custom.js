/* Footer (custom) - collapses the menu columns into accordions below 750px.
   Markup ships with [open] so the menus stay readable without JS. */

if (!customElements.get('footer-accordions')) {
  customElements.define(
    'footer-accordions',
    class FooterAccordions extends HTMLElement {
      constructor() {
        super();
        this.mobile = window.matchMedia('(max-width: 749px)');
        this.onBreakpointChange = this.onBreakpointChange.bind(this);
        this.onBlockSelect = this.onBlockSelect.bind(this);
      }

      connectedCallback() {
        this.details = Array.from(this.querySelectorAll('.footer-custom__details'));
        if (!this.details.length) return;

        this.onBreakpointChange();
        this.mobile.addEventListener('change', this.onBreakpointChange);
        document.addEventListener('shopify:block:select', this.onBlockSelect);
      }

      disconnectedCallback() {
        this.mobile.removeEventListener('change', this.onBreakpointChange);
        document.removeEventListener('shopify:block:select', this.onBlockSelect);
      }

      onBreakpointChange() {
        const collapse = this.mobile.matches;

        this.details.forEach((details) => {
          const summary = details.querySelector('.footer-custom__summary');

          if (collapse) {
            details.removeAttribute('open');
          } else {
            details.setAttribute('open', '');
          }

          // On desktop the summary is a plain heading: keep it out of the tab
          // order so it is not announced or focusable as a control.
          if (summary) summary.tabIndex = collapse ? 0 : -1;
        });
      }

      // Theme editor: expand the accordion a merchant just selected.
      onBlockSelect(event) {
        if (!this.mobile.matches || !this.contains(event.target)) return;

        const details = event.target.querySelector('.footer-custom__details');
        if (details) details.setAttribute('open', '');
      }
    }
  );
}
