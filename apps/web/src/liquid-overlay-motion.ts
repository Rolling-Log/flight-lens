"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP);

export type LiquidOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const emptyLiquidOrigin: LiquidOrigin = {
  left: 0,
  top: 0,
  width: 48,
  height: 48,
};

export function liquidOriginFromElement(element: HTMLElement): LiquidOrigin {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

type LiquidOverlayMotionOptions = {
  open: boolean;
  origin: LiquidOrigin;
  backdropRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  morphRef: RefObject<HTMLSpanElement | null>;
};

export function useLiquidOverlayMotion({
  open,
  origin,
  backdropRef,
  panelRef,
  morphRef,
}: LiquidOverlayMotionOptions) {
  useGSAP(() => {
    if (!open || !backdropRef.current || !panelRef.current || !morphRef.current) return;

    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    const morph = morphRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      backdrop.dataset.motionState = "reduced";
      gsap.set([backdrop, panel], { autoAlpha: 1, clearProps: "transform" });
      gsap.set(morph, { autoAlpha: 0 });
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    const startWidth = Math.max(1, origin.width);
    const startHeight = Math.max(1, origin.height);
    const endX = panelRect.left - origin.left;
    const endY = panelRect.top - origin.top;
    const endScaleX = panelRect.width / startWidth;
    const endScaleY = panelRect.height / startHeight;
    const finalRadius = Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 18;

    backdrop.dataset.motionEngine = "gsap-transform-map";
    backdrop.dataset.motionState = "running";

    // The settled backdrop is applied immediately so its full-screen blur is
    // composited once instead of being recalculated throughout the animation.
    gsap.set(backdrop, { autoAlpha: 1 });
    gsap.set(panel, { autoAlpha: 0 });
    gsap.set(morph, {
      autoAlpha: 1,
      left: origin.left,
      top: origin.top,
      width: startWidth,
      height: startHeight,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      borderRadius: Math.min(startHeight / 2, 32),
      transformOrigin: "0 0",
      force3D: true,
    });

    const timeline = gsap.timeline({
      onComplete: () => {
        backdrop.dataset.motionState = "settled";
        gsap.set(backdrop, { clearProps: "opacity,visibility" });
        gsap.set(panel, { clearProps: "opacity,visibility,transform,transform-origin" });
        gsap.set(morph, {
          autoAlpha: 0,
          clearProps: "left,top,width,height,transform,transform-origin,border-radius",
        });
      },
    });

    timeline
      .to(morph, {
        x: endX,
        y: endY,
        scaleX: endScaleX,
        scaleY: endScaleY,
        borderRadius: finalRadius,
        duration: 0.28,
        ease: "power3.out",
      }, 0)
      .set(panel, { autoAlpha: 1 }, 0.22)
      .to(morph, { autoAlpha: 0, duration: 0.06, ease: "power1.out" }, 0.22);
  }, {
    dependencies: [open, origin.left, origin.top, origin.width, origin.height],
    scope: backdropRef,
    revertOnUpdate: true,
  });
}
