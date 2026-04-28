/**
 * Green API (free tier) WhatsApp service.
 * Supports individual numbers and group chats.
 *
 * Chat ID formats:
 *   Individual : 243XXXXXXXXX@c.us   (country code + number, no +)
 *   Group      : 120363XXXX@g.us     (obtained from Green API getChats)
 */

import { pool } from "../db";

export interface WaSettings {
  instanceId: string;
  apiToken:   string;
  enabled:    boolean;
  monthlyAutoSend:    boolean;
  dailyAutoSend:      boolean;
  dailyRecipientId:   number | null;
}

export interface WaRecipient {
  id:       number;
  chatId:   string;
  name:     string;
  isGroup:  boolean;
  active:   boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function baseUrl(instanceId: string, apiToken: string, method: string): string {
  return `https://api.green-api.com/waInstance${instanceId}/${method}/${apiToken}`;
}

/** Normalise a plain phone number to chatId format (243XXXXXXXX → 243XXXXXXXX@c.us) */
export function normaliseChatId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return trimmed; // already formatted (group or individual)
  const digits = trimmed.replace(/\D/g, "");
  return `${digits}@c.us`;
}

// ─── DB reads ─────────────────────────────────────────────────────────────────

export async function getWaSettings(): Promise<WaSettings | null> {
  return getWaSettingsById(1);
}

export async function getWaSettingsById(id: number): Promise<WaSettings | null> {
  const res = await pool.query(
    "SELECT instance_id, api_token, enabled, monthly_auto_send, daily_auto_send, daily_recipient_id FROM whatsapp_settings WHERE id = $1",
    [id],
  );
  if (!res.rows?.length) return null;
  const r = res.rows[0];
  return {
    instanceId:       r.instance_id ?? "",
    apiToken:         r.api_token   ?? "",
    enabled:          r.enabled     ?? false,
    monthlyAutoSend:  r.monthly_auto_send  ?? false,
    dailyAutoSend:    r.daily_auto_send    ?? false,
    dailyRecipientId: r.daily_recipient_id ?? null,
  };
}

export async function getActiveRecipients(): Promise<WaRecipient[]> {
  const res = await pool.query(
    "SELECT id, chat_id, name, is_group, active FROM whatsapp_recipients WHERE active = true ORDER BY id",
  );
  return (res.rows || []).map((r) => ({
    id:      r.id,
    chatId:  r.chat_id,
    name:    r.name,
    isGroup: r.is_group,
    active:  r.active,
  }));
}

// ─── Green API: fetch chats so the user can pick a group ──────────────────────

export interface GreenChat {
  id:   string;   // e.g. 120363198765432@g.us
  name: string;
  type: "group" | "contact" | string;
}

export async function fetchGreenApiChats(
  instanceId: string,
  apiToken: string,
): Promise<GreenChat[]> {
  const url      = baseUrl(instanceId, apiToken, "getChats");
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Green API getChats error ${response.status}: ${body}`);
  }
  const data = await response.json() as any[];
  return data
    .filter((c) => c && c.id)
    .map((c) => ({
      id:   c.id,
      name: c.name || c.id,
      type: c.type || (String(c.id).endsWith("@g.us") ? "group" : "contact"),
    }));
}

// ─── Send file ────────────────────────────────────────────────────────────────

interface SendResult {
  chatId:  string;
  success: boolean;
  error?:  string;
}

/** Resolve the active WhatsApp settings for POS sending: use instance 2 if configured, else instance 1.
 *  When falling back to instance 1 we override enabled=true because POS sends are always manual —
 *  the main instance's enabled flag controls scheduled factory reports, not POS. */
export async function getPosWaSettings(): Promise<WaSettings | null> {
  const pos = await getWaSettingsById(2);
  if (pos?.instanceId && pos?.apiToken) return pos;
  const main = await getWaSettingsById(1);
  if (main?.instanceId && main?.apiToken) return { ...main, enabled: true };
  return null;
}

/** Send a plain text message to one specific chatId */
export async function sendWhatsAppTextToChatId(
  chatId:  string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = await getWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, error: "WhatsApp credentials not configured" };
  }
  if (!settings.enabled) {
    return { success: false, error: "WhatsApp sending is disabled" };
  }

  const url = baseUrl(settings.instanceId, settings.apiToken, "sendMessage");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: `Green API ${response.status}: ${body}` };
  }
  return { success: true };
}

/** Send a file by URL via the POS instance (id=2 with fallback to id=1).
 *  Uses Green API's sendFileByUrl — more reliable than multipart upload. */
export async function sendWhatsAppFileByUrlToChatIdPos(
  chatId:   string,
  fileUrl:  string,
  fileName: string,
  caption:  string,
): Promise<{ success: boolean; error?: string }> {
  const settings = await getPosWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, error: "WhatsApp credentials not configured" };
  }
  if (!settings.enabled) {
    return { success: false, error: "WhatsApp sending is disabled" };
  }

  const url = baseUrl(settings.instanceId, settings.apiToken, "sendFileByUrl");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, urlFile: fileUrl, fileName, caption }),
  });
  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: `Green API ${response.status}: ${body}` };
  }
  return { success: true };
}

/** Send a plain text message via the POS instance (id=2 with fallback to id=1) */
export async function sendWhatsAppTextToChatIdPos(
  chatId:  string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = await getPosWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, error: "WhatsApp credentials not configured" };
  }
  if (!settings.enabled) {
    return { success: false, error: "WhatsApp sending is disabled" };
  }

  const url = baseUrl(settings.instanceId, settings.apiToken, "sendMessage");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: `Green API ${response.status}: ${body}` };
  }
  return { success: true };
}

/** Send a plain text message to ALL active recipients */
export async function sendWhatsAppText(
  message: string,
): Promise<{ success: boolean; sent: number; failed: number; errors: string[] }> {
  const settings = await getWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, sent: 0, failed: 0, errors: ["WhatsApp credentials not configured"] };
  }
  if (!settings.enabled) {
    return { success: false, sent: 0, failed: 0, errors: ["WhatsApp sending is disabled"] };
  }

  const recipients = await getActiveRecipients();
  if (!recipients.length) {
    return { success: false, sent: 0, failed: 0, errors: ["No active WhatsApp recipients"] };
  }

  const url = baseUrl(settings.instanceId, settings.apiToken, "sendMessage");

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of recipients) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: r.chatId, message }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Green API ${response.status}: ${body}`);
      }
      sent++;
    } catch (e: any) {
      failed++;
      errors.push(e.message ?? "Unknown error");
      console.error("[WhatsApp] Text send failed:", e);
    }
  }

  return { success: sent > 0, sent, failed, errors };
}

