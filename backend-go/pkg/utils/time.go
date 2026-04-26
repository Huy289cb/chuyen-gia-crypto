package utils

import (
	"time"
)

// CustomTime wraps time.Time for custom JSON marshaling
type CustomTime struct {
	time.Time
}

// MarshalJSON implements json.Marshaler for CustomTime
func (ct CustomTime) MarshalJSON() ([]byte, error) {
	return ct.Time.UTC().MarshalJSON()
}

// UnmarshalJSON implements json.Unmarshaler for CustomTime
func (ct *CustomTime) UnmarshalJSON(data []byte) error {
	return ct.Time.UnmarshalJSON(data)
}

// FormatISO formats time to ISO 8601 with timezone
func FormatISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05Z")
}
