import { createHash } from "node:crypto";
import { db } from "../admin.js";

// Hash metadata only. Source or access changes invalidate waiting summaries.
export async function deaconDigestVersion() {
  const sources = await Promise.all(
    [
      "households",
      "mercyAssignments",
      "mercyRequests",
      "mercyTasks",
      "mercyVisits",
      "pastoralVisits",
      "mercySettings",
      "users",
      "staffAccess",
      "settings",
    ].map((name) => db.collection(name).get()),
  );
  return createHash("sha256")
    .update(
      sources
        .flatMap((source) =>
          source.docs.map(
            (row) => `${row.ref.path}:${row.updateTime.valueOf()}`,
          ),
        )
        .sort()
        .join("\n"),
    )
    .digest("hex");
}
