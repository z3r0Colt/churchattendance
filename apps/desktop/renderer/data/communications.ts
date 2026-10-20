import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Query,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes, getBlob } from "firebase/storage";
import {
  actionIdSchema,
  bulletinActionSchema,
  bulletinFileSchema,
  communicationSettingsSchema,
  contactConsentSchema,
  hasRole,
  messageInputSchema,
  savedAudienceSchema,
  SESSION_ROLES,
  templateInputSchema,
  type Audience,
  type CommunicationSettings,
  type MessageInput,
  type Person,
  type Role,
} from "@sycamore/shared";
import { emulators } from "../platform";
import { auth, db, functions, storage } from "./firebase";
export { emulators };
export type MessageView = {
  id: string;
  subject: string;
  body: string;
  channel: string;
  status: string;
  source: string;
  scheduledFor: Timestamp;
  totals: Record<string, number>;
  selectedPersonIds: string[];
  sessionOnly: boolean;
};
export type RecipientView = {
  id: string;
  personId: string;
  channel: string;
  address: string;
  status: string;
  error: string;
  providerId: string;
};
export type InboxView = {
  id: string;
  fromNumber: string;
  personIds: string[];
  body: string;
  read: boolean;
  receivedAt: Timestamp;
};
export type TemplateView = {
  id: string;
  name: string;
  channel: "email" | "sms" | "both";
  subject: string;
  body: string;
};
export type NamedList = { id: string; name: string };
export type SavedAudienceView = NamedList & { audience: Audience };
export type BulletinView = {
  id: string;
  week: string;
  status: string;
  file?: { name: string; path: string; size: number; source: string };
  messageId?: string;
  previewMessageId?: string;
  publicUrl?: string;
  error?: string;
};
export type PreviewView = {
  pending: number;
  recipients: {
    id: string;
    personId: string;
    name: string;
    channel: string;
    address: string;
    status: string;
    error: string;
  }[];
};
export function useCommunicationData(roles: Role[]) {
  const [people, setPeople] = useState<Person[]>([]);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [inbox, setInbox] = useState<InboxView[]>([]);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [households, setHouseholds] = useState<NamedList[]>([]);
  const [districts, setDistricts] = useState<NamedList[]>([]);
  const [groups, setGroups] = useState<NamedList[]>([]);
  const [saved, setSaved] = useState<SavedAudienceView[]>([]);
  const [bulletins, setBulletins] = useState<BulletinView[]>([]);
  const [settings, setSettings] = useState<CommunicationSettings>(
    communicationSettingsSchema.parse({}),
  );
  const [zone, setZone] = useState("America/Indiana/Indianapolis");
  const [error, setError] = useState("");
  const [automationError, setAutomationError] = useState("");
  const session = hasRole(roles, SESSION_ROLES);
  useEffect(() => {
    const stops: (() => void)[] = [];
    const failed = () =>
      setError(
        "Communication records could not be loaded. Check your connection and role.",
      );
    const listen = <T>(source: Query, update: (rows: T[]) => void) =>
      stops.push(
        onSnapshot(
          source,
          (snapshot) =>
            update(
              snapshot.docs.map((row) => ({ ...row.data(), id: row.id }) as T),
            ),
          failed,
        ),
      );
    listen<Person>(collection(db, "people"), setPeople);
    listen<MessageView>(
      session
        ? query(
            collection(db, "messages"),
            orderBy("createdAt", "desc"),
            limit(200),
          )
        : query(
            collection(db, "messages"),
            where("sessionOnly", "==", false),
            orderBy("createdAt", "desc"),
            limit(200),
          ),
      setMessages,
    );
    listen<InboxView>(
      query(
        collection(db, "smsInbox"),
        orderBy("receivedAt", "desc"),
        limit(200),
      ),
      setInbox,
    );
    listen<TemplateView>(collection(db, "messageTemplates"), setTemplates);
    listen<NamedList>(collection(db, "households"), setHouseholds);
    listen<NamedList>(collection(db, "elderDistricts"), setDistricts);
    listen<NamedList>(collection(db, "groups"), setGroups);
    listen<SavedAudienceView>(collection(db, "savedAudiences"), setSaved);
    listen<BulletinView>(
      query(collection(db, "bulletins"), orderBy("week", "desc"), limit(20)),
      setBulletins,
    );
    stops.push(
      onSnapshot(
        doc(db, "communicationSettings", "church"),
        (snapshot) => {
          const parsed = communicationSettingsSchema.safeParse(
            snapshot.data() ?? {},
          );
          if (parsed.success) setSettings(parsed.data);
          else failed();
        },
        failed,
      ),
    );
    stops.push(
      onSnapshot(
        doc(db, "settings", "church"),
        (snapshot) =>
          setZone(snapshot.get("timeZone") || "America/Indiana/Indianapolis"),
        failed,
      ),
    );
    stops.push(
      onSnapshot(
        doc(db, "automationStatus", "church"),
        (snapshot) =>
          setAutomationError(
            [
              snapshot.get("bulletinError"),
              snapshot.get("absenceError"),
              snapshot.get("servingError"),
              snapshot.get("visitError"),
              snapshot.get("queueError"),
            ]
              .filter(Boolean)
              .join(" "),
          ),
        failed,
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [session]);
  return {
    people,
    messages,
    inbox,
    templates,
    households,
    districts,
    groups,
    saved,
    bulletins,
    settings,
    zone,
    error,
    setError,
    automationError,
  };
}
export function useRecipients(messageId: string) {
  const [rows, setRows] = useState<RecipientView[]>([]);
  useEffect(() => {
    setRows([]);
    if (!messageId) return;
    return onSnapshot(
      collection(db, "messages", messageId, "recipients"),
      (snapshot) =>
        setRows(
          snapshot.docs.map(
            (row) => ({ ...row.data(), id: row.id }) as RecipientView,
          ),
        ),
    );
  }, [messageId]);
  return rows;
}
export function usePersonHistory(personId: string, roles: Role[]) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [inbox, setInbox] = useState<InboxView[]>([]);
  const session = hasRole(roles, SESSION_ROLES);
  useEffect(() => {
    setMessages([]);
    setInbox([]);
    if (!personId) return;
    const messagesQuery = session
      ? query(
          collection(db, "messages"),
          where("selectedPersonIds", "array-contains", personId),
          orderBy("createdAt", "desc"),
        )
      : query(
          collection(db, "messages"),
          where("selectedPersonIds", "array-contains", personId),
          where("sessionOnly", "==", false),
          orderBy("createdAt", "desc"),
        );
    const stopMessages = onSnapshot(messagesQuery, (snapshot) =>
      setMessages(
        snapshot.docs.map(
          (row) => ({ ...row.data(), id: row.id }) as MessageView,
        ),
      ),
    );
    const stopInbox = onSnapshot(
      query(
        collection(db, "smsInbox"),
        where("personIds", "array-contains", personId),
        orderBy("receivedAt", "desc"),
      ),
      (snapshot) =>
        setInbox(
          snapshot.docs.map(
            (row) => ({ ...row.data(), id: row.id }) as InboxView,
          ),
        ),
    );
    return () => {
      stopMessages();
      stopInbox();
    };
  }, [personId, session]);
  return { messages, inbox };
}
export function useUnreadSms(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, "smsInbox"), where("read", "==", false)),
      (snapshot) => setCount(snapshot.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}
async function call<T = unknown>(name: string, value: unknown): Promise<T> {
  return (await httpsCallable<unknown, T>(functions, name)(value)).data;
}
export const previewMessage = (input: MessageInput) =>
  call<PreviewView>("previewMessage", messageInputSchema.parse(input));
export const createMessage = (input: MessageInput) =>
  call<{ id: string }>("createMessage", messageInputSchema.parse(input));
export const sendTestMessage = (input: MessageInput) =>
  call("sendTestMessage", messageInputSchema.parse(input));
export const cancelMessage = (id: string) =>
  call("cancelMessage", actionIdSchema.parse({ id }));
export const retryFailedMessage = (id: string) =>
  call("retryFailedMessage", actionIdSchema.parse({ id }));
export const markSmsRead = (id: string) =>
  call("markSmsRead", actionIdSchema.parse({ id }));
export const recordContactConsent = (input: unknown) =>
  call("recordContactConsent", contactConsentSchema.parse(input));
export const saveCommunicationSettings = (input: CommunicationSettings) =>
  call("saveCommunicationSettings", communicationSettingsSchema.parse(input));
export const saveMessageTemplate = (input: unknown) =>
  call("saveMessageTemplate", templateInputSchema.parse(input));
export const saveAudience = (input: unknown) =>
  call("saveAudience", savedAudienceSchema.parse(input));
export const runLocalCommunicationTick = () =>
  call("runLocalCommunicationTick", {});
export const bulletinAction = (
  week: string,
  action: "send" | "skip" | "preview",
  confirmedRecipientCount: number | null = null,
) =>
  call(
    "bulletinAction",
    bulletinActionSchema.parse({ week, action, confirmedRecipientCount }),
  );
export const communicationStatus = () =>
  call<{ mode: string; emailConfigured: boolean; smsConfigured: boolean }>(
    "communicationStatus",
    {},
  );
export async function uploadPdf(file: File, folder: string) {
  if (
    file.type !== "application/pdf" ||
    file.size > 20 * 1024 * 1024 ||
    file.size < 5
  )
    throw new Error("Choose a PDF no larger than 20 MB.");
  const path = `${folder}/${crypto.randomUUID()}.pdf`;
  await uploadBytes(ref(storage, path), file, {
    contentType: "application/pdf",
    customMetadata: { originalName: file.name.slice(0, 150) },
  });
  return { name: file.name, path };
}
export const uploadMessagePdf = (file: File) => {
  if (!auth.currentUser) throw new Error("Please sign in.");
  return uploadPdf(file, `messageAttachments/${auth.currentUser.uid}`);
};
export async function uploadBulletinPdf(file: File, week: string) {
  const uploaded = await uploadPdf(file, `bulletins/${week}`);
  return call(
    "registerBulletinFile",
    bulletinFileSchema.parse({ week, ...uploaded }),
  );
}
// The PDF itself, held in memory. Callers read it directly, because the live site's
// CSP refuses fetch() of blob: URLs.
export async function previewPdf(path: string) {
  return new Blob([await getBlob(ref(storage, path))], {
    type: "application/pdf",
  });
}
