"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

type GlassDialogProps = {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  className: string;
  labelledBy: string;
  describedBy?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  variant?: "modal" | "drawer";
};

// Several dialogs can overlap briefly while one closes and the next opens.
const scrollLocks = new Set<HTMLDialogElement>();
let previousOverflow = "";
function lockScroll(dialog: HTMLDialogElement) {
  if (!scrollLocks.size) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks.add(dialog);
}
function unlockScroll(dialog: HTMLDialogElement) {
  if (scrollLocks.delete(dialog) && !scrollLocks.size) document.body.style.overflow = previousOverflow;
}

/** One native focus/inert layer and one reversible, critically damped transition.
 * Only the empty glass shell changes shape; text never stretches with it. */
export function GlassDialog({ open, onClose, children, className, labelledBy, describedBy, triggerRef, variant = "modal" }: GlassDialogProps) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const hostRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLSpanElement>(null);
  const control = useRef<((next: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    if (!mounted) return;
    const host = hostRef.current!;
    const panel = panelRef.current!;
    const shape = shapeRef.current!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let progress = 0;
    let velocity = 0;
    let target = 0;
    let frame = 0;
    let lastTime = 0;
    let trigger: HTMLElement | null = null;
    let origin: DOMRect | null = null;
    let destination: DOMRect;
    let radius = 30;

    function measure() {
      const transform = panel.style.transform;
      panel.style.transform = "none";
      destination = panel.getBoundingClientRect();
      panel.style.transform = transform;
      radius = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 30;
      Object.assign(shape.style, {
        left: `${destination.left}px`, top: `${destination.top}px`,
        width: `${destination.width}px`, height: `${destination.height}px`,
      });
    }

    function paint() {
      const p = Math.max(0, Math.min(1, progress));
      const reduced = motion.matches || !origin;
      const content = reduced ? p : Math.max(0, Math.min(1, (p - 0.55) / 0.4));
      host.style.setProperty("--dialog-reveal", String(p));
      panel.style.opacity = String(content);
      panel.style.transform = reduced ? "none" : `translateY(${(1 - p) * 8}px)`;
      // Keep live controls available during the transition, including Escape.
      shape.style.opacity = reduced ? "0" : String(1 - content);
      if (origin && !reduced) {
        const sx = (origin.width + (destination.width - origin.width) * p) / destination.width;
        const sy = (origin.height + (destination.height - origin.height) * p) / destination.height;
        const r = Math.min(origin.height / 2, 30) + (radius - Math.min(origin.height / 2, 30)) * p;
        shape.style.transform = `translate3d(${(origin.left - destination.left) * (1 - p)}px, ${(origin.top - destination.top) * (1 - p)}px, 0) scale(${sx}, ${sy})`;
        // Counter-scale the radius so a capsule stays rounded throughout flight.
        shape.style.borderRadius = `${r / sx}px / ${r / sy}px`;
      }
    }

    function finish() {
      progress = target;
      velocity = 0;
      paint();
      host.dataset.motionState = target ? "settled" : "closed";
      if (!target) {
        host.close();
        unlockScroll(host);
        if (!document.querySelector("dialog[open]") && trigger?.isConnected) {
          if (trigger.getClientRects().length) trigger.focus({ preventScroll: true });
          else document.querySelector<HTMLElement>(".mobile-nav-toggle")?.focus({ preventScroll: true });
        }
      }
    }

    function tick(time: number) {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      // Exact critical-spring step, independent of refresh rate. Retargeting
      // retains both position and velocity; there is no jelly overshoot.
      const frequency = 22;
      const displacement = progress - target;
      const coefficient = velocity + frequency * displacement;
      const decay = Math.exp(-frequency * dt);
      progress = target + (displacement + coefficient * dt) * decay;
      velocity = (velocity - frequency * coefficient * dt) * decay;
      paint();
      if (Math.abs(progress - target) < 0.001 && Math.abs(velocity) < 0.015) {
        frame = 0;
        finish();
      } else frame = requestAnimationFrame(tick);
    }

    control.current = (next) => {
      target = next ? 1 : 0;
      if (next && !host.open) {
        trigger = triggerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        const rect = trigger?.getBoundingClientRect();
        origin = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth ? rect : null;
        // The body is a fallback focus target, not a meaningful morph origin.
        if (trigger === document.body) origin = null;
        progress = 0;
        velocity = 0;
        host.showModal();
        lockScroll(host);
        measure();
        paint();
        panel.querySelector<HTMLElement>("[autofocus], button:not([disabled]), input:not([disabled]), [href]")?.focus({ preventScroll: true });
      }
      if (!host.open) return;
      if (!next && !trigger?.isConnected) origin = null;
      host.dataset.motionState = next ? "opening" : "closing";
      if (motion.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        finish();
      } else if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    const resize = new ResizeObserver(() => { if (host.open) { measure(); paint(); } });
    resize.observe(panel);
    const onResize = () => { if (host.open) { measure(); paint(); } };
    const onMotionChange = () => { if (host.open && motion.matches) { cancelAnimationFrame(frame); frame = 0; finish(); } };
    window.addEventListener("resize", onResize);
    motion.addEventListener("change", onMotionChange);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", onResize);
      motion.removeEventListener("change", onMotionChange);
      host.close();
      unlockScroll(host);
      control.current = null;
    };
  }, [mounted, triggerRef]);

  useLayoutEffect(() => { control.current?.(open); }, [mounted, open, triggerRef]);

  return mounted ? createPortal(<dialog ref={hostRef} className={`glass-dialog-host glass-dialog-${variant}`} aria-labelledby={labelledBy}
    aria-describedby={describedBy} data-motion-state="closed"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const items = [...panelRef.current!.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length && !element.closest("[inert], [hidden]"));
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <span ref={shapeRef} className="glass-dialog-shape" aria-hidden="true" />
    <div ref={panelRef} className={`glass-dialog-panel ${className}`}>{children}</div>
  </dialog>, document.body) : null;
}
