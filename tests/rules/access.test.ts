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
  Timestamp,
} from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
let env: RulesTestEnvironment;
// Phase 11 Session records, served only by audited callables.
const churchRecordCollections = [
  "officerPolicies",
  "officerDecisions",
  "quorumPolicies",
  "quorumMeetings",
  "communionDecisions",
  "communionRecords",
];
const mark = (uid: string) => ({
  at: serverTimestamp(),
  method: "roll",
  byUid: uid,
});
const auth = (role: string, uid = role) =>
  env.authenticatedContext(uid, {
    roles: [role],
    email_verified: true,
    auth_time: Math.floor(Date.now() / 1000),
    firebase: {
      ...{ sign_in_second_factor: "totp" },
      sign_in_provider: "password",
      identities: {},
    },
  });
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
    for (const role of [
      "pastor",
      "clerk",
      "elder",
      "admin",
      "deacon",
      "attendanceVolunteer",
      "readOnly",
    ])
      await setDoc(doc(db, `staffAccess/${role}`), {
        enabled: true,
        roles: [role],
        validAfter: 0,
      });
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
      ...[
        "sessionPrivate",
        "careNotes",
        "followUps",
        "auditLog",
        "visitRounds",
        "shepherdingSettings",
        "householdLocations",
        "flockAssessments",
        "mercySettings",
        "mercyAssignments",
        "mercyRequests",
        "mercyNotes",
        "mercyTasks",
        "mercyVisits",
        "bereavementDates",
        "memberRequests",
        "workflows",
        "workflowVersions",
        "workflowRuns",
        ...churchRecordCollections,
      ].map((collection) =>
        setDoc(doc(db, `${collection}/private`), { body: "Private" }),
      ),
      setDoc(doc(db, "people/alex/offices/elder"), {
        role: "elder",
        installedOn: "2020-01-01",
      }),
      // The deacon is invited, which still grants no direct read of the visit.
      setDoc(doc(db, "pastoralVisits/private"), {
        householdId: "calder",
        officerUids: ["elder"],
        deaconUids: ["deacon"],
        status: "planned",
      }),
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
    "pastoralVisits",
    "visitRounds",
    "shepherdingSettings",
    "householdLocations",
    "flockAssessments",
    "mercySettings",
    "mercyAssignments",
    "mercyRequests",
    "mercyNotes",
    "mercyTasks",
    "mercyVisits",
    "bereavementDates",
    "memberRequests",
    "workflows",
    "workflowVersions",
    "workflowRuns",
    ...churchRecordCollections,
  ]) {
    it(`${collection} requires audited APIs even for Session and denies all direct writes`, async () => {
      for (const role of ["pastor", "clerk", "elder"])
        await assertFails(
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
describe("office history", () => {
  it("is readable by staff readers, hidden from volunteers and written only by Functions", async () => {
    for (const role of ["admin", "pastor", "deacon", "readOnly"])
      await assertSucceeds(
        getDoc(doc(auth(role).firestore(), "people/alex/offices/elder")),
      );
    await assertFails(
      getDoc(
        doc(
          auth("attendanceVolunteer").firestore(),
          "people/alex/offices/elder",
        ),
      ),
    );
    for (const role of ["pastor", "clerk", "admin"])
      await assertFails(
        setDoc(doc(auth(role).firestore(), "people/alex/offices/elder"), {
          role: "elder",
          installedOn: "2021-01-01",
        }),
      );
  });
});
describe("family links and imports", () => {
  it("lets staff readers see family links and editors see import batches, with no client writes", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "relationships/link"), {
        personId: "alex",
        relatedPersonId: "former",
        kind: "sibling",
      });
      await setDoc(doc(db, "importBatches/b1"), { fileName: "roll.csv" });
      await setDoc(doc(db, "importBatches/b1/rows/0001"), {
        outcome: "created",
      });
    });
    for (const role of ["admin", "pastor", "deacon", "readOnly"])
      await assertSucceeds(
        getDoc(doc(auth(role).firestore(), "relationships/link")),
      );
    await assertFails(
      getDoc(
        doc(auth("attendanceVolunteer").firestore(), "relationships/link"),
      ),
    );
    for (const role of ["admin", "clerk"]) {
      await assertSucceeds(
        getDoc(doc(auth(role).firestore(), "importBatches/b1")),
      );
      await assertSucceeds(
        getDoc(doc(auth(role).firestore(), "importBatches/b1/rows/0001")),
      );
    }
    for (const role of ["deacon", "readOnly", "attendanceVolunteer"])
      await assertFails(
        getDoc(doc(auth(role).firestore(), "importBatches/b1/rows/0001")),
      );
    await assertFails(
      setDoc(doc(auth("pastor").firestore(), "relationships/new"), {
        personId: "alex",
        relatedPersonId: "former",
        kind: "spouse",
      }),
    );
    await assertFails(
      setDoc(doc(auth("admin").firestore(), "importBatches/b2"), {
        fileName: "x.csv",
      }),
    );
  });
});
describe("member portal accounts", () => {
  // A linked member has a verified email and no staff role. Every portal
  // feature runs through callables, so direct access stays closed.
  const member = () =>
    env.authenticatedContext("member-james", {
      email_verified: true,
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: "password", identities: {} },
    });
  it("keeps calendar feed tokens server only, even from administrators", async () => {
    for (const role of ["admin", "pastor"]) {
      await assertFails(
        getDoc(doc(auth(role).firestore(), "calendarFeeds/private")),
      );
      await assertFails(
        setDoc(doc(auth(role).firestore(), "calendarFeeds/private"), {
          uid: role,
        }),
      );
    }
  });
  it("cannot read or write people, requests or photos directly", async () => {
    for (const path of [
      "people/alex",
      "memberRequests/private",
      "mercyRequests/private",
      "directoryPreferences/alex",
      "calendarFeeds/private",
    ]) {
      await assertFails(getDoc(doc(member().firestore(), path)));
      await assertFails(
        setDoc(doc(member().firestore(), path), { body: "Client write" }),
      );
    }
    await assertFails(
      getBytes(ref(member().storage(), "photos/alex/avatar.png")),
    );
    await assertFails(
      uploadBytes(
        ref(member().storage(), "photos/alex/replacement.png"),
        new Uint8Array([1]),
        { contentType: "image/png" },
      ),
    );
  });
});
describe("roll call and identity", () => {
  it("denies first-factor-only, unverified, revoked and forged assurance access", async () => {
    const unassured = env.authenticatedContext("elder", {
      roles: ["elder"],
      email_verified: true,
      assured: true,
      auth_time: Math.floor(Date.now() / 1000),
    });
    await assertFails(getDoc(doc(unassured.firestore(), "people/alex")));
    await assertFails(
      getBytes(ref(unassured.storage(), "photos/alex/avatar.png")),
    );
    const unverified = env.authenticatedContext("elder", {
      roles: ["elder"],
      auth_time: Math.floor(Date.now() / 1000),
      email_verified: false,
      firebase: {
        ...{ sign_in_second_factor: "totp" },
        sign_in_provider: "password",
      },
    });
    await assertFails(getDoc(doc(unverified.firestore(), "people/alex")));
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), "staffAccess/elder"), {
        enabled: false,
        roles: ["elder"],
        validAfter: 0,
      }),
    );
    await assertFails(getDoc(doc(auth("elder").firestore(), "people/alex")));
    await assertFails(
      getBytes(ref(auth("elder").storage(), "photos/alex/avatar.png")),
    );
  });
  it("binds custom-token assurance to a live server session and denies security-document access", async () => {
    const nonce = "a".repeat(64),
      token = {
        roles: ["elder"],
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1000),
        passkeySession: nonce,
      };
    const context = env.authenticatedContext("elder", token);
    await assertFails(getDoc(doc(context.firestore(), "people/alex")));
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), `staffSessions/${nonce}`), {
        uid: "elder",
        validAfter: 0,
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    );
    await assertSucceeds(getDoc(doc(context.firestore(), "people/alex")));
    await assertSucceeds(
      getBytes(ref(context.storage(), "photos/alex/avatar.png")),
    );
    for (const path of [
      "staffAccess/elder",
      `staffSessions/${nonce}`,
      "staffCredentials/key",
      "securityEvents/entry",
      "securityChallenges/challenge",
      "desktopHandoffs/token",
    ]) {
      await assertFails(getDoc(doc(context.firestore(), path)));
      await assertFails(
        setDoc(doc(context.firestore(), path), { enabled: true }),
      );
    }
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), `staffSessions/${nonce}`), {
        uid: "another",
        validAfter: 0,
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    );
    await assertFails(getDoc(doc(context.firestore(), "people/alex")));
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), `staffSessions/${nonce}`), {
        uid: "elder",
        validAfter: 0,
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      }),
    );
    await assertFails(getDoc(doc(context.firestore(), "people/alex")));
  });
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
    // Online worship is a mode on the same mark. Unknown modes and online kiosk marks are refused.
    await assertSucceeds(
      updateDoc(service, {
        "present.alex": { ...mark("attendanceVolunteer"), mode: "online" },
        lastAttendancePersonId: "alex",
      }),
    );
    await assertSucceeds(
      updateDoc(service, {
        "present.alex": { ...mark("attendanceVolunteer"), mode: "inPerson" },
        lastAttendancePersonId: "alex",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.alex": { ...mark("attendanceVolunteer"), mode: "hybrid" },
        lastAttendancePersonId: "alex",
      }),
    );
    await assertFails(
      updateDoc(service, {
        "present.alex": {
          ...mark("attendanceVolunteer"),
          method: "kiosk",
          mode: "online",
        },
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
  it("requires the audited task API for every Deacon and Session reader", async () => {
    const db = auth("deacon").firestore();
    const task = doc(db, "diaconalTasks/move");
    await assertFails(getDoc(task));
    await assertFails(
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
    await assertFails(updateDoc(task, { done: true }));
    await assertFails(updateDoc(task, { done: true, revision: 1 }));
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
      await assertFails(getDoc(doc(auth("elder").firestore(), path)));
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

describe("Phase 3 access", () => {
  for (const path of [
    "groups/choir/meetings/2027-01-03",
    "events/fellowship",
    "events/fellowship/rsvps/james",
    "serving/usher",
    "reportSettings/statistical",
    "importantDates/anniversary",
  ]) {
    it(`${path} allows congregation readers and denies volunteer, anonymous and direct writes`, async () => {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), path), { title: "Fictional record" }),
      );
      for (const role of [
        "admin",
        "pastor",
        "clerk",
        "elder",
        "deacon",
        "readOnly",
      ])
        await assertSucceeds(getDoc(doc(auth(role).firestore(), path)));
      await assertFails(
        getDoc(doc(auth("attendanceVolunteer").firestore(), path)),
      );
      await assertFails(
        getDoc(doc(env.unauthenticatedContext().firestore(), path)),
      );
      await assertFails(
        setDoc(doc(auth("pastor").firestore(), path), { forged: true }),
      );
    });
  }
  it("gives a kiosk identity no direct access to congregation, staff, private or kiosk documents", async () => {
    const kiosk = env
      .authenticatedContext("kiosk-device", { kiosk: true })
      .firestore();
    for (const path of [
      "people/alex",
      "attendanceRoster/alex",
      "households/ash",
      "services/am_2026-11-01",
      "groups/choir",
      "events/meeting",
      "serving/usher",
      "sessionPrivate/private",
      "careNotes/private",
      "followUps/private",
      "diaconalTasks/move",
      "kioskDevices/kiosk-device",
      "kioskConfiguration/church",
      "kioskSearches/token",
      "servingSlots/slot",
    ]) {
      await assertFails(getDoc(doc(kiosk, path)));
      await assertFails(setDoc(doc(kiosk, path), { forged: true }));
    }
  });
  it("keeps kiosk PIN hashes, search capabilities and assignment locks server-only", async () => {
    for (const collection of [
      "kioskDevices",
      "kioskConfiguration",
      "kioskSearches",
      "servingSlots",
    ]) {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), `${collection}/private`), {
          hash: "not-a-real-hash",
        }),
      );
      for (const role of ["admin", "pastor", "deacon"])
        await assertFails(
          getDoc(doc(auth(role).firestore(), `${collection}/private`)),
        );
      await assertFails(
        setDoc(doc(auth("admin").firestore(), `${collection}/private`), {
          forged: true,
        }),
      );
    }
  });
});

