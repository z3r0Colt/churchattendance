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
  Switch,
  Tab,
  TabList,
  Title3,
  ToggleButton,
  Tooltip,
} from "@fluentui/react-components";
import { OverlayDrawer } from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  AddRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  CheckmarkCircleRegular,
  CheckmarkRegular,
  DismissRegular,
  NavigationRegular,
  PersonRegular,
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
import { useAuth, signOutUser } from "./data/auth";
import { configured, auth } from "./data/firebase";
import {
  addVisitor,
  createHousehold,
  useAttendanceData,
} from "./data/attendance";
import { darkTheme, lightTheme } from "./theme/brand";
import { NavGroup, NavItem } from "./components/Nav";
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
import { Shepherding } from "./chms/Shepherding";
import { Mercy } from "./chms/Mercy";
import { ImportantDates } from "./chms/ImportantDates";
import { Workflows } from "./chms/Workflows";
import { Kiosk } from "./chms/Kiosk";
import { AdvancedReports } from "./chms/Reports";
import { configureKiosk, enterKiosk } from "./data/chms";

import {
  AttendanceReports,
  type ReportRequest,
} from "./chms/AttendanceReports";
import { Dashboard } from "./chms/Dashboard";
import { Officers } from "./chms/Officers";
import { Communion } from "./chms/Communion";
import { Imports } from "./chms/Imports";
import { StaffPasswordForm, StaffEnrollment } from "./security/Factors";
import { Security } from "./security/Security";
import { ReauthHost } from "./security/Reauth";
import { PasskeySignIn } from "./security/PasskeySignIn";
import { browserStaffSignIn, securityCall } from "./data/security";
import { staffWeb } from "./platform";

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
  | "shepherding"
  | "mercy"
  | "dates"
  | "workflows"
  | "annual"
  | "portal"
  | "dashboard"
  | "officers"
  | "communion"
  | "imports"
  | "security";
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
      {authSession.error && (
        <MessageBar intent="error">{authSession.error}</MessageBar>
      )}
      {authSession.loading ? (
        <main className="center">
          <Spinner label="Opening Sycamore RPC" />
        </main>
      ) : authSession.kiosk && staffWeb ? (
        <KioskElsewhere />
      ) : authSession.kiosk ? (
        <Kiosk />
      ) : !authSession.user ? (
        <SignIn />
      ) : !authSession.assured ? (
        <StaffEnrollment
          auth={auth}
          refresh={() => void auth.currentUser?.getIdToken(true)}
        />
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
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="center">
      <section className="signin surface">
        <div className="wordmark">SYCAMORE RPC</div>
        <Title3>Welcome back</Title3>
        <p>Sign in to care for the congregation.</p>
        {!configured && (
          <MessageBar intent="warning">
            Firebase setup is needed before this app can connect.
          </MessageBar>
        )}
        <StaffPasswordForm auth={auth} tabOnly={staffWeb} />
        {staffWeb ? (
          <>
            <PasskeySignIn auth={auth} call={securityCall} />
            <p>
              This sign-in lasts until you close this tab. Nothing from the
              church records is kept in the browser.
            </p>
          </>
        ) : (
          <SignInWithBrowser
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            setNotice={setNotice}
          />
        )}
        {notice && <MessageBar intent="info">{notice}</MessageBar>}
        {error && <MessageBar intent="error">{error}</MessageBar>}
        <small>Sycamore Reformed Presbyterian Church</small>
      </section>
    </main>
  );
}
// The desktop opens the church security page in the system browser and waits for its approval.
function SignInWithBrowser({
  busy,
  setBusy,
  setError,
  setNotice,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  return (
    <Button
      disabled={busy || !configured}
      onClick={() => {
        setBusy(true);
        setError("");
        void browserStaffSignIn(setNotice)
          .catch((cause) =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Browser sign-in failed.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      Sign in with browser or passkey
    </Button>
  );
}
// A kiosk sign-in belongs on the church kiosk PC, never in a browser tab.
function KioskElsewhere() {
  return (
    <main className="center">
      <section className="signin surface">
        <Title3>The kiosk runs on the church PC</Title3>
        <p>Household check-in is not available in a browser.</p>
        <Button onClick={() => void signOutUser()}>Sign out</Button>
      </section>
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
  // On narrow screens the sidebar becomes a menu that opens over the page.
  const [navOpen, setNavOpen] = useState(false);
  const [lockWarning, setLockWarning] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
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
  // Marks on the staff web live only in this tab's memory until they reach the server.
  useEffect(() => {
    if (!staffWeb || !data.pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [data.pending]);
  useEffect(() => {
    if (!navOpen) return;
    document.querySelector<HTMLElement>("#main-nav .nav-item")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navOpen]);
  function lock() {
    if (staffWeb && data.pending) setLockWarning(true);
    else void signOutUser();
  }
  const service = data.services.find(
    (row) => row.serviceTypeId === selectedType && row.date === date,
  );
  const sync = data.error
    ? "Some changes did not save"
    : !data.online
      ? staffWeb
        ? "Offline, keep this tab open"
        : "Offline, changes saved on this PC"
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
    <div className={`workspace${navOpen ? " nav-open" : ""}`}>
      <header className="topbar">
        <Button
          ref={menuButton}
          appearance="subtle"
          className="menu-button"
          icon={<NavigationRegular />}
          aria-label="Menu"
          aria-expanded={navOpen}
          aria-controls="main-nav"
          onClick={() => setNavOpen(!navOpen)}
        />
        <div className="wordmark">
          Sycamore
          <span>REFORMED PRESBYTERIAN</span>
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
          <span className="topbar-user">
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
          <Button appearance="subtle" onClick={lock}>
            Lock now
          </Button>
        </div>
      </header>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
        />
      )}
      <nav
        aria-label="Main navigation"
        className="sidebar"
        id="main-nav"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest(".nav-item"))
            setNavOpen(false);
        }}
      >
        <div className="nav-user">
          {name}
          <small>{roles.map((role) => roleNames[role]).join(", ")}</small>
        </div>
        <NavGroup label="WORSHIP">
          {!volunteer && (
            <NavItem
              label="Dashboard"
              current={page === "dashboard"}
              onClick={() => setPage("dashboard")}
            />
          )}
          <NavItem
            label="Attendance"
            current={page === "attendance"}
            onClick={() => setPage("attendance")}
          />
          {!volunteer && (
            <>
              <NavItem
                label="Calendar"
                current={page === "calendar"}
                onClick={() => setPage("calendar")}
              />
              <NavItem
                label="Serving"
                current={page === "serving"}
                onClick={() => setPage("serving")}
              />
            </>
          )}
        </NavGroup>
        {!volunteer && (
          <NavGroup label="CONGREGATION">
            <NavItem
              label="People & households"
              current={page === "people"}
              onClick={() => setPage("people")}
            />
            <NavItem
              label="Groups"
              current={page === "groups"}
              onClick={() => setPage("groups")}
            />
            {editor && (
              <>
                <NavItem
                  label={`Messages${unreadTexts > 0 ? ` (${unreadTexts})` : ""}`}
                  current={page === "messages"}
                  onClick={() => setPage("messages")}
                />
                <NavItem
                  label="Bulletin"
                  current={page === "bulletin"}
                  onClick={() => setPage("bulletin")}
                />
              </>
            )}
            {hasRole(roles, EDITOR_ROLES) && (
              <NavItem
                label="Online access"
                current={page === "portal"}
                onClick={() => setPage("portal")}
              />
            )}
          </NavGroup>
        )}
        {!volunteer && hasRole(roles, SESSION_ROLES) && (
          <NavGroup label="CARE · SESSION ONLY">
            <NavItem
              label="Pastoral care"
              session
              current={page === "care"}
              onClick={() => setPage("care")}
            />
            <NavItem
              label="Shepherding"
              session
              current={page === "shepherding"}
              onClick={() => setPage("shepherding")}
            />
            <NavItem
              label="Care workflows"
              session
              current={page === "workflows"}
              onClick={() => setPage("workflows")}
            />
          </NavGroup>
        )}
        {!volunteer && hasRole(roles, [...EDITOR_ROLES, "deacon"]) && (
          <NavGroup label="MINISTRY">
            {!hasRole(roles, SESSION_ROLES) && hasRole(roles, ["deacon"]) && (
              <NavItem
                label="Deacon tasks"
                current={page === "care"}
                onClick={() => setPage("care")}
              />
            )}
            {hasRole(roles, [...SESSION_ROLES, "deacon"]) && (
              <NavItem
                label="Mercy ministry"
                current={page === "mercy"}
                onClick={() => setPage("mercy")}
              />
            )}
            {hasRole(roles, EDITOR_ROLES) && (
              <NavItem
                label="Important dates"
                current={page === "dates"}
                onClick={() => setPage("dates")}
              />
            )}
          </NavGroup>
        )}
        <NavGroup label="RECORDS">
          {!volunteer && (
            <>
              <NavItem
                label="Reports"
                current={page === "reports"}
                onClick={() => {
                  setReportRequest(undefined);
                  setPage("reports");
                }}
              />
              {hasRole(roles, [...EDITOR_ROLES, "readOnly"]) && (
                <NavItem
                  label="Annual reports"
                  current={page === "annual"}
                  onClick={() => setPage("annual")}
                />
              )}
              {hasRole(roles, SESSION_ROLES) && (
                <NavItem
                  label="Officers"
                  session
                  current={page === "officers"}
                  onClick={() => setPage("officers")}
                />
              )}
              {hasRole(roles, SESSION_ROLES) && (
                <NavItem
                  label="Communion"
                  session
                  current={page === "communion"}
                  onClick={() => setPage("communion")}
                />
              )}
              {editor && (
                <NavItem
                  label="Import people"
                  current={page === "imports"}
                  onClick={() => setPage("imports")}
                />
              )}
              <NavItem
                label="Settings"
                current={page === "settings"}
                onClick={() => setPage("settings")}
              />
            </>
          )}
          <NavItem
            label="Account security"
            current={page === "security"}
            onClick={() => setPage("security")}
          />
        </NavGroup>
      </nav>
      <main className="content">
        {lockWarning && (
          <MessageBar intent="warning">
            Some marks have not reached the church records yet. Locking now
            loses them.{" "}
            <Button size="small" onClick={() => void signOutUser()}>
              Lock anyway
            </Button>{" "}
            <Button size="small" onClick={() => setLockWarning(false)}>
              Keep working
            </Button>
          </MessageBar>
        )}
        {!data.online && (
          <MessageBar intent="warning">
            {staffWeb && page !== "attendance"
              ? "You are offline. Only attendance marks work offline in the browser. Changes on this page need a connection."
              : staffWeb
                ? "You are offline. Marks are kept in this tab until the connection returns, so keep this tab open."
                : "You are offline. Attendance changes stay on this PC until the connection returns."}
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
                <span className="eyebrow">{dateLine(date)}</span>
                <Title3 as="h1">Take attendance</Title3>
                <p>
                  {data.types.find((type) => type.id === selectedType)?.name ||
                    "Choose a service"}{" "}
                  · Children are counted with their families.
                </p>
              </div>
              <Button
                icon={<AddRegular />}
                disabled={!service || !data.online || !canMarkAttendance(roles)}
                onClick={() => setVisitor(true)}
              >
                Add visitor
              </Button>
            </div>
            <div className="service-bar">
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
                <div className="date-stepper">
                  <Tooltip content="A week earlier" relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<ChevronLeftRegular />}
                      disabled={!date}
                      onClick={() => setDate(shiftWeeks(date, -1))}
                    />
                  </Tooltip>
                  <Input
                    type="date"
                    aria-label="Service date"
                    value={date}
                    onChange={(_, value) => setDate(value.value)}
                  />
                  <Tooltip content="A week later" relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<ChevronRightRegular />}
                      disabled={!date}
                      onClick={() => setDate(shiftWeeks(date, 1))}
                    />
                  </Tooltip>
                </div>
              </Field>
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
            types={data.types}
            openCare={() => setPage("care")}
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
        {page === "shepherding" && hasRole(roles, SESSION_ROLES) && (
          <Shepherding roles={roles} />
        )}
        {page === "workflows" && hasRole(roles, SESSION_ROLES) && <Workflows />}
        {page === "officers" && hasRole(roles, SESSION_ROLES) && (
          <Officers roles={roles} zone={data.timeZone} />
        )}
        {page === "communion" && hasRole(roles, SESSION_ROLES) && (
          <Communion roles={roles} zone={data.timeZone} />
        )}
        {page === "imports" && editor && <Imports zone={data.timeZone} />}
        {page === "dates" && hasRole(roles, EDITOR_ROLES) && (
          <ImportantDates roles={roles} />
        )}
        {page === "mercy" && hasRole(roles, [...SESSION_ROLES, "deacon"]) && (
          <Mercy />
        )}
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
        {page === "security" && <Security roles={roles} />}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  {staffWeb
                    ? "THIS DEVICE AND THE CHURCH"
                    : "THIS PC AND THE CHURCH"}
                </span>
                <Title3 as="h1">Settings</Title3>
              </div>
            </div>
            <nav className="jump-links" aria-label="Settings sections">
              {[
                ["settings-pc", staffWeb ? "This device" : "This PC", true],
                [
                  "settings-church",
                  "Church, services and districts",
                  hasRole(roles, ["admin", "pastor"]),
                ],
                ["settings-communication", "Communication", editor],
                [
                  "settings-kiosk",
                  "Kiosk",
                  !staffWeb && hasRole(roles, ["admin", "pastor"]),
                ],
              ]
                .filter(([, , shown]) => shown)
                .map(([id, label]) => (
                  <Button
                    key={String(id)}
                    appearance="subtle"
                    onClick={() =>
                      document
                        .getElementById(String(id))
                        ?.scrollIntoView({ block: "start" })
                    }
                  >
                    {label}
                  </Button>
                ))}
            </nav>
            <section className="surface settings" id="settings-pc">
              <Subtitle2>{staffWeb ? "This device" : "This PC"}</Subtitle2>
              <Field label="Theme">
                <Dropdown
                  value={
                    theme === "system"
                      ? systemThemeName
                      : theme === "dark"
                        ? "Dark"
                        : "Light"
                  }
                  selectedOptions={[theme]}
                  onOptionSelect={(_, option) =>
                    changeTheme(option.optionValue || "system")
                  }
                >
                  <Option value="system">{systemThemeName}</Option>
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
              <div id="settings-church">
                <Administration roles={roles} />
              </div>
            )}
            {editor && (
              <div id="settings-communication">
                <CommunicationSettingsPanel
                  roles={roles}
                  serviceTypes={data.types}
                />
              </div>
            )}
            {!staffWeb && hasRole(roles, ["admin", "pastor"]) && (
              <section
                className="surface communication-panel"
                id="settings-kiosk"
              >
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
      <ReauthHost />
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
  // New marks are in person unless the volunteer switches to marking online worshippers.
  const [mode, setMode] = useState<"inPerson" | "online">("inPerson");
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
      const how = (id: string) =>
        service.present[id]?.mode === "online" ? "online" : "inPerson";
      const here = family.filter((person) => !!service.present[person.id]);
      return (
        <section className="household" key={id}>
          <div className="household-name">
            <h2>{householdPeople[0].householdName}</h2>
            <span className="muted">
              {here.length
                ? `${here.length} of ${family.length} here`
                : "None here yet"}
            </span>
          </div>
          <div className="household-people">
            {householdPeople.map((person) => (
              <ToggleButton
                key={person.id}
                data-roll-row
                checked={!!service.present[person.id]}
                disabled={!editable}
                className={`person-chip ${service.present[person.id] ? "present" : ""} ${service.present[person.id] && how(person.id) === "online" ? "online" : ""}`}
                onClick={() =>
                  data.mark(
                    service.id,
                    person.id,
                    !service.present[person.id],
                    mode,
                  )
                }
                aria-label={`${person.firstName} ${person.lastName}, ${service.present[person.id] ? (how(person.id) === "online" ? "online" : "present") : "absent"}`}
              >
                <span className="check-dot" aria-hidden="true">
                  {service.present[person.id] ? <CheckmarkRegular /> : null}
                </span>
                <span className="chip-text">
                  <span className="chip-name">
                    {person.preferredName || person.firstName}
                  </span>
                  <span className="chip-status">
                    {service.present[person.id] && how(person.id) === "online"
                      ? `Online · ${statusLabels[person.membershipStatus]}`
                      : statusLabels[person.membershipStatus]}
                  </span>
                </span>
              </ToggleButton>
            ))}
          </div>
          <Button
            appearance="subtle"
            className="household-action"
            disabled={!editable}
            onClick={() => {
              family.forEach((person) =>
                data.mark(service.id, person.id, !allPresent, mode),
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
        </section>
      );
    });
  }
  const previous = data.services
    .filter(
      (row) =>
        row.serviceTypeId === service.serviceTypeId && row.date < service.date,
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const resident = filtered.filter(
    (person) => person.membershipStatus !== "nonResident",
  );
  const away = filtered.filter(
    (person) => person.membershipStatus === "nonResident",
  );
  return (
    <>
      <div className="tiles" role="group" aria-label="Present today">
        <div className="tile lead">
          <span>Present</span>
          <strong aria-live="polite" data-testid="present-count">
            {counts.total}
          </strong>
          <small>
            of {onRoll.length} on the active roll
            {counts.online ? ` · ${counts.online} online` : ""}
          </small>
        </div>
        <div className="tile">
          <span>Members</span>
          <strong>
            {counts.communicant + counts.baptized + counts.nonResident}
          </strong>
        </div>
        <div className="tile">
          <span>Adherents</span>
          <strong>{counts.adherent}</strong>
        </div>
        <div className="tile">
          <span>Visitors</span>
          <strong>{counts.visitor}</strong>
        </div>
        <div className="tile">
          <span>Last time</span>
          <strong>
            {previous ? Object.keys(previous.present || {}).length : "–"}
          </strong>
          <small>
            {previous
              ? DateTime.fromISO(previous.date).toFormat("LLL d")
              : "No earlier service"}
          </small>
        </div>
      </div>
      <section className="roll-list">
        <div className="roll-toolbar">
          <Field
            label="Find a name or family"
            hint="Enter marks the first match · Ctrl+F jumps here"
          >
            <Input
              ref={input}
              aria-label="Search name or family"
              placeholder="Type a name"
              value={search}
              onChange={(_, value) => setSearch(value.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filtered[0] && editable) {
                  data.mark(
                    service.id,
                    filtered[0].id,
                    !service.present[filtered[0].id],
                    mode,
                  );
                  setSearch("");
                }
              }}
            />
          </Field>
          <TabList
            selectedValue={filter}
            onTabSelect={(_, value) => setFilter(String(value.value))}
          >
            <Tab value="all">All</Tab>
            <Tab value="members">Members</Tab>
            <Tab value="adherent">Adherents</Tab>
            <Tab value="visitor">Visitors</Tab>
          </TabList>
          <Switch
            label="Marking online worshippers"
            checked={mode === "online"}
            disabled={!editable}
            onChange={(_, value) =>
              setMode(value.checked ? "online" : "inPerson")
            }
          />
        </div>
        {!!resident.length && (
          <div className="roll-panel surface">{groupRows(resident)}</div>
        )}
        {!!away.length && (
          <details className="non-resident">
            <summary>Non-resident members</summary>
            <div className="roll-panel surface">{groupRows(away)}</div>
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
        <p className="aside-note">
          Each check saves as you go, even without a connection. Space marks the
          focused name.
        </p>
      </section>
      {undo && (
        <MessageBar className="undo" intent="info">
          Household cleared.{" "}
          <Button
            onClick={() => {
              undo.ids.forEach((id) => data.mark(service.id, id, true, mode));
              setUndo(null);
            }}
          >
            Undo
          </Button>
        </MessageBar>
      )}
      <footer className="roll-footer" aria-live="polite">
        <span className="footer-service">
          {data.types.find((type) => type.id === service.serviceTypeId)?.name}
          {" · "}
          {DateTime.fromISO(service.date).toFormat("LLL d")}
        </span>
        Members {counts.communicant + counts.baptized + counts.nonResident}{" "}
        <span>Adherents {counts.adherent}</span>{" "}
        <span>Visitors {counts.visitor}</span>
        {!!counts.online && <span>Online {counts.online}</span>}
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

// "Lord's Day, November 1, 2026" for Sundays, otherwise the weekday.
const systemThemeName = staffWeb ? "Match this device" : "Match Windows";
function dateLine(date: string) {
  const day = DateTime.fromISO(date);
  if (!date || !day.isValid) return "Choose a date";
  return `${day.weekday === 7 ? "Lord's Day" : day.toFormat("cccc")}, ${day.toFormat("LLLL d, yyyy")}`;
}
function shiftWeeks(date: string, weeks: number) {
  return DateTime.fromISO(date).plus({ weeks }).toISODate() || date;
}
