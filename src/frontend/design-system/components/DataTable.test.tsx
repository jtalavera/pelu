import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "./DataTable";

type Row = { id: number; name: string; amount: number; voided?: boolean };

const rows: Row[] = [
  { id: 1, name: "Ana", amount: 1000 },
  { id: 2, name: "Beatriz", amount: 2000, voided: true },
];

const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: (r) => r.name },
  { id: "amount", header: "Amount", align: "right", cell: (r) => String(r.amount) },
];

const originalMatchMedia = window.matchMedia;
function setPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("DataTable", () => {
  it("renders the Propinas-style table: uppercase header, one row per item, amounts on the right", () => {
    render(<DataTable<Row> testId="t" rows={rows} columns={columns} getRowId={(r) => r.id} rowTestId={(r) => `row-${r.id}`} />);
    const table = screen.getByTestId("t");
    expect(table.tagName).toBe("TABLE");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Name", "Amount"]);
    expect(table.querySelector("thead tr")!.className).toContain("uppercase");
    expect(headers[1].className).toContain("text-right");
    const row = screen.getByTestId("row-1");
    expect(row.className).toContain("h-11");
    expect(within(row).getAllByRole("cell")[1].className).toContain("text-right");
  });

  it("dims rows tagged as muted", () => {
    render(
      <DataTable<Row>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        rowTestId={(r) => `row-${r.id}`}
        rowTone={(r) => (r.voided ? "muted" : undefined)}
      />,
    );
    expect(screen.getByTestId("row-1").className).toContain("text-ink");
    expect(screen.getByTestId("row-2").className).toContain("text-ink-3");
  });

  it("opens a row with a click, Enter or Space, but not from its actions", () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    render(
      <DataTable<Row>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        rowTestId={(r) => `row-${r.id}`}
        onRowClick={onRowClick}
        rowLabel={(r) => `Open ${r.name}`}
        rowActions={(r) => (
          <button type="button" data-testid={`act-${r.id}`} onClick={() => onAction(r.id)}>
            ⋮
          </button>
        )}
      />,
    );
    const row = screen.getByTestId("row-1");
    expect(row.getAttribute("aria-label")).toBe("Open Ana");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onRowClick).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId("act-1"));
    expect(onAction).toHaveBeenCalledWith(1);
    expect(onRowClick).toHaveBeenCalledTimes(3);
    // A key pressed inside the actions does not open the row either.
    fireEvent.keyDown(screen.getByTestId("act-1"), { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });

  it("shows the empty label under the header when there are no rows", () => {
    render(
      <DataTable<Row> rows={[]} columns={columns} getRowId={(r) => r.id} emptyLabel="Nothing here" emptyTestId="empty" />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByTestId("empty").textContent).toBe("Nothing here");
  });

  it("turns each row into a card on a phone when a card is given", () => {
    setPhone(true);
    render(
      <DataTable<Row>
        testId="desktop"
        mobileTestId="phone"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        rowTestId={(r) => `row-${r.id}`}
        mobileCard={(r) => <span>{`card ${r.name}`}</span>}
        rowActions={() => <button type="button">⋮</button>}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("phone").tagName).toBe("UL");
    expect(within(screen.getByTestId("row-1")).getByText("card Ana")).toBeTruthy();
    expect(within(screen.getByTestId("row-2")).getByRole("button")).toBeTruthy();
  });

  it("keeps the table (scrolling sideways) on a phone when no card is given", () => {
    setPhone(true);
    render(<DataTable<Row> rows={rows} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
