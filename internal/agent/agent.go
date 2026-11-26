// Package agent holds the unlocked identity in a background process and hands
// it to CLI calls over a Unix socket only reachable by the same user. Each
// server URL gets its own agent, so vaults on two servers can be unlocked at
// the same time.
package agent

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// ErrNoAgent means no agent answers on the socket.
var ErrNoAgent = errors.New("no running agent: run kf unlock")

// SocketPath returns the socket path of the agent for server, before resolving
// symlinks in its parent chain. The file is agent-<key>.sock, where key is the
// first 8 hex digits of a SHA-256 of the server URL with its scheme and host in lower case,
// no default port and no trailing slash. It lives in $XDG_RUNTIME_DIR/keyfold when set and in
// keyfold-<uid> in the temp dir otherwise.
func SocketPath(server string) string {
	name := "agent-" + serverKey(server) + ".sock"
	if dir := os.Getenv("XDG_RUNTIME_DIR"); dir != "" {
		return filepath.Join(dir, "keyfold", name)
	}
	return filepath.Join(os.TempDir(), fmt.Sprintf("keyfold-%d", os.Getuid()), name)
}

func serverKey(server string) string {
	server = strings.TrimRight(server, "/")
	if u, err := url.Parse(server); err == nil && u.Host != "" {
		u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
		if port := u.Port(); (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
			u.Host = strings.TrimSuffix(u.Host, ":"+port) // the same server; keeps IPv6 brackets
		}
		server = u.String()
	}
	sum := sha256.Sum256([]byte(server))
	return hex.EncodeToString(sum[:4]) // short: a socket path is limited to about 104 bytes
}

// ownDir returns the resolved path to a real socket directory owned by this
// user with mode 0700. Each resolved ancestor must belong to this user or
// root and must have the sticky bit if group or other users can write to it.
// When create is true, ownDir creates the socket directory or sets its mode.
func ownDir(dir string, create bool) (string, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(dir))
	if err != nil {
		return "", err
	}
	uid := os.Getuid()
	if err := checkAncestors(parent, uid); err != nil {
		return "", err
	}
	dir = filepath.Join(parent, filepath.Base(dir))
	if create {
		if err := os.Mkdir(dir, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
			return "", err
		}
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return "", err
	}
	if st, ok := info.Sys().(*syscall.Stat_t); !info.IsDir() || !ok || int(st.Uid) != uid {
		return "", fmt.Errorf("%s is not a directory of this user", dir)
	}
	if info.Mode() != os.ModeDir|0o700 {
		if !create {
			return "", fmt.Errorf("%s must have mode 0700", dir)
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return "", err
		}
	}
	return dir, nil
}

func checkAncestors(dir string, uid int) error {
	// Check from the root down so each directory's parent is already trusted.
	if parent := filepath.Dir(dir); parent != dir {
		if err := checkAncestors(parent, uid); err != nil {
			return err
		}
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}
	if st, ok := info.Sys().(*syscall.Stat_t); !ok || (st.Uid != 0 && int(st.Uid) != uid) {
		return fmt.Errorf("%s belongs to another user", dir)
	}
	if m := info.Mode(); m.Perm()&0o022 != 0 && m&os.ModeSticky == 0 {
		return fmt.Errorf("%s is writable by other users without the sticky bit", dir)
	}
	return nil
}

// Listen creates the socket directory (0700) and the socket (0600) of the
// agent for server.
func Listen(server string) (net.Listener, error) {
	path := SocketPath(server)
	dir, err := ownDir(filepath.Dir(path), true)
	if err != nil {
		return nil, err
	}
	path = filepath.Join(dir, filepath.Base(path))
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

func request(server, cmd string) (string, error) {
	path := SocketPath(server)
	dir, err := ownDir(filepath.Dir(path), false)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrNoAgent
		}
		return "", err
	}
	c, err := net.Dial("unix", filepath.Join(dir, filepath.Base(path)))
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

// Identity returns the identity string held by the agent for server.
func Identity(server string) (string, error) { return request(server, "identity") }

// Lock stops the agent for server.
func Lock(server string) error {
	_, err := request(server, "lock")
	return err
}
