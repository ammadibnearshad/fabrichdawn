if (!customElements.get('lookbook-slider')) {
  class LookbookSlider extends HTMLElement {
    connectedCallback() {
      this.slides = Array.from(this.querySelectorAll('.lookbook__slide'));
      this.total = this.slides.length;
      if (!this.total) return;

      this.stage = this.querySelector('.lookbook__stage');
      this.dots = Array.from(this.querySelectorAll('[data-lookbook-dot]'));
      this.pauseButton = this.querySelector('[data-lookbook-pause]');
      this.live = this.querySelector('[data-lookbook-live]');
      this.current = 0;
      this.offsets = [];
      this.suppressClickUntil = 0;

      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.autoplay = this.dataset.autoplay === 'true' && this.total > 1;
      this.speed = parseInt(this.dataset.speed, 10) || 5000;
      this.userPaused = this.reducedMotion.matches;
      this.hoverPaused = false;
      this.inView = false;

      this.controller = new AbortController();
      const signal = this.controller.signal;

      this.querySelector('[data-lookbook-prev]')?.addEventListener('click', () => this.step(-1, true), { signal });
      this.querySelector('[data-lookbook-next]')?.addEventListener('click', () => this.step(1, true), { signal });
      this.dots.forEach((dot) =>
        dot.addEventListener('click', () => this.goTo(parseInt(dot.dataset.lookbookDot, 10), true), { signal })
      );
      this.pauseButton?.addEventListener('click', () => this.togglePause(), { signal });

      this.stage.addEventListener('click', this.onStageClick.bind(this), { signal });
      this.stage.addEventListener('pointerdown', this.onPointerDown.bind(this), { signal });
      this.stage.addEventListener('pointerup', this.onPointerUp.bind(this), { signal });
      this.stage.addEventListener('dragstart', (event) => event.preventDefault(), { signal });
      this.addEventListener('keydown', this.onKeyDown.bind(this), { signal });

      if (this.autoplay) {
        this.addEventListener('mouseenter', () => this.setHoverPaused(true), { signal });
        this.addEventListener('mouseleave', () => this.setHoverPaused(false), { signal });
        this.addEventListener('focusin', () => this.setHoverPaused(true), { signal });
        this.addEventListener('focusout', (event) => {
          if (!this.contains(event.relatedTarget)) this.setHoverPaused(false);
        }, { signal });

        this.observer = new IntersectionObserver((entries) => {
          this.inView = entries[0].isIntersecting;
          this.scheduleAutoplay();
        });
        this.observer.observe(this);
        this.updatePauseButton();
      }

      if (window.Shopify?.designMode) {
        document.addEventListener('shopify:block:select', this.onBlockSelect.bind(this), { signal });
        document.addEventListener('shopify:block:deselect', () => this.setHoverPaused(false), { signal });
      }

      this.render(true);
      this.classList.add('is-ready');
    }

    disconnectedCallback() {
      this.controller?.abort();
      this.observer?.disconnect();
      clearTimeout(this.timer);
    }

    /* ---------------- positioning ---------------- */

    // Signed distance from the active slide, wrapped so the loop is seamless.
    offsetFor(index) {
      let offset = (((index - this.current) % this.total) + this.total) % this.total;
      if (offset > this.total / 2) offset -= this.total;
      return offset;
    }

    render(instant) {
      const wrapping = [];

      this.slides.forEach((slide, index) => {
        const offset = this.offsetFor(index);
        const previous = this.offsets[index];
        const pos = Math.abs(offset) <= 2 ? String(offset) : offset > 0 ? 'out-next' : 'out-prev';

        // Jumping across the stage would sweep over the main image; hide it instead.
        if (!instant && previous !== undefined && Math.abs(offset - previous) > 1) {
          slide.classList.add('is-wrapping');
          wrapping.push(slide);
        }

        slide.dataset.pos = pos;
        this.offsets[index] = offset;

        const active = offset === 0;
        slide.setAttribute('aria-hidden', String(!active));
        const link = slide.querySelector('a');
        if (link) link.tabIndex = active ? 0 : -1;
      });

      this.dots.forEach((dot, index) => dot.setAttribute('aria-current', String(index === this.current)));

      if (instant) this.classList.add('is-instant');

      if (wrapping.length || instant) {
        // Two frames: one to commit the jump, one to let transitions run again.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            wrapping.forEach((slide) => slide.classList.remove('is-wrapping'));
            this.classList.remove('is-instant');
          })
        );
      }
    }

    goTo(index, fromUser) {
      const next = ((index % this.total) + this.total) % this.total;
      if (next === this.current) return;
      this.current = next;
      this.render(false);

      if (fromUser && this.live) {
        this.live.textContent = this.slides[next].getAttribute('aria-label');
      }
      this.scheduleAutoplay();
    }

    step(direction, fromUser) {
      this.goTo(this.current + direction, fromUser);
    }

    /* ---------------- input ---------------- */

    onStageClick(event) {
      if (performance.now() < this.suppressClickUntil) {
        event.preventDefault();
        return;
      }

      const slide = event.target.closest('.lookbook__slide');
      if (!slide || slide.dataset.pos === '0') return;

      // A side look is a shortcut to bring it to the middle, not a link.
      event.preventDefault();
      this.goTo(parseInt(slide.dataset.index, 10), true);
    }

    onPointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.startX = event.clientX;
      this.startY = event.clientY;
    }

    onPointerUp(event) {
      if (this.startX === undefined) return;
      const dx = event.clientX - this.startX;
      const dy = event.clientY - this.startY;
      this.startX = undefined;

      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      this.suppressClickUntil = performance.now() + 400;
      this.step(dx < 0 ? 1 : -1, true);
    }

    onKeyDown(event) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.step(-1, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.step(1, true);
      }
    }

    onBlockSelect(event) {
      const index = this.slides.findIndex((slide) => slide.contains(event.target) || slide === event.target);
      if (index === -1) return;
      this.setHoverPaused(true);
      this.goTo(index, false);
    }

    /* ---------------- autoplay ---------------- */

    scheduleAutoplay() {
      clearTimeout(this.timer);
      if (!this.autoplay || this.userPaused || this.hoverPaused || !this.inView) return;
      this.timer = setTimeout(() => this.step(1, false), this.speed);
    }

    setHoverPaused(paused) {
      this.hoverPaused = paused;
      this.scheduleAutoplay();
    }

    togglePause() {
      this.userPaused = !this.userPaused;
      this.updatePauseButton();
      this.scheduleAutoplay();
    }

    updatePauseButton() {
      if (!this.pauseButton) return;
      this.pauseButton.classList.toggle('is-paused', this.userPaused);
      this.pauseButton.setAttribute(
        'aria-label',
        this.userPaused ? this.pauseButton.dataset.labelPlay : this.pauseButton.dataset.labelPause
      );
    }
  }

  customElements.define('lookbook-slider', LookbookSlider);
}
