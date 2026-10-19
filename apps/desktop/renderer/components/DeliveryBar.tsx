import { deliveryBreakdown } from "@sycamore/shared";

// Sent, waiting, skipped and failed in one small bar, with the same in words.
export function DeliveryBar({ totals }: { totals: Record<string, number> }) {
  const parts = deliveryBreakdown(totals);
  const total = parts.sent + parts.waiting + parts.skipped + parts.failed;
  const words = (
    [
      ["sent", parts.sent],
      ["waiting", parts.waiting],
      ["skipped", parts.skipped],
      ["failed", parts.failed],
    ] as const
  ).filter(([, count]) => count > 0);
  if (!total) return <span className="muted">No recipients</span>;
  return (
    <span className="delivery">
      <span className="delivery-bar" aria-hidden="true">
        {words.map(([name, count]) => (
          <span
            key={name}
            className={`delivery-${name}`}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </span>
      <span className="delivery-words">
        {words.map(([name, count]) => `${count} ${name}`).join(" · ")}
      </span>
    </span>
  );
}
