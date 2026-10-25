"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// One surface moves between the existing controls, leaving their keyboard and
// selection behavior with Radix (or the native buttons on the login page).
export function SlidingCapsule({
  className,
  activeSelector = '[role="tab"][data-state="active"]',
  itemSelector = '[role="tab"]',
}: { className?: string; activeSelector?: string; itemSelector?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const capsule = ref.current;
    const container = capsule?.parentElement;
    if (!capsule || !container) return;
    let ready = false;
    let disposed = false;
    let frame = 0;

    function measure() {
      if (!capsule || !container) return;
      const active = container.querySelector<HTMLElement>(activeSelector);
      if (!active || !active.getClientRects().length) {
        capsule.style.opacity = "0";
        container.removeAttribute("data-capsule-ready");
        ready = false;
        return;
      }
      const bounds = container.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      if (!ready) capsule.style.transition = "none";
      capsule.style.width = `${target.width}px`;
      capsule.style.height = `${target.height}px`;
      capsule.style.transform = `translate3d(${target.left - bounds.left + container.scrollLeft - container.clientLeft}px, ${target.top - bounds.top + container.scrollTop - container.clientTop}px, 0)`;
      capsule.style.opacity = "1";
      container.setAttribute("data-capsule-ready", "true");
      if (!ready) {
        // Place the initial capsule before enabling subsequent transitions.
        capsule.getBoundingClientRect();
        capsule.style.removeProperty("transition");
        ready = true;
      }
    }
    function schedule() {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    container.querySelectorAll(itemSelector).forEach((item) => resize.observe(item));
    const mutation = new MutationObserver(schedule);
    mutation.observe(container, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["data-state", "aria-selected", "aria-pressed", "aria-current"],
    });
    measure();
    document.fonts.ready.then(schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      container.removeAttribute("data-capsule-ready");
    };
  }, [activeSelector, itemSelector]);

  return <span ref={ref} aria-hidden="true" data-slot="sliding-capsule" className={cn(
    "pointer-events-none absolute top-0 left-0 z-0 rounded-md border border-transparent bg-background opacity-0 shadow-sm transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:border-input dark:bg-input/30",
    className,
  )} />;
}
