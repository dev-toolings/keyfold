package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"testing"
)

func TestSIGTERMLetsTheRequestInFlightFinish(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		io.WriteString(w, "done")
	})
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer stop()
	served := make(chan error, 1)
	go func() { served <- serve(ctx, h, ln) }()

	body := make(chan string, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			body <- err.Error()
			return
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		body <- string(b)
	}()
	<-started
	if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	<-ctx.Done()
	close(release)

	if got := <-body; got != "done" {
		t.Errorf("request in flight got %q, want %q", got, "done")
	}
	if err := <-served; err != nil {
		t.Errorf("serve returned %v, want nil", err)
	}
	if _, err := net.Dial("tcp", ln.Addr().String()); err == nil {
		t.Error("the listener still accepts connections after the stop")
	}
}
