import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  signInWithCustomToken,
  signOut,
  browserSessionPersistence,
  setPersistence,
} from "firebase/auth";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import { DateTime } from "luxon";
import {
  groupSchema,
  groupMarkSchema,
  eventSchema,
  rsvpSchema,
  servingSchema,
  careNoteSchema,
  followUpSchema,
  diaconalTaskSchema,
  disciplineSchema,
  taskCompleteSchema,
  kioskSetupSchema,
  kioskStartSchema,
  kioskSearchSchema,
  kioskCheckSchema,
  kioskExitSchema,
  sacramentSchema,
  savePersonSchema,
  hasRole,
  SESSION_ROLES,
  type Role,
  type Group,
  type GroupMeeting,
  type ChurchEvent,
  type Rsvp,
  type Serving,
  type CareNote,
  type FollowUp,
  type DiaconalTask,
  type Person,
  type Household,
  type Service,
  type ServiceType,
  type HistoryEvent,
  type Sacrament,
} from "@sycamore/shared";
import { auth, db, functions, storage } from "./firebase";
import { usePrivateRecords } from "./private";
export async function chmsCall<T = unknown>(
  name: string,
  input: unknown,
): Promise<T> {
  const result = (await httpsCallable<unknown, T>(functions, name)(input)).data;
  if (
    [
      "saveCareNote",
      "saveFollowUp",
      "saveDiaconalTask",
      "completeDiaconalTask",
      "recordDiscipline",
      "saveVisit",
      "completeVisit",
      "saveVisitRound",
    ].includes(name)
  )
    window.dispatchEvent(new Event("private-records-changed"));
  return result;
}
// Stable subscription keys avoid resubscribing every time a form changes.
export function useCollection<T>(
  name: string,
  filterField = "",
  filterValue = "",
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows([]);
    setError("");
    setLoaded(false);
    if (!name) {
      setLoaded(true);
      return;
    }
    const source = filterField
      ? query(collection(db, name), where(filterField, "==", filterValue))
      : collection(db, name);
    return onSnapshot(
      source,
      (snapshot) => {
        setRows(
          snapshot.docs.map(
            (row) =>
              ({
                ...row.data(),
                id: row.id,
                ...(name === "events"
                  ? {
                      start: row.get("start").toDate().toISOString(),
                      end: row.get("end").toDate().toISOString(),
                    }
                  : {}),
              }) as T,
          ),
        );
        setLoaded(true);
      },
      () =>
        setError(
          "These records could not be loaded. Check your connection and role.",
        ),
    );
  }, [name, filterField, filterValue]);
  return { rows, error, loaded };
}
export function usePublicChms() {
  const people = useCollection<Person>("people"),
    households = useCollection<Household>("households"),
    groups = useCollection<Group>("groups"),
    events = useCollection<ChurchEvent>("events"),
    serving = useCollection<Serving>("serving");
  const [zone, setZone] = useState("America/Indiana/Indianapolis");
  useEffect(
    () =>
      onSnapshot(doc(db, "settings/church"), (row) =>
        setZone(row.get("timeZone") || "America/Indiana/Indianapolis"),
      ),
    [],
  );
  return {
    people: people.rows,
    households: households.rows,
    groups: groups.rows,
    events: events.rows,
    serving: serving.rows,
    zone,
    error:
      [
        people.error,
        households.error,
        groups.error,
        events.error,
        serving.error,
      ].find(Boolean) || "",
  };
}
export const useGroupMeetings = (id: string) =>
  useCollection<GroupMeeting>(id ? `groups/${id}/meetings` : "");
export const useRsvps = (id: string) =>
  useCollection<Rsvp>(id ? `events/${id}/rsvps` : "");
