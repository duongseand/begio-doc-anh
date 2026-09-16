// Nhận webhook từ Nhân viên AI Subiz.
// Nếu tin nhắn mới nhất của khách có hình -> lưu link hình theo mã hội thoại.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // Bảo vệ: URL webhook phải có ?key=... đúng với biến môi trường WEBHOOK_KEY
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.WEBHOOK_KEY || key !== process.env.WEBHOOK_KEY) {
    return new Response("forbidden", { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const conv = body?.conversation;
  const msg = conv?.last_message_sent;
  const attachments = msg?.data?.message?.attachments || [];

  const images = attachments.filter(
    (a) => a?.url && String(a.mimetype || "").startsWith("image/")
  );

  if (conv?.id && msg?.by?.type === "user" && images.length) {
    const store = getStore("anh-khach");
    const rec = (await store.get(conv.id, { type: "json" })) || { images: [] };
    for (const a of images) {
      rec.images.push({ url: a.url, size: a.size || 0, at: msg.created || Date.now() });
    }
    rec.images = rec.images.slice(-3); // chỉ giữ 3 hình gần nhất
    rec.updated = Date.now();
    await store.setJSON(conv.id, rec);
  }

  return new Response("ok");
};

export const config = { path: "/api/subiz-webhook" };
