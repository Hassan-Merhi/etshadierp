import nodemailer from "nodemailer";
import { pool } from "../db";

export interface EmailSettings {
  gmailUser: string;
  gmailAppPassword: string;
}

async function getSettings(): Promise<EmailSettings | null> {
  try {
    const res = await pool.query(`SELECT gmail_user, gmail_app_password FROM export_settings WHERE id = 1`);
    if (!res.rows || res.rows.length === 0) return null;
    const row = res.rows[0];
    if (!row.gmail_user || !row.gmail_app_password) return null;
    return { gmailUser: row.gmail_user, gmailAppPassword: row.gmail_app_password };
  } catch {
    return null;
  }
}

async function getRecipients(): Promise<string[]> {
  try {
    const res = await pool.query(`SELECT email FROM export_recipients WHERE active = true ORDER BY id`);
    return (res.rows || []).map((r: any) => r.email).filter(Boolean);
  } catch {
    return [];
  }
}

export async function sendExportEmail(
  zipBuffer: Buffer,
  dateLabel: string,
  companyNames: string[]
): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  if (!settings) return { success: false, error: "Email not configured — no Gmail credentials found." };

  const recipients = await getRecipients();
  if (recipients.length === 0) return { success: false, error: "No email recipients configured." };

  // Gmail attachment limit is 25MB — warn at 20MB
  const sizeMB = zipBuffer.length / 1024 / 1024;
  if (sizeMB > 24) {
    return {
      success: false,
      error: `ZIP file is ${sizeMB.toFixed(1)} MB — exceeds Gmail's 25 MB attachment limit. Split the export by date range or contact your admin.`,
    };
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    tls: { rejectUnauthorized: true },
  });

  // Verify the connection before sending
  try {
    await transporter.verify();
  } catch (verifyErr: any) {
    return {
      success: false,
      error: `Gmail authentication failed: ${verifyErr.message}. Check your Gmail address and App Password in settings.`,
    };
  }

  const companiesList = companyNames.map((n) => `  - ${n}`).join("\n");
  const subject = `[ERP Export] Daily Data Export — ${dateLabel}`;
  const text = `Hello,

Please find the attached daily full data export for ${dateLabel} (${sizeMB.toFixed(1)} MB).

Companies included:
${companiesList}

This export contains all accounts, transactions, inventory, payroll, containers, factory operations, and all other operational data for each company.

Note: If you did not receive the attachment, it may have been filtered by your email provider or caught by a spam filter — please check your spam/junk folder.

Generated automatically at ${new Date().toUTCString()}.

— ERP System`;

  try {
    // Send one email per recipient to avoid group disclosure and improve deliverability
    const results = await Promise.allSettled(
      recipients.map((recipient) =>
        transporter.sendMail({
          from: `"ERP Daily Export" <${settings.gmailUser}>`,
          to: recipient,
          subject,
          text,
          attachments: [
            {
              filename: `DailyExport_${dateLabel}.zip`,
              content: zipBuffer,
              contentType: "application/zip",
            },
          ],
        })
      )
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === results.length) {
      const firstError = (failed[0] as PromiseRejectedResult).reason;
      return { success: false, error: firstError?.message || "All emails failed to send." };
    }
    if (failed.length > 0) {
      console.warn(`[EmailService] ${failed.length}/${results.length} emails failed to deliver.`);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
