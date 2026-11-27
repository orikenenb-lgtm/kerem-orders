"use client";

// "תמונת המוצר" inside the item editor. Rivhit's API cannot store photos, so
// an uploaded photo lives on the site (Supabase Storage, bucket
// product-photos) and the manager chooses whether it REPLACES Rivhit's photo
// or is shown ONLY while Rivhit has none. supabase/2026-11-product-photos.sql
// keeps that choice applied across the 15-minute Rivhit sync.
//
// The file is re-encoded in the browser before upload: upright (EXIF applied),
// at most 1200 px on the long side, JPEG, under 2 MB. Location data and every
// other EXIF field are dropped by the re-encode.

import { useEffect, useRef, useState } from "react";
import ProductImage from "../../../components/ProductImage";
import { tokens } from "../../../../lib/ui";
import { rpcErrorText } from "../../../../lib/inventory";
import { fetchItemPhoto, removeProductPhoto, setProductPhoto, uploadProductPhoto, type ItemPhotoState } from "./api";
import { labelStyle, msgStyle, note, secondaryBtn, ERR } from "./styles";

const MAX_SIDE = 1200;
const MAX_BYTES = 2 * 1024 * 1024;

/** Upright, resized JPEG of the chosen file. null = not a readable image. */
async function toJpeg(file: File): Promise<Blob | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  for (const q of [0.85, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  return null;
}

export default function ItemPhoto({ productId, productName }: { productId: string; productName: string }) {
  const [state, setState] = useState<ItemPhotoState | null>(null);
  const [available, setAvailable] = useState(true);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    let live = true;
    void fetchItemPhoto(productId).then((s) => {
      if (!live) return;
      if (!s) { setAvailable(false); return; }
      setState(s);
      if (s.url) setReplace(s.replace_rivhit);
    });
    return () => { live = false; };
  }, [productId]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!available) return null; // migration not applied: nothing to show

  const onPick = async (f: File | undefined) => {
    setMsg(null);
    if (!f) return;
    setBusy(true);
    const b = await toJpeg(f);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!b) { setMsg({ ok: false, text: "לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת (JPG או PNG)." }); return; }
    if (preview) URL.revokeObjectURL(preview);
    setBlob(b);
    setPreview(URL.createObjectURL(b));
  };

  // Saving without a new file just changes the mode of the photo already uploaded.
  const modeOnly = !blob && !!state?.url && replace !== state.replace_rivhit;
  const canSave = !!blob || modeOnly;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setMsg(null);
    let url = state?.url ?? "";
    if (blob) {
      const up = await uploadProductPhoto(productId, blob);
      if (!up.ok) {
        if (!mountedRef.current) return;
        setBusy(false);
        setMsg({ ok: false, text: "ההעלאה נכשלה. בדקו את החיבור ונסו שוב. שום דבר לא השתנה." });
        return;
      }
      url = up.data;
    }
    const r = await setProductPhoto(productId, url, replace);
    const s = await fetchItemPhoto(productId);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: rpcErrorText(r.err) }); return; }
    if (s) setState(s);
    setBlob(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    const shownIsUpload = s?.shown_picture_link === s?.url;
    setMsg({ ok: true, text: shownIsUpload
      ? "התמונה נשמרה ומופיעה עכשיו באתר."
      : "התמונה נשמרה. כרגע מוצגת התמונה מרווחית, כי בחרתם ״רק אם אין תמונה ברווחית״." });
  };

  const remove = async () => {
    if (busy || !state?.url) return;
    setBusy(true);
    setMsg(null);
    const r = await removeProductPhoto(productId);
    const s = await fetchItemPhoto(productId);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: rpcErrorText(r.err) }); return; }
    if (s) setState(s);
    setMsg({ ok: true, text: s?.rivhit_picture_link ? "התמונה שהועלתה הוסרה. מוצגת שוב התמונה מרווחית." : "התמונה שהועלתה הוסרה. למוצר אין תמונה ברווחית." });
  };

  const shown = state?.shown_picture_link || "";
  const source = !shown ? "אין תמונה" : state?.url && shown === state.url ? "תמונה שהועלתה באתר" : "תמונה מרווחית";

  return (
    <section aria-label="תמונת המוצר" style={{ display: "grid", gap: "0.6rem", borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "0.8rem" }}>
      <strong style={{ fontFamily: tokens.assistant }}>תמונת המוצר</strong>
      <p style={note}>התמונה נשמרת באתר בלבד — רווחית לא מאפשרת להעלות תמונות דרך החיבור.</p>
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 96, height: 96, borderRadius: 12, overflow: "hidden", background: "#f4f4f5", flex: "0 0 auto" }}>
          {preview
            ? <img src={preview} alt={`תמונה חדשה של ${productName}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <ProductImage pictureLink={shown} name={productName} width={480} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />}
        </div>
        <span data-testid="photo-source" style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body }}>
          {preview ? "תצוגה מקדימה — עוד לא נשמרה" : `מוצג עכשיו: ${source}`}
        </span>
      </div>

      <label style={labelStyle}>בחירת תמונה (מצלמה או גלריה)
        <input ref={fileRef} type="file" accept="image/*" disabled={busy} onChange={(e) => void onPick(e.target.files?.[0])} />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "0.3rem" }} disabled={busy}>
        <legend style={{ ...labelStyle, marginBottom: "0.2rem" }}>מתי להציג את התמונה שהועלתה</legend>
        <label style={{ fontFamily: tokens.assistant, display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input type="radio" name={`photo-mode-${productId}`} checked={replace} onChange={() => setReplace(true)} />
          תמיד — להחליף את התמונה מרווחית
        </label>
        <label style={{ fontFamily: tokens.assistant, display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input type="radio" name={`photo-mode-${productId}`} checked={!replace} onChange={() => setReplace(false)} />
          רק אם אין תמונה ברווחית
        </label>
      </fieldset>

      {msg && <p role={msg.ok ? "status" : "alert"} style={msgStyle(msg.ok)}>{msg.text}</p>}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" onClick={() => void save()} disabled={!canSave || busy}
          style={{ ...secondaryBtn, fontWeight: 700, opacity: !canSave || busy ? 0.55 : 1 }}>
          {busy ? "שומר…" : "שמירת התמונה"}
        </button>
        {state?.url && !preview && (
          <button type="button" onClick={() => void remove()} disabled={busy} style={{ ...secondaryBtn, color: ERR }}>
            הסרת התמונה שהועלתה
          </button>
        )}
      </div>
    </section>
  );
}
