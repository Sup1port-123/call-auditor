// All audit timestamps are stored in UTC but the product is IST-facing, so we
// format everything explicitly in India Standard Time — independent of the
// viewer's machine timezone or the (UTC) server. Pure + client-safe.

const IST = "Asia/Kolkata";

// For table cells: { date: "15/06/2026", time: "4:00 PM" } in IST.
export function istDateParts(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString("en-GB", {
      timeZone: IST,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", {
      timeZone: IST,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

// One-line IST display, e.g. "15/06/2026, 4:00 PM".
export function istDateTime(iso: string | null | undefined): string {
  const { date, time } = istDateParts(iso);
  if (date === "—") return "—";
  return `${date}, ${time}`;
}

// Sortable IST stamp for spreadsheets, e.g. "2026-06-15 16:00".
export function istStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // sv-SE yields an ISO-like "YYYY-MM-DD HH:MM".
  return d.toLocaleString("sv-SE", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
