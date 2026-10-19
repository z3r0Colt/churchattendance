import { useEffect, useState } from "react";
import {
  collection,
  deleteField,
  doc,
  FieldPath,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  attendanceInputSchema,
  createHouseholdSchema,
  serviceInputSchema,
  visitorInputSchema,
  type RosterPerson,
  type Service,
  type ServiceType,
} from "@sycamore/shared";
import { auth, db, functions } from "./firebase";
export function useAttendanceData() {
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [timeZone, setTimeZone] = useState("America/Indiana/Indianapolis");
  const [pending, setPending] = useState(false);
  const [cacheOnly, setCacheOnly] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const failed = () =>
      setError(
        "The records could not be loaded. Check your connection and sign in again.",
      );
    const pendingCollections = new Map<string, boolean>();
    const stops = [
      onSnapshot(
        collection(db, "attendanceRoster"),
        { includeMetadataChanges: true },
        (snapshot) => {
          setPeople(
            snapshot.docs.map(
              (row) => ({ ...row.data(), id: row.id }) as RosterPerson,
            ),
          );
          setLoaded(true);
        },
        failed,
      ),
      onSnapshot(
        collection(db, "serviceTypes"),
        (snapshot) =>
          setTypes(
            snapshot.docs.map(
              (row) => ({ ...row.data(), id: row.id }) as ServiceType,
            ),
          ),
        failed,
      ),
      onSnapshot(
        collection(db, "services"),
        { includeMetadataChanges: true },
        (snapshot) => {
          setServices(
            snapshot.docs.map(
              (row) => ({ ...row.data(), id: row.id }) as Service,
            ),
          );
          setCacheOnly(snapshot.metadata.fromCache);
          pendingCollections.set(
            "services",
            snapshot.metadata.hasPendingWrites,
          );
          setPending([...pendingCollections.values()].some(Boolean));
        },
        failed,
      ),
      onSnapshot(
        doc(db, "settings", "church"),
        (snapshot) => {
          const zone = snapshot.data()?.timeZone;
          if (typeof zone === "string") setTimeZone(zone);
        },
        failed,
      ),
    ];
    return () => {
      stops.forEach((stop) => stop());
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  function mark(
    serviceId: string,
    personId: string,
    present: boolean,
    mode: "inPerson" | "online" = "inPerson",
  ) {
    const input = attendanceInputSchema.parse({
      personId,
      present,
      method: "roll",
      mode,
    });
    if (!auth.currentUser) return;
    // Do not await acknowledgements here. Offline writes appear immediately and queue in IndexedDB.
    void updateDoc(
      doc(db, "services", serviceId),
      new FieldPath("present", input.personId),
      present
        ? {
            at: serverTimestamp(),
            method: input.method,
            byUid: auth.currentUser.uid,
            mode: input.mode,
          }
        : deleteField(),
      "lastAttendancePersonId",
      input.personId,
    ).catch(() =>
      setError(
        "An attendance change was rejected and has been undone. Check your role and try again.",
      ),
    );
  }
  async function startService(serviceTypeId: string, date: string) {
    const value = serviceInputSchema.parse({
      serviceTypeId,
      date,
      notes: "",
      present: {},
      lastAttendancePersonId: "",
    });
    const ref = doc(db, "services", `${serviceTypeId}_${date}`);
    // Creation requires a connection. A transaction prevents another PC's existing marks being replaced.
    await runTransaction(db, async (transaction) => {
      if (!(await transaction.get(ref)).exists()) transaction.set(ref, value);
    });
  }
  return {
    people,
    types,
    services,
    timeZone,
    pending,
    cacheOnly,
    online,
    loaded,
    error,
    setError,
    mark,
    startService,
  };
}
export async function addVisitor(data: unknown) {
  return httpsCallable(functions, "addVisitor")(visitorInputSchema.parse(data));
}
export async function createHousehold(data: unknown) {
  return httpsCallable(
    functions,
    "createHousehold",
  )(createHouseholdSchema.parse(data));
}
