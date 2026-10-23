"""Scheduled capture completeness; independent of signal count or provider success."""
STEP_MS = 900_000
OFFSET_MS = 20_000
MAX_CAPTURE_DELAY_MS = 120_000


def capture_coverage(packets, frozen_at, stop_at, observed_at):
    if not all(isinstance(x, int) for x in (frozen_at, stop_at, observed_at)) or stop_at < frozen_at:
        raise ValueError('invalid_coverage_window')
    # A slot becomes assessable only after its capture grace has elapsed.
    first = -(-(frozen_at - OFFSET_MS) // STEP_MS)
    last = min((observed_at - MAX_CAPTURE_DELAY_MS - OFFSET_MS) // STEP_MS,
               (stop_at - 1 - OFFSET_MS) // STEP_MS)
    expected = set(range(first, last + 1))
    captured, timely, invalid = set(), set(), 0
    for packet in packets:
        try:
            as_of, received = packet['snapshot']['asOf'], packet['capturedAt']
            if not all(isinstance(x, int) and not isinstance(x, bool) for x in (as_of, received)):
                raise ValueError()
            if received < as_of or received > observed_at:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            invalid += 1
            continue
        slot = as_of // STEP_MS
        due = slot * STEP_MS + OFFSET_MS
        if slot not in expected or as_of < due or as_of < frozen_at or as_of >= stop_at:
            continue
        captured.add(slot)
        if received <= due + MAX_CAPTURE_DELAY_MS:
            timely.add(slot)
    timestamps = lambda slots: [s * STEP_MS + OFFSET_MS for s in sorted(slots)]
    return {'assessableScheduledSlots': len(expected), 'capturedScheduledSlots': len(captured),
            'timelyScheduledSlots': len(timely), 'missingScheduledAtMs': timestamps(expected - captured),
            'lateScheduledAtMs': timestamps(captured - timely), 'invalidPackets': invalid,
            'captureGraceMs': MAX_CAPTURE_DELAY_MS,
            'timelyCoverageFraction': len(timely) / len(expected) if expected else None,
            'completeThroughAssessableSlots': not (expected - timely) and not invalid,
            'warning': 'Completeness only; missing or late captures are not no-signal observations. Immediate startup captures outside scheduled slots are excluded.'}


def utc_timestamp_ms(value):
    from datetime import datetime
    if not isinstance(value,str): raise ValueError('invalid_timestamp')
    parsed=datetime.fromisoformat(value[:-1]+'+00:00' if value.endswith('Z') else value)
    if parsed.tzinfo is None: raise ValueError('timestamp_requires_timezone')
    return int(parsed.timestamp()*1000)
