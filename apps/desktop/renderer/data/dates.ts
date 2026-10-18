import { useEffect, useState } from "react";
import {
  SESSION_ROLES,
  bereavementDateSchema,
  dateRemoveSchema,
  hasRole,
  importantDateSchema,
  type BereavementDate,
  type ImportantDate,
  type Role,
} from "@sycamore/shared";
import { chmsCall, useCollection, type Assignee } from "./chms";
import { usePrivateRecords } from "./private";

// Ordinary dates are staff-readable. Bereavement dates come only from the audited Session API.
export function useImportantDates(roles: Role[]) {
  const session = hasRole(roles, SESSION_ROLES);
  const ordinary = useCollection<ImportantDate>("importantDates");
  const bereavement = usePrivateRecords<BereavementDate>(
    "bereavementDates",
    session,
  );
  const [recipients, setRecipients] = useState<Assignee[]>([]);
  useEffect(() => {
    void chmsCall<Assignee[]>("getReminderRecipients", {})
      .then(setRecipients)
      .catch(() => setRecipients([]));
  }, []);
  return {
    ordinary: ordinary.rows,
    bereavement: bereavement.rows,
    recipients,
    error: ordinary.error || bereavement.error,
  };
}
export const saveImportantDate = (value: unknown) =>
  chmsCall("saveImportantDate", importantDateSchema.parse(value));
export const saveBereavementDate = (value: unknown) =>
  chmsCall("saveBereavementDate", bereavementDateSchema.parse(value));
export const removeImportantDate = (value: unknown) =>
  chmsCall("removeImportantDate", dateRemoveSchema.parse(value));
export const removeBereavementDate = (value: unknown) =>
  chmsCall("removeBereavementDate", dateRemoveSchema.parse(value));
