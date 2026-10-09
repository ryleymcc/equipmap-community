from datetime import date, datetime, timezone
import pytest

from recurrence import RecurrenceValidationError, occurrences, summarize, validate_rule


def rule(**overrides):
    value = {
        "frequency": "daily",
        "interval": 1,
        "start_date": "2024-01-01",
        "time_of_day": "09:00",
        "timezone": "America/Chicago",
        "non_working_day_rule": "none",
        "due_after_issued_days": 0,
        "end_rule": "never",
    }
    value.update(overrides)
    return value


def test_biweekly_multiple_weekdays():
    items = occurrences(rule(frequency="weekly", interval=2, weekly_days=["MO", "TH"]), 5)
    assert [item.nominal_scheduled_date.isoformat() for item in items] == [
        "2024-01-01", "2024-01-04", "2024-01-15", "2024-01-18", "2024-01-29"
    ]


def test_month_end_clamps_and_tracks_leap_year():
    # 2024 is a leap year -> Feb 29
    items = occurrences(rule(frequency="monthly", monthly_type="exact-day", month_day=31,
                             start_date="2024-01-31"), 3)
    assert [item.nominal_scheduled_date.isoformat() for item in items] == [
        "2024-01-31", "2024-02-29", "2024-03-31"
    ]
    # 2023 is non-leap year -> Feb 28
    non_leap = occurrences(rule(frequency="monthly", monthly_type="exact-day", month_day=31,
                                start_date="2023-01-31"), 3)
    assert [item.nominal_scheduled_date.isoformat() for item in non_leap] == [
        "2023-01-31", "2023-02-28", "2023-03-31"
    ]
    # Last day of month
    last_days = occurrences(rule(frequency="monthly", monthly_type="last-day",
                                 start_date="2023-02-01"), 2)
    assert [item.nominal_scheduled_date.day for item in last_days] == [28, 31]


def test_quarterly_and_semiannual_intervals():
    quarterly = occurrences(rule(frequency="monthly", interval=3, monthly_type="exact-day",
                                 month_day=15, start_date="2024-01-15"), 4)
    assert [item.nominal_scheduled_date.isoformat() for item in quarterly] == [
        "2024-01-15", "2024-04-15", "2024-07-15", "2024-10-15"
    ]
    semiannual = occurrences(rule(frequency="monthly", interval=6, monthly_type="last-day",
                                  start_date="2024-01-01"), 3)
    assert [item.nominal_scheduled_date.isoformat() for item in semiannual] == [
        "2024-01-31", "2024-07-31", "2025-01-31"
    ]


def test_relative_weekday():
    items = occurrences(rule(frequency="monthly", monthly_type="relative-weekday",
                             ordinal="last", ordinal_day="FR", start_date="2024-02-01"), 2)
    assert [item.nominal_scheduled_date.isoformat() for item in items] == ["2024-02-23", "2024-03-29"]
    summary = summarize(rule(frequency="monthly", monthly_type="relative-weekday",
                             ordinal="last", ordinal_day="FR"))
    assert "last Friday" in summary


def test_weekend_adjustment_due_offset_and_utc_serialization():
    # Saturday rolls to Monday
    item = occurrences(rule(start_date="2024-06-01", non_working_day_rule="roll-next-monday",
                            due_after_issued_days=3), 1)[0]
    assert item.nominal_scheduled_date.isoformat() == "2024-06-01"
    assert item.issue_datetime == datetime(2024, 6, 3, 14, tzinfo=timezone.utc)
    assert item.due_datetime == datetime(2024, 6, 6, 14, tzinfo=timezone.utc)
    assert item.adjustment_reason == "Shifted from Saturday to Monday"

    # Sunday rolls to Friday
    sun_item = occurrences(rule(start_date="2024-06-02", non_working_day_rule="roll-previous-friday",
                                due_after_issued_days=2), 1)[0]
    assert sun_item.nominal_scheduled_date.isoformat() == "2024-06-02"
    assert sun_item.issue_datetime == datetime(2024, 5, 31, 14, tzinfo=timezone.utc)
    assert sun_item.due_datetime == datetime(2024, 6, 2, 14, tzinfo=timezone.utc)
    assert sun_item.adjustment_reason == "Shifted from Sunday to Friday"


