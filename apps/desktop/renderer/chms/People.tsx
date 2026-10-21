import { useState } from "react";
import {
  Button,
  Input,
  MessageBar,
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import {
  churchDate,
  EDITOR_ROLES,
  hasRole,
  membershipEventSchema,
  membershipStatuses,
  personInputSchema,
  saveHouseholdSchema,
  savePersonSchema,
  statusLabels,
  type ElderDistrict,
  type HistoryEvent,
  type Household,
  type Person,
  SESSION_ROLES,
  type Role,
  type Service,
  type ServiceType,
} from "@sycamore/shared";
import { chmsCall, useCollection } from "../data/chms";
import { addPerson } from "../data/administration";
import { ConsentDialog } from "../communications/Messages";
import { Picker, RecordEditor, Records, type EditorField } from "./Common";
import { PersonProfile } from "./PersonProfile";
type Family = Household & { revision?: number };
export function People({
  roles,
  add,
  timeZone,
  types,
  openCare,
}: {
  roles: Role[];
  add: () => void;
  timeZone: string;
  types: ServiceType[];
  openCare: () => void;
}) {
  const { rows: services } = useCollection<Service>("services");
  const people = useCollection<Person>("people"),
    families = useCollection<Family>("households"),
    districts = useCollection<ElderDistrict>("elderDistricts");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [district, setDistrict] = useState(""),
    [tab, setTab] = useState("people"),
    [selectedId, setSelected] = useState("");
  const [editing, setEditing] = useState<{
    kind: "person" | "family" | "new";
    value: Record<string, unknown>;
    person?: Person;
  } | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => { setRequestId(crypto.randomUUID()); }, [editing]);
  const [contact, setContact] = useState<Person | null>(null);
  const editor = hasRole(roles, EDITOR_ROLES),
    selected = people.rows.find((row) => row.id === selectedId);
  const history = useCollection<HistoryEvent & { id: string }>(
    selectedId ? `people/${selectedId}/membershipEvents` : "",
  );
  const familyName = (id: string) =>
    families.rows.find((row) => row.id === id)?.name || id;
  const lastAttended = (id: string) =>
    services
      .filter((row) => row.present[id])
      .map((row) => row.date)
      .sort()
      .at(-1) || "";
  const filtered = people.rows
    .filter(
      (row) =>
        `${row.firstName} ${row.lastName} ${row.preferredName} ${familyName(row.householdId)}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!status || row.membershipStatus === status) &&
        (!district || row.elderDistrictId === district),
    )
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
  const fields: EditorField[] = [
    { key: "firstName", label: "First name", required: true },
    { key: "lastName", label: "Last name", required: true },
    { key: "preferredName", label: "Preferred name" },
    {
      key: "householdId",
      label: "Household",
      kind: "select",
      options: families.rows.map((row) => ({ id: row.id, name: row.name })),
      required: true,
    },
    { key: "birthDate", label: "Birth date", kind: "date" },
    {
      key: "elderDistrictId",
      label: "Elder district",
      kind: "select",
      options: districts.rows
        .filter(
          (row) => !row.archived || row.id === editing?.person?.elderDistrictId,
        )
        .map((row) => ({ id: row.id, name: row.name })),
    },
    {
      key: "membershipStatus",
      label: "Membership status",
      kind: "select",
      required: true,
      options: membershipStatuses.map((id) => ({ id, name: statusLabels[id] })),
    },
    { key: "isDeceased", label: "Deceased", kind: "checkbox" },
    {
      key: "date",
      label:
        editing?.kind === "new" ? "Initial roll date" : "Status change date",
      kind: "date",
      required: editing?.kind === "new",
    },
    ...(editing?.kind === "new"
      ? []
      : [
          {
            key: "method",
            label: "Status change method",
            kind: "select" as const,
            options: membershipEventSchema.shape.method.options
              .filter((id) => id !== "initial")
              .map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
          },
          { key: "otherChurch", label: "Other church" },
          {
            key: "reason",
            label: "Status change reason",
            kind: "textarea" as const,
          },
        ]),
  ];
  const profile = selected && (
    <PersonProfile
      person={selected}
      people={people.rows}
      household={familyName(selected.householdId)}
      address={
        families.rows.find((row) => row.id === selected.householdId)?.address ||
        ""
      }
      district={
        districts.rows.find((row) => row.id === selected.elderDistrictId)
          ?.name || ""
      }
      services={services}
      types={types}
      history={history.rows}
      today={churchDate(new Date(), timeZone)}
      editor={editor}
      session={hasRole(roles, SESSION_ROLES)}
      back={() => setSelected("")}
      openCare={openCare}
      contact={() => setContact({ ...selected })}
      edit={() =>
        setEditing({
          kind: "person",
          value: {
            ...selected,
            date: churchDate(new Date(), timeZone),
            method: "",
            reason: "",
            otherChurch: "",
          },
          person: { ...selected },
        })
      }
    />
  );
  return (
    <>
      {profile}
      <div className="page-heading" hidden={!!selected}>
        <div>
          <span className="eyebrow">THE CONGREGATION</span>
          <Title3 as="h1">People & households</Title3>
          <p>Contact information and membership records</p>
        </div>
        {editor && (
          <div className="actions">
            <Button
              onClick={() =>
                setEditing({
                  kind: "new",
                  value: {
                    firstName: "",
                    lastName: "",
                    preferredName: "",
                    birthDate: "",
                    householdId: families.rows[0]?.id || "",
                    elderDistrictId: "",
                    membershipStatus: "visitor",
                    isDeceased: false,
                    date: churchDate(new Date(), timeZone),
                  },
                })
              }
            >
              Add person
            </Button>
            <Button appearance="primary" onClick={add}>
              Add household
            </Button>
          </div>
        )}
      </div>
      {!selected &&
        (people.error ||
          families.error ||
          districts.error ||
          history.error) && (
          <MessageBar intent="error">
            {people.error || families.error || districts.error || history.error}
          </MessageBar>
        )}
      {!selected && (
        <>
          <TabList
            selectedValue={tab}
            onTabSelect={(_, data) => {
              setTab(String(data.value));
              setSearch("");
            }}
          >
            <Tab value="people">People</Tab>
            <Tab value="households">Households</Tab>
          </TabList>
          {tab === "households" && (
            <Input
              aria-label="Search households"
              placeholder="Search households"
              value={search}
              onChange={(_, data) => setSearch(data.value)}
            />
          )}
          {tab === "people" ? (
            <>
              <div className="list-toolbar">
                <Input
                  aria-label="Search people"
                  placeholder="Search people or household"
                  value={search}
                  onChange={(_, data) => setSearch(data.value)}
                />
                <Picker
                  label="Status filter"
                  value={status}
                  onChange={setStatus}
                  empty="All statuses"
                  choices={membershipStatuses.map((id) => ({
                    id,
                    name: statusLabels[id],
                  }))}
                />
                <Picker
                  label="District filter"
                  value={district}
                  onChange={setDistrict}
                  empty="All districts"
                  choices={districts.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                  }))}
                />
              </div>
              <Records
                label="People"
                rows={filtered.map((row) => ({
                  id: row.id,
                  Name: `${row.firstName} ${row.lastName}`,
                  Status: statusLabels[row.membershipStatus],
                  Household: familyName(row.householdId),
                  District:
                    districts.rows.find(
                      (district) => district.id === row.elderDistrictId,
                    )?.name || "",
                  Mobile: row.mobilePhone,
                  Email: row.email,
                  "Last attended": lastAttended(row.id),
                  Deceased: row.isDeceased ? "Yes" : "No",
                }))}
                empty="No people match this search."
                choose={(index) => setSelected(filtered[index].id)}
              />
            </>
          ) : (
            <Records
              label="Households"
              rows={families.rows
                .filter((row) =>
                  row.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((row) => ({
                  id: row.id,
                  Household: row.name,
                  Address: row.address,
                  "Home phone": row.homePhone,
                  People: people.rows.filter(
                    (person) => person.householdId === row.id,
                  ).length,
                }))}
              choose={
                editor
                  ? (index) => {
                      const row = families.rows.filter((row) =>
                        row.name.toLowerCase().includes(search.toLowerCase()),
                      )[index];
                      setEditing({
                        kind: "family",
                        value: { ...row, expectedRevision: row.revision || 0 },
                      });
                    }
                  : undefined
              }
            />
          )}
        </>
      )}
      {contact && (
        <ConsentDialog person={contact} close={() => setContact(null)} />
      )}
      {editing && (
        <RecordEditor
          title={
            editing.kind === "family"
              ? "Edit household"
              : editing.kind === "new"
                ? "Add person to a household"
                : "Edit profile and membership"
          }
          initial={editing.value}
          fields={
            editing.kind === "family"
              ? [
                  { key: "name", label: "Household name", required: true },
                  { key: "address", label: "Address", kind: "textarea" },
                  { key: "homePhone", label: "Home phone" },
                ]
              : fields
          }
          close={() => setEditing(null)}
          save={async (value) => {
            if (editing.kind === "family")
              return chmsCall(
                "saveHousehold",
                saveHouseholdSchema.parse(value),
              );
            const { date, method, otherChurch, reason, ...personFields } =
              value;
            if (editing.kind === "new")
              return addPerson({
                requestId,
                date,
                person: personInputSchema.parse(personFields),
              });
            const before = editing.person!;
            const changes = Object.fromEntries(
              Object.entries(personFields).filter(
                ([key, next]) =>
                  key !== "id" && (before[key as keyof Person] ?? "") !== next,
              ),
            );
            if (!Object.keys(changes).length) return;
            const expected = Object.fromEntries(
              Object.keys(changes).map((key) => [
                key,
                before[key as keyof Person] ?? "",
              ]),
            );
            const membershipEvent =
              "membershipStatus" in changes || "isDeceased" in changes
                ? {
                    date,
                    method,
                    otherChurch,
                    reason,
                    fromStatus: before.membershipStatus,
                    toStatus:
                      changes.membershipStatus ?? before.membershipStatus,
                  }
                : undefined;
            return chmsCall(
              "savePerson",
              savePersonSchema.parse({
                id: before.id,
                changes,
                expected,
                ...(membershipEvent ? { membershipEvent } : {}),
              }),
            );
          }}
        />
      )}
    </>
  );
}
