// swipe-deck.js — the shared touch gesture for full-window card decks: the
// Meal Plan recipe notifications and the Media news notifications. Moved
// verbatim out of mealplan-ui.js (NEWS_INTAKE_DESIGN.md §3.4) so both decks
// share one version of it. Uses the `.eat-swipe-*` card markup and styles.
//
// A horizontal drag past the threshold flings the card off and calls onAccept
// (right) or onDismiss (left) with the card element; a vertical drag is left to
// the deck's native scroll-snap so up/down browses. A flipped card (its back
// face scrolls on its own) is never flung. Touch only; the on-card buttons are
// the pointer/keyboard path.

export function attachSwipeGesture(root, { onAccept, onDismiss, threshold = 90 } = {}) {
  if (!root) return;
  let swipeCard = null, swipeStartX = 0, swipeStartY = 0, swipeAxis = null;
  const swipeLabels = (card) => ({
    add: card.querySelector(".eat-swipe-action-add"),
    del: card.querySelector(".eat-swipe-action-del"),
    inner: card.querySelector(".eat-swipe-card-inner")
  });
  root.addEventListener("touchstart", (e) => {
    const card = e.target.closest(".eat-swipe-card");
    if (card && card.querySelector(".eat-swipe-flip.is-flipped")) { swipeCard = null; return; }
    swipeCard = card || null;
    if (!card) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeAxis = null;
  }, { passive: true });
  root.addEventListener("touchmove", (e) => {
    if (!swipeCard) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    if (!swipeAxis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipeAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (swipeAxis !== "x") return; // vertical → let the deck scroll natively
    e.preventDefault(); // we own this horizontal gesture now
    const { add, del, inner } = swipeLabels(swipeCard);
    if (inner) { inner.style.transition = "none"; inner.style.transform = `translateX(${dx}px) rotate(${dx * 0.02}deg)`; }
    const t = Math.min(1, Math.abs(dx) / 120);
    if (add) add.style.opacity = dx > 0 ? t : 0;
    if (del) del.style.opacity = dx < 0 ? t : 0;
  }, { passive: false });
  root.addEventListener("touchend", (e) => {
    if (!swipeCard) return;
    const card = swipeCard; const axis = swipeAxis;
    swipeCard = null; swipeAxis = null;
    if (axis !== "x") return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const { add, del, inner } = swipeLabels(card);
    if (dx > threshold) {
      if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = "translateX(120%) rotate(6deg)"; }
      setTimeout(() => onAccept?.(card), 170); // let the fling show before the re-render
    } else if (dx < -threshold) {
      if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = "translateX(-120%) rotate(-6deg)"; }
      setTimeout(() => onDismiss?.(card), 170);
    } else {
      if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = ""; }
      if (add) add.style.opacity = 0;
      if (del) del.style.opacity = 0;
    }
  }, { passive: true });
}
