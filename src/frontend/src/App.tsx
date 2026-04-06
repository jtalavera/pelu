import { useMemo, useId, useState, type ChangeEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionItem,
  Alert,
  Avatar,
  Badge,
  Breadcrumbs,
  BreadcrumbItem,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Drawer,
  Heading,
  IconMenu,
  IconSearch,
  Input,
  InputGroup,
  Label,
  List,
  ListItem,
  Modal,
  Navbar,
  NavbarLink,
  Pagination,
  Progress,
  Radio,
  RadioGroup,
  Select,
  Separator,
  Sidebar,
  SidebarLink,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  Toast,
  Tooltip,
  DataTable,
  ThemeToggle,
  type DataTableColumn,
} from "@design-system";
import { LanguageSwitcher } from "./components/LanguageSwitcher";

type TableRow = {
  id: string;
  name: string;
  roleKey: "engineering" | "operations" | "research";
  statusKey: "active" | "away";
  updated: string;
};

const tableData: TableRow[] = [
  {
    id: "1",
    name: "Ada Lovelace",
    roleKey: "engineering",
    statusKey: "active",
    updated: "2025-03-01",
  },
  {
    id: "2",
    name: "Grace Hopper",
    roleKey: "operations",
    statusKey: "away",
    updated: "2025-03-18",
  },
  {
    id: "3",
    name: "Katherine Johnson",
    roleKey: "research",
    statusKey: "active",
    updated: "2025-02-22",
  },
];

