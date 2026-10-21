import { setGlobalOptions } from "firebase-functions/v2";
// A per-function ceiling limits accidental scaling. Billing alerts remain necessary;
// this is not an account-wide spending cap. Scheduled delivery/backup jobs use tighter limits.
setGlobalOptions({ region: "us-central1", maxInstances: 5, concurrency: 40 });
