import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ClientSearchField, type ClientSelection } from "./ClientSearchField";

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: vi.fn(),
  femmePutJson: vi.fn(),
}));

function renderField(
  onChange: (s: ClientSelection) => void = vi.fn(),
  value: ClientSelection = null,
  onCreateNew?: (q: string) => void,
) {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ClientSearchField value={value} onChange={onChange} onCreateNew={onCreateNew} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const sampleClients = [
  { id: 1, fullName: "Ana García", phone: "0981000001", email: null, ruc: null },
  { id: 2, fullName: "Ana Torres", phone: null, email: null, ruc: "80000005-6" },
];

describe("ClientSearchField", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the search input with correct label", () => {
    renderField();
    expect(screen.getByLabelText(/client/i)).toBeTruthy();
  });

  it("loads all clients on focus (empty query)", async () => {
    femmeJson.mockResolvedValue(sampleClients);
    renderField();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await waitFor(() => {
      expect(femmeJson).toHaveBeenCalledWith("/api/clients");
    });
    expect(await screen.findByText("Ana García", {}, { timeout: 1000 })).toBeTruthy();
  });

  it("searches after typing and debounce fires", async () => {
    femmeJson.mockResolvedValue(sampleClients);
    renderField();
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "an");
    await waitFor(() => expect(femmeJson).toHaveBeenCalledWith(expect.stringContaining("q=an")), {
      timeout: 1000,
    });
  });

  it("shows results in dropdown after search", async () => {
    femmeJson.mockResolvedValue(sampleClients);
    renderField();
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "an");
    expect(await screen.findByText("Ana García", {}, { timeout: 1000 })).toBeTruthy();
    expect(screen.getByText("Ana Torres")).toBeTruthy();
  });

  it("shows no results message and create new when no clients found", async () => {
    femmeJson.mockResolvedValue([]);
    const onCreateNew = vi.fn();
    renderField(vi.fn(), null, onCreateNew);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    expect(await screen.findByText(/no clients found/i, {}, { timeout: 1000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create new client/i })).toBeTruthy();
  });

  it("selects the only result on Enter", async () => {
    femmeJson.mockResolvedValue([sampleClients[0]]);
    const onChange = vi.fn();
    renderField(onChange);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "Ana");
    await screen.findByText("Ana García", {}, { timeout: 2000 });
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        type: "client",
        client: expect.objectContaining({ id: 1, fullName: "Ana García" }),
      }),
    );
  });

  it("calls onChange with selected client when result clicked", async () => {
    femmeJson.mockResolvedValue(sampleClients);
    const onChange = vi.fn();
    renderField(onChange);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "an");
    await screen.findByText("Ana García", {}, { timeout: 1000 });
    await userEvent.click(screen.getByRole("button", { name: /Ana García/i }));
    expect(onChange).toHaveBeenCalledWith({
      type: "client",
      client: expect.objectContaining({ id: 1, fullName: "Ana García" }),
    });
  });

  it("calls onChange with occasional when occasional option clicked", async () => {
    femmeJson.mockResolvedValue(sampleClients);
    const onChange = vi.fn();
    renderField(onChange);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "an");
    await screen.findByText("Ana García", {}, { timeout: 1000 });
    await userEvent.click(screen.getByRole("button", { name: /occasional client/i }));
    expect(onChange).toHaveBeenCalledWith({ type: "occasional" });
  });

  it("calls onCreateNew with query when create new clicked", async () => {
    femmeJson.mockResolvedValue([]);
    const onCreateNew = vi.fn();
    renderField(vi.fn(), null, onCreateNew);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "new");
    await screen.findByText(/no clients found/i, {}, { timeout: 1000 });
    await userEvent.click(screen.getByRole("button", { name: /create new client/i }));
    expect(onCreateNew).toHaveBeenCalledWith("new");
  });

  it("offers create new when results exist", async () => {
    femmeJson.mockResolvedValue(sampleClients);
    const onCreateNew = vi.fn();
    renderField(vi.fn(), null, onCreateNew);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await screen.findByText("Ana García", {}, { timeout: 1000 });
    expect(screen.getByRole("button", { name: /create new client/i })).toBeTruthy();
  });
});
