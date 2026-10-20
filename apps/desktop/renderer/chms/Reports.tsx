import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  Select,
  Spinner,
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import {
  annualStatistics,
  meetingSummary,
  directoryRows,
  EDITOR_ROLES,
  hasRole,
  reportLabelsSchema,
  type Role,
} from "@sycamore/shared";
import {
  chmsCall,
  saveSacrament,
  saveStatisticalOptions,
  uploadPersonPhoto,
  useCollection,
  useReportData,
} from "../data/chms";
import { exportCsv } from "../data/export";
import {
  escapeHtml,
  exportReportWorkbook,
  photoData,
  reportChart,
  reportHtml,
  reportTable,
  savePdf,
} from "../data/reports";
import {
  Picker,
  Records,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";
export function AdvancedReports({ roles }: { roles: Role[] }) {
  const data = useReportData();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState("annual");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState("");
  const [person, setPerson] = useState("");
  const [sacrament, setSacrament] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const labelsData = useCollection<{
    id: string;
    labels: Record<string, string>;
  }>("reportSettings");
  useEffect(
    () =>
      setLabels(
        labelsData.rows.find((row) => row.id === "statistical")?.labels || {},
      ),
    [labelsData.rows],
  );
  const editable = hasRole(roles, EDITOR_ROLES);
  const typeIds = data.types
    .filter((row) => row.dayOfWeek === 0)
    .map((row) => row.id);
  const attendanceMode =
    (
      labelsData.rows.find((row) => row.id === "statisticalOptions") as
        { attendanceMode?: "inPerson" | "combined" } | undefined
    )?.attendanceMode ?? "inPerson";
  const annual = annualStatistics(
    data.people,
    data.history,
    data.sacraments,
    data.services,
    year,
    typeIds,
    attendanceMode,
  );
  const monthly = meetingSummary(
    data.people,
    data.history,
    data.services,
    year,
    data.types.map((row) => row.id),
  );
  useEffect(() => {
    setChart(
      reportChart(
        monthly.map(
          (row) =>
            `${row.Month} ${data.types.find((type) => type.id === row.Service)?.name || row.Service}`,
        ),
        monthly.map((row) => row.Average),
      ),
    );
  }, [year, data.services, data.history, data.people, data.types]);
  const summary = annual.map((row) => ({
    Measure: labels[String(row.Measure)] || row.Measure,
    Count: row.Count,
  }));
  const changes = data.history
    .filter((row) => row.date.startsWith(String(year)))
    .map((row) => ({
      Person:
        data.people.find((person) => person.id === row.personId)?.firstName +
        " " +
        (data.people.find((person) => person.id === row.personId)?.lastName ||
          ""),
      Date: row.date,
      From: row.fromStatus || "Not on roll",
      To: row.toStatus,
      Method: row.method,
      Reason: row.reason,
    }));
  const directory = directoryRows(data.people, data.households);
  const directoryData = directory.flatMap((row) =>
    row.people.map((person) => ({
      Household: row.household.name,
      Name: `${person.firstName} ${person.lastName}`,
      Address: row.household.address,
      HomePhone: row.household.homePhone,
      Mobile: person.mobilePhone,
      Email: person.email,
    })),
  );
  const title =
    tab === "annual"
      ? "Annual statistical report"
      : tab === "meeting"
        ? "Congregational meeting summary"
        : "Photo directory";
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  async function pdf() {
    let html = "";
    if (tab === "directory") {
      let missing = 0;
      const cards = await Promise.all(
        directory.map(async (row) => {
          const people = await Promise.all(
            row.people.map(async (person) => {
              let photo = "";
              try {
                photo = await photoData(person.photoPath);
              } catch {
                missing++;
              }
              return `${photo ? `<img class="portrait" alt="" src="${photo}">` : ""}<p><strong>${escapeHtml(person.firstName + " " + person.lastName)}</strong><br>${escapeHtml(person.mobilePhone)}<br>${escapeHtml(person.email)}</p>`;
            }),
          );
          return `<article class="directory-family"><h2>${escapeHtml(row.household.name)}</h2><p>${escapeHtml(row.household.address)}<br>${escapeHtml(row.household.homePhone)}</p>${people.join("")}</article>`;
        }),
      );
      if (missing)
        throw new Error(
          "Some directory photos could not be loaded. Reconnect and try again before exporting.",
        );
      html = `<p>For congregation use. Keep contact details within the church.</p><div class="directory">${cards.join("")}</div>`;
    } else
      html = `<h2>Summary</h2>${reportTable(tab === "annual" ? summary : monthly)}${chart ? `<img class="chart" alt="Monthly average attendance" src="${chart}">` : ""}<h2 class="page-break">Membership changes</h2>${reportTable(changes)}<p>Attendance uses recorded services. Missing service records are not zero-attendance meetings. Missing membership history is reported and must be resolved before the statistical form is submitted.</p>`;
    await savePdf(
      title,
      reportHtml(
        title,
        tab === "directory" ? "Current active households" : String(year),
        html,
      ),
    );
  }
  const fields: EditorField[] = [
    {
      key: "personId",
      label: "Person",
      kind: "select",
      required: true,
      options: data.people.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
      })),
    },
    {
      key: "type",
      label: "Record type",
      kind: "select",
      options: [
        { id: "baptism", name: "Baptism" },
        { id: "profession", name: "Profession" },
      ],
    },
    { key: "date", label: "Date", kind: "date", required: true },
    {
      key: "category",
      label: "Baptism classification",
      kind: "select",
      options: [
        { id: "infant", name: "Infant" },
        { id: "adult", name: "Adult" },
      ],
    },
    { key: "place", label: "Place" },
    { key: "officiant", label: "Officiant" },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">RECORDS FOR THE CHURCH</span>
          <Title3 as="h1">Annual reports & directory</Title3>
          <p>Summary, detail and source data, ready for review and export.</p>
        </div>
        <Button onClick={data.refresh}>Refresh history</Button>
      </div>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, row) => setTab(String(row.value))}
      >
        <Tab value="annual">Statistical report</Tab>
        <Tab value="meeting">Meeting summary</Tab>
        <Tab value="directory">Photo directory</Tab>
      </TabList>
      {(error || data.error || labelsData.error) && (
        <MessageBar intent="error">
          {error || data.error || labelsData.error}
        </MessageBar>
      )}
      {!data.loaded ? (
        <Spinner label="Loading membership history" />
      ) : (
        <>
          {tab !== "directory" && (
            <Field label="Report year">
              <Input
                type="number"
                min="1900"
                max="2100"
                defaultValue={String(year)}
                onBlur={(event) => {
                  event.target.value = String(year);
                }}
                onChange={(_, row) => {
                  const value = Number(row.value);
                  if (value >= 1900 && value <= 2100) setYear(value);
                }}
              />
            </Field>
          )}
          <div className="actions">
            <Button disabled={busy} onClick={() => void perform(pdf)}>
              Print / PDF
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  exportCsv(
                    tab === "directory"
                      ? directoryData
                      : tab === "annual"
                        ? summary
                        : monthly,
                  ),
                )
              }
            >
              Export CSV
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  exportReportWorkbook(
                    title,
                    tab === "directory"
                      ? directoryData
                      : tab === "annual"
                        ? summary
                        : monthly,
                    tab === "directory" ? directoryData : changes,
                    tab === "directory"
                      ? directoryData
                      : data.services
                          .filter((row) => row.date.startsWith(String(year)))
                          .map((row) => ({
                            Date: row.date,
                            Service: row.serviceTypeId,
                            Attendance: Object.keys(row.present).length,
                          })),
                    tab === "directory" ? "" : chart,
                  ),
                )
              }
            >
              Export XLSX
            </Button>
            {editable && tab === "annual" && (
              <>
                <Button onClick={() => setLabelsOpen(true)}>
                  Adjust report labels
                </Button>
                <Button onClick={() => setSacrament(true)}>
                  Record baptism or profession
                </Button>
                <Select
                  aria-label="Average attendance counts"
                  value={attendanceMode}
                  onChange={(event) =>
                    void saveStatisticalOptions({
                      attendanceMode: event.target.value,
                    }).catch((cause) => setError(friendlyError(cause)))
                  }
                >
                  <option value="inPerson">
                    Average counts in person only
                  </option>
                  <option value="combined">
                    Average counts in person and online
                  </option>
                </Select>
              </>
            )}
          </div>
          {tab === "directory" ? (
            <>
              <MessageBar intent="info">
                Only active member and adherent households are included. Review
                contact details before sharing within the congregation.
              </MessageBar>
              {editable && (
                <div className="report-filters">
                  <Picker
                    label="Person for directory photo"
                    value={person}
                    choices={data.people.map((row) => ({
                      id: row.id,
                      name: `${row.firstName} ${row.lastName}`,
                    }))}
                    onChange={setPerson}
                  />
                  <Field label="Upload person photo">
                    <input
                      aria-label="Upload person photo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={!person || busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file)
                          void perform(() => uploadPersonPhoto(person, file));
                        event.target.value = "";
                      }}
                    />
                  </Field>
                </div>
              )}
              <Records label="Photo directory" rows={directoryData} />
            </>
          ) : (
            <>
              <MessageBar intent="info">
                Review incomplete history and baptism classifications before
                using these figures on the presbytery form. Baptized children
                who profess are counted as received by profession.
              </MessageBar>
              {chart && (
                <img
                  className="report-chart"
                  src={chart}
                  alt="Monthly average attendance"
                />
              )}
              <Records
                label={
                  tab === "annual" ? "Statistical report" : "Meeting summary"
                }
                rows={tab === "annual" ? summary : monthly}
              />
              <Records label="Membership changes" rows={changes} />
              <details>
                <summary>Baptism and profession source records</summary>
                <Records
                  label="Baptism and profession source records"
                  rows={data.sacraments
                    .filter((row) => row.date.startsWith(String(year)))
                    .map((row) => ({
                      Person:
                        data.people.find((person) => person.id === row.personId)
                          ?.firstName || row.personId,
                      Type: row.type,
                      Date: row.date,
                      Classification: row.category || "Needs review",
                    }))}
                />
              </details>
            </>
          )}
        </>
      )}
      {sacrament && (
        <RecordEditor
          title="Record baptism or profession"
          fields={fields}
          initial={{
            id: crypto.randomUUID(),
            expectedRevision: 0,
            personId: "",
            type: "baptism",
            date: `${year}-01-01`,
            category: "infant",
            place: "",
            officiant: "",
          }}
          save={async (value) => {
            await saveSacrament(value);
            data.refresh();
          }}
          close={() => setSacrament(false)}
        />
      )}{" "}
      {labelsOpen && (
        <RecordEditor
          title="Presbytery report labels"
          fields={annual.map((row) => ({
            key: String(row.Measure),
            label: String(row.Measure),
            required: true,
          }))}
          initial={Object.fromEntries(
            annual.map((row) => [
              row.Measure,
              labels[String(row.Measure)] || row.Measure,
            ]),
          )}
          save={(value) =>
            chmsCall("saveReportLabels", reportLabelsSchema.parse(value))
          }
          close={() => setLabelsOpen(false)}
        />
      )}
    </>
  );
}
