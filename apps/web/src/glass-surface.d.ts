import type { CSSProperties, ReactNode } from "react";

export type GlassSurfaceConfig = {
  width: number | string;
  height: number | string;
  borderRadius: number;
  borderWidth: number;
  brightness: number;
  opacity: number;
  blur: number;
  displace: number;
  backgroundOpacity: number;
  saturation: number;
  distortionScale: number;
  redOffset: number;
  greenOffset: number;
  blueOffset: number;
  xChannel: "R" | "G" | "B";
  yChannel: "R" | "G" | "B";
  mixBlendMode: CSSProperties["mixBlendMode"];
};

declare function GlassSurface(props: Partial<GlassSurfaceConfig> & {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): ReactNode;

export default GlassSurface;
