"use client";

import { useEffect, useState, type ReactNode } from "react";
import GlassSurface, { type GlassSurfaceConfig } from "./glass-surface";

type LiquidGlassSurfaceProps = {
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  sceneClassName?: string;
  config?: Partial<GlassSurfaceConfig>;
  changeKey?: unknown;
  label: string;
};

const DEFAULT_CONFIG: GlassSurfaceConfig = {
  width: "100%",
  height: "100%",
  borderRadius: 20,
  borderWidth: 0.07,
  brightness: 50,
  opacity: 0.93,
  blur: 11,
  displace: 0,
  backgroundOpacity: 0,
  saturation: 1,
  distortionScale: -180,
  redOffset: 0,
  greenOffset: 10,
  blueOffset: 20,
  xChannel: "R",
  yChannel: "G",
  mixBlendMode: "difference",
};

export function LiquidGlassSurface({
  children,
  className = "",
  panelClassName = "",
  sceneClassName = "",
  config,
  changeKey,
  label,
}: LiquidGlassSurfaceProps) {
  const [glassState, setGlassState] = useState<"pending" | "active" | "fallback">("pending");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
      const isFirefox = /Firefox/.test(navigator.userAgent);
      const probe = document.createElement("div");
      probe.style.backdropFilter = "url(#glass-filter-probe)";
      setGlassState(!isWebkit && !isFirefox && probe.style.backdropFilter !== "" ? "active" : "fallback");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`liquid-glass-root ${className}`.trim()}
      data-liquid-root={label}
      data-glass-engine="react-bits-svg"
      data-glass-state={glassState}
      data-glass-fallback={glassState === "fallback" ? "svg-filter-unsupported" : undefined}
    >
      <div className={`liquid-glass-scene ${sceneClassName}`.trim()} aria-hidden="true" />
      <GlassSurface
        {...DEFAULT_CONFIG}
        {...config}
        className="liquid-glass-panel"
      >
        <div className={`liquid-glass-slot ${panelClassName}`.trim()} data-change-key={String(changeKey ?? "")}>{children}</div>
      </GlassSurface>
    </div>
  );
}
