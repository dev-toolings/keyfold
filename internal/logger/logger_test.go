package logger

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
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

func TestAccessClient(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	for _, c := range []struct{ env, want string }{
		{"production", `"client":"192.0.2.2"`},
		{"development", `client=192.0.2.2`},
	} {
		t.Run(c.env, func(t *testing.T) {
			var buf bytes.Buffer
			slog.SetDefault(New(c.env, &buf))
			r := httptest.NewRequest(http.MethodPost, "/api/v1/session?private-query", strings.NewReader("private-body"))
			r.RemoteAddr = "127.0.0.1:1234"
			r.Header.Set("X-Forwarded-For", "192.0.2.1, 192.0.2.2")
			Access(http.NotFoundHandler()).ServeHTTP(httptest.NewRecorder(), r)
			out := buf.String()
			if !strings.Contains(out, c.want) {
				t.Errorf("want client field %q in %s", c.want, out)
			}
			for _, private := range []string{"192.0.2.1", "private-query", "private-body"} {
				if strings.Contains(out, private) {
					t.Errorf("logged %q in %s", private, out)
				}
			}
		})
	}
}

func TestAccessProbeLevel(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	for _, c := range []struct {
		path   string
		status int
		level  string
	}{
		{"/api/v1/alive", http.StatusOK, "DEBUG"},
		{"/api/v1/alive", http.StatusNotFound, "DEBUG"},
		{"/api/v1/alive", http.StatusInternalServerError, "ERROR"},
		{"/api/v1/status", http.StatusOK, "INFO"},
		{"/api/v1/status", http.StatusNotFound, "WARN"},
	} {
		buf.Reset()
		mux := http.NewServeMux()
		mux.HandleFunc("GET "+c.path, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(c.status)
		})
		Access(mux).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, c.path, nil))
		if !strings.Contains(buf.String(), `"level":"`+c.level+`"`) {
			t.Errorf("%s %d: want %s level, got %s", c.path, c.status, c.level, &buf)
		}
	}
}
