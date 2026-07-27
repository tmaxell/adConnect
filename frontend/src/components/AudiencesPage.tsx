/**
 * AudiencesPage — the shared audience registry (sidebar "Audience Segments").
 *
 * Lists every reusable audience in one place: the user's saved audiences (which
 * can be deleted) and the operator's ready-made segments. Audiences are created
 * from the campaign wizard's audience step ("Сохранить аудиторию в реестр") and
 * picked back from the same registry there.
 */

import { useEffect, useState } from "react";
import { deleteAudience, getAudiences, type AudienceItem, type AudienceLibrary } from "../api/chatApi";
import { t as tr, useLang } from "../i18n";

function fmt(n: number): string {
  return (n || 0).toLocaleString("ru-RU").replace(/,/g, " ");
}

/** One-line summary of an audience spec (geo / interests / segment). */
function specSummary(spec: Record<string, unknown>): string {
  const parts: string[] = [];
  const geo = spec.geography;
  if (Array.isArray(geo) && geo.length) parts.push(geo.join(", "));
  const age = spec.age;
  if (Array.isArray(age) && age.length) parts.push(age.join(", "));
  const interests = spec.interests;
  if (Array.isArray(interests) && interests.length) parts.push(interests.join(", "));
  return parts.join(" · ") || tr("Вся база", "Entire base");
}

export function AudiencesPage() {
  const { t } = useLang();
  const [lib, setLib] = useState<AudienceLibrary | null>(null);
  const reload = () => getAudiences().then(setLib).catch(() => {});
  useEffect(() => { reload(); }, []);

  const remove = async (id: number | string) => {
    if (!window.confirm(t("Удалить аудиторию из реестра?", "Remove this audience from the registry?"))) return;
    await deleteAudience(id);
    await reload();
  };

  const saved = lib?.saved ?? [];
  const presets = lib?.presets ?? [];

  const row = (a: AudienceItem, deletable: boolean) => (
    <div key={`${deletable ? "s" : "p"}${a.id}`} className="aud-row">
      <div className="aud-row-main">
        <span className="aud-row-name">{a.name}</span>
        <span className="aud-row-sub">{a.description || specSummary(a.spec)}</span>
      </div>
      <span className="aud-row-reach">{fmt(a.reach)}</span>
      {deletable ? (
        <button type="button" className="aud-row-del" title={t("Удалить", "Delete")} onClick={() => remove(a.id)}>✕</button>
      ) : (
        <span className="aud-row-tag">{t("сегмент оператора", "operator segment")}</span>
      )}
    </div>
  );

  return (
    <div className="ana">
      <div className="ana-header">
        <h1 className="ana-h1">{t("Реестр аудиторий", "Audience registry")}</h1>
        <p className="ana-h1-sub">{t("Единый список аудиторий: ваши сохранённые и готовые сегменты оператора. Сохраняйте аудитории на шаге «Аудитория» в мастере кампании и выбирайте их оттуда же.", "One shared list of audiences: your saved ones and the operator's ready-made segments. Save audiences on the “Audience” step of the campaign wizard and pick them back from the same place.")}</p>
      </div>

      <div className="ana-card-box">
        <div className="aud-section-title">{t("Мои сохранённые", "My saved")}</div>
        {saved.length > 0
          ? <div className="aud-list">{saved.map((a) => row(a, true))}</div>
          : <div className="aud-empty">{t("Пока нет сохранённых аудиторий. Соберите аудиторию в мастере кампании и нажмите «Сохранить аудиторию в реестр».", "No saved audiences yet. Build an audience in the campaign wizard and click “Save audience to registry”.")}</div>}
      </div>

      <div className="ana-card-box">
        <div className="aud-section-title">{t("Готовые сегменты оператора", "Operator's ready-made segments")}</div>
        <div className="aud-list">{presets.map((a) => row(a, false))}</div>
      </div>
    </div>
  );
}
