(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const dotsHost = document.querySelector("#slide-dots");
  const currentLabel = document.querySelector("#current-slide");
  const totalLabel = document.querySelector("#total-slides");
  const progress = document.querySelector("#progress");
  const previous = document.querySelector("#prev");
  const next = document.querySelector("#next");
  const overview = document.querySelector("#overview");
  const overviewGrid = document.querySelector("#overview-grid");
  let current = 0;

  if (!slides.length) return;

  const twoDigits = (value) => String(value).padStart(2, "0");
  const slideName = (slide, index) => slide.dataset.title || `Slide ${index + 1}`;

  slides.forEach((slide, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "slide-dot";
    dot.setAttribute("aria-label", `Go to slide ${index + 1}: ${slideName(slide, index)}`);
    dot.addEventListener("click", () => showSlide(index));
    dotsHost.append(dot);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "overview-card";
    card.innerHTML = `<span>${twoDigits(index + 1)}</span><strong>${slideName(slide, index)}</strong>`;
    card.addEventListener("click", () => {
      showSlide(index);
      overview.close();
    });
    overviewGrid.append(card);
  });

  const dots = [...dotsHost.querySelectorAll(".slide-dot")];
  const cards = [...overviewGrid.querySelectorAll(".overview-card")];
  totalLabel.textContent = twoDigits(slides.length);

  function showSlide(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === current;
      slide.classList.toggle("active", active);
      slide.setAttribute("aria-hidden", String(!active));
      if (active) slide.scrollTop = 0;
    });
    dots.forEach((dot, dotIndex) => {
      if (dotIndex === current) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    cards.forEach((card, cardIndex) => {
      if (cardIndex === current) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    });
    currentLabel.textContent = twoDigits(current + 1);
    progress.style.width = `${((current + 1) / slides.length) * 100}%`;
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    document.title = `${slideName(slides[current], current)} — EC2 Serial Console Dashboard`;
  }

  function openOverview() {
    if (!overview.open) overview.showModal();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      console.warn("Fullscreen is unavailable in this browser context.", error);
    }
  }

  previous.addEventListener("click", () => showSlide(current - 1));
  next.addEventListener("click", () => showSlide(current + 1));
  document.querySelector("#overview-open").addEventListener("click", openOverview);
  document.querySelector("#overview-close").addEventListener("click", () => overview.close());
  document.querySelector("#fullscreen").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    document.querySelector("#fullscreen").setAttribute(
      "aria-label",
      document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen"
    );
  });

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (overview.open) {
      if (event.key === "Escape") overview.close();
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("a, input, textarea, select, [contenteditable='true']")) {
      return;
    }
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      showSlide(current + 1);
    } else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) {
      event.preventDefault();
      showSlide(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      showSlide(0);
    } else if (event.key === "End") {
      event.preventDefault();
      showSlide(slides.length - 1);
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFullscreen();
    } else if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      openOverview();
    }
  });

  let touchStartX = null;
  document.querySelector("#stage").addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
  }, { passive: true });
  document.querySelector("#stage").addEventListener("touchend", (event) => {
    if (touchStartX === null) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(deltaX) > 65) showSlide(current + (deltaX < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });

  showSlide(0);
})();
