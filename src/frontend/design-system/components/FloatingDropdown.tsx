import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type FloatingDropdownProps = {
  /**
   * Ref attached to the trigger/container element whose bounding rect is used
   * to position the floating panel (left edge and below the bottom).
   */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Whether the dropdown is currently open. */
  open: boolean;
  /**
   * Fixed pixel width for the panel. Defaults to the anchor element's width.
   * Use this for pickers (e.g. a calendar) that need a fixed size unrelated
   * to the trigger width.
   */
  width?: number;
  children: ReactNode;
};

/**
 * Portal-based floating-dropdown shell.
 *
 * Renders `children` in a `position: fixed` div appended to `document.body`,
 * anchored below the element referenced by `anchorRef` and matching its width.
 * This avoids the common issue where an `absolute` dropdown is clipped or grows
 * the layout when rendered inside an `overflow` or scroll ancestor.
 *
 * Usage:
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const panelRef = useRef<HTMLDivElement>(null);
 *
 * <div ref={containerRef} className="relative w-full">
 *   <input ... />
 *   <FloatingDropdown anchorRef={containerRef} open={isOpen} ref={panelRef}>
 *     <ul role="listbox" ...>...</ul>
 *   </FloatingDropdown>
 * </div>
 * ```
 *
 * The forwarded `ref` (panelRef) can be used in the parent's outside-click
 * handler to distinguish clicks on the portal from outside clicks:
 * ```tsx
 * if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
 * ```
 *
 * Closing the dropdown (Escape / outside click) is the caller's responsibility.
 */
/** Gap (px) between the anchor and the floating panel, and the minimum viewport inset. */
const GAP = 4;

export const FloatingDropdown = forwardRef<HTMLDivElement, FloatingDropdownProps>(
  function FloatingDropdown({ anchorRef, open, width: fixedWidth, children }, ref) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [anchorRect, setAnchorRect] = useState<{
      top: number;
      bottom: number;
      left: number;
      width: number;
    } | null>(null);
    /** Measured panel height; drives the flip/clamp decision below. */
    const [panelHeight, setPanelHeight] = useState(0);

    const updatePosition = useCallback(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchorRect({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      });
    }, [anchorRef]);

    useLayoutEffect(() => {
      if (!open) {
        setAnchorRect(null);
        return;
      }
      updatePosition();
      window.addEventListener("resize", updatePosition);
      // Capture-phase scroll listener repositions the panel as the user scrolls
      // any ancestor container (e.g. the table's overflow container).
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }, [open, updatePosition]);

    // Measure the panel once it renders (and whenever its content resizes) so we
    // can keep it inside the viewport.
    useLayoutEffect(() => {
      if (!open) {
        setPanelHeight(0);
        return;
      }
      const el = panelRef.current;
      if (!el) return;
      const measure = () => setPanelHeight(el.offsetHeight);
      measure();
      // ResizeObserver is absent in some test environments (jsdom); a one-time
      // measure above is enough there.
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }, [open, anchorRect]);

    if (!open || !anchorRect) return null;

    const width = fixedWidth ?? anchorRect.width;
    const viewportHeight = window.innerHeight;
    // Default: open below the anchor. If the panel would overflow the bottom edge,
    // flip it above the anchor when there is room, otherwise clamp it into view so
    // its options are always reachable (e.g. a service field low on a long page).
    let top = anchorRect.bottom + GAP;
    if (panelHeight > 0 && top + panelHeight > viewportHeight - GAP) {
      const flippedTop = anchorRect.top - GAP - panelHeight;
      top = flippedTop >= GAP ? flippedTop : Math.max(GAP, viewportHeight - panelHeight - GAP);
    }

    return createPortal(
      <div
        ref={(node) => {
          panelRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        style={{
          position: "fixed",
          top,
          left: anchorRect.left,
          width,
          // 1100 keeps the panel above modals (z-[1000]) and drawers.
          zIndex: 1100,
        }}
      >
        {children}
      </div>,
      document.body,
    );
  },
);
