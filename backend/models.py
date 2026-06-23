"""SQLAlchemy models — chat schema for the AdConnect agent backend.

Mirrors the cvm-agents persistence model: sessions, messages, runs (with trace
events) and saved artifacts. The operator segment catalog / channel pricing live
in code (tools/catalog.py, tools/forecast.py) rather than the DB for the prototype.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base for backend ORM models."""


class ChatSessionModel(Base):
    """A single chat session shown in the widget history."""

    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Новый диалог")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    campaign_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    last_message_preview: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    messages: Mapped[list["ChatMessageModel"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatMessageModel.created_at"
    )


class ChatMessageModel(Base):
    """One chat message (user/assistant)."""

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session: Mapped[ChatSessionModel] = relationship(back_populates="messages")


class ChatRunModel(Base):
    """A logical run of one /api/chat request → agent execution."""

    __tablename__ = "chat_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    user_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    intent: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    events: Mapped[list["ChatRunEventModel"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="ChatRunEventModel.created_at"
    )


class ChatRunEventModel(Base):
    """A trace event: route_selected, plan_created, step_started/completed, tool_called…"""

    __tablename__ = "chat_run_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("chat_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="info")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    run: Mapped[ChatRunModel] = relationship(back_populates="events")


class SavedArtifactModel(Base):
    """A saved chat artifact: campaign_draft, segment_draft, creative_variants…"""

    __tablename__ = "saved_artifacts"
    __table_args__ = (UniqueConstraint("source_run_id", "artifact_hash", name="uq_saved_artifacts_source_hash"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    artifact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    artifact_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CampaignModel(Base):
    """A campaign assembled by the agent — what the "Ad Campaigns" list shows.

    Created when a draft is submitted for moderation. Keeps a full snapshot of the
    CampaignDraft (`draft_json`) plus denormalized columns for the list view.
    """

    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    channel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # moderation | active | paused | draft
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="moderation", index=True)
    audience_reach: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    price_per_message: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    estimated_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    draft_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class BusinessProfileModel(Base):
    """Durable advertiser context (single row, id=1) — pre-fills every campaign brief."""

    __tablename__ = "business_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SavedAudienceModel(Base):
    """A reusable audience the user saved — picked again in the audience step."""

    __tablename__ = "saved_audiences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    channel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reach: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    spec_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
