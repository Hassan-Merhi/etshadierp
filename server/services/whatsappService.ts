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

// ─── Shared upload helper (form-data package — the only reliable method) ──────

/**
 * Single shared implementation for Green API sendFileByUpload.
 * Uses the `form-data` npm package (not native Web FormData / Blob).
 * form.getBuffer() + form.getHeaders() is the correct pattern for node-fetch
 * and produces well-formed multipart/form-data that Green API accepts.
 */
async function sendGreenApiFileUpload({
  settings,
  chatId,
  buffer,
  fileName,
  caption,
  mimeType,
}: {
  settings: WaSettings;
  chatId:   string;
  buffer:   Buffer;
  fileName: string;
  caption:  string;
  mimeType: string;
}): Promise<{ success: boolean; error?: string }> {
  const url = baseUrl(settings.instanceId, settings.apiToken, "sendFileByUpload");

  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("chatId", chatId);
  if (caption) form.append("caption", caption);
  form.append("fileName", fileName);
  form.append("file", buffer, { filename: fileName, contentType: mimeType });

  const response = await fetch(url, {
    method:  "POST",
    headers: form.getHeaders(),
    body:    form.getBuffer(),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(
      "[WA upload] Green API error",
      response.status,
      body,
      { chatId, fileName, size: buffer.length },
    );
    return { success: false, error: `Green API ${response.status}: ${body}` };
  }

  const json = await response.json().catch(() => ({})) as any;
  console.log("[WA upload] Green API response", json, { chatId, fileName, size: buffer.length });
  return { success: true };
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

/**
 * Send a file directly to a WhatsApp chat via Green API's sendFileByUpload.
 * POS instance (id=2 with fallback to id=1).
 * Uses the shared sendGreenApiFileUpload helper (form-data package).
 */
export async function sendWhatsAppFileByUploadPos(
  chatId:      string,
  fileBuffer:  Buffer,
  fileName:    string,
  caption:     string,
  mimeType:    string = "application/pdf",
): Promise<{ success: boolean; error?: string }> {
  const settings = await getPosWaSettings();
  if (!settings?.instanceId || !settings?.apiToken) {
    return { success: false, error: "WhatsApp credentials not configured" };
  }
  if (!settings.enabled) {
    return { success: false, error: "WhatsApp sending is disabled" };
  }
  return sendGreenApiFileUpload({ settings, chatId, buffer: fileBuffer, fileName, caption, mimeType });
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

/**
 * Send a file via the POS WhatsApp instance (id=2 with fallback to id=1).
 * Uses the shared sendGreenApiFileUpload helper (form-data package).
 */
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
  return sendGreenApiFileUpload({ settings, chatId, buffer, fileName, caption, mimeType });
}

/**
 * Send a file to a specific chatId via the main WhatsApp instance (id=1).
 * Uses the shared sendGreenApiFileUpload helper (form-data package).
 */
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
  return sendGreenApiFileUpload({ settings, chatId, buffer, fileName, caption, mimeType });
}

// ─── Containers WhatsApp settings ────────────────────────────────────────────

export interface ContainersWaSettings {
  groupChatId:     string;
  scheduleEnabled: boolean;
  scheduleHour:    number;
  lastSentAt:      string | null;
  instanceId:      string;
  apiToken:        string;
  enabled:         boolean;
}

export async function getContainersWaSettings(): Promise<ContainersWaSettings | null> {
  const res = await pool.query(
    `SELECT instance_id, api_token, enabled,
            containers_wa_group_chat_id,
            containers_wa_schedule_enabled,
            containers_wa_schedule_hour,
            containers_wa_last_sent_at
     FROM whatsapp_settings WHERE id = 1`,
  );
  if (!res.rows?.length) return null;
  const r = res.rows[0];
  return {
    instanceId:      r.instance_id      ?? "",
    apiToken:        r.api_token        ?? "",
    enabled:         r.enabled          ?? false,
    groupChatId:     r.containers_wa_group_chat_id      ?? "",
    scheduleEnabled: r.containers_wa_schedule_enabled   ?? false,
    scheduleHour:    r.containers_wa_schedule_hour      ?? 8,
    lastSentAt:      r.containers_wa_last_sent_at
      ? new Date(r.containers_wa_last_sent_at).toISOString()
      : null,
  };
}

export async function updateContainersWaSettings(
  groupChatId:     string,
  scheduleEnabled: boolean,
  scheduleHour:    number,
): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_settings
     SET containers_wa_group_chat_id      = $1,
         containers_wa_schedule_enabled   = $2,
         containers_wa_schedule_hour      = $3
     WHERE id = 1`,
    [groupChatId, scheduleEnabled, scheduleHour],
  );
}

export async function markContainersWaSent(): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_settings SET containers_wa_last_sent_at = NOW() WHERE id = 1`,
  );
}

