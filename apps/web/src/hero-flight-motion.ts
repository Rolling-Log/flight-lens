export const FLIGHT_PERIOD = 24;
export const RETURN_DURATION = 1.05;

export function smoothStep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function flightPose(seconds: number) {
  const phase = (seconds % FLIGHT_PERIOD) / FLIGHT_PERIOD * Math.PI * 2;
  return {
    retreat: (1 - Math.cos(phase)) / 2,
    bank: .226 + .018 * Math.sin(phase) + .006 * Math.sin(3 * phase),
    yaw: -1.174 + .045 * Math.sin(phase),
    pitch: -.226 + .025 * Math.sin(phase) + .004 * Math.sin(4 * phase),
    lift: .055 * Math.sin(3 * phase) + .018 * Math.sin(7 * phase),
    sway: .32 * Math.sin(phase) + .035 * Math.sin(3 * phase),
  };
}

export class FlightClock {
  seconds = 0;
  mode: "flight" | "drag" | "return" = "flight";
  returnElapsed = 0;
  private resumeElapsed = 1;

  grab() {
    this.mode = "drag";
    this.returnElapsed = 0;
    this.resumeElapsed = 0;
  }

  release(reducedMotion: boolean) {
    this.mode = reducedMotion ? "flight" : "return";
    this.returnElapsed = reducedMotion ? RETURN_DURATION : 0;
  }

  advance(delta: number, playing: boolean, reducedMotion: boolean) {
    if (this.mode === "return") {
      this.returnElapsed = reducedMotion ? RETURN_DURATION : Math.min(RETURN_DURATION, this.returnElapsed + delta);
      if (this.returnElapsed === RETURN_DURATION) this.mode = "flight";
    } else if (this.mode === "flight" && playing) {
      this.resumeElapsed = Math.min(1, this.resumeElapsed + delta / .65);
      this.seconds = (this.seconds + delta * smoothStep(this.resumeElapsed)) % FLIGHT_PERIOD;
    }
  }

  get returnProgress() { return smoothStep(this.returnElapsed / RETURN_DURATION); }
}
