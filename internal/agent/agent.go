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
	"syscall"
	"time"
)

// ErrNoAgent means no agent answers on the socket.
var ErrNoAgent = errors.New("no running agent: run kf unlock")

// SocketPath returns $XDG_RUNTIME_DIR/keyfold/agent.sock. Where that variable
// does not exist (macOS), it returns keyfold-<uid>/agent.sock in the temp dir.
func SocketPath() string {
	if dir := os.Getenv("XDG_RUNTIME_DIR"); dir != "" {
		return filepath.Join(dir, "keyfold", "agent.sock")
	}
	return filepath.Join(os.TempDir(), fmt.Sprintf("keyfold-%d", os.Getuid()), "agent.sock")
}

// ownDir returns an error unless dir is a real directory owned by this user.
// The temp dir can be shared: another user may have made the path first, as a
// directory or as a link, to receive the socket.
func ownDir(dir string) error {
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if st, ok := info.Sys().(*syscall.Stat_t); !info.IsDir() || !ok || int(st.Uid) != os.Getuid() {
		return fmt.Errorf("%s is not a directory of this user", dir)
	}
	return nil
}

// Listen creates the socket directory (0700) and the socket (0600).
func Listen() (net.Listener, error) {
	path := SocketPath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := ownDir(dir); err != nil {
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
	path := SocketPath()
	if err := ownDir(filepath.Dir(path)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrNoAgent
		}
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
