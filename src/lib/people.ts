// People attached to a lead, and the channels a touch can go through.

export type Person = {
  id: string;
  lead_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  personal_email: string | null;
  personal_phone: string | null;
  linkedin_url: string | null;
  is_primary: boolean;
  notes: string | null;
};

// Offered in the role dropdown — any other role can still be typed in.
export const ROLE_OPTIONS = [
  "Owner",
  "Manager",
  "Practice Manager",
  "Receptionist",
  "Dentist",
  "Director",
  "Marketing",
  "Other",
];

export type ContactChannel =
  | "personal_phone"
  | "clinic_phone"
  | "personal_email"
  | "clinic_email"
  | "whatsapp"
  | "linkedin"
  | "contact_form"
  | "in_person"
  | "other";

export const CHANNEL_LABELS: Record<ContactChannel, string> = {
  personal_phone: "Personal number",
  clinic_phone: "Business number",
  personal_email: "Personal email",
  clinic_email: "Business email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  contact_form: "Contact form",
  in_person: "In person",
  other: "Other",
};

export const CHANNEL_ORDER: ContactChannel[] = [
  "clinic_email", "clinic_phone", "personal_email", "personal_phone",
  "whatsapp", "linkedin", "contact_form", "in_person", "other",
];

export function personLabel(p: Pick<Person, "name" | "role">) {
  return p.role ? `${p.name} — ${p.role}` : p.name;
}

// Keep stored keys stable so historical activities retain their identity.
export function isContactChannel(value: unknown): value is ContactChannel {
  return typeof value === "string" && CHANNEL_ORDER.includes(value as ContactChannel);
}

export function channelSupportsAction(channel: ContactChannel | null, action: string) {
  if (!channel) return true;
  const callOnly = channel === "clinic_phone" || channel === "personal_phone";
  const writeOnly = ["clinic_email", "personal_email", "contact_form", "linkedin"].includes(channel);
  if (["CALL_ATTEMPTED", "CALL_CONNECTED", "VOICEMAIL"].includes(action)) return !writeOnly;
  if (["EMAIL_SENT", "FOLLOWUP_SENT", "EMAIL_REPLY"].includes(action)) return !callOnly;
  return true;
}

export function defaultPersonId(people: Pick<Person, "id" | "is_primary">[]) {
  const primary = people.filter((person) => person.is_primary);
  if (primary.length === 1) return primary[0].id;
  return people.length === 1 ? people[0].id : null;
}
