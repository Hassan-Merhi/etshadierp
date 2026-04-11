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

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
  });

  const companiesList = companyNames.map(n => `• ${n}`).join("\n");
  const subject = `Daily Export — ${dateLabel}`;
  const text = `Hello,

Please find attached the daily full data export for ${dateLabel}.

Companies included:
${companiesList}

This export contains all accounts, transactions, inventory, payroll, containers, and operational data for each company.

Generated automatically at ${new Date().toUTCString()}.

— ERP System`;

  try {
    await transporter.sendMail({
      from: `"ERP System" <${settings.gmailUser}>`,
      to: recipients.join(", "),
      subject,
      text,
      attachments: [
        {
          filename: `DailyExport_${dateLabel}.zip`,
          content: zipBuffer,
          contentType: "application/zip",
        },
      ],
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
