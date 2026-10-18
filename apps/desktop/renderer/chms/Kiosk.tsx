import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  Title3,
} from "@fluentui/react-components";
import {
  chmsCall,
  checkInKiosk,
  exitKiosk,
  searchKiosk,
  type KioskResult,
} from "../data/chms";
import { lightTheme } from "../theme/brand";
import { friendlyError } from "./Common";
export function Kiosk() {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<KioskResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState("");
  const [exit, setExit] = useState(false);
  const [pin, setPin] = useState("");
  const [date, setDate] = useState("");
  useEffect(() => {
    void window.desktop?.setKioskMode(true);
    void chmsCall<{ date: string }>("kioskInfo", {})
      .then((row) => setDate(row.date))
      .catch((error) => setError(friendlyError(error)));
    return () => {
      void window.desktop?.setKioskMode(false);
    };
  }, []);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => {
      setResult(null);
      setSearch("");
      setSelected([]);
    }, 60000);
    return () => clearTimeout(timer);
  }, [result]);
  useEffect(() => {
    if (!welcome) return;
    const timer = setTimeout(() => {
      setWelcome("");
      setSearch("");
      setSelected([]);
      setResult(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [welcome]);
  async function find(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(await searchKiosk(search));
      setSelected([]);
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FluentProvider theme={lightTheme} className="kiosk">
      <div className="kiosk-heading">
        <span className="wordmark">SYCAMORE RPC</span>
        <Button onClick={() => setExit(!exit)}>Exit kiosk</Button>
      </div>
      <main>
        <Title3 as="h1">Welcome to the Lord's Day service</Title3>
        <p>{date}</p>
        {error && <MessageBar intent="error">{error}</MessageBar>}
        {welcome ? (
          <div className="kiosk-welcome" role="status">
            {welcome}
          </div>
        ) : exit ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void exitKiosk(pin)
                .catch((error) => setError(friendlyError(error)))
                .finally(() => setBusy(false));
            }}
          >
            <Field label="Administrator or Pastor exit PIN">
              <Input
                type="password"
                value={pin}
                onChange={(_, data) => setPin(data.value)}
                inputMode="numeric"
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Close kiosk and sign out
            </Button>
          </form>
        ) : (
          <>
            <form onSubmit={find}>
              <Field label="Type your last name or full phone number">
                <Input
                  autoComplete="off"
                  value={search}
                  onChange={(_, data) => setSearch(data.value)}
                  size="large"
                />
              </Field>
              <Button
                appearance="primary"
                type="submit"
                disabled={busy || search.trim().length < 3}
              >
                Find household
              </Button>
            </form>
            {result && !result.households.length && (
              <p>No household matched. Ask a church volunteer for help.</p>
            )}
            {result?.households.map((household) => (
              <section className="surface kiosk-household" key={household.id}>
                <h2>{household.name}</h2>
                {household.people.map((person) => (
                  <Checkbox
                    key={person.id}
                    label={`${person.name}${person.present ? ", already checked in" : ""}`}
                    disabled={person.present || busy}
                    checked={person.present || selected.includes(person.id)}
                    onChange={(_, row) =>
                      setSelected((before) =>
                        row.checked
                          ? [...before, person.id]
                          : before.filter((id) => id !== person.id),
                      )
                    }
                  />
                ))}
              </section>
            ))}
            {result && (
              <Button
                appearance="primary"
                disabled={!selected.length || busy}
                onClick={() => {
                  setBusy(true);
                  void checkInKiosk(result.searchToken, selected)
                    .then(() => setWelcome("Welcome. You are checked in."))
                    .catch((error) => setError(friendlyError(error)))
                    .finally(() => setBusy(false));
                }}
              >
                Check in
              </Button>
            )}
          </>
        )}
      </main>
    </FluentProvider>
  );
}
