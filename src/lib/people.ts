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
  clinic_phone: "Clinic number",
  personal_email: "Personal email",
  clinic_email: "Clinic email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  contact_form: "Contact form",
  in_person: "In person",
  other: "Other",
};

export const CHANNEL_ORDER: ContactChannel[] = [
  "personal_phone", "clinic_phone", "personal_email", "clinic_email",
  "whatsapp", "linkedin", "contact_form", "in_person", "other",
];

export function personLabel(p: Pick<Person, "name" | "role">) {
  return p.role ? `${p.name} — ${p.role}` : p.name;
}
