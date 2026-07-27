"use client";

/**
 * EntityLink (LIFEOS-029, Features 6–8).
 *
 * The universal way to reference an entity anywhere in the app. Clicking (or
 * Enter/Space) opens the entity in the unified inspector — one implementation,
 * every surface. Hovering or focusing reveals an instant HoverCard preview. Fully
 * keyboard accessible with proper roles and labels.
 */

import { useRef, useState } from "react";
import HoverCard from "@/components/entity/HoverCard";
import { openInspector } from "@/lib/entities/inspector";

export default function EntityLink({
  kind, id, children, className, showCard = true,
}: {
  kind: string;
  id: string;
  children: React.ReactNode;
  className?: string;
  showCard?: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setHovering(true), 120); };
  const hide = () => { if (timer.current) clearTimeout(timer.current); setHovering(false); };

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => openInspector(kind, id)}
        onFocus={showCard ? () => setHovering(true) : undefined}
        onBlur={hide}
        aria-haspopup="dialog"
        className={className ?? "text-left underline-offset-2 hover:underline"}
      >
        {children}
      </button>
      {showCard && hovering && (
        <span className="absolute left-0 top-full z-50 mt-1 block" onMouseEnter={show} onMouseLeave={hide}>
          <HoverCard kind={kind} id={id} onOpen={hide} />
        </span>
      )}
    </span>
  );
}
