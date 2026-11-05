import { beforeEach, describe, expect, it } from "vitest";
import { render } from "../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import { Modal, ThemeProvider } from "@design-system";
import i18n from "../i18n";

function Dialogs({ a, b }: { a: boolean; b: boolean }) {
  // Inline onClose handlers: a new function on every render, like the screens that host the modals.
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <Modal open={a} onClose={() => undefined} title="A">
          a
        </Modal>
        <Modal open={b} onClose={() => undefined} title="B">
          b
        </Modal>
      </ThemeProvider>
    </I18nextProvider>
  );
}

describe("Modal page-scroll lock", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  it("gives the page its scroll back after stacked dialogs close in any order, even across re-renders", () => {
    const { rerender } = render(<Dialogs a b={false} />);
    rerender(<Dialogs a b />);
    // Host screens re-render while the dialogs are open (polling, state updates).
    rerender(<Dialogs a b />);
    rerender(<Dialogs a b />);
    expect(document.body.style.overflow).toBe("hidden");
    // The first one opened closes first.
    rerender(<Dialogs a={false} b />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Dialogs a={false} b={false} />);
    expect(document.body.style.overflow).toBe("");
  });
});
