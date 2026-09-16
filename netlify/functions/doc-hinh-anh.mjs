// Tool "doc_hinh_anh" cho Bé Gió (Subiz).
// Subiz tự gửi header subiz-conversation-id -> lấy hình khách gửi gần nhất -> Claude đọc.
import { getStore } from "@netlify/blobs";

const MODEL = "claude-haiku-4-5-20251001"; // muốn đọc kỹ hơn: "claude-sonnet-5"
const MAX_AGE_MS = 30 * 60 * 1000;          // chỉ dùng hình gửi trong 30 phút gần nhất
const MAX_BYTES = 4.5 * 1024 * 1024;        // giới hạn kích thước hình gửi cho Claude

const PROMPT = `Đây là hình khách hàng gửi cho shop bán quạt, thiết bị gia dụng và công nghiệp (quatgio.vn, giohang247.vn).
Trả lời NGẮN GỌN bằng tiếng Việt, chỉ ghi những gì THẤY RÕ trong hình:
- Loại sản phẩm, thương hiệu, tên/mã model
- Thông số nhìn thấy (công suất, sải cánh, dung tích...)
- Giá và website nếu là ảnh chụp màn hình
Không đoán mã model nếu không đọc được chữ. Nếu hình không phải sản phẩm (hóa đơn, chuyển khoản, sản phẩm bị lỗi, tin nhắn...) thì mô tả ngắn nội dung hình.`;

const reply = (text) =>
  new Response(JSON.stringify({ ket_qua: text }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.WEBHOOK_KEY || key !== process.env.WEBHOOK_KEY) {
    return new Response("forbidden", { status: 403 });
  }

  const convId = req.headers.get("subiz-conversation-id");
  if (!convId) return reply("Không xác định được hội thoại. Hãy xin khách tên hoặc link sản phẩm.");

  let cauHoi = "";
  try {
    const body = await req.json();
    cauHoi = String(body?.cau_hoi || "").slice(0, 300);
  } catch {}

  const store = getStore({ name: "anh-khach", consistency: "strong" });
  let rec = await store.get(convId, { type: "json" });
  if (!rec) { // phòng khi webhook tới chậm hơn tool vài giây
    await sleep(2500);
    rec = await store.get(convId, { type: "json" });
  }

  const img = rec?.images?.at(-1);
  if (!img || Date.now() - rec.updated > MAX_AGE_MS) {
    return reply("Khách chưa gửi hình nào gần đây. Hãy xin khách tên, mã hoặc link sản phẩm.");
  }

  // Đã đọc hình này rồi thì trả kết quả cũ, không tốn thêm phí
  if (rec.cache?.url === img.url) return reply(rec.cache.text);

  try {
    const imgRes = await fetch(img.url);
    if (!imgRes.ok) throw new Error("Không tải được hình: " + imgRes.status);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return reply("Hình khách gửi quá lớn, không đọc được. Hãy xin khách tên, mã hoặc link sản phẩm.");
    }
    let mediaType = (imgRes.headers.get("content-type") || "image/png").split(";")[0];
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType)) {
      mediaType = "image/jpeg";
    }

    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } },
            { type: "text", text: PROMPT + (cauHoi ? `\n\nKhách hỏi kèm: "${cauHoi}"` : "") },
          ],
        }],
      }),
    });
    const data = await ai.json();
    if (!ai.ok) throw new Error(data?.error?.message || "Lỗi Claude API");

    const text = (data.content || []).map((c) => c.text || "").join("\n").trim()
      || "Không đọc được nội dung hình.";

    rec.cache = { url: img.url, text };
    await store.setJSON(convId, rec);
    return reply("Nội dung hình khách gửi: " + text);
  } catch (err) {
    console.error(err);
    return reply("Hiện chưa đọc được hình. Hãy xin khách tên, mã hoặc link sản phẩm.");
  }
};

export const config = { path: "/api/doc-hinh-anh" };
