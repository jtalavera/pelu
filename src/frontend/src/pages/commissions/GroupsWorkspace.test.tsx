import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import { GroupsWorkspace } from "./GroupsWorkspace";

const api = vi.hoisted(() => ({
  getGroups: vi.fn(),
  getGroupServices: vi.fn(),
  getSettings: vi.fn(),
  assignGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));

const wrap = (initial = "/app/commissions/configurar/grupos") =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initial]}>
          <GroupsWorkspace />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );

const svc = (serviceId: number, name: string, over: Record<string, unknown> = {}) => ({
  serviceId,
  name,
  categoryName: "Peluquería",
  price: 100000,
  groupId: null,
  groupName: null,
  suggestion: null,
  ...over,
});

describe("HU-COM-16 · Grupos y servicios", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getGroups.mockResolvedValue([
      { id: 1, name: "Brushing", serviceCount: 1, serviceNames: ["Brushing pelo corto"], percent: 40 },
      { id: 2, name: "Tratamiento", serviceCount: 0, serviceNames: [], percent: null },
    ]);
    api.getGroupServices.mockImplementation(async (kind: string) =>
      kind === "PRODUCT"
        ? [svc(90, "Shampoo"), svc(91, "Acondicionador")]
        : [
            svc(10, "Baño de crema", { suggestion: { groupId: 2, groupName: "Tratamiento", reason: "bano de crema" } }),
            svc(11, "Aplicación de ampolla", { suggestion: { groupId: 2, groupName: "Tratamiento", reason: "apli" } }),
            svc(12, "Maquillaje"),
            svc(13, "Brushing pelo corto", { groupId: 1, groupName: "Brushing" }),
          ],
    );
    api.getSettings.mockResolvedValue({ defaultPercentService: 10, defaultPercentProduct: 5 });
    api.assignGroups.mockResolvedValue({ changed: 1, rows: [] });
    api.createGroup.mockResolvedValue({ id: 3, name: "Color" });
    api.renameGroup.mockResolvedValue(undefined);
    api.deleteGroup.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const rowOf = (name: string) => screen.getAllByTestId("groups-row").find((r) => r.getAttribute("data-name") === name)!;
  const groupRow = (name: string) => screen.getAllByTestId("group-row").find((r) => r.getAttribute("data-group-name") === name)!;

  it("abre en «Sin grupo»: los grupos a la izquierda con su cantidad y lo que no tiene grupo a la derecha con su sugerencia", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    // 3 services + 2 products without a group, in one list
    expect(screen.getByTestId("group-none-count").textContent).toBe("5");
    expect(screen.getAllByTestId("groups-row")).toHaveLength(5);
    expect(screen.getByTestId("group-none").getAttribute("aria-current")).toBe("true");
    expect(within(groupRow("Brushing")).getByTestId("group-row-count").textContent).toBe("1");
    expect(within(groupRow("Tratamiento")).getByTestId("group-row-count").textContent).toBe("0");
    const suggestions = screen.getAllByTestId("groups-suggestion").map((s) => s.textContent);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.join("|")).toContain("Sugerido: Tratamiento · contiene «bano de crema»");
    expect(within(rowOf("Maquillaje")).queryByTestId("groups-suggestion")).toBeNull();
    expect(within(rowOf("Shampoo")).getByText(/Producto/)).toBeTruthy();
    expect(screen.getByTestId("groups-new")).toBeTruthy();
  });

  it("«Sin grupo» dice qué paga (el % general), cuántos ítems hay y de qué tipo", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    expect(screen.getByTestId("group-none").textContent).toContain("Pagan el % general");
    expect(screen.getByTestId("none-counts").textContent).toBe("5 ítems · 3 servicios · 2 productos");
    await waitFor(() =>
      expect(screen.getByTestId("none-hint").textContent).toBe(
        "Pagan el % general: servicios 10 %, productos 5 %. Podés dejarlos así o armar grupos para darles otro %.",
      ),
    );
    // Nothing here «lacks a rule» any more, so it is not drawn as a warning.
    expect(screen.getByTestId("group-none").className).not.toContain("warning");
  });

  it("si los % generales no se pudieron leer, el texto sigue siendo claro (sin inventar un número)", async () => {
    api.getSettings.mockRejectedValue(new Error("NETWORK"));
    wrap();
    await screen.findAllByTestId("groups-row");
    expect(screen.getByTestId("none-hint").textContent).toBe("Pagan el % general. Podés dejarlos así o armar grupos para darles otro %.");
  });

  it("la cantidad de «Sin grupo» es una píldora con separador de miles que no se corta (1.247)", async () => {
    api.getGroupServices.mockImplementation(async (kind: string) =>
      kind === "PRODUCT" ? Array.from({ length: 1244 }, (_, i) => svc(1000 + i, `Producto ${i}`)) : [svc(10, "Baño de crema"), svc(11, "Maquillaje"), svc(12, "Peinado")],
    );
    wrap();
    await screen.findAllByTestId("groups-row");
    const pill = screen.getByTestId("group-none-count");
    expect(pill.textContent).toBe("1.247");
    expect(pill.className).toContain("min-w-");
    expect(pill.className).not.toContain("size-[30px]");
    expect(screen.getByTestId("none-counts").textContent).toBe("1.247 ítems · 3 servicios · 1.244 productos");
    expect(screen.getByTestId("none-filter-ALL").textContent).toBe("Todos 1.247");
    expect(screen.getByTestId("none-filter-PRODUCT").textContent).toBe("Productos 1.244");
  });

  it("los filtros de «Sin grupo» muestran solo servicios, solo productos o todo", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    const names = () => screen.getAllByTestId("groups-row").map((r) => r.getAttribute("data-name"));
    expect(screen.getByTestId("none-filter-ALL").getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByTestId("none-filter-PRODUCT"));
    expect(names()).toEqual(["Acondicionador", "Shampoo"]);
    expect(screen.getByTestId("none-filter-PRODUCT").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("none-filter-ALL").getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByTestId("none-filter-SERVICE"));
    expect(names()).toEqual(["Aplicación de ampolla", "Baño de crema", "Maquillaje"]);
    await userEvent.click(screen.getByTestId("none-filter-ALL"));
    expect(names()).toHaveLength(5);
    // The pill and the counts still talk about everything without a group.
    expect(screen.getByTestId("group-none-count").textContent).toBe("5");
  });

  it("dentro de «Sin grupo» las filas no repiten la etiqueta «Sin grupo»; en una búsqueda sí dicen en qué grupo están", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    expect(screen.queryAllByTestId("groups-row-chip")).toHaveLength(0);
    await userEvent.type(screen.getByTestId("groups-search"), "Maquillaje");
    expect(within(rowOf("Maquillaje")).getByTestId("groups-row-chip").textContent).toBe("Sin grupo");
  });

  it("tocar un grupo muestra sus servicios con el resumen del grupo", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.click(groupRow("Brushing"));
    expect(screen.getAllByTestId("groups-row").map((r) => r.getAttribute("data-name"))).toEqual(["Brushing pelo corto"]);
    expect(screen.getByTestId("group-title").textContent).toBe("Brushing");
    expect(screen.getByTestId("group-summary").textContent).toContain("1 servicio");
    expect(screen.getByTestId("group-percent").textContent).toBe("40 %");
    expect(screen.getByTestId("groups-rules-link")).toBeTruthy();
  });

  it("un grupo vacío lo explica y ofrece agregar servicios", async () => {
    wrap("/x?group=2");
    expect((await screen.findByTestId("group-title")).textContent).toBe("Tratamiento");
    expect(screen.getByTestId("group-empty-items")).toBeTruthy();
    expect(screen.getByTestId("groups-add-open")).toBeTruthy();
  });

  it("la dirección con ?group= abre ese grupo; con grupo inexistente cae en «Sin grupo»", async () => {
    wrap("/x?group=1");
    expect((await screen.findByTestId("group-title")).textContent).toBe("Brushing");
    cleanup();
    wrap("/x?group=999");
    await screen.findAllByTestId("groups-row");
    expect(screen.getByTestId("group-none").getAttribute("aria-current")).toBe("true");
  });

  it("buscar encuentra grupos y servicios y dice en qué grupo está cada uno; «Abrir grupo» lo abre", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.type(screen.getByTestId("groups-search"), "BRUSH");
    expect(screen.getByTestId("groups-results")).toBeTruthy();
    expect(screen.getAllByTestId("groups-result-group")).toHaveLength(1);
    const rows = screen.getAllByTestId("groups-row");
    expect(rows.map((r) => r.getAttribute("data-name"))).toEqual(["Brushing pelo corto"]);
    expect(within(rows[0]).getByTestId("groups-row-chip").textContent).toBe("Brushing");
    await userEvent.click(screen.getByTestId("groups-result-open"));
    expect(screen.queryByTestId("groups-results")).toBeNull();
    expect(screen.getByTestId("group-title").textContent).toBe("Brushing");
  });

  it("una búsqueda sin resultados lo dice; «Borrar búsqueda» vuelve a la lista", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.type(screen.getByTestId("groups-search"), "zzz");
    expect(screen.getByTestId("groups-no-matches").textContent).toContain("Ningún ítem coincide");
    await userEvent.click(screen.getByTestId("groups-search-clear"));
    expect(screen.queryByTestId("groups-results")).toBeNull();
    expect(screen.getAllByTestId("groups-row").length).toBeGreaterThan(0);
  });

  it("aceptar una sugerencia asigna ese servicio; aceptar todas, solo las que tienen sugerencia", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.click(within(rowOf("Baño de crema")).getByTestId("groups-accept"));
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 10, groupId: 2 }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se asignó 1 servicio");
    // The accepted one is already assigned on screen (no re-read): only the other suggestion is left.
    expect(screen.getByTestId("groups-accept-all").textContent).toBe("Aceptar la sugerencia");
    expect(rowOf("Baño de crema").getAttribute("data-state")).toMatch(/assigned|saving/);
    await userEvent.click(screen.getByTestId("groups-accept-all"));
    await waitFor(() => expect(api.assignGroups).toHaveBeenLastCalledWith([{ serviceId: 11, groupId: 2 }]));
  });

  it("elegir un grupo en la fila asigna; un servicio con grupo se puede quitar del grupo", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.selectOptions(within(rowOf("Maquillaje")).getByTestId("groups-row-select"), "1");
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 12, groupId: 1 }]));
    await userEvent.click(groupRow("Brushing"));
    await userEvent.selectOptions(within(rowOf("Brushing pelo corto")).getByTestId("groups-row-select"), "");
    await waitFor(() => expect(api.assignGroups).toHaveBeenLastCalledWith([{ serviceId: 13, groupId: null }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se quitó 1 ítem del grupo");
  });

  it("la pantalla cambia al instante (sin esperar al servidor), la fila queda marcada y se atenúa mientras guarda", async () => {
    let finish: (v: unknown) => void = () => {};
    api.assignGroups.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    wrap();
    await screen.findAllByTestId("groups-row");
    const reads = api.getGroupServices.mock.calls.length;
    await userEvent.selectOptions(within(rowOf("Maquillaje")).getByTestId("groups-row-select"), "1");
    const row = rowOf("Maquillaje");
    expect(within(row).getByTestId("groups-row-chip").textContent).toContain("Brushing");
    expect(row.getAttribute("data-state")).toBe("saving");
    expect((within(row).getByTestId("groups-row-select") as HTMLSelectElement).disabled).toBe(true);
    // The left list already counts it.
    expect(within(groupRow("Brushing")).getByTestId("group-row-count").textContent).toBe("2");
    expect(screen.getByTestId("group-none-count").textContent).toBe("4");
    expect(api.getGroupServices.mock.calls.length).toBe(reads);
    finish({
      changed: 1,
      rows: [{ serviceId: 12, name: "Maquillaje", categoryName: null, price: null, groupId: 1, groupName: "Brushing", suggestion: null }],
    });
    await waitFor(() => expect(rowOf("Maquillaje").getAttribute("data-state")).toBe("assigned"));
    expect(api.getGroupServices.mock.calls.length).toBe(reads); // one round trip is enough
  });

  it("si el servidor rechaza el cambio se vuelve a leer el estado real y no se avisa un éxito", async () => {
    api.assignGroups.mockRejectedValueOnce(new Error("COMMISSION_GROUP_NOT_FOUND"));
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.selectOptions(within(rowOf("Maquillaje")).getByTestId("groups-row-select"), "1");
    // The row goes back to where it was: no group, and the real state is read again.
    await waitFor(() => expect((within(rowOf("Maquillaje")).getByTestId("groups-row-select") as HTMLSelectElement).value).toBe(""));
    expect(rowOf("Maquillaje").getAttribute("data-state")).toBeNull();
    expect(screen.queryByTestId("groups-notice")).toBeNull();
  });

  it("selecciona varios y los asigna de una vez desde la barra", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    expect(screen.queryByTestId("groups-bulk-bar")).toBeNull();
    await userEvent.click(within(rowOf("Maquillaje")).getByTestId("groups-row-check"));
    await userEvent.click(within(rowOf("Baño de crema")).getByTestId("groups-row-check"));
    expect(screen.getByTestId("groups-selected").textContent).toBe("2 seleccionados");
    expect((screen.getByTestId("groups-bulk-assign") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByTestId("groups-bulk-select"), "2");
    await userEvent.click(screen.getByTestId("groups-bulk-assign"));
    await waitFor(() =>
      expect(api.assignGroups).toHaveBeenCalledWith([
        { serviceId: 10, groupId: 2 },
        { serviceId: 12, groupId: 2 },
      ]),
    );
    await waitFor(() => expect(screen.queryByTestId("groups-bulk-bar")).toBeNull());
  });

  it("«Seleccionar los que coinciden» marca los de la vista y «Quitar selección» los suelta; productos y servicios juntos", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.click(screen.getByTestId("groups-select-all"));
    expect(screen.getByTestId("groups-selected").textContent).toBe("5 seleccionados");
    await userEvent.click(screen.getByTestId("groups-bulk-clear"));
    expect(screen.queryByTestId("groups-bulk-bar")).toBeNull();
  });

  it("crear un grupo desde la barra lo crea, asigna los seleccionados y lo abre", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.click(within(rowOf("Maquillaje")).getByTestId("groups-row-check"));
    await userEvent.selectOptions(screen.getByTestId("groups-bulk-select"), "__new__");
    expect((screen.getByTestId("groups-assign-selected") as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByTestId("groups-save"));
    expect((await screen.findByText(/Ingresá el nombre del grupo, por ejemplo Brushing/)).getAttribute("role")).toBe("alert");
    expect(api.createGroup).not.toHaveBeenCalled();
    await userEvent.type(screen.getByTestId("groups-name"), "Color");
    await userEvent.click(screen.getByTestId("groups-save"));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Color"));
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 12, groupId: 3 }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se creó el grupo y se asignaron los seleccionados");
    expect((await screen.findByTestId("group-title")).textContent).toBe("Color");
  });

  it("«+ Nuevo grupo» sin selección crea un grupo vacío y lo abre (sin casilla de asignar)", async () => {
    wrap();
    await screen.findAllByTestId("groups-row");
    await userEvent.click(screen.getByTestId("groups-new"));
    expect(screen.queryByTestId("groups-assign-selected")).toBeNull();
    await userEvent.type(screen.getByTestId("groups-name"), "Color");
    await userEvent.click(screen.getByTestId("groups-save"));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Color"));
    expect(api.assignGroups).not.toHaveBeenCalled();
    expect((await screen.findByTestId("group-title")).textContent).toBe("Color");
    expect(screen.getByTestId("groups-notice").textContent).toContain("Se creó el grupo");
  });

  it("renombrar y eliminar un grupo desde su detalle", async () => {
    wrap("/x?group=1");
    await screen.findByTestId("group-title");
    await userEvent.click(screen.getByTestId("groups-rename"));
    const name = screen.getByTestId("groups-name") as HTMLInputElement;
    expect(name.value).toBe("Brushing");
    await userEvent.clear(name);
    await userEvent.type(name, "Brushing y secado");
    await userEvent.click(screen.getByTestId("groups-save"));
    await waitFor(() => expect(api.renameGroup).toHaveBeenCalledWith(1, "Brushing y secado"));
    await userEvent.click(screen.getByRole("button", { name: "Acciones del grupo Brushing" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(api.deleteGroup).toHaveBeenCalledWith(1));
  });

  it("«Agregar servicios»: primero los que no tienen grupo, marca los sugeridos y agrega los elegidos", async () => {
    wrap("/x?group=2");
    await screen.findByTestId("group-title");
    await userEvent.click(screen.getByTestId("groups-add-open"));
    const dialog = await screen.findByTestId("groups-add-dialog");
    // «No group» is the starting filter: 3 services + 2 products
    expect(within(dialog).getAllByTestId("groups-add-row")).toHaveLength(5);
    expect(within(dialog).getByTestId("groups-add-scope-GROUPED").textContent).toBe("Con grupo · 1");
    expect((screen.getByTestId("groups-add-confirm") as HTMLButtonElement).disabled).toBe(true);
    // 2 are suggested for «Tratamiento» by their names
    await userEvent.click(within(dialog).getByTestId("groups-add-mark-suggested"));
    expect(within(dialog).getByTestId("groups-add-summary").textContent).toContain("2 elegidos");
    expect(screen.getByTestId("groups-add-confirm").textContent).toBe("Agregar 2 a Tratamiento");
    // A service that already has a group is moved: it is announced.
    await userEvent.click(within(dialog).getByTestId("groups-add-scope-GROUPED"));
    await userEvent.click(within(dialog).getAllByTestId("groups-add-check")[0]);
    expect(within(dialog).getByTestId("groups-add-summary").textContent).toContain("ya tiene grupo y se mueve");
    await userEvent.click(screen.getByTestId("groups-add-confirm"));
    await waitFor(() =>
      expect(api.assignGroups).toHaveBeenCalledWith(expect.arrayContaining([{ serviceId: 10, groupId: 2 }, { serviceId: 11, groupId: 2 }, { serviceId: 13, groupId: 2 }])),
    );
  });

  it("con muchas filas se dibujan 50 y «Mostrar N más» trae el resto", async () => {
    api.getGroupServices.mockImplementation(async (kind: string) =>
      kind === "PRODUCT" ? [] : Array.from({ length: 70 }, (_, i) => svc(100 + i, `Servicio ${String(i).padStart(2, "0")}`)),
    );
    wrap();
    await screen.findAllByTestId("groups-row");
    expect(screen.getAllByTestId("groups-row")).toHaveLength(50);
    await userEvent.click(screen.getByTestId("groups-show-more"));
    expect(screen.getAllByTestId("groups-row")).toHaveLength(70);
  });
});
