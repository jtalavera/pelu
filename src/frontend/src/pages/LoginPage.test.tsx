import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router-dom";
import i18n from "../i18n";
import LoginPage from "./LoginPage";

describe("LoginPage", () => {
  it("submits email and password via form POST to login API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "t" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nextProvider i18n={i18n}>
        <BrowserRouter>
          <LoginPage />
        </BrowserRouter>
      </I18nextProvider>,
    );

    await userEvent.type(screen.getByLabelText(/email/i), "admin@demo.com");
    await userEvent.type(screen.getByLabelText(/password/i), "Demo123!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.body).toContain("admin@demo.com");

    vi.unstubAllGlobals();
  });
});
