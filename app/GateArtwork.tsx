"use client";

import { useRef } from "react";
import type { GateState, GateVisualStyle } from "./types";

interface GateArtworkProps {
  style: GateVisualStyle;
  state: GateState;
  large?: boolean;
  onActivate?: () => void;
}

export function GateArtwork({ style, state, large = false, onActivate }: GateArtworkProps) {
  const previousState = useRef(state);
  const stoppedTransition = useRef<GateState | null>(null);
  if (state !== previousState.current) {
    stoppedTransition.current = previousState.current === "stopped" && state !== "stopped" ? state : null;
    previousState.current = state;
  }
  const fromStopped = stoppedTransition.current === state;
  const usesSwingMotion = style === "swing" || style === "ranch";
  const label = `${style} gate is ${state}. ${onActivate ? "Activate configured gate action." : ""}`;
  const content = (
    <span className={`gate-art gate-art--${style} ${usesSwingMotion ? "gate-art--swing-motion" : ""} gate-art--${state} ${fromStopped ? "gate-art--from-stopped" : ""} ${large ? "gate-art--large" : ""}`} aria-hidden="true">
      <span className="gate-scene">
        <span className="gate-post gate-post--left" />
        <span className="gate-post gate-post--right" />
        {style === "sliding" && <span className="sliding-panel"><span className="gate-slats" /></span>}
        {style === "swing" && <><span className="swing-panel swing-panel--left"><span className="gate-slats" /></span><span className="swing-panel swing-panel--right"><span className="gate-slats" /></span></>}
        {style === "ranch" && <><span className="swing-panel swing-panel--left ranch-panel"><span className="ranch-rails" /><span className="ranch-brace" /></span><span className="swing-panel swing-panel--right ranch-panel"><span className="ranch-rails" /><span className="ranch-brace" /></span></>}
        {style === "barrier" && <><span className="barrier-base" /><span className="barrier-arm"><span /><span /><span /></span></>}
        <span className="gate-ground" />
      </span>
    </span>
  );

  if (!onActivate) return <span role="img" aria-label={label}>{content}</span>;
  return <button className="gate-art-button" type="button" onClick={onActivate} aria-label={label}>{content}</button>;
}