describe("online portal boundaries", () => {
  it("allows only Admin and Pastor to read member access mappings", async () => {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), "portalAccess/member"), {
        personId: "alex",
        enabled: true,
      }),
    );
    for (const role of ["admin", "pastor"])
      await assertSucceeds(
        getDoc(doc(auth(role).firestore(), "portalAccess/member")),
      );
    for (const role of ["clerk", "elder", "deacon", "readOnly"])
      await assertFails(
        getDoc(doc(auth(role).firestore(), "portalAccess/member")),
      );
    await assertFails(
      setDoc(doc(auth("admin").firestore(), "portalAccess/member"), {
        enabled: true,
      }),
    );
  });
  for (const collection of ["eventPublications", "onlineSubmissions"]) {
    it(`${collection} permits editors but no direct writes or member reads`, async () => {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), `${collection}/example`), {
          private: true,
        }),
      );
      for (const role of ["admin", "pastor", "clerk", "elder"])
        await assertSucceeds(
          getDoc(doc(auth(role).firestore(), `${collection}/example`)),
        );
      for (const role of ["deacon", "readOnly", "attendanceVolunteer"])
        await assertFails(
          getDoc(doc(auth(role).firestore(), `${collection}/example`)),
        );
      await assertFails(
        getDoc(
          doc(
            env
              .authenticatedContext("member", { portalMember: true })
              .firestore(),
            `${collection}/example`,
          ),
        ),
      );
      await assertFails(
        getDoc(
          doc(
            env.unauthenticatedContext().firestore(),
            `${collection}/example`,
          ),
        ),
      );
      await assertFails(
        setDoc(doc(auth("pastor").firestore(), `${collection}/example`), {
          forged: true,
        }),
      );
    });
  }
  it("keeps sharing preferences and rate buckets server-only even against their owner", async () => {
    for (const path of [
      "directoryPreferences/member",
      "portalBudgets/iphash",
    ]) {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), path), { listed: true }),
      );
      for (const context of [
        auth("admin"),
        auth("pastor"),
        env.authenticatedContext("member", { portalMember: true }),
      ]) {
        await assertFails(getDoc(doc(context.firestore(), path)));
        await assertFails(
          setDoc(doc(context.firestore(), path), { listed: true }),
        );
      }
    }
  });
  it("gives member identities no direct directory, staff, attendance, RSVP or photo access", async () => {
    const context = env.authenticatedContext("member", { portalMember: true });
    for (const path of [
      "people/alex",
      "attendanceRoster/alex",
      "households/ash",
      "groups/choir",
      "events/meal",
      "events/meal/rsvps/one",
      "services/am_2026-11-01",
      "sessionPrivate/private",
      "careNotes/private",
      "followUps/private",
      "diaconalTasks/move",
      "portalAccess/member",
      "users/pastor",
    ]) {
      await assertFails(getDoc(doc(context.firestore(), path)));
      await assertFails(
        setDoc(doc(context.firestore(), path), { forged: true }),
      );
    }
    await assertFails(
      getBytes(ref(context.storage(), "photos/alex/avatar.png")),
    );
  });
});

describe("photo cleanup queue", () => {
  it("denies every client access to server cleanup jobs", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "photoCleanup/old"), {
        path: "photos/alex/old.png",
        personId: "alex",
      });
    });
    for (const role of [
      "admin",
      "pastor",
      "clerk",
      "elder",
      "deacon",
      "attendanceVolunteer",
      "readOnly",
    ]) {
      await assertFails(
        getDoc(doc(auth(role).firestore(), "photoCleanup/old")),
      );
      await assertFails(
        setDoc(doc(auth(role).firestore(), "photoCleanup/old"), {
          path: "photos/alex/current.png",
        }),
      );
    }
  });
});
