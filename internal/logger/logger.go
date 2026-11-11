// Package logger builds the service logger: JSON lines by default, and a
// colored one-line face when the environment is "development". Both faces
// carry the same fields.
package logger

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RedactedKeys are attribute names whose value is never printed, in either face.
var RedactedKeys = []string{
	"authorization", "cookie", "set-cookie", "password", "token", "secret",
	"apikey", "identity", "ciphertext", "value", "answer",
}

func redact(_ []string, a slog.Attr) slog.Attr {
	if slices.Contains(RedactedKeys, strings.ToLower(a.Key)) {
		a.Value = slog.StringValue("[redacted]")
	}
	return a
}

// New returns the logger for env: the pretty face at debug level for
// "development", JSON at info level otherwise. Colors are forced in
// development (the output is usually piped) unless NO_COLOR is set.
func New(env string, w io.Writer) *slog.Logger {
	if env == "development" {
		_, noColor := os.LookupEnv("NO_COLOR")
		return slog.New(&pretty{w: w, color: !noColor, mu: &sync.Mutex{}})
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo, ReplaceAttr: redact}))
}

type pretty struct {
	w     io.Writer
	color bool
	mu    *sync.Mutex
	attrs []slog.Attr
}

func (h *pretty) Enabled(_ context.Context, l slog.Level) bool { return l >= slog.LevelDebug }

func (h *pretty) WithAttrs(as []slog.Attr) slog.Handler {
	c := *h
	c.attrs = append(slices.Clip(h.attrs), as...)
	return &c
}

func (h *pretty) WithGroup(string) slog.Handler { return h }

func (h *pretty) Handle(_ context.Context, r slog.Record) error {
	attrs := slices.Clone(h.attrs)
	r.Attrs(func(a slog.Attr) bool {
		attrs = append(attrs, a)
		return true
	})
	line := Format(r.Time, r.Level, r.Message, attrs, h.color)
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.w, line+"\n")
	return err
}

const (
	bold   = "1"
	red    = "31"
	green  = "32"
	yellow = "33"
	blue   = "34"
	grey   = "90"
)

// Format renders one development line: "[time] LEVEL: message  key=value".
// A record named "http request" is shaped as "METHOD path STATUS 12ms".
func Format(t time.Time, level slog.Level, msg string, attrs []slog.Attr, color bool) string {
	paint := func(code, s string) string {
		if !color {
			return s
		}
		return "\033[" + code + "m" + s + "\033[0m"
	}
	name, code := "INFO", green
	switch {
	case level >= slog.LevelError:
		name, code = "ERROR", red
	case level >= slog.LevelWarn:
		name, code = "WARN", yellow
	case level < slog.LevelInfo:
		name, code = "DEBUG", blue
	}

	var b strings.Builder
	b.WriteString(paint(grey, "["+t.Format("15:04:05.000")+"]") + " " + paint(code, name) + ": ")
	if msg == "http request" {
		take := func(key string) slog.Value {
			i := slices.IndexFunc(attrs, func(a slog.Attr) bool { return a.Key == key })
			if i < 0 {
				return slog.Value{}
			}
			v := attrs[i].Value
			attrs = slices.Delete(slices.Clone(attrs), i, i+1)
			return v
		}
		method, path, status, dur := take("method"), take("path"), take("status"), take("durationMs")
		statusCode := green
		if status.Kind() == slog.KindInt64 && status.Int64() >= 500 {
			statusCode = red
		} else if status.Kind() == slog.KindInt64 && status.Int64() >= 400 {
			statusCode = yellow
		}
		b.WriteString(paint(bold, method.String()) + " " + path.String() + " " + paint(statusCode, status.String()) + " " + dur.String() + "ms")
	} else {
		b.WriteString(msg)
	}
	for i, a := range attrs {
		if i == 0 {
			b.WriteString(" ")
		}
		a = redact(nil, a)
		b.WriteString(" " + paint(grey, a.Key+"="+render(a.Value)))
	}
	return b.String()
}

// render prints a value inline, quoting strings that would break key=value.
func render(v slog.Value) string {
	v = v.Resolve()
	s := v.String()
	if v.Kind() == slog.KindAny {
		if err, ok := v.Any().(error); ok {
			s = err.Error()
		} else if j, err := json.Marshal(v.Any()); err == nil {
			return string(j)
		}
	}
	if strings.ContainsAny(s, " =\"") {
		return strconv.Quote(s)
	}
	return s
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Access sets X-Request-Id and logs one line per request after the handler
// ran. It logs the path only: never the query, headers or body.
func Access(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := make([]byte, 8)
		rand.Read(id)
		requestID := hex.EncodeToString(id)
		w.Header().Set("X-Request-Id", requestID)
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		level := slog.LevelInfo
		if sw.status >= 500 {
			level = slog.LevelError
		} else if sw.status >= 400 {
			level = slog.LevelWarn
		}
		attrs := []any{"method", r.Method, "path", r.URL.Path, "status", sw.status,
			"durationMs", time.Since(start).Milliseconds(), "requestId", requestID}
		if r.Pattern != "" {
			attrs = append(attrs, "route", r.Pattern)
		}
		slog.Log(r.Context(), level, "http request", attrs...)
	})
}
