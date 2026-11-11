package logger

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"
)

var at = time.Date(2026, 1, 2, 18, 32, 12, 117e6, time.UTC)

func TestFormatHTTPRequest(t *testing.T) {
	got := Format(at, slog.LevelInfo, "http request", []slog.Attr{
		slog.String("method", "GET"), slog.String("path", "/api/v1/items"), slog.Int("status", 200),
		slog.Int64("durationMs", 5), slog.String("requestId", "r1"), slog.String("route", "GET /api/v1/items"),
	}, false)
	want := `[18:32:12.117] INFO: GET /api/v1/items 200 5ms  requestId=r1 route="GET /api/v1/items"`
	if got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
}

func TestFormatGenericEvent(t *testing.T) {
	got := Format(at, slog.LevelWarn, "web dir not found", []slog.Attr{slog.String("dir", "web/dist"), slog.Int("tries", 2)}, false)
	want := `[18:32:12.117] WARN: web dir not found  dir=web/dist tries=2`
	if got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
}

func TestRedactionInBothFaces(t *testing.T) {
	for _, env := range []string{"development", "production"} {
		var buf bytes.Buffer
		New(env, &buf).Info("login", "password", "fake-passphrase-123", "Authorization", "Bearer fake-token-456", "user", "u1")
		out := buf.String()
		if strings.Contains(out, "fake-passphrase-123") || strings.Contains(out, "fake-token-456") {
			t.Errorf("%s: secret printed: %s", env, out)
		}
		if strings.Count(out, "[redacted]") != 2 || !strings.Contains(out, "u1") {
			t.Errorf("%s: want 2 redactions and user kept: %s", env, out)
		}
	}
}
