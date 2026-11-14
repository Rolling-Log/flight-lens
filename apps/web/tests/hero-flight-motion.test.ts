import assert from "node:assert/strict";
import test from "node:test";
import { FLIGHT_PERIOD, FlightClock, RETURN_DURATION, flightPose } from "../src/hero-flight-motion.js";

test("flight position and velocity remain continuous across the loop", () => {
  assert.deepEqual(flightPose(0), flightPose(FLIGHT_PERIOD));
  assert.equal(flightPose(0).retreat, 0);
  assert.equal(flightPose(FLIGHT_PERIOD / 2).retreat, 1);
  const epsilon = .0001;
  const start = flightPose(0), before = flightPose(FLIGHT_PERIOD - epsilon), after = flightPose(epsilon);
  for (const key of Object.keys(start) as (keyof typeof start)[]) {
    const left = (start[key] - before[key]) / epsilon;
    const right = (after[key] - start[key]) / epsilon;
    assert.ok(Math.abs(left - right) < .0001, `${key} velocity jumps`);
  }
});

test("drag freezes flight and release returns before smoothly resuming", () => {
  const clock = new FlightClock();
  clock.advance(3, true, false);
  clock.grab();
  clock.advance(2, true, false);
  assert.equal(clock.seconds, 3);
  clock.release(false);
  clock.advance(RETURN_DURATION / 2, true, false);
  assert.equal(clock.mode, "return");
  assert.equal(clock.seconds, 3);
  assert.ok(Math.abs(clock.returnProgress - .5) < 1e-10);
  clock.advance(RETURN_DURATION / 2, true, false);
  assert.equal(clock.mode, "flight");
  assert.equal(clock.seconds, 3);
  assert.equal(clock.returnProgress, 1);
  clock.advance(.01, true, false);
  assert.ok(clock.seconds > 3 && clock.seconds < 3.001);
});

test("re-grabbing interrupts the return; user pause survives interaction", () => {
  const clock = new FlightClock();
  clock.advance(5, true, false);
  clock.grab(); clock.release(false);
  clock.advance(.4, false, false);
  clock.grab();
  clock.advance(1, false, false);
  assert.equal(clock.mode, "drag");
  assert.equal(clock.seconds, 5);
  clock.release(false);
  clock.advance(RETURN_DURATION, false, false);
  clock.advance(1, false, false);
  assert.equal(clock.mode, "flight");
  assert.equal(clock.seconds, 5);
});

test("reduced motion resets without a return animation", () => {
  const clock = new FlightClock();
  clock.grab(); clock.release(true);
  assert.equal(clock.mode, "flight");
  assert.equal(clock.returnProgress, 1);
  clock.advance(1, false, true);
  assert.equal(clock.seconds, 0);
});