export type PrivateRecord = {
  id: string;
  revision: number;
  disciplineFlag: boolean;
  disciplineHistory: { date: string; entry: string; flag: boolean }[];
};
export type Assignee = { id: string; name: string; roles: Role[] };
export function useCareData(roles: Role[]) {
  const session = hasRole(roles, SESSION_ROLES);
  const people = useCollection<Person>(session ? "people" : "");
  const notes = usePrivateRecords<CareNote>("careNotes", session);
  const followUps = usePrivateRecords<FollowUp>("followUps", session);
  const privateRecords = usePrivateRecords<PrivateRecord>(
    "sessionPrivate",
    session,
  );
  const tasks = usePrivateRecords<DiaconalTask>("diaconalTasks", true);
  const [users, setUsers] = useState<Assignee[]>([]);
  useEffect(() => {
    if (session)
      void chmsCall<Assignee[]>("getCareAssignees", {})
        .then(setUsers)
        .catch(() => setUsers([]));
  }, [session]);
  return {
    people: people.rows,
    notes: notes.rows,
    followUps: followUps.rows,
    privateRecords: privateRecords.rows,
    tasks: tasks.rows,
    users,
    error:
      [
        people.error,
        notes.error,
        followUps.error,
        privateRecords.error,
        tasks.error,
      ].find(Boolean) || "",
  };
}
export function useReportData() {
  const people = useCollection<Person>("people"),
    households = useCollection<Household>("households"),
    services = useCollection<Service>("services"),
    types = useCollection<ServiceType>("serviceTypes");
  const [records, setRecords] = useState<{
    history: HistoryEvent[];
    sacraments: Sacrament[];
  }>({ history: [], sacraments: [] });
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    void chmsCall<typeof records>("getReportingRecords", {})
      .then((value) => {
        if (active) {
          setRecords(value);
          setLoaded(true);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Membership history could not be loaded. Try refreshing the report.",
          );
      });
    return () => {
      active = false;
    };
  }, [reload, people.rows]);
  return {
    ...records,
    people: people.rows,
    households: households.rows,
    services: services.rows,
    types: types.rows,
    loaded:
      loaded &&
      people.loaded &&
      households.loaded &&
      services.loaded &&
      types.loaded,
    error:
      error ||
      people.error ||
      households.error ||
      services.error ||
      types.error,
    refresh: () => setReload((value) => value + 1),
  };
}
export const saveGroup = (value: unknown) =>
  chmsCall("saveGroup", groupSchema.parse(value));
export const markGroupAttendance = (value: unknown) =>
  chmsCall("markGroupAttendance", groupMarkSchema.parse(value));
export const saveChurchEvent = (value: unknown) =>
  chmsCall("saveChurchEvent", eventSchema.parse(value));
export const recordRsvp = (value: unknown) =>
  chmsCall("recordRsvp", rsvpSchema.parse(value));
export const saveServingAssignment = (value: unknown) =>
  chmsCall("saveServingAssignment", servingSchema.parse(value));
export const saveCareNote = (value: unknown) =>
  chmsCall("saveCareNote", careNoteSchema.parse(value));
export const saveFollowUp = (value: unknown) =>
  chmsCall("saveFollowUp", followUpSchema.parse(value));
export const saveDiaconalTask = (value: unknown) =>
  chmsCall("saveDiaconalTask", diaconalTaskSchema.parse(value));
export const recordDiscipline = (value: unknown) =>
  chmsCall("recordDiscipline", disciplineSchema.parse(value));
export const completeDiaconalTask = (id: string) =>
  chmsCall("completeDiaconalTask", taskCompleteSchema.parse({ id }));
export const saveSacrament = (value: unknown) =>
  chmsCall("saveSacrament", sacramentSchema.parse(value));
export const configureKiosk = (value: unknown) =>
  chmsCall("configureKiosk", kioskSetupSchema.parse(value));
export async function enterKiosk(serviceId: string) {
  const result = await chmsCall<{ token: string }>(
    "startKiosk",
    kioskStartSchema.parse({ serviceId }),
  );
  await signOut(auth);
  await terminate(db);
  await clearIndexedDbPersistence(db);
  await setPersistence(auth, browserSessionPersistence);
  await signInWithCustomToken(auth, result.token);
  location.reload();
}
export type KioskResult = {
  searchToken: string;
  households: {
    id: string;
    name: string;
    people: { id: string; name: string; present: boolean }[];
  }[];
};
export const searchKiosk = (search: string) =>
  chmsCall<KioskResult>(
    "searchKioskHouseholds",
    kioskSearchSchema.parse({ search }),
  );
export const checkInKiosk = (searchToken: string, personIds: string[]) =>
  chmsCall("checkInKiosk", kioskCheckSchema.parse({ searchToken, personIds }));
export const exitKiosk = async (pin: string) => {
  await chmsCall("exitKiosk", kioskExitSchema.parse({ pin }));
  await signOut(auth);
  location.reload();
};
export function churchLocalInput(iso: string, zone: string) {
  return DateTime.fromISO(iso).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
}
export async function uploadPersonPhoto(personId: string, file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 4 * 1024 * 1024
  )
    throw new Error("Choose a JPEG, PNG or WebP image under 4 MB.");
  const path = `photos/${personId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
  await uploadBytes(ref(storage, path), file, { contentType: file.type });
  await chmsCall(
    "savePerson",
    savePersonSchema.parse({ id: personId, changes: { photoPath: path } }),
  );
}
export async function directoryPhoto(path: string) {
  const blob = await getBlob(ref(storage, path));
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 150;
    canvas.getContext("2d")!.drawImage(image, 0, 0, 120, 150);
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally {
    image.close();
  }
}