export default function App() {
  const { t } = useTranslation();
  const notificationsId = useId();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [toastOpen, setToastOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [plan, setPlan] = useState("pro");
  const [showPassword, setShowPassword] = useState(false);

  const tableColumns = useMemo<DataTableColumn<TableRow>[]>(
    () => [
      {
        id: "name",
        header: t("app.table.columns.name"),
        alwaysVisible: true,
        sortable: true,
        sortFn: (a, b) => a.name.localeCompare(b.name),
        cell: (r) => <span className="font-medium">{r.name}</span>,
      },
      {
        id: "role",
        header: t("app.table.columns.team"),
        sortable: true,
        sortFn: (a, b) =>
          t(`app.table.roles.${a.roleKey}`).localeCompare(
            t(`app.table.roles.${b.roleKey}`),
          ),
        cell: (r) => t(`app.table.roles.${r.roleKey}`),
      },
      {
        id: "status",
        header: t("app.table.columns.status"),
        sortable: true,
        sortFn: (a, b) =>
          t(`app.table.status.${a.statusKey}`).localeCompare(
            t(`app.table.status.${b.statusKey}`),
          ),
        cell: (r) => (
          <Badge
            variant={
              r.statusKey === "active"
                ? "success"
                : r.statusKey === "away"
                  ? "warning"
                  : "secondary"
            }
          >
            {t(`app.table.status.${r.statusKey}`)}
          </Badge>
        ),
      },
      {
        id: "updated",
        header: t("app.table.columns.lastUpdate"),
        sortable: true,
        sortFn: (a, b) => a.updated.localeCompare(b.updated),
        cell: (r) => (
          <span className="text-slate-500 dark:text-slate-400">{r.updated}</span>
        ),
        defaultHidden: true,
      },
    ],
    [t],
  );

  return (
    <div className="mx-auto min-h-screen min-w-0 max-w-6xl overflow-x-hidden px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-2">
          <Badge variant="info">{t("app.badge")}</Badge>
          <Heading as="h1">{t("app.title")}</Heading>
          <Text variant="lead">{t("app.lead")}</Text>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <LanguageSwitcher />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-col gap-10">
        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.actions")}</Heading>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button>{t("app.buttons.primary")}</Button>
            <Button variant="secondary">{t("app.buttons.secondary")}</Button>
            <Button variant="outline">{t("app.buttons.outline")}</Button>
            <Button variant="ghost">{t("app.buttons.ghost")}</Button>
            <Button variant="tertiary">{t("app.buttons.tertiary")}</Button>
            <Button variant="danger">{t("app.buttons.danger")}</Button>
            <Button size="sm">{t("app.buttons.small")}</Button>
            <Button size="lg">{t("app.buttons.large")}</Button>
            <Button loading>{t("app.buttons.loading")}</Button>
            <Button size="icon" variant="outline" aria-label={t("app.buttons.iconOnly")}>
              <IconMenu />
            </Button>
            <Button type="button" variant="secondary" onClick={() => setToastOpen(true)}>
              {t("app.buttons.showToast")}
            </Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.typography")}</Heading>
          <div className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <Heading as="h1">H1</Heading>
            <Heading as="h2">H2</Heading>
            <Heading as="h3">H3</Heading>
            <Heading as="h4">H4</Heading>
            <Heading as="h5">{t("app.typography.h5")}</Heading>
            <Heading as="h6">{t("app.typography.h6")}</Heading>
            <Text variant="label">{t("app.typography.labelSample")}</Text>
            <Text>{t("app.typography.body")}</Text>
            <Text variant="muted">{t("app.typography.muted")}</Text>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.formControls")}</Heading>
          <Card>
            <CardHeader>
              <CardTitle>{t("app.card.title")}</CardTitle>
              <CardDescription>{t("app.card.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="search-field">{t("app.form.search")}</Label>
                  <InputGroup start={<IconSearch />}>
                    <Input
                      unstyled
                      id="search-field"
                      type="search"
                      placeholder={t("app.form.searchPlaceholder")}
                      autoComplete="off"
                      aria-label={t("app.form.search")}
                    />
                  </InputGroup>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password-field">{t("app.form.password")}</Label>
                  <InputGroup
                    end={
                      <button
                        type="button"
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? t("app.form.hide") : t("app.form.show")}
                      </button>
                    }
                  >
                    <Input
                      unstyled
                      id="password-field"
                      type={showPassword ? "text" : "password"}
                      placeholder={t("app.form.passwordPlaceholder")}
                      autoComplete="current-password"
                    />
                  </InputGroup>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name" required>
                    {t("app.form.name")}
                  </Label>
                  <Input id="name" placeholder={t("app.form.namePlaceholder")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">{t("app.form.role")}</Label>
                  <Select id="role" defaultValue="">
                    <option value="" disabled>
                      {t("app.form.rolePlaceholder")}
                    </option>
                    <option value="eng">{t("app.form.roleEng")}</option>
                    <option value="design">{t("app.form.roleDesign")}</option>
                    <option value="pm">{t("app.form.rolePm")}</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label id="plan-label">{t("app.form.plan")}</Label>
                <RadioGroup
                  value={plan}
                  onChange={setPlan}
                  aria-labelledby="plan-label"
                  className="flex flex-row flex-wrap gap-4"
                >
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <Radio value="starter" />
                    {t("app.form.planStarter")}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <Radio value="pro" />
                    {t("app.form.planPro")}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <Radio value="team" />
                    {t("app.form.planTeam")}
                  </label>
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">{t("app.form.bio")}</Label>
                <Textarea
                  id="bio"
                  rows={3}
                  placeholder={t("app.form.bioPlaceholder")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <Checkbox defaultChecked />
                  {t("app.form.subscribe")}
                </label>
                <div className="flex items-center gap-2">
                  <Switch
                    id={notificationsId}
                    checked={notifications}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setNotifications(e.target.checked)
                    }
                  />
                  <Label htmlFor={notificationsId} className="cursor-pointer font-normal">
                    {t("app.form.pushNotifications")}
                  </Label>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="button" variant="secondary">
                {t("app.form.cancel")}
              </Button>
              <Button type="button">{t("app.form.save")}</Button>
            </CardFooter>
          </Card>
        </section>

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.navigation")}</Heading>
          <Breadcrumbs aria-label={t("designSystem.breadcrumbs.navLabel")}>
            <BreadcrumbItem href="#">{t("app.breadcrumbs.home")}</BreadcrumbItem>
            <BreadcrumbItem href="#">{t("app.breadcrumbs.settings")}</BreadcrumbItem>
            <BreadcrumbItem current>{t("app.breadcrumbs.profile")}</BreadcrumbItem>
          </Breadcrumbs>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList
              aria-label={t("app.sections.navigation")}
              className="w-full max-w-full sm:w-auto"
            >
              <TabsTrigger value="overview">{t("app.tabs.overview")}</TabsTrigger>
              <TabsTrigger value="activity">{t("app.tabs.activity")}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Text>{t("app.tabs.overviewBody")}</Text>
            </TabsContent>
            <TabsContent value="activity">
              <Text>{t("app.tabs.activityBody")}</Text>
            </TabsContent>
          </Tabs>
          <Pagination
            page={page}
            pageCount={5}
            onPageChange={setPage}
            previousLabel={t("app.pagination.previous")}
            nextLabel={t("app.pagination.next")}
          />
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <Navbar
              brand={
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("app.navbar.brand")}
                </span>
              }
              center={
                <>
                  <NavbarLink href="#" current>
                    {t("app.navbar.docs")}
                  </NavbarLink>
                  <NavbarLink href="#">{t("app.navbar.pricing")}</NavbarLink>
                </>
              }
              end={
                <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                  <NavbarLink href="#">{t("app.navbar.signUp")}</NavbarLink>
                  <Button
                    className="w-full sm:w-auto"
                    size="sm"
                    variant="secondary"
                    type="button"
                  >
                    {t("app.navbar.signIn")}
                  </Button>
                </div>
              }
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.layout")}</Heading>
          <div className="flex min-h-[min(50vh,280px)] flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 md:min-h-[220px] md:flex-row">
            <Sidebar
              header={
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("app.sidebar.product")}
                </span>
              }
            >
              <SidebarLink href="#" active>
                {t("app.sidebar.dashboard")}
              </SidebarLink>
              <SidebarLink href="#">{t("app.sidebar.reports")}</SidebarLink>
            </Sidebar>
            <div className="flex min-h-0 flex-1 flex-col bg-slate-50 p-4 dark:bg-slate-950">
              <Text className="font-medium text-slate-900 dark:text-slate-100">
                {t("app.sidebar.contentTitle")}
              </Text>
              <Text variant="muted" className="mt-1">
                {t("app.sidebar.contentBody")}
              </Text>
            </div>
          </div>
          <Accordion>
            <AccordionItem title={t("app.accordion.oneTitle")}>
              {t("app.accordion.oneBody")}
            </AccordionItem>
            <AccordionItem title={t("app.accordion.twoTitle")} defaultOpen>
              {t("app.accordion.twoBody")}
            </AccordionItem>
          </Accordion>
          <List>
            <ListItem
              media={<Avatar fallback="DL" alt="" />}
              title={t("app.list.oneTitle")}
              end={t("app.list.oneMeta")}
            />
            <ListItem
              media={<Avatar fallback="GH" alt="" />}
              title={t("app.list.twoTitle")}
              end={t("app.list.twoMeta")}
            />
          </List>
        </section>

        <Separator />

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.feedback")}</Heading>
          <div className="grid gap-4 sm:grid-cols-2">
            <Alert variant="info" title={t("app.alerts.infoTitle")}>
              <Trans
                i18nKey="app.alerts.infoBody"
                components={{ strong: <strong /> }}
              />
            </Alert>
            <Alert variant="success" title={t("app.alerts.successTitle")}>
              {t("app.alerts.successBody")}
            </Alert>
            <Alert variant="warning" title={t("app.alerts.warningTitle")}>
              {t("app.alerts.warningBody")}
            </Alert>
            <Alert variant="destructive" title={t("app.alerts.destructiveTitle")}>
              {t("app.alerts.destructiveBody")}
            </Alert>
          </div>
          <div className="flex max-w-md flex-col gap-4">
            <Progress value={62} label={t("app.progress.label")} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Spinner size="sm" />
            <Spinner />
            <Spinner size="lg" />
            <Tooltip label={t("app.tooltip.hint")}>
              <Button type="button" variant="outline">
                {t("app.tooltip.trigger")}
              </Button>
            </Tooltip>
          </div>
        </section>

        <Toast
          open={toastOpen}
          onOpenChange={setToastOpen}
          duration={3800}
          variant="success"
        >
          {t("app.toast.message")}
        </Toast>

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.dataDisplay")}</Heading>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{t("app.badges.default")}</Badge>
            <Badge variant="secondary">{t("app.badges.secondary")}</Badge>
            <Badge variant="outline">{t("app.badges.outline")}</Badge>
            <Badge variant="success">{t("app.badges.success")}</Badge>
            <Badge variant="warning">{t("app.badges.warning")}</Badge>
            <Badge variant="destructive">{t("app.badges.destructive")}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Avatar alt={t("app.avatars.alex")} fallback="AM" />
            <Avatar alt={t("app.avatars.jamie")} />
            <Avatar size="lg" alt={t("app.avatars.sam")} fallback="ST" />
          </div>
        </section>

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.dataTable")}</Heading>
          <Text variant="muted">{t("app.table.hint")}</Text>
          <DataTable<TableRow>
            columns={tableColumns}
            data={tableData}
            getRowId={(row) => row.id}
          />
        </section>

        <section className="space-y-4">
          <Heading as="h2">{t("app.sections.overlay")}</Heading>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => setModalOpen(true)}>
              {t("app.modal.open")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDrawerOpen(true)}>
              {t("app.drawer.open")}
            </Button>
          </div>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title={t("app.modal.title")}
            description={t("app.modal.description")}
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>
                  {t("app.modal.cancel")}
                </Button>
                <Button onClick={() => setModalOpen(false)}>
                  {t("app.modal.continue")}
                </Button>
              </>
            }
          >
            <Text>{t("app.modal.body")}</Text>
          </Modal>
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title={t("app.drawer.title")}
            closeLabel={t("designSystem.drawer.closePanel")}
          >
            <Text>{t("app.drawer.body")}</Text>
          </Drawer>
        </section>
      </div>
    </div>
  );
}
