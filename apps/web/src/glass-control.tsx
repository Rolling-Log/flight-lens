"use client";

import type { ComponentPropsWithRef } from "react";
import GlassSurface, { type GlassSurfaceConfig } from "./glass-surface";

export const controlGlassConfig = {
  borderRadius: 30, borderWidth: 0.08, backgroundOpacity: 0.1,
  blur: 2, displace: 0, distortionScale: -36, brightness: 80, opacity: 0.9,
  redOffset: 0, greenOffset: 2, blueOffset: 4, saturation: 1.25,
  mixBlendMode: "screen",
} satisfies Partial<GlassSurfaceConfig>;

function GlassControlMaterial() {
  return <span className="glass-control-material" aria-hidden="true">
    <span className="glass-control-tint" />
    <GlassSurface as="span" {...controlGlassConfig} width="100%" height="100%" className="glass-control-lens" />
  </span>;
}

export function GlassButton({ className = "", children, type = "button", ...props }: ComponentPropsWithRef<"button">) {
  return <button {...props} type={type} className={`glass-button ${className}`}>
    <GlassControlMaterial />{children}
  </button>;
}

export function GlassLink({ className = "", children, ...props }: ComponentPropsWithRef<"a">) {
  return <a {...props} className={`glass-button ${className}`}><GlassControlMaterial />{children}</a>;
}

export function GlassSelection({ className }: { className: string }) {
  return <span className={`glass-selection ${className}`} aria-hidden="true"><GlassControlMaterial /></span>;
}
