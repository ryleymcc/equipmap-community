"""Pure validation and occurrence calculation for versioned PM recurrence rules."""

import calendar
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
DAY_NAMES = {key: name for key, name in zip(WEEKDAYS, calendar.day_name)}
ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "last": -1}


class RecurrenceValidationError(ValueError):
    pass


@dataclass(frozen=True)
class Occurrence:
    occurrence_number: int
    nominal_scheduled_date: date
    nominal_scheduled_datetime: datetime
    issue_datetime: datetime
    due_datetime: datetime
    adjustment_reason: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_rule(raw: Any, version: int = 1) -> dict[str, Any]:
    if version != 1:
        raise RecurrenceValidationError("recurrence_version must be 1")
    if not isinstance(raw, dict):
        raise RecurrenceValidationError("recurrence_rule must be an object")

    rule = dict(raw)
    allowed = {
        "frequency", "interval", "start_date", "time_of_day", "timezone", "weekly_days",
        "monthly_type", "month_day", "ordinal", "ordinal_day", "non_working_day_rule",
        "due_after_issued_days", "end_rule", "end_count", "end_date",
    }
    unknown = sorted(set(rule) - allowed)
    if unknown:
        raise RecurrenceValidationError(f"Unknown recurrence fields: {', '.join(unknown)}")
    required = ["frequency", "start_date", "time_of_day", "timezone", "end_rule"]
    missing = [field for field in required if field not in rule]
    if missing:
        raise RecurrenceValidationError(f"Missing required recurrence fields: {', '.join(missing)}")

    frequency = rule.get("frequency")
    if frequency not in {"daily", "weekly", "monthly"}:
        raise RecurrenceValidationError("frequency must be daily, weekly, or monthly")
    interval = rule.get("interval", 1)
    if not isinstance(interval, int) or isinstance(interval, bool) or interval < 1:
        raise RecurrenceValidationError("interval must be a positive integer")
    rule["interval"] = interval

    try:
        rule["start_date"] = date.fromisoformat(rule["start_date"]).isoformat()
    except (TypeError, ValueError):
        raise RecurrenceValidationError("start_date must be a valid YYYY-MM-DD date")
    try:
        parsed_time = time.fromisoformat(rule["time_of_day"])
        if parsed_time.tzinfo is not None:
            raise ValueError
        rule["time_of_day"] = parsed_time.replace(second=0, microsecond=0).isoformat(timespec="minutes")
    except (TypeError, ValueError):
        raise RecurrenceValidationError("time_of_day must be a valid local HH:MM time")
    try:
        ZoneInfo(rule["timezone"])
    except (TypeError, ZoneInfoNotFoundError):
        raise RecurrenceValidationError("timezone must be a valid IANA timezone")

    weekly_days = rule.get("weekly_days", [])
    if frequency == "weekly":
        if not isinstance(weekly_days, list) or not weekly_days:
            raise RecurrenceValidationError("weekly_days must contain at least one weekday for weekly rules")
        if any(day not in WEEKDAYS for day in weekly_days):
            raise RecurrenceValidationError("weekly_days values must be MO through SU")
        if len(set(weekly_days)) != len(weekly_days):
            raise RecurrenceValidationError("weekly_days must not contain duplicates")
    elif weekly_days and (not isinstance(weekly_days, list) or any(day not in WEEKDAYS for day in weekly_days)):
        raise RecurrenceValidationError("weekly_days values must be MO through SU")
    rule["weekly_days"] = weekly_days

    monthly_type = rule.get("monthly_type")
    if frequency == "monthly":
        if monthly_type not in {"exact-day", "last-day", "relative-weekday"}:
            raise RecurrenceValidationError("monthly_type must be exact-day, last-day, or relative-weekday")
        if monthly_type == "exact-day":
            month_day = rule.get("month_day")
            if not isinstance(month_day, int) or isinstance(month_day, bool) or not 1 <= month_day <= 31:
                raise RecurrenceValidationError("month_day must be an integer from 1 through 31")
        if monthly_type == "relative-weekday":
            if rule.get("ordinal") not in ORDINALS:
                raise RecurrenceValidationError("ordinal must be first, second, third, fourth, or last")
            if rule.get("ordinal_day") not in WEEKDAYS:
                raise RecurrenceValidationError("ordinal_day must be MO through SU")

    adjustment = rule.get("non_working_day_rule", "none")
    if adjustment not in {"none", "roll-previous-friday", "roll-next-monday"}:
        raise RecurrenceValidationError("non_working_day_rule is invalid")
    rule["non_working_day_rule"] = adjustment
    due_days = rule.get("due_after_issued_days", 0)
    if not isinstance(due_days, int) or isinstance(due_days, bool) or due_days < 0:
        raise RecurrenceValidationError("due_after_issued_days must be a non-negative integer")
    rule["due_after_issued_days"] = due_days

    end_rule = rule.get("end_rule")
    if end_rule not in {"never", "after-count", "on-date"}:
        raise RecurrenceValidationError("end_rule must be never, after-count, or on-date")
    if end_rule == "after-count":
        if not isinstance(rule.get("end_count"), int) or isinstance(rule.get("end_count"), bool) or rule["end_count"] < 1:
            raise RecurrenceValidationError("end_count must be a positive integer for after-count")
    if end_rule == "on-date":
        try:
            end_date = date.fromisoformat(rule.get("end_date"))
        except (TypeError, ValueError):
            raise RecurrenceValidationError("end_date must be a valid YYYY-MM-DD date for on-date")
        if end_date < date.fromisoformat(rule["start_date"]):
            raise RecurrenceValidationError("end_date cannot be before start_date")
        rule["end_date"] = end_date.isoformat()
    return rule


