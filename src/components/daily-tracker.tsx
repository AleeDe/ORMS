import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { buildTrackerRows, trackerTotals, type TrackerActivity } from "@/lib/tracker";

/** Excel-style daily outreach tracker. Server-safe (no hooks). */
export function DailyTracker({
  activities,
  maxRows,
  emptyText = "No outreach logged in this period yet.",
}: {
  activities: TrackerActivity[];
  maxRows?: number;
  emptyText?: string;
}) {
  const all = buildTrackerRows(activities);
  const rows = maxRows ? all.slice(0, maxRows) : all;
  const totals = trackerTotals(rows);

  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Emails Sent</TableHead>
            <TableHead className="text-right">Replies</TableHead>
            <TableHead className="text-right">Meetings</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Reply Rate</TableHead>
            <TableHead>Sent Time Window</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.day}>
              <TableCell className="text-muted-foreground">{rows.length - i}</TableCell>
              <TableCell className="font-medium">{r.dateLabel}</TableCell>
              <TableCell>{r.weekday}</TableCell>
              <TableCell className="text-right">{r.sends}</TableCell>
              <TableCell className="text-right">{r.replies}</TableCell>
              <TableCell className="text-right">{r.meetings}</TableCell>
              <TableCell className="text-right">{r.calls}</TableCell>
              <TableCell className="text-right">{r.replyRate.toFixed(2)}%</TableCell>
              <TableCell className="text-sm text-muted-foreground">{r.window}</TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 font-semibold">
            <TableCell />
            <TableCell colSpan={2}>Total</TableCell>
            <TableCell className="text-right">{totals.sends}</TableCell>
            <TableCell className="text-right">{totals.replies}</TableCell>
            <TableCell className="text-right">{totals.meetings}</TableCell>
            <TableCell className="text-right">{totals.calls}</TableCell>
            <TableCell className="text-right">{totals.replyRate.toFixed(2)}%</TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
