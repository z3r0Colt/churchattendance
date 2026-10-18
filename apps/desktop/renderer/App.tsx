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
  SettingsRegular,
  WeatherMoonRegular,
} from "@fluentui/react-icons";
import {
  canMarkAttendance,
  churchDate,
  EDITOR_ROLES,
  SESSION_ROLES,
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
import { Messages } from "./communications/Messages";
import { Bulletin } from "./communications/Bulletin";
import { CommunicationSettingsPanel } from "./communications/Settings";
import { useUnreadSms } from "./data/communications";

import { People } from "./chms/People";
import { Administration } from "./chms/Administration";
import { PortalAdministration } from "./chms/PortalAdmin";
import { Groups } from "./chms/Groups";
import { Calendar } from "./chms/Calendar";
import { Serving } from "./chms/Serving";
import { Care } from "./chms/Care";
import { Kiosk } from "./chms/Kiosk";
import { AdvancedReports } from "./chms/Reports";
import { configureKiosk, enterKiosk } from "./data/chms";

import {
  AttendanceReports,
  type ReportRequest,
} from "./chms/AttendanceReports";
import { Dashboard } from "./chms/Dashboard";

type AttendanceData = ReturnType<typeof useAttendanceData>;
type Page =
  | "attendance"
  | "people"
  | "reports"
  | "settings"
  | "messages"
  | "bulletin"
  | "groups"
  | "calendar"
  | "serving"
  | "care"
  | "annual"
  | "portal"
  | "dashboard";
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
      ) : authSession.kiosk ? (
        <Kiosk />
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
  const [reportRequest, setReportRequest] = useState<
    ReportRequest | undefined
  >();
  const [messageGroup, setMessageGroup] = useState("");
  const [kioskPin, setKioskPin] = useState("");
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
        {!volunteer && (
          <Button
            appearance={page === "dashboard" ? "primary" : "subtle"}
            onClick={() => setPage("dashboard")}
          >
            Dashboard
          </Button>
        )}
        <Button
          icon={<CheckmarkCircleRegular />}
          appearance={page === "attendance" ? "primary" : "subtle"}
          onClick={() => setPage("attendance")}
        >
          Attendance
        </Button>
        {editor && (
          <>
            <Button
              appearance={page === "messages" ? "primary" : "subtle"}
              onClick={() => setPage("messages")}
            >
              Messages {unreadTexts > 0 ? `(${unreadTexts})` : ""}
            </Button>
            <Button
              appearance={page === "bulletin" ? "primary" : "subtle"}
              onClick={() => setPage("bulletin")}
            >
              Bulletin
            </Button>
          </>
        )}
        {hasRole(roles, EDITOR_ROLES) && (
          <Button
            appearance={page === "portal" ? "primary" : "subtle"}
            onClick={() => setPage("portal")}
          >
            Online access
          </Button>
        )}
        {!volunteer && (
          <>
            <Button
              appearance={page === "groups" ? "primary" : "subtle"}
              onClick={() => setPage("groups")}
            >
              Groups
            </Button>
            <Button
              appearance={page === "calendar" ? "primary" : "subtle"}
              onClick={() => setPage("calendar")}
            >
              Calendar
            </Button>
            <Button
              appearance={page === "serving" ? "primary" : "subtle"}
              onClick={() => setPage("serving")}
            >
              Serving
            </Button>
            {hasRole(roles, [...SESSION_ROLES, "deacon"]) && (
              <Button
                appearance={page === "care" ? "primary" : "subtle"}
                onClick={() => setPage("care")}
              >
                {hasRole(roles, SESSION_ROLES)
                  ? "Pastoral care · Session only"
                  : "Deacon tasks"}
              </Button>
            )}
            {hasRole(roles, [...EDITOR_ROLES, "readOnly"]) && (
              <Button
                appearance={page === "annual" ? "primary" : "subtle"}
                onClick={() => setPage("annual")}
              >
                Annual reports
              </Button>
            )}
          </>
        )}
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
              onClick={() => {
                setReportRequest(undefined);
                setPage("reports");
              }}
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
          Church management<small>Phase 6 · Development</small>
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
          <People
            roles={roles}
            timeZone={data.timeZone}
            services={data.services}
            add={() => setHousehold(true)}
          />
        )}
        {page === "reports" && !volunteer && (
          <AttendanceReports
            roles={roles}
            timeZone={data.timeZone}
            initial={reportRequest}
          />
        )}
        {page === "dashboard" && !volunteer && (
          <Dashboard
            roles={roles}
            timeZone={data.timeZone}
            report={(request) => {
              setReportRequest(request);
              setPage("reports");
            }}
            open={setPage}
          />
        )}
        {page === "portal" && hasRole(roles, EDITOR_ROLES) && (
          <PortalAdministration roles={roles} />
        )}
        {page === "groups" && !volunteer && (
          <Groups
            roles={roles}
            message={(id) => {
              setMessageGroup(id);
              setPage("messages");
            }}
          />
        )}
        {page === "calendar" && !volunteer && <Calendar roles={roles} />}
        {page === "serving" && !volunteer && <Serving roles={roles} />}
        {page === "care" && hasRole(roles, [...SESSION_ROLES, "deacon"]) && (
          <Care roles={roles} />
        )}
        {page === "annual" && hasRole(roles, [...EDITOR_ROLES, "readOnly"]) && (
          <AdvancedReports roles={roles} />
        )}
        {page === "messages" && editor && (
          <Messages
            roles={roles}
            initialAudience={
              messageGroup ? { kind: "group", ids: [messageGroup] } : undefined
            }
          />
        )}
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
                Account creation and staff roles use the trusted setup process.
              </p>
            </section>
            {hasRole(roles, ["admin", "pastor"]) && (
              <Administration roles={roles} />
            )}
            {editor && (
              <CommunicationSettingsPanel
                roles={roles}
                serviceTypes={data.types}
              />
            )}
            {hasRole(roles, ["admin", "pastor"]) && (
              <section className="surface communication-panel">
                <Subtitle2>Optional household kiosk</Subtitle2>
                <p>
                  Open a service in Attendance first. Starting the kiosk signs
                  out staff and clears this PC's cached records. Close other app
                  windows first. Kiosk searches require a connection.
                </p>
                <Field label="Kiosk exit PIN, 6 to 12 digits">
                  <Input
                    type="password"
                    value={kioskPin}
                    onChange={(_, row) => setKioskPin(row.value)}
                  />
                </Field>
                <div className="actions">
                  <Button
                    onClick={() =>
                      void configureKiosk({ enabled: true, pin: kioskPin })
                        .then(() =>
                          data.setError(
                            "Kiosk enabled. Keep the exit PIN with the Administrator or Pastor.",
                          ),
                        )
                        .catch(() =>
                          data.setError(
                            "The kiosk setting could not be saved. Use a PIN of 6 to 12 digits.",
                          ),
                        )
                    }
                  >
                    Enable kiosk and set PIN
                  </Button>
                  <Button
                    onClick={() =>
                      void configureKiosk({ enabled: false, pin: kioskPin })
                        .then(() => data.setError("Kiosk disabled."))
                        .catch(() =>
                          data.setError(
                            "The kiosk setting could not be saved.",
                          ),
                        )
                    }
                  >
                    Disable kiosks
                  </Button>
                  <Button
                    disabled={!service}
                    onClick={() =>
                      void enterKiosk(service!.id).catch(() =>
                        data.setError(
                          "The kiosk could not open. Close other app windows and restart the app before trying again.",
                        ),
                      )
                    }
                  >
                    Start kiosk for open service
                  </Button>
                </div>
              </section>
            )}
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
