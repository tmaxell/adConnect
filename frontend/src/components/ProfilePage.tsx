/**
 * ProfilePage — durable business context (company, industry, tone, default product).
 * Set once; pre-fills the campaign brief so the user doesn't retype it every time,
 * and gives the Copilot consistent context for offers and creatives.
 */

import { useEffect, useState } from "react";
import { getProfile, putProfile } from "../api/chatApi";
import type { BusinessProfile } from "../types/campaign";
import { t as tr, useLang } from "../i18n";

const EMPTY: BusinessProfile = {
  company_name: "", industry: "", website: "", tone: "", default_product: "", description: "",
};
// `id` is the stored value (kept language-stable); `label` is display-only.
const TONE_OPTIONS: Array<{ id: string; label: () => string }> = [
  { id: "Дружелюбный", label: () => tr("Дружелюбный", "Friendly") },
  { id: "Деловой", label: () => tr("Деловой", "Business") },
  { id: "Продающий", label: () => tr("Продающий", "Selling") },
  { id: "Премиальный", label: () => tr("Премиальный", "Premium") },
  { id: "Простой", label: () => tr("Простой", "Simple") },
];

export function ProfilePage() {
  const { t } = useLang();
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
        <h1 className="ana-h1">{t("Профиль компании", "Company profile")}</h1>
        <p className="ana-h1-sub">{t("Заполните один раз — это предзаполнит бриф каждой кампании и задаст контекст для Copilot", "Fill in once — it pre-fills every campaign brief and gives the Copilot consistent context")}</p>
      </div>

      <div className="ana-card-box prof-form">
        <label className="prof-field">
          <span className="prof-label">{t("Название компании", "Company name")}</span>
          <input className="acw-input-edit" value={form.company_name ?? ""} placeholder={t("Напр.: FitLab", "e.g. FitLab")}
            onChange={(e) => set("company_name", e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-label">{t("Сфера / индустрия", "Field / industry")}</span>
          <input className="acw-input-edit" value={form.industry ?? ""} placeholder={t("Напр.: фитнес, доставка еды", "e.g. fitness, food delivery")}
            onChange={(e) => set("industry", e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-label">{t("Сайт", "Website")}</span>
          <input className="acw-input-edit" value={form.website ?? ""} placeholder="https://"
            onChange={(e) => set("website", e.target.value)} />
        </label>
        <label className="prof-field">
          <span className="prof-label">{t("Продукт по умолчанию", "Default product")}</span>
          <input className="acw-input-edit" value={form.default_product ?? ""} placeholder={t("Что чаще всего рекламируете", "What you advertise most often")}
            onChange={(e) => set("default_product", e.target.value)} />
        </label>
        <div className="prof-field">
          <span className="prof-label">{t("Тон коммуникации", "Communication tone")}</span>
          <div className="acw-tone">
            {TONE_OPTIONS.map((opt) => (
              <button key={opt.id} type="button" className={`acw-tone-chip${form.tone === opt.id ? " on" : ""}`}
                onClick={() => set("tone", opt.id)}>{opt.label()}</button>
            ))}
          </div>
        </div>
        <label className="prof-field prof-field-wide">
          <span className="prof-label">{t("О компании (для Copilot)", "About the company (for Copilot)")}</span>
          <textarea className="acw-textarea-edit" value={form.description ?? ""}
            placeholder={t("Пара предложений: чем занимаетесь, для кого, чем отличаетесь.", "A couple of sentences: what you do, for whom, what makes you different.")}
            onChange={(e) => set("description", e.target.value)} />
        </label>

        <div className="prof-actions">
          <button type="button" className="acw-btn acw-btn-primary" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? t("Сохраняю…", "Saving…") : status === "saved" ? t("✓ Сохранено", "✓ Saved") : t("Сохранить профиль", "Save profile")}
          </button>
        </div>
      </div>
    </div>
  );
}
