package handlers

import (
	"time"
)

// formatTime formats time.Time to RFC3339 string
func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// formatTimePtr formats *time.Time to RFC3339 string
func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// formatTimeUnix formats time.Time to Unix timestamp (for charts)
func formatTimeUnix(t time.Time) int64 {
	return t.Unix()
}

// formatTimeUnixPtr formats *time.Time to Unix timestamp
func formatTimeUnixPtr(t *time.Time) *int64 {
	if t == nil {
		return nil
	}
	ts := t.Unix()
	return &ts
}
