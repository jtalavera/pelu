import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type FloatingDropdownProps = {
  /**
   * Ref attached to the trigger/container element whose bounding rect is used
   * to position the floating panel (left edge, width, and below the bottom).
   */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Whether the dropdown is currently open. */
  open: boolean;
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
export const FloatingDropdown = forwardRef<HTMLDivElement, FloatingDropdownProps>(
  function FloatingDropdown({ anchorRef, open, children }, ref) {
    const [position, setPosition] = useState<{
      top: number;
      left: number;
      width: number;
    } | null>(null);

    const updatePosition = useCallback(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }, [anchorRef]);

    useLayoutEffect(() => {
      if (!open) {
        setPosition(null);
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

    if (!open || !position) return null;

    return createPortal(
      <div
        ref={ref}
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          width: position.width,
          zIndex: 50,
        }}
      >
        {children}
      </div>,
      document.body,
    );
  },
);
