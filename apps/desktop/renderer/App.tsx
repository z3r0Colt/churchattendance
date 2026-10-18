import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Checkbox,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Dropdown,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  Option,
  Spinner,
  Subtitle2,
  Tab,
  TabList,
  Title3,
  ToggleButton,
  Tooltip,
} from "@fluentui/react-components";
import { OverlayDrawer } from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownloadRegular,
  CheckmarkCircleRegular,
  CheckmarkRegular,
  DismissRegular,
  PeopleRegular,
  PersonRegular,
  PrintRegular,
  SettingsRegular,
  WeatherMoonRegular,
} from "@fluentui/react-icons";
import {
  canMarkAttendance,
  churchDate,
  EDITOR_ROLES,
  filterRoster,
  hasRole,
  isOnRoll,
  membershipStatuses,
  nextService,
  statusLabels,
  attendanceCounts,
  type MembershipStatus,
  type Role,
  type RosterPerson,
  type Service,
} from "@sycamore/shared";
import { useAuth, signIn, signOutUser } from "./data/auth";
import { configured } from "./data/firebase";
import {
  addVisitor,
  createHousehold,
  useAttendanceData,
} from "./data/attendance";
import { darkTheme, lightTheme } from "./theme/brand";
import { ExportButton as ExportCsv } from "./components/ExportButton";
import { Messages } from "./communications/Messages";
import { Bulletin } from "./communications/Bulletin";
import { CommunicationSettingsPanel } from "./communications/Settings";
import { useUnreadSms } from "./data/communications";

type AttendanceData = ReturnType<typeof useAttendanceData>;
type Page = "attendance" | "people" | "reports" | "settings" | "messages" | "bulletin";
const roleNames: Record<Role, string> = {
  admin: "Admin",
  pastor: "Pastor",
  clerk: "Clerk",
  elder: "Elder",
  deacon: "Deacon",
  attendanceVolunteer: "Attendance Volunteer",
  readOnly: "Read Only",
};

