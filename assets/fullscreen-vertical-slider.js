(function () {
  if (customElements.get('fullscreen-vertical-slider')) return;

  var MOBILE_QUERY = '(max-width: 749px)';
  var WHEEL_THRESHOLD = 30;
  var WHEEL_GAP = 150;
  var TOUCH_THRESHOLD = 50;
  var CLICK_SUPPRESS_DISTANCE = 10;
  var FORM_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'];
  var BLOCKING_SELECTOR = [
    'cart-drawer.active',
    'predictive-search[open]',
    'header-drawer details[open]',
    '.menu-drawer-container details[open]',
    'details-modal details[open]',
    '.mega-menu details[open]',
  ].join(',');

  class FullscreenVerticalSlider extends HTMLElement {
    constructor() {
      super();
      this.currentIndex = 0;
      this.mode = null;
      this.isActive = false;
      this.isAnimating = false;
      this.hijack = false;
      this.lockUntil = 0;
      this.releaseGuard = false;
      this.snapLockUntil = 0;
      this.snapTarget = null;
      this.lastScrollY = 0;
      this.hasScrolled = false;
      this.wheelAccum = 0;
      this.lastWheelTime = 0;
      this.needsGap = false;
      this.pendingDirection = 0;
      this.flushTimer = null;
      this.suppressClick = false;
      this.touchActive = false;
      this.userPaused = false;
      this.autoplayPaused = false;
      this.headerClassOn = false;
      this.rafId = null;
    }

    /* ---------------- lifecycle ---------------- */

    connectedCallback() {
      this.slides = Array.prototype.slice.call(this.querySelectorAll('.fvs__slide'));
      this.total = this.slides.length;
      if (!this.total) return;

      this.dotsNav = this.querySelector('.fvs__dots');
      this.dots = Array.prototype.slice.call(this.querySelectorAll('.fvs__dot'));
      this.liveRegion = this.querySelector('[data-fvs-live]');
      this.counter = this.querySelector('[data-fvs-counter]');
      this.pauseButton = this.querySelector('[data-fvs-pause]');
      this.hint = this.querySelector('.fvs__hint');
      this.sectionWrapper = this.closest('.shopify-section');

      this.speed = parseInt(this.dataset.speed, 10) || 800;
      this.lockDelay = parseInt(this.dataset.lock, 10) || 600;
      this.releaseToFooter = this.dataset.release === 'true';
      this.loopEnabled = this.dataset.loop === 'true' && !this.releaseToFooter;
      this.keyboardEnabled = this.dataset.keyboard === 'true';
      this.autoplayEnabled = this.dataset.autoplay === 'true';
      this.autoplaySpeed = parseInt(this.dataset.autoplaySpeed, 10) || 5000;
      this.snapEnabled = this.dataset.snap === 'true';
      this.mobileSnapEnabled = this.dataset.mobileSnap === 'true';
      this.overlapHeader = this.dataset.overlapHeader === 'true';
      this.pinHeader = this.dataset.pinHeader === 'true';
      this.transparentHeader = this.dataset.transparentHeader === 'true';
      this.fullFooter = this.dataset.fullFooter === 'true';
      this.heightMode = this.dataset.heightMode || 'full';
      this.designMode = Boolean(window.Shopify && window.Shopify.designMode);
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.mobileMedia = window.matchMedia(MOBILE_QUERY);

      this.onWheel = this.onWheel.bind(this);
      this.onTouchStart = this.onTouchStart.bind(this);
      this.onTouchMove = this.onTouchMove.bind(this);
      this.onTouchEnd = this.onTouchEnd.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onClickCapture = this.onClickCapture.bind(this);
      this.onScroll = this.onScroll.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onDotClick = this.onDotClick.bind(this);
      this.onPauseClick = this.onPauseClick.bind(this);
      this.onPointerEnter = this.onPointerEnter.bind(this);
      this.onPointerLeave = this.onPointerLeave.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.onBlockSelect = this.onBlockSelect.bind(this);
      this.onBlockDeselect = this.onBlockDeselect.bind(this);

      this.lastScrollY = window.scrollY;
      this.hasScrolled = window.scrollY > 0;

      this.measure();
      if (this.pinHeader) document.body.classList.add('fvs-header-pinned');
      if (this.fullFooter) document.body.classList.add('fvs-footer-full');
      this.setMode(true);

      // The header group can change height after fonts load or when an
      // announcement rotates, which would leave the overlap offset stale.
      if (window.ResizeObserver && this.headerGroupEls.length) {
        this.headerObserver = new ResizeObserver(this.onResize);
        for (var g = 0; g < this.headerGroupEls.length; g++) {
          this.headerObserver.observe(this.headerGroupEls[g]);
        }
      }

      window.addEventListener('wheel', this.onWheel, { passive: false });
      this.addEventListener('touchstart', this.onTouchStart, { passive: true });
      this.addEventListener('touchmove', this.onTouchMove, { passive: false });
      this.addEventListener('touchend', this.onTouchEnd, { passive: true });
      this.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
      this.addEventListener('click', this.onClickCapture, true);
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('scroll', this.onScroll, { passive: true });
      window.addEventListener('resize', this.onResize, { passive: true });
      window.addEventListener('orientationchange', this.onResize, { passive: true });
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      document.addEventListener('shopify:block:select', this.onBlockSelect);
      document.addEventListener('shopify:block:deselect', this.onBlockDeselect);

      if (this.dotsNav) this.dotsNav.addEventListener('click', this.onDotClick);
      if (this.pauseButton) this.pauseButton.addEventListener('click', this.onPauseClick);

      this.addEventListener('mouseenter', this.onPointerEnter);
      this.addEventListener('mouseleave', this.onPointerLeave);
      this.addEventListener('focusin', this.onPointerEnter);
      this.addEventListener('focusout', this.onPointerLeave);

      this.observer = new IntersectionObserver(
        () => {
          this.requestEvaluate();
        },
        { threshold: [0, 0.5, 0.98, 1] }
      );
      this.observer.observe(this);

      this.updateChrome();
      this.updateMedia();
      this.requestEvaluate();
    }

    disconnectedCallback() {
      window.removeEventListener('wheel', this.onWheel, { passive: false });
      this.removeEventListener('touchstart', this.onTouchStart);
      this.removeEventListener('touchmove', this.onTouchMove);
      this.removeEventListener('touchend', this.onTouchEnd);
      this.removeEventListener('touchcancel', this.onTouchEnd);
      this.removeEventListener('click', this.onClickCapture, true);
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('orientationchange', this.onResize);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      document.removeEventListener('shopify:block:select', this.onBlockSelect);
      document.removeEventListener('shopify:block:deselect', this.onBlockDeselect);

      if (this.dotsNav) this.dotsNav.removeEventListener('click', this.onDotClick);
      if (this.pauseButton) this.pauseButton.removeEventListener('click', this.onPauseClick);

      this.removeEventListener('mouseenter', this.onPointerEnter);
      this.removeEventListener('mouseleave', this.onPointerLeave);
      this.removeEventListener('focusin', this.onPointerEnter);
      this.removeEventListener('focusout', this.onPointerLeave);

      if (this.observer) this.observer.disconnect();
      if (this.headerObserver) this.headerObserver.disconnect();
      this.teardownStackedObserver();

      clearTimeout(this.animationTimer);
      clearTimeout(this.flushTimer);
      clearTimeout(this.resizeTimer);
      clearTimeout(this.autoplayTimer);
      clearTimeout(this.autoplayResumeTimer);
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;

      this.setBodyHeaderClass(false);
      if (!document.querySelector('fullscreen-vertical-slider[data-pin-header="true"]')) {
        document.body.classList.remove('fvs-header-pinned');
      }
      if (!document.querySelector('fullscreen-vertical-slider[data-full-footer="true"]')) {
        document.body.classList.remove('fvs-footer-full');
      }
      if (this.sectionWrapper) this.sectionWrapper.classList.remove('fvs-overlap-parent');
    }

    /* ---------------- setup helpers ---------------- */

    measure() {
      var main = document.querySelector('#MainContent') || document.querySelector('main');

      this.headerEl = document.querySelector('.section-header');
      this.headerHeight = this.headerEl ? this.headerEl.offsetHeight : 0;

      // Everything the theme renders above <main>: announcement bar, header,
      // and any app section a merchant has added to the header group.
      this.headerGroupEls = [];
      this.headerGroupHeight = 0;
      var nodes = document.querySelectorAll('.shopify-section-group-header-group');
      for (var i = 0; i < nodes.length; i++) {
        if (main && main.contains(nodes[i])) continue;
        this.headerGroupEls.push(nodes[i]);
        this.headerGroupHeight += nodes[i].offsetHeight;
      }

      var sticky = document.querySelector('sticky-header');
      var stickyType = sticky ? sticky.dataset.stickyType : 'none';
      this.headerIsPinned =
        this.pinHeader || stickyType === 'always' || stickyType === 'reduce-logo-size';

      document.documentElement.style.setProperty(
        '--fvs-header-group-height',
        this.headerGroupHeight + 'px'
      );
      // Only the part of the header that stays on screen counts against the
      // "full screen minus header" height.
      this.style.setProperty(
        '--fvs-header-height',
        (this.headerIsPinned ? this.headerHeight : 0) + 'px'
      );

      this.isFirstSection = Boolean(main && this.sectionWrapper && main.firstElementChild === this.sectionWrapper);
      this.overlapActive =
        this.overlapHeader && this.isFirstSection && this.heightMode !== 'full_minus_header';

      if (this.sectionWrapper) {
        this.sectionWrapper.classList.toggle('fvs-overlap-parent', this.overlapActive);
      }
    }

    getDesiredMode() {
      if (!this.snapEnabled) return 'stacked';
      if (this.mobileMedia.matches && !this.mobileSnapEnabled) return 'stacked';
      return 'slider';
    }

    setMode(force) {
      var next = this.getDesiredMode();
      if (next === this.mode && !force) return;
      this.mode = next;

      if (next === 'slider') {
        this.classList.add('fvs--js');
        this.classList.remove('fvs--stacked');
        this.teardownStackedObserver();
      } else {
        this.classList.remove('fvs--js');
        this.classList.add('fvs--stacked');
        this.isActive = false;
        this.setBodyHeaderClass(false);
        this.setupStackedObserver();
      }

      this.hijack = next === 'slider' && !this.designMode;
      this.clearPending();
      this.applySlideStates(true);
    }

    prefersReduced() {
      return this.reducedMotion && this.reducedMotion.matches;
    }

    isBlocked() {
      var body = document.body;
      if (
        body.classList.contains('overflow-hidden') ||
        body.classList.contains('overflow-hidden-mobile') ||
        body.classList.contains('overflow-hidden-tablet')
      ) {
        return true;
      }
      return Boolean(document.querySelector(BLOCKING_SELECTOR));
    }

    /* ---------------- slide state ---------------- */

    applySlideStates(instant) {
      var stacked = this.mode === 'stacked';
      if (instant) this.classList.add('fvs--no-transition');

      for (var i = 0; i < this.slides.length; i++) {
        var slide = this.slides[i];
        var isCurrent = i === this.currentIndex;
        slide.classList.toggle('is-active', isCurrent);
        slide.classList.toggle('is-above', !stacked && i < this.currentIndex);
        slide.classList.toggle('is-below', !stacked && i > this.currentIndex);

        var hidden = !stacked && !isCurrent;
        if (hidden) slide.setAttribute('aria-hidden', 'true');
        else slide.removeAttribute('aria-hidden');
        this.setFocusable(slide, !hidden);
      }

      if (instant) {
        void this.offsetHeight;
        var self = this;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            self.classList.remove('fvs--no-transition');
          });
        });
      }
    }

    setFocusable(slide, enabled) {
      var items = slide.querySelectorAll('a[href], button, [tabindex]');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.classList.contains('fvs__video')) continue;
        if (enabled) {
          if ('fvsTabindex' in el.dataset) {
            if (el.dataset.fvsTabindex === '') el.removeAttribute('tabindex');
            else el.setAttribute('tabindex', el.dataset.fvsTabindex);
            delete el.dataset.fvsTabindex;
          }
        } else if (!('fvsTabindex' in el.dataset)) {
          el.dataset.fvsTabindex = el.getAttribute('tabindex') || '';
          el.setAttribute('tabindex', '-1');
        }
      }
    }

    goTo(index, options) {
      var opts = options || {};
      var next;

      if (this.loopEnabled) {
        next = ((index % this.total) + this.total) % this.total;
      } else {
        next = Math.max(0, Math.min(this.total - 1, index));
      }

      if (this.mode === 'stacked') {
        this.currentIndex = next;
        this.updateChrome();
        this.updateMedia();
        if (this.slides[next] && !opts.silent) {
          this.slides[next].scrollIntoView({
            behavior: opts.instant || this.prefersReduced() ? 'auto' : 'smooth',
            block: 'start',
          });
        }
        return;
      }

      if (next === this.currentIndex && !opts.force) return;

      var previous = this.currentIndex;
      this.currentIndex = next;

      var instant = Boolean(opts.instant) || this.prefersReduced();
      if (!instant) {
        if (this.slides[previous]) this.slides[previous].classList.add('is-animating');
        if (this.slides[next]) this.slides[next].classList.add('is-animating');
      }

      this.applySlideStates(instant);

      var duration = instant ? 0 : this.speed;
      this.isAnimating = !instant;
      clearTimeout(this.animationTimer);
      var self = this;
      this.animationTimer = setTimeout(function () {
        self.isAnimating = false;
        for (var i = 0; i < self.slides.length; i++) self.slides[i].classList.remove('is-animating');
      }, duration);

      this.lockUntil = performance.now() + duration + this.lockDelay;
      this.needsGap = true;
      this.wheelAccum = 0;

      this.updateChrome();
      this.updateMedia();
      this.announce();
      this.dispatchEvent(
        new CustomEvent('fvs:change', { bubbles: true, detail: { index: next, total: this.total } })
      );
      this.scheduleAutoplay();
    }

    step(direction) {
      var next = this.currentIndex + direction;
      if (next < 0 || next > this.total - 1) {
        if (!this.loopEnabled) return false;
        this.goTo(next);
        return true;
      }
      this.goTo(next);
      return true;
    }

    /* Every input funnels through here. A gesture that lands during the
       transition or the cool-down is remembered rather than dropped, and
       replayed the moment the slider is free — otherwise a visitor scrolling
       at a steady pace sees every second gesture do nothing. Only the most
       recent direction is kept, so a burst can never skip several slides. */
    requestStep(direction) {
      if (!direction) return;
      if (this.isAnimating || performance.now() < this.lockUntil) {
        this.pendingDirection = direction;
        this.scheduleFlush();
        return;
      }
      this.clearPending();
      this.handleDirection(direction);
    }

    scheduleFlush() {
      clearTimeout(this.flushTimer);
      var self = this;
      var wait = Math.max(0, this.lockUntil - performance.now()) + 16;
      this.flushTimer = setTimeout(function () {
        self.flushPending();
      }, wait);
    }

    flushPending() {
      var direction = this.pendingDirection;
      if (!direction) return;
      if (!this.isActive || this.mode !== 'slider') {
        this.clearPending();
        return;
      }
      if (this.isAnimating || performance.now() < this.lockUntil) {
        this.scheduleFlush();
        return;
      }
      this.clearPending();
      this.handleDirection(direction);
    }

    clearPending() {
      this.pendingDirection = 0;
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    handleDirection(direction) {
      this.hideHint();
      if (this.step(direction)) return true;
      if (direction > 0 && this.releaseToFooter) {
        this.release('down');
        return true;
      }
      if (direction < 0 && !this.isFirstSection) {
        this.release('up');
        return true;
      }
      return false;
    }

    /* ---------------- chrome ---------------- */

    updateChrome() {
      for (var i = 0; i < this.dots.length; i++) {
        var isCurrent = i === this.currentIndex;
        this.dots[i].classList.toggle('is-active', isCurrent);
        if (isCurrent) this.dots[i].setAttribute('aria-current', 'true');
        else this.dots[i].removeAttribute('aria-current');
      }
      if (this.counter) {
        this.counter.textContent = ('0' + (this.currentIndex + 1)).slice(-2);
      }
    }

    announce() {
      if (!this.liveRegion) return;
      this.liveRegion.textContent = 'Slide ' + (this.currentIndex + 1) + ' of ' + this.total;
    }

    hideHint() {
      if (this.hint) this.hint.classList.add('is-hidden');
    }

    updateMedia() {
      for (var i = 0; i < this.slides.length; i++) {
        var slide = this.slides[i];
        var isCurrent = i === this.currentIndex;
        var videos = slide.querySelectorAll('video');

        for (var v = 0; v < videos.length; v++) {
          var video = videos[v];
          if (isCurrent && video.clientWidth > 0) {
            var playback = video.play();
            if (playback && typeof playback.catch === 'function') playback.catch(function () {});
          } else {
            video.pause();
          }
        }

        if (Math.abs(i - this.currentIndex) <= 1) {
          var images = slide.querySelectorAll('img[loading="lazy"]');
          for (var n = 0; n < images.length; n++) images[n].setAttribute('loading', 'eager');
        }
      }
    }

    /* ---------------- activation ---------------- */

    requestEvaluate() {
      if (this.rafId) return;
      var self = this;
      this.rafId = requestAnimationFrame(function () {
        self.rafId = null;
        self.evaluate();
      });
    }

    evaluate() {
      if (!this.slides || !this.slides.length) return;
      var rect = this.getBoundingClientRect();
      this.updateHeaderState(rect);

      if (!this.hijack || this.mode !== 'slider') return;

      var offset = this.getTopOffset();
      var distance = rect.top - offset;
      var range = window.innerHeight * 0.25;

      // After releasing the page, stay out of the way until the slider is
      // clearly away from its snap position, otherwise we would yank the
      // visitor straight back in mid-scroll.
      if (this.releaseGuard) {
        if (Math.abs(distance) > window.innerHeight * 0.3) this.releaseGuard = false;
        else return;
      }

      if (Math.abs(distance) <= 2 && rect.bottom >= window.innerHeight - 2) {
        this.activate();
        return;
      }

      if (this.isActive) {
        this.deactivate();
        return;
      }

      if (this.touchActive || !this.hasScrolled) return;

      // Close enough to the snap position, from either direction: take over.
      if (Math.abs(distance) <= range) this.snapIntoView(rect, offset);
    }

    getTopOffset() {
      if (this.heightMode === 'full_minus_header' && this.headerIsPinned) return this.headerHeight;
      return 0;
    }

    snapIntoView(rect, offset) {
      var target = Math.round(rect.top + window.scrollY - offset);
      this.snapTarget = target;
      this.snapLockUntil = performance.now() + 350;
      window.scrollTo(0, target);
      this.activate();
    }

    activate() {
      if (this.isActive) return;
      this.isActive = true;
      this.needsGap = true;
      this.wheelAccum = 0;
      this.scheduleAutoplay();
    }

    deactivate() {
      if (!this.isActive) return;
      this.isActive = false;
      this.clearPending();
      this.stopAutoplay();
    }

    updateHeaderState(rect) {
      if (!this.transparentHeader || !this.overlapActive || !this.headerEl) {
        this.setBodyHeaderClass(false);
        return;
      }
      var headerRect = this.headerEl.getBoundingClientRect();
      var covers = rect.top <= headerRect.top + 1 && rect.bottom >= headerRect.bottom;
      this.setBodyHeaderClass(covers);
    }

    setBodyHeaderClass(on) {
      if (on === this.headerClassOn) return;
      this.headerClassOn = on;
      if (on) {
        document.body.style.setProperty('--fvs-header-color', this.dataset.headerColor || '255, 255, 255');
        document.body.classList.add('fvs-header-transparent');
      } else {
        document.body.classList.remove('fvs-header-transparent');
      }
    }

    release(direction) {
      this.isActive = false;
      this.clearPending();
      this.stopAutoplay();
      this.releaseGuard = true;
      this.snapTarget = null;

      var target = direction === 'down' ? this.getNextScrollTarget() : this.getPreviousScrollTarget();
      if (target === null) return;

      window.scrollTo({ top: target, behavior: this.prefersReduced() ? 'auto' : 'smooth' });
    }

    getNextScrollTarget() {
      // A pinned header covers the top of whatever we land on.
      var pinned = this.headerIsPinned ? this.headerHeight : 0;
      var wrapper = this.sectionWrapper || this;
      var next = wrapper.nextElementSibling;
      while (next && next.offsetHeight === 0) next = next.nextElementSibling;
      if (next) return next.getBoundingClientRect().top + window.scrollY - pinned;

      // A full-height footer is meant to be read whole, so land on its top
      // edge rather than nudging its last line below the fold.
      var footer =
        document.querySelector('.shopify-section-group-footer-group') || document.querySelector('footer');
      if (footer) {
        return footer.getBoundingClientRect().top + window.scrollY - (this.fullFooter ? 0 : pinned);
      }

      return wrapper.getBoundingClientRect().bottom + window.scrollY;
    }

    getPreviousScrollTarget() {
      var wrapper = this.sectionWrapper || this;
      var previous = wrapper.previousElementSibling;
      while (previous && previous.offsetHeight === 0) previous = previous.previousElementSibling;
      if (!previous) return 0;
      return Math.max(0, previous.getBoundingClientRect().bottom + window.scrollY - window.innerHeight);
    }

    /* ---------------- input ---------------- */

    normalizeDelta(event) {
      var delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= window.innerHeight;
      return delta;
    }

    onWheel(event) {
      if (!this.hijack || !this.isActive) return;
      if (this.isBlocked()) return;
      if (event.ctrlKey) return;
      if (event.cancelable) event.preventDefault();

      var now = performance.now();
      var gap = now - this.lastWheelTime;
      this.lastWheelTime = now;

      if (this.isAnimating || now < this.lockUntil) {
        // A gap this long means a fresh, deliberate gesture rather than
        // trackpad inertia from the one we just handled: queue it.
        if (gap >= WHEEL_GAP) {
          this.pauseAutoplayForUser();
          this.requestStep(this.normalizeDelta(event) > 0 ? 1 : -1);
        }
        this.wheelAccum = 0;
        this.needsGap = true;
        return;
      }

      if (this.needsGap) {
        if (gap < WHEEL_GAP) {
          this.wheelAccum = 0;
          return;
        }
        this.needsGap = false;
      }

      if (gap > 200) this.wheelAccum = 0;
      this.wheelAccum += this.normalizeDelta(event);
      if (Math.abs(this.wheelAccum) < WHEEL_THRESHOLD) return;

      var direction = this.wheelAccum > 0 ? 1 : -1;
      this.wheelAccum = 0;
      this.pauseAutoplayForUser();
      this.requestStep(direction);
    }

    onTouchStart(event) {
      this.suppressClick = false;
      if (event.touches.length !== 1) {
        this.touchActive = false;
        return;
      }
      this.touchActive = true;
      this.touchStartY = event.touches[0].clientY;
      this.touchStartX = event.touches[0].clientX;
      this.touchDeltaY = 0;
      this.touchDeltaX = 0;
      this.touchMoved = 0;
    }

    onTouchMove(event) {
      if (!this.touchActive || event.touches.length !== 1) return;
      var touch = event.touches[0];
      this.touchDeltaY = touch.clientY - this.touchStartY;
      this.touchDeltaX = touch.clientX - this.touchStartX;
      this.touchMoved = Math.max(this.touchMoved, Math.sqrt(this.touchDeltaY * this.touchDeltaY + this.touchDeltaX * this.touchDeltaX));

      if (!this.hijack || !this.isActive || this.isBlocked()) return;
      if (Math.abs(this.touchDeltaY) > Math.abs(this.touchDeltaX) && event.cancelable) event.preventDefault();
    }

    onTouchEnd() {
      if (!this.touchActive) return;
      this.touchActive = false;
      if (this.touchMoved > CLICK_SUPPRESS_DISTANCE) this.suppressClick = true;

      if (!this.hijack || !this.isActive || this.isBlocked()) return;
      if (Math.abs(this.touchDeltaY) < TOUCH_THRESHOLD) return;
      if (Math.abs(this.touchDeltaY) <= Math.abs(this.touchDeltaX)) return;

      this.pauseAutoplayForUser();
      this.requestStep(this.touchDeltaY < 0 ? 1 : -1);
    }

    onClickCapture(event) {
      if (!this.suppressClick) return;
      this.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    onKeyDown(event) {
      if (!this.keyboardEnabled || !this.hijack || !this.isActive) return;
      if (this.isBlocked()) return;

      var target = event.target;
      if (target && (FORM_TAGS.indexOf(target.tagName) !== -1 || target.isContentEditable)) return;

      var isSpace = event.key === ' ' || event.key === 'Spacebar';
      if (isSpace && target && (target.tagName === 'BUTTON' || target.tagName === 'A')) return;

      var handled = true;
      var direction = 0;
      var jumpTo = null;

      switch (event.key) {
        case 'ArrowDown':
        case 'PageDown':
          direction = 1;
          break;
        case 'ArrowUp':
        case 'PageUp':
          direction = -1;
          break;
        case 'Home':
          jumpTo = 0;
          break;
        case 'End':
          jumpTo = this.total - 1;
          break;
        default:
          if (isSpace) direction = event.shiftKey ? -1 : 1;
          else handled = false;
      }

      if (!handled) return;
      event.preventDefault();

      this.pauseAutoplayForUser();
      if (jumpTo !== null) {
        if (this.isAnimating || performance.now() < this.lockUntil) return;
        this.hideHint();
        this.goTo(jumpTo);
      } else {
        this.requestStep(direction);
      }
    }

    onDotClick(event) {
      var button = event.target.closest('.fvs__dot');
      if (!button) return;
      var index = parseInt(button.dataset.index, 10);
      if (isNaN(index)) return;
      this.hideHint();
      this.pauseAutoplayForUser();
      this.goTo(index);
    }

    onScroll() {
      var y = window.scrollY;
      if (y !== this.lastScrollY) {
        this.hasScrolled = true;
        this.lastScrollY = y;
      }
      if (this.snapTarget !== null && performance.now() < this.snapLockUntil) {
        if (Math.abs(y - this.snapTarget) > 1) window.scrollTo(0, this.snapTarget);
      }
      this.requestEvaluate();
    }

    onResize() {
      clearTimeout(this.resizeTimer);
      var self = this;
      this.resizeTimer = setTimeout(function () {
        self.measure();
        self.setMode();
        if (self.mode === 'slider') self.applySlideStates(true);
        self.requestEvaluate();
      }, 150);
    }

    /* ---------------- autoplay ---------------- */

    scheduleAutoplay() {
      this.stopAutoplay();
      if (!this.autoplayEnabled || this.userPaused || this.autoplayPaused) return;
      if (this.mode !== 'slider' || !this.isActive) return;
      if (document.hidden || this.prefersReduced()) return;
      if (!this.loopEnabled && this.currentIndex === this.total - 1) return;

      var self = this;
      this.autoplayTimer = setTimeout(function () {
        if (self.currentIndex === self.total - 1) {
          if (self.loopEnabled) self.goTo(0);
          return;
        }
        self.goTo(self.currentIndex + 1);
      }, this.autoplaySpeed);
    }

    stopAutoplay() {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }

    pauseAutoplayForUser() {
      if (!this.autoplayEnabled) return;
      this.autoplayPaused = true;
      this.stopAutoplay();
      clearTimeout(this.autoplayResumeTimer);
      var self = this;
      this.autoplayResumeTimer = setTimeout(function () {
        self.autoplayPaused = false;
        self.scheduleAutoplay();
      }, this.autoplaySpeed);
    }

    onPauseClick() {
      this.userPaused = !this.userPaused;
      this.pauseButton.classList.toggle('is-paused', this.userPaused);
      this.pauseButton.setAttribute('aria-label', this.userPaused ? 'Play slideshow' : 'Pause slideshow');
      if (this.userPaused) this.stopAutoplay();
      else this.scheduleAutoplay();
    }

    onPointerEnter() {
      if (!this.autoplayEnabled) return;
      this.autoplayPaused = true;
      this.stopAutoplay();
    }

    onPointerLeave() {
      if (!this.autoplayEnabled) return;
      if (this.contains(document.activeElement)) return;
      this.autoplayPaused = false;
      this.scheduleAutoplay();
    }

    onVisibilityChange() {
      if (document.hidden) this.stopAutoplay();
      else this.scheduleAutoplay();
    }

    /* ---------------- stacked fallback ---------------- */

    setupStackedObserver() {
      this.teardownStackedObserver();
      var self = this;
      this.stackedObserver = new IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
            var index = self.slides.indexOf(entry.target);
            if (index === -1 || index === self.currentIndex) continue;
            self.currentIndex = index;
            self.updateChrome();
            self.updateMedia();
          }
        },
        { threshold: [0.5] }
      );
      for (var i = 0; i < this.slides.length; i++) this.stackedObserver.observe(this.slides[i]);
    }

    teardownStackedObserver() {
      if (!this.stackedObserver) return;
      this.stackedObserver.disconnect();
      this.stackedObserver = null;
    }

    /* ---------------- theme editor ---------------- */

    onBlockSelect(event) {
      if (!this.contains(event.target)) return;
      var slide = event.target.closest('.fvs__slide');
      var index = this.slides.indexOf(slide);
      if (index === -1) return;
      this.autoplayPaused = true;
      this.stopAutoplay();
      this.goTo(index, { instant: true, force: true });
    }

    onBlockDeselect(event) {
      if (!this.contains(event.target)) return;
      this.autoplayPaused = false;
      this.scheduleAutoplay();
    }
  }

  customElements.define('fullscreen-vertical-slider', FullscreenVerticalSlider);
})();
