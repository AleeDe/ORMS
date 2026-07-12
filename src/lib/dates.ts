import { addBusinessDays, format } from "date-fns";

export function businessDaysFromNow(days: number): string {
  return format(addBusinessDays(new Date(), days), "yyyy-MM-dd");
}

export function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}
