// Package agent holds the unlocked identity in a background process and hands
// it to CLI calls over a Unix socket only reachable by the same user.
package agent

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrNoAgent means no agent answers on the socket.
var ErrNoAgent = errors.New("no running agent: run kf unlock")

// SocketPath returns $XDG_RUNTIME_DIR/keyfold/agent.sock.
func SocketPath() (string, error) {
	dir := os.Getenv("XDG_RUNTIME_DIR")
	if dir == "" {
		return "", errors.New("XDG_RUNTIME_DIR is not set")
	}
	return filepath.Join(dir, "keyfold", "agent.sock"), nil
}

// Listen creates the socket directory (0700) and the socket (0600).
func Listen() (net.Listener, error) {
	path, err := SocketPath()
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	os.Remove(path) // stale socket from an agent that did not exit cleanly
	l, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		l.Close()
		return nil, err
	}
	return l, nil
}

// Serve answers "identity" and "lock" requests until the TTL ends or a lock
// request arrives. Closing the listener removes the socket file.
func Serve(l net.Listener, identity string, ttl time.Duration) {
	timer := time.AfterFunc(ttl, func() { l.Close() })
	defer timer.Stop()
	defer l.Close()
	for {
		c, err := l.Accept()
		if err != nil {
			return
		}
		if handle(c, identity) {
			return
		}
	}
}

// handle answers one request and reports whether the agent must stop.
func handle(c net.Conn, identity string) bool {
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	line, err := bufio.NewReader(c).ReadString('\n')
	if err != nil {
		return false
	}
	switch strings.TrimSpace(line) {
	case "identity":
		fmt.Fprintln(c, identity)
	case "lock":
		fmt.Fprintln(c, "ok")
		return true
	}
	return false
}

func request(cmd string) (string, error) {
	path, err := SocketPath()
	if err != nil {
		return "", err
	}
	c, err := net.Dial("unix", path)
	if err != nil {
		return "", ErrNoAgent
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := fmt.Fprintln(c, cmd); err != nil {
		return "", ErrNoAgent
	}
	line, err := bufio.NewReader(c).ReadString('\n')
	if err != nil {
		return "", ErrNoAgent
	}
	return strings.TrimSpace(line), nil
}

// Identity returns the identity string held by the agent.
func Identity() (string, error) { return request("identity") }

// Lock stops the agent.
func Lock() error {
	_, err := request("lock")
	return err
}