/** Send a file via the POS WhatsApp instance (id=2 with fallback to id=1) */
export async function sendWhatsAppFileToChatIdPos(
  chatId:   string,
  buffer:   Buffer,
  fileName: string,
  caption:  string,
  mimeType = "application/pdf",
): Promise<{ success: boolean; error?: string }> {
  const settings = await getPosWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, error: "WhatsApp credentials not configured" };
  }
  if (!settings.enabled) {
    return { success: false, error: "WhatsApp sending is disabled" };
  }

  const url  = baseUrl(settings.instanceId, settings.apiToken, "sendFileByUpload");
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("chatId",   chatId);
  form.append("file",     blob, fileName);
  form.append("fileName", fileName);
  if (caption) form.append("caption", caption);

  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: `Green API ${response.status}: ${body}` };
  }
  return { success: true };
}

export async function sendWhatsAppFileToChatId(
  chatId:   string,
  buffer:   Buffer,
  fileName: string,
  caption:  string,
  mimeType = "application/octet-stream",
): Promise<{ success: boolean; error?: string }> {
  const settings = await getWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, error: "WhatsApp credentials not configured" };
  }
  if (!settings.enabled) {
    return { success: false, error: "WhatsApp sending is disabled" };
  }

  const url  = baseUrl(settings.instanceId, settings.apiToken, "sendFileByUpload");
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("chatId",   chatId);
  form.append("file",     blob, fileName);
  form.append("fileName", fileName);
  if (caption) form.append("caption", caption);

  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: `Green API ${response.status}: ${body}` };
  }
  return { success: true };
}

export async function sendWhatsAppFile(
  buffer:   Buffer,
  fileName: string,
  caption:  string,
): Promise<{ success: boolean; sent: number; failed: number; errors: string[] }> {
  const settings = await getWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, sent: 0, failed: 0, errors: ["WhatsApp credentials not configured"] };
  }
  if (!settings.enabled) {
    return { success: false, sent: 0, failed: 0, errors: ["WhatsApp sending is disabled"] };
  }

  const recipients = await getActiveRecipients();
  if (!recipients.length) {
    return { success: false, sent: 0, failed: 0, errors: ["No active WhatsApp recipients"] };
  }

  const url = baseUrl(settings.instanceId, settings.apiToken, "sendFileByUpload");

  const results = await Promise.allSettled(
    recipients.map(async (r): Promise<SendResult> => {
      const form = new FormData();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      form.append("chatId",   r.chatId);
      form.append("file",     blob, fileName);
      form.append("fileName", fileName);
      if (caption) form.append("caption", caption);

      const response = await fetch(url, { method: "POST", body: form });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Green API ${response.status}: ${body}`);
      }
      return { chatId: r.chatId, success: true };
    }),
  );

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      sent++;
    } else {
      failed++;
      errors.push((r as PromiseRejectedResult).reason?.message ?? "Unknown error");
      console.error("[WhatsApp] Send failed:", (r as PromiseRejectedResult).reason);
    }
  }

  return { success: sent > 0, sent, failed, errors };
}
