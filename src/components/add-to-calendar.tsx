"use client";

import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from "@/lib/calendar";

export function AddToCalendar({
  event,
  fileName = "event.ics",
  size = "sm",
  variant = "outline",
  label = "Add to calendar",
}: {
  event: CalendarEvent;
  fileName?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={variant} className={label ? undefined : "h-8 px-2"}>
          <CalendarPlus className={label ? "mr-1 h-4 w-4" : "h-4 w-4"} /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
            Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadIcs(event, fileName)}>
          Apple / Outlook (.ics)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