// ─── Agent Duty WhatsApp Settings ────────────────────────────────────────────

export async function getAgentDutyWaGroups(): Promise<Record<string, string>> {
  const res = await pool.query(
    `SELECT instance_id, api_token, enabled, agent_duty_wa_groups FROM whatsapp_settings WHERE id = 1`,
  );
  if (!res.rows?.length) return {};
  const r = res.rows[0];
  return {
    groups:     r.agent_duty_wa_groups ?? {},
    instanceId: r.instance_id ?? "",
    apiToken:   r.api_token ?? "",
    enabled:    r.enabled ?? false,
  } as any;
}

export async function getAgentDutyWaCredentials(): Promise<{ groups: Record<string, string>; instanceId: string; apiToken: string; enabled: boolean } | null> {
  const res = await pool.query(
    `SELECT instance_id, api_token, enabled, agent_duty_wa_groups FROM whatsapp_settings WHERE id = 1`,
  );
  if (!res.rows?.length) return null;
  const r = res.rows[0];
  return {
    groups:     r.agent_duty_wa_groups ?? {},
    instanceId: r.instance_id ?? "",
    apiToken:   r.api_token ?? "",
    enabled:    r.enabled ?? false,
  };
}

export async function updateAgentDutyWaGroups(groups: Record<string, string>): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_settings SET agent_duty_wa_groups = $1 WHERE id = 1`,
    [JSON.stringify(groups)],
  );
}

// ── Stock Transfer WhatsApp Settings (per-company) ──────────────────────────

export async function getCompanyTransferWaGroupChatId(companyId: number): Promise<string> {
  const res = await pool.query(
    `SELECT transfer_wa_group_chat_id FROM companies WHERE id = $1`,
    [companyId],
  );
  return res.rows[0]?.transfer_wa_group_chat_id ?? "";
}

export async function setCompanyTransferWaGroupChatId(companyId: number, groupChatId: string): Promise<void> {
  await pool.query(
    `UPDATE companies SET transfer_wa_group_chat_id = $1 WHERE id = $2`,
    [groupChatId || null, companyId],
  );
}

export async function getAllCompanyTransferWaSettings(): Promise<Array<{ companyId: number; companyName: string; groupChatId: string }>> {
  const res = await pool.query(
    `SELECT id, name, COALESCE(transfer_wa_group_chat_id, '') AS group_chat_id
     FROM companies WHERE active = true ORDER BY name`,
  );
  return res.rows.map((r: any) => ({
    companyId:   r.id,
    companyName: r.name,
    groupChatId: r.group_chat_id ?? "",
  }));
}

/**
 * Send a file to ALL active recipients via the main WhatsApp instance (id=1).
 * Uses the shared sendGreenApiFileUpload helper (form-data package).
 */
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

  const results = await Promise.allSettled(
    recipients.map(async (r): Promise<SendResult> => {
      const res = await sendGreenApiFileUpload({
        settings,
        chatId:   r.chatId,
        buffer,
        fileName,
        caption,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      if (!res.success) throw new Error(res.error ?? "Upload failed");
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
