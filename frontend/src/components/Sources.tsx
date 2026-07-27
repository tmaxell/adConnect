import type { SourceCitation } from "../api/chatApi";
import { useLang } from "../i18n";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function Sources({ citations }: { citations: SourceCitation[] }) {
  const { t } = useLang();
  if (!citations || citations.length === 0) return null;
  return (
    <details className="fw-sources">
      <summary>{t("Источники", "Sources")} · {citations.length}</summary>
      <div className="fw-sources-list">
        {citations.map((c) => {
          const href = c.source ? `${API_BASE}/${c.source.replace(/^\//, "")}` : undefined;
          const heading = (c.heading_path || []).filter(Boolean).join(" / ");
          const content = (
            <>
              <span className="fw-source-title">{c.title || c.source || t("Источник", "Source")}</span>
              {heading && <span className="fw-source-heading">{heading}</span>}
              <span className="fw-source-meta">
                <span className="fw-source-path">{c.source}</span>
                {typeof c.score === "number" && c.score > 0 && (
                  <span className="fw-source-score">score {c.score.toFixed(2)}</span>
                )}
              </span>
            </>
          );
          return href ? (
            <a key={c.id} href={href} target="_blank" rel="noreferrer" className="fw-source-card">
              {content}
            </a>
          ) : (
            <div key={c.id} className="fw-source-card">{content}</div>
          );
        })}
      </div>
    </details>
  );
}
