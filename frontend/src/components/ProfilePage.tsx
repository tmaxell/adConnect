/**
 * ProfilePage — durable business context (company, industry, tone, default product).
 * Set once; pre-fills the campaign brief so the user doesn't retype it every time,
 * and gives the Copilot consistent context for offers and creatives.
 */

import { useEffect, useState } from "react";
import { getProfile, putProfile } from "../api/chatApi";
import type { BusinessProfile } from "../types/campaign";

const EMPTY: BusinessProfile = {
  company_name: "", industry: "", website: "", tone: "", default_product: "", description: "",
};
const TONE_OPTIONS = ["Дружелюбный", "Деловой", "Продающий", "Премиальный", "Простой"];

export function ProfilePage() {
  const [form, setForm] = useState<BusinessProfile>(EMPTY);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    getProfile().then((p) => setForm({ ...EMPTY, ...p })).catch(() => {});
  }, []);

  const set = (k: keyof BusinessProfile, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setStatus("idle");
  };
  const save = async () => {
    setStatus("saving");
    try { await putProfile(form); setStatus("saved"); } catch { setStatus("idle"); }
  };

  return (
    <div className="ana">
      <div className="ana-header">
        <h1 className="ana-h1">Профиль компании</h1>
        <p className="ana-h1-sub">Заполните один раз — это предзаполнит бриф каждой кампании и задаст контекст для Copilot</p>
      </div>

      <div className="ana-card-box prof-form">
        <label className="prof-field">
          <span className="prof-label">Название компании</span>
          <input className="acw-input-edit" value={form.company_name ?? ""} placeholder="Напр.: FitLab"
            onChange={(e) => set("company_name", e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-label">Сфера / индустрия</span>
          <input className="acw-input-edit" value={form.industry ?? ""} placeholder="Напр.: фитнес, доставка еды"
            onChange={(e) => set("industry", e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-label">Сайт</span>
          <input className="acw-input-edit" value={form.website ?? ""} placeholder="https://"
            onChange={(e) => set("website", e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-label">Продукт по умолчанию</span>
          <input className="acw-input-edit" value={form.default_product ?? ""} placeholder="Что чаще всего рекламируете"
            onChange={(e) => set("default_product", e.target.value)} />
        </label>
        <div className="prof-field">
          <span className="prof-label">Тон коммуникации</span>
          <div className="acw-tone">
            {TONE_OPTIONS.map((t) => (
              <button key={t} type="button" className={`acw-tone-chip${form.tone === t ? " on" : ""}`}
                onClick={() => set("tone", t)}>{t}</button>
            ))}
          </div>
        </div>
        <label className="prof-field prof-field-wide">
          <span className="prof-label">О компании (для Copilot)</span>
          <textarea className="acw-textarea-edit" value={form.description ?? ""}
            placeholder="Пара предложений: чем занимаетесь, для кого, чем отличаетесь."
            onChange={(e) => set("description", e.target.value)} />
        </label>

        <div className="prof-actions">
          <button type="button" className="acw-btn acw-btn-primary" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Сохраняю…" : status === "saved" ? "✓ Сохранено" : "Сохранить профиль"}
          </button>
        </div>
      </div>
    </div>
  );
}