def _add_months(value: date, months: int) -> tuple[int, int]:
    index = value.year * 12 + value.month - 1 + months
    return divmod(index, 12)[0], divmod(index, 12)[1] + 1


def _monthly_date(rule: dict[str, Any], year: int, month: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    if rule["monthly_type"] == "last-day":
        day = last_day
    elif rule["monthly_type"] == "exact-day":
        day = min(rule["month_day"], last_day)
    else:
        target = WEEKDAYS[rule["ordinal_day"]]
        matches = [day for day in range(1, last_day + 1) if date(year, month, day).weekday() == target]
        day = matches[ORDINALS[rule["ordinal"]] - 1] if rule["ordinal"] != "last" else matches[-1]
    return date(year, month, day)


def _nominal_dates(rule: dict[str, Any]):
    start = date.fromisoformat(rule["start_date"])
    interval = rule["interval"]
    if rule["frequency"] == "daily":
        current = start
        while True:
            yield current
            current += timedelta(days=interval)
    elif rule["frequency"] == "weekly":
        week_start = start - timedelta(days=start.weekday())
        selected = sorted(WEEKDAYS[day] for day in rule["weekly_days"])
        week = 0
        while True:
            for weekday in selected:
                candidate = week_start + timedelta(weeks=week * interval, days=weekday)
                if candidate >= start:
                    yield candidate
            week += 1
    else:
        period = 0
        while True:
            year, month = _add_months(start, period * interval)
            candidate = _monthly_date(rule, year, month)
            if candidate >= start:
                yield candidate
            period += 1


def _make_occurrence(rule: dict[str, Any], nominal: date, number: int) -> Occurrence:
    adjusted = nominal
    reason = None
    if nominal.weekday() >= 5 and rule["non_working_day_rule"] == "roll-previous-friday":
        adjusted -= timedelta(days=nominal.weekday() - 4)
        reason = f"Shifted from {calendar.day_name[nominal.weekday()]} to Friday"
    elif nominal.weekday() >= 5 and rule["non_working_day_rule"] == "roll-next-monday":
        adjusted += timedelta(days=7 - nominal.weekday())
        reason = f"Shifted from {calendar.day_name[nominal.weekday()]} to Monday"
    local_time = time.fromisoformat(rule["time_of_day"])
    zone = ZoneInfo(rule["timezone"])
    nominal_dt = datetime.combine(nominal, local_time, zone).astimezone(timezone.utc)
    issue = datetime.combine(adjusted, local_time, zone).astimezone(timezone.utc)
    return Occurrence(number, nominal, nominal_dt, issue, issue + timedelta(days=rule["due_after_issued_days"]), reason)


def occurrences(
    raw_rule: dict[str, Any], count: int = 12, after: Optional[datetime] = None,
    version: int = 1, after_nominal: Optional[datetime] = None,
) -> list[Occurrence]:
    if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 1000:
        raise RecurrenceValidationError("count must be an integer from 1 through 1000")
    rule = validate_rule(raw_rule, version)
    if after and after.tzinfo is None:
        raise RecurrenceValidationError("after must be timezone-aware")
    if after_nominal and after_nominal.tzinfo is None:
        raise RecurrenceValidationError("after_nominal must be timezone-aware")
    after_utc = after.astimezone(timezone.utc) if after else None
    after_nominal_utc = after_nominal.astimezone(timezone.utc) if after_nominal else None
    result = []
    end_date = date.fromisoformat(rule["end_date"]) if rule["end_rule"] == "on-date" else None
    max_total = rule.get("end_count") if rule["end_rule"] == "after-count" else 50000
    for number, nominal in enumerate(_nominal_dates(rule), 1):
        if number > max_total or (end_date and nominal > end_date):
            break
        occurrence = _make_occurrence(rule, nominal, number)
        if after_utc and occurrence.issue_datetime <= after_utc:
            continue
        if after_nominal_utc and occurrence.nominal_scheduled_datetime <= after_nominal_utc:
            continue
        result.append(occurrence)
        if len(result) == count:
            break
    return result


def summarize(raw_rule: dict[str, Any], version: int = 1) -> str:
    rule = validate_rule(raw_rule, version)
    interval = rule["interval"]
    if rule["frequency"] == "daily":
        cadence = "Every day" if interval == 1 else f"Every {interval} days"
    elif rule["frequency"] == "weekly":
        days = ", ".join(DAY_NAMES[day] for day in rule["weekly_days"])
        cadence = ("Every week" if interval == 1 else f"Every {interval} weeks") + f" on {days}"
    elif rule["monthly_type"] == "exact-day":
        cadence = ("Every month" if interval == 1 else f"Every {interval} months") + f" on day {rule['month_day']}"
    elif rule["monthly_type"] == "last-day":
        cadence = ("Every month" if interval == 1 else f"Every {interval} months") + " on the last day"
    else:
        cadence = ("Every month" if interval == 1 else f"Every {interval} months") + f" on the {rule['ordinal']} {DAY_NAMES[rule['ordinal_day']]}"
    ending = " indefinitely"
    if rule["end_rule"] == "after-count":
        ending = f" for {rule['end_count']} occurrences"
    elif rule["end_rule"] == "on-date":
        ending = f" through {rule['end_date']}"
    adjustment = {
        "none": "",
        "roll-previous-friday": " Weekend issues roll to the previous Friday.",
        "roll-next-monday": " Weekend issues roll to the next Monday.",
    }[rule["non_working_day_rule"]]
    due = f" Due {rule['due_after_issued_days']} day(s) after issue."
    return f"{cadence} at {rule['time_of_day']} {rule['timezone']}, starting {rule['start_date']}{ending}.{adjustment}{due}"
