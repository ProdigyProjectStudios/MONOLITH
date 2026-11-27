"use client";
import { useRef, useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import type {
  FieldEngine,
  FieldSystem,
  FieldLink,
} from "./overview/fieldEngine";
import css from "./HandoffAtlas.module.css";

export default function RoutePassage({
  systems,
  route,
  scale,
  paused,
}: {
  systems: FieldSystem[];
  route: FieldLink;
  scale?: { events: number; handoffs: number };
  paused: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<FieldEngine | null>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let closed = false;
    let fx: FieldEngine | undefined;
    function lost() {
      setEngine(null);
    }
    el.addEventListener("webglcontextlost", lost);
    import("./overview/fieldEngine")
      .then(({ FieldEngine }) => {
        if (closed) return;
        fx = new FieldEngine(el, "route");
        setEngine(fx);
      })
      .catch(() => {
        if (!closed) setEngine(null);
      });
    return () => {
      closed = true;
      el.removeEventListener("webglcontextlost", lost);
      fx?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!engine) return;
    const ends = [route.source, route.target].flatMap((name) =>
      systems.filter((s) => s.name === name),
    );
    engine.setData(ends, [route], scale);
    engine.renderStill();
  }, [engine, systems, route, scale]);
  useEffect(() => {
    const el = canvas.current;
    if (!engine || !el) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    function sync() {
      engine?.setActive(
        visible && !document.hidden && !paused && !preference.matches,
      );
    }
    const resize = () => engine.resize(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    resize();
    observer.observe(el);
    intersection.observe(el);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      engine.setActive(false);
      observer.disconnect();
      intersection.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [engine, paused]);
  return (
    <div
      className={css.plot}
      data-renderer={engine ? "webgl" : "static"}
      aria-hidden="true"
    >
      {!engine && (
        <div className={css.staticRoute}>
          <i />
          <span />
          <ArrowRight size={18} />
          <i />
        </div>
      )}
      <canvas ref={canvas} />
    </div>
  );
}
