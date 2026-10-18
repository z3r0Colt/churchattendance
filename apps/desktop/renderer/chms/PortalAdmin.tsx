import { useState } from "react";
import {
  Button,
  MessageBar,
  Tab,
  TabList,
  Title3,
} from "@fluentui/react-components";
import {
  eventPublicationSchema,
  portalAccessSchema,
  reviewSubmissionSchema,
  type OnlineSubmission,
  type Role,
} from "@sycamore/shared";
import { chmsCall, useCollection, usePublicChms } from "../data/chms";
import {
  Picker,
  Records,
  RecordEditor,
  friendlyError,
  type EditorField,
} from "./Common";
type Access = {
  id: string;
  personId: string;
  enabled: boolean;
  revision: number;
};
type Publication = {
  id: string;
  eventId: string;
  portalVisible: boolean;
  publicRegistration: boolean;
  description: string;
  revision: number;
};
export function PortalAdministration({ roles }: { roles: Role[] }) {
  const administrator = roles.some((role) =>
    ["admin", "pastor"].includes(role),
  );
  const data = usePublicChms();
  const access = useCollection<Access>(administrator ? "portalAccess" : ""),
    publications = useCollection<Publication>("eventPublications"),
    submissions = useCollection<OnlineSubmission>("onlineSubmissions");
  const [tab, setTab] = useState("requests"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<{
      kind: "access" | "publication";
      value: Record<string, unknown>;
    } | null>(null),
    [selected, setSelected] = useState<OnlineSubmission | null>(null),
    [person, setPerson] = useState(""),
    [busy, setBusy] = useState(false);
  const people = data.people
    .filter((row) => !row.isDeceased && row.membershipStatus !== "former")
    .map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
  const eligible = people.filter(
    (row) =>
      data.people.find((person) => person.id === row.id)?.membershipStatus !==
      "visitor",
  );
  const requests = submissions.rows.sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      a.status.localeCompare(b.status),
  );
  async function review(action: "approve" | "decline") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await chmsCall(
        "reviewOnlineSubmission",
        reviewSubmissionSchema.parse({
          id: selected.id,
          action,
          personId: person,
        }),
      );
      setSelected(null);
      setNotice(
        action === "approve"
          ? "Request approved. Messaging consent stays unchanged."
          : "Request declined.",
      );
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  const accessFields: EditorField[] = [
    {
      key: "uid",
      label: "Firebase Authentication account UID",
      required: true,
    },
    {
      key: "personId",
      label: "Linked person",
      kind: "select",
      required: true,
      options: eligible,
    },
    { key: "enabled", label: "Enable member portal access", kind: "checkbox" },
  ];
  const publicationFields: EditorField[] = [
    {
      key: "eventId",
      label: "Event series",
      kind: "select",
      required: true,
      options: data.events.map((row) => ({ id: row.id, name: row.title })),
    },
    { key: "description", label: "Online description", kind: "textarea" },
    {
      key: "portalVisible",
      label: "Show this series to members",
      kind: "checkbox",
    },
    {
      key: "publicRegistration",
      label: "Publish event details and a request form to everyone",
      kind: "checkbox",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ONLINE CONNECTIONS</span>
          <Title3 as="h1">Portal & online requests</Title3>
          <p>
            Review requests before adding people, and choose what is shared
            online.
          </p>
        </div>
      </div>
      <MessageBar intent="info">
        Directory sharing starts off. Portal accounts need verified email and an
        administrator's person link. Public registration requests reserve no
        place until staff approve them.
      </MessageBar>
      {(error ||
        data.error ||
        access.error ||
        publications.error ||
        submissions.error) && (
        <MessageBar intent="error">
          {error ||
            data.error ||
            access.error ||
            publications.error ||
            submissions.error}
        </MessageBar>
      )}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <TabList
        selectedValue={tab}
        onTabSelect={(_, row) => setTab(String(row.value))}
      >
        <Tab value="requests">Incoming requests</Tab>
        <Tab value="events">Online events</Tab>
        {administrator && <Tab value="access">Member access</Tab>}
      </TabList>
      {tab === "requests" ? (
        <>
          <Records
            rows={requests.map((row) => ({
              id: row.id,
              Name: `${row.firstName} ${row.lastName}`,
              Kind: row.kind,
              Email: row.email,
              Phone: row.mobilePhone,
              Event: row.eventId
                ? data.events.find((event) => event.id === row.eventId)
                    ?.title || row.eventId
                : "",
              Date: row.date,
              Message: row.message,
              Status: row.status,
            }))}
            choose={(index) => {
              setSelected(requests[index]);
              setPerson("");
            }}
          />
          {selected && (
            <section className="surface communication-panel">
              <h2>
                {selected.firstName} {selected.lastName}
              </h2>
              <p>
                {selected.email} · {selected.mobilePhone}
              </p>
              <p className="message-body">{selected.message}</p>
              {selected.status === "pending" ? (
                <>
                  <Picker
                    label="Link to an existing person, or create a visitor"
                    value={person}
                    choices={people}
                    onChange={setPerson}
                    empty="Create a new visitor"
                  />
                  <p>
                    Check for an existing person before creating a visitor. New
                    visitor records keep email and text consent off.
                  </p>
                  <div className="actions">
                    <Button
                      appearance="primary"
                      disabled={busy}
                      onClick={() => void review("approve")}
                    >
                      {person
                        ? "Approve and link this person"
                        : "Approve and create visitor"}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => void review("decline")}
                    >
                      Decline request
                    </Button>
                  </div>
                </>
              ) : (
                <p>This request has already been {selected.status}.</p>
              )}
            </section>
          )}
        </>
      ) : tab === "events" ? (
        <>
          <Button
            appearance="primary"
            onClick={() =>
              setEditing({
                kind: "publication",
                value: {
                  eventId: "",
                  expectedRevision: 0,
                  description: "",
                  portalVisible: false,
                  publicRegistration: false,
                },
              })
            }
          >
            Choose an event to publish
          </Button>
          <Records
            rows={data.events.map((event) => {
              const publication = publications.rows.find(
                (row) => row.id === event.id,
              );
              return {
                id: event.id,
                Event: event.title,
                Members: publication?.portalVisible ? "Visible" : "Hidden",
                PublicForm: publication?.publicRegistration ? "Open" : "Closed",
              };
            })}
            choose={(index) => {
              const event = data.events[index];
              const current = publications.rows.find(
                (row) => row.id === event.id,
              );
              setEditing({
                kind: "publication",
                value: {
                  eventId: event.id,
                  expectedRevision: current?.revision || 0,
                  description: current?.description || "",
                  portalVisible: current?.portalVisible || false,
                  publicRegistration: current?.publicRegistration || false,
                },
              });
            }}
          />
        </>
      ) : (
        <>
          <p>
            Create the account through the trusted Firebase setup process. The
            account holder verifies their own email. Linking an account grants
            no staff role.
          </p>
          <Button
            appearance="primary"
            onClick={() =>
              setEditing({
                kind: "access",
                value: {
                  uid: "",
                  personId: "",
                  enabled: true,
                  expectedRevision: 0,
                },
              })
            }
          >
            Link member account
          </Button>
          <Records
            rows={access.rows.map((row) => ({
              id: row.id,
              AccountUID: row.id,
              Person:
                people.find((person) => person.id === row.personId)?.name ||
                row.personId,
              Status: row.enabled ? "Enabled" : "Disabled",
            }))}
            choose={(index) => {
              const row = access.rows[index];
              setEditing({
                kind: "access",
                value: {
                  uid: row.id,
                  personId: row.personId,
                  enabled: row.enabled,
                  expectedRevision: row.revision,
                },
              });
            }}
          />
        </>
      )}
      {editing && (
        <RecordEditor
          title={
            editing.kind === "access"
              ? "Member account access"
              : "Online event publication"
          }
          fields={editing.kind === "access" ? accessFields : publicationFields}
          initial={editing.value}
          save={(value) =>
            editing.kind === "access"
              ? chmsCall("setPortalAccess", portalAccessSchema.parse(value))
              : chmsCall(
                  "publishPortalEvent",
                  eventPublicationSchema.parse(value),
                )
          }
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
