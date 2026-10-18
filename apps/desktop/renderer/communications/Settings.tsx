import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Select,
  Subtitle2,
  Textarea,
} from "@fluentui/react-components";
import {
  communicationSettingsSchema,
  type CommunicationSettings,
  type Role,
} from "@sycamore/shared";
import {
  communicationStatus,
  emulators,
  saveCommunicationSettings,
  useCommunicationData,
} from "../data/communications";
const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Lord's Day",
];
const hours = Array.from({ length: 24 }, (_, value) => ({
  value,
  label: `${value % 12 || 12}:00 ${value < 12 ? "AM" : "PM"}`,
}));
export function CommunicationSettingsPanel({
  roles,
  serviceTypes,
}: {
  roles: Role[];
  serviceTypes: { id: string; name: string }[];
}) {
  const data = useCommunicationData(roles);
  const [draft, setDraft] = useState<CommunicationSettings>(data.settings);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    mode: string;
    emailConfigured: boolean;
    smsConfigured: boolean;
  } | null>(null);
  useEffect(() => {
    if (!edited) setDraft(data.settings);
  }, [data.settings, edited]);
  useEffect(() => {
    void communicationStatus()
      .then(setStatus)
      .catch(() => setError("Provider status could not be loaded."));
  }, []);
  function update<K extends keyof CommunicationSettings>(
    key: K,
    value: CommunicationSettings[K],
  ) {
    setEdited(true);
    setDraft({ ...draft, [key]: value });
    setNotice("");
  }
  const allowed = roles.includes("admin") || roles.includes("pastor");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveCommunicationSettings(communicationSettingsSchema.parse(draft));
      setEdited(false);
      setNotice("Communication settings saved.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const personPicker = (
    label: string,
    key: "previewPersonId" | "reminderPersonId",
  ) => (
    <Field label={label}>
      <Dropdown
        value={
          data.people.find((person) => person.id === draft[key])?.firstName ||
          "Choose a person"
        }
        selectedOptions={draft[key] ? [draft[key]] : []}
        disabled={!allowed}
        onOptionSelect={(_, value) => update(key, value.optionValue || "")}
      >
        <Option value="">Choose a person</Option>
        {data.people.map((person) => (
          <Option
            key={person.id}
            value={person.id}
          >{`${person.firstName} ${person.lastName}`}</Option>
        ))}
      </Dropdown>
    </Field>
  );
  return (
    <form className="surface communication-panel settings" onSubmit={submit}>
      <Subtitle2>Communication settings</Subtitle2>
      {emulators ? (
        <MessageBar intent="info">
          Simulated providers are active. No real messages are sent.
        </MessageBar>
      ) : (
        <p>
          Microsoft credentials{" "}
          {status?.emailConfigured ? "configured" : "needed"} · Twilio
          credentials {status?.smsConfigured ? "configured" : "needed"}.
          Credentials are kept on the server.
        </p>
      )}
      <p>All automatic times use {data.zone}.</p>
      {!allowed && <p>Only an Admin or Pastor can change delivery settings.</p>}
      <fieldset disabled={!allowed || busy}>
        <legend>Delivery</legend>
        <Field label="Church name">
          <Input
            value={draft.churchName}
            onChange={(_, value) => update("churchName", value.value)}
          />
        </Field>
        <Field label="Email footer">
          <Textarea
            value={draft.footer}
            onChange={(_, value) => update("footer", value.value)}
          />
        </Field>
        <Checkbox
          label="Enable email delivery"
          checked={draft.emailEnabled}
          onChange={(_, value) =>
            update("emailEnabled", value.checked === true)
          }
        />
        <Checkbox
          label="Enable text delivery"
          checked={draft.smsEnabled}
          onChange={(_, value) => update("smsEnabled", value.checked === true)}
        />
      </fieldset>
      <fieldset disabled={!allowed || busy}>
        <legend>Saturday bulletin</legend>
        <Checkbox
          label="Enable automatic bulletin email"
          checked={draft.bulletinEnabled}
          onChange={(_, value) =>
            update("bulletinEnabled", value.checked === true)
          }
        />
        {personPicker("Pastor preview person", "previewPersonId")}
        {personPicker("Bulletin reminder person", "reminderPersonId")}
        <div className="communication-fields">
          <Field label="Reminder time">
            <Input
              type="time"
              value={draft.reminderTime}
              onChange={(_, value) => update("reminderTime", value.value)}
            />
          </Field>
          <Field label="Send time">
            <Input
              type="time"
              value={draft.sendTime}
              onChange={(_, value) => update("sendTime", value.value)}
            />
          </Field>
          <Field label="Late cutoff">
            <Input
              type="time"
              value={draft.cutoffTime}
              onChange={(_, value) => update("cutoffTime", value.value)}
            />
          </Field>
        </div>
        <Field label="Bulletin subject">
          <Input
            value={draft.bulletinSubject}
            onChange={(_, value) => update("bulletinSubject", value.value)}
          />
        </Field>
        <Field label="Bulletin message">
          <Textarea
            rows={4}
            value={draft.bulletinBody}
            onChange={(_, value) => update("bulletinBody", value.value)}
          />
        </Field>
        <Field label="Microsoft drive ID">
          <Input
            value={draft.driveId}
            onChange={(_, value) => update("driveId", value.value)}
          />
        </Field>
        <Field label="Microsoft Bulletin folder ID">
          <Input
            value={draft.folderId}
            onChange={(_, value) => update("folderId", value.value)}
          />
        </Field>
        <Checkbox
          label="Allow shareable links to bulletin PDFs"
          checked={draft.shareBulletinLink}
          onChange={(_, value) =>
            update("shareBulletinLink", value.checked === true)
          }
        />
        <Checkbox
          label="Send bulletin links by text to opted-in people"
          checked={draft.bulletinSms}
          onChange={(_, value) => update("bulletinSms", value.checked === true)}
        />
      </fieldset>
      <fieldset disabled={!allowed || busy}>
        <legend>Shepherding digests</legend>
        <Checkbox
          label="Send each district elder a weekly shepherding digest"
          checked={draft.absenceEnabled}
          onChange={(_, value) =>
            update("absenceEnabled", value.checked === true)
          }
        />
        <Field label="Digest day">
          <Select
            value={String(draft.digestWeekday)}
            onChange={(event) =>
              update("digestWeekday", Number(event.target.value))
            }
          >
            {weekdays.map((day, index) => (
              <option key={day} value={index + 1}>
                {day}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Digest hour (church time)">
          <Select
            value={String(draft.digestHour)}
            onChange={(event) =>
              update("digestHour", Number(event.target.value))
            }
          >
            {hours.map((hour) => (
              <option key={hour.value} value={hour.value}>
                {hour.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Send digests by">
          <Select
            value={draft.digestChannel}
            onChange={(event) =>
              update(
                "digestChannel",
                event.target.value as CommunicationSettings["digestChannel"],
              )
            }
          >
            <option value="email">Email (lists names)</option>
            <option value="sms">Text (counts only)</option>
            <option value="both">Email and text</option>
          </Select>
        </Field>
        <Field label="Absent this many recorded Lord's Days in a row">
          <Input
            type="number"
            min={2}
            max={12}
            value={String(draft.absenceWeeks)}
            onChange={(_, value) => update("absenceWeeks", Number(value.value))}
          />
        </Field>
        <Field label="Service used for absence alerts">
          <Dropdown
            value={
              serviceTypes.find(
                (type) => type.id === draft.absenceServiceTypeId,
              )?.name || "Choose a service"
            }
            selectedOptions={
              draft.absenceServiceTypeId ? [draft.absenceServiceTypeId] : []
            }
            onOptionSelect={(_, value) =>
              update("absenceServiceTypeId", value.optionValue || "")
            }
          >
            <Option value="">Choose a service</Option>
            {serviceTypes.map((type) => (
              <Option key={type.id} value={type.id}>
                {type.name}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Checkbox
          label="Send Session officers a daily summary of visits and follow-ups due"
          checked={draft.dailySummaryEnabled}
          onChange={(_, value) =>
            update("dailySummaryEnabled", value.checked === true)
          }
        />
        <Field label="Daily summary hour (church time)">
          <Select
            value={String(draft.dailySummaryHour)}
            onChange={(event) =>
              update("dailySummaryHour", Number(event.target.value))
            }
          >
            {hours.map((hour) => (
              <option key={hour.value} value={hour.value}>
                {hour.label}
              </option>
            ))}
          </Select>
        </Field>
        <p>
          Digests go only to linked accounts that hold a Session role when they
          are sent, and opt-outs always apply. They include absences, contact
          gaps and visits, never note text. Texts carry counts only. Nothing is
          sent when there is nothing to report.
        </p>
      </fieldset>
      <fieldset className="member-picker">
        <legend>Mercy ministry summary</legend>
        <Checkbox
          label="Send each deacon a daily mercy ministry summary"
          checked={draft.deaconDigestEnabled}
          onChange={(_, value) =>
            update("deaconDigestEnabled", value.checked === true)
          }
        />
        <Field label="Deacon summary hour (church time)">
          <Select
            value={String(draft.deaconDigestHour)}
            onChange={(event) =>
              update("deaconDigestHour", Number(event.target.value))
            }
          >
            {hours.map((hour) => (
              <option key={hour.value} value={hour.value}>
                {hour.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Send deacon summaries by">
          <Select
            value={draft.deaconDigestChannel}
            onChange={(event) =>
              update(
                "deaconDigestChannel",
                event.target
                  .value as CommunicationSettings["deaconDigestChannel"],
              )
            }
          >
            <option value="email">Email (lists households)</option>
            <option value="sms">Text (counts only)</option>
            <option value="both">Email and text</option>
          </Select>
        </Field>
        <p>
          Summaries go only to linked accounts that hold the deacon role when
          they are sent, and opt-outs always apply. They list households, kinds
          of help, due dates and visit times. Request details, notes and task
          titles are never included.
        </p>
      </fieldset>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      {data.automationError && (
        <MessageBar intent="warning">{data.automationError}</MessageBar>
      )}
      <Button type="submit" appearance="primary" disabled={!allowed || busy}>
        Save communication settings
      </Button>
    </form>
  );
}
