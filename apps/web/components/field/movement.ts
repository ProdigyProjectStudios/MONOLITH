import { useCallback, useEffect, useRef, useState } from "react";
import {
  homeCamera,
  type Camera,
  type Node,
  type Point,
  type Route,
  type Scene,
} from "./scene";

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const point = (a: Point, b: Point, t: number) => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
});
const ease = (t: number) => 1 - (1 - t) ** 3;

export function useCamera(animate: boolean) {
  const [view, setView] = useState<Camera>(homeCamera);
  const live = useRef(view),
    destination = useRef(view),
    frame = useRef(0);
  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current);
    destination.current = live.current;
  }, []);
  const move = useCallback((next: Camera) => {
    cancelAnimationFrame(frame.current);
    destination.current = live.current = next;
    setView(next);
  }, []);
  const glide = useCallback(
    (target: Camera) => {
      cancelAnimationFrame(frame.current);
      if (!animate) {
        move(target);
        return;
      }
      const a = live.current,
        start = performance.now();
      destination.current = target;
      const tick = (now: number) => {
        const u = Math.min(1, (now - start) / 185),
          t = ease(u);
        const next =
          u === 1
            ? target
            : { ...point(a, target, t), zoom: mix(a.zoom, target.zoom, t) };
        live.current = next;
        setView(next);
        if (u < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [animate, move],
  );
  useEffect(() => {
    if (!animate) move(destination.current);
    return () => cancelAnimationFrame(frame.current);
  }, [animate, move]);
  return { view, live, destination, move, glide, halt };
}

// Match records by their source identity across observations. Value and position
// ease together, while the new record's exact count stays available to inspection.
export function useSceneTransition(target: Scene, animate: boolean) {
  const active = useRef(target),
    [interpolated, setInterpolated] = useState<Scene>();
  useEffect(() => {
    const source = active.current;
    const previous = new Map(source.nodes.map((n) => [n.key, n]));
    const changed = target.nodes.some((n) => {
      const p = previous.get(n.key);
      return (
        p &&
        Math.abs(p.x - n.x) +
          Math.abs(p.y - n.y) +
          Math.abs(p.radius - n.radius) >
          0.35
      );
    });
    if (
      !animate ||
      source.width !== target.width ||
      source.height !== target.height ||
      !changed
    ) {
      active.current = target;
      setInterpolated(undefined);
      return;
    }
    const routes = new Map(source.routes.map((r) => [r.key, r]));
    const start = performance.now();
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / 240),
        t = ease(u);
      if (u >= 1) {
        active.current = target;
        setInterpolated(undefined);
        return;
      }
      if (now - last > 28) {
        const nodes: Node[] = target.nodes.map((n) => {
          const a = previous.get(n.key);
          return a
            ? { ...n, ...point(a, n, t), radius: mix(a.radius, n.radius, t) }
            : n;
        });
        const byId = new Map(nodes.map((n) => [n.key, n]));
        const edges: Route[] = target.routes.map((r) => {
          const a = routes.get(r.key);
          return a
            ? {
                ...r,
                from: byId.get(r.from.key)!,
                to: byId.get(r.to.key)!,
                a: point(a.a, r.a, t),
                b: point(a.b, r.b, t),
                c: point(a.c, r.c, t),
                d: point(a.d, r.d, t),
                strength: mix(a.strength, r.strength, t),
              }
            : r;
        });
        active.current = { ...target, nodes, routes: edges };
        setInterpolated(active.current);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);
  return interpolated ?? target;
}
