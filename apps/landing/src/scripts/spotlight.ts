// Cursor-follow spotlight. [data-spotlight] is a zero-size wrapper holding the
// dot field + glow, each centered on its origin; we move the wrapper ONLY via
// `transform` so the animation stays on the compositor thread. Do not "simplify"
// this into a mask-position / gradient-center animation: that repaints a
// viewport-sized layer every frame (a paint, not a composite) and tanks perf.
const REST = { x: 0.22, y: 0.92 };
const EASE = 0.12;
const SETTLE_PX = 0.5;

// True when the page must stay static: no pointer follow under reduced motion
// or on a touch-primary (coarse) device.
const prefersStatic = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(pointer: coarse)").matches;

export const initSpotlight = (): void => {
  const el = document.querySelector<HTMLElement>("[data-spotlight]");
  if (!el || prefersStatic()) {
    return;
  }

  const cur = { x: innerWidth * REST.x, y: innerHeight * REST.y };
  const target = { ...cur };
  let raf = 0;

  const frame = (): void => {
    cur.x += (target.x - cur.x) * EASE;
    cur.y += (target.y - cur.y) * EASE;
    el.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
    raf =
      Math.hypot(target.x - cur.x, target.y - cur.y) > SETTLE_PX ? requestAnimationFrame(frame) : 0;
  };

  globalThis.addEventListener(
    "pointermove",
    (e: PointerEvent) => {
      // Guards hybrid devices (laptop + touchscreen) firing touch events.
      if (e.pointerType === "touch") {
        return;
      }
      target.x = e.clientX;
      target.y = e.clientY;
      // Promote once per pointer session; never toggled per settle.
      el.style.willChange = "transform";
      if (!raf) {
        raf = requestAnimationFrame(frame);
      }
    },
    { passive: true },
  );
};
