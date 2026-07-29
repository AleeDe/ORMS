"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { renderPreview } from "@/lib/sequences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Plus } from "lucide-react";

// Subject + body editor for a sequence step.
//
// Nobody should have to remember or type "{{first_name}}" — the fields are
// buttons that insert at the cursor, and a preview shows the result filled in
// with a real lead so the template can be checked before it is ever sent.

type Lead = {
  business_name: string | null;
  website: string | null;
  address: string | null;
  custom_fields: Record<string, unknown> | null;
  decision_makers?: { name: string | null; role: string | null }[];
};

const BUILT_IN = [
  { token: "first_name", label: "First name", sample: "Sarah" },
  { token: "business_name", label: "Business name", sample: "Lancashire Dental" },
  { token: "full_name", label: "Full name", sample: "Sarah Khan" },
  { token: "role", label: "Role", sample: "Practice Manager" },
  { token: "website", label: "Website", sample: "example.com" },
  { token: "address", label: "Address", sample: "12 High St" },
];

export function MergeFieldInput({
  subject, body, onSubjectChange, onBodyChange,
}: {
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  const supabase = createClient();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Which box the cursor was last in, so a field lands where the user expects.
  const [focused, setFocused] = useState<"subject" | "body">("body");
  const [showPreview, setShowPreview] = useState(false);

  // A real lead drives the preview, and its imported columns become fields —
  // every user's spreadsheet has different headers.
  const { data: lead } = useQuery({
    queryKey: ["merge-preview-lead"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("business_name, website, address, custom_fields, decision_makers(name, role)")
        .limit(1)
        .maybeSingle();
      return (data as Lead) ?? null;
    },
  });

  const customFields = Object.keys(lead?.custom_fields ?? {});

  function insert(token: string) {
    const wrapped = `{{${token}}}`;
    if (focused === "subject") {
      const el = subjectRef.current;
      const at = el?.selectionStart ?? subject.length;
      const next = subject.slice(0, at) + wrapped + subject.slice(el?.selectionEnd ?? at);
      onSubjectChange(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + wrapped.length, at + wrapped.length);
      });
    } else {
      const el = bodyRef.current;
      const at = el?.selectionStart ?? body.length;
      const next = body.slice(0, at) + wrapped + body.slice(el?.selectionEnd ?? at);
      onBodyChange(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + wrapped.length, at + wrapped.length);
      });
    }
  }

  const person = lead?.decision_makers?.[0] ?? null;
  const previewLead = lead ?? {
    business_name: "Lancashire Dental",
    website: "example.com",
    address: "12 High St",
    custom_fields: null,
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Subject</Label>
        <Input
          ref={subjectRef}
          placeholder="Quick question about {{business_name}}"
          value={subject}
          onFocus={() => setFocused("subject")}
          onChange={(e) => onSubjectChange(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Message</Label>
        <Textarea
          ref={bodyRef}
          rows={8}
          placeholder={"Hi {{first_name}},\n\nI came across {{business_name}} and…"}
          value={body}
          onFocus={() => setFocused("body")}
          onChange={(e) => onBodyChange(e.target.value)}
        />
      </div>

      {/* Click to insert — no typing of {{ }} required. */}
      <div className="rounded-md border bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-medium">
            Click to add a detail — it fills in per lead
          </p>
          <span className="text-xs text-muted-foreground">
            inserting into the <strong>{focused === "subject" ? "subject" : "message"}</strong>
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {BUILT_IN.map((f) => (
            <Button
              key={f.token}
              type="button" size="sm" variant="outline"
              className="h-7 text-xs"
              onClick={() => insert(f.token)}
            >
              <Plus className="h-3 w-3 mr-1" /> {f.label}
            </Button>
          ))}
        </div>

        {customFields.length > 0 && (
          <div className="space-y-1 pt-1">
            <p className="text-xs text-muted-foreground">From your imported columns:</p>
            <div className="flex flex-wrap gap-1.5">
              {customFields.map((k) => (
                <Button
                  key={k}
                  type="button" size="sm" variant="outline"
                  className="h-7 text-xs"
                  onClick={() => insert(k)}
                >
                  <Plus className="h-3 w-3 mr-1" /> {k}
                </Button>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          <strong>First name</strong> becomes &quot;there&quot; when a lead has no contact name, so
          &quot;Hi there,&quot; still reads properly. Anything that can&apos;t be filled in is
          removed — a lead never sees <code>{"{{ }}"}</code>.
        </p>
      </div>

      <div>
        <Button
          type="button" size="sm" variant="ghost"
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
          {showPreview ? "Hide preview" : "Preview with a real lead"}
        </Button>

        {showPreview && (
          <div className="mt-2 rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {lead?.business_name ?? "Example lead"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                this is how it will look
              </span>
            </div>
            <p className="text-sm font-medium">
              {renderPreview(subject, previewLead, person) || (
                <span className="text-muted-foreground italic">no subject yet</span>
              )}
            </p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {renderPreview(body, previewLead, person) || (
                <span className="italic">no message yet</span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
