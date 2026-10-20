import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, Textarea } from "@fluentui/react-components";
import {
  getPhoto,
  removePhoto,
  saveContact,
  saveHousehold,
  uploadPhoto,
  type MemberProfile,
} from "./data";

type Perform = (
  action: () => Promise<unknown>,
  message: string | ((result: unknown) => string),
) => Promise<void>;

// Only fields the member changed are sent, each with the value it started from.
function patch<T extends Record<string, string>>(before: T, after: T) {
  const keys = (Object.keys(after) as (keyof T)[]).filter(
    (key) => after[key].trim() !== before[key],
  );
  return {
    changes: Object.fromEntries(keys.map((key) => [key, after[key]])),
    expected: Object.fromEntries(keys.map((key) => [key, before[key]])),
  };
}

export function MyDetails({
  profile,
  personId,
  busy,
  perform,
}: {
  profile: MemberProfile;
  personId: string;
  busy: boolean;
  perform: Perform;
}) {
  return (
    <div className="profile-grid">
      <Contact profile={profile} busy={busy} perform={perform} />
      <Photo
        hasPhoto={profile.hasPhoto}
        photoVersion={profile.photoVersion}
        personId={personId}
        busy={busy}
        perform={perform}
      />
      <HouseholdDetails profile={profile} busy={busy} perform={perform} />
    </div>
  );
}

function Contact({
  profile,
  busy,
  perform,
}: {
  profile: MemberProfile;
  busy: boolean;
  perform: Perform;
}) {
  const before = {
    preferredName: profile.contact.preferredName,
    email: profile.contact.email,
    mobilePhone: profile.contact.mobilePhone,
  };
  const [draft, setDraft] = useState(before);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = patch(before, draft);
    if (!Object.keys(value.changes).length) return;
    void perform(
      () => saveContact(value),
      (result) =>
        (result as { textsStopped?: boolean }).textsStopped
          ? "Your contact details were saved. Texts are off for your new number until you ask the church office to turn them on."
          : "Your contact details were saved.",
    );
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>My contact details</h2>
      <p>
        The church uses these to reach you. Changing them does not change your
        directory sharing or turn on email or texts.
      </p>
      <Field label="Preferred first name">
        <Input
          maxLength={100}
          value={draft.preferredName}
          onChange={(_, row) =>
            setDraft((value) => ({ ...value, preferredName: row.value }))
          }
        />
      </Field>
      <Field label="Contact email">
        <Input
          type="email"
          maxLength={254}
          autoComplete="email"
          value={draft.email}
          onChange={(_, row) =>
            setDraft((value) => ({ ...value, email: row.value }))
          }
        />
      </Field>
      <Field
        label="Mobile phone"
        hint={
          profile.contact.smsOptIn
            ? "Texts stop if you change this number."
            : undefined
        }
      >
        <Input
          type="tel"
          maxLength={40}
          autoComplete="tel"
          value={draft.mobilePhone}
          onChange={(_, row) =>
            setDraft((value) => ({ ...value, mobilePhone: row.value }))
          }
        />
      </Field>
      <Button type="submit" appearance="primary" disabled={busy}>
        Save contact details
      </Button>
    </form>
  );
}

function Photo({
  hasPhoto,
  photoVersion,
  personId,
  busy,
  perform,
}: {
  hasPhoto: boolean;
  photoVersion: number;
  personId: string;
  busy: boolean;
  perform: Perform;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setPhoto(null);
    setPhotoError("");
    if (hasPhoto)
      void getPhoto(personId)
        .then((value) => {
          if (active) {
            setPhoto(value);
            if (!value) setPhotoError("Your photo could not be loaded.");
          }
        })
        .catch(() => {
          if (active) setPhotoError("Your photo could not be loaded.");
        });
    return () => {
      active = false;
    };
  }, [hasPhoto, personId, photoVersion, retry]);
  return (
    <section className="card">
      <h2>My photo</h2>
      <p>
        Members see your photo only if you choose to share it in My sharing
        choices.
      </p>
      {hasPhoto && photo ? (
        <img className="member-photo" src={photo} alt="My current photo" />
      ) : (
        <p>{hasPhoto ? photoError || "Loading your photo" : "No photo yet."}</p>
      )}
      {photoError && (
        <Button onClick={() => setRetry((value) => value + 1)}>
          Retry photo
        </Button>
      )}
      <label className="file-field">
        {hasPhoto ? "Replace my photo" : "Add a photo"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void perform(
                () => uploadPhoto(file, hasPhoto, photoVersion),
                "Your photo was saved.",
              );
          }}
        />
      </label>
      {hasPhoto && (
        <Button
          disabled={busy}
          onClick={() =>
            void perform(
              () => removePhoto(photoVersion),
              "Your photo was removed.",
            )
          }
        >
          Remove my photo
        </Button>
      )}
    </section>
  );
}

function HouseholdDetails({
  profile,
  busy,
  perform,
}: {
  profile: MemberProfile;
  busy: boolean;
  perform: Perform;
}) {
  const before = {
    address: profile.household.address,
    homePhone: profile.household.homePhone,
  };
  const [draft, setDraft] = useState(before);
  if (!profile.household.canEdit)
    return (
      <section className="card">
        <h2>My household</h2>
        <p className="preserve-lines">
          {before.address || "No address on record."}
        </p>
        {before.homePhone && <p>{before.homePhone}</p>}
        <p>
          An adult in the household whose birth date is on record can change
          these details. Otherwise, contact the church office.
        </p>
      </section>
    );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = patch(before, draft);
    if (!Object.keys(value.changes).length) return;
    void perform(
      () => saveHousehold(value),
      "Your household details were saved.",
    );
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>My household</h2>
      <p>
        These details are shared by everyone in the {profile.household.name}{" "}
        household.
      </p>
      <Field label="Household address">
        <Textarea
          maxLength={500}
          rows={3}
          value={draft.address}
          onChange={(_, row) =>
            setDraft((value) => ({ ...value, address: row.value }))
          }
        />
      </Field>
      <Field label="Home phone">
        <Input
          type="tel"
          maxLength={40}
          value={draft.homePhone}
          onChange={(_, row) =>
            setDraft((value) => ({ ...value, homePhone: row.value }))
          }
        />
      </Field>
      <Button type="submit" appearance="primary" disabled={busy}>
        Save household details
      </Button>
    </form>
  );
}
