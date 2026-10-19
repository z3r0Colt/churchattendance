import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
} from "@fluentui/react-components";
import { DateTime } from "luxon";
import {
  MAX_ROUTE_STOPS,
  directionsUrl,
  locationState,
  locationStateLabels,
  plotPoints,
  suggestRouteOrder,
} from "@sycamore/shared";
import { ExportButton } from "../components/ExportButton";
import { auth } from "../data/firebase";
import {
  confirmHouseholdLocation,
  lookupHouseholdLocation,
  saveGeographySettings,
  saveHouseholdLocation,
  useHouseholdLocations,
  type useShepherdingData,
} from "../data/shepherding";
import { Records, RecordEditor, StatusPill, friendlyError } from "./Common";
import { native } from "../platform";

export function Locations({
  data,
}: {
  data: ReturnType<typeof useShepherdingData>;
}) {
  const { data: geo, error: loadError } = useHouseholdLocations(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const [route, setRoute] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [visitDate, setVisitDate] = useState(
    DateTime.now().setZone(data.zone).toISODate()!,
  );
  const lookups = geo?.settings.geocoder === "census";
  const location = (id: string) =>
    geo?.locations.find((row) => row.householdId === id);
  const households = [...data.households].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const state = (id: string) =>
    locationState(
      households.find((row) => row.id === id)?.address || "",
      location(id),
    );
  const review = households.filter((row) => state(row.id) !== "verified");
  const confirmed = households.filter((row) => state(row.id) === "verified");
  const stops = route
    .map((id) => households.find((row) => row.id === id))
    .filter((row) => !!row);
  const plotted = plotPoints(
    confirmed.map((row) => ({ ...location(row.id)!, id: row.id })),
    640,
    360,
  );
  async function act(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setBusy("");
    }
  }
  const move = (index: number, by: number) =>
    setRoute((before) => {
      const next = [...before];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });
  function addMyVisits() {
    const uid = auth.currentUser?.uid || "";
    const ids = data.visits
      .filter(
        (visit) =>
          visit.status === "planned" &&
          visit.officerUids.includes(uid) &&
          DateTime.fromISO(visit.start).setZone(data.zone).toISODate() ===
            visitDate,
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((visit) => visit.householdId)
      .filter((id) => state(id) === "verified");
    setRoute((before) =>
      [...new Set([...before, ...ids])].slice(0, MAX_ROUTE_STOPS),
    );
  }
  async function openDirections() {
    const addresses = stops.map((row) => row!.address);
    if (native) await native.openDirections(addresses);
    else window.open(directionsUrl(addresses), "_blank", "noopener,noreferrer");
    setPreview(false);
  }
  return (
    <>
      {(error || loadError) && (
        <MessageBar intent="error">{error || loadError}</MessageBar>
      )}
      <section className="surface communication-panel">
        <p>
          Address lookups are <strong>{lookups ? "on" : "off"}</strong>. When
          on, the Look up button sends only that household's address to the US
          Census Bureau geocoder. Nothing is looked up automatically, and a
          found location must be confirmed before it is used.
        </p>
        <Button
          disabled={!geo || busy === "settings"}
          onClick={() =>
            void act("settings", () =>
              saveGeographySettings({
                expectedRevision: geo!.settings.revision,
                geocoder: lookups ? "none" : "census",
              }),
            )
          }
        >
          {lookups ? "Turn off address lookups" : "Allow address lookups"}
        </Button>
      </section>
      <section className="surface table-card communication-panel session-panel">
        <div className="section-heading">
          <span>Locations to review ({review.length})</span>
          <ExportButton
            rows={review.map((row) => ({
              Household: row.name,
              Address: row.address,
              State: locationStateLabels[state(row.id)],
            }))}
          />
        </div>
        {!review.length ? (
          <p>Every household with an address has a confirmed location.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Household</th>
                  <th>Address</th>
                  <th>State</th>
                  <th>Found address</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {review.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.address || "None"}</td>
                    <td>
                      <StatusPill text={locationStateLabels[state(row.id)]} />
                    </td>
                    <td>{location(row.id)?.matchedAddress || ""}</td>
                    <td>
                      {row.address && lookups && (
                        <Button
                          size="small"
                          disabled={!!busy}
                          aria-label={`Look up ${row.name}`}
                          onClick={() =>
                            void act(row.id, () =>
                              lookupHouseholdLocation({
                                householdId: row.id,
                                expectedRevision:
                                  location(row.id)?.revision ?? 0,
                              }),
                            )
                          }
                        >
                          Look up
                        </Button>
                      )}{" "}
                      {state(row.id) === "unverified" && (
                        <Button
                          size="small"
                          appearance="primary"
                          disabled={!!busy}
                          aria-label={`Confirm ${row.name}`}
                          onClick={() =>
                            void act(row.id, () =>
                              confirmHouseholdLocation({
                                householdId: row.id,
                                expectedRevision: location(row.id)!.revision,
                              }),
                            )
                          }
                        >
                          Confirm
                        </Button>
                      )}{" "}
                      {row.address && (
                        <Button
                          size="small"
                          disabled={!!busy}
                          aria-label={`Enter coordinates for ${row.name}`}
                          onClick={() => setManual(row.id)}
                        >
                          Enter coordinates
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="surface communication-panel session-panel">
        <div className="section-heading">
          <span>Confirmed locations ({confirmed.length})</span>
        </div>
        <p className="muted">
          A plain sketch of confirmed locations with no street map. Households
          without a confirmed location are never placed. The list below has the
          same information.
        </p>
        {plotted.length > 0 && (
          <svg
            className="location-plot"
            viewBox="0 0 640 360"
            role="img"
            aria-label={`Sketch of ${plotted.length} confirmed household locations`}
          >
            <rect width="640" height="360" rx="8" className="plot-ground" />
            {plotted.map(({ point, x, y }) => {
              const stop = route.indexOf(point.id);
              const name =
                households.find((row) => row.id === point.id)?.name || "";
              return (
                <g key={point.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={stop >= 0 ? 11 : 6}
                    className={stop >= 0 ? "plot-stop" : "plot-point"}
                  />
                  {stop >= 0 && (
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      className="plot-number"
                    >
                      {stop + 1}
                    </text>
                  )}
                  <text x={x + 14} y={y + 4} className="plot-label">
                    {name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <Records
          rows={confirmed.map((row) => ({
            id: row.id,
            Household: row.name,
            Address: row.address,
            Source:
              location(row.id)!.provenance === "census"
                ? "US Census lookup, confirmed"
                : "Entered by hand",
            Latitude: location(row.id)!.lat,
            Longitude: location(row.id)!.lng,
          }))}
        />
      </section>
      <section className="surface communication-panel session-panel">
        <div className="section-heading">
          <span>Visit route</span>
        </div>
        <div className="report-filters">
          <Field label="My planned visits on">
            <Input
              type="date"
              value={visitDate}
              onChange={(_, value) => setVisitDate(value.value)}
            />
          </Field>
          <Button onClick={addMyVisits}>Add my visits</Button>
          <Button
            disabled={route.length < 3}
            onClick={() =>
              setRoute(
                suggestRouteOrder(
                  route.map((id) => ({ ...location(id)!, id })),
                ),
              )
            }
          >
            Suggest order from first stop
          </Button>
          <Button
            appearance="primary"
            disabled={route.length < 2}
            onClick={() => setPreview(true)}
          >
            Preview directions
          </Button>
        </div>
        <fieldset className="member-picker">
          <legend>Stops (up to {MAX_ROUTE_STOPS})</legend>
          {confirmed.map((row) => (
            <Checkbox
              key={row.id}
              label={row.name}
              checked={route.includes(row.id)}
              disabled={
                !route.includes(row.id) && route.length >= MAX_ROUTE_STOPS
              }
              onChange={(_, value) =>
                setRoute((before) =>
                  value.checked
                    ? [...before, row.id]
                    : before.filter((id) => id !== row.id),
                )
              }
            />
          ))}
        </fieldset>
        {stops.length > 0 && (
          <ol className="route-list">
            {stops.map((row, index) => (
              <li key={row!.id}>
                {row!.name}
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={index === 0}
                  aria-label={`Move ${row!.name} earlier`}
                  onClick={() => move(index, -1)}
                >
                  Earlier
                </Button>
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={index === stops.length - 1}
                  aria-label={`Move ${row!.name} later`}
                  onClick={() => move(index, 1)}
                >
                  Later
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>
      {preview && (
        <Dialog
          open
          onOpenChange={(_, value) => !value.open && setPreview(false)}
        >
          <DialogSurface className="record-dialog">
            <DialogBody>
              <DialogTitle>Leave the app for directions</DialogTitle>
              <DialogContent>
                <p>
                  These {stops.length} addresses will open in Google Maps in
                  your web browser, in this order. Household names, notes and
                  visit details are not sent.
                </p>
                <ol aria-label="Addresses to send">
                  {stops.map((row) => (
                    <li key={row!.id}>{row!.address}</li>
                  ))}
                </ol>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setPreview(false)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={() =>
                    void openDirections().catch((failure) =>
                      setError(friendlyError(failure)),
                    )
                  }
                >
                  Open in Google Maps
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {manual && (
        <RecordEditor
          title={`Location for ${households.find((row) => row.id === manual)?.name || "household"}`}
          fields={[
            // Text fields, because number inputs reject decimal coordinates on submit.
            { key: "lat", label: "Latitude", required: true },
            { key: "lng", label: "Longitude", required: true },
          ]}
          initial={{
            lat: location(manual)?.lat ?? "",
            lng: location(manual)?.lng ?? "",
          }}
          save={(value) =>
            saveHouseholdLocation({
              householdId: manual,
              expectedRevision: location(manual)?.revision ?? 0,
              lat: Number(value.lat),
              lng: Number(value.lng),
            })
          }
          close={() => setManual(null)}
        />
      )}
    </>
  );
}
