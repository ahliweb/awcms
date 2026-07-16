/**
 * Default system template copy (Issue #498) — English + Indonesian, one
 * entry per base category (`email-template-categories.ts`). Satisfies the
 * issue's "default system templates are seeded or documented" acceptance
 * criterion as data; `application/email-template-directory.ts`'s
 * `seedDefaultEmailTemplates` is what actually inserts these for a given
 * tenant (not run automatically — no migration can INSERT per-tenant rows
 * for tenants that don't exist yet; an operator or the setup flow calls it
 * explicitly, e.g. via `bun run email:templates:seed-defaults`).
 *
 * `derived.transactional` has no default here — it's an extension pattern
 * for derived apps to define their own copy, not a base default.
 */
import type { LocalizedTemplateTextInput } from "./email-template-validation";

export type DefaultEmailTemplate = {
  templateKey: string;
  name: string;
  subjectTemplate: LocalizedTemplateTextInput;
  textBodyTemplate: LocalizedTemplateTextInput;
};

export const DEFAULT_EMAIL_TEMPLATES: readonly DefaultEmailTemplate[] = [
  {
    templateKey: "auth.password_reset",
    name: "Password reset",
    subjectTemplate: {
      en: "Reset your password",
      id: "Atur ulang kata sandi Anda"
    },
    textBodyTemplate: {
      en: "Hi {{userName}},\n\nWe received a request to reset your password. Click the link below to choose a new one. This link expires in {{expiresInMinutes}} minutes.\n\n{{resetUrl}}\n\nIf you did not request this, you can safely ignore this email.",
      id: "Halo {{userName}},\n\nKami menerima permintaan untuk mengatur ulang kata sandi Anda. Klik tautan di bawah untuk memilih kata sandi baru. Tautan ini kedaluwarsa dalam {{expiresInMinutes}} menit.\n\n{{resetUrl}}\n\nJika Anda tidak meminta ini, abaikan saja email ini."
    }
  },
  {
    templateKey: "system.announcement",
    name: "System announcement",
    subjectTemplate: {
      en: "{{title}}",
      id: "{{title}}"
    },
    textBodyTemplate: {
      en: "Hi {{userName}},\n\n{{body}}\n\n{{actionUrl}}",
      id: "Halo {{userName}},\n\n{{body}}\n\n{{actionUrl}}"
    }
  },
  {
    templateKey: "system.security_notice",
    name: "Security notice",
    subjectTemplate: {
      en: "Security notice for your account",
      id: "Pemberitahuan keamanan akun Anda"
    },
    textBodyTemplate: {
      en: "Hi {{userName}},\n\nWe noticed the following on your account: {{eventDescription}}\n\nTime: {{occurredAt}}\nIP address: {{ipAddress}}\n\nIf this wasn't you, please contact your administrator immediately.",
      id: "Halo {{userName}},\n\nKami mendeteksi hal berikut pada akun Anda: {{eventDescription}}\n\nWaktu: {{occurredAt}}\nAlamat IP: {{ipAddress}}\n\nJika ini bukan Anda, segera hubungi administrator Anda."
    }
  },
  {
    templateKey: "system.maintenance",
    name: "Scheduled maintenance",
    subjectTemplate: {
      en: "Scheduled maintenance: {{maintenanceWindow}}",
      id: "Pemeliharaan terjadwal: {{maintenanceWindow}}"
    },
    textBodyTemplate: {
      en: "Hi {{userName}},\n\nWe will be performing scheduled maintenance during {{maintenanceWindow}} (expected duration: {{expectedDuration}}).\n\n{{impactDescription}}\n\nWe apologize for any inconvenience.",
      id: "Halo {{userName}},\n\nKami akan melakukan pemeliharaan terjadwal pada {{maintenanceWindow}} (perkiraan durasi: {{expectedDuration}}).\n\n{{impactDescription}}\n\nMohon maaf atas ketidaknyamanannya."
    }
  },
  {
    templateKey: "workflow.task_assigned",
    name: "Task assigned",
    subjectTemplate: {
      en: "New task assigned: {{taskTitle}}",
      id: "Tugas baru diberikan: {{taskTitle}}"
    },
    textBodyTemplate: {
      en: "Hi {{userName}},\n\n{{assignedBy}} assigned you a task: {{taskTitle}}\nDue: {{dueAt}}\n\n{{taskUrl}}",
      id: "Halo {{userName}},\n\n{{assignedBy}} memberikan Anda tugas: {{taskTitle}}\nTenggat: {{dueAt}}\n\n{{taskUrl}}"
    }
  },
  {
    templateKey: "workflow.decision_required",
    name: "Decision required",
    subjectTemplate: {
      en: "Your decision is needed: {{workflowName}}",
      id: "Keputusan Anda diperlukan: {{workflowName}}"
    },
    textBodyTemplate: {
      en: "Hi {{userName}},\n\n{{requestedBy}} requested your decision on: {{workflowName}}\n\n{{decisionUrl}}",
      id: "Halo {{userName}},\n\n{{requestedBy}} meminta keputusan Anda pada: {{workflowName}}\n\n{{decisionUrl}}"
    }
  }
];
