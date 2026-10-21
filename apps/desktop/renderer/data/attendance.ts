import { connectedOperation, useOperations } from "../../../pwa/runtime";
import { operations } from "../../../pwa/operations";
import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  waitForPendingWrites,
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
import { DateTime } from "luxon";
import { auth, db, functions } from "./firebase";
export function useAttendanceData(selectedDate = "") {
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [serviceWindow, setServiceWindow] = useState({
    rows: [] as Service[],
    key: "",
    ready: false,
  });
  const services = serviceWindow.rows;
  const [timeZone, setTimeZone] = useState("America/Indiana/Indianapolis");
  const [pending, setPending] = useState(false);
  const [cacheOnly, setCacheOnly] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const connection = useOperations();
  const online = connection.connected && !connection.frozen;
  useEffect(() => {
    const failed = () =>
      setError(
        "The records could not be loaded. Check your connection and sign in again.",
      );
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
    };
  }, []);
  useEffect(() => {
    const center = DateTime.fromISO(
      selectedDate || DateTime.now().setZone(timeZone).toISODate()!,
      { zone: timeZone },
    );
    let active = true;
    const windowKey = `${selectedDate}|${timeZone}`;
    const stop = onSnapshot(
      query(
        collection(db, "services"),
        where("date", ">=", center.minus({ weeks: 5 }).toISODate()!),
        where("date", "<=", center.plus({ weeks: 1 }).toISODate()!),
      ),
      { includeMetadataChanges: true },
      (snapshot) => {
        // Keep readiness with its rows so a previous date's ready state cannot
        // turn a new query's initial cache miss into a false invitation to create.
        setServiceWindow({
          rows: snapshot.docs.map(
            (row) => ({ ...row.data(), id: row.id }) as Service,
          ),
          key: windowKey,
          ready: !snapshot.metadata.fromCache,
        });
        setCacheOnly(snapshot.metadata.fromCache);
        // waitForPendingWrites covers marks queued on dates no longer in the visible query.
        if (snapshot.metadata.hasPendingWrites) setPending(true);
        void waitForPendingWrites(db)
          .then(() => {
            if (active) setPending(false);
          })
          .catch(() => undefined);
      },
      () =>
        setError(
          "Attendance could not be loaded. Check your connection and role.",
        ),
    );
    return () => {
      active = false;
      stop();
    };
  }, [selectedDate, timeZone]);
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
    if (!auth.currentUser || !online) return;
    const uid = auth.currentUser.uid;
    // Firestore resolves this promise only after the server acknowledges this field write.
    void operations.run(() => updateDoc(
      doc(db, "services", serviceId),
      new FieldPath("present", input.personId),
      present
        ? {
            at: serverTimestamp(),
            method: input.method,
            byUid: uid,
            mode: input.mode,
          }
        : deleteField(),
      "lastAttendancePersonId",
      input.personId,
    )).catch(() =>
      setError(
        "An attendance change was not confirmed. Reconnect and review the roll before retrying.",
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
    await connectedOperation(() => runTransaction(db, async (transaction) => {
      if (!(await transaction.get(ref)).exists()) transaction.set(ref, value);
    }));
  }
  return {
    people,
    types,
    services,
    timeZone,
    pending: pending || connection.pending > 0,
    cacheOnly,
    online,
    loaded,
    servicesReady:
      serviceWindow.key === `${selectedDate}|${timeZone}` &&
      serviceWindow.ready,
    error,
    setError,
    mark,
    startService,
  };
}
export async function addVisitor(data: unknown) {
  return connectedOperation(() => httpsCallable(functions, "addVisitor")(visitorInputSchema.parse(data)));
}
export async function createHousehold(data: unknown) {
  return connectedOperation(() => httpsCallable(
    functions,
    "createHousehold",
  )(createHouseholdSchema.parse(data)));
}
