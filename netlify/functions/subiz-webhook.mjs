// Nhận webhook sự kiện từ Subiz (webhook cấp tài khoản hoặc webhook Nhân viên AI).
// Tự dò trong dữ liệu: tin nhắn của khách có hình -> lưu link hình theo mã hội thoại.
import { getStore } from "@netlify/blobs";

// Tìm mọi "tin nhắn" trong payload, bất kể cấu trúc lồng nhau thế nào
function findMessages(node, found = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return found;
  if (Array.isArray(node)) {
    for (const x of node) findMessages(x, found, depth + 1);
    return found;
  }
  const msg = node.data?.message || node.message;
  if (msg && typeof msg === "object" && Array.isArray(msg.attachments)) {
    found.push({
      convId: msg.conversation_id || node.conversation_id || node.conversation?.id,
      byType: node.by?.type,
      created: node.created || Date.now(),
      attachments: msg.attachments,
    });
  }
  for (const v of Object.values(node)) findMessages(v, found, depth + 1);
  return found;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.WEBHOOK_KEY || key !== process.env.WEBHOOK_KEY) {
    return new Response("forbidden", { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return new Response("ok");

  const messages = findMessages(body);
  const store = getStore("anh-khach");
  const seen = new Set();
  let saved = 0;

  for (const m of messages) {
    if (!m.convId) continue;
    if (m.byType && m.byType !== "user") continue; // chỉ lấy hình do khách gửi
    const imgs = m.attachments.filter(
      (a) => a?.url && String(a.mimetype || a.type || "").startsWith("image")
    );
    if (!imgs.length) continue;

    const rec = (await store.get(m.convId, { type: "json" })) || { images: [] };
    for (const a of imgs) {
      if (seen.has(a.url) || rec.images.some((i) => i.url === a.url)) continue;
      seen.add(a.url);
      rec.images.push({ url: a.url, size: a.size || 0, at: m.created });
      saved++;
    }
    rec.images = rec.images.slice(-3);
    rec.updated = Date.now();
    await store.setJSON(m.convId, rec);
  }

  // Log ngắn để kiểm tra (không ghi nội dung tin nhắn của khách)
  console.log("webhook", {
    keys: Object.keys(body).slice(0, 10),
    type: body.type || body.event || body.event_type || null,
    messages: messages.length,
    imagesSaved: saved,
  });

  return new Response("ok");
};

export const config = { path: "/api/subiz-webhook" };
