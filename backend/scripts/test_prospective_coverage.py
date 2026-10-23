import unittest
from prospective_coverage import capture_coverage, utc_timestamp_ms, STEP_MS as S, OFFSET_MS as O

def packet(t, delay=0):
    return {'snapshot': {'asOf': t}, 'capturedAt': t + delay}

class CoverageTests(unittest.TestCase):
    def test_javascript_and_python_utc_timestamps_match(self):
        a=utc_timestamp_ms('2026-09-12T23:14:22.250Z')
        self.assertEqual(a,utc_timestamp_ms('2026-09-12T23:14:22.250+00:00'))
        self.assertEqual(a,utc_timestamp_ms('2026-09-13T06:14:22.250+07:00'))
        with self.assertRaises(ValueError):utc_timestamp_ms('2026-09-12T23:14:22.250')

    def test_missing_and_late_are_not_successful_empty_scans(self):
        r = capture_coverage([packet(O+1), packet(2*S+O+1, 300_000)], 0, 4*S, 3*S)
        self.assertEqual(r['assessableScheduledSlots'], 3)
        self.assertEqual(r['missingScheduledAtMs'], [S+O])
        self.assertEqual(r['lateScheduledAtMs'], [2*S+O])
        self.assertAlmostEqual(r['timelyCoverageFraction'], 1/3)
        self.assertFalse(r['completeThroughAssessableSlots'])

    def test_grace_and_original_stop_bound_the_denominator(self):
        self.assertEqual(capture_coverage([], 0, 4*S, O+119_999)['assessableScheduledSlots'], 0)
        r = capture_coverage([packet(O+1), packet(S+O+1)], 0, 2*S, 20*S)
        self.assertEqual(r['assessableScheduledSlots'], 2)
        self.assertTrue(r['completeThroughAssessableSlots'])

    def test_startup_before_freeze_duplicates_and_future_packets(self):
        r = capture_coverage([packet(0), packet(S+O+1), packet(S+O+1), packet(5*S)], S//2, 3*S, 2*S)
        self.assertEqual(r['assessableScheduledSlots'], 1)
        self.assertEqual(r['timelyScheduledSlots'], 1)
        self.assertEqual(r['invalidPackets'], 1)
        self.assertFalse(r['completeThroughAssessableSlots'])

if __name__ == '__main__':
    unittest.main()
