import { type ComponentType, type ReactElement, type ReactNode } from "react";
import * as RTL from "@testing-library/react";
import type { RenderOptions } from "@testing-library/react";
import { TourProvider } from "../tour/TourContext";

const originalRender = RTL.render;

type WrapperProps = { children: ReactNode };

/**
 * `useTour` requires `TourProvider`. The real app wraps this in `AppShell`; unit tests
 * should import `render` from here so pages that register tours do not throw.
 */
export function render(
  ui: ReactElement,
  options?: RenderOptions,
): ReturnType<typeof originalRender> {
  const userWrapper = options?.wrapper as ComponentType<WrapperProps> | undefined;
  return originalRender(ui, {
    ...options,
    wrapper: function TourTestWrapper({ children }) {
      if (userWrapper) {
        const Inner = userWrapper;
        return (
          <TourProvider>
            <Inner>{children}</Inner>
          </TourProvider>
        );
      }
      return <TourProvider>{children}</TourProvider>;
    },
  });
}

export {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

export type { RenderResult } from "@testing-library/react";