def test_end_rules():
    # After count
    count_items = occurrences(rule(frequency="daily", interval=1, start_date="2024-01-01",
                                   end_rule="after-count", end_count=3), 10)
    assert len(count_items) == 3
    assert count_items[-1].nominal_scheduled_date.isoformat() == "2024-01-03"

    # On date
    date_items = occurrences(rule(frequency="daily", interval=2, start_date="2024-01-01",
                                  end_rule="on-date", end_date="2024-01-05"), 10)
    assert [item.nominal_scheduled_date.isoformat() for item in date_items] == [
        "2024-01-01", "2024-01-03", "2024-01-05"
    ]


def test_after_nominal_advances_cadence():
    r = rule(frequency="weekly", interval=1, weekly_days=["MO", "WE", "FR"], start_date="2024-01-01")
    first_three = occurrences(r, 3)
    assert [item.nominal_scheduled_date.isoformat() for item in first_three] == [
        "2024-01-01", "2024-01-03", "2024-01-05"
    ]
    # Advance after 2024-01-03 nominal
    after = occurrences(r, 2, after_nominal=first_three[1].nominal_scheduled_datetime)
    assert [item.nominal_scheduled_date.isoformat() for item in after] == [
        "2024-01-05", "2024-01-08"
    ]


def test_dst_timezone_transitions():
    # US Central time: UTC-6 in Jan, UTC-5 in July
    jan = occurrences(rule(start_date="2024-01-15", time_of_day="08:00", timezone="America/Chicago"), 1)[0]
    jul = occurrences(rule(start_date="2024-07-15", time_of_day="08:00", timezone="America/Chicago"), 1)[0]
    assert jan.issue_datetime.hour == 14  # 08:00 CST -> 14:00 UTC
    assert jul.issue_datetime.hour == 13  # 08:00 CDT -> 13:00 UTC


def test_summarize_descriptions():
    d_sum = summarize(rule(frequency="daily", interval=3))
    assert "Every 3 days at 09:00 America/Chicago" in d_sum

    w_sum = summarize(rule(frequency="weekly", interval=2, weekly_days=["TU", "TH"]))
    assert "Every 2 weeks on Tuesday, Thursday" in w_sum

    m_sum = summarize(rule(frequency="monthly", interval=1, monthly_type="exact-day", month_day=15))
    assert "Every month on day 15" in m_sum


@pytest.mark.parametrize("change", [
    {"timezone": "Mars/Olympus"},
    {"interval": 0},
    {"frequency": "hourly"},
    {"frequency": "weekly", "weekly_days": []},
    {"frequency": "weekly", "weekly_days": ["XX"]},
    {"frequency": "weekly", "weekly_days": ["MO", "MO"]},
    {"frequency": "monthly", "monthly_type": "exact-day", "month_day": 32},
    {"frequency": "monthly", "monthly_type": "exact-day", "month_day": 0},
    {"frequency": "monthly", "monthly_type": "relative-weekday", "ordinal": "fifth", "ordinal_day": "MO"},
    {"end_rule": "after-count", "end_count": 0},
    {"end_rule": "on-date", "start_date": "2024-05-01", "end_date": "2024-04-01"},
    {"due_after_issued_days": -1},
])
def test_invalid_rules_are_explicit(change):
    with pytest.raises(RecurrenceValidationError):
        validate_rule(rule(**change))


def test_full_year_daily_occurrences_and_count_limit():
    # 2024 is a leap year with 366 days
    leap_year_items = occurrences(rule(frequency="daily", interval=1, start_date="2024-01-01"), 366)
    assert len(leap_year_items) == 366
    assert leap_year_items[0].nominal_scheduled_date.isoformat() == "2024-01-01"
    assert leap_year_items[-1].nominal_scheduled_date.isoformat() == "2024-12-31"

    # Up to 1000 occurrences supported
    large_items = occurrences(rule(frequency="daily", interval=1, start_date="2024-01-01"), 500)
    assert len(large_items) == 500

    # Over 1000 or under 1 count fails
    with pytest.raises(RecurrenceValidationError):
        occurrences(rule(frequency="daily"), 1001)
    with pytest.raises(RecurrenceValidationError):
        occurrences(rule(frequency="daily"), 0)
