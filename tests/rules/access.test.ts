import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
let env: RulesTestEnvironment;
const mark = (uid: string) => ({
  at: serverTimestamp(),
  method: "roll",
  byUid: uid,
});
const auth = (role: string, uid = role) =>
  env.authenticatedContext(uid, { roles: [role] });
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sycamore",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "people/alex"), {
        firstName: "Alex",
        email: "alex@example.test",
      }),
      setDoc(doc(db, "people/alex/membershipEvents/initial"), {
        reason: "Initial entry",
      }),
      setDoc(doc(db, "households/ash"), {
        name: "Ash",
        address: "Private address",
      }),
      setDoc(doc(db, "attendanceRoster/alex"), {
        firstName: "Alex",
        lastName: "Ash",
        membershipStatus: "communicant",
        isDeceased: false,
      }),
      setDoc(doc(db, "attendanceRoster/former"), {
        firstName: "Former",
        membershipStatus: "former",
        isDeceased: false,
      }),
      setDoc(doc(db, "serviceTypes/am"), {
        name: "Lord's Day Morning",
        isActive: true,
      }),
      setDoc(doc(db, "services/am_2026-11-01"), {
        serviceTypeId: "am",
        date: "2026-11-01",
        notes: "",
        present: {},
        lastAttendancePersonId: "",
      }),
      ...["sessionPrivate", "careNotes", "followUps", "auditLog"].map(
        (collection) =>
          setDoc(doc(db, `${collection}/private`), { body: "Private" }),
      ),
      setDoc(doc(db, "diaconalTasks/move"), {
        title: "Help with a move",
        assignedToUid: "deacon",
        done: false,
      }),
      setDoc(doc(db, "settings/church"), {
        timeZone: "America/Indiana/Indianapolis",
      }),
      setDoc(doc(db, "users/elder"), { roles: ["elder"] }),
    ]);
    await uploadBytes(
      ref(context.storage(), "photos/alex/avatar.png"),
      new Uint8Array([1]),
      { contentType: "image/png" },
    );
  });
});
describe("Session boundary", () => {
  for (const collection of [
    "sessionPrivate",
    "careNotes",
    "followUps",
    "auditLog",
  ]) {
    it(`${collection} allows Session readers and denies Admin, Deacon, volunteer and anonymous`, async () => {
      for (const role of ["pastor", "clerk", "elder"])
        await assertSucceeds(
          getDoc(doc(auth(role).firestore(), `${collection}/private`)),
        );
      for (const role of ["admin", "deacon", "attendanceVolunteer", "readOnly"])
        await assertFails(
          getDoc(doc(auth(role).firestore(), `${collection}/private`)),
        );
      await assertFails(
        getDoc(
          doc(
            env.unauthenticatedContext().firestore(),
            `${collection}/private`,
          ),
        ),
      );
      await assertFails(
        setDoc(doc(auth("pastor").firestore(), `${collection}/private`), {
          body: "Client write",
        }),
      );
    });
  }
});
describe("roll call and identity", () => {
  it("volunteers read names but cannot read contacts, households or membership history", async () => {
    const db = auth("attendanceVolunteer").firestore();
    await assertSucceeds(getDoc(doc(db, "attendanceRoster/alex")));
    for (const path of [
      "people/alex",
      "households/ash",
      "people/alex/membershipEvents/initial",
    ])
      await assertFails(getDoc(doc(db, path)));
    for (const path of [
      "people/alex",
      "households/ash",
      "people/alex/membershipEvents/initial",
    ])
      await assertSucceeds(getDoc(doc(auth("clerk").firestore(), path)));
    await assertFails(
      updateDoc(doc(db, "attendanceRoster/alex"), { firstName: "Changed" }),
    );
  });
  it("allows one valid mark, then removal, and forbids spoofing, extra fields, former people and metadata rewrites", async () => {
    const db = auth("attendanceVolunteer").firestore();
    const service = doc(db, "services/am_2026-11-01");
    await assertSucceeds(
      updateDoc(service, {
        "present.alex": mark("attendanceVolunteer"),
        lastAttendancePersonId: "alex",
      }),
    );
    await assertSucceeds(
      updateDoc(service, {
        "present.alex": deleteField(),
        lastAttendancePersonId: "alex",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.alex": mark("someoneElse"),
        lastAttendancePersonId: "alex",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.alex": { ...mark("attendanceVolunteer"), secret: "bad" },
        lastAttendancePersonId: "alex",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.former": mark("attendanceVolunteer"),
        lastAttendancePersonId: "former",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.missing": mark("attendanceVolunteer"),
        lastAttendancePersonId: "missing",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.alex": mark("attendanceVolunteer"),
        "present.former": mark("attendanceVolunteer"),
        lastAttendancePersonId: "alex",
      }),
    );
    await assertFails(updateDoc(service, { date: "2026-11-02" }));
    await assertFails(updateDoc(service, { notes: "Changed" }));
    await assertFails(
      updateDoc(doc(auth("readOnly").firestore(), "services/am_2026-11-01"), {
        "present.alex": mark("readOnly"),
      }),
    );
  });
  it("creates only empty valid services with active types and deterministic IDs", async () => {
    const db = auth("attendanceVolunteer").firestore();
    const service = {
      serviceTypeId: "am",
      date: "2026-11-08",
      notes: "",
      present: {},
      lastAttendancePersonId: "",
    };
    await assertSucceeds(setDoc(doc(db, "services/am_2026-11-08"), service));
    await assertFails(setDoc(doc(db, "services/incorrect"), service));
    await assertFails(
      setDoc(doc(db, "services/am_2026-11-15"), {
        ...service,
        date: "2026-11-15",
        present: { alex: mark("attendanceVolunteer") },
      }),
    );
    await assertFails(
      setDoc(doc(auth("readOnly").firestore(), "services/am_2026-11-22"), {
        ...service,
        date: "2026-11-22",
      }),
    );
  });
  it("keeps setup and users server-owned", async () => {
    const db = auth("elder").firestore();
    await assertSucceeds(getDoc(doc(db, "users/elder")));
    await assertFails(getDoc(doc(db, "users/another")));
    await assertSucceeds(getDoc(doc(auth("admin").firestore(), "users/elder")));
    await assertSucceeds(getDoc(doc(db, "settings/church")));
    await assertSucceeds(getDoc(doc(db, "serviceTypes/am")));
    for (const path of [
      "users/elder",
      "settings/church",
      "serviceTypes/am",
      "people/alex",
      "households/ash",
    ])
      await assertFails(setDoc(doc(db, path), { roles: ["admin"] }));
    await assertFails(
      getDoc(
        doc(env.unauthenticatedContext().firestore(), "attendanceRoster/alex"),
      ),
    );
    await assertFails(getDoc(doc(auth("elder").firestore(), "unknown/record")));
  });
});
describe("deacon task isolation", () => {
  it("allows only the assigned Deacon to read and complete a task without reassigning it", async () => {
    const db = auth("deacon").firestore();
    const task = doc(db, "diaconalTasks/move");
    await assertSucceeds(getDoc(task));
    await assertSucceeds(
      getDoc(doc(auth("elder").firestore(), "diaconalTasks/move")),
    );
    await assertFails(
      getDoc(
        doc(auth("deacon", "otherDeacon").firestore(), "diaconalTasks/move"),
      ),
    );
    await assertFails(
      getDoc(doc(auth("admin").firestore(), "diaconalTasks/move")),
    );
    await assertFails(updateDoc(task, { assignedToUid: "otherDeacon" }));
    await assertSucceeds(updateDoc(task, { done: true }));
    await assertFails(updateDoc(task, { done: false }));
  });
});
describe("Storage", () => {
  it("permits photos to ordinary readers and valid uploads to editors, and denies volunteers", async () => {
    await assertSucceeds(
      getBytes(ref(auth("readOnly").storage(), "photos/alex/avatar.png")),
    );
    await assertFails(
      getBytes(
        ref(auth("attendanceVolunteer").storage(), "photos/alex/avatar.png"),
      ),
    );
    await assertFails(
      getBytes(
        ref(env.unauthenticatedContext().storage(), "photos/alex/avatar.png"),
      ),
    );
    await assertSucceeds(
      uploadBytes(
        ref(auth("clerk").storage(), "photos/alex/new.png"),
        new Uint8Array([1]),
        { contentType: "image/png" },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(auth("readOnly").storage(), "photos/alex/new.png"),
        new Uint8Array([1]),
        { contentType: "image/png" },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(auth("admin").storage(), "photos/alex/file.html"),
        new Uint8Array([1]),
        { contentType: "text/html" },
      ),
    );
    await assertSucceeds(
      deleteObject(ref(auth("admin").storage(), "photos/alex/avatar.png")),
    );
    await assertFails(
      uploadBytes(
        ref(auth("admin").storage(), "private/file"),
        new Uint8Array([1]),
      ),
    );
  });
});
describe("communication access", () => {
  for (const collection of [
    "smsInbox",
    "messageTemplates",
    "savedAudiences",
    "communicationSettings",
    "automationStatus",
    "bulletins",
    "consentEvents",
  ]) {
    it(`${collection} permits communicators, denies other readers and all direct writes`, async () => {
      const path = `${collection}/church`;
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), path), { example: true }),
      );
      for (const role of ["admin", "pastor", "clerk", "elder"])
        await assertSucceeds(getDoc(doc(auth(role).firestore(), path)));
      for (const role of ["deacon", "attendanceVolunteer", "readOnly"])
        await assertFails(getDoc(doc(auth(role).firestore(), path)));
      await assertFails(
        getDoc(doc(env.unauthenticatedContext().firestore(), path)),
      );
      await assertFails(
        setDoc(doc(auth("admin").firestore(), path), { forged: true }),
      );
    });
  }
  it("keeps Session-only message bodies and recipient details from an Admin", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "messages/public"), {
        sessionOnly: false,
      });
      await setDoc(doc(context.firestore(), "messages/private"), {
        sessionOnly: true,
      });
      await setDoc(
        doc(context.firestore(), "messages/private/recipients/elder"),
        { address: "elder@example.test" },
      );
      await setDoc(
        doc(context.firestore(), "messages/public/recipients/reader"),
        { address: "reader@example.test" },
      );
    });
    await assertSucceeds(
      getDoc(doc(auth("admin").firestore(), "messages/public")),
    );
    await assertSucceeds(
      getDoc(
        doc(auth("admin").firestore(), "messages/public/recipients/reader"),
      ),
    );
    for (const path of [
      "messages/private",
      "messages/private/recipients/elder",
    ]) {
      await assertSucceeds(getDoc(doc(auth("elder").firestore(), path)));
      await assertFails(getDoc(doc(auth("admin").firestore(), path)));
      await assertFails(getDoc(doc(auth("deacon").firestore(), path)));
    }
    await assertFails(
      setDoc(doc(auth("pastor").firestore(), "messages/public"), {
        status: "sent",
      }),
    );
    await assertFails(
      setDoc(
        doc(auth("pastor").firestore(), "messages/public/recipients/reader"),
        { status: "delivered" },
      ),
    );
  });
  it("never exposes suppression records, send budgets, link tokens or emulator delivery payloads", async () => {
    for (const collection of [
      "communicationSuppressions",
      "communicationBudgets",
      "bulletinLinks",
      "emulatorDeliveries",
      "emulatorDriveFiles",
    ]) {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), `${collection}/secret`), {
          private: true,
        }),
      );
      await assertFails(
        getDoc(doc(auth("pastor").firestore(), `${collection}/secret`)),
      );
      await assertFails(
        setDoc(doc(auth("admin").firestore(), `${collection}/secret`), {
          blocked: false,
        }),
      );
    }
    for (const collection of ["elderDistricts", "groups"]) {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), `${collection}/north`), {
          name: "North",
        }),
      );
      await assertSucceeds(
        getDoc(doc(auth("deacon").firestore(), `${collection}/north`)),
      );
      await assertFails(
        getDoc(
          doc(auth("attendanceVolunteer").firestore(), `${collection}/north`),
        ),
      );
      await assertFails(
        setDoc(doc(auth("admin").firestore(), `${collection}/north`), {
          name: "Changed",
        }),
      );
    }
  });
  it("allows immutable PDF uploads by communicators and denies overwrites, foreign owners and other file types", async () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-fake"));
    const path = "bulletins/2026-11-01/bulletin.pdf";
    await assertSucceeds(
      uploadBytes(ref(auth("clerk").storage(), path), pdf, {
        contentType: "application/pdf",
      }),
    );
    await assertSucceeds(getBytes(ref(auth("elder").storage(), path)));
    await assertFails(
      uploadBytes(ref(auth("admin").storage(), path), pdf, {
        contentType: "application/pdf",
      }),
    );
    await assertFails(deleteObject(ref(auth("admin").storage(), path)));
    await assertFails(getBytes(ref(auth("deacon").storage(), path)));
    await assertFails(
      uploadBytes(
        ref(
          auth("attendanceVolunteer").storage(),
          "bulletins/2026-11-01/no.pdf",
        ),
        pdf,
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(auth("admin").storage(), "bulletins/2026-11-01/no.pdf"),
        pdf,
        { contentType: "text/html" },
      ),
    );
    await assertSucceeds(
      uploadBytes(
        ref(auth("clerk").storage(), "messageAttachments/clerk/file.pdf"),
        pdf,
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(auth("clerk").storage(), "messageAttachments/another/file.pdf"),
        pdf,
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(
      getBytes(ref(env.unauthenticatedContext().storage(), path)),
    );
  });
});
