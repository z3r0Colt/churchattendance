import { beforeUserCreated, HttpsError } from "firebase-functions/v2/identity";

// Church accounts with an email are created only through the Admin SDK, which
// does not run blocking functions. A member email link or a client sign-up for
// an unknown address therefore creates nothing. Kiosk identities carry no email.
export const refuseClientAccounts = beforeUserCreated((event) => {
  if (event.data?.email)
    throw new HttpsError(
      "permission-denied",
      "This email is not linked to a church account. Contact the church office.",
    );
});
