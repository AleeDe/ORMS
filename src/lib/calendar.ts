// Client-side calendar export — no account/OAuth needed. Produces a downloadable
// .ics (Apple/Outlook/any) and a "Add to Google Calendar" URL.

export type CalendarEvent = {
  title: string;
  description?: string;
  location?: string;
  /** Local start; if allDay, only the date part is used */
  start: Date;
  /** Optional end; defaults to start + 30 min for timed events */
  end?: Date;
  allDay?: boolean;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// UTC stamp for .ics timed events: 20260721T140000Z
function icsUtc(d: Date) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Plain date stamp for all-day events: 20260721
function ymd(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function escapeIcs(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcs(ev: CalendarEvent): string {
  const end = ev.end ?? new Date(ev.start.getTime() + 30 * 60 * 1000);
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@orms`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ORMS//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    ev.allDay
      ? `DTSTART;VALUE=DATE:${ymd(ev.start)}`
      : `DTSTART:${icsUtc(ev.start)}`,
    ev.allDay
      ? `DTEND;VALUE=DATE:${ymd(new Date(ev.start.getTime() + 24 * 60 * 60 * 1000))}`
      : `DTEND:${icsUtc(end)}`,
    `SUMMARY:${escapeIcs(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeIcs(ev.description)}` : "",
    ev.location ? `LOCATION:${escapeIcs(ev.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export function downloadIcs(ev: CalendarEvent, fileName = "event.ics") {
  const blob = new Blob([buildIcs(ev)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Auto-create the event on the user's connected Google Calendar (server route).
// Returns true if it was created, false if the user hasn't connected Google.
export async function autoCreateGoogleEvent(ev: CalendarEvent): Promise<boolean> {
  try {
    const res = await fetch("/api/google/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ev.title,
        description: ev.description,
        location: ev.location,
        start: ev.start.toISOString(),
        end: ev.end?.toISOString(),
        allDay: ev.allDay,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { connected?: boolean };
    return !!data.connected;
  } catch {
    return false;
  }
}

// Google Calendar prefilled-event URL
export function googleCalendarUrl(ev: CalendarEvent): string {
  const fmt = (d: Date) =>
    ev.allDay ? ymd(d) : icsUtc(d).replace(/[-:]/g, "");
  const end = ev.end ?? new Date(ev.start.getTime() + 30 * 60 * 1000);
  const dates = ev.allDay
    ? `${ymd(ev.start)}/${ymd(new Date(ev.start.getTime() + 24 * 60 * 60 * 1000))}`
    : `${fmt(ev.start)}/${fmt(end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