export function App() {
  const authSession = useAuth();
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const changeTheme = (value: string) => {
    localStorage.setItem("theme", value);
    setTheme(value);
  };
  return (
    <FluentProvider
      theme={dark ? darkTheme : lightTheme}
      className="app"
      data-theme={dark ? "dark" : "light"}
    >
      {authSession.loading ? (
        <main className="center">
          <Spinner label="Opening Sycamore RPC" />
        </main>
      ) : !authSession.user ? (
        <SignIn />
      ) : (
        <Workspace
          key={`${authSession.user.uid}-${authSession.roles.join(",")}`}
          roles={authSession.roles}
          name={
            authSession.user.displayName ||
            authSession.user.email ||
            "Signed in"
          }
          theme={theme}
          changeTheme={changeTheme}
        />
      )}
    </FluentProvider>
  );
}
function SignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await signIn(
        String(form.get("email")),
        String(form.get("password")),
        keep,
      );
    } catch {
      setError("Sign-in failed. Check your email, password, and connection.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center">
      <form className="signin surface" onSubmit={submit}>
        <div className="wordmark">SYCAMORE RPC</div>
        <Title3>Welcome back</Title3>
        <p>Sign in to care for the congregation.</p>
        {!configured && (
          <MessageBar intent="warning">
            Firebase setup is needed before this app can connect. See the setup
            guide.
          </MessageBar>
        )}
        <Field label="Email" required>
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" required>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Checkbox
          checked={keep}
          onChange={(_, data) => setKeep(data.checked === true)}
          label="Keep this PC signed in"
        />
        {error && <MessageBar intent="error">{error}</MessageBar>}
        <Button
          appearance="primary"
          type="submit"
          disabled={busy || !configured}
        >
          {busy ? "Signing in" : "Sign in"}
        </Button>
        <small>Sycamore Reformed Presbyterian Church</small>
      </form>
    </main>
  );
}
function Workspace({
  roles,
  name,
  theme,
  changeTheme,
}: {
  roles: Role[];
  name: string;
  theme: string;
  changeTheme: (value: string) => void;
}) {
  const data = useAttendanceData();
  const [page, setPage] = useState<Page>("attendance");
  const [visitor, setVisitor] = useState(false);
  const [household, setHousehold] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const editor = hasRole(roles, EDITOR_ROLES);
  const volunteer = roles.length === 1 && roles[0] === "attendanceVolunteer";
  const unreadTexts = useUnreadSms(editor);
  useEffect(() => {
    if (selectedType || !data.types.length) return;
    const next = nextService(data.types, new Date(), data.timeZone);
    if (next) {
      setSelectedType(next.typeId);
      setDate(next.date);
    }
  }, [data.types, data.timeZone, selectedType]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void signOutUser(), 30 * 60 * 1000);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, []);
  const service = data.services.find(
    (row) => row.serviceTypeId === selectedType && row.date === date,
  );
  const sync = data.error
    ? "Some changes did not save"
    : !data.online
      ? "Offline, changes saved on this PC"
      : data.pending
        ? "Saving"
        : data.cacheOnly
          ? "Connecting, using cached data"
          : "Online";
  async function start() {
    setBusy(true);
    try {
      await data.startService(selectedType, date);
    } catch {
      data.setError(
        "The service could not be opened. Connect to the internet and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!roles.length)
    return (
      <main className="center">
        <div className="surface">
          <Title3>Access has not been assigned</Title3>
          <p>Ask an administrator to assign your role, then sign in again.</p>
          <Button onClick={() => void signOutUser()}>Sign out</Button>
        </div>
      </main>
    );
  return (
    <div className="workspace">
      <header className="topbar">
        <div className="wordmark">
          SYCAMORE <span>RPC</span>
        </div>
        <div className="topbar-right">
          <Badge
            appearance="outline"
            color={
              data.error
                ? "danger"
                : !data.online || data.pending
                  ? "warning"
                  : "success"
            }
            aria-live="polite"
          >
            {sync}
          </Badge>
          <span>
            {name}
            <small>{roles.map((role) => roleNames[role]).join(", ")}</small>
          </span>
          <Tooltip content="Change theme" relationship="label">
            <Button
              appearance="subtle"
              icon={<WeatherMoonRegular />}
              aria-label="Change theme"
              onClick={() => changeTheme(theme === "dark" ? "light" : "dark")}
            />
          </Tooltip>
          <Button appearance="subtle" onClick={() => void signOutUser()}>
            Lock now
          </Button>
        </div>
      </header>
      <nav aria-label="Main navigation" className="sidebar">
        <span className="nav-label">CONGREGATION</span>
        <Button
          icon={<CheckmarkCircleRegular />}
          appearance={page === "attendance" ? "primary" : "subtle"}
          onClick={() => setPage("attendance")}
        >
          Attendance
        </Button>
        {editor && <><Button appearance={page === "messages" ? "primary" : "subtle"} onClick={() => setPage("messages")}>Messages {unreadTexts > 0 ? `(${unreadTexts})` : ""}</Button><Button appearance={page === "bulletin" ? "primary" : "subtle"} onClick={() => setPage("bulletin")}>Bulletin</Button></>}
        {!volunteer && (
          <>
            <Button
              icon={<PeopleRegular />}
              appearance={page === "people" ? "primary" : "subtle"}
              onClick={() => setPage("people")}
            >
              People & households
            </Button>
            <Button
              icon={<ArrowDownloadRegular />}
              appearance={page === "reports" ? "primary" : "subtle"}
              onClick={() => setPage("reports")}
            >
              Reports
            </Button>
            <Button
              icon={<SettingsRegular />}
              appearance={page === "settings" ? "primary" : "subtle"}
              onClick={() => setPage("settings")}
            >
              Settings
            </Button>
          </>
        )}
        <div className="nav-bottom">
          Church management<small>Phase 2 · Development</small>
        </div>
      </nav>
      <main className="content">
        {!data.online && (
          <MessageBar intent="warning">
            You are offline. Attendance changes stay on this PC until the
            connection returns.
          </MessageBar>
        )}
        {data.error && (
          <MessageBar intent="error">
            {data.error}{" "}
            <Button size="small" onClick={() => data.setError("")}>
              Dismiss
            </Button>
          </MessageBar>
        )}
        {page === "attendance" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">NAME BY NAME</span>
                <Title3 as="h1">Take attendance</Title3>
                <p>Children are counted with their families.</p>
              </div>
              <Button
                icon={<AddRegular />}
                disabled={!service || !data.online || !canMarkAttendance(roles)}
                onClick={() => setVisitor(true)}
              >
                Add visitor
              </Button>
            </div>
            <div className="service-bar surface">
              <Field label="Service">
                <Dropdown
                  aria-label="Service"
                  value={
                    data.types.find((type) => type.id === selectedType)?.name ||
                    "Choose a service"
                  }
                  selectedOptions={[selectedType]}
                  onOptionSelect={(_, option) =>
                    setSelectedType(option.optionValue || "")
                  }
                >
                  {data.types
                    .filter((type) => type.isActive)
                    .map((type) => (
                      <Option key={type.id} value={type.id}>
                        {type.name}
                      </Option>
                    ))}
                </Dropdown>
              </Field>
              <Field label="Date">
                <Input
                  type="date"
                  aria-label="Service date"
                  value={date}
                  onChange={(_, value) => setDate(value.value)}
                />
              </Field>
              <div className="service-date">
                {date &&
                  `${new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? "Lord's Day, " : ""}${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`}
              </div>
            </div>
            {!data.loaded ? (
              <Spinner label="Loading the roll" />
            ) : service ? (
              <RollCall
                data={data}
                service={service}
                editable={canMarkAttendance(roles)}
                addVisitor={() => setVisitor(true)}
              />
            ) : (
              <div className="empty surface">
                <CheckmarkCircleRegular fontSize={40} />
                <Subtitle2>No roll call started for this service</Subtitle2>
                <p>
                  Open the service while connected, then attendance will also
                  work offline.
                </p>
                <Button
                  appearance="primary"
                  disabled={
                    !selectedType ||
                    !date ||
                    !data.online ||
                    busy ||
                    !canMarkAttendance(roles)
                  }
                  onClick={() => void start()}
                >
                  {busy ? "Opening service" : "Start roll call"}
                </Button>
              </div>
            )}
          </>
        )}
        {page === "people" && (
          <People data={data} editor={editor} add={() => setHousehold(true)} />
        )}
        {page === "reports" && <Reports data={data} />}
        {page === "messages" && editor && <Messages roles={roles} />}
        {page === "bulletin" && editor && <Bulletin roles={roles} />}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <Title3 as="h1">Settings</Title3>
            </div>
            <section className="surface settings">
              <Subtitle2>This PC</Subtitle2>
              <Field label="Theme">
                <Dropdown
                  value={
                    theme === "system"
                      ? "Match Windows"
                      : theme === "dark"
                        ? "Dark"
                        : "Light"
                  }
                  selectedOptions={[theme]}
                  onOptionSelect={(_, option) =>
                    changeTheme(option.optionValue || "system")
                  }
                >
                  <Option value="system">Match Windows</Option>
                  <Option value="light">Light</Option>
                  <Option value="dark">Dark</Option>
                </Dropdown>
              </Field>
              <p>
                Church time zone <strong>{data.timeZone}</strong>
              </p>
              <p>
                Service types and roles are managed through setup.
              </p>
            </section>
            {editor && <CommunicationSettingsPanel roles={roles} serviceTypes={data.types} />}
          </>
        )}
      </main>
      {visitor && service && (
        <VisitorDrawer
          serviceId={service.id}
          people={data.people}
          close={() => setVisitor(false)}
        />
      )}
      {household && (
        <HouseholdDrawer
          date={churchDate(new Date(), data.timeZone)}
          close={() => setHousehold(false)}
        />
      )}
    </div>
  );
}
function RollCall({
  data,
  service,
  editable,
  addVisitor: openVisitor,
}: {
  data: AttendanceData;
  service: Service;
  editable: boolean;
  addVisitor: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const input = useRef<HTMLInputElement>(null);
  const [undo, setUndo] = useState<{ ids: string[]; expires: number } | null>(
    null,
  );
  const filtered = filterRoster(data.people, search, filter);
  const counts = attendanceCounts(data.people, service);
  const onRoll = data.people.filter(isOnRoll);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        input.current?.focus();
      }
      if (editable && event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (data.online) openVisitor();
      }
      if (
        ["ArrowDown", "ArrowUp"].includes(event.key) &&
        (document.activeElement?.hasAttribute("data-roll-row") ||
          document.activeElement === input.current)
      ) {
        const rows = [
          ...document.querySelectorAll<HTMLButtonElement>("[data-roll-row]"),
        ];
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        rows[
          (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
            rows.length
        ]?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [editable, data.online, openVisitor]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(
      () => setUndo(null),
      Math.max(0, undo.expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [undo]);
  function groupRows(rows: RosterPerson[]) {
    const grouped = new Map<string, RosterPerson[]>();
    rows.forEach((person) =>
      grouped.set(person.householdId, [
        ...(grouped.get(person.householdId) || []),
        person,
      ]),
    );
    return [...grouped.entries()].map(([id, householdPeople]) => {
      // Household actions affect all active people in the displayed resident/non-resident group, even when search is narrowed.
      const family = onRoll.filter(
        (person) =>
          person.householdId === id &&
          (person.membershipStatus === "nonResident") ===
            (householdPeople[0].membershipStatus === "nonResident"),
      );
      const allPresent = family.every((person) => !!service.present[person.id]);
      return (
        <section className="household surface" key={id}>
          <div className="household-heading">
            <Subtitle2>{householdPeople[0].householdName}</Subtitle2>
            <Button
              size="small"
              disabled={!editable}
              onClick={() => {
                family.forEach((person) =>
                  data.mark(service.id, person.id, !allPresent),
                );
                if (allPresent)
                  setUndo({
                    ids: family.map((person) => person.id),
                    expires: Date.now() + 8000,
                  });
              }}
            >
              {allPresent ? "Clear household" : `Mark all ${family.length}`}
            </Button>
          </div>
          {householdPeople.map((person) => (
            <ToggleButton
              key={person.id}
              data-roll-row
              checked={!!service.present[person.id]}
              disabled={!editable}
              className={`person-row ${service.present[person.id] ? "present" : ""}`}
              onClick={() =>
                data.mark(service.id, person.id, !service.present[person.id])
              }
              aria-label={`${person.firstName} ${person.lastName}, ${service.present[person.id] ? "present" : "absent"}`}
            >
              <span className="check-box" aria-hidden="true">
                {service.present[person.id] ? <CheckmarkRegular /> : null}
              </span>
              <span className="person-name">
                {person.preferredName || person.firstName}{" "}
                <span className="muted">{person.lastName}</span>
              </span>
              <Badge
                appearance={
                  person.membershipStatus === "communicant"
                    ? "filled"
                    : "outline"
                }
                color={
                  person.membershipStatus === "visitor"
                    ? "warning"
                    : person.membershipStatus === "adherent"
                      ? "informative"
                      : "brand"
                }
              >
                {statusLabels[person.membershipStatus]}
              </Badge>
            </ToggleButton>
          ))}
        </section>
      );
    });
  }
  return (
    <>
      <div className="roll-layout">
        <section className="roll-list">
          <div className="roll-toolbar">
            <Input
              ref={input}
              aria-label="Search name or family"
              placeholder="Search name or family…"
              value={search}
              onChange={(_, value) => setSearch(value.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filtered[0] && editable) {
                  data.mark(
                    service.id,
                    filtered[0].id,
                    !service.present[filtered[0].id],
                  );
                  setSearch("");
                }
              }}
            />
            <span className="muted">Enter to mark · Ctrl+F to search</span>
          </div>
          <TabList
            selectedValue={filter}
            onTabSelect={(_, value) => setFilter(String(value.value))}
          >
            <Tab value="all">All</Tab>
            <Tab value="members">Members</Tab>
            <Tab value="adherent">Adherents</Tab>
            <Tab value="visitor">Visitors</Tab>
          </TabList>
          {groupRows(
            filtered.filter(
              (person) => person.membershipStatus !== "nonResident",
            ),
          )}
          {filtered.some(
            (person) => person.membershipStatus === "nonResident",
          ) && (
            <details className="non-resident">
              <summary>Non-resident members</summary>
              {groupRows(
                filtered.filter(
                  (person) => person.membershipStatus === "nonResident",
                ),
              )}
            </details>
          )}
          {!filtered.length && (
            <div className="empty surface">
              <PersonRegular fontSize={32} />
              <Subtitle2>No people match this list</Subtitle2>
              <p>
                {data.people.length
                  ? "Try another name or membership filter."
                  : "Add a household from People to begin building the roll."}
              </p>
            </div>
          )}
        </section>
        <aside className="attendance-aside">
          <div className="surface total-card">
            <span className="eyebrow">PRESENT TODAY</span>
            <strong aria-live="polite" data-testid="present-count">
              {counts.total}
            </strong>
            <span>of {onRoll.length} on the active roll</span>
            <hr />
            <dl>
              <div>
                <dt>Members</dt>
                <dd>
                  {counts.communicant + counts.baptized + counts.nonResident}
                </dd>
              </div>
              <div>
                <dt>Adherents</dt>
                <dd>{counts.adherent}</dd>
              </div>
              <div>
                <dt>Visitors</dt>
                <dd>{counts.visitor}</dd>
              </div>
            </dl>
          </div>
          <p className="aside-note">
            Each check saves as you go.
            <br />
            Space toggles the focused name.
          </p>
        </aside>
      </div>
      {undo && (
        <MessageBar className="undo" intent="info">
          Household cleared.{" "}
          <Button
            onClick={() => {
              undo.ids.forEach((id) => data.mark(service.id, id, true));
              setUndo(null);
            }}
          >
            Undo
          </Button>
        </MessageBar>
      )}
      <footer className="roll-footer" aria-live="polite">
        Members {counts.communicant + counts.baptized + counts.nonResident}{" "}
        <span>Adherents {counts.adherent}</span>{" "}
        <span>Visitors {counts.visitor}</span>
        <span className="muted">Children counted in families</span>
      </footer>
    </>
  );
}
function People({
  data,
  editor,
  add,
}: {
  data: AttendanceData;
  editor: boolean;
  add: () => void;
}) {
  const [search, setSearch] = useState("");
  const people = filterRoster(data.people, search);
  const rows = people.map((person) => ({
    Name: `${person.firstName} ${person.lastName}`,
    Status: statusLabels[person.membershipStatus],
    Household: person.householdName,
  }));
  return (
    <>
      <div className="page-heading">
        <div>
          <Title3 as="h1">People & households</Title3>
          <p>The active congregational roll</p>
        </div>
        <div className="actions">
          <ExportCsv rows={rows} />
          {editor && (
            <Button
              appearance="primary"
              icon={<AddRegular />}
              disabled={!data.online}
              onClick={add}
            >
              Add household
            </Button>
          )}
        </div>
      </div>
      <div className="surface table-card">
        <Input
          aria-label="Search people"
          placeholder="Search people or household…"
          value={search}
          onChange={(_, value) => setSearch(value.value)}
        />
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Household</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td>
                  {person.firstName} {person.lastName}
                </td>
                <td>{statusLabels[person.membershipStatus]}</td>
                <td>{person.householdName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!people.length && <p>No people match this list.</p>}
      </div>
    </>
  );
}
function Reports({ data }: { data: AttendanceData }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = data.services
    .filter(
      (service) =>
        (!from || service.date >= from) && (!to || service.date <= to),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((service) => {
      const counts = attendanceCounts(data.people, service);
      return {
        Date: service.date,
        Service:
          data.types.find((type) => type.id === service.serviceTypeId)?.name ||
          service.serviceTypeId,
        Communicant: counts.communicant,
        Baptized: counts.baptized,
        "Non-resident": counts.nonResident,
        Adherents: counts.adherent,
        Visitors: counts.visitor,
        Total: counts.total,
      };
    });
  return (
    <>
      <div className="print-heading">Sycamore Reformed Presbyterian Church</div>
      <div className="page-heading">
        <div>
          <Title3 as="h1">Attendance summary</Title3>
          <p>
            Name by name totals for each service. Membership categories reflect
            the current roll.
          </p>
        </div>
        <div className="actions">
          <ExportCsv rows={rows} />
          <Button
            icon={<PrintRegular />}
            onClick={() =>
              void (
                window.desktop?.printReport() ?? Promise.resolve(window.print())
              )
            }
          >
            Print / PDF
          </Button>
        </div>
      </div>
      <div className="service-bar surface">
        <Field label="From">
          <Input
            type="date"
            value={from}
            onChange={(_, value) => setFrom(value.value)}
          />
        </Field>
        <Field label="Through">
          <Input
            type="date"
            value={to}
            onChange={(_, value) => setTo(value.value)}
          />
        </Field>
      </div>
      <section className="surface table-card">
        <table>
          <thead>
            <tr>
              {[
                "Date",
                "Service",
                "Communicant",
                "Baptized",
                "Non-resident",
                "Adherents",
                "Visitors",
                "Total",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.Date}${row.Service}`}>
                {Object.values(row).map((value, index) => (
                  <td key={index}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No services in this date range.</p>}
      </section>
    </>
  );
}
function VisitorDrawer({
  serviceId,
  people,
  close,
}: {
  serviceId: string;
  people: RosterPerson[];
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [firstTime, setFirstTime] = useState(true);
  const families = [
    ...new Map(
      people.map((person) => [person.householdId, person.householdName]),
    ).entries(),
  ];
  const [family, setFamily] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await addVisitor({
        serviceId,
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        email: form.get("email"),
        mobilePhone: form.get("phone"),
        firstTime,
        householdId: family,
      });
      close();
    } catch {
      setError(
        "The visitor could not be added. Check the fields and your connection, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <OverlayDrawer
      open
      position="end"
      onOpenChange={(_, value) => {
        if (!value.open && !busy) close();
      }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              icon={<DismissRegular />}
              aria-label="Close visitor form"
              appearance="subtle"
              disabled={busy}
              onClick={close}
            />
          }
        >
          Add visitor
        </DrawerHeaderTitle>
      </DrawerHeader>
      <form onSubmit={submit} className="drawer-form">
        <DrawerBody>
          <p>Add the visitor by name and mark them present.</p>
          <Field label="First name" required>
            <Input name="firstName" autoFocus required />
          </Field>
          <Field label="Last name" required>
            <Input name="lastName" required />
          </Field>
          <Field label="Email">
            <Input type="email" name="email" />
          </Field>
          <Field label="Mobile phone">
            <Input type="tel" name="phone" />
          </Field>
          <Field label="With household">
            <Dropdown
              value={
                families.find(([id]) => id === family)?.[1] || "New household"
              }
              selectedOptions={[family]}
              onOptionSelect={(_, value) => setFamily(value.optionValue || "")}
            >
              <Option value="">New household</Option>
              {families.map(([id, name]) => (
                <Option key={id} value={id}>
                  {name}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Checkbox
            label="First time here"
            checked={firstTime}
            onChange={(_, value) => setFirstTime(value.checked === true)}
          />
          <p className="muted">
            Email and text consent remain off until consent is recorded.
          </p>
          {error && <MessageBar intent="error">{error}</MessageBar>}
        </DrawerBody>
        <DrawerFooter>
          <Button appearance="primary" type="submit" disabled={busy}>
            {busy ? "Adding visitor" : "Add and mark present"}
          </Button>
          <Button disabled={busy} onClick={close}>
            Cancel
          </Button>
        </DrawerFooter>
      </form>
    </OverlayDrawer>
  );
}
function HouseholdDrawer({ date, close }: { date: string; close: () => void }) {
  const [rows, setRows] = useState([
    {
      key: 0,
      firstName: "",
      lastName: "",
      membershipStatus: "communicant" as MembershipStatus,
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await createHousehold({
        date,
        household: {
          name: form.get("name"),
          address: form.get("address"),
          homePhone: "",
        },
        people: rows.map(({ firstName, lastName, membershipStatus }) => ({
          firstName,
          lastName,
          membershipStatus,
        })),
      });
      close();
    } catch {
      setError(
        "The household could not be added. Check each name and your connection, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <OverlayDrawer
      open
      size="medium"
      position="end"
      onOpenChange={(_, value) => {
        if (!value.open && !busy) close();
      }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              icon={<DismissRegular />}
              aria-label="Close household form"
              disabled={busy}
              onClick={close}
            />
          }
        >
          Add household
        </DrawerHeaderTitle>
      </DrawerHeader>
      <form onSubmit={submit} className="drawer-form">
        <DrawerBody>
          <Field label="Household name" required>
            <Input name="name" required autoFocus />
          </Field>
          <Field label="Address">
            <Input name="address" />
          </Field>
          <Subtitle2>People in this household</Subtitle2>
          {rows.map((row, index) => (
            <div className="household-entry" key={row.key}>
              <Field label="First name" required>
                <Input
                  required
                  value={row.firstName}
                  onChange={(_, value) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, firstName: value.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Last name" required>
                <Input
                  required
                  value={row.lastName}
                  onChange={(_, value) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, lastName: value.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Membership status">
                <Dropdown
                  value={statusLabels[row.membershipStatus]}
                  selectedOptions={[row.membershipStatus]}
                  onOptionSelect={(_, value) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index
                          ? {
                              ...r,
                              membershipStatus:
                                value.optionValue as MembershipStatus,
                            }
                          : r,
                      ),
                    )
                  }
                >
                  {membershipStatuses
                    .filter((status) => status !== "former")
                    .map((status) => (
                      <Option key={status} value={status}>
                        {statusLabels[status]}
                      </Option>
                    ))}
                </Dropdown>
              </Field>
              {rows.length > 1 && (
                <Button
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove person
                </Button>
              )}
            </div>
          ))}
          <Button
            icon={<AddRegular />}
            disabled={rows.length >= 20}
            onClick={() =>
              setRows([
                ...rows,
                {
                  key: Math.max(...rows.map((row) => row.key)) + 1,
                  firstName: "",
                  lastName: rows[0].lastName,
                  membershipStatus: "baptized",
                },
              ])
            }
          >
            Add another person
          </Button>
          {error && <MessageBar intent="error">{error}</MessageBar>}
        </DrawerBody>
        <DrawerFooter>
          <Button type="submit" appearance="primary" disabled={busy}>
            {busy ? "Adding household" : "Save household"}
          </Button>
          <Button disabled={busy} onClick={close}>
            Cancel
          </Button>
        </DrawerFooter>
      </form>
    </OverlayDrawer>
  );
}
