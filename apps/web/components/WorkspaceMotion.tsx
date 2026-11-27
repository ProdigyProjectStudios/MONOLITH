"use client";

import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { AnimatePresence, usePresence } from "motion/react";

export { AnimatePresence };
type Kind = "drawer" | "search" | "dialog" | "side" | "menu";
const reduce = "(prefers-reduced-motion: reduce)";

// AnimatePresence keeps the original subtree alive for its exit. Inertness
// prevents a retiring overlay from intercepting a click or keyboard focus.
export function usePanelMotion(kind: Kind) {
  const [present, remove] = usePresence();
  useEffect(() => {
    if (present || !remove) return;
    const preference = matchMedia(reduce);

    const changed = () => {
      if (preference.matches) remove();
    };
    preference.addEventListener("change", changed);
    // Also release when an ancestor hides the element and no animationend fires.
    const timeout = window.setTimeout(remove, preference.matches ? 0 : 280);
    return () => {
      clearTimeout(timeout);
      preference.removeEventListener("change", changed);
    };
  }, [present, remove]);
  return {
    "data-motion-surface": kind,
    "data-motion-phase": present ? "enter" : "exit",
    inert: !present,
    onAnimationEnd: (e: React.AnimationEvent<HTMLElement>) => {
      if (!present && e.target === e.currentTarget) remove?.();
    },
  };
}

export function MotionPanel({
  kind,
  as: Tag = "div",
  ...props
}: ComponentPropsWithoutRef<"div"> & { kind: Kind; as?: "div" | "aside" }) {
  const motion = usePanelMotion(kind);
  return <Tag {...props} {...motion} />;
}

const panels =
  "section, article, aside, [role=tabpanel], .panel, [data-scroll-panel]";
export function WorkspaceStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (
      !host ||
      !("IntersectionObserver" in window) ||
      !Element.prototype.animate
    )
      return;
    const preference = matchMedia(reduce);
    let stop: (() => void) | undefined;
    function observe() {
      stop?.();
      if (!host || preference.matches) return;
      const visited = new WeakSet<Element>();
      const animations = new Set<Animation>();
      const observer = new IntersectionObserver(
        (entries) => {
          const entering = entries.filter((e) => e.isIntersecting);
          for (const { target } of entering) observer.unobserve(target);
          entering.forEach(({ target }, i) => {
            // A container and its child can enter together. Move only the outer panel.
            if (
              entering.some(
                (e) => e.target !== target && e.target.contains(target),
              ) ||
              target.contains(document.activeElement)
            )
              return;
            const animation = target.animate(
              [
                { opacity: 0.62, translate: "0 13px" },
                { opacity: 1, translate: "0 0" },
              ],
              {
                id: "workspace-scroll-reveal",
                duration: 370,
                delay: Math.min(i, 3) * 32,
                easing: "cubic-bezier(.18,.72,.22,1)",
                fill: "backwards",
              },
            );
            animations.add(animation);
            animation.finished.then(
              () => animations.delete(animation),
              () => animations.delete(animation),
            );
          });
        },
        { threshold: 0 },
      );
      function register(el: Element) {
        if (
          visited.has(el) ||
          el.closest("[data-motion-surface],dialog,[aria-live=polite]")
        )
          return;
        visited.add(el);
        observer.observe(el);
      }
      function scan(el: Element) {
        if (!(el instanceof HTMLElement)) return;
        if (el.matches(panels)) register(el);
        el.querySelectorAll(panels).forEach(register);
      }
      scan(host);
      const mutations = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement) scan(n);
          });
          record.removedNodes.forEach((n) => {
            if (!(n instanceof HTMLElement) || host.contains(n)) return;
            observer.unobserve(n);
            n.querySelectorAll(panels).forEach((el) => observer.unobserve(el));
          });
        }
      });
      mutations.observe(host, { childList: true, subtree: true });
      stop = () => {
        observer.disconnect();
        mutations.disconnect();
        animations.forEach((a) => a.cancel());
      };
    }
    observe();
    preference.addEventListener("change", observe);
    return () => {
      stop?.();
      preference.removeEventListener("change", observe);
    };
  }, []);
  return (
    <div className="page-content" ref={ref}>
      {children}
    </div>
  );
}
