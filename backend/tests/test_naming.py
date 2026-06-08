"""Subject extraction + campaign naming."""

from tools.naming import clean_subject, derive_name, generate_campaign_name


def test_clean_subject_strips_builder_filler():
    s = clean_subject(None, "Создай SMS-кампанию для моего фитнес-клуба")
    assert "фитнес" in s.lower()
    assert "созда" not in s.lower()
    assert "кампани" not in s.lower()
    assert "sms" not in s.lower()


def test_clean_subject_cuts_audience_tail_at_comma():
    s = clean_subject(None, "Создай SMS-кампанию для моего фитнес-клуба, привлечь клиентов")
    assert "привлечь" not in s.lower()
    assert "фитнес" in s.lower()


def test_clean_subject_prefers_product():
    s = clean_subject("кофейня", "Создай рекламную кампанию")
    assert s == "кофейня"


def test_clean_subject_empty_for_pure_filler():
    assert clean_subject(None, "Создай рекламную кампанию") == ""


def test_derive_name_titlecases_subject():
    assert derive_name(None, "прорекламируй мой автосервис").startswith("Автосервис")


def test_derive_name_dated_fallback_when_empty():
    name = derive_name(None, "")
    assert "кампания" in name.lower()


async def test_generate_name_without_llm_uses_derive():
    name = await generate_campaign_name(None, "Создай кампанию для пекарни", use_llm=False)
    assert "пекарн" in name.lower()
    assert "созда" not in name.lower()
