"use client";

import { useState, type PointerEvent } from "react";
import { Database, Megaphone, MessageCircle, Users } from "lucide-react";
import styles from "./workspace-loading.module.css";

export function WorkspaceLoading() {
  const [pulse, setPulse] = useState(0);

  function followPointer(event: PointerEvent<HTMLDivElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    element.style.setProperty("--loader-x", `${x * 7}px`);
    element.style.setProperty("--loader-y", `${y * 7}px`);
    element.style.setProperty("--loader-tilt-x", `${-y * 7}deg`);
    element.style.setProperty("--loader-tilt-y", `${x * 7}deg`);
  }

  function resetPointer(event: PointerEvent<HTMLDivElement>) {
    for (const property of ["--loader-x", "--loader-y", "--loader-tilt-x", "--loader-tilt-y"]) {
      event.currentTarget.style.removeProperty(property);
    }
  }

  return (
    <section className={styles.screen} aria-label="Workspace loading">
      <div className={styles.content}>
        <div className={styles.scene} onPointerMove={followPointer} onPointerLeave={resetPointer} onPointerCancel={resetPointer}>
          <div className={styles.constellation}>
            <div className={styles.glow} aria-hidden="true" />
            <div className={styles.outerRing} aria-hidden="true" />
            <div className={styles.orbit} aria-hidden="true"><span /></div>
            <div className={`${styles.satellite} ${styles.data}`} aria-hidden="true"><Database /></div>
            <div className={`${styles.satellite} ${styles.people}`} aria-hidden="true"><Users /></div>
            <div className={`${styles.satellite} ${styles.conversation}`} aria-hidden="true"><MessageCircle /></div>
            <button type="button" className={styles.logo} onClick={() => setPulse((value) => value + 1)} aria-label="Animate the ORMS logo" title="Tap for a little momentum">
              <span key={pulse} className={styles.ripple} aria-hidden="true" />
              <Megaphone aria-hidden="true" />
              <span className={styles.logoShine} aria-hidden="true" />
            </button>
            <span className={styles.spark} aria-hidden="true" />
          </div>
        </div>

        <div role="status" aria-live="polite" aria-atomic="true">
          <p className={styles.brand}>ORMS<span>.</span></p>
          <h1 className={styles.title}>Opening your workspace<span className={styles.dots} aria-hidden="true"><i /><i /><i /></span></h1>
          <p className={styles.description}>Your next conversation is almost here.</p>
        </div>
        <div className={styles.trail} aria-hidden="true"><span /></div>
      </div>
    </section>
  );
}
